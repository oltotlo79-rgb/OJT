import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/ipc.js';
export const UI_PREFERENCES_EVENT = 'ojt-ui-preferences';
/** 起動時・設定変更時に同じテーマを適用する。Canvasにも名札の再配置を知らせる。 */
export function applyUiPreferences(settings: Pick<AppSettings, 'uiScale' | 'contrast'>): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(settings.uiScale ?? DEFAULT_SETTINGS.uiScale));
  root.dataset['contrast'] = settings.contrast ?? DEFAULT_SETTINGS.contrast;
  window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
}
