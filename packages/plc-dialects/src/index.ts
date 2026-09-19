export { convert, type ConvertError, type ConvertResult } from './convert.js';

export {
  collectDeviceIssues,
  collectDevices,
  makeParseTimerPreset,
  makeTimerPreset,
  type DevicePlace,
  type DeviceRuleSet,
  type DeviceUse,
  type TimerRule,
} from './device-rules.js';

export { GX_STYLE_SHORTCUTS, withoutConvert } from './shortcuts.js';

export { switchNotation, type NotationChange, type NotationSwitchResult } from './notation.js';

export {
  DIALECT_IDS,
  IMPLEMENTED_DIALECT_IDS,
  isDialectId,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  UnknownDialectError,
  type DeviceRange,
  type DialectError,
  type DialectId,
  type DialectProfile,
  type InstructionKey,
  type MonitorColors,
  type PanelLayout,
  type ShortcutEntry,
  type ShortcutTable,
  type SymbolDrawing,
  type TimerPresetText,
} from './profile.js';

export { MITSUBISHI_FX5U, roundTimerPreset, timerBaseMs } from './mitsubishi.js';

export { OMRON_CP1E } from './omron.js';

export { JTEKT_PC10G } from './jtekt.js';

export { SHARP_JW300 } from './sharp.js';

import { JTEKT_PC10G } from './jtekt.js';
import { MITSUBISHI_FX5U } from './mitsubishi.js';
import { OMRON_CP1E } from './omron.js';
import { SHARP_JW300 } from './sharp.js';
import {
  DIALECT_IDS,
  UnknownDialectError,
  type DialectId,
  type DialectProfile,
} from './profile.js';

/** 実装済みの方言プロファイル（`DIALECT_IDS` の順）。§16 Phase 4 */
const PROFILES: Partial<Record<DialectId, DialectProfile>> = {
  mitsubishi: MITSUBISHI_FX5U,
  jtekt: JTEKT_PC10G,
  omron: OMRON_CP1E,
  sharp: SHARP_JW300,
};

/** 実装済みの方言プロファイル一覧（`DIALECT_IDS` の順）。 */
export function availableDialects(): DialectProfile[] {
  return DIALECT_IDS.map((id) => PROFILES[id]).filter(
    (profile): profile is DialectProfile => profile !== undefined,
  );
}

/** 方言プロファイルを引く。未知の方言IDは `UnknownDialectError`。 */
export function getDialect(id: DialectId): DialectProfile {
  const profile = PROFILES[id];
  if (profile === undefined) {
    throw new UnknownDialectError(`対応していない方言IDです: ${id}`);
  }
  return profile;
}
