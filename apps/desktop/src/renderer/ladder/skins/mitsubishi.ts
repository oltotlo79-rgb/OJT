import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/** GX Works3風（三菱）。「実物との対応」表の三菱列。§10.6 / §17.1 */
export const MITSUBISHI_SKIN: SkinTheme = {
  id: 'mitsubishi',
  titleBar: 'MELSOFT GX Works3 風',
  layout: { treeWidthPx: 240, outputPane: 'window', outputHeightPx: 160 },
  statusItems: ['mode', 'network', 'overwrite'],
  colors: {
    canvas: '#F7F8FA',
    grid: '#F7F8FA',
    rail: '#3A3F47',
    symbol: '#1B1E23',
    device: '#1B1E23',
    preset: '#555555',
    comment: '#1B6AC9',
    cursor: '#1E64FF',
    error: '#D14343',
    powered: '#1E64FF',
    toolbar: '#EDEFF3',
    titleBar: '#2F4A73',
    titleBarText: '#FFFFFF',
    statusBar: '#E6E9EE',
    output: '#FFFFFF',
  },
  /*
   * 48×34px。接点＝縦棒2本（高さ 12px＝セル高の 35.3%・間隔 6px＝縦棒の高さの 0.50・線 1.2px）、
   * 出力＝**丸**（直径 12px＝縦棒の高さ）、SET / RST / MC / MCR / END＝**角括弧**（`[SET Y0]`）、
   * タイマ・カウンタ＝丸コイルの右に設定値を添える（`OUT T0 K30`）。微分接点だけ間隔 8px。
   * 調べた出典（2026-09-20。画像は一切複製せず、形と配置の記述だけを取った）:
   *   - 出典: docs/reference/ladder-skin-sources.md #2 …… 利用者が指定した参照元。左右の母線・
   *     接点は縦棒2本・b接点は斜線1本・上から下へのスキャン順。
   *   - 出典: docs/reference/ladder-skin-sources.md #3 …… END はプログラム末尾に必須、
   *     コイルの後ろに接点を置けない。
   *   - 出典: docs/reference/ladder-skin-sources.md #4 …… タイマ・カウンタは `OUT T0` ＋ `T0 K300`。
   * 出典と食い違うが**利用者の指示が勝つ**ところ: 解説サイトは OUT コイルを `( )` で描くが、
   * 利用者（電気系保全の指導員）の 2026-09-20 の指示「出力は丸」に従って**丸**にしている。
   * デバイスコメントは GX Works3 では記号の**上**に出す設定もあるが、本アプリは行を詰める
   * ため記号の**下**に1行で出す（△）。応用命令の角括弧・OR分岐の合流線の厳密な線引きは
   * 一次資料が見つからず推定のまま（△）。純正の画面キャプチャ・図記号ビットマップは
   * 使っていない（§17.1）。
   */
  cell: {
    widthPx: 48,
    heightPx: 34,
    strokeWidth: 1.2,
    barInsetPx: 11,
    contactGapPx: 6,
    pulseGapPx: 8,
    coilRxPx: 6,
    commentFontPx: 9,
    instructionStyle: 'bracket',
    timerStyle: 'coil',
    stepGutterPx: 24,
  },
  // 通電中の記号の裏に青い帯を敷く（GX Works3 のモニタの見え方）。△
  monitorStyle: 'block',
  // 回路ブロックの先頭行にステップ番号（行の通し）を出す。△
  stepNumbering: 'step',
  commentLines: 1,
  assumed: SKIN_ASSUMED,
};
