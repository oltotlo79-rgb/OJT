import type { DialectId } from '@ojt/plc-dialects';

/**
 * スキンの見た目。設計仕様 §10.6 / §17.1。決定表#5
 *
 * 利用者要求（2026-09-19）「各メーカーのソフト画面や仕様に合わせた可能な限り実物に忠実な画面」
 * に対する記述である。**各社の画面キャプチャ・ロゴ・アイコン・図記号ビットマップ・純正の配色
 * データは一切使っていない**（§17 / PLC調査資料 §6）。再現するのは公知の画面構成・項目名・
 * 一般に知られた色調で、値はすべて本アプリの記述（§17.1 の前提方針）である。
 * 実機と異なると分かったときの修正箇所は `ladder/skins/<メーカー>.ts` の1ファイルだけである。
 */

/** ステータスバーに出す項目。 */
export type SkinStatusItem =
  /** 書込／読出／モニタ。 */
  | 'mode'
  /** RUN / STOP。 */
  | 'plc-state'
  /** スキャン回数と経過時間。 */
  | 'scan'
  /** いまカーソルがある回路ブロック。 */
  | 'network'
  /** 挿入／上書き。 */
  | 'overwrite'
  /** 使っているデバイス点数。 */
  | 'device-count';

/** スキンの配色。すべて `#RRGGBB`（大文字）。 */
export interface SkinColors {
  /** 編集領域の背景。 */
  canvas: string;
  /** 格子線（`transparent` にしたいときは背景と同色にする）。 */
  grid: string;
  /** 左母線。 */
  rail: string;
  /** 記号と導線の線色。 */
  symbol: string;
  /** デバイス名の文字色。 */
  device: string;
  /** 設定値（タイマ・カウンタ）の文字色。 */
  preset: string;
  /** デバイスコメントの文字色。 */
  comment: string;
  /** カーソル枠。 */
  cursor: string;
  /** 変換エラーのセル枠。 */
  error: string;
  /** 通電表示（モニタ中）。 */
  powered: string;
  /** ツールバーの背景。 */
  toolbar: string;
  /** タイトルバーの背景。 */
  titleBar: string;
  /** タイトルバーの文字。 */
  titleBarText: string;
  /** ステータスバーの背景。 */
  statusBar: string;
  /** 出力ウィンドウの背景。 */
  output: string;
}

/**
 * セルの寸法と線の太さ[px]。**スキンで変わる値はこの5つだけ**で、記号の「種別」は持たない
 * （決定表#6。`'gx' | 'cx' | …` のような列挙を作らないのは、値が2箇所に割れるため）。
 */
export interface SkinCell {
  widthPx: number;
  heightPx: number;
  /** 記号・導線の線幅。 */
  strokeWidth: number;
  /** 接点の縦棒の上下の余白[px]（小さいほど縦長の接点になる）。 */
  barInsetPx: number;
  /**
   * コイルの半円の横の膨らみ（SVG 楕円弧の `rx`）[px]。
   * 小さいほど扁平に見える（CX-Programmer風の「やや扁平」＝ 7。ほかは 9）。「実物との対応」表
   */
  coilRxPx: number;
}

/**
 * 画面の並び。
 * ツリーの**位置**は4スキンとも左なので欄を持たない（持っても誰も読まない旗になる。I11）。
 */
export interface SkinLayout {
  /**
   * ツリーの幅[px]。「実物との対応」表の値の**記録**として残すが、実装はこの値を使わない
   * （レビュー I4）。2026-09-19 UXバッチB の判断で、実際の幅は常に `--ladder-tree-w`
   * （`ladder.module.css` の `.tree`。140px・1600px未満は116px）が勝つ——格子（回路の編集領域）
   * に幅を渡すことを優先し、狭いほうを採ったため（`## 仕様からの意図的な差分` の #12）。
   * 将来スキンがこれより狭い幅を持ったときだけスキンに従う（`min()`）。
   */
  treeWidthPx: number;
  /** 出力ペインの形（`status-bar` は PCwin風だけ。§10.6）。 */
  outputPane: 'window' | 'status-bar';
  /**
   * 出力ペインの高さ[px]。`window` のときは出力ウィンドウそのものの高さ、`status-bar` のときは
   * 折りたたんだ詳細の高さ。どちらも CSS 変数 `--skin-output-h` として同じ場所から効く。
   */
  outputHeightPx: number;
}

/** スキン1つぶんの見た目。 */
export interface SkinTheme {
  id: DialectId;
  /** タイトルバーの文字。**必ず「風」で終わる**（§15 / §17.1 の商標の扱い）。 */
  titleBar: string;
  layout: SkinLayout;
  statusItems: readonly SkinStatusItem[];
  colors: SkinColors;
  cell: SkinCell;
  /** デバイスコメントを記号の下に何行で出すか。 */
  commentLines: 0 | 1 | 2;
  /** この見た目のうち §17.1 の前提である項目（設定画面とツールチップに出す）。 */
  assumed: readonly string[];
  /**
   * キー割当表**全体**を別メーカーの表から流用しているか（レビュー I7）。
   * 行ごとの `ShortcutEntry.confirmed` は個々のキーの一次資料の有無を示すが、PCwin風・
   * JW-300SP風は GX Works3風の表そのものを借りている（`GX_STYLE_SHORTCUTS`）ため、
   * `confirmed: true` の行だけを見ると「このメーカーで確認済み」に読めてしまう。
   * 真のときだけ `ShortcutHelp` が §17.1 の注記をもう1つ添える。省略時は `false` 相当。
   */
  keyMapAssumed?: boolean;
}

/** 4スキン共通の前提（「実物との対応」表の △ の理由）。 */
export const SKIN_ASSUMED: readonly string[] = [
  '画面の配色・セル寸法・記号の線の太さ（一般に知られた見え方から作図。純正の画面キャプチャ・配色データは使っていない）',
  'ペインの幅・出力ウィンドウの高さ・ステータスバーの項目（公知の画面構成から）',
  'タイトルバーの文字は「風」を付けた本アプリの表記（各社のロゴ・製品画像は持たない）',
];
