import { applyPowerAction, isPowerOn, setButtonPressed, RESET_SEQUENCE } from './actuators.js';
import type { PowerDevice, PowerSwitches } from './actuators.js';
import { isContactClosed, loadOhms, TICK_MS } from './elements.js';
import type { LoadElement } from './elements.js';
import { CHATTER_MIN_TRANSITIONS, CHATTER_WINDOW_MS, EventBus } from './events.js';
import type { TerminalId, WireId } from './ids.js';
import { SignalLog } from './log.js';
import type { SignalValue } from './log.js';
import {
  addWire as addWireToNetlist,
  buildNets,
  exceedsWireLimit,
  findElement,
  findPart,
  removeWire as removeWireFromNetlist,
} from './netlist.js';
import type { Nets, Netlist, Wire } from './netlist.js';
import { clampPreset } from './parts.js';
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
  constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
  }
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
  private readonly buttons = new Map<string, boolean>();
  private readonly chatterTimes = new Map<string, number[]>();
  private readonly chatterReported = new Map<string, number>();
  private switches: PowerSwitches = { breakerOn: false, switchOn: false };
  private tripped = false;
  private resetStep = 0;
  private elapsedMs = 0;
  private lastSolve: SolveResult | undefined;

  constructor(netlist: Netlist, options: SimulationOptions = {}) {
    this.netlist = netlist;
    this.tickMs = options.tickMs ?? TICK_MS;
    this.watch = options.watch ?? [];
    for (const part of netlist.parts) {
      const id: string = part.id;
      if (part.meta.kind === 'relay-my4n') {
        this.relays.set(id, { coilVolts: 0, coilOn: false, contactsOn: false, pendingTicks: 0 });
      } else if (part.meta.kind === 'timer-h3y4') {
        this.timers.set(id, {
          coilVolts: 0,
          powered: false,
          elapsedMs: 0,
          offMs: part.meta.resetGapMs,
          timedOut: false,
          presetMs: part.meta.presetMs,
        });
      } else if (part.meta.kind === 'lamp' || part.meta.kind === 'buzzer') {
        this.lamps.set(id, { volts: 0, level: 'off' });
      } else if (part.meta.kind === 'pushbutton') {
        this.buttons.set(id, false);
      }
    }
    this.syncSources();
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

  /** タイマの設定時間を変える。レンジ内に丸める。§5.3.2 */
  setTimerPreset(timerId: string, presetMs: number): void {
    const part = findPart(this.netlist, timerId);
    if (part === undefined || part.meta.kind !== 'timer-h3y4') {
      throw new SimulationError(`タイマが見つかりません: ${timerId}`);
    }
    const clamped = clampPreset(presetMs, part.meta.rangeMaxMs);
    part.meta.presetMs = clamped;
    const runtime = this.timers.get(timerId);
    if (runtime !== undefined) runtime.presetMs = clamped;
  }

  /** 電線を張る。上限（1端子2本）を超えたら `over-wires-per-terminal` を発行するが接続は保持する。§6.6 */
  addWire(wire: Wire): void {
    addWireToNetlist(this.netlist, wire);
    for (const terminal of [wire.from, wire.to]) {
      if (exceedsWireLimit(this.netlist, terminal)) {
        this.events.emit({
          type: 'hazard',
          kind: 'over-wires-per-terminal',
          tMs: this.tMs,
          detail: terminal,
        });
      }
    }
  }

  /** 電線を外す。 */
  removeWire(id: WireId | string): boolean {
    return removeWireFromNetlist(this.netlist, id);
  }

  /** 1tick進める。 */
  step(dtMs: number = this.tickMs): void {
    this.syncSources();
    const nets = buildNets(this.netlist);
    const solved = solve(this.netlist, nets);
    this.lastSolve = solved;
    this.updateLoads(solved);
    this.updateRelays(solved);
    this.updateTimers(solved, dtMs);
    this.applyContacts();
    this.updateProtection(solved);
    const values = this.snapshot(solved, nets);
    const changed = this.log.record(this.tMs, values);
    this.detectChatter(changed, values);
    this.elapsedMs += dtMs;
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
      nodeVoltages: this.lastSolve?.nodeVoltages ?? [],
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

  /** 過電流保護。出力電流が保護値を超えた tick で出力を落とす。§5.1.1 / §5.6 #3 */
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
    this.events.emit({
      type: 'hazard',
      kind: 'short-circuit-power-on',
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

  /** 同一信号が1秒窓で10回以上遷移したらチャタリングとして発行する。§5.3.2 */
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
