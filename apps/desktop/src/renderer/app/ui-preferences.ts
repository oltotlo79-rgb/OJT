import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/ipc.js';
export const UI_PREFERENCES_EVENT = 'ojt-ui-preferences';
/** SVGの文字も設定倍率に追随させる。描画幅の縮小とは分けて扱う。 */
export function useUiScale(): number {
  const read = (): number => {
    const scale = Number(document.documentElement.style.getPropertyValue('--ui-scale'));
    return Number.isFinite(scale) && scale >= 0.9 && scale <= 1.3 ? scale : 1;
  };
  const [scale, setScale] = useState(read);
  useEffect(() => {
    const refresh = (): void => setScale(read());
    window.addEventListener(UI_PREFERENCES_EVENT, refresh);
    return () => window.removeEventListener(UI_PREFERENCES_EVENT, refresh);
  }, []);
  return scale;
}
/** 起動時・設定変更時に同じテーマを適用する。Canvasにも名札の再配置を知らせる。 */
export function applyUiPreferences(
  settings: Pick<AppSettings, 'uiScale' | 'contrast'> &
    Partial<Pick<AppSettings, 'showBoardLabels'>>,
): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(settings.uiScale ?? DEFAULT_SETTINGS.uiScale));
  root.dataset['contrast'] = settings.contrast ?? DEFAULT_SETTINGS.contrast;
  if (settings.showBoardLabels !== undefined) writeBoardLabels(settings.showBoardLabels);
  window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
}

/**
 * 3Dの名札を出すか（`:root[data-board-labels]`。v2.1.0 監査 U3）。
 * CSS（`global.css`）が `off` のとき盤・PLCの名札を隠す。
 */
function writeBoardLabels(show: boolean): void {
  document.documentElement.dataset['boardLabels'] = show ? 'on' : 'off';
}

/** いま3Dの名札を出しているか（設定を読む前・印が無いときは既定＝出す）。 */
export function boardLabelsVisible(): boolean {
  return document.documentElement.dataset['boardLabels'] !== 'off';
}

/** 3Dの名札の表示を切り替える（画面へすぐ反映し、名札の重なり取りにも知らせる）。 */
export function applyBoardLabels(show: boolean): void {
  writeBoardLabels(show);
  window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
}

/** 3Dの名札を出しているか（切替に追随する）。 */
export function useBoardLabelsVisible(): boolean {
  const [visible, setVisible] = useState(boardLabelsVisible);
  useEffect(() => {
    const refresh = (): void => setVisible(boardLabelsVisible());
    window.addEventListener(UI_PREFERENCES_EVENT, refresh);
    return () => window.removeEventListener(UI_PREFERENCES_EVENT, refresh);
  }, []);
  return visible;
}
