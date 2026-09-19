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
   * 接点＝縦棒2本（間隔 8px＝セル幅の 16.7%）、出力＝**丸**（半径 11px＝縦棒の高さの半分）、
   * SET / RST / MC / MCR / END＝**角括弧**（`[SET Y0]`）、タイマ・カウンタ＝丸コイルに
   * 設定値を添える（`OUT T0 K30`）。△（一般に知られた GX Works3 の見え方から作図。
   * 純正の画面キャプチャ・図記号ビットマップは使っていない。§17.1）
   */
  cell: {
    widthPx: 48,
    heightPx: 46,
    strokeWidth: 1.6,
    barInsetPx: 12,
    contactGapPx: 8,
    coilRxPx: 11,
    instructionStyle: 'bracket',
    timerStyle: 'coil',
    stepGutterPx: 26,
  },
  // 通電中の記号の裏に青い帯を敷く（GX Works3 のモニタの見え方）。△
  monitorStyle: 'block',
  commentLines: 1,
  assumed: SKIN_ASSUMED,
};
