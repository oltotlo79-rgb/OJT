import { describe, expect, it } from 'vitest';
import { compareLogs, SignalLog } from '../src/index.js';

/** `X` の変化点列からログを組み立てる（tMs は昇順）。 */
function logOf(points: Array<[number, boolean]>): SignalLog {
  const log = new SignalLog();
  for (const [tMs, value] of points) log.record(tMs, new Map([['X', value]]));
  return log;
}

/** 模範ログ: 1秒ごとに反転するパルス列。 */
function expectedLog(): SignalLog {
  return logOf([
    [0, false],
    [1000, true],
    [2000, false],
    [3000, true],
    [4000, false],
    [5000, true],
    [6000, false],
  ]);
}

describe('compare 再同期', () => {
  it('同一のログは不一致なし', () => {
    expect(compareLogs(expectedLog(), expectedLog(), ['X'])).toEqual([]);
  });

  it('余分なパルスは extra 2件だけにする（以降は再同期）', () => {
    const actual = logOf([
      [0, false],
      [1000, true],
      [2000, false],
      [2500, true],
      [2600, false],
      [3000, true],
      [4000, false],
      [5000, true],
      [6000, false],
    ]);
    const diffs = compareLogs(expectedLog(), actual, ['X']);
    expect(diffs).toHaveLength(2);
    expect(diffs.map((d) => d.reason)).toEqual(['extra', 'extra']);
    expect(diffs.map((d) => d.tMs)).toEqual([2500, 2600]);
  });

  it('パルス欠落は missing 2件だけにする（以降は再同期）', () => {
    const actual = logOf([
      [0, false],
      [1000, true],
      [2000, false],
      [5000, true],
      [6000, false],
    ]);
    const diffs = compareLogs(expectedLog(), actual, ['X']);
    expect(diffs).toHaveLength(2);
    expect(diffs.map((d) => d.reason)).toEqual(['missing', 'missing']);
    expect(diffs.map((d) => d.tMs)).toEqual([3000, 4000]);
  });

  it('1エッジだけずれたら timing 1件だけにする', () => {
    const actual = logOf([
      [0, false],
      [1300, true],
      [2000, false],
      [3000, true],
      [4000, false],
      [5000, true],
      [6000, false],
    ]);
    const diffs = compareLogs(expectedLog(), actual, ['X']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      tMs: 1000,
      signal: 'X',
      reason: 'timing',
      actualTMs: 1300,
      allowedMs: 200,
    });
  });

  it('反転した波形は全エッジが value の不一致', () => {
    const actual = logOf([
      [0, true],
      [1000, false],
      [2000, true],
      [3000, false],
      [4000, true],
      [5000, false],
      [6000, true],
    ]);
    const diffs = compareLogs(expectedLog(), actual, ['X']);
    expect(diffs).toHaveLength(7);
    expect(diffs.every((d) => d.reason === 'value')).toBe(true);
  });

  it('模範ログに無い信号は unknown-signal', () => {
    const diffs = compareLogs(expectedLog(), expectedLog(), ['PL9']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      tMs: 0,
      signal: 'PL9',
      expected: undefined,
      actual: undefined,
      reason: 'unknown-signal',
    });
  });
});
