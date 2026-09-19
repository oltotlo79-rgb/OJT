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
  cell: { widthPx: 50, heightPx: 38, strokeWidth: 1.6, barInsetPx: 8, coilRxPx: 9 },
  commentLines: 1,
  assumed: SKIN_ASSUMED,
  // キー割当表は GX Works3風の表を流用している（`packages/plc-dialects/src/sharp.ts`）。レビュー I7
  keyMapAssumed: true,
};
