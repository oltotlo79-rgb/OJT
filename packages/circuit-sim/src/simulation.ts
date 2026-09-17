import { applyPowerAction, isPowerOn, setButtonPressed, RESET_SEQUENCE } from './actuators.js';
import type { PowerDevice, PowerSwitches } from './actuators.js';
import { isContactClosed, loadOhms, TICK_MS } from './elements.js';
import type { LoadElement } from './elements.js';
import { CHATTER_MIN_TRANSITIONS, CHATTER_WINDOW_MS, EventBus } from './events.js';
import type { TerminalId, WireId } from './ids.js';
import { SignalLog } from './log.js';
import type { SignalValue } from './log.js';
import { clearProbeState, clearRangeExceeded } from './meter-state.js';
import {
  addWire as addWireToNetlist,
  buildNets,
  canAddWire,
  findElement,
  findPart,
  findWire,
  NetlistError,
  removeWire as removeWireFromNetlist,
  resetNetlist,
} from './netlist.js';
import type { Nets, Netlist, Wire } from './netlist.js';
import { clampPreset } from './parts.js';
import type { Part } from './parts.js';
import { plcMetaOf } from './plc.js';
import { solve, voltageAt } from './solver.js';
import type { SolveResult } from './solver.js';

/** ランプの点灯段階。§5.3.4 */
export type LampLevel = 'off' | 'dim' | 'lit';

/** ランプ点灯段階のログ用数値コード。 */
export const LAMP_LEVEL_CODE: Record<LampLevel, number> = { off: 0, dim: 1, lit: 2 };

/** リレーの内部状態。 */
export interface RelayRuntime {
  coilVolts: number;
  /** コイルが励磁判定されているか（しきい値＋ヒステリシス）。§5.3.1 */
  coilOn: boolean;
  /** 接点が動作位置にあるか（励磁から1tick遅れる）。§5.3.1 */
  contactsOn: boolean;
  pendingTicks: number;
}

/** タイマの内部状態。§5.3.2 */
export interface TimerRuntime {
  coilVolts: number;
  powered: boolean;
  elapsedMs: number;
  offMs: number;
  timedOut: boolean;
  presetMs: number;
}

/** ランプ／ブザーの内部状態。 */
export interface LampRuntime {
  volts: number;
  level: LampLevel;
}

/** PLC本体の内部状態。§4.4 */
export interface PlcUnitRuntime {
  /** 入力点の論理値（入力番号順）。§5.1.3 */
  inputs: boolean[];
  /** 出力点の論理値（出力番号順）。ランタイムが `setPlcOutputs()` で書く。 */
  outputs: boolean[];
  /** 入力点の実測電流[A]（デバッグ・ログ用）。 */
  inputAmps: number[];
}

/** シミュレーションの公開状態スナップショット。 */
export interface SimulationState {
  tMs: number;
  breakerOn: boolean;
  switchOn: boolean;
  /** 過電流保護が動作中か。§5.1.1 */
  tripped: boolean;
  powered: boolean;
  sourceAmps: number;
  buttons: Record<string, boolean>;
  relays: Record<string, RelayRuntime>;
  timers: Record<string, TimerRuntime>;
  lamps: Record<string, LampRuntime>;
  /** PLC本体の状態（部品ID順不同）。§4.4 */
  plcs: Record<string, PlcUnitRuntime>;
  nodeVoltages: readonly number[];
}

/** シミュレーション生成オプション。 */
export interface SimulationOptions {
  /** 1tickの長さ[ms]。既定10（§5.2）。 */
  tickMs?: number;
  /** 電位をログに残す端子。信号名は `V:<端子ID>`。§5.7 */
  watch?: readonly TerminalId[];
}

/** シミュレーション操作の失敗。 */
export class SimulationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SimulationError';
  }
}

/** ランタイム表から、いま存在しない部品ぶんの項目を捨てる。 */
function pruneRuntime<T>(map: Map<string, T>, keep: ReadonlySet<string>): void {
  for (const id of [...map.keys()]) if (!keep.has(id)) map.delete(id);
}

/**
 * 回路シミュレーション本体。§5.2
 * 1tickの処理順は「解く → 負荷の通電判定 → リレー／タイマ状態機械 → 接点更新 → 保護判定 → ログ記録」。
 * 乱数を使わないため、同じネットリストと同じ操作列からは必ず同じログが出る（決定論）。
 */
export class Simulation {
  readonly netlist: Netlist;
  readonly log = new SignalLog();
  readonly events = new EventBus();

  private readonly tickMs: number;
  private readonly watch: readonly TerminalId[];
  private readonly relays = new Map<string, RelayRuntime>();
  private readonly timers = new Map<string, TimerRuntime>();
  private readonly lamps = new Map<string, LampRuntime>();
  private readonly plcs = new Map<string, PlcUnitRuntime>();
  private readonly buttons = new Map<string, boolean>();
  private readonly chatterTimes = new Map<string, number[]>();
  private readonly chatterReported = new Map<string, number>();
  /** `over-wires-per-terminal` を発行済みの端子。その端子の電線が1本減るまで再発行しない。§5.6 #5 */
  private readonly overWireReported = new Set<TerminalId>();
  private switches: PowerSwitches = { breakerOn: false, switchOn: false };
  private tripped = false;
  private resetStep = 0;
  private elapsedMs = 0;
  private lastSolve: SolveResult | undefined;
  /** 直近に電源スイッチが正常にONへ操作された時刻[ms]。過電流の種別判定に使う。§5.6 #3/#6 */
  private lastSwitchOnMs: number | undefined;

  /**
   * ネットリストを受け取り、部品の実行時状態（接点の `energized` ／電源の `enabled`）を
   * `resetNetlist` でリセットしてから内部状態を組み立てる。これにより、他の `Simulation` が
   * 同じネットリストを操作した後でも、新しいインスタンスは解放・非通電の状態から始まる
   * （故障〈`fault`〉と `wire.open` は意図的に対象外。§5.4 の責務）。
   */
  constructor(netlist: Netlist, options: SimulationOptions = {}) {
    const tickMs = options.tickMs ?? TICK_MS;
    if (!(Number.isFinite(tickMs) && tickMs > 0)) {
      throw new SimulationError(`tickMs は有限の正の値が必要です: ${String(options.tickMs)}`);
    }
    this.netlist = netlist;
    this.tickMs = tickMs;
    this.watch = options.watch ?? [];
    // 公開メソッドではなく private 実装を呼ぶ（構築中に派生クラスの上書きを走らせないため）。
    this.resetInternal();
  }

  /**
   * 判定開始前（t=0・非通電）の状態に戻す。時刻・ログ・イベント・押ボタン・保護動作と
   * リレー／タイマ／ランプのランタイム状態を初期化し、`resetNetlist` で部品要素の実行時状態
   * （接点の `energized`／電源の `enabled`）も戻す。以後は新しい `Simulation` と同じ結果になる。
   * 故障（`fault`）と `wire.open` は §5.4 の責務なので触らない（取り消すには `clearFaults`）。
   * 配線（`addWire`）と部品構成（`mountPart`／`unmountPart`）もそのまま残る。
   */
  reset(): void {
    this.resetInternal();
  }

  /** `reset()` の実装本体。コンストラクタからも呼ぶ。 */
  private resetInternal(): void {
    this.log.clear();
    this.events.clear();
    this.relays.clear();
    this.timers.clear();
    this.lamps.clear();
    this.plcs.clear();
    this.buttons.clear();
    this.chatterTimes.clear();
    this.chatterReported.clear();
    this.overWireReported.clear();
    // `ohm-on-live` の重複発行記録（`meter.ts` が持つプローブ配置）も消す。§5.6 #1
    clearProbeState(this);
    // `range-exceeded` の重複発行記録（`tester.ts` が持つつまみ・レンジ・プローブ）も消す。§5.6 #2
    clearRangeExceeded(this);
    this.switches = { breakerOn: false, switchOn: false };
    this.tripped = false;
    this.resetStep = 0;
    this.elapsedMs = 0;
    this.lastSolve = undefined;
    this.lastSwitchOnMs = undefined;
    resetNetlist(this.netlist);
    this.syncRuntimeMaps();
    this.syncSources();
  }

  /**
   * 部品を挿す（エピソード途中でも可）。時刻・ログ・イベントは消さずに、ランタイム表と
   * 節点だけを組み直す。同じIDの部品（`unmountPart` が残した空きソケット等）があれば
   * それを置き換え、無ければ末尾に足す。まだ生きている部品の上に挿した場合も置き換えになる。
   * 置き換えるときは、挿す部品の端子が元の部品の端子をすべて含んでいなければならない
   * （足りないと既設の電線が宙に浮くため）。含んでいなければ `SimulationError` を投げ、
   * ネットリストは何も変えない。
   * 挿した部品の接点・電源は解放／非通電に戻し、ランタイム状態（リレーの接点位置・タイマの
   * 設定時間と経過・ランプ・押ボタン）も捨てて作り直すため、コイルが既存の配線ですでに
   * 励磁されていても新品と同じく次tick以降で動作する（`operateTicks` ぶん遅れて接点が入る）。
   */
  mountPart(part: Part): void {
    const index = this.netlist.parts.findIndex((p) => p.id === part.id);
    const existing = index < 0 ? undefined : this.netlist.parts[index];
    if (existing !== undefined) {
      const incoming = new Set<TerminalId>(part.terminals);
      if (existing.terminals.some((terminal) => !incoming.has(terminal))) {
        throw new SimulationError(`端子配列が一致しません: ${part.id}`);
      }
    }
    for (const el of part.elements) {
      if (el.kind === 'contact') el.energized = false;
      else if (el.kind === 'source') el.enabled = false;
    }
    if (existing === undefined) this.netlist.parts.push(part);
    else this.netlist.parts.splice(index, 1, part);
    // 生きている同じIDの部品を置き換えた場合に前の状態を引き継がないよう、先に捨ててから組み直す。
    const id: string = part.id;
    this.relays.delete(id);
    this.timers.delete(id);
    this.lamps.delete(id);
    // PLCのランタイムも捨てる。`mountPart` はY接点の `energized` を false に戻すので、
    // 出力の論理値を持ち越すとランタイム状態と要素の状態が食い違う。
    this.plcs.delete(id);
    this.buttons.delete(id);
    this.syncRuntimeMaps();
    this.syncSources();
  }

  /**
   * 部品を抜く。抜いた部品を返す（その部品が無ければ undefined）。時刻・ログ・イベントは消さない。
   * 端子は要素を持たない `terminal-block`（空きソケット）として残すので、その端子に張った電線は
   * そのまま残り、配線をやり直さずに `mountPart` で挿し直せる。§6.4
   * すでに空きソケットになっている端子を抜こうとした場合は何もせず undefined を返す
   * （ソケットは作り直さないので、端子も電線もそのまま残る）。
   */
  unmountPart(partId: string): Part | undefined {
    const index = this.netlist.parts.findIndex((p) => p.id === partId);
    const part = index < 0 ? undefined : this.netlist.parts[index];
    if (part === undefined || part.kind === 'terminal-block') return undefined;
    this.netlist.parts.splice(index, 1, {
      id: part.id,
      kind: 'terminal-block',
      terminals: [...part.terminals],
      elements: [],
      meta: { kind: 'terminal-block' },
    });
    this.syncRuntimeMaps();
    return part;
  }

  /**
   * 部品構成にあわせてランタイム表（リレー／タイマ／ランプ／押ボタン）を組み直す。
   * 残っている部品の状態はそのまま保ち、増えた部品には初期状態を与え、消えた部品ぶんは捨てる。
   */
  private syncRuntimeMaps(): void {
    const relayIds = new Set<string>();
    const timerIds = new Set<string>();
    const lampIds = new Set<string>();
    const plcIds = new Set<string>();
    const buttonIds = new Set<string>();
    for (const part of this.netlist.parts) {
      const id: string = part.id;
      const meta = part.meta;
      if (meta.kind === 'relay-my4n') {
        relayIds.add(id);
        if (!this.relays.has(id)) {
          this.relays.set(id, { coilVolts: 0, coilOn: false, contactsOn: false, pendingTicks: 0 });
        }
      } else if (meta.kind === 'timer-h3y4') {
        timerIds.add(id);
        if (!this.timers.has(id)) {
          this.timers.set(id, {
            coilVolts: 0,
            powered: false,
            elapsedMs: 0,
            offMs: meta.resetGapMs,
            timedOut: false,
            presetMs: meta.presetMs,
          });
        }
      } else if (meta.kind === 'lamp' || meta.kind === 'buzzer') {
        lampIds.add(id);
        if (!this.lamps.has(id)) this.lamps.set(id, { volts: 0, level: 'off' });
      } else if (meta.kind === 'pushbutton') {
        buttonIds.add(id);
        if (!this.buttons.has(id)) this.buttons.set(id, false);
      } else if (meta.kind === 'plc') {
        plcIds.add(id);
        if (!this.plcs.has(id)) {
          this.plcs.set(id, {
            inputs: meta.inputs.map(() => false),
            outputs: meta.outputs.map(() => false),
            inputAmps: meta.inputs.map(() => 0),
          });
        }
      }
    }
    pruneRuntime(this.relays, relayIds);
    pruneRuntime(this.timers, timerIds);
    pruneRuntime(this.lamps, lampIds);
    pruneRuntime(this.plcs, plcIds);
    pruneRuntime(this.buttons, buttonIds);
  }

  /** 現在時刻[ms]（判定開始からの経過）。 */
  get tMs(): number {
    return this.elapsedMs;
  }

  /** 押ボタンを押す。§5.3.3 */
  press(pbId: string): void {
    this.setButton(pbId, true);
  }

  /** 押ボタンを離す。§5.3.3 */
  release(pbId: string): void {
    this.setButton(pbId, false);
  }

  /** ブレーカを入切する。§5.3.5 */
  setBreaker(on: boolean): void {
    this.powerAction('breaker', on);
  }

  /** 電源スイッチを入切する。§5.3.5 */
  setSwitch(on: boolean): void {
    this.powerAction('switch', on);
  }

  /**
   * タイマの設定時間を変える。レンジ内に丸める。§5.3.2
   * `presetMs` が非有限（NaN／Infinity）だと `clampPreset` が RangeError を投げるが、
   * ここで捕まえて `SimulationError` に変換する（この関数の失敗はすべて `SimulationError`）。
   */
  setTimerPreset(timerId: string, presetMs: number): void {
    const part = findPart(this.netlist, timerId);
    if (part === undefined || part.meta.kind !== 'timer-h3y4') {
      throw new SimulationError(`タイマが見つかりません: ${timerId}`);
    }
    let clamped: number;
    try {
      clamped = clampPreset(presetMs, part.meta.rangeMaxMs);
    } catch {
      throw new SimulationError(`タイマ ${timerId} の設定値が不正です: ${presetMs}`);
    }
    part.meta.presetMs = clamped;
    const runtime = this.timers.get(timerId);
    if (runtime !== undefined) runtime.presetMs = clamped;
  }

  /** PLC本体のメタデータとランタイムを引く。PLCでなければ `SimulationError`。 */
  private plcOf(partId: string): {
    meta: NonNullable<ReturnType<typeof plcMetaOf>>;
    runtime: PlcUnitRuntime;
  } {
    const part = findPart(this.netlist, partId);
    const meta = part === undefined ? undefined : plcMetaOf(part);
    const runtime = this.plcs.get(partId);
    if (meta === undefined || runtime === undefined) {
      throw new SimulationError(`PLC本体が見つかりません: ${partId}`);
    }
    return { meta, runtime };
  }

  /**
   * PLC入力の論理値（入力番号順）。§10.4 の「①入力読込」で使う。
   * 返すのはコピーなので、呼び出し側が書き換えてもエンジンの状態は変わらない。
   */
  plcInputs(partId: string): boolean[] {
    return [...this.plcOf(partId).runtime.inputs];
  }

  /**
   * PLC出力を書く。§10.4 の「③出力書込」。配列が短いぶんは OFF として扱う。
   * 書いた値は次の `step()` の `solve()` から効く（Y接点は `driver: 'external'` なので
   * `applyContacts()` は触らない）。
   */
  setPlcOutputs(partId: string, values: readonly boolean[]): void {
    const { meta, runtime } = this.plcOf(partId);
    meta.outputs.forEach((channel, index) => {
      const on = values[index] ?? false;
      runtime.outputs[index] = on;
      const el = findElement(this.netlist, channel.elementId);
      if (el !== undefined && el.kind === 'contact') el.energized = on;
    });
  }

  /**
   * 電線を張る。どちらかの端子が本数上限（1端子2本）に達していれば `over-wires-per-terminal` を
   * 発行し、電線は追加せず false を返す（両端が上限でもハザードは1件のみ）。
   * 追加できたら true を返す。電線IDが重複していれば `SimulationError`。§6.6
   *
   * 重複発行の方針（§5.6 #5）: 同じ満杯の端子に何度挑んでもハザードは1件しか出ない。
   * 発行済みの端子は記録しておき、`removeWire` でその端子の電線が1本外れて空きができた時点で
   * 記録を消す。したがって「満杯 → 拒否 → 1本外す → また満杯にする → 拒否」で2件目が出る。
   * （`ohm-on-live` も同じ考え方で、`meter.ts` がプローブ配置ごとに1件だけ発行する。）
   */
  addWire(wire: Wire): boolean {
    const overLimit = [wire.from, wire.to].filter(
      (terminal) => !canAddWire(this.netlist, terminal),
    );
    if (overLimit.length > 0) {
      // 自己ループ電線は両端が同じ端子なので、重複を潰してから未報告ぶんだけを拾う。
      const unreported = [...new Set(overLimit)].filter(
        (terminal) => !this.overWireReported.has(terminal),
      );
      if (unreported.length > 0) {
        for (const terminal of unreported) this.overWireReported.add(terminal);
        this.events.emit({
          type: 'hazard',
          kind: 'over-wires-per-terminal',
          tMs: this.tMs,
          // 今回新たに記録した端子だけを並べる（すでに報告済みの端子は含めない）。
          detail: unreported.join(','),
        });
      }
      return false;
    }
    this.rethrowNetlistErrors(() => addWireToNetlist(this.netlist, wire));
    return true;
  }

  /**
   * 電線を外す。ロックされた電線を外そうとすると `SimulationError`。
   * 外した結果その端子に空きができた（`canAddWire` が true になった）ときだけ、
   * `over-wires-per-terminal` の発行済み記録から外す。手で組んだ3本以上の端子では
   * 1本外してもまだ満杯のことがあり、その場合は記録を残して再発行を防ぐ。§5.6 #5
   */
  removeWire(id: WireId | string): boolean {
    const wire = findWire(this.netlist, id);
    const removed = this.rethrowNetlistErrors(() => removeWireFromNetlist(this.netlist, id));
    if (removed && wire !== undefined) {
      for (const terminal of [wire.from, wire.to]) {
        if (canAddWire(this.netlist, terminal)) this.overWireReported.delete(terminal);
      }
    }
    return removed;
  }

  /**
   * `netlist.ts` の操作を実行し、`NetlistError` を `SimulationError` に変換して投げ直す
   * （このクラスのエラー型を統一する）。元の `NetlistError` は `cause` に残す。
   */
  private rethrowNetlistErrors<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof NetlistError) throw new SimulationError(err.message, { cause: err });
      throw err;
    }
  }

  /**
   * 1tick進める。節点数上限の超過や未知の端子など、内部で起きた `NetlistError` は
   * メッセージをそのままに `SimulationError` へ包み直して投げる（このクラスのエラー型を統一する）。
   */
  step(dtMs: number = this.tickMs): void {
    this.rethrowNetlistErrors(() => {
      this.syncSources();
      const nets = buildNets(this.netlist);
      const solved = solve(this.netlist, nets);
      this.lastSolve = solved;
      this.updateLoads(solved);
      this.updateRelays(solved);
      this.updateTimers(solved, dtMs);
      this.updatePlcInputs(solved);
      this.applyContacts();
      this.updateProtection(solved);
      const values = this.snapshot(solved, nets);
      const changed = this.log.record(this.tMs, values);
      this.detectChatter(changed, values);
      this.elapsedMs += dtMs;
    });
  }

  /** 指定時刻に達するまで進める。 */
  run(untilMs: number): void {
    while (this.elapsedMs < untilMs) this.step();
  }

  /** 現在の状態のスナップショット。 */
  state(): SimulationState {
    const relays: Record<string, RelayRuntime> = {};
    for (const [id, st] of this.relays) relays[id] = { ...st };
    const timers: Record<string, TimerRuntime> = {};
    for (const [id, st] of this.timers) timers[id] = { ...st };
    const lamps: Record<string, LampRuntime> = {};
    for (const [id, st] of this.lamps) lamps[id] = { ...st };
    const plcs: Record<string, PlcUnitRuntime> = {};
    for (const [id, st] of this.plcs) {
      plcs[id] = { inputs: [...st.inputs], outputs: [...st.outputs], inputAmps: [...st.inputAmps] };
    }
    const buttons: Record<string, boolean> = {};
    for (const [id, pressed] of this.buttons) buttons[id] = pressed;
    return {
      tMs: this.elapsedMs,
      breakerOn: this.switches.breakerOn,
      switchOn: this.switches.switchOn,
      tripped: this.tripped,
      powered: isPowerOn(this.switches) && !this.tripped,
      sourceAmps: this.lastSolve?.sourceAmps ?? 0,
      buttons,
      relays,
      timers,
      lamps,
      plcs,
      // 内部配列を渡すと呼び出し側から書き換えられてしまうので、必ずコピーを返す。
      nodeVoltages: Array.from(this.lastSolve?.nodeVoltages ?? []),
    };
  }

  private setButton(pbId: string, pressed: boolean): void {
    const part = findPart(this.netlist, pbId);
    if (part === undefined || part.meta.kind !== 'pushbutton') {
      throw new SimulationError(`押ボタンが見つかりません: ${pbId}`);
    }
    setButtonPressed(part, pressed);
    this.buttons.set(pbId, pressed);
  }

  private powerAction(device: PowerDevice, on: boolean): void {
    const current = device === 'breaker' ? this.switches.breakerOn : this.switches.switchOn;
    if (current === on) return;
    const result = applyPowerAction(this.switches, device, on);
    this.switches = result.switches;
    if (device === 'switch' && on) this.lastSwitchOnMs = this.tMs;
    if (result.violation) {
      this.events.emit({
        type: 'hazard',
        kind: 'power-sequence-violation',
        tMs: this.tMs,
        detail: `${device}:${on ? 'on' : 'off'}`,
      });
    }
    this.advanceReset(device, on);
    this.syncSources();
  }

  /** 保護動作からの復帰手順を1手ずつ照合する。手順どおり4手で復帰する。§5.1.1 */
  private advanceReset(device: PowerDevice, on: boolean): void {
    if (!this.tripped) {
      this.resetStep = 0;
      return;
    }
    const expected = RESET_SEQUENCE[this.resetStep];
    if (expected !== undefined && expected.device === device && expected.on === on) {
      this.resetStep += 1;
      if (this.resetStep >= RESET_SEQUENCE.length) {
        this.tripped = false;
        this.resetStep = 0;
      }
    } else {
      this.resetStep = 0;
    }
  }

  private syncSources(): void {
    const live = isPowerOn(this.switches) && !this.tripped;
    for (const part of this.netlist.parts) {
      for (const el of part.elements) if (el.kind === 'source') el.enabled = live;
    }
  }

  private coilOf(elementId: string): LoadElement | undefined {
    const el = findElement(this.netlist, elementId);
    return el !== undefined && el.kind === 'load' ? el : undefined;
  }

  /** 負荷の通電判定。断線している負荷は電位差があっても通電しない。§5.1.3 */
  private updateLoads(solved: SolveResult): void {
    for (const part of this.netlist.parts) {
      const meta = part.meta;
      if (meta.kind !== 'lamp' && meta.kind !== 'buzzer') continue;
      const runtime = this.lamps.get(part.id);
      if (runtime === undefined) continue;
      const el = this.coilOf(meta.loadElementId);
      const conducting = el !== undefined && loadOhms(el) !== undefined;
      const volts = conducting ? Math.abs(solved.elementVolts.get(meta.loadElementId) ?? 0) : 0;
      runtime.volts = volts;
      runtime.level = !conducting
        ? 'off'
        : volts >= meta.litVolts
          ? 'lit'
          : volts >= meta.dimVolts
            ? 'dim'
            : 'off';
    }
  }

  private updateRelays(solved: SolveResult): void {
    for (const part of this.netlist.parts) {
      const meta = part.meta;
      if (meta.kind !== 'relay-my4n') continue;
      const st = this.relays.get(part.id);
      if (st === undefined) continue;
      if (st.contactsOn !== st.coilOn) {
        st.pendingTicks -= 1;
        if (st.pendingTicks <= 0) st.contactsOn = st.coilOn;
      }
      const el = this.coilOf(meta.coilElementId);
      const conducting = el !== undefined && loadOhms(el) !== undefined;
      const volts = conducting ? (solved.elementVolts.get(meta.coilElementId) ?? 0) : 0;
      st.coilVolts = volts;
      const desired = !conducting
        ? false
        : volts >= meta.pickupVolts
          ? true
          : volts <= meta.dropoutVolts
            ? false
            : st.coilOn;
      if (desired !== st.coilOn) {
        st.coilOn = desired;
        st.pendingTicks = desired ? meta.operateTicks : meta.releaseTicks;
      }
    }
  }

  private updateTimers(solved: SolveResult, dtMs: number): void {
    for (const part of this.netlist.parts) {
      const meta = part.meta;
      if (meta.kind !== 'timer-h3y4') continue;
      const st = this.timers.get(part.id);
      if (st === undefined) continue;
      const el = this.coilOf(meta.coilElementId);
      const conducting = el !== undefined && loadOhms(el) !== undefined;
      const volts = conducting ? (solved.elementVolts.get(meta.coilElementId) ?? 0) : 0;
      st.coilVolts = volts;
      const powered = !conducting
        ? false
        : volts >= meta.pickupVolts
          ? true
          : volts <= meta.dropoutVolts
            ? false
            : st.powered;
      if (powered) {
        if (!st.powered) {
          if (st.offMs >= meta.resetGapMs) st.elapsedMs = 0;
          st.offMs = 0;
        }
        st.powered = true;
        st.elapsedMs += dtMs;
        if (st.elapsedMs >= st.presetMs) st.timedOut = true;
      } else {
        st.powered = false;
        st.timedOut = false; // 限時接点は瞬時復帰する §5.3.2
        st.offMs += dtMs;
        if (st.offMs >= meta.resetGapMs) st.elapsedMs = 0;
      }
    }
  }

  /**
   * PLC入力の論理値を更新する。§5.1.3 / §4.4
   * 入力要素の電流の**絶対値**で判定するので、シンク結線（`P`→`S/S`）でもソース結線
   * （`N`→`S/S`）でも同じ結果になる（§10.2 はどちらも認めている）。
   * しきい値の間（既定 1.5mA 超 3.5mA 未満）はヒステリシスで直前の状態を保つ。
   */
  private updatePlcInputs(solved: SolveResult): void {
    for (const part of this.netlist.parts) {
      const meta = plcMetaOf(part);
      if (meta === undefined) continue;
      const runtime = this.plcs.get(part.id);
      /* c8 ignore next -- syncRuntimeMaps がPLC部品ぶんを必ず作るので未到達 */
      if (runtime === undefined) continue;
      meta.inputs.forEach((channel, index) => {
        const amps = Math.abs(solved.elementAmps.get(channel.elementId) ?? 0);
        runtime.inputAmps[index] = amps;
        const prev = runtime.inputs[index] ?? false;
        runtime.inputs[index] = amps >= meta.onAmps ? true : amps <= meta.offAmps ? false : prev;
      });
    }
  }

  private applyContacts(): void {
    for (const part of this.netlist.parts) {
      const meta = part.meta;
      if (meta.kind === 'relay-my4n') {
        const st = this.relays.get(part.id);
        if (st === undefined) continue;
        for (const el of part.elements) {
          if (el.kind === 'contact' && el.driver === 'relay') el.energized = st.contactsOn;
        }
      } else if (meta.kind === 'timer-h3y4') {
        const st = this.timers.get(part.id);
        if (st === undefined) continue;
        for (const el of part.elements) {
          if (el.kind === 'contact' && el.driver === 'timer') el.energized = st.timedOut;
        }
      }
    }
  }

  /**
   * 過電流保護。出力電流が保護値を超えた tick で出力を落とす。§5.1.1 / §5.6 #3
   * トリップが電源スイッチON操作から1tick以内なら「通電した瞬間に短絡していた」とみなし
   * `short-circuit-power-on` を、それ以外（稼働中に故障が発生した等）は `overcurrent` を発行する。
   */
  private updateProtection(solved: SolveResult): void {
    if (this.tripped || !isPowerOn(this.switches)) return;
    let limit = Number.POSITIVE_INFINITY;
    for (const part of this.netlist.parts) {
      for (const el of part.elements) {
        if (el.kind === 'source' && el.enabled) limit = Math.min(limit, el.protectionAmps);
      }
    }
    if (Math.abs(solved.sourceAmps) <= limit) return;
    this.tripped = true;
    this.resetStep = 0;
    this.syncSources();
    const justPoweredOn =
      this.lastSwitchOnMs !== undefined && this.tMs - this.lastSwitchOnMs <= this.tickMs;
    this.events.emit({
      type: 'hazard',
      kind: justPoweredOn ? 'short-circuit-power-on' : 'overcurrent',
      tMs: this.tMs,
      detail: `電源電流 ${solved.sourceAmps.toFixed(1)}A`,
    });
  }

  private snapshot(solved: SolveResult, nets: Nets): Map<string, SignalValue> {
    const out = new Map<string, SignalValue>();
    out.set('POWER', isPowerOn(this.switches) && !this.tripped);
    out.set('POWER.I', solved.sourceAmps);
    for (const part of this.netlist.parts) {
      const id: string = part.id;
      const meta = part.meta;
      if (meta.kind === 'pushbutton') {
        out.set(id, this.buttons.get(id) ?? false);
      } else if (meta.kind === 'relay-my4n') {
        const st = this.relays.get(id);
        if (st !== undefined) {
          out.set(id, st.contactsOn);
          out.set(`${id}.coil`, st.coilOn);
          out.set(`${id}.coilV`, st.coilVolts);
        }
      } else if (meta.kind === 'timer-h3y4') {
        const st = this.timers.get(id);
        if (st !== undefined) {
          out.set(id, st.timedOut);
          out.set(`${id}.coil`, st.powered);
          out.set(`${id}.coilV`, st.coilVolts);
        }
      } else if (meta.kind === 'lamp' || meta.kind === 'buzzer') {
        const st = this.lamps.get(id);
        if (st !== undefined) {
          out.set(id, st.level === 'lit');
          out.set(`${id}.level`, LAMP_LEVEL_CODE[st.level]);
          out.set(`${id}.volts`, st.volts);
        }
      } else if (meta.kind === 'plc') {
        const st = this.plcs.get(id);
        if (st !== undefined) {
          meta.inputs.forEach((channel, index) => {
            out.set(`${id}.${channel.name}`, st.inputs[index] ?? false);
            out.set(`${id}.${channel.name}.mA`, (st.inputAmps[index] ?? 0) * 1000);
          });
          meta.outputs.forEach((channel, index) => {
            out.set(`${id}.${channel.name}`, st.outputs[index] ?? false);
          });
        }
      }
      for (const el of part.elements) {
        if (el.kind === 'contact') out.set(`${el.id}.closed`, isContactClosed(el));
      }
    }
    for (const terminal of this.watch) {
      out.set(`V:${terminal}`, voltageAt(solved, nets, terminal));
    }
    return out;
  }

  /** 同一信号が1秒窓で `CHATTER_MIN_TRANSITIONS`（20）回以上遷移したらチャタリングとして発行する。§5.3.2 */
  private detectChatter(
    changed: readonly string[],
    values: ReadonlyMap<string, SignalValue>,
  ): void {
    for (const signal of changed) {
      if (typeof values.get(signal) !== 'boolean') continue;
      const times = this.chatterTimes.get(signal) ?? [];
      times.push(this.elapsedMs);
      while (times.length > 0 && this.elapsedMs - (times[0] ?? 0) > CHATTER_WINDOW_MS)
        times.shift();
      this.chatterTimes.set(signal, times);
      if (times.length < CHATTER_MIN_TRANSITIONS) continue;
      const reported = this.chatterReported.get(signal);
      if (reported !== undefined && this.elapsedMs - reported < CHATTER_WINDOW_MS) continue;
      this.chatterReported.set(signal, this.elapsedMs);
      this.events.emit({
        type: 'chatter',
        signal,
        tMs: this.elapsedMs,
        count: times.length,
      });
    }
  }
}
