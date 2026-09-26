import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLC_PROBLEMS, BUILTIN_PROBLEMS } from '../src/builtin/index.js';
import { judgeReference } from '../src/judge.js';
import { judgePlcReference } from '../src/judge-plc.js';
import type { TimeChart } from '../src/timechart.js';

type Intervals = [number, number][];

function lit(chart: TimeChart, name: string): Intervals {
  const signal = chart.signals.find((item) => item.name === name);
  if (signal === undefined) throw new Error(`${name} がありません`);
  return signal.segments
    .filter((segment) => segment.value)
    .map((segment) => [segment.fromMs, segment.toMs]);
}

function expectLit(chart: TimeChart, name: string, expected: Intervals): void {
  const actual = lit(chart, name);
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([start, end], index) => {
    expect(Math.abs(start - expected[index]![0])).toBeLessThan(60);
    expect(Math.abs(end - expected[index]![1])).toBeLessThan(60);
  });
}

describe('v1.8.0 追加練習の動作', () => {
  it.each([
    [
      'b-101',
      'd-101',
      'PL4',
      [
        [1500, 3500],
        [5500, 7500],
      ],
      [
        [500, 1500],
        [4500, 5500],
        [8500, 9500],
      ],
    ],
    [
      'b-102',
      'd-102',
      'PL2',
      [
        [2500, 3500],
        [6500, 7500],
      ],
      [
        [500, 2500],
        [4500, 6500],
        [8500, 9500],
      ],
    ],
  ] satisfies [string, string, string, Intervals, Intervals][])(
    '%s と %s は再実行時の停止・復帰も課題文どおり',
    (assembleId, plcId, secondLamp, secondExpected, firstExpected) => {
      const assembled = BUILTIN_PROBLEMS.find((problem) => problem.id === assembleId);
      const plc = BUILTIN_PLC_PROBLEMS.find((problem) => problem.id === plcId);
      if (assembled === undefined || plc === undefined) throw new Error('追加課題がありません');
      const boardJudge = judgeReference(assembled, JIPM_BOARD);
      const plcJudge = judgePlcReference(plc, JIPM_BOARD);
      if (!boardJudge.ok || !plcJudge.ok) throw new Error('模範の検査に失敗しました');
      expect(boardJudge.value.passed).toBe(true);
      expect(plcJudge.value.passed).toBe(true);
      for (const chart of [boardJudge.value.charts.expected, plcJudge.value.charts.expected]) {
        expectLit(chart, 'PL1', firstExpected);
        expectLit(
          chart,
          chart === boardJudge.value.charts.expected ? secondLamp : 'PL2',
          secondExpected,
        );
      }
    },
  );
});
