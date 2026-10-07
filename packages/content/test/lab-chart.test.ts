import { describe, expect, it } from 'vitest';
import {
  buildTimeChart,
  compareWithExpected,
  createAssembleLabProblem,
  expectedFrom,
  expectedFromChart,
  expectedIntervals,
  inputIntervals,
  labChartSignals,
  labExpectedChart,
  labExpectedLog,
  logFromChart,
  normalizeIntervals,
  operationsFromInputs,
  paintIntervals,
  totalLength,
  valueAt,
  type Operation,
} from '../src/index.js';

/**
 * 「回路実験」「PLC実験」のタイムチャートの変換（2026-10-08 利用者指示）。
 * 設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §4.1
 */
describe('区間の正規化と塗り', () => {
  it('重なり・接触を1つにまとめ、端を切り詰め、長さ0を捨てる', () => {
    expect(
      normalizeIntervals(
        [
          [3_000, 4_000],
          [500, 1_000],
          [800, 1_200],
          [1_200, 1_500],
          [2_000, 2_000],
          [-100, 200],
          [9_000, 12_000],
        ],
        10_000,
      ),
    ).toEqual([
      [0, 200],
      [500, 1_500],
      [3_000, 4_000],
      [9_000, 10_000],
    ]);
  });

  it('点灯で塗るとつながり、消灯で塗ると中が抜ける（左右どちら向きのドラッグも同じ）', () => {
    const base = [
      [1_000, 2_000],
      [3_000, 4_000],
    ] as const;
    expect(paintIntervals(base, 1_500, 3_500, true, 10_000)).toEqual([[1_000, 4_000]]);
    expect(paintIntervals(base, 3_500, 1_500, true, 10_000)).toEqual([[1_000, 4_000]]);
    expect(paintIntervals(base, 1_500, 3_500, false, 10_000)).toEqual([
      [1_000, 1_500],
      [3_500, 4_000],
    ]);
    expect(paintIntervals(base, 0, 10_000, false, 10_000)).toEqual([]);
    expect(paintIntervals([], 9_500, 11_000, true, 10_000)).toEqual([[9_500, 10_000]]);
  });

  it('値と長さ', () => {
    const intervals = [
      [1_000, 2_000],
      [3_000, 4_000],
    ] as const;
    expect(valueAt(intervals, 999)).toBe(false);
    expect(valueAt(intervals, 1_000)).toBe(true);
    expect(valueAt(intervals, 2_000)).toBe(false);
    expect(totalLength(intervals)).toBe(2_000);
  });
});

describe('入力（操作列）と区間の往復', () => {
  const operations: Operation[] = [
    { t: 500, target: 'PB1', action: 'press' },
    { t: 800, target: 'PB1', action: 'release' },
    { t: 800, target: 'PB2', action: 'press' },
    { t: 3_000, target: 'PB2', action: 'release' },
    { t: 4_000, target: 'PB4', action: 'press' },
  ];

  it('押している区間（押したまま終わるものは終わりまで）', () => {
    expect(inputIntervals(operations, 5_000)).toEqual({
      PB1: [[500, 800]],
      PB2: [[800, 3_000]],
      PB3: [],
      PB4: [[4_000, 5_000]],
    });
  });

  it('区間から操作列に戻すと元と同じ（同じ時刻は離すが先、押ボタンは PB1→PB4 の順）', () => {
    expect(operationsFromInputs(inputIntervals(operations, 5_000), 5_000)).toEqual(operations);
    expect(
      operationsFromInputs(
        {
          PB2: [[1_000, 2_000]],
          PB1: [
            [1_000, 1_500],
            [2_000, 2_500],
          ],
        },
        5_000,
      ),
    ).toEqual([
      { t: 1_000, target: 'PB1', action: 'press' },
      { t: 1_000, target: 'PB2', action: 'press' },
      { t: 1_500, target: 'PB1', action: 'release' },
      { t: 2_000, target: 'PB2', action: 'release' },
      { t: 2_000, target: 'PB1', action: 'press' },
      { t: 2_500, target: 'PB1', action: 'release' },
    ]);
  });

  it('作った操作列は実験の課題として検証を通る', () => {
    const problem = createAssembleLabProblem({
      durationMs: 5_000,
      operations: operationsFromInputs(
        {
          PB1: [
            [0, 300],
            [300, 600],
            [4_900, 5_000],
          ],
          PB3: [[2_000, 5_000]],
        },
        5_000,
      ),
    });
    expect(problem.operations).toEqual([
      { t: 0, target: 'PB1', action: 'press' },
      { t: 600, target: 'PB1', action: 'release' },
      { t: 2_000, target: 'PB3', action: 'press' },
      { t: 4_900, target: 'PB1', action: 'press' },
    ]);
  });
});

describe('正解', () => {
  const source = {
    durationMs: 5_000,
    operations: [
      { t: 500, target: 'PB1', action: 'press' },
      { t: 800, target: 'PB1', action: 'release' },
    ] satisfies Operation[],
    expected: [
      {
        signal: 'PL1' as const,
        on: [
          [500, 1_000],
          [4_000, 5_000],
        ] as [number, number][],
      },
    ],
  };

  it('ランプごとの区間（書いていないランプは消灯）と、その逆変換', () => {
    const rows = expectedIntervals(source.expected);
    expect(rows).toEqual({
      PL1: [
        [500, 1_000],
        [4_000, 5_000],
      ],
      PL2: [],
      PL3: [],
      PL4: [],
    });
    expect(expectedFrom(rows, 5_000)).toEqual(source.expected);
    expect(expectedIntervals(undefined).PL4).toEqual([]);
  });

  it('信号ログは t=0 に全信号の初期値を持ち、終わりちょうどの消灯は書かない', () => {
    const log = labExpectedLog(source);
    expect(log.transitions('PL1').map((entry) => [entry.tMs, entry.value])).toEqual([
      [0, false],
      [500, true],
      [1_000, false],
      [4_000, true],
    ]);
    expect(log.transitions('PB1').map((entry) => [entry.tMs, entry.value])).toEqual([
      [0, false],
      [500, true],
      [800, false],
    ]);
    expect(log.transitions('PL3').map((entry) => [entry.tMs, entry.value])).toEqual([[0, false]]);
  });

  it('正解のチャートは押ボタン4行・ランプ4行で、取り込むと元の正解に戻る', () => {
    const chart = labExpectedChart(source);
    expect(chart.signals.map((signal) => signal.name)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
    expect(expectedFromChart(chart)).toEqual(source.expected);
    expect(logFromChart(chart).transitions('PL1')).toEqual(
      labExpectedLog(source).transitions('PL1'),
    );
  });

  it('正解と実際のチャートを比べ直す（許容差の中なら一致、判定するランプだけを見る）', () => {
    const problem = createAssembleLabProblem(source);
    const actualWithin = buildTimeChart(
      labExpectedLog({
        ...source,
        expected: [
          {
            signal: 'PL1',
            on: [
              [520, 1_020],
              [4_020, 5_000],
            ],
          },
        ],
      }),
      labChartSignals(),
      5_000,
    );
    expect(compareWithExpected(problem, actualWithin)).toEqual([]);

    const actualWrong = buildTimeChart(
      labExpectedLog({ ...source, expected: [{ signal: 'PL2', on: [[500, 1_000]] }] }),
      labChartSignals(),
      5_000,
    );
    expect(compareWithExpected(problem, actualWrong).map((m) => m.signal)).toContain('PL1');
    expect(compareWithExpected(problem, actualWrong).map((m) => m.signal)).toContain('PL2');
    expect(
      compareWithExpected(
        { ...problem, judge: { ...problem.judge, compareSignals: ['PL3'] } },
        actualWrong,
      ),
    ).toEqual([]);
    expect(compareWithExpected({ ...problem, expected: undefined }, actualWrong)).toEqual([]);
  });
});
