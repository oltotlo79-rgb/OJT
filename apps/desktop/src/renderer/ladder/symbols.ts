/**
 * ラダー記号の線画。設計仕様 §10.6 / §17。
 *
 * `DialectProfile.symbols` が持つのは**識別子だけ**（`'contact-no'` など）で、実際の絵はここが
 * 自前の SVG パスとして持つ。**各社のロゴ・アイコン・画面キャプチャ・図記号ビットマップは
 * 一切複製しない**（§17 / PLC調査資料 §6）。JIS C 0617 のシーケンス図記号に沿った、
 * 直線と円弧だけの一般的な描き方である。
 */

/** セル1つの幅[px]。 */
export const CELL_W = 48;
/** セル1つの高さ[px]。 */
export const CELL_H = 36;
/** 桟（導線）の縦位置[px]。 */
export const WIRE_Y = CELL_H / 2;
/** 記号の左端・右端[px]（左右はリード線）。 */
const LEFT = 15;
const RIGHT = 33;
/** 接点の縦棒の上端・下端[px]。 */
const TOP = 8;
const BOTTOM = 28;

/** 記号1つの線画。 */
export interface SymbolShape {
  /** `<path d>` にそのまま入る文字列。 */
  paths: readonly string[];
  /** 記号の中に描く短い文字（`S` / `R` / `T` / `C` / `↑` / `↓` / `MC` / `MCR`）。 */
  text?: string;
}

/** 接点の2本の縦棒。 */
const CONTACT_BARS = [
  `M ${LEFT} ${TOP} L ${LEFT} ${BOTTOM}`,
  `M ${RIGHT} ${TOP} L ${RIGHT} ${BOTTOM}`,
];

/** コイルの丸括弧（左右の半円）。 */
const COIL_ARCS = [
  `M ${LEFT + 2} ${TOP} A 9 10 0 0 0 ${LEFT + 2} ${BOTTOM}`,
  `M ${RIGHT - 2} ${TOP} A 9 10 0 0 1 ${RIGHT - 2} ${BOTTOM}`,
];

/**
 * MC / MCR の識別子。**`DialectProfile.symbols`（`SymbolDrawing`）には MC / MCR が無い**ので、
 * ここだけは本アプリ側の固定の識別子を使う（`plc-dialects` は Plan 3A の所有物なので広げない）。
 * Phase 4 でプロファイルが MC / MCR を持つようになったら `symbolIdOf()` がそちらを優先すればよい。
 */
export const MC_SYMBOL_ID = 'coil-mc';
export const MCR_SYMBOL_ID = 'coil-mcr';

/** 識別子 → 線画。`DialectProfile.symbols` の値（＋ MC / MCR の固定ID）をキーにする。 */
const SHAPES: Readonly<Record<string, SymbolShape>> = {
  'contact-no': { paths: CONTACT_BARS },
  'contact-nc': { paths: [...CONTACT_BARS, `M ${LEFT} ${BOTTOM} L ${RIGHT} ${TOP}`] },
  'contact-rise': { paths: CONTACT_BARS, text: '↑' },
  'contact-fall': { paths: CONTACT_BARS, text: '↓' },
  'coil-round': { paths: COIL_ARCS },
  'coil-set': { paths: COIL_ARCS, text: 'S' },
  'coil-reset': { paths: COIL_ARCS, text: 'R' },
  'coil-timer': { paths: COIL_ARCS, text: 'T' },
  'coil-counter': { paths: COIL_ARCS, text: 'C' },
  // マスタコントロール。コイルと同じ括弧に `MC` / `MCR` の文字を入れて区別する（§10.3）
  [MC_SYMBOL_ID]: { paths: COIL_ARCS, text: 'MC' },
  [MCR_SYMBOL_ID]: { paths: COIL_ARCS, text: 'MCR' },
};

/** 未知の識別子（Phase 4 で足された記号など）に出す暫定の絵。 */
const UNKNOWN: SymbolShape = { paths: CONTACT_BARS, text: '?' };

/** 識別子から線画を引く。知らない識別子は「?」付きの接点で描く。 */
export function symbolShape(id: string): SymbolShape {
  return SHAPES[id] ?? UNKNOWN;
}

/** 左のリード線（セルの左端から記号の左端まで）。 */
export const LEAD_LEFT = `M 0 ${WIRE_Y} L ${LEFT} ${WIRE_Y}`;
/** 右のリード線（記号の右端からセルの右端まで）。 */
export const LEAD_RIGHT = `M ${RIGHT} ${WIRE_Y} L ${CELL_W} ${WIRE_Y}`;
/** セルを丸ごと横断する導線（`hline` / `vline`）。 */
export const LEAD_FULL = `M 0 ${WIRE_Y} L ${CELL_W} ${WIRE_Y}`;
/**
 * 縦線（セルの左辺で下の行と繋ぐ渡り）。§10.3
 *
 * 下端は `CELL_H` ではなく `CELL_H + WIRE_Y` にする。`vline` が繋ぐのは (row,col) → (row+1,col)
 * で、次の行の桟は `WIRE_Y` だけ下にあるため、`CELL_H` で止めると桟の手前で線が切れて見える
 * （レビュー指摘 B1。`<g>` は子を clip しないので、セルの外まで伸ばしてよい）。
 */
export const LINK_DOWN = `M 0 ${WIRE_Y} L 0 ${CELL_H + WIRE_Y}`;
/** END の記号（二重線）。 */
export const END_MARK = [`M 12 ${TOP} L 12 ${BOTTOM}`, `M 18 ${TOP} L 18 ${BOTTOM}`];

/**
 * 省略された接点列をまたいでコイルへ繋ぐ導線。§10.6
 *
 * 表示列数がコイル列より狭いとき（既定は 11 列）、11〜14 列目は描かれないので、最後の接点列と
 * コイル列は画面上では隣り合う。`applyLadderCell()` が自動で引いた横線でそこが繋がっている行は、
 * **最後の接点列の桟からコイルの記号まで1本の線**を重ねて、回路が切れていないことを見せる。
 * `lastContactIndex` は最後の接点列の**表示位置**（0起点。コイル列はその1つ右）、`row` は行番号
 * （セルと違って行の `<g>` には移動が掛かっていないので、縦位置はこの線自身が持つ）。
 */
export function leadAcrossHidden(lastContactIndex: number, row: number): string {
  const y = row * CELL_H + WIRE_Y;
  const coilX = (lastContactIndex + 1) * CELL_W;
  return `M ${lastContactIndex * CELL_W} ${y} L ${coilX + LEFT} ${y}`;
}
