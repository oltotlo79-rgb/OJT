import type { DialectId, DialectProfile } from '@ojt/plc-dialects';
import { skinMonitorColor } from '../../session/plc-skin.js';
import { JTEKT_SKIN } from './jtekt.js';
import { MITSUBISHI_SKIN } from './mitsubishi.js';
import { OMRON_SKIN } from './omron.js';
import { SHARP_SKIN } from './sharp.js';
import type { SkinTheme } from './types.js';

export type { SkinCell, SkinColors, SkinLayout, SkinStatusItem, SkinTheme } from './types.js';
export { SKIN_ASSUMED } from './types.js';

/** 方言ID → スキンの見た目。§10.6 / 決定表#5 */
export const SKIN_THEMES: Readonly<Record<DialectId, SkinTheme>> = {
  mitsubishi: MITSUBISHI_SKIN,
  jtekt: JTEKT_SKIN,
  omron: OMRON_SKIN,
  sharp: SHARP_SKIN,
};

/** そのプロファイルのスキン。 */
export function skinThemeOf(profile: DialectProfile): SkinTheme {
  return SKIN_THEMES[profile.id];
}

/**
 * スキンを CSS カスタムプロパティに直す。決定表#5
 *
 * `.workspace` に**1回だけ**流し込む。子の要素（`LadderGrid` の `memo` が効いている部分）に
 * インラインスタイルを撒かないので、再描画の性質（3B 決定表#5）を壊さない。
 *
 * 表示列数（`ladderGridCols`）はここでは扱わない。列数は SVG の `width` を決める値で、
 * `LadderGrid` が `gridCols` の props として受け取る（CSS には出さない）。
 *
 * @param monitorColor 設定画面の通電色（空なら方言の既定）。決定表#8
 */
export function skinCssVars(
  profile: DialectProfile,
  theme: SkinTheme,
  monitorColor: string,
): Record<string, string> {
  // 通電色の決め方は3箇所に散っていた（`LadderGrid.tsx` / `ProjectTree.tsx` とここ）ので
  // `skinMonitorColor()` の1本に集める（レビュー M13）
  const powered = skinMonitorColor(profile, monitorColor);
  return {
    '--skin-canvas': theme.colors.canvas,
    '--skin-grid': theme.colors.grid,
    '--skin-rail': theme.colors.rail,
    '--skin-symbol': theme.colors.symbol,
    '--skin-device': theme.colors.device,
    '--skin-preset': theme.colors.preset,
    '--skin-comment': theme.colors.comment,
    '--skin-cursor': theme.colors.cursor,
    '--skin-error': theme.colors.error,
    '--skin-powered': powered,
    '--skin-toolbar': theme.colors.toolbar,
    '--skin-title-bar': theme.colors.titleBar,
    '--skin-title-text': theme.colors.titleBarText,
    '--skin-status-bar': theme.colors.statusBar,
    '--skin-output': theme.colors.output,
    // 未変換の回路ブロックの背景（Phase 7 設計 §5.4。`convertStep` のあるメーカーだけが使う）
    '--skin-unconverted': theme.colors.unconverted,
    '--skin-cell-w': `${String(theme.cell.widthPx)}px`,
    '--skin-cell-h': `${String(theme.cell.heightPx)}px`,
    '--skin-stroke': String(theme.cell.strokeWidth),
    '--skin-coil-rx': String(theme.cell.coilRxPx),
    // デバイスコメントの字の大きさもスキンが決める（CX-Programmer風だけ2行なので1px小さい）
    '--skin-comment-size': `${String(theme.cell.commentFontPx)}px`,
    '--skin-step-gutter': `${String(theme.cell.stepGutterPx)}px`,
    '--skin-tree-w': `${String(theme.layout.treeWidthPx)}px`,
    '--skin-output-h': `${String(theme.layout.outputHeightPx)}px`,
  };
}
