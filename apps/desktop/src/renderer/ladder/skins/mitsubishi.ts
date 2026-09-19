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
  cell: { widthPx: 48, heightPx: 36, strokeWidth: 1.6, barInsetPx: 8, coilRxPx: 9 },
  commentLines: 1,
  assumed: SKIN_ASSUMED,
};
