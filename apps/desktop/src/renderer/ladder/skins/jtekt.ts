import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/**
 * PCwin風（JTEKT）。灰地・太い線・**下部ステータスバー**（§10.6 の画面構成）。§17.1
 * ツリーは5分類（プログラム／データファイル／パラメータ／LD／SFC）を出すので少し広い。
 */
export const JTEKT_SKIN: SkinTheme = {
  id: 'jtekt',
  titleBar: 'PCwin 風',
  layout: { treeWidthPx: 260, outputPane: 'status-bar', outputHeightPx: 150 },
  statusItems: ['mode', 'plc-state', 'scan', 'device-count'],
  colors: {
    canvas: '#EDEFF2',
    grid: '#DCE0E6',
    rail: '#333A42',
    symbol: '#12212E',
    device: '#12212E',
    preset: '#5A626B',
    comment: '#8A5A00',
    cursor: '#E08A1E',
    error: '#C0392B',
    powered: '#E08A1E',
    toolbar: '#E2E5EA',
    titleBar: '#40546B',
    titleBarText: '#FFFFFF',
    statusBar: '#D8DCE2',
    output: '#F6F7F9',
    // 未変換の回路ブロックの背景（`F4` が通ると `canvas` へ戻る）。一次資料未確認の △。§5.4
    unconverted: '#D8DCE1',
  },
  /*
   * 46×36px。接点＝縦棒2本（高さ 14px＝セル高の 38.9%・間隔 8px＝縦棒の高さの 0.57・線 1.2px）、
   * 出力＝**丸**（直径 14px＝縦棒の高さ）、TIM / CNT / SET / RST / MC / MCR / END＝**命令ボックス**。
   * 調べた出典（2026-09-20。画像は一切複製せず、形と配置の記述だけを取った）:
   *   - JTEKT 公式 PCwin カタログ CAT-M2067-1
   *     出典: docs/reference/ladder-skin-sources.md #1
   *     …… 接点は縦棒2本・b接点は斜線1本／**コイルは丸「○」**（括弧ではない。利用者の
   *     「出力は丸」と一致）／OR分岐は主ラインの**下の行**に置いて縦棒で合流／デバイス名は
   *     記号の**左上**／ステップ番号は左バスバーのすぐ左（例 `00049`）。
   * 出典と食い違うところ（今回は直していない。△）: 回路コメントはカタログでは**コイルの右**に
   * 出るが、本アプリは他の3スキンと同じく記号の下に出す。モニタの強調はカタログでは行全体の
   * **薄い水色の背景**だが、本アプリは方言の通電色（橙）のパワーフローのままである（通電色は
   * `plc-dialects` が持つのでこのファイルだけでは変えられない）。§17.1
   */
  cell: {
    widthPx: 46,
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
  // 通電は橙のパワーフロー。△
  monitorStyle: 'flow',
  // 回路ブロックの先頭行にステップ番号（行の通し）を出す。△
  stepNumbering: 'step',
  commentLines: 1,
  entryTitle: '回路入力',
  assumed: SKIN_ASSUMED,
  // キー割当表は GX Works3風の表を流用している（`packages/plc-dialects/src/jtekt.ts`）。レビュー I7
  keyMapAssumed: true,
};
