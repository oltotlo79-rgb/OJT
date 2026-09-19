/**
 * ラダー記号の線画。設計仕様 §10.6 / §17。
 *
 * `DialectProfile.symbols` が持つのは**識別子だけ**（`'contact-no'` など）で、実際の絵はここが
 * 自前の SVG パスとして持つ。**各社のロゴ・アイコン・画面キャプチャ・図記号ビットマップは
 * 一切複製しない**（§17 / PLC調査資料 §6）。直線・円・角括弧・矩形だけの一般的な描き方である。
 *
 * --- 2026-09-20 の作り直し（利用者指摘） ---
 * 利用者（電気系保全の指導員）の指摘は2点。
 *   1.「出力が四角や `()` で表されていて丸でないのはおかしい」
 *      → **OUT コイル（タイマ・カウンタの OUT を含む）は丸 `-○-`** で描く。丸括弧も矩形も使わない。
 *        矩形は各社のソフトで**本当に箱で出る命令**（GX Works3風の `[SET Y0]`、CX-Programmer風・
 *        PCwin風・JW-300SP風の TIM / CNT / 命令ボックス）だけに残す。
 *   2.「すべてのシンボルのA接点やB接点の縦棒の間隔がやや広い」
 *      → 縦棒の間隔を**セル幅の 15〜20%**（`SkinCell.contactGapPx`）に詰める。
 * あわせて Plan 4B 決定表#6 の「形は4スキン共通・数だけスキン別」を利用者判断で解いた。
 * 形（丸・角括弧・箱）は**スキンが選ぶ**ようになり、選ぶ値は `ladder/skins/*.ts` にだけ置く。
 */

import type { SkinCell } from './skins/index.js';

/** セル1つの幅[px]（GX Works3風の既定）。 */
export const CELL_W = 48;
/** セル1つの高さ[px]（GX Works3風の既定）。 */
export const CELL_H = 46;
/** 桟（導線）の縦位置[px]。 */
export const WIRE_Y = CELL_H / 2;

/**
 * MC / MCR / END の識別子。**`DialectProfile.symbols`（`SymbolDrawing`）には無い**ので、
 * ここだけは本アプリ側の固定の識別子を使う（`plc-dialects` は Plan 3A の所有物なので広げない）。
 */
export const MC_SYMBOL_ID = 'coil-mc';
export const MCR_SYMBOL_ID = 'coil-mcr';
export const END_SYMBOL_ID = 'rung-end';

/**
 * 記号の**文字と導線の置き方**。`LadderGrid` はこれを見て、デバイス名を記号の上に出すのか
 * （接点・丸コイル）、記号の中に1行で出すのか（角括弧）、3行で出すのか（箱）を決める。
 */
export type SymbolLayout =
  /** 接点。縦棒2本の間に微分の矢印。デバイス名は上、コメントは下。 */
  | 'contact'
  /** 丸コイル（利用者要求 2026-09-20）。デバイス名は上、設定値は同じ行の右。 */
  | 'coil'
  /** 角括弧（GX Works3風の `[SET Y0]`）。命令語とデバイスを括弧の中に1行で置く。 */
  | 'bracket'
  /** 命令ボックス（CX-Programmer風などの TIM / CNT）。命令語・デバイス・設定値を3行で置く。 */
  | 'box';

/** 記号1つの線画。 */
export interface SymbolShape {
  /** `<path d>` にそのまま入る文字列。 */
  paths: readonly string[];
  /** 記号の中に描く短い文字（微分接点の `↑` / `↓`、未知の識別子の `?`）。 */
  text?: string;
  /** 文字と導線の置き方。 */
  layout: SymbolLayout;
  /** 丸コイル（`layout: 'coil'`）の円。`<circle>` としてそのまま描く。 */
  circle?: { cx: number; cy: number; r: number };
  /** この記号の左のリード線（空文字なら引かない）。 */
  leadLeft: string;
  /** この記号の右のリード線（空文字なら引かない。角括弧と箱は右に繋がない）。 */
  leadRight: string;
}

/**
 * そのスキンの寸法で描いた記号と導線一式。
 *
 * **型と規則は下のモジュール定数と1対1で揃える**（レビュー B2）。`endMark` は `END_MARK` と
 * 同じく**配列**、`linkDown` は `LINK_DOWN` と同じく**セルの左辺**、`leadAcrossHidden` は
 * 同じ**2引数**、`shape()` は `symbolShape()` と同じく**`undefined` を返さない**（知らない
 * 識別子は `?` 付きの接点に倒す）。
 */
export interface SymbolMetrics {
  /** セルの幅・高さ[px]と桟の縦位置。 */
  w: number;
  h: number;
  wireY: number;
  /** 接点の縦棒の上端・下端[px]（丸コイルの直径と角括弧・箱の高さの基準でもある）。 */
  barTop: number;
  barBottom: number;
  /** 接点の縦棒の間隔[px]（利用者要求 2026-09-20: セル幅の 15〜20%）。 */
  contactGap: number;
  /** 左半分・右半分・全幅の導線。 */
  leadLeft: string;
  leadRight: string;
  leadFull: string;
  /** 下の行へ降りる縦リンク（`LINK_DOWN` と同じくセルの**左辺**）。 */
  linkDown: string;
  /** 分岐の接合点（T字）に打つ点の半径[px]。 */
  junctionR: number;
  /** END の印（`END_MARK` と同じく**2本の縦棒**。互換のために残す）。 */
  endMark: readonly string[];
  /** デバイス名のベースライン[px]（記号の上）。 */
  labelY: number;
  /** デバイスコメント1行の高さ[px]・最終行のベースライン[px]・1行の文字数。 */
  commentLineH: number;
  commentY: number;
  commentChars: number;
  /** 角括弧の中の1行のベースライン[px]。 */
  bracketTextY: number;
  /** 箱の中の3行（命令語・デバイス・設定値）のベースライン[px]。 */
  boxTextY: readonly [number, number, number];
  /** 左の行番号欄の幅[px]。 */
  stepGutter: number;
  /** モニタ中の通電を塗りで見せる帯（GX Works3風。`monitorStyle: 'block'`）。 */
  poweredBlock: { x: number; y: number; w: number; h: number };
  /** 省略された接点列をまたいでコイルへ繋ぐ導線（`leadAcrossHidden()` と同じ2引数）。 */
  leadAcrossHidden: (lastContactIndex: number, row: number) => string;
  /** 識別子 → 線画（`symbolShape()` と同じく、知らない識別子は `?` 付きの接点）。 */
  shape: (id: string) => SymbolShape;
}

/**
 * `SkinCell` は `ladder/skins/*.ts` のモジュール定数なので**同一性が保たれる**。
 * 同じ寸法には同じオブジェクトを返し、`memo(LadderGrid)` の props 比較を壊さない。
 */
const METRICS_CACHE = new WeakMap<SkinCell, SymbolMetrics>();

/** 角括弧の「かぎ」の長さ[px]。 */
const BRACKET_HOOK = 3;
/** 角括弧・箱の左右の余白[px]（ここまでリード線を引く）。 */
const FRAME_INSET = 4;

/**
 * スキンの寸法で記号を作り直す。決定表#6（2026-09-20 の利用者判断で「形もスキン別」に緩めた）
 *
 * スキンが選ぶのは `SkinCell` の数と2つの列挙（`instructionStyle` / `timerStyle`）だけで、
 * 各社の図記号ビットマップは一切複製しない（§17）。
 */
export function symbolMetrics(cell: SkinCell): SymbolMetrics {
  const cached = METRICS_CACHE.get(cell);
  if (cached !== undefined) return cached;
  const w = cell.widthPx;
  const h = cell.heightPx;
  const wireY = h / 2;
  /* 接点の縦棒は桟を中心に上下対称（桟が接点の真ん中を通る）。 */
  const barTop = cell.barInsetPx;
  const barBottom = h - cell.barInsetPx;
  /* 縦棒の間隔はセル幅の 15〜20%（利用者要求 2026-09-20）。 */
  const gap = cell.contactGapPx;
  const barLeft = Math.round((w - gap) / 2);
  const barRight = barLeft + gap;
  const bars = [
    `M ${barLeft} ${barTop} L ${barLeft} ${barBottom}`,
    `M ${barRight} ${barTop} L ${barRight} ${barBottom}`,
  ];
  const contactLead = {
    leadLeft: `M 0 ${wireY} L ${barLeft} ${wireY}`,
    leadRight: `M ${barRight} ${wireY} L ${w} ${wireY}`,
  };

  /* --- 丸コイル（利用者要求 2026-09-20: 出力は丸） --- */
  const coilCx = Math.round(w / 2);
  const coilR = cell.coilRxPx;
  const coil: SymbolShape = {
    paths: [],
    layout: 'coil',
    circle: { cx: coilCx, cy: wireY, r: coilR },
    leadLeft: `M 0 ${wireY} L ${coilCx - coilR} ${wireY}`,
    leadRight: `M ${coilCx + coilR} ${wireY} L ${w} ${wireY}`,
  };

  /* --- 角括弧 `[ SET Y0 ]`（GX Works3風の命令） --- */
  const frameL = FRAME_INSET;
  const frameR = w - FRAME_INSET;
  const bracket: SymbolShape = {
    paths: [
      `M ${frameL + BRACKET_HOOK} ${barTop} L ${frameL} ${barTop} L ${frameL} ${barBottom} L ${frameL + BRACKET_HOOK} ${barBottom}`,
      `M ${frameR - BRACKET_HOOK} ${barTop} L ${frameR} ${barTop} L ${frameR} ${barBottom} L ${frameR - BRACKET_HOOK} ${barBottom}`,
    ],
    layout: 'bracket',
    leadLeft: `M 0 ${wireY} L ${frameL} ${wireY}`,
    leadRight: '',
  };

  /* --- 命令ボックス（CX-Programmer風などの TIM / CNT） --- */
  const boxH = Math.min(h - 6, barBottom - barTop + 14);
  const boxTop = Math.round(wireY - boxH / 2);
  const boxBottom = boxTop + boxH;
  const box: SymbolShape = {
    paths: [
      `M ${frameL} ${boxTop} L ${frameR} ${boxTop} L ${frameR} ${boxBottom} L ${frameL} ${boxBottom} Z`,
    ],
    layout: 'box',
    leadLeft: `M 0 ${wireY} L ${frameL} ${wireY}`,
    leadRight: '',
  };

  const contact = (text?: string): SymbolShape => ({
    paths: bars,
    layout: 'contact',
    ...contactLead,
    ...(text === undefined ? {} : { text }),
  });
  /** 出力命令（SET / RST / MC / MCR / END）の形はスキンが選ぶ。 */
  const instruction = cell.instructionStyle === 'bracket' ? bracket : box;
  /** タイマ・カウンタは GX Works3風だけ**丸コイル**（`OUT T0 K30`）、他社は命令ボックス。 */
  const timerShape = cell.timerStyle === 'coil' ? coil : box;

  const shapes: Readonly<Record<string, SymbolShape>> = {
    'contact-no': contact(),
    'contact-nc': {
      paths: [...bars, `M ${barLeft} ${barBottom} L ${barRight} ${barTop}`],
      layout: 'contact',
      ...contactLead,
    },
    'contact-rise': contact('↑'),
    'contact-fall': contact('↓'),
    'coil-round': coil,
    'coil-set': instruction,
    'coil-reset': instruction,
    'coil-timer': timerShape,
    'coil-counter': timerShape,
    [MC_SYMBOL_ID]: instruction,
    [MCR_SYMBOL_ID]: instruction,
    [END_SYMBOL_ID]: instruction,
  };
  // 知らない識別子の倒し先（`undefined` は返さない）
  const unknown = contact('?');

  const metrics: SymbolMetrics = {
    w,
    h,
    wireY,
    barTop,
    barBottom,
    contactGap: gap,
    ...contactLead,
    leadFull: `M 0 ${wireY} L ${w} ${wireY}`,
    // `LINK_DOWN` と同じ: セルの**左辺**を、次の行の桟（`h + wireY`）まで伸ばす
    linkDown: `M 0 ${wireY} L 0 ${h + wireY}`,
    junctionR: Math.max(1.5, cell.strokeWidth * 1.2),
    /*
     * `END_MARK` と同じ二重線。END そのものは `END_SYMBOL_ID` の角括弧・箱で描くようになった
     * （どの社のソフトも END を裸の二重線では出さない）が、署名の互換のために残す。
     */
    endMark: [
      `M ${barLeft - 3} ${barTop} L ${barLeft - 3} ${barBottom}`,
      `M ${barLeft + 3} ${barTop} L ${barLeft + 3} ${barBottom}`,
    ],
    labelY: barTop - 3,
    commentLineH: 8,
    commentY: h - 2,
    // コメントは 8px なので、全角1文字あたり約 8px。セル幅からはみ出さない文字数に丸める
    commentChars: Math.max(3, Math.floor(w / 9)),
    bracketTextY: Math.round(wireY + 3),
    boxTextY: [
      Math.round(boxTop + boxH * 0.28) + 3,
      Math.round(boxTop + boxH * 0.55) + 3,
      Math.round(boxTop + boxH * 0.82) + 3,
    ],
    stepGutter: cell.stepGutterPx,
    poweredBlock: { x: 0, y: barTop, w, h: barBottom - barTop },
    /*
     * `leadAcrossHidden()` と同じ規則。始点は「コイル列の左端」で、最後の接点セルの絵の上を
     * オーバーレイが横切らないようにする（3B 最終修正）。終点は**記号の枠の手前**
     * （`FRAME_INSET`）で止める。接点の縦棒の位置（`barLeft`）まで伸ばすと、コイル列が角括弧
     * （`[SET Y0]`）や命令ボックスのとき、括弧と中の文字の上を線が横切ってしまう（2026-09-20）。
     */
    leadAcrossHidden: (lastContactIndex: number, row: number): string => {
      const y = row * h + wireY;
      const coilX = (lastContactIndex + 1) * w;
      return `M ${coilX} ${y} L ${coilX + FRAME_INSET} ${y}`;
    },
    shape: (id: string): SymbolShape => shapes[id] ?? unknown,
  };
  METRICS_CACHE.set(cell, metrics);
  return metrics;
}

/* --- GX Works3風の既定（このファイルのモジュール定数の出どころ） --- */

/**
 * GX Works3風の寸法（既定）。`CELL_W` / `CELL_H` と同じ値で、`symbolMetrics(GX_CELL)` は
 * 下のモジュール定数と同じ絵を返す。
 */
export const GX_CELL: SkinCell = {
  widthPx: CELL_W,
  heightPx: CELL_H,
  strokeWidth: 1.6,
  barInsetPx: 12,
  contactGapPx: 8,
  coilRxPx: 11,
  instructionStyle: 'bracket',
  timerStyle: 'coil',
  stepGutterPx: 26,
};

/** GX Works3風の寸法で組んだ一式。下の互換 export はすべてここから引く。 */
const GX = symbolMetrics(GX_CELL);

/** 左のリード線（セルの左端から記号の左端まで）。 */
export const LEAD_LEFT = GX.leadLeft;
/** 右のリード線（記号の右端からセルの右端まで）。 */
export const LEAD_RIGHT = GX.leadRight;
/** セルを丸ごと横断する導線（`hline` / `vline`）。 */
export const LEAD_FULL = GX.leadFull;
/**
 * 縦線（セルの左辺で下の行と繋ぐ渡り）。§10.3
 *
 * 下端は `CELL_H` ではなく `CELL_H + WIRE_Y` にする。`vline` が繋ぐのは (row,col) → (row+1,col)
 * で、次の行の桟は `WIRE_Y` だけ下にあるため、`CELL_H` で止めると桟の手前で線が切れて見える
 * （レビュー指摘 B1。`<g>` は子を clip しないので、セルの外まで伸ばしてよい）。
 */
export const LINK_DOWN = GX.linkDown;
/** END の印（二重線）。END 自体は角括弧 `[END]` で描くようになったが、署名の互換で残す。 */
export const END_MARK = GX.endMark;

/** 識別子から線画を引く。知らない識別子は「?」付きの接点で描く。 */
export function symbolShape(id: string): SymbolShape {
  return GX.shape(id);
}

/**
 * 省略された接点列をまたいでコイルへ繋ぐ導線。§10.6
 *
 * 表示列数がコイル列より狭いとき（既定は 11 列）、11〜14 列目は描かれないので、最後の接点列と
 * コイル列は画面上では隣り合う。`applyLadderCell()` が自動で引いた横線でそこが繋がっている行は、
 * **最後の接点列の桟からコイルの記号まで1本の線**を重ねて、回路が切れていないことを見せる。
 */
export function leadAcrossHidden(lastContactIndex: number, row: number): string {
  return GX.leadAcrossHidden(lastContactIndex, row);
}
