/**
 * ラダーIR（中間表現）。設計仕様 §10.3。
 *
 * ベンダー中立のデータモデルであり、8進・16進といったデバイス表記も、命令語も、
 * 表示上の列数も持たない（それらは `@ojt/plc-dialects` の責務。§10.5）。
 * IRは常に `IR_COLS`（16列）で、最終列 `COIL_COL` がコイル列である。スキンが表示列数を
 * 狭めてもIRは16列のまま保持されるのでプログラムは失われない（§10.3）。
 */

/** IRの列数（最終列がコイル列）。§10.3 */
export const IR_COLS = 16;

/** コイル列の列番号（0起点）。§10.3 */
export const COIL_COL = IR_COLS - 1;

/** 1ネットワークの最大行数（本アプリ既定）。 */
export const MAX_ROWS = 12;

/** 常時ONの特殊デバイス番号（三菱の M8000 相当）。§10.3 */
export const SPECIAL_ALWAYS_ON = 0;
/** 初期パルスの特殊デバイス番号（M8002 相当）。§10.3 */
export const SPECIAL_FIRST_SCAN = 1;
/** 1秒クロックの特殊デバイス番号（M8013 相当）。§10.3 */
export const SPECIAL_CLOCK_1S = 2;
/** 常時OFF。既存作業ファイルの番号0〜2を変更せず追加する。 */
export const SPECIAL_ALWAYS_OFF = 3;

/** 特殊デバイス番号の一覧（この4つ以外は使わない）。§10.3 */
export const SPECIAL_INDEXES: readonly number[] = [
  SPECIAL_ALWAYS_ON,
  SPECIAL_FIRST_SCAN,
  SPECIAL_CLOCK_1S,
  SPECIAL_ALWAYS_OFF,
];

/** IRの組み立てに失敗したときに投げる。 */
export class LadderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LadderError';
  }
}

/** デバイス種別。§10.3 */
export type DeviceKind = 'input' | 'output' | 'internal' | 'timer' | 'counter' | 'special';

/** デバイス（種別＋0起点の通し番号）。§10.3 */
export interface Device {
  kind: DeviceKind;
  index: number;
}

/** 接点種別。NO=a接点、NC=b接点、P=立上り、F=立下り。§10.3 */
export type ContactType = 'NO' | 'NC' | 'P' | 'F';

/** コイル種別。§10.3 */
export type CoilType = 'OUT' | 'SET' | 'RST';

/** JW-300SPの記号先行入力。アドレス未入力の記号も編集・保存・取消できる。 */
export const DRAFT_SYMBOLS = [
  'NO',
  'NC',
  'P',
  'F',
  'OUT',
  'SET',
  'RST',
  'TON',
  'CTU',
  'MC',
  'MCR',
] as const;
export type DraftSymbol = (typeof DRAFT_SYMBOLS)[number];
export function isDraftOutput(symbol: DraftSymbol): boolean {
  return !(['NO', 'NC', 'P', 'F'] as readonly string[]).includes(symbol);
}

/** セル。§10.3 */
export type Cell =
  | { kind: 'contact'; type: ContactType; device: Device }
  | { kind: 'coil'; type: CoilType; device: Device }
  | { kind: 'timer'; type: 'TON'; device: Device; presetMs: number }
  | { kind: 'counter'; type: 'CTU'; device: Device; preset: number; resetDevice: Device }
  | { kind: 'mc'; device: Device }
  | { kind: 'mcr'; device: Device }
  | { kind: 'end' }
  | { kind: 'hline' }
  | { kind: 'vline' }
  | { kind: 'empty' }
  | { kind: 'draft'; symbol: DraftSymbol };

/** 出力位置に置くセル（コイル列に置く）。 */
export type OutputCell = Extract<Cell, { kind: 'coil' | 'timer' | 'counter' | 'mc' | 'mcr' }>;

/** ネットワーク（セルグリッド）。§10.3 */
export interface Network {
  id: string;
  comment?: string;
  rows: number;
  cols: number;
  cells: Cell[][];
}

/** ラダープログラム（ネットワークの列）。§10.3 */
export interface LadderProgram {
  networks: Network[];
}

/** デバイス種別 → ベンダー中立の接頭辞。 */
export const DEVICE_PREFIX: Readonly<Record<DeviceKind, string>> = {
  input: 'X',
  output: 'Y',
  internal: 'M',
  timer: 'T',
  counter: 'C',
  special: 'SP',
};

/** デバイスを作る。番号は0以上の整数、特殊デバイスは `SPECIAL_INDEXES` の4つだけ。 */
export function device(kind: DeviceKind, index: number): Device {
  if (!Number.isInteger(index) || index < 0) {
    throw new LadderError(`デバイス番号は0以上の整数です: ${DEVICE_PREFIX[kind]}${index}`);
  }
  if (kind === 'special' && !SPECIAL_INDEXES.includes(index)) {
    throw new LadderError(`特殊デバイスは SP0／SP1／SP2／SP3 のみです: SP${index}`);
  }
  return { kind, index };
}

/** 入力デバイス（Xn 相当）。 */
export function X(index: number): Device {
  return device('input', index);
}
/** 出力デバイス（Yn 相当）。 */
export function Y(index: number): Device {
  return device('output', index);
}
/** 内部リレー（Mn 相当）。 */
export function M(index: number): Device {
  return device('internal', index);
}
/** タイマ（Tn 相当）。 */
export function T(index: number): Device {
  return device('timer', index);
}
/** カウンタ（Cn 相当）。 */
export function C(index: number): Device {
  return device('counter', index);
}
/** 特殊デバイス（常時ON／初期パルス／1秒クロック）。 */
export function SP(index: number): Device {
  return device('special', index);
}

/** ベンダー中立のデバイス表記（`X0` / `T1` / `SP2`）。方言表記は `DialectProfile.formatDevice()`。 */
export function deviceLabel(d: Device): string {
  return `${DEVICE_PREFIX[d.kind]}${d.index}`;
}

/** Map のキーに使えるデバイス識別子。 */
export function deviceKey(d: Device): string {
  return `${d.kind}:${d.index}`;
}

/** 同じデバイスか。 */
export function sameDevice(a: Device, b: Device): boolean {
  return a.kind === b.kind && a.index === b.index;
}

/** a接点。 */
export function no(d: Device): Cell {
  return { kind: 'contact', type: 'NO', device: d };
}
/** b接点。 */
export function nc(d: Device): Cell {
  return { kind: 'contact', type: 'NC', device: d };
}
/** 立上り微分接点。 */
export function rise(d: Device): Cell {
  return { kind: 'contact', type: 'P', device: d };
}
/** 立下り微分接点。 */
export function fall(d: Device): Cell {
  return { kind: 'contact', type: 'F', device: d };
}
/** OUTコイル。 */
export function out(d: Device): Cell {
  return { kind: 'coil', type: 'OUT', device: d };
}
/** SETコイル（保持）。 */
export function set(d: Device): Cell {
  return { kind: 'coil', type: 'SET', device: d };
}
/** RSTコイル（保持の解除）。 */
export function rst(d: Device): Cell {
  return { kind: 'coil', type: 'RST', device: d };
}
/** オンディレータイマ。設定値はmsで持つ（方言表記への変換は `timerPreset()`）。§10.3 */
export function ton(d: Device, presetMs: number): Cell {
  return { kind: 'timer', type: 'TON', device: d, presetMs };
}
/** 加算カウンタ。 */
export function ctu(d: Device, preset: number, resetDevice: Device): Cell {
  return { kind: 'counter', type: 'CTU', device: d, preset, resetDevice };
}
/** マスターコントロール開始。 */
export function mc(d: Device): Cell {
  return { kind: 'mc', device: d };
}
/** マスターコントロール終了。 */
export function mcr(d: Device): Cell {
  return { kind: 'mcr', device: d };
}
/** プログラム終端。 */
export function end(): Cell {
  return { kind: 'end' };
}
/** 横線（無条件に導通する）。 */
export function hline(): Cell {
  return { kind: 'hline' };
}
/**
 * 縦線（セルの左辺で下の行と繋ぐ渡り）。**セル自身は横線としても導通する**ので、
 * 分岐は「上の行の分岐点に `vline`、下の行は分岐接点だけ」と書く。§10.3
 */
export function vline(): Cell {
  return { kind: 'vline' };
}
/** 空セル。 */
export function empty(): Cell {
  return { kind: 'empty' };
}

/** セルが出力位置（コイル列）に置くものか。 */
export function isOutputCell(cell: Cell): cell is OutputCell {
  return (
    cell.kind === 'coil' ||
    cell.kind === 'timer' ||
    cell.kind === 'counter' ||
    cell.kind === 'mc' ||
    cell.kind === 'mcr'
  );
}

/** ネットワーク生成オプション。 */
export interface NetworkOptions {
  comment?: string;
}

/**
 * ネットワークを作る。各行は `IR_COLS` まで空セルで詰める。§10.3
 * 行数は1以上 `MAX_ROWS` 以下、1行の長さは `IR_COLS` 以下でなければならない。
 */
export function network(
  id: string,
  rows: readonly (readonly Cell[])[],
  options: NetworkOptions = {},
): Network {
  if (id.length === 0) throw new LadderError('ネットワークIDが空です');
  if (rows.length === 0) throw new LadderError(`ネットワーク ${id} に行がありません`);
  if (rows.length > MAX_ROWS) {
    throw new LadderError(`ネットワーク ${id} の行数が上限（${MAX_ROWS}）を超えています`);
  }
  const cells: Cell[][] = rows.map((row) => {
    if (row.length > IR_COLS) {
      throw new LadderError(`ネットワーク ${id} の列数が上限（${IR_COLS}）を超えています`);
    }
    const padded: Cell[] = [...row];
    while (padded.length < IR_COLS) padded.push(empty());
    return padded;
  });
  return {
    id,
    ...(options.comment === undefined ? {} : { comment: options.comment }),
    rows: cells.length,
    cols: IR_COLS,
    cells,
  };
}

/** END だけのネットワークを作る。§10.3 */
export function endNetwork(id = 'end'): Network {
  return network(id, [[end()]]);
}

/** セルを読む。グリッドの外はエラー（`noUncheckedIndexedAccess` の undefined をここで潰す）。 */
export function cellAt(net: Network, row: number, col: number): Cell {
  const cell = net.cells[row]?.[col];
  if (cell === undefined) {
    throw new LadderError(`ネットワーク ${net.id} の範囲外です: (${row}, ${col})`);
  }
  return cell;
}

/** プログラムを作る。ネットワークIDは重複してはならない。 */
export function program(...networks: Network[]): LadderProgram {
  const seen = new Set<string>();
  for (const net of networks) {
    if (seen.has(net.id)) throw new LadderError(`ネットワークIDが重複しています: ${net.id}`);
    seen.add(net.id);
  }
  return { networks: [...networks] };
}
