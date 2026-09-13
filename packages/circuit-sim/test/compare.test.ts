import { describe, expect, it } from 'vitest';
import { allowedShiftMs, compareLogs, DEFAULT_TOLERANCE, SignalLog } from '../src/index.js';

function logOf(points: Array<[number, boolean]>): SignalLog {
  const log = new SignalLog();
  for (const [tMs, value] of points) log.record(tMs, new Map([['PL1', value]]));
  return log;
}

describe('compare', () => {
  it('既定の許容差は 200ms と 10%（§7.4）', () => {
    expect(DEFAULT_TOLERANCE).toEqual({ edgeMs: 200, ratio: 0.1 });
    expect(allowedShiftMs(0, DEFAULT_TOLERANCE)).toBe(200);
    expect(allowedShiftMs(1000, DEFAULT_TOLERANCE)).toBe(200);
    expect(allowedShiftMs(5000, DEFAULT_TOLERANCE)).toBe(500);
  });

  it('許容差内のずれは不一致にしない', () => {
    const want = logOf([
      [0, false],
      [1000, true],
    ]);
    const got = logOf([
      [0, false],
      [1200, true],
    ]);
    expect(compareLogs(want, got, ['PL1'])).toEqual([]);
  });

  it('許容差を超えたずれは timing の不一致', () => {
    const want = logOf([
      [0, false],
      [1000, true],
    ]);
    const got = logOf([
      [0, false],
      [1210, true],
    ]);
    const diffs = compareLogs(want, got, ['PL1']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      tMs: 1000,
      signal: 'PL1',
      expected: true,
      actual: true,
      reason: 'timing',
      actualTMs: 1210,
      allowedMs: 200,
    });
  });

  it('値違い・遷移不足・余分な遷移を区別する', () => {
    const want = logOf([
      [0, false],
      [1000, true],
      [2000, false],
    ]);
    const value = compareLogs(want, logOf([[0, true]]), ['PL1']);
    expect(value[0]?.reason).toBe('value');
    const missing = compareLogs(
      want,
      logOf([
        [0, false],
        [1000, true],
      ]),
      ['PL1'],
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ tMs: 2000, reason: 'missing', actual: undefined });
    const extra = compareLogs(
      logOf([
        [0, false],
        [1000, true],
      ]),
      want,
      ['PL1'],
    );
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({ tMs: 2000, reason: 'extra', expected: undefined });
  });

  it('区間長の10%規則が長い区間で効く（§7.4）', () => {
    const want = logOf([
      [0, false],
      [1000, true],
      [6000, false],
    ]);
    const got = logOf([
      [0, false],
      [1000, true],
      [6400, false],
    ]);
    expect(compareLogs(want, got, ['PL1'])).toEqual([]);
    expect(compareLogs(want, got, ['PL1'], { edgeMs: 200, ratio: 0 })).toHaveLength(1);
  });
});
