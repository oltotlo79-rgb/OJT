import {
  COIL_COL,
  compile,
  IR_COLS,
  SPECIAL_ALWAYS_ON,
  type Cell,
  type CompiledNetwork,
  type ContactType,
  type Device,
  type LadderProgram,
  type OutputCell,
} from '@ojt/ladder-core';
import type { DialectError, DialectProfile, InstructionKey } from './profile.js';

/**
 * 命令語リストのエクスポート。設計仕様 §10.7。
 *
 * グリッドを「節点と枝」のグラフに直し、直並列簡約で1つの式にしてから方言の命令語へ展開する
 * （決定表#7）。方言に依るのは命令名・デバイス表記・設定値表記の3つだけで、
 * 分解の手順は方言に依らない。
 *
 * **方言バリデータは走らせない**（`convert()` の仕事。§10.6）。ここが返すのは
 * 「リストにできなかった」種類の指摘だけである。
 */

/** 命令語リスト1行。 */
export interface InstructionLine {
  /** 0起点の行番号（PLC実機のステップ番号／アドレスとは対応しない。命令語リスト内の通し行番号）。 */
  step: number;
  mnemonic: string;
  /** デバイスや設定値（無ければ空文字）。 */
  operand: string;
  networkId: string;
}

/** エクスポートの結果。 */
export interface InstructionListResult {
  lines: readonly InstructionLine[];
  /** UTF-8・CRLF のテキスト（§10.7）。 */
  text: string;
  errors: readonly DialectError[];
}

/** 命令語リスト固有の指摘の文言。`DialectProfile.errorMessages` には入れない（決定表#8）。 */
export const INSTRUCTION_LIST_MESSAGES: Readonly<Record<string, string>> = {
  'compile-failed': 'ラダーを変換できないため命令語リストを作れません',
  'not-series-parallel': '直列・並列に分解できない回路です（命令語リストにできません）',
  'coil-unconnected': 'コイルが左母線に繋がっていません',
  'preset-unavailable': 'この機種で表せない設定値です（`?` で書き出しました）',
};

/** 接点セル。 */
type ContactCell = Extract<Cell, { kind: 'contact' }>;

/**
 * 直並列に分解した条件。接点はグリッド上の位置を持つ（並べ替えを決定論にするため）。
 * 渡り（条件の無い枝）は節点の併合で消えるので、ここには現れない。
 */
type Term =
  | { kind: 'contact'; cell: ContactCell; row: number; col: number }
  | { kind: 'and'; parts: readonly Term[] }
  | { kind: 'or'; parts: readonly Term[] };

/** 回路の条件。接点を1つも通らずに左母線へ届く回路は `wire`（＝常時ON）。 */
type Expr = Term | { kind: 'wire' };

/** 式が含む接点のうち、いちばん上・いちばん左の位置。 */
function span(term: Term): { row: number; col: number } {
  if (term.kind === 'contact') return { row: term.row, col: term.col };
  let row = Number.MAX_SAFE_INTEGER;
  let col = Number.MAX_SAFE_INTEGER;
  for (const part of term.parts) {
    const at = span(part);
    row = Math.min(row, at.row);
    col = Math.min(col, at.col);
  }
  return { row, col };
}

/** 同じ繋ぎ方の入れ子を平らにする（`AND(AND(a,b),c)` → `AND(a,b,c)`）。 */
function flatten(kind: 'and' | 'or', parts: readonly Term[]): Term[] {
  const flat: Term[] = [];
  for (const part of parts) {
    if (part.kind === kind) flat.push(...part.parts);
    else flat.push(part);
  }
  return flat;
}

/**
 * 直列に繋ぐ。**列（左→右）の順に並べ替える**ので、簡約が枝をどちら向きに辿っても
 * 同じ並びになる。
 */
function andOf(parts: readonly Term[]): Term {
  const flat = flatten('and', parts);
  flat.sort((a, b) => {
    const left = span(a);
    const right = span(b);
    return left.col - right.col || left.row - right.row;
  });
  return { kind: 'and', parts: flat };
}

/** 並列に繋ぐ。**行（上→下）の順に並べ替える**。 */
function orOf(parts: readonly Term[]): Term {
  const flat = flatten('or', parts);
  flat.sort((a, b) => {
    const left = span(a);
    const right = span(b);
    return left.row - right.row || left.col - right.col;
  });
  return { kind: 'or', parts: flat };
}

/** 式の同一性を見るためのキー（同じ条件の複数出力をまとめるのに使う）。 */
function exprKey(expr: Expr): string {
  if (expr.kind === 'wire') return 'w';
  if (expr.kind === 'contact') {
    return `c:${expr.cell.type}:${expr.cell.device.kind}:${expr.cell.device.index}`;
  }
  return `${expr.kind}(${expr.parts.map(exprKey).join(',')})`;
}

/** グリッドを写した枝。`term` が `undefined` の枝は渡り（条件の無い短絡）。 */
interface RawEdge {
  a: number;
  b: number;
  term: Term | undefined;
}

/** 簡約中の枝（渡りは節点の併合で消えているので必ず条件を持つ）。 */
interface Edge {
  a: number;
  b: number;
  expr: Term;
}

/** 左母線の節点番号（各行の0列目はここへまとめる。§10.4 の `solve()` と同じ結線）。 */
const LEFT_RAIL = -1;

/** 節点番号。0列目はすべて左母線。 */
function nodeId(row: number, col: number): number {
  return col === 0 ? LEFT_RAIL : row * (IR_COLS + 1) + col;
}

/** ネットワークのグリッドを枝の集まりに直す。 */
function buildEdges(net: CompiledNetwork): RawEdge[] {
  const edges: RawEdge[] = [];
  for (const [row, cells] of net.cells.entries()) {
    for (const [col, cell] of cells.entries()) {
      if (col >= COIL_COL) break;
      if (cell.kind === 'contact') {
        edges.push({
          a: nodeId(row, col),
          b: nodeId(row, col + 1),
          term: { kind: 'contact', cell, row, col },
        });
      } else if (cell.kind === 'hline' || cell.kind === 'vline') {
        edges.push({ a: nodeId(row, col), b: nodeId(row, col + 1), term: undefined });
      }
      if (cell.kind === 'vline' && row + 1 < net.rows) {
        edges.push({ a: nodeId(row, col), b: nodeId(row + 1, col), term: undefined });
      }
    }
  }
  return edges.filter((edge) => edge.a !== edge.b);
}

/** 渡りで結ばれた節点をまとめる器。番号の小さいほう（＝左母線）を根にする。 */
class NodeMerge {
  private readonly parent = new Map<number, number>();

  find(node: number): number {
    let root = node;
    for (let up = this.parent.get(root); up !== undefined; up = this.parent.get(root)) {
      root = up;
    }
    return root;
  }

  union(a: number, b: number): void {
    const left = this.find(a);
    const right = this.find(b);
    if (left === right) return;
    this.parent.set(Math.max(left, right), Math.min(left, right));
  }
}

/**
 * 渡り（条件の無い枝）の両端を1つの節点にまとめる。渡りは抵抗の無い配線なので、結んだ2点は
 * 実機でも同じ節点である（ランタイムの `solve()` が `union()` するのと同じ扱い）。
 *
 * これをしないと、中央の縦線で2つの並列群を繋いだ**ごく普通のラダー**
 * （`(X0 OR X2) AND (X1 OR X3)`）が「どの節点も次数3」のブリッジ回路に見えてしまい、
 * 直並列に分解できないものとして扱われてしまう。
 */
function contractWires(
  source: readonly RawEdge[],
  sinkNode: number,
): { edges: Edge[]; sink: number } {
  const merge = new NodeMerge();
  for (const edge of source) {
    if (edge.term === undefined) merge.union(edge.a, edge.b);
  }
  const edges: Edge[] = [];
  for (const edge of source) {
    const term = edge.term;
    if (term === undefined) continue;
    const a = merge.find(edge.a);
    const b = merge.find(edge.b);
    if (a !== b) edges.push({ a, b, expr: term });
  }
  return { edges, sink: merge.find(sinkNode) };
}

/** 同じ2点を結ぶ枝をまとめる。まとめたら true。 */
function reduceParallel(edges: readonly Edge[]): { edges: Edge[]; changed: boolean } {
  const groups = new Map<string, { a: number; b: number; head: Term; tail: Term[] }>();
  for (const edge of edges) {
    const key = edge.a < edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { a: edge.a, b: edge.b, head: edge.expr, tail: [] });
    else group.tail.push(edge.expr);
  }
  const next: Edge[] = [];
  let changed = false;
  for (const group of groups.values()) {
    if (group.tail.length === 0) {
      next.push({ a: group.a, b: group.b, expr: group.head });
      continue;
    }
    changed = true;
    // `orOf()` が行順に並べ替えるので、枝をどちら向きに辿っても同じ並びになる
    next.push({ a: group.a, b: group.b, expr: orOf([group.head, ...group.tail]) });
  }
  return { edges: next, changed };
}

/** 節点に繋がる枝（3本目からは本数だけ数える）。 */
interface Incidence {
  first: Edge;
  second: Edge;
  count: number;
}

/** 端点でない次数2の節点を潰す（行き止まりの枝は落とす）。潰したら true。 */
function reduceSeries(edges: readonly Edge[], sink: number): { edges: Edge[]; changed: boolean } {
  const incident = new Map<number, Incidence>();
  for (const edge of edges) {
    for (const node of [edge.a, edge.b]) {
      const found = incident.get(node);
      if (found === undefined) {
        incident.set(node, { first: edge, second: edge, count: 1 });
        continue;
      }
      found.count += 1;
      if (found.count === 2) found.second = edge;
    }
  }
  for (const [node, at] of incident) {
    if (node === LEFT_RAIL || node === sink) continue;
    if (at.count === 1) {
      // 行き止まり（分岐を描いたが繋がっていない枝）。落としても導通は変わらない
      return { edges: edges.filter((edge) => edge !== at.first), changed: true };
    }
    if (at.count !== 2) continue;
    // `andOf()` が列順に並べ替えるので、枝の向きは端点の付け替えだけ気にすればよい。
    // 直前に必ず `reduceParallel()` を通しているので、同じ2点を結ぶ枝は既に1本にまとまっており
    // `leftEnd === rightEnd`（＝両端が同じ節点）にはならない
    const leftEnd = at.first.a === node ? at.first.b : at.first.a;
    const rightEnd = at.second.a === node ? at.second.b : at.second.a;
    const rest = edges.filter((edge) => edge !== at.first && edge !== at.second);
    rest.push({ a: leftEnd, b: rightEnd, expr: andOf([at.first.expr, at.second.expr]) });
    return { edges: rest, changed: true };
  }
  return { edges: [...edges], changed: false };
}

/**
 * 接点の開閉を考えず、枝を辿るだけで左母線から終点に届くか（＝すべての接点を閉じても
 * コイルが左母線に繋がらない「浮いたコイル」かどうか）。§10.7 決定表#7 I3
 */
function reachesSink(edges: readonly Edge[], sink: number): boolean {
  const adjacent = new Map<number, number[]>();
  const link = (from: number, to: number): void => {
    const found = adjacent.get(from);
    if (found === undefined) adjacent.set(from, [to]);
    else found.push(to);
  };
  for (const edge of edges) {
    link(edge.a, edge.b);
    link(edge.b, edge.a);
  }
  const seen = new Set<number>([LEFT_RAIL]);
  const stack = [LEFT_RAIL];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    for (const next of adjacent.get(node) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen.has(sink);
}

/**
 * 直並列の簡約に失敗した理由。`unconnected` は接点をすべて閉じても左母線に届かない
 * （配線忘れ）、`not-series-parallel` は届くが直並列には分解できない（ブリッジ回路）。§10.7 I3
 */
type ReduceFailure = 'unconnected' | 'not-series-parallel';

/** 直並列の簡約結果。 */
type ReduceOutcome = { ok: true; expr: Expr } | { ok: false; reason: ReduceFailure };

/** 左母線 → 終点 の式にまとめる。分解できなければ理由つきで失敗を返す。 */
function reduceToExpr(source: readonly RawEdge[], sinkNode: number): ReduceOutcome {
  const contracted = contractWires(source, sinkNode);
  const sink = contracted.sink;
  // 接点を1つも通らずに左母線へ届く（接点の無い行）。実機では「常時ON」を読む
  if (sink === LEFT_RAIL) return { ok: true, expr: { kind: 'wire' } };
  let edges = contracted.edges;
  if (!reachesSink(edges, sink)) return { ok: false, reason: 'unconnected' };
  for (;;) {
    const parallel = reduceParallel(edges);
    edges = parallel.edges;
    const series = reduceSeries(edges, sink);
    edges = series.edges;
    if (!parallel.changed && !series.changed) break;
  }
  const [only] = edges;
  if (edges.length !== 1 || only === undefined) return { ok: false, reason: 'not-series-parallel' };
  return { ok: true, expr: only.expr };
}

/** 接点の置かれた位置 → 命令語キー。§10.5 */
const CONTACT_KEYS: Readonly<
  Record<'ld' | 'and' | 'or', Readonly<Record<ContactType, InstructionKey>>>
> = {
  ld: { NO: 'ld', NC: 'ldi', P: 'ldp', F: 'ldf' },
  and: { NO: 'and', NC: 'ani', P: 'andp', F: 'andf' },
  or: { NO: 'or', NC: 'ori', P: 'orp', F: 'orf' },
};

/** 組み立て中の1行。 */
interface Emit {
  mnemonic: string;
  operand: string;
}

/** 接点1つを命令語にする。 */
function contactEmit(cell: ContactCell, at: 'ld' | 'and' | 'or', profile: DialectProfile): Emit {
  const key = CONTACT_KEYS[at][cell.type];
  return { mnemonic: profile.instructionNames[key], operand: profile.formatDevice(cell.device) };
}

/** 条件を1つのブロックとして展開する（先頭は必ず `ld` 系）。 */
function emitTerm(term: Term, profile: DialectProfile, out: Emit[]): void {
  if (term.kind === 'contact') {
    out.push(contactEmit(term.cell, 'ld', profile));
    return;
  }
  const at = term.kind === 'and' ? 'and' : 'or';
  const blockKey: InstructionKey = term.kind === 'and' ? 'andBlock' : 'orBlock';
  term.parts.forEach((part, index) => {
    if (index === 0) {
      emitTerm(part, profile, out);
      return;
    }
    if (part.kind === 'contact') {
      out.push(contactEmit(part.cell, at, profile));
      return;
    }
    // 合成式どうしの接続はブロック命令で行う（`ANB` / `ORB`）
    emitTerm(part, profile, out);
    out.push({ mnemonic: profile.instructionNames[blockKey], operand: '' });
  });
}

/**
 * 回路の条件を命令語に展開する。
 * 接点の無い回路は「常時ON」を読む。`specialInverted` に常時ONが載っている方言
 * （シャープの `007366`）は実機で**b接点**として書くので `ldi` 側を使う（4B 引き渡し H-4）。
 */
function emitBlock(expr: Expr, profile: DialectProfile, out: Emit[]): void {
  if (expr.kind === 'wire') {
    const inverted = profile.specialInverted?.includes(SPECIAL_ALWAYS_ON) ?? false;
    out.push({
      mnemonic: inverted ? profile.instructionNames.ldi : profile.instructionNames.ld,
      operand: profile.formatDevice({ kind: 'special', index: SPECIAL_ALWAYS_ON }),
    });
    return;
  }
  emitTerm(expr, profile, out);
}

/**
 * ニーモニックがデバイス接頭辞で終わる方言では番号だけを続ける。
 * 三菱の `OUT T` ＋ `T0` は `OUT T0`、OMRON の `TIM` ＋ `T0` は `TIM T0` になる。
 *
 * 実機の CX-Programmer はタイマ・カウンタを `CNT 0 #0005` のように**種別の文字を落とした番号だけ**
 * で書くが、本アプリは `parseDevice()` が文字列だけから一意に読める `CNT C0 #0005` に統一する
 * （**本アプリの表記**。§17.1 の前提方針。シャープの接頭辞つきタイマと同じ理由。意図的な差分#2）。
 */
function presetEmit(
  profile: DialectProfile,
  key: 'timer' | 'counter',
  target: Device,
  preset: string,
): Emit {
  const name = profile.instructionNames[key];
  const prefix = profile.deviceRanges[target.kind].prefix;
  const text = profile.formatDevice(target);
  if (prefix.length > 0 && name.endsWith(prefix) && text.startsWith(prefix)) {
    return { mnemonic: `${name}${text.slice(prefix.length)}`, operand: preset };
  }
  return { mnemonic: name, operand: `${text} ${preset}`.trim() };
}

/** 出力セルを命令語にする。表せない設定値は `?` にして指摘を返す。 */
function emitOutput(
  cell: OutputCell,
  profile: DialectProfile,
  networkId: string,
  out: Emit[],
  errors: DialectError[],
): void {
  if (cell.kind === 'coil') {
    const key: InstructionKey = cell.type === 'OUT' ? 'out' : cell.type === 'SET' ? 'set' : 'rst';
    out.push({
      mnemonic: profile.instructionNames[key],
      operand: profile.formatDevice(cell.device),
    });
    return;
  }
  if (cell.kind === 'mc' || cell.kind === 'mcr') {
    out.push({
      mnemonic: profile.instructionNames[cell.kind],
      operand: profile.formatDevice(cell.device),
    });
    return;
  }
  if (cell.kind === 'timer') {
    const preset = profile.timerPreset(cell.presetMs, cell.device);
    if (preset instanceof Error) {
      errors.push({
        code: 'preset-unavailable',
        message: preset.message,
        device: cell.device,
        networkId,
      });
    }
    out.push(
      presetEmit(profile, 'timer', cell.device, preset instanceof Error ? '?' : preset.text),
    );
    return;
  }
  // タイマ（`timerPreset`）と対称のチェック: 書いてから読み直し、値が違えば表せない（B2）
  const text = profile.counterPresetText?.(cell.preset) ?? String(cell.preset);
  const back = profile.parseCounterPreset?.(text);
  const unavailable = back instanceof Error || (back !== undefined && back !== cell.preset);
  if (unavailable) {
    errors.push({
      code: 'preset-unavailable',
      message: `${profile.formatDevice(cell.device)} はこの機種で表せないカウンタ設定値です: ${cell.preset}`,
      device: cell.device,
      networkId,
    });
  }
  out.push(presetEmit(profile, 'counter', cell.device, unavailable ? '?' : text));
  // リセットは実機と同じく別の回路として書く（IRはセルに resetDevice を持っている）
  out.push({
    mnemonic: profile.instructionNames.ld,
    operand: profile.formatDevice(cell.resetDevice),
  });
  out.push({
    mnemonic: profile.instructionNames.rst,
    operand: profile.formatDevice(cell.device),
  });
}

/** ネットワーク1つを命令語にする。 */
function emitNetwork(
  net: CompiledNetwork,
  profile: DialectProfile,
  out: Emit[],
  errors: DialectError[],
): void {
  if (net.isEnd) {
    out.push({ mnemonic: profile.instructionNames.end, operand: '' });
    return;
  }
  const edges = buildEdges(net);
  let previousKey = '';
  for (const output of net.outputs) {
    const outcome = reduceToExpr(edges, nodeId(output.row, COIL_COL));
    if (!outcome.ok) {
      errors.push({
        code: outcome.reason === 'unconnected' ? 'coil-unconnected' : 'not-series-parallel',
        message:
          outcome.reason === 'unconnected'
            ? `${net.id} のコイルが左母線に繋がっていません`
            : `${net.id} は直列・並列に分解できないため命令語リストにできません`,
        networkId: net.id,
        row: output.row,
        col: output.col,
      });
      continue;
    }
    const key = exprKey(outcome.expr);
    if (key !== previousKey) emitBlock(outcome.expr, profile, out);
    emitOutput(output.cell, profile, net.id, out, errors);
    previousKey = output.cell.kind === 'counter' ? '' : key;
  }
}

/** テキストへ整形する（UTF-8・CRLF。§10.7）。 */
function render(lines: readonly InstructionLine[], source: LadderProgram): string {
  const comments = new Map<string, string>(
    source.networks.map((net) => [net.id, net.comment ?? '']),
  );
  const rows: string[] = [];
  let current = '';
  for (const line of lines) {
    if (line.networkId !== current) {
      current = line.networkId;
      rows.push(`; ${current}  ${comments.get(current) ?? ''}`.trimEnd());
    }
    rows.push(
      `${String(line.step).padStart(4, '0')}  ${line.mnemonic.padEnd(10)}${line.operand}`.trimEnd(),
    );
  }
  return rows.length === 0 ? '' : `${rows.join('\r\n')}\r\n`;
}

/**
 * ラダーを方言の命令語リストへ書き出す。§10.7 / §16 Phase 4 受入基準⑥
 * 変換に落ちるラダーは行を1つも作らず `compile-failed` を返す（実機でも書き込めない）。
 */
export function instructionList(
  source: LadderProgram,
  profile: DialectProfile,
): InstructionListResult {
  const compiled = compile(source);
  if (!compiled.ok) {
    return {
      lines: [],
      text: '',
      errors: compiled.errors.map((error) => ({
        code: 'compile-failed',
        message: error.message,
        ...(error.networkId === '' ? {} : { networkId: error.networkId }),
      })),
    };
  }
  const errors: DialectError[] = [];
  const lines: InstructionLine[] = [];
  for (const net of compiled.program.networks.slice(0, compiled.program.endNetworkIndex + 1)) {
    const emits: Emit[] = [];
    emitNetwork(net, profile, emits, errors);
    for (const emit of emits) {
      lines.push({
        step: lines.length,
        mnemonic: emit.mnemonic,
        operand: emit.operand,
        networkId: net.id,
      });
    }
  }
  return { lines, text: render(lines, source), errors };
}
