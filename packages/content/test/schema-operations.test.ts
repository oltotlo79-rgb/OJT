import { describe, expect, it } from 'vitest';
import {
  DurationMsSchema,
  lastOperationMs,
  OperationListSchema,
  OperationSchema,
  pressedAt,
} from '../src/schema/operations.js';

describe('OperationSchema', () => {
  it('accepts a tick-aligned operation', () => {
    expect(OperationSchema.safeParse({ t: 500, target: 'PB1', action: 'press' }).success).toBe(
      true,
    );
  });

  it('rejects a time that is not a multiple of the tick (§7.3)', () => {
    expect(OperationSchema.safeParse({ t: 505, target: 'PB1', action: 'press' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown target or action', () => {
    expect(OperationSchema.safeParse({ t: 0, target: 'PB9', action: 'press' }).success).toBe(false);
    expect(OperationSchema.safeParse({ t: 0, target: 'PB1', action: 'hold' }).success).toBe(false);
  });

  it('rejects an unknown key instead of dropping it (§13 #1)', () => {
    expect(
      OperationSchema.safeParse({ t: 0, target: 'PB1', action: 'press', holdMs: 50 }).success,
    ).toBe(false);
  });
});

describe('OperationListSchema', () => {
  it('accepts a non decreasing list', () => {
    expect(
      OperationListSchema.safeParse([
        { t: 0, target: 'PB1', action: 'press' },
        { t: 0, target: 'PB2', action: 'press' },
        { t: 500, target: 'PB1', action: 'release' },
      ]).success,
    ).toBe(true);
  });

  it('rejects a decreasing list and points at the offending entry', () => {
    const parsed = OperationListSchema.safeParse([
      { t: 1000, target: 'PB1', action: 'press' },
      { t: 500, target: 'PB1', action: 'release' },
    ]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual([1, 't']);
  });
});

describe('DurationMsSchema', () => {
  it('accepts a tick-aligned positive duration', () => {
    expect(DurationMsSchema.safeParse(5000).success).toBe(true);
  });

  it('rejects zero and a misaligned duration', () => {
    expect(DurationMsSchema.safeParse(0).success).toBe(false);
    expect(DurationMsSchema.safeParse(5005).success).toBe(false);
  });
});

describe('pressedAt / lastOperationMs', () => {
  const ops = [
    { t: 100, target: 'PB1', action: 'press' },
    { t: 300, target: 'PB1', action: 'release' },
  ] as const;

  it('folds an operation list', () => {
    expect(pressedAt(ops, 'PB1', 90)).toBe(false);
    expect(pressedAt(ops, 'PB1', 200)).toBe(true);
    expect(pressedAt(ops, 'PB1', 300)).toBe(false);
    expect(pressedAt(ops, 'PB2', 200)).toBe(false);
  });

  it('reports the last operation time', () => {
    expect(lastOperationMs(ops)).toBe(300);
    expect(lastOperationMs([])).toBe(0);
  });
});
