import type { CompiledNetwork, CompiledProgram } from './compile.js';
import {
  cellAt,
  COIL_COL,
  SPECIAL_ALWAYS_ON,
  SPECIAL_ALWAYS_OFF,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  type Cell,
  type Device,
  type Network,
  type OutputCell,
} from './ir.js';

/**
 * PLCランタイム。設計仕様 §10.4。
 *
 * 1スキャンは「①入力読込 ②ネットワークを上から順に実行 ③出力書込」の3段。回路エンジンは
 * 知らず、外界とは {@link PlcIoPort} だけで繋がる（§4.2）。乱数を使わないので、同じ入力列からは
 * 必ず同じ出力列が出る（§5.2 の決定論）。
 */

/** スキャン周期[ms]。回路エンジンの tick と同じ。§10.4 */
export const SCAN_MS = 10;

/** 1秒クロック（`SP2`）の周期[ms]。§10.3 */
export const CLOCK_PERIOD_MS = 1000;

/** PLCの入出力ポート。§4.2 */
export interface PlcIoPort {
  /** 入力点の現在値（添字＝入力デバイス番号）。 */
  readInputs(): readonly boolean[];
  /** 出力点の新しい値（添字＝出力デバイス番号）。 */
  writeOutputs(values: readonly boolean[]): void;
}

/** タイマの状態。 */
export interface PlcTimerState {
  elapsedMs: number;
  on: boolean;
}

/** カウンタの状態。 */
export interface PlcCounterState {
  value: number;
  on: boolean;
}

/** ランタイムの状態スナップショット（モニタ表示・テスト用）。 */
export interface PlcSnapshot {
  scanCount: number;
  tMs: number;
  inputs: boolean[];
  outputs: boolean[];
  internals: Record<number, boolean>;
  /** 直前に実行したスキャンで接点が参照した特殊リレー。 */
  specials: Record<number, boolean>;
  timers: Record<number, PlcTimerState>;
  counters: Record<number, PlcCounterState>;
}

/** 診断モニタ中だけ記録する直近1スキャン。全履歴は蓄積しない。 */
export interface PlcNetworkTrace {
  networkId: string;
  writes: Array<{
    device: Device;
    instruction: string;
    powered: boolean;
    before: string;
    after: string;
  }>;
}
export interface PlcDiagnostics {
  scanCount: number;
  inputs: boolean[];
  networks: PlcNetworkTrace[];
  outputs: boolean[];
  resets: Record<string, { reason: string; scanCount: number }>;
}

/** ランタイム生成オプション。 */
export interface PlcRuntimeOptions {
  io: PlcIoPort;
  /** スキャン周期[ms]。既定は `SCAN_MS`（10）。 */
  scanMs?: number;
  /**
   * 出力配列の長さの下限（PLC本体の出力点数）。実際の長さはこの値と
   * プログラムが使う最大番号＋1（`program.outputCount`）の大きい方になる
   * （`Math.max(options.outputCount ?? 0, program.outputCount)`）。指定しても
   * プログラムがそれより大きい番号を書けば配列はその分まで伸びる。
   */
  outputCount?: number;
  /**
   * 通電セルを記録するか（既定 `false`）。指摘 DW-1 ≡ LE-11。
   *
   * 記録は**モニタ画面の色分けにしか使わない**（`poweredCells`）。それでも以前は常時
   * 走っていたので、モニタを閉じたまま走らせても1スキャン（10ms）ごとに
   * 「行 × 16列」ぶんの文字列キーを作って `Map` に書いていた（上限構成で毎秒約15万件）。
   * 記録しない設定でも導通計算（`solve()`）と出力・タイマ・カウンタは一切変えないので、
   * 決定論は落ちない（`test/runtime.test.ts` の「recordPowered: false でも結果が同一」）。
   */
  recordPowered?: boolean;
}

/** PLCランタイム。 */
export interface PlcRuntime {
  readonly program: CompiledProgram;
  /** 経過時間[ms]（スキャン数 × スキャン周期）。 */
  readonly tMs: number;
  /** 実行したスキャン数。 */
  readonly scanCount: number;
  /** 1スキャン実行する。 */
  scan(): void;
  diagnostics(): PlcDiagnostics;
  /**
   * 全デバイスと時刻を初期化する（リセット相当。STOPでは保持）。§10.4
   * 落とした出力は `io.writeOutputs()` で外側にも書き出すので、`Simulation` のY接点も開く。
   */
  reset(): void;
  /** STOP: 出力をOFFにし、内部リレー・タイマ・カウンタを保持する。 */
  stop(): void;
  /** デバイスの現在値。 */
  bit(device: Device): boolean;
  /** 状態のスナップショット（内部状態とは切り離したコピー）。 */
  state(): PlcSnapshot;
  /**
   * 直前のスキャンで**そのセルの左端の節点が左母線と繋がっていたか**。
   * キーは `${networkId}:${row}:${col}`（`col` は 0 起点。コイル列は `COIL_COL`）。
   * Plan 3B のラダーモニタが「通電している桟」を色分けするために使う（§10.7）。
   * END ネットワークは実行しないので記録されない。
   *
   * `recordPowered` が真のときだけ中身が入る（既定は空）。**内部の `Map` をそのまま返す**
   * 見え方で、スキャンのたびに作り直される。読む側は参照を持ち越さないこと
   * （`state()` の複製を経由させると、モニタ中は毎スナップショット最大1,536件の
   * `Record` を作って捨てることになる。指摘 DW-1 ≡ LE-11 ③）。
   */
  readonly poweredCells: ReadonlyMap<string, boolean>;
  /** 通電セルの記録を切り替える（モニタの開閉に合わせる）。止めるときは記録を捨てる。 */
  setRecordPowered(on: boolean): void;
}

/** 1ネットワークぶんの導通を解く器（union-find）。 */
class Rails {
  private readonly parent: number[];

  constructor(
    rows: number,
    private readonly cols: number,
  ) {
    this.parent = Array.from({ length: rows * (cols + 1) }, (_unused, i) => i);
    // 0列目の左辺はすべて左母線（同じ節点）。§10.3
    for (let row = 1; row < rows; row += 1) this.union(this.node(row, 0), this.node(0, 0));
  }

  node(row: number, col: number): number {
    return row * (this.cols + 1) + col;
  }

  find(start: number): number {
    let root = start;
    while ((this.parent[root] ?? root) !== root) root = this.parent[root] ?? root;
    let cursor = start;
    while ((this.parent[cursor] ?? cursor) !== cursor) {
      const next = this.parent[cursor] ?? cursor;
      this.parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }

  /** その節点が左母線と繋がっているか。 */
  poweredAt(row: number, col: number): boolean {
    return this.find(this.node(row, col)) === this.find(this.node(0, 0));
  }
}

class Runtime implements PlcRuntime {
  private readonly scanMs: number;
  private readonly outputs: boolean[];
  private inputs: boolean[] = [];
  private readonly internals = new Map<number, boolean>();
  private readonly timers = new Map<number, PlcTimerState>();
  private readonly counters = new Map<number, PlcCounterState>();
  /** 微分接点の前回値（キーは `<ネットワークID>:<行>:<列>`）。 */
  private readonly edges = new Map<string, boolean>();
  /** カウンタ入力の前回値（キーはカウンタ番号）。 */
  private readonly countEdges = new Map<number, boolean>();
  /** 直前のスキャンの通電状況（キーは `<ネットワークID>:<行>:<列>`）。Plan 3B のモニタ表示用。 */
  readonly poweredCells = new Map<string, boolean>();
  /** 通電セルを記録するか（モニタ中だけ真。指摘 DW-1 ≡ LE-11 ①）。 */
  private recordPowered: boolean;
  /** MC/MCR の入れ子（成立していれば true）。 */
  private mcStack: boolean[] = [];
  private firstScan = true;
  private elapsedMs = 0;
  private scans = 0;
  private scanTrace: PlcNetworkTrace[] = [];
  private readonly resetReasons = new Map<string, { reason: string; scanCount: number }>();

  diagnostics(): PlcDiagnostics {
    return {
      scanCount: this.scans,
      inputs: [...this.inputs],
      outputs: [...this.outputs],
      networks: structuredClone(this.scanTrace),
      resets: Object.fromEntries([...this.resetReasons].map(([id, info]) => [id, { ...info }])),
    };
  }
  private resetReason(device: Device, reason: string): void {
    this.resetReasons.set(`${device.kind}:${device.index}`, { reason, scanCount: this.scans + 1 });
  }
  private deviceValue(device: Device): string {
    if (device.kind === 'timer')
      return `${this.timers.get(device.index)?.elapsedMs ?? 0} ms / ${this.bit(device) ? 'ON' : 'OFF'}`;
    if (device.kind === 'counter')
      return `${this.counters.get(device.index)?.value ?? 0} 回 / ${this.bit(device) ? 'ON' : 'OFF'}`;
    return this.bit(device) ? 'ON' : 'OFF';
  }

  constructor(
    readonly program: CompiledProgram,
    private readonly io: PlcIoPort,
    options: PlcRuntimeOptions,
  ) {
    this.scanMs = options.scanMs ?? SCAN_MS;
    const count = Math.max(options.outputCount ?? 0, program.outputCount);
    this.outputs = Array.from({ length: count }, () => false);
    this.recordPowered = options.recordPowered ?? false;
  }

  setRecordPowered(on: boolean): void {
    this.recordPowered = on;
    // 止めたら記録は捨てる（次に開いたとき古い通電が1スキャンだけ見えるのを防ぐ）
    if (!on) {
      this.poweredCells.clear();
      this.scanTrace = [];
    }
  }

  get tMs(): number {
    return this.elapsedMs;
  }

  get scanCount(): number {
    return this.scans;
  }

  stop(): void {
    this.outputs.fill(false);
    this.poweredCells.clear();
    this.io.writeOutputs([...this.outputs]);
  }

  reset(): void {
    this.inputs = [];
    this.outputs.fill(false);
    this.internals.clear();
    this.timers.clear();
    this.counters.clear();
    this.edges.clear();
    this.countEdges.clear();
    this.poweredCells.clear();
    this.mcStack = [];
    this.firstScan = true;
    this.elapsedMs = 0;
    this.scans = 0;
    this.scanTrace = [];
    this.resetReasons.clear();
    for (const net of this.program.networks)
      for (const output of net.outputs) {
        const cell = output.cell;
        if ('device' in cell && (cell.device.kind === 'timer' || cell.device.kind === 'counter'))
          this.resetReasons.set(`${cell.device.kind}:${cell.device.index}`, {
            reason: '全メモリ初期化',
            scanCount: 0,
          });
      }
    // 出力を落としたことを外側（`Simulation`）にも伝える。§10.4
    this.io.writeOutputs([...this.outputs]);
  }

  bit(device: Device): boolean {
    switch (device.kind) {
      case 'input':
        return this.inputs[device.index] ?? false;
      case 'output':
        return this.outputs[device.index] ?? false;
      case 'internal':
        return this.internals.get(device.index) ?? false;
      case 'timer':
        return this.timers.get(device.index)?.on ?? false;
      case 'counter':
        return this.counters.get(device.index)?.on ?? false;
      case 'special':
        if (device.index === SPECIAL_ALWAYS_ON) return true;
        if (device.index === SPECIAL_ALWAYS_OFF) return false;
        if (device.index === SPECIAL_FIRST_SCAN) return this.firstScan;
        if (device.index === SPECIAL_CLOCK_1S) {
          return Math.floor(this.elapsedMs / (CLOCK_PERIOD_MS / 2)) % 2 === 0;
        }
        /* c8 ignore next -- `device()` が SP0〜SP3 以外を作らせないので到達しない。§10.3 */
        return false;
    }
  }

  state(): PlcSnapshot {
    const internals: Record<number, boolean> = {};
    for (const [index, value] of this.internals) internals[index] = value;
    const timers: Record<number, PlcTimerState> = {};
    for (const [index, value] of this.timers) timers[index] = { ...value };
    const counters: Record<number, PlcCounterState> = {};
    for (const [index, value] of this.counters) counters[index] = { ...value };
    return {
      scanCount: this.scans,
      tMs: this.elapsedMs,
      inputs: [...this.inputs],
      outputs: [...this.outputs],
      internals,
      // 起動・リセット直後には実行済みスキャンがない。未実行の初期パルスをONと表示しない。
      specials:
        this.scans === 0
          ? {}
          : {
              [SPECIAL_ALWAYS_ON]: true,
              [SPECIAL_ALWAYS_OFF]: false,
              [SPECIAL_FIRST_SCAN]: this.scans === 1,
              [SPECIAL_CLOCK_1S]:
                Math.floor((this.elapsedMs - this.scanMs) / (CLOCK_PERIOD_MS / 2)) % 2 === 0,
            },
      timers,
      counters,
    };
  }

  scan(): void {
    // ① 入力読込
    this.inputs = [...this.io.readInputs()];
    this.mcStack = [];
    this.poweredCells.clear();
    this.scanTrace = [];
    // ② ネットワークを上から順に実行
    for (const net of this.program.networks) {
      if (net.isEnd) break;
      this.runNetwork(net);
    }
    // ③ 出力書込
    this.io.writeOutputs([...this.outputs]);
    this.scans += 1;
    this.elapsedMs += this.scanMs;
    this.firstScan = false;
  }

  /** MC区間が成立しているか（入れ子はすべて成立していなければならない）。 */
  private get mcActive(): boolean {
    return this.mcStack.every((on) => on);
  }

  private runNetwork(net: CompiledNetwork): void {
    const rails = this.solve(net);
    this.recordPoweredCells(net, rails);
    const trace: PlcNetworkTrace | undefined = this.recordPowered
      ? { networkId: net.id, writes: [] }
      : undefined;
    for (const output of net.outputs) {
      const powered = rails.poweredAt(output.row, COIL_COL);
      const cell = output.cell;
      const before = trace !== undefined && 'device' in cell ? this.deviceValue(cell.device) : '';
      this.applyOutput(cell, powered);
      if (trace !== undefined && 'device' in cell)
        trace.writes.push({
          device: { ...cell.device },
          instruction: cell.kind === 'coil' ? cell.type : cell.kind === 'timer' ? 'TON' : 'CTU',
          powered,
          before,
          after: this.deviceValue(cell.device),
        });
    }
    if (trace !== undefined) this.scanTrace.push(trace);
  }

  /**
   * 各セルの左端が左母線と繋がっているかを記録する（Plan 3B のモニタ表示用）。
   * `poweredAt(row, col)` はセル `(row, col)` の**左側**の節点なので、コイル列
   * （`COIL_COL`）の値がそのままコイルの通電状態になる。
   *
   * `solve()` は各行の0列目を無条件に左母線と結線する（実配線どおり）が、
   * 何も置かれていない空行（分岐の飾りのない行）の0列目まで通電と表示すると、
   * モニタに繋がっていない青い節が浮いて見える（KNOWN QUIRK）。そこで表示上だけ、
   * 0列目が空セルのときは `false` を記録する。導通計算（`solve()`）自体は変えない。
   *
   * モニタを開いていないときは**何も記録しない**（`recordPowered`。指摘 DW-1 ≡ LE-11 ①）。
   * ここで作るキーは表示専用で、出力・タイマ・カウンタの計算には一切使わない。
   */
  private recordPoweredCells(net: CompiledNetwork, rails: Rails): void {
    if (!this.recordPowered) return;
    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < net.cols; col += 1) {
        const cell = net.cells[row]?.[col];
        const powered = col === 0 && cell?.kind === 'empty' ? false : rails.poweredAt(row, col);
        this.poweredCells.set(`${net.id}:${row}:${col}`, powered);
      }
    }
  }

  /** グリッドの導通を解く。 */
  private solve(net: CompiledNetwork): Rails {
    const rails = new Rails(net.rows, net.cols);
    // `cellAt()` は `Network` を取るので読み取り専用のセルを読むための器を作る（書き換えない）。
    const grid: Network = {
      id: net.id,
      rows: net.rows,
      cols: net.cols,
      cells: net.cells as Cell[][],
    };
    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < net.cols; col += 1) {
        const cell = cellAt(grid, row, col);
        if (cell.kind === 'contact') {
          if (this.conducts(net.id, row, col, cell.type, cell.device)) {
            rails.union(rails.node(row, col), rails.node(row, col + 1));
          }
        } else if (cell.kind === 'hline') {
          rails.union(rails.node(row, col), rails.node(row, col + 1));
        } else if (cell.kind === 'vline') {
          rails.union(rails.node(row, col), rails.node(row, col + 1));
          if (row + 1 < net.rows) rails.union(rails.node(row, col), rails.node(row + 1, col));
        }
      }
    }
    return rails;
  }

  /** 接点が導通しているか。微分接点はセル位置ごとに前回値を持つ。 */
  private conducts(
    networkId: string,
    row: number,
    col: number,
    type: 'NO' | 'NC' | 'P' | 'F',
    device: Device,
  ): boolean {
    const now = this.bit(device);
    if (type === 'NO') return now;
    if (type === 'NC') return !now;
    const key = `${networkId}:${row}:${col}`;
    const prev = this.edges.get(key) ?? false;
    this.edges.set(key, now);
    return type === 'P' ? now && !prev : !now && prev;
  }

  private applyOutput(cell: OutputCell, powered: boolean): void {
    if (cell.kind === 'mc') {
      // 入れ子のMCは外側が非成立ならまとめて非成立にする
      this.mcStack.push(this.mcActive && powered);
      return;
    }
    if (cell.kind === 'mcr') {
      this.mcStack.pop();
      return;
    }
    const active = this.mcActive;
    if (cell.kind === 'coil') {
      if (cell.type === 'OUT') this.writeBit(cell.device, active && powered);
      else if (active && powered) this.setOrReset(cell.device, cell.type === 'SET');
      return;
    }
    if (cell.kind === 'timer') {
      const state = this.timerState(cell.device.index);
      if (!active || !powered) {
        this.resetReason(cell.device, active ? 'タイマの入力条件OFF' : 'MC区間が不成立');
        state.elapsedMs = 0;
        state.on = false;
        return;
      }
      state.elapsedMs += this.scanMs;
      if (state.elapsedMs >= cell.presetMs) state.on = true;
      return;
    }
    // カウンタ: リセットが優先、条件の立上りで加算。§10.4
    const state = this.counterState(cell.device.index);
    if (this.bit(cell.resetDevice)) {
      this.resetReason(cell.device, 'カウンタのリセット接点ON');
      state.value = 0;
      state.on = false;
      this.countEdges.set(cell.device.index, powered);
      return;
    }
    if (!active) return;
    const prev = this.countEdges.get(cell.device.index) ?? false;
    this.countEdges.set(cell.device.index, powered);
    if (powered && !prev) {
      state.value += 1;
      if (state.value >= cell.preset) state.on = true;
    }
  }

  /** OUTコイルの書込（入力・特殊デバイスへの書込は無視する）。 */
  private writeBit(device: Device, value: boolean): void {
    if (device.kind === 'output') this.outputs[device.index] = value;
    else if (device.kind === 'internal') this.internals.set(device.index, value);
  }

  /** SET/RST（タイマ・カウンタへの RST は経過・計数も戻す）。 */
  private setOrReset(device: Device, on: boolean): void {
    if (!on && (device.kind === 'timer' || device.kind === 'counter'))
      this.resetReason(device, 'RST命令が成立');
    if (device.kind === 'timer') {
      const state = this.timerState(device.index);
      state.on = on;
      if (!on) state.elapsedMs = 0;
      return;
    }
    if (device.kind === 'counter') {
      const state = this.counterState(device.index);
      state.on = on;
      if (!on) state.value = 0;
      return;
    }
    this.writeBit(device, on);
  }

  private timerState(index: number): PlcTimerState {
    const found = this.timers.get(index);
    if (found !== undefined) return found;
    const created: PlcTimerState = { elapsedMs: 0, on: false };
    this.timers.set(index, created);
    return created;
  }

  private counterState(index: number): PlcCounterState {
    const found = this.counters.get(index);
    if (found !== undefined) return found;
    const created: PlcCounterState = { value: 0, on: false };
    this.counters.set(index, created);
    return created;
  }
}

/** PLCランタイムを作る。§10.4 */
export function createPlcRuntime(program: CompiledProgram, options: PlcRuntimeOptions): PlcRuntime {
  return new Runtime(program, options.io, options);
}
