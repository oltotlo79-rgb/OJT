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
export function applyUiPreferences(settings: Pick<AppSettings, 'uiScale' | 'contrast'>): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(settings.uiScale ?? DEFAULT_SETTINGS.uiScale));
  root.dataset['contrast'] = settings.contrast ?? DEFAULT_SETTINGS.contrast;
  window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
}
