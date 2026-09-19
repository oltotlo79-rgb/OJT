import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/** CX-Programmer風（OMRON）。白地・細い線・コメント2行。§10.6 / §17.1 */
export const OMRON_SKIN: SkinTheme = {
  id: 'omron',
  titleBar: 'CX-Programmer 風',
  layout: { treeWidthPx: 220, outputPane: 'window', outputHeightPx: 140 },
  statusItems: ['mode', 'plc-state', 'scan'],
  colors: {
    canvas: '#FFFFFF',
    grid: '#E3E8EE',
    rail: '#1F1F1F',
    symbol: '#000000',
    device: '#101418',
    preset: '#4A5560',
    comment: '#0B6E4F',
    cursor: '#2FA02C',
    error: '#C62828',
    powered: '#2FA02C',
    toolbar: '#F2F4F6',
    titleBar: '#1F5C99',
    titleBarText: '#FFFFFF',
    statusBar: '#EAEEF2',
    output: '#FBFCFD',
  },
  /*
   * 接点＝縦棒2本（間隔 9px＝セル幅の 17.3%）、出力＝**丸**（半径 14px）、
   * TIM / CNT / SET / RSET / IL / ILC / END＝**命令ボックス**（命令語を1行目、オペランドを
   * 続く行に出す CX-Programmer の見え方）。I/Oコメントを記号の下に2行出すぶん、セルは
   * 4スキンでいちばん背が高い。△（一般に知られた見え方から作図。§17.1）
   */
  cell: {
    widthPx: 52,
    heightPx: 60,
    strokeWidth: 1.4,
    barInsetPx: 16,
    contactGapPx: 9,
    coilRxPx: 14,
    instructionStyle: 'box',
    timerStyle: 'box',
    stepGutterPx: 26,
  },
  // 通電は緑の「パワーフロー」（線と記号を太く色づける）。△
  monitorStyle: 'flow',
  commentLines: 2,
  assumed: SKIN_ASSUMED,
};
