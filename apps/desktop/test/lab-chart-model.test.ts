import { createAssembleLabProblem, createPlcLabProblem, parseProblem } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import {
  applyRowPaint,
  chartCounts,
  clearExpected,
  clearInputs,
  judgedSignals,
  labRows,
  paintValueAt,
  parseSeconds,
  secondsText,
  segmentsOf,
  setDuration,
  setRowIntervals,
  snapMs,
  toggleJudged,
} from '../src/renderer/lab/chart-model.js';

/**
 * タイムチャートの編集の純関数（2026-10-08）。設計 §6.3
 */
const base = createAssembleLabProblem({
  durationMs: 5_000,
  operations: [
    { t: 500, target: 'PB1', action: 'press' },
    { t: 800, target: 'PB1', action: 'release' },
  ],
  expected: [{ signal: 'PL1', on: [[500, 3_000]] }],
});

function valid(problem: unknown): void {
  const parsed = parseProblem(problem);
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
}

describe('行', () => {
  it('押ボタン4行は操作列から、ランプ4行は正解から作る', () => {
    const rows = labRows(base);
    expect(rows.map((row) => row.signal)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
    expect(rows[0]?.intervals).toEqual([[500, 800]]);
    expect(rows[0]?.label).toBe('黒押ボタン（PB1）');
    expect(rows[4]?.intervals).toEqual([[500, 3_000]]);
    expect(rows[4]?.judged).toBe(true);
    expect(chartCounts(base)).toEqual({ inputs: 1, expectedRows: 1 });
    expect(chartCounts(clearExpected(base)).expectedRows).toBeUndefined();
    expect(chartCounts({ ...base, expected: [] }).expectedRows).toBe(0);
  });
});

describe('塗る', () => {
  it('0.1秒へ吸着し、長さの外へ出ない', () => {
    expect(snapMs(1_234, 5_000)).toBe(1_200);
    expect(snapMs(1_260, 5_000)).toBe(1_300);
    expect(snapMs(-50, 5_000)).toBe(0);
    expect(snapMs(9_999, 5_000)).toBe(5_000);
  });

  it('点いている所から始めたら消し、消えている所からなら点ける', () => {
    const row = { intervals: [[500, 800]] as [number, number][] };
    expect(paintValueAt(row, 600)).toBe(false);
    expect(paintValueAt(row, 800)).toBe(true);
    expect(paintValueAt(row, 100)).toBe(true);
  });

  it('押ボタンの行を塗ると操作列に、ランプの行を塗ると正解に書き戻す', () => {
    const pressed = applyRowPaint(base, 'PB2', 2_000, 2_500, true);
    expect(pressed.operations).toEqual([
      { t: 500, target: 'PB1', action: 'press' },
      { t: 800, target: 'PB1', action: 'release' },
      { t: 2_000, target: 'PB2', action: 'press' },
      { t: 2_500, target: 'PB2', action: 'release' },
    ]);
    valid(pressed);
    const erased = applyRowPaint(base, 'PL1', 1_000, 2_000, false);
    expect(erased.expected).toEqual([
      {
        signal: 'PL1',
        on: [
          [500, 1_000],
          [2_000, 3_000],
        ],
      },
    ]);
    valid(erased);
    // 正解が無い課題でもランプの行を塗れば正解ができる
    const fresh = applyRowPaint(clearExpected(base), 'PL3', 0, 1_000, true);
    expect(fresh.expected).toEqual([{ signal: 'PL3', on: [[0, 1_000]] }]);
  });

  it('終わりまで押し続ける区間は「離す」を書かない', () => {
    const held = setRowIntervals(base, 'PB4', [[4_000, 5_000]]);
    expect(held.operations.at(-1)).toEqual({ t: 4_000, target: 'PB4', action: 'press' });
    valid(held);
  });
});

describe('長さ・消す・判定の印', () => {
  it('長さを縮めると、長さを超える押し方と正解を切り詰める', () => {
    const shorter = setDuration(base, 2_000);
    expect(shorter.durationMs).toBe(2_000);
    expect(shorter.expected).toEqual([{ signal: 'PL1', on: [[500, 2_000]] }]);
    valid(shorter);
    expect(setDuration(base, 500).durationMs).toBe(2_000);
    expect(setDuration(base, 99_000).durationMs).toBe(60_000);
  });

  it('押し方だけ・正解だけを消せる', () => {
    expect(clearInputs(base).operations).toEqual([]);
    expect(clearInputs(base).expected).toEqual(base.expected);
    expect(clearExpected(base).expected).toBeUndefined();
    expect(clearExpected(base).operations).toEqual(base.operations);
  });

  it('判定に使うランプの印（4つなら指定を省き、最後の1つは外せない）', () => {
    const off = toggleJudged(base, 'PL2');
    expect(off.judge.compareSignals).toEqual(['PL1', 'PL3', 'PL4']);
    expect(judgedSignals(off)).toEqual(['PL1', 'PL3', 'PL4']);
    const back = toggleJudged(off, 'PL2');
    expect(back.judge.compareSignals).toBeUndefined();
    let only = createPlcLabProblem({ vendor: 'omron', prewired: true });
    for (const signal of ['PL2', 'PL3', 'PL4'] as const) only = toggleJudged(only, signal);
    expect(only.judge.compareSignals).toEqual(['PL1']);
    expect(toggleJudged(only, 'PL1')).toBe(only);
    valid(only);
  });
});

describe('秒の読み書き', () => {
  it('秒を読む（0.01秒単位まで・全角も読む）', () => {
    expect(parseSeconds('1.5')).toBe(1_500);
    expect(parseSeconds('０．５２')).toBe(520);
    expect(parseSeconds(' 3 ')).toBe(3_000);
    expect(parseSeconds('1.234')).toBeUndefined();
    expect(parseSeconds('-1')).toBeUndefined();
    expect(parseSeconds('abc')).toBeUndefined();
    expect(parseSeconds('7', 5_000)).toBeUndefined();
  });

  it('秒を書く', () => {
    expect(secondsText(1_500)).toBe('1.5');
    expect(secondsText(520)).toBe('0.52');
    expect(secondsText(3_000)).toBe('3');
  });

  it('区間をチャートの区間（点灯と消灯の列）にする', () => {
    expect(segmentsOf([[500, 800]], 2_000)).toEqual([
      { fromMs: 0, toMs: 500, value: false },
      { fromMs: 500, toMs: 800, value: true },
      { fromMs: 800, toMs: 2_000, value: false },
    ]);
    expect(segmentsOf([], 2_000)).toEqual([{ fromMs: 0, toMs: 2_000, value: false }]);
  });
});
