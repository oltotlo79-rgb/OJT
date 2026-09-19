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
  },
  cell: { widthPx: 46, heightPx: 34, strokeWidth: 1.8, barInsetPx: 7, coilRxPx: 9 },
  commentLines: 1,
  assumed: SKIN_ASSUMED,
  // キー割当表は GX Works3風の表を流用している（`packages/plc-dialects/src/jtekt.ts`）。レビュー I7
  keyMapAssumed: true,
};
