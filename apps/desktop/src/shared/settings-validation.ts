import { UI_SCALES, type AppSettings } from './ipc.js';

/** rendererとmainで同じ入力条件を使い、保存されなかった理由をその場で示す。 */
export const MAX_USER_CONTENT_DIR_LENGTH = 260;

export function validUserContentDir(value: string): boolean {
  return (
    value.length === 0 ||
    (value.length <= MAX_USER_CONTENT_DIR_LENGTH && /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value))
  );
}

export function isUiScale(value: unknown): value is AppSettings['uiScale'] {
  return UI_SCALES.some((scale) => scale === value);
}
