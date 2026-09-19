/**
 * ラダー記号の線画。設計仕様 §10.6 / §17。
 *
 * `DialectProfile.symbols` が持つのは**識別子だけ**（`'contact-no'` など）で、実際の絵はここが
 * 自前の SVG パスとして持つ。**各社のロゴ・アイコン・画面キャプチャ・図記号ビットマップは
 * 一切複製しない**（§17 / PLC調査資料 §6）。直線・円・角括弧・矩形だけの一般的な描き方である。
 *
 * --- 2026-09-20 の作り直し（1回目・利用者指摘） ---
 *   1.「出力が四角や `()` で表されていて丸でないのはおかしい」→ OUT コイルは**丸**。
 *   2.「A接点やB接点の縦棒の間隔がやや広い」→ 縦棒の間隔をセル幅の比で詰める。
 *
 * --- 2026-09-20 の作り直し（2回目・利用者指摘「まだ直っていない」） ---
 * 利用者（電気系保全の指導員）が1回目のシートを見て挙げた4点をすべて数で決め直した。
 *   1.「2本の縦線の間隔がまだ広い」→ 間隔は**セル幅の 8〜10%**（`contactGapPx`。GX風48pxで4px）、
 *      線は **1.2px**（以前は 1.6〜1.8px）、縦棒の高さは**セル高の 35〜40%**（12〜18px）。
 *   2.「ラダーの接点（a/b・立上がり・立下がり）」→ 微分接点の矢印は**線画**（文字ではない）で
 *      縦棒の間に描く。8〜10% の間隔では矢印が読めないので、**微分接点だけ**間隔を
 *      `pulseGapPx` まで広げる（GX風で 8px）。b接点は縦棒＋左下→右上の斜線1本。
 *   3.「ラダーの出力（丸・角括弧・命令ボックス）」→ 丸の直径＝縦棒の高さ。角括弧・命令ボックスは
 *      出力列の右端に揃える。命令ボックスは命令語と被演算子を細い横線で仕切る。
 *   4.「ラダー全体（各社ソフトの実画面にもっと寄せる）」→ 行の高さを 34〜48px に詰め、
 *      左母線 3px・右母線 1.2px・行番号欄 24px にした（`LadderGrid.tsx`）。
 *
 * 形（丸・角括弧・箱）と寸法は**スキンが選ぶ**ようになり、選ぶ値は `ladder/skins/*.ts` にだけ置く。
 */

import type { SkinCell } from './skins/index.js';

/** セル1つの幅[px]（GX Works3風の既定）。 */
export const CELL_W = 48;
/** セル1つの高さ[px]（GX Works3風の既定。2026-09-20 の2回目の作り直しで 46 → 34）。 */
export const CELL_H = 34;
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
  /** 丸コイル（利用者要求 2026-09-20）。デバイス名は上、設定値は桟の右。 */
  | 'coil'
  /** 角括弧（GX Works3風の `[SET Y0]`）。命令語とデバイスを括弧の中に1行で置く。 */
  | 'bracket'
  /** 命令ボックス（CX-Programmer風などの TIM / CNT）。命令語・デバイス・設定値を3行で置く。 */
  | 'box';

/** 記号1つの線画。 */
export interface SymbolShape {
  /** `<path d>` にそのまま入る文字列。 */
  paths: readonly string[];
  /** 記号の中に描く短い文字（未知の識別子の `?`）。微分の矢印は文字ではなく `paths` で描く。 */
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
 * **型と規則は下のモジュール定数と1対1で揃える**（レビュー B2）。`linkDown` は `LINK_DOWN` と
 * 同じく**セルの左辺**、`leadAcrossHidden` は同じ**2引数**、`shape()` は `symbolShape()` と
 * 同じく**`undefined` を返さない**（知らない識別子は `?` 付きの接点に倒す）。
 */
export interface SymbolMetrics {
  /** セルの幅・高さ[px]と桟の縦位置。 */
  w: number;
  h: number;
  wireY: number;
  /** 接点の縦棒の上端・下端[px]（丸コイルの直径と角括弧・箱の高さの基準でもある）。 */
  barTop: number;
  barBottom: number;
  /** 接点の縦棒の間隔[px]（利用者要求 2026-09-20 2回目: セル幅の 8〜10%）。 */
  contactGap: number;
  /** 微分接点（立上がり／立下がり）だけの縦棒の間隔[px]（矢印が読める最小幅）。 */
  pulseGap: number;
  /** 左半分・右半分・全幅の導線。 */
  leadLeft: string;
  leadRight: string;
  leadFull: string;
  /** 下の行へ降りる縦リンク（`LINK_DOWN` と同じくセルの**左辺**）。 */
  linkDown: string;
  /** 分岐の接合点（T字）に打つ点の半径[px]（⌀4px）。 */
  junctionR: number;
  /** デバイス名のベースライン[px]（縦棒の上端の 2px 上）。 */
  labelY: number;
  /** 丸コイルに添える設定値（`K30`）のベースライン[px]と右端[px]。桟の右に置く。 */
  presetY: number;
  presetX: number;
  /** デバイスコメント1行の高さ[px]・**1行目**のベースライン[px]・1行の文字数。 */
  commentLineH: number;
  commentY: number;
  commentChars: number;
  /** 角括弧の中の1行のベースライン[px]（命令ボックスの1行だけの命令＝END も使う）。 */
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
/** 角括弧・箱の左右の余白[px]（ここまでリード線を引く。出力列の右端に揃える）。 */
const FRAME_INSET = 2;
/** 命令ボックスの仕切り線より上（命令語の行）の高さ[px]。 */
const BOX_HEAD = 12;
/** 命令ボックスの高さの上限[px]（命令語1行＋被演算子2行＋余白）。 */
const BOX_MAX_H = 32;
/** 分岐の接合点の直径[px]（利用者要求 2026-09-20 2回目）。 */
const JUNCTION_D = 4;
/** 微分接点の矢じりの寸法[px]（軸の高さは縦棒と同じ）。 */
const ARROW_HALF_W = 2;
const ARROW_HEAD_H = 3;
/** デバイス名を縦棒の上端からどれだけ上に置くか[px]。 */
const LABEL_LIFT = 2;
/**
 * b接点の斜線の形。**この2つの比だけで形が変わる**（利用者が示した三菱の命令記号表から作図。
 * 表そのものは複製していない。§17）。
 *
 * 利用者指摘 2026-09-20「B接点シンボルの斜め線の位置おかしいんだけど」。斜線は縦棒の端に
 * 釘付けにせず、**左下から右上へ、縦棒2本の x の範囲を貫いて**引く。参照した記号表の比は
 * 「横の伸び＝間隔＋縦棒の高さの約 1/2（左右に約 1/4 ずつはみ出す）」「縦の伸び＝縦棒の
 * 高さの約 0.8（上端・下端の内側に収まる）」で、桟に対して約 35〜40 度になる。
 */
const NC_OVERSHOOT_RATIO = 0.25;
const NC_HEIGHT_RATIO = 0.8;

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
  const barH = barBottom - barTop;
  const mid = Math.round(w / 2);

  /** 間隔 `gap` の縦棒2本の x 座標。 */
  const barXs = (gap: number): { left: number; right: number } => {
    const left = Math.round((w - gap) / 2);
    return { left, right: left + gap };
  };
  /** 間隔 `gap` の縦棒2本のパス。 */
  const barPaths = (gap: number): string[] => {
    const { left, right } = barXs(gap);
    return [
      `M ${left} ${barTop} L ${left} ${barBottom}`,
      `M ${right} ${barTop} L ${right} ${barBottom}`,
    ];
  };
  /** 間隔 `gap` の接点の左右のリード線（導線は縦棒の**間**には入らない）。 */
  const barLead = (gap: number): { leadLeft: string; leadRight: string } => {
    const { left, right } = barXs(gap);
    return {
      leadLeft: `M 0 ${wireY} L ${left} ${wireY}`,
      leadRight: `M ${right} ${wireY} L ${w} ${wireY}`,
    };
  };

  const gap = cell.contactGapPx;
  const bars = barPaths(gap);
  const contactLead = barLead(gap);

  /*
   * --- b接点の斜線 ---
   * 左下→右上の1本。縦棒2本の x の範囲を左右に貫き（左の縦棒の足の左下から右の縦棒の頭の
   * 右上へ）、縦の伸びは縦棒の高さの内側に収まる。記号表の比は上の2定数が持つ。
   */
  const tenth = (value: number): number => Math.round(value * 10) / 10;
  const ncHalfW = gap / 2 + barH * NC_OVERSHOOT_RATIO;
  const ncHalfH = (barH * NC_HEIGHT_RATIO) / 2;
  const ncDiagonal = `M ${tenth(mid - ncHalfW)} ${tenth(wireY + ncHalfH)} L ${tenth(mid + ncHalfW)} ${tenth(wireY - ncHalfH)}`;

  /*
   * --- 微分接点（立上がり／立下がり） ---
   * a接点の間隔のままでは矢じりが縦棒に触れるスキンがあるので、**微分接点だけ**
   * `pulseGapPx` まで広げる（利用者要求 2026-09-20 2回目の但し書き）。
   * 矢印は文字（`↑`）ではなく 1.2px の線画で描く（フォントに依存させない）。
   */
  const pulseGap = Math.max(cell.pulseGapPx, gap);
  const pulseBars = barPaths(pulseGap);
  const pulseLead = barLead(pulseGap);
  /* 矢印の軸は縦棒と同じ高さ（利用者が示した記号表の LDP / LDF の比）。 */
  const arrowTop = barTop;
  const arrowBottom = barBottom;
  const arrow = (up: boolean): string[] => {
    const tip = up ? arrowTop : arrowBottom;
    const tail = up ? arrowBottom : arrowTop;
    const barb = up ? tip + ARROW_HEAD_H : tip - ARROW_HEAD_H;
    return [
      `M ${mid} ${tail} L ${mid} ${tip}`,
      `M ${mid - ARROW_HALF_W} ${barb} L ${mid} ${tip} L ${mid + ARROW_HALF_W} ${barb}`,
    ];
  };

  /* --- 丸コイル（利用者要求 2026-09-20: 出力は丸。直径＝縦棒の高さ） --- */
  const coilR = cell.coilRxPx;
  const coil: SymbolShape = {
    paths: [],
    layout: 'coil',
    circle: { cx: mid, cy: wireY, r: coilR },
    leadLeft: `M 0 ${wireY} L ${mid - coilR} ${wireY}`,
    leadRight: `M ${mid + coilR} ${wireY} L ${w} ${wireY}`,
  };

  /* --- 角括弧 `[ SET Y0 ]`（GX Works3風の命令。出力列の右端に揃える） --- */
  const frameL = FRAME_INSET;
  const frameR = w - FRAME_INSET;
  const bracketH = Math.max(barH + 6, 16);
  const bracketTop = Math.round(wireY - bracketH / 2);
  const bracketBottom = bracketTop + bracketH;
  const bracket: SymbolShape = {
    paths: [
      `M ${frameL + BRACKET_HOOK} ${bracketTop} L ${frameL} ${bracketTop} L ${frameL} ${bracketBottom} L ${frameL + BRACKET_HOOK} ${bracketBottom}`,
      `M ${frameR - BRACKET_HOOK} ${bracketTop} L ${frameR} ${bracketTop} L ${frameR} ${bracketBottom} L ${frameR - BRACKET_HOOK} ${bracketBottom}`,
    ],
    layout: 'bracket',
    leadLeft: `M 0 ${wireY} L ${frameL} ${wireY}`,
    leadRight: '',
  };

  /* --- 命令ボックス（CX-Programmer風などの TIM / CNT）。細い横線で命令語と被演算子を仕切る --- */
  const boxH = Math.min(h - 6, BOX_MAX_H);
  const boxTop = Math.round(wireY - boxH / 2);
  const boxBottom = boxTop + boxH;
  const boxFrame = `M ${frameL} ${boxTop} L ${frameR} ${boxTop} L ${frameR} ${boxBottom} L ${frameL} ${boxBottom} Z`;
  const boxLead = {
    leadLeft: `M 0 ${wireY} L ${frameL} ${wireY}`,
    leadRight: '',
  };
  const box: SymbolShape = {
    paths: [boxFrame, `M ${frameL} ${boxTop + BOX_HEAD} L ${frameR} ${boxTop + BOX_HEAD}`],
    layout: 'box',
    ...boxLead,
  };
  /** 被演算子を持たない命令（END）の箱。仕切り線を引かず、命令語を箱の中央に置く。 */
  const boxPlain: SymbolShape = { paths: [boxFrame], layout: 'box', ...boxLead };

  const contact = (text?: string): SymbolShape => ({
    paths: bars,
    layout: 'contact',
    ...contactLead,
    ...(text === undefined ? {} : { text }),
  });
  /** 出力命令（SET / RST / MC / MCR）の形はスキンが選ぶ。 */
  const instruction = cell.instructionStyle === 'bracket' ? bracket : box;
  /** END は被演算子を持たないので、箱のスキンでは仕切り線の無い箱にする。 */
  const endShape = cell.instructionStyle === 'bracket' ? bracket : boxPlain;
  /** タイマ・カウンタは GX Works3風だけ**丸コイル**（`OUT T0 K30`）、他社は命令ボックス。 */
  const timerShape = cell.timerStyle === 'coil' ? coil : box;

  const shapes: Readonly<Record<string, SymbolShape>> = {
    'contact-no': contact(),
    'contact-nc': {
      // b接点は縦棒2本＋**縦棒の間を通る左下→右上の斜線1本**（縦棒の高さの中に収まる）
      paths: [...bars, ncDiagonal],
      layout: 'contact',
      ...contactLead,
    },
    'contact-rise': { paths: [...pulseBars, ...arrow(true)], layout: 'contact', ...pulseLead },
    'contact-fall': { paths: [...pulseBars, ...arrow(false)], layout: 'contact', ...pulseLead },
    'coil-round': coil,
    'coil-set': instruction,
    'coil-reset': instruction,
    'coil-timer': timerShape,
    'coil-counter': timerShape,
    [MC_SYMBOL_ID]: instruction,
    [MCR_SYMBOL_ID]: instruction,
    [END_SYMBOL_ID]: endShape,
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
    pulseGap,
    ...contactLead,
    leadFull: `M 0 ${wireY} L ${w} ${wireY}`,
    // `LINK_DOWN` と同じ: セルの**左辺**を、次の行の桟（`h + wireY`）まで伸ばす
    linkDown: `M 0 ${wireY} L 0 ${h + wireY}`,
    junctionR: JUNCTION_D / 2,
    labelY: barTop - LABEL_LIFT,
    // 設定値（`K30`）は丸の**右**の桟の上に、セルの右端（＝右母線）に触れないよう右詰めで置く
    presetY: Math.round(wireY) + 3,
    presetX: w - FRAME_INSET - 1,
    commentLineH: cell.commentFontPx,
    // コメントの1行目は縦棒の下端のすぐ下。以降は `commentLineH` ずつ**下へ**積む
    commentY: barBottom + cell.commentFontPx,
    // 全角1文字あたり `commentFontPx`。セル幅からはみ出さない文字数に丸める
    commentChars: Math.max(3, Math.floor((w - 2) / cell.commentFontPx)),
    bracketTextY: Math.round(wireY) + 3,
    boxTextY: [boxTop + 9, boxTop + 20, boxTop + 28],
    stepGutter: cell.stepGutterPx,
    poweredBlock: { x: 0, y: barTop, w, h: barH },
    /*
     * `leadAcrossHidden()` と同じ規則。始点は「コイル列の左端」で、最後の接点セルの絵の上を
     * オーバーレイが横切らないようにする（3B 最終修正）。終点は**記号の枠の手前**
     * （`FRAME_INSET`）で止める。接点の縦棒の位置まで伸ばすと、コイル列が角括弧
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
  strokeWidth: 1.2,
  barInsetPx: 11,
  contactGapPx: 6,
  pulseGapPx: 8,
  coilRxPx: 6,
  commentFontPx: 9,
  instructionStyle: 'bracket',
  timerStyle: 'coil',
  stepGutterPx: 24,
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
