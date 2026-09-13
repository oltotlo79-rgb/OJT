import { contactOhms, loadOhms, type SourceElement } from './elements.js';
import type { TerminalId } from './ids.js';
import { allElements, type Nets, type Netlist } from './netlist.js';

/** 全節点に入れる対地漏れコンダクタンス[S]。特異行列を避ける。§5.2 */
export const LEAK_SIEMENS = 1e-9;
/** 想定する節点数の上限。§5.2 */
export const MAX_NODES = 200;
/** ピボットがこの値未満なら特異とみなす。 */
const PIVOT_EPSILON = 1e-18;

/** 数値配列の安全な添字読み（noUncheckedIndexedAccess 対策をここ1か所に閉じ込める）。 */
function at(values: ArrayLike<number>, index: number): number {
  return values[index] ?? 0;
}

/** 1tickぶんの解。 */
export interface SolveResult {
  /** 節点電位[V]。添字は Nets.nodeOf() の返す節点番号。 */
  nodeVoltages: number[];
  /** 要素ID → 要素電圧[V]（V(from) − V(to)）。 */
  elementVolts: Map<string, number>;
  /** 要素ID → 要素電流[A]（from → to を正）。 */
  elementAmps: Map<string, number>;
  /** 通電中の全電源要素の出力電流の合計[A]。§5.1.1 の保護判定に使う。 */
  sourceAmps: number;
  /** 基準（0V）にした節点番号。 */
  referenceNode: number;
}

/** 密行列。noUncheckedIndexedAccess 下でも安全に読み書きするための薄いラッパ。 */
class Matrix {
  private readonly cells: Float64Array;

  constructor(readonly size: number) {
    this.cells = new Float64Array(size * size);
  }

  get(row: number, col: number): number {
    return this.cells[row * this.size + col] ?? 0;
  }

  set(row: number, col: number, value: number): void {
    this.cells[row * this.size + col] = value;
  }

  add(row: number, col: number, value: number): void {
    this.set(row, col, this.get(row, col) + value);
  }

  /* v8 ignore start -- 対称・優対角な行列では行交換が起きないため到達しない防御コード */
  swapRows(a: number, b: number): void {
    for (let c = 0; c < this.size; c += 1) {
      const tmp = this.get(a, c);
      this.set(a, c, this.get(b, c));
      this.set(b, c, tmp);
    }
  }
  /* v8 ignore stop */
}

/** ガウス消去（部分ピボット選択）。特異な列は解を0として続行する。 */
function gaussSolve(a: Matrix, b: Float64Array): Float64Array {
  const n = a.size;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a.get(row, col)) > Math.abs(a.get(pivot, col))) pivot = row;
    }
    /* v8 ignore start -- 全節点に漏れコンダクタンスを入れるため特異・行交換は起きない */
    if (Math.abs(a.get(pivot, col)) < PIVOT_EPSILON) continue;
    if (pivot !== col) {
      a.swapRows(pivot, col);
      const tmp = at(b, pivot);
      b[pivot] = at(b, col);
      b[col] = tmp;
    }
    /* v8 ignore stop */
    const head = a.get(col, col);
    for (let row = col + 1; row < n; row += 1) {
      const factor = a.get(row, col) / head;
      if (factor === 0) continue;
      for (let c = col; c < n; c += 1) a.add(row, c, -factor * a.get(col, c));
      b[row] = at(b, row) - factor * at(b, col);
    }
  }

  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row -= 1) {
    const head = a.get(row, row);
    /* v8 ignore next 4 -- 同上 */
    if (Math.abs(head) < PIVOT_EPSILON) {
      x[row] = 0;
      continue;
    }
    let sum = at(b, row);
    for (let col = row + 1; col < n; col += 1) sum -= a.get(row, col) * at(x, col);
    x[row] = sum / head;
  }
  return x;
}

/** 基準にする節点を選ぶ。通電中の電源のN側 → 最初の電源のN側 → 節点0。 */
function pickReference(netlist: Netlist, nets: Nets, override?: TerminalId): number {
  if (override !== undefined && nets.hasTerminal(override)) return nets.nodeOf(override);
  let firstSource: SourceElement | undefined;
  for (const el of allElements(netlist)) {
    if (el.kind !== 'source') continue;
    firstSource ??= el;
    if (el.enabled) return nets.nodeOf(el.to);
  }
  if (firstSource !== undefined) return nets.nodeOf(firstSource.to);
  return 0;
}

/** 解くときのオプション。 */
export interface SolveOptions {
  /** 0Vの基準にする端子。省略時は電源のN側。 */
  reference?: TerminalId;
}

/**
 * 節点解析（抵抗回路）。§5.2
 * 基準節点を0Vとして消去し、電源は内部抵抗0.1Ωのノートン等価として行列に加える。
 */
export function solve(netlist: Netlist, nets: Nets, options: SolveOptions = {}): SolveResult {
  const n = nets.nodeCount;
  const reference = n === 0 ? 0 : pickReference(netlist, nets, options.reference);
  const elements = allElements(netlist);

  const full = new Matrix(n);
  const inject = new Float64Array(n);
  for (let i = 0; i < n; i += 1) full.add(i, i, LEAK_SIEMENS);

  const stampConductance = (from: number, to: number, g: number): void => {
    if (from === to) return;
    full.add(from, from, g);
    full.add(to, to, g);
    full.add(from, to, -g);
    full.add(to, from, -g);
  };

  for (const el of elements) {
    if (el.kind === 'link') continue; // リンクは buildNets で節点併合済み
    const from = nets.nodeOf(el.from);
    const to = nets.nodeOf(el.to);
    if (el.kind === 'source') {
      if (!el.enabled) continue;
      const g = 1 / el.internalOhms;
      stampConductance(from, to, g);
      inject[from] = at(inject, from) + g * el.volts;
      inject[to] = at(inject, to) - g * el.volts;
    } else if (el.kind === 'contact') {
      const ohms = contactOhms(el);
      if (ohms === undefined) continue;
      stampConductance(from, to, 1 / ohms);
    } else {
      const ohms = loadOhms(el);
      if (ohms === undefined) continue;
      stampConductance(from, to, 1 / ohms);
    }
  }

  // 基準節点の行・列を消去した縮約系を解く
  const nodeOfRow: number[] = [];
  for (let i = 0; i < n; i += 1) if (i !== reference) nodeOfRow.push(i);
  const m = nodeOfRow.length;
  const a = new Matrix(m);
  const b = new Float64Array(m);
  for (let r = 0; r < m; r += 1) {
    const nodeR = at(nodeOfRow, r);
    b[r] = at(inject, nodeR);
    for (let c = 0; c < m; c += 1) {
      const nodeC = at(nodeOfRow, c);
      a.set(r, c, full.get(nodeR, nodeC));
    }
  }
  const solved = gaussSolve(a, b);

  const nodeVoltages = new Array<number>(n).fill(0);
  for (let r = 0; r < m; r += 1) {
    nodeVoltages[at(nodeOfRow, r)] = at(solved, r);
  }

  const elementVolts = new Map<string, number>();
  const elementAmps = new Map<string, number>();
  let sourceAmps = 0;
  for (const el of elements) {
    const volts = at(nodeVoltages, nets.nodeOf(el.from)) - at(nodeVoltages, nets.nodeOf(el.to));
    elementVolts.set(el.id, volts);
    let amps = 0;
    if (el.kind === 'source') {
      amps = el.enabled ? (el.volts - volts) / el.internalOhms : 0;
      sourceAmps += amps;
    } else if (el.kind === 'contact') {
      const ohms = contactOhms(el);
      amps = ohms === undefined ? 0 : volts / ohms;
    } else if (el.kind === 'load') {
      const ohms = loadOhms(el);
      amps = ohms === undefined ? 0 : volts / ohms;
    }
    elementAmps.set(el.id, amps);
  }

  return { nodeVoltages, elementVolts, elementAmps, sourceAmps, referenceNode: reference };
}

/** 指定端子の節点電位[V]。ネットリストに無い端子は 0 を返す。 */
export function voltageAt(result: SolveResult, nets: Nets, terminal: TerminalId): number {
  if (!nets.hasTerminal(terminal)) return 0;
  return at(result.nodeVoltages, nets.nodeOf(terminal));
}
