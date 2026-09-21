import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/** CX-Programmer風（OMRON）。白地・細い線・コメント2行。§10.6 / §17.1 */
export const OMRON_SKIN: SkinTheme = {
  id: 'omron',
  titleBar: 'CX-Programmer 風',
  layout: { treeWidthPx: 220, outputPane: 'window', outputHeightPx: 140 },
  colors: {
    canvas: '#FFFFFF',
    grid: '#E3E8EE',
    rail: '#1F1F1F',
    symbol: '#000000',
    device: '#0000AA',
    preset: '#4A5560',
    comment: '#0B6E4F',
    cursor: '#9900CC',
    error: '#C62828',
    powered: '#2FA02C',
    toolbar: '#F2F4F6',
    titleBar: '#1F5C99',
    titleBarText: '#FFFFFF',
    statusBar: '#EAEEF2',
    output: '#FBFCFD',
    // 未変換の回路ブロックの背景（`F4` が通ると `canvas` へ戻る）。一次資料未確認の △。§5.4
    unconverted: '#E6E6E6',
  },
  /*
   * 52×48px。接点＝縦棒2本（高さ 18px＝セル高の 37.5%・間隔 10px＝縦棒の高さの 0.56・線 1.2px）、
   * 出力＝**丸**（直径 18px＝縦棒の高さ）、TIM / CNT / SET / RSET / IL / ILC / END＝
   * **命令ボックス**（命令語を1行目、細い仕切り線の下にオペランドを出す CX-Programmer の
   * 見え方）。I/Oコメントを記号の下に2行出すぶん、セルは4スキンでいちばん背が高い
   * （2行が次の行にかからない最小の高さが 48px）。
   * 調べた出典（2026-09-20。画像は一切複製せず、形と配置の記述だけを取った）:
   *   - OMRON 公式 CX-Programmer 操作マニュアル W446
   *     出典: docs/reference/ladder-skin-sources.md #5
   *     …… 左バスバーの**左側**にラング番号とステップ番号／各セルの接続点にグリッド／
   *     TIM・CNT・MOV は**オペランドボックス**（命令枠）に入る／コイルは右バスバーに整列／
   *     シンボル名とコメントは記号の上または下（設定）／通電中の要素は**太線**（色は原文に
   *     明記なし。本アプリの緑は △）／END は末尾に固定のセクション。
   *   - 出典: docs/reference/ladder-skin-sources.md #6 …… 薄い罫線でセルに区切られた編集画面。
   * 「END(001)」というファンクションコード表記の一次資料は見つからなかったので、END の
   * 綴りは方言（`instructionNames.end`）の `END` のままにしている（△）。§17.1
   */
  cell: {
    widthPx: 52,
    heightPx: 48,
    strokeWidth: 1.2,
    barInsetPx: 15,
    contactGapPx: 10,
    pulseGapPx: 10,
    coilRxPx: 9,
    commentFontPx: 8,
    instructionStyle: 'box',
    timerStyle: 'box',
    stepGutterPx: 24,
  },
  // 通電は緑の「パワーフロー」（線と記号を太く色づける）。△
  monitorStyle: 'flow',
  // CX-Programmer は回路を「ラング」と呼び、左に**ラング番号**が並ぶ。△
  stepNumbering: 'rung',
  commentLines: 2,
  entryTitle: '新規接点',
  // デバイスを確定すると続けてコメント欄が開く（出典 S4）。設計 §5.2
  entryCommentStep: true,
  assumed: SKIN_ASSUMED,
};
