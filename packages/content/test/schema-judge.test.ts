import { DEFAULT_TOLERANCE } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  BOARD_OUTPUT_SIGNALS,
  DEFAULT_STATIC_CHECKS,
  defaultCompareSignals,
  JudgeSettingsSchema,
  resolveCompareSignals,
  STATIC_CHECK_IDS,
} from '../src/schema/judge.js';

describe('JudgeSettingsSchema', () => {
  it('fills the spec defaults when the object is empty (§7.4)', () => {
    const parsed = JudgeSettingsSchema.parse({});
    expect(parsed.tolerance).toEqual({ edgeMs: DEFAULT_TOLERANCE.edgeMs, ratio: 0.1 });
    expect(parsed.staticChecks).toEqual(DEFAULT_STATIC_CHECKS);
    expect(parsed.compareSignals).toBeUndefined();
  });

  it('keeps the values the problem gives', () => {
    const parsed = JudgeSettingsSchema.parse({
      compareSignals: ['PL1'],
      tolerance: { edgeMs: 100, ratio: 0.2 },
      staticChecks: { forbiddenCircuit: false },
    });
    expect(parsed.compareSignals).toEqual(['PL1']);
    expect(parsed.tolerance).toEqual({ edgeMs: 100, ratio: 0.2 });
    expect(parsed.staticChecks.forbiddenCircuit).toBe(false);
    expect(parsed.staticChecks.wireColorRule).toBe(true);
  });

  it('rejects an empty compare list and an out of range ratio', () => {
    expect(JudgeSettingsSchema.safeParse({ compareSignals: [] }).success).toBe(false);
    expect(JudgeSettingsSchema.safeParse({ tolerance: { ratio: 2 } }).success).toBe(false);
  });

  it('rejects unknown keys instead of dropping them (§13 #1)', () => {
    expect(JudgeSettingsSchema.safeParse({ edgeMs: 200 }).success).toBe(false);
    expect(JudgeSettingsSchema.safeParse({ tolerance: { edgeMs: 200, ratio2: 0.1 } }).success).toBe(
      false,
    );
    expect(JudgeSettingsSchema.safeParse({ staticChecks: { wireColor: false } }).success).toBe(
      false,
    );
  });
});

describe('compare signal defaults', () => {
  it('uses every output part that exists on the board (§7.4)', () => {
    expect(BOARD_OUTPUT_SIGNALS).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(defaultCompareSignals()).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(defaultCompareSignals(['BZ'])).toEqual(['PL1', 'PL2', 'PL3', 'PL4', 'BZ']);
  });

  it('lets the problem override the list', () => {
    expect(resolveCompareSignals(JudgeSettingsSchema.parse({}), [])).toEqual([
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
    expect(resolveCompareSignals(JudgeSettingsSchema.parse({}), ['BZ'])).toEqual([
      'PL1',
      'PL2',
      'PL3',
      'PL4',
      'BZ',
    ]);
    expect(
      resolveCompareSignals(JudgeSettingsSchema.parse({ compareSignals: ['PL1'] }), ['BZ']),
    ).toEqual(['PL1']);
  });
});

describe('STATIC_CHECK_IDS', () => {
  it('lists the Phase 1 checks in display order (§7.4)', () => {
    expect(STATIC_CHECK_IDS).toEqual([
      'wireColorRule',
      'terminalLimit',
      'unusedParts',
      'forbiddenCircuit',
      'coilPolarity',
      'powerSequence',
    ]);
  });
});
