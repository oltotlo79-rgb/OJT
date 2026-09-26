import { MAX_WIRES_PER_TERMINAL, partId, terminalId, type WireColor } from '@ojt/circuit-sim';
import { MOUNTABLE_KINDS, type MountableKind } from './catalog.js';
import {
  BLOCK_TERMINAL_Z_MM,
  JIPM_BOARD,
  WIRE_RUN_Y_Z_MM,
  type BoardDefinition,
  type BoardTerminal,
  type FixedLink,
} from './board-jipm.js';

export const TRAINING_CHECK_IDS = [
  'wireColorRule',
  'terminalLimit',
  'unusedParts',
  'forbiddenCircuit',
  'coilPolarity',
  'powerSequence',
] as const;
export interface TrainingRuleProfile {
  id: 'standard' | 'free';
  allowedColors: readonly WireColor[];
  maxWiresPerTerminal: 2 | 3 | 4;
  allowedParts?: readonly MountableKind[] | undefined;
  hintPolicy?: 'task' | 'always' | 'off' | undefined;
  staticChecks?: Partial<Record<(typeof TRAINING_CHECK_IDS)[number], boolean>> | undefined;
}
export interface BoardProfile {
  id: 'expanded';
  terminalPairs: number;
  extraPushButtons: number;
  extraLamps: number;
  rules: TrainingRuleProfile;
}
export const STANDARD_TRAINING_RULES: TrainingRuleProfile = {
  id: 'standard',
  allowedColors: ['青'],
  maxWiresPerTerminal: 2,
};
export const FREE_TRAINING_RULES: TrainingRuleProfile = {
  id: 'free',
  allowedColors: ['青', '白', '黄'],
  maxWiresPerTerminal: 2,
};

/**
 * 実際に守る1端子あたりの本数の上限（常に {@link MAX_WIRES_PER_TERMINAL} ＝ 2本）。
 *
 * 2026-09-26 利用者指示「同一の端子からは2本までの配線しかできないようにして」により、
 * 自由練習の盤でも2本に統一した。以前の課題・作業ファイルが持つ `maxWiresPerTerminal: 3 | 4`
 * は読めるが、ここで2本に丸める（ねじ1か所に3本以上締めると緩み・発熱の原因になる）。
 */
export function effectiveWireLimit(
  rules?: Pick<TrainingRuleProfile, 'maxWiresPerTerminal'>,
): number {
  return Math.min(rules?.maxWiresPerTerminal ?? MAX_WIRES_PER_TERMINAL, MAX_WIRES_PER_TERMINAL);
}

export function isBoardProfile(value: unknown): value is BoardProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>,
    rules = data['rules'];
  if (
    data['id'] !== 'expanded' ||
    rules === null ||
    typeof rules !== 'object' ||
    Array.isArray(rules)
  )
    return false;
  if (
    !(['terminalPairs', 'extraPushButtons', 'extraLamps'] as const).every(
      (key) =>
        Number.isInteger(data[key]) &&
        Number(data[key]) >= 0 &&
        Number(data[key]) <= (key === 'terminalPairs' ? 8 : 4),
    )
  )
    return false;
  const rule = rules as Record<string, unknown>;
  const parts = rule['allowedParts'],
    checks = rule['staticChecks'];
  if (
    parts !== undefined &&
    (!Array.isArray(parts) ||
      parts.length > MOUNTABLE_KINDS.length ||
      !parts.every((kind: unknown) => MOUNTABLE_KINDS.some((allowed) => allowed === kind)))
  )
    return false;
  if (
    rule['hintPolicy'] !== undefined &&
    (typeof rule['hintPolicy'] !== 'string' ||
      !['task', 'always', 'off'].includes(rule['hintPolicy']))
  )
    return false;
  if (
    checks !== undefined &&
    (checks === null ||
      typeof checks !== 'object' ||
      Array.isArray(checks) ||
      !Object.entries(checks).every(
        ([key, value]) =>
          (TRAINING_CHECK_IDS as readonly string[]).includes(key) && typeof value === 'boolean',
      ))
  )
    return false;
  return (
    rule['id'] === 'free' &&
    [2, 3, 4].includes(Number(rule['maxWiresPerTerminal'])) &&
    typeof rule['maxWiresPerTerminal'] === 'number' &&
    Array.isArray(rule['allowedColors']) &&
    rule['allowedColors'].length > 0 &&
    rule['allowedColors'].length <= 3 &&
    rule['allowedColors'].every(
      (color: unknown) => typeof color === 'string' && ['青', '白', '黄'].includes(color),
    )
  );
}

/** 形状・端子・部品を同じデータから作る。既定盤には一切追加しない。 */
export function withBoardProfile(base: BoardDefinition, profile?: BoardProfile): BoardDefinition {
  if (profile === undefined) return base;
  if (!isBoardProfile(profile)) throw new Error('自由盤の設定が不正です。');
  if (JSON.stringify(base.profile) === JSON.stringify(profile)) return base;
  if (base.profile !== undefined) throw new Error('異なる自由盤を重ねて適用できません。');
  const terminals = [...base.terminals],
    links: FixedLink[] = [...base.fixedLinks],
    buttons = [...base.pushButtons],
    lamps = [...base.lamps];
  const footprints = [...base.footprints];
  const addTerminal = (
    part: string,
    name: string,
    label: string,
    role: BoardTerminal['role'],
    x: number,
    y: number,
  ): void => {
    terminals.push({
      id: terminalId(part, name),
      label,
      role,
      pos: { x, y, z: BLOCK_TERMINAL_Z_MM },
      pickRadiusMm: 4,
      wirable: true,
      optional: false,
      exit: 'either',
    });
  };
  for (let n = 0; n < profile.terminalPairs; n++) {
    const x = 370 + n * 18;
    addTerminal('TB_AUX', `${n + 1}a`, `中継${n + 1}a`, 'com', x, 16);
    addTerminal('TB_AUX', `${n + 1}b`, `中継${n + 1}b`, 'com', x, 28);
    links.push({
      id: `aux-${n + 1}`,
      from: terminalId('TB_AUX', `${n + 1}a`),
      to: terminalId('TB_AUX', `${n + 1}b`),
      color: '青',
    });
  }
  for (let n = 0; n < profile.extraPushButtons; n++) {
    const number = n + 5,
      x = 370 + n * 48,
      y = 205;
    buttons.push({
      id: partId(`PB${number}`),
      panelLabel: `PB${number}`,
      color: '緑',
      pos: { x, y, z: 7 },
      panelHole: { x, y: y - 11, z: 0 },
    });
    for (const [index, sign] of (['c', 'a', 'b'] as const).entries()) {
      addTerminal('TB_PB', `${number}${sign}`, `PB${number} ${sign}`, sign, x - 9 + index * 9, 172);
      links.push({
        id: `aux-pb-${number}-${sign}`,
        from: terminalId('TB_PB', `${number}${sign}`),
        to: terminalId(`PB${number}`, sign),
        color: '青',
      });
    }
    footprints.push({ id: `PB${number}`, kind: 'button', x: x - 9, y: y - 9, w: 18, h: 18 });
  }
  for (let n = 0; n < profile.extraLamps; n++) {
    const number = n + 5,
      x = 370 + n * 48,
      y = 105;
    lamps.push({
      id: partId(`PL${number}`),
      panelLabel: `PL${number}`,
      color: '緑',
      pos: { x, y, z: 7 },
      panelHole: { x, y: y - 11, z: 0 },
    });
    for (const [index, sign] of (['+', '-'] as const).entries()) {
      addTerminal(
        'TB_PL',
        `${number}${sign}`,
        `PL${number} ${sign}`,
        sign,
        x - 5 + index * 10,
        130,
      );
      links.push({
        id: `aux-pl-${number}-${sign}`,
        from: terminalId('TB_PL', `${number}${sign}`),
        to: terminalId(`PL${number}`, sign),
        color: '青',
      });
    }
    footprints.push({ id: `PL${number}`, kind: 'lamp', x: x - 10, y: y - 10, w: 20, h: 20 });
  }
  if (profile.terminalPairs > 0)
    footprints.push({
      id: 'TB_AUX',
      kind: 'block',
      x: 364,
      y: 10,
      w: (profile.terminalPairs - 1) * 18 + 12,
      h: 24,
    });
  if (profile.extraPushButtons > 0)
    footprints.push({
      id: 'TB_PB_EXT',
      kind: 'block',
      x: 355,
      y: 166,
      w: (profile.extraPushButtons - 1) * 48 + 30,
      h: 12,
    });
  if (profile.extraLamps > 0)
    footprints.push({
      id: 'TB_PL_EXT',
      kind: 'block',
      x: 359,
      y: 124,
      w: (profile.extraLamps - 1) * 48 + 22,
      h: 12,
    });
  const width = 550;
  return {
    ...base,
    profile: structuredClone(profile),
    displayName: `${base.displayName}＋自由練習用拡張盤`,
    sizeMm: { ...base.sizeMm, width },
    terminals,
    fixedLinks: links,
    pushButtons: buttons,
    lamps,
    footprints,
    wiringChannels: [
      ...base.wiringChannels.map((channel) =>
        channel.axis === 'x' ? { ...channel, to: width - 10 } : channel,
      ),
      { id: 'ch-extension', axis: 'y', at: 340, from: 16, to: 224, zMm: WIRE_RUN_Y_Z_MM },
      { id: 'ch-extension-right', axis: 'y', at: 538, from: 16, to: 224, zMm: WIRE_RUN_Y_Z_MM },
    ],
  };
}

export function boardFromProfile(profile?: BoardProfile): BoardDefinition {
  return withBoardProfile(JIPM_BOARD, profile);
}
