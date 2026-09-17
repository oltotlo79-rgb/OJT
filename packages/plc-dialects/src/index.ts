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

import { MITSUBISHI_FX5U } from './mitsubishi.js';
import {
  DIALECT_IDS,
  UnknownDialectError,
  type DialectId,
  type DialectProfile,
} from './profile.js';

/**
 * 実装済みの方言プロファイル。Phase 4 で3つ増える（§16）。
 */
const PROFILES: Partial<Record<DialectId, DialectProfile>> = { mitsubishi: MITSUBISHI_FX5U };

/** 実装済みの方言プロファイル一覧（`DIALECT_IDS` の順）。 */
export function availableDialects(): DialectProfile[] {
  return DIALECT_IDS.map((id) => PROFILES[id]).filter(
    (profile): profile is DialectProfile => profile !== undefined,
  );
}

/** 方言プロファイルを引く。未実装のメーカーは `UnknownDialectError`。 */
export function getDialect(id: DialectId): DialectProfile {
  const profile = PROFILES[id];
  if (profile === undefined) {
    throw new UnknownDialectError(
      `この方言はまだ実装されていません（Phase 4 で追加します）: ${id}`,
    );
  }
  return profile;
}
