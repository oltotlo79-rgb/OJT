import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/** JW-300SP風（シャープ）。淡青灰の地。§10.6 / §17.1 */
export const SHARP_SKIN: SkinTheme = {
  id: 'sharp',
  titleBar: 'JW-300SP 風',
  layout: { treeWidthPx: 220, outputPane: 'window', outputHeightPx: 150 },
  statusItems: ['mode', 'network', 'plc-state'],
  colors: {
    canvas: '#F2F5F7',
    grid: '#F2F5F7',
    rail: '#2C3E50',
    symbol: '#102A3C',
    device: '#102A3C',
    preset: '#546A79',
    comment: '#00647A',
    cursor: '#00A0C8',
    error: '#B03A3A',
    powered: '#00A0C8',
    toolbar: '#E7ECEF',
    titleBar: '#1E6F86',
    titleBarText: '#FFFFFF',
    statusBar: '#DCE3E7',
    output: '#FAFCFD',
  },
  /*
   * 50×36px。接点＝縦棒2本（高さ 14px＝セル高の 38.9%・間隔 8px＝縦棒の高さの 0.57・線 1.2px）、
   * 出力＝**丸**（直径 14px＝縦棒の高さ）、TMR / CNT / SET / RST / F-47 / F-48 / F-40＝
   * **命令ボックス**（`TMR00000` のような8文字のデバイスが入るので、4スキンで2番目に広い）。
   * 調べた出典（2026-09-20。画像は一切複製せず、記述だけを取った）:
   *   - シャープ 公式 JW300 ラダー命令マニュアル
   *     https://jp.sharp/sms/pdf/plc/jw300/m_jw300l_5.pdf
   *     …… `F-40` ＝ END で各プログラムブロックの最終アドレスに入る／デバイス番号は6桁
   *     （8進表記、0〜7）／タイマ `T00000`〜`T17777`・カウンタ `C00000`〜`C17777`／基本命令は
   *     `STR` `STR NOT` `AND` `AND NOT` `OR` `OR NOT` `OUT`、追加命令に `STR POS` `STR NEG` など。
   * **4スキンでいちばん裏づけが薄い**（△）: 接点・コイルの実際の描画形状（丸か括弧か・線の
   * 太さ）と編集画面の格子・行間隔・コメント位置は、公開資料の画像がOCRできず確認できて
   * いない。形は利用者の指示（出力は丸）と三菱の記号表の比に合わせている。§17.1
   */
  cell: {
    widthPx: 50,
    heightPx: 36,
    strokeWidth: 1.2,
    barInsetPx: 11,
    contactGapPx: 8,
    pulseGapPx: 8,
    coilRxPx: 7,
    commentFontPx: 9,
    instructionStyle: 'box',
    timerStyle: 'box',
    stepGutterPx: 24,
  },
  // 通電は水色のパワーフロー。△
  monitorStyle: 'flow',
  // 回路ブロックの先頭行にステップ番号（行の通し）を出す。△
  stepNumbering: 'step',
  commentLines: 1,
  assumed: SKIN_ASSUMED,
  // キー割当表は GX Works3風の表を流用している（`packages/plc-dialects/src/sharp.ts`）。レビュー I7
  keyMapAssumed: true,
};
