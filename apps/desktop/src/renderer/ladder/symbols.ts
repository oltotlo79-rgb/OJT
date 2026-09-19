/**
 * ラダー記号の線画。設計仕様 §10.6 / §17。
 *
 * `DialectProfile.symbols` が持つのは**識別子だけ**（`'contact-no'` など）で、実際の絵はここが
 * 自前の SVG パスとして持つ。**各社のロゴ・アイコン・画面キャプチャ・図記号ビットマップは
 * 一切複製しない**（§17 / PLC調査資料 §6）。JIS C 0617 のシーケンス図記号に沿った、
 * 直線と円弧だけの一般的な描き方である。
 */

import type { SkinCell } from './skins/index.js';

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
  // 始点は「コイル列の左端」（`coilX`）にする。`lastContactIndex * CELL_W` にすると最後の
  // 接点セルの左端から引くことになり、そのセルの絵の上をオーバーレイが横切ってしまう
  // （レビュー指摘 #1）。最後の接点セル自体は自分のリード線で右端まで繋がっている。
  return `M ${coilX} ${y} L ${coilX + LEFT} ${y}`;
}

/* --- Plan 4B Task 4: スキン別の寸法（決定表#6） --- */

/**
 * GX Works3風の寸法（既定）。上の `CELL_W` / `CELL_H` / `TOP` と同じ値で、
 * `symbolMetrics(GX_CELL)` はこのファイルのモジュール定数と同じ絵を返す。
 */
export const GX_CELL: SkinCell = {
  widthPx: CELL_W,
  heightPx: CELL_H,
  strokeWidth: 1.6,
  barInsetPx: TOP,
  coilRxPx: 9,
};

/**
 * そのスキンの寸法で描いた記号と導線一式。
 *
 * **型と規則は上のモジュール定数と1対1で揃える**（レビュー B2）。`endMark` は `END_MARK` と
 * 同じく**配列**、`linkDown` は `LINK_DOWN` と同じく**セルの左辺**、`leadAcrossHidden` は
 * 同じ**2引数**、`shape()` は `symbolShape()` と同じく**`undefined` を返さない**（知らない
 * 識別子は `?` 付きの接点に倒す）。`LadderGrid` の置き換えは名前を差し替えるだけで済む。
 */
export interface SymbolMetrics {
  /** セルの幅・高さ[px]と桟の縦位置。 */
  w: number;
  h: number;
  wireY: number;
  /** 左半分・右半分・全幅の導線。 */
  leadLeft: string;
  leadRight: string;
  leadFull: string;
  /** 下の行へ降りる縦リンク（`LINK_DOWN` と同じくセルの**左辺**）。 */
  linkDown: string;
  /** END の印（`END_MARK` と同じく**2本の縦棒**）。 */
  endMark: readonly string[];
  /** 省略された接点列をまたいでコイルへ繋ぐ導線（`leadAcrossHidden()` と同じ2引数）。 */
  leadAcrossHidden: (lastContactIndex: number, row: number) => string;
  /** 識別子 → 線画（`symbolShape()` と同じく、知らない識別子は `?` 付きの接点）。 */
  shape: (id: string) => SymbolShape;
}

/** 記号そのものの横幅[px]（セルの中央に置き、左右の余りがリード線になる）。 */
const SYMBOL_W = RIGHT - LEFT;

/**
 * `SkinCell` は `ladder/skins/*.ts` のモジュール定数なので**同一性が保たれる**。
 * 同じ寸法には同じオブジェクトを返し、`memo(LadderGrid)` の props 比較を壊さない。
 */
const METRICS_CACHE = new WeakMap<SkinCell, SymbolMetrics>();

/**
 * スキンの寸法で記号を作り直す。決定表#6
 * 変えるのは**寸法と接点の縦棒の余白**だけで、形（縦棒2本・丸括弧・斜線）は4スキン共通である
 * （JIS C 0617 に沿った自前の作図。各社の図記号ビットマップは複製しない。§17）。
 */
export function symbolMetrics(cell: SkinCell): SymbolMetrics {
  const cached = METRICS_CACHE.get(cell);
  if (cached !== undefined) return cached;
  const w = cell.widthPx;
  const h = cell.heightPx;
  const wireY = h / 2;
  const left = Math.round((w - SYMBOL_W) / 2);
  const right = left + SYMBOL_W;
  const top = cell.barInsetPx;
  const bottom = h - cell.barInsetPx;
  const bars = [`M ${left} ${top} L ${left} ${bottom}`, `M ${right} ${top} L ${right} ${bottom}`];
  // 横の膨らみはスキンが決める（CX-Programmer風の「やや扁平」＝ 7）。「実物との対応」表 / 決定表#6
  const arcRx = cell.coilRxPx;
  const arcRy = (bottom - top) / 2;
  const arcs = [
    `M ${left + 2} ${top} A ${arcRx} ${arcRy} 0 0 0 ${left + 2} ${bottom}`,
    `M ${right - 2} ${top} A ${arcRx} ${arcRy} 0 0 1 ${right - 2} ${bottom}`,
  ];
  const shapes: Readonly<Record<string, SymbolShape>> = {
    'contact-no': { paths: bars },
    'contact-nc': { paths: [...bars, `M ${left} ${bottom} L ${right} ${top}`] },
    'contact-rise': { paths: bars, text: '↑' },
    'contact-fall': { paths: bars, text: '↓' },
    'coil-round': { paths: arcs },
    'coil-set': { paths: arcs, text: 'S' },
    'coil-reset': { paths: arcs, text: 'R' },
    'coil-timer': { paths: arcs, text: 'T' },
    'coil-counter': { paths: arcs, text: 'C' },
    [MC_SYMBOL_ID]: { paths: arcs, text: 'MC' },
    [MCR_SYMBOL_ID]: { paths: arcs, text: 'MCR' },
  };
  // 知らない識別子の倒し先（上の `UNKNOWN` と同じ扱い。`undefined` は返さない）
  const unknown: SymbolShape = { paths: bars, text: '?' };
  const metrics: SymbolMetrics = {
    w,
    h,
    wireY,
    leadLeft: `M 0 ${wireY} L ${left} ${wireY}`,
    leadRight: `M ${right} ${wireY} L ${w} ${wireY}`,
    leadFull: `M 0 ${wireY} L ${w} ${wireY}`,
    // `LINK_DOWN` と同じ: セルの**左辺**を、次の行の桟（`h + wireY`）まで伸ばす
    linkDown: `M 0 ${wireY} L 0 ${h + wireY}`,
    /*
     * `END_MARK` と同じ二重線。GX Works3風（`left` = 15）では landed と同じ 12 / 18 になる
     * ように、記号の左端を挟む形（`left ± 3`）で置く。
     */
    endMark: [
      `M ${left - 3} ${top} L ${left - 3} ${bottom}`,
      `M ${left + 3} ${top} L ${left + 3} ${bottom}`,
    ],
    /*
     * `leadAcrossHidden()` と同じ規則。始点は「コイル列の左端」で、最後の接点セルの絵の上を
     * オーバーレイが横切らないようにする（3B 最終修正）。
     */
    leadAcrossHidden: (lastContactIndex: number, row: number): string => {
      const y = row * h + wireY;
      const coilX = (lastContactIndex + 1) * w;
      return `M ${coilX} ${y} L ${coilX + left} ${y}`;
    },
    shape: (id: string): SymbolShape => shapes[id] ?? unknown,
  };
  METRICS_CACHE.set(cell, metrics);
  return metrics;
}
