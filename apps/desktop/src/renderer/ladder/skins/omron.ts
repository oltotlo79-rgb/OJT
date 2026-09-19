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
  // コイルは「やや扁平」（「実物との対応」表）＝ `coilRxPx` を 9 より小さくする
  cell: { widthPx: 52, heightPx: 40, strokeWidth: 1.4, barInsetPx: 10, coilRxPx: 7 },
  commentLines: 2,
  assumed: SKIN_ASSUMED,
};
