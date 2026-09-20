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
  /**
   * 変換していない回路ブロックの背景（`--skin-unconverted`）。Phase 7 設計 §5.4
   *
   * GX Works3 は未変換の回路を灰色の背景で示し、`F4`（変換）が通ると白へ戻る。
   * 「変換」を持たないメーカー（`convertStep: false`）はこの表現を使わず、代わりに
   * 出力の無いネットワークの右端に赤い縦線を出す（§5.2 の CX-Programmer 風）。
   * **灰色そのものの色味は一次資料で確認できていない**ので `assumed` に載せる（§17.1）。
   */
  unconverted: string;
}

/**
 * 出力命令（SET / RST / MC / MCR / END）の描き方。
 * `bracket` は GX Works3風の `[SET Y0]`、`box` は CX-Programmer風などの命令ボックス。
 */
export type SkinInstructionStyle = 'bracket' | 'box';

/**
 * タイマ・カウンタの描き方。
 * `coil` は GX Works3風の `OUT T0 K30`（**丸コイル**に設定値を添える）、`box` は
 * CX-Programmer風・PCwin風・JW-300SP風の命令ボックス（命令語＋オペランドを3行で出す）。
 */
export type SkinTimerStyle = 'coil' | 'box';

/**
 * 左の行番号欄の数え方。`step` はステップ番号（行の通し）、`rung` はラング番号（回路の通し）。
 */
export type SkinStepNumbering = 'step' | 'rung';

/**
 * モニタ中の通電の見せ方。
 * `block` は GX Works3風（通電している記号の裏に色の帯を敷く）、`flow` は CX-Programmer風
 * などの「パワーフロー」（通電している線と記号だけを太く色づける）。
 */
export type SkinMonitorStyle = 'block' | 'flow';

/**
 * セルの寸法・線の太さ[px]と記号の形。
 *
 * Plan 4B 決定表#6 は「形は4スキン共通、数だけスキン別」と決めていたが、利用者
 * （電気系保全の指導員）の 2026-09-20 の指摘「PLCは各メーカのソフトの画面表示と仕様に忠実に」
 * 「出力が四角や `()` で表されていて丸でないのはおかしい」でその判断を解いた。
 * **形を選ぶ値（`instructionStyle` / `timerStyle`）もここに置く**ので、実機と違うと分かった
 * ときに直すのは `ladder/skins/<メーカー>.ts` の1ファイルのままである（§17.1）。
 */
export interface SkinCell {
  widthPx: number;
  heightPx: number;
  /** 記号・導線の線幅。 */
  strokeWidth: number;
  /** 接点の縦棒の上下の余白[px]（小さいほど縦長の接点になる）。 */
  barInsetPx: number;
  /**
   * 接点の縦棒の**間隔**[px]。利用者要求 2026-09-20（2回目）「2本の縦線の間隔がまだ広い」により、
   * どのスキンも**セル幅の 8〜10%**に収める（`skin-grid.test.tsx` が比で縛る）。
   */
  contactGapPx: number;
  /**
   * **微分接点（立上がり／立下がり）だけ**の縦棒の間隔[px]。8〜10% では矢印が読めないので、
   * 矢印（幅 4px ＋左右の余白）が入る最小の幅までここだけ広げる（利用者要求 2026-09-20 2回目の
   * 但し書き）。a接点・b接点は `contactGapPx` のままである。
   */
  pulseGapPx: number;
  /**
   * **丸コイルの半径**[px]。利用者要求 2026-09-20「出力は丸」により、OUT コイルは丸括弧では
   * なく直径 `2 × coilRxPx` の円で描く。接点の縦棒の高さ（`heightPx - 2 × barInsetPx`）と
   * **同じ直径**にして、接点と出力の大きさを揃える。「実物との対応」表
   */
  coilRxPx: number;
  /**
   * デバイスコメントの文字の大きさ[px]。1行のスキンは 9px、CX-Programmer風だけ2行を縦棒の下に
   * 積むので 8px にする（9px だと2行目が次の行のデバイス名にかかる）。△
   */
  commentFontPx: number;
  /** 出力命令（SET / RST / MC / MCR / END）の形。 */
  instructionStyle: SkinInstructionStyle;
  /** タイマ・カウンタの形。 */
  timerStyle: SkinTimerStyle;
  /** 左の行番号（ステップ番号）欄の幅[px]。 */
  stepGutterPx: number;
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
  /** モニタ中の通電の見せ方。 */
  monitorStyle: SkinMonitorStyle;
  /**
   * 左の行番号欄に出す数（回路ブロックの**先頭行**にだけ出す）。
   * `step` は回路ブロックをまたいだ通し行数（GX Works3風・PCwin風・JW-300SP風のステップ番号）、
   * `rung` は回路ブロックの通し番号（CX-Programmer風の「ラング番号」）。△
   */
  stepNumbering: SkinStepNumbering;
  /**
   * デバイスコメントを記号の下に何行で出すか。
   * **命令ボックス（`timerStyle: 'box'` のタイマ・カウンタなど）のセルは常に0行**である
   * （箱がセルの高さをほぼ使い切るため。`LadderGrid` が判断する）。
   */
  commentLines: 0 | 1 | 2;
  /**
   * 回路入力欄の見出し（メーカーの言葉。Phase 7 設計 §5.3）。
   * GX Works3 風は「回路入力」、CX-Programmer 風は「新規接点」。
   */
  entryTitle: string;
  /**
   * デバイスを確定すると**続けてコメント欄が開く**か（CX-Programmer 風。設計 §5.2 の S4）。
   * 真のスキンでは、もう一度 `Enter` を押すとデバイスコメントごと確定する。省略時は偽。
   */
  entryCommentStep?: boolean;
  /**
   * ツールバーの記号ボタンを**格子へドラッグしても置ける**か（JW-300SP 風。設計 §5.2 の S8）。
   * 「マウスのドラッグ＆ドロップでも回路要素を入れられる」と公開資料で確認できたスキンだけ真。
   * 省略時は偽（押してから格子を選ぶ、ふつうの置き方だけ）。
   */
  dragPlace?: boolean;
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
  '記号の形（接点は縦棒2本・出力は丸・命令は角括弧か箱）と縦棒の間隔（縦棒の高さの約半分）・高さ（セル高の35〜40%）・線の太さ1.2px・丸の直径（利用者が示した三菱の命令記号表の比から作図。表そのものは複製していない）',
  '各社の画面の配置は公開資料から言葉で調べた（出典URLは ladder/skins/<メーカー>.ts の注記にある）。裏づけが取れなかった項目はそのメーカーのファイルに「確認できていない」と明記している',
  '微分接点の矢印は線画（フォントの ↑ / ↓ ではない）で、ここだけ縦棒の間隔を広げている',
  '左の行番号欄は回路ブロックの通し行数（実機のステップ番号は命令の数で進むが、本アプリは中間表現に命令の並びを持たない）',
];
