import { describe, expect, it } from 'vitest';
import {
  LABEL_WIDTH,
  liveChart,
  PLOT_WIDTH,
  ROW_AMPLITUDE,
  toSegments,
  waveformPoints,
} from '../src/renderer/panels/TimeChartPanel.js';
import { elapsedScale, SCALE_FACTOR } from '../src/renderer/panels/ElapsedTimer.js';
import { elapsedSummary } from '../src/renderer/result/ResultView.js';
import { formatMs } from '../src/renderer/result/MismatchList.js';

describe('waveformPoints', () => {
  it('OFF 区間は下、ON 区間は上を通る矩形波になる', () => {
    const points = waveformPoints(
      [
        { fromMs: 0, toMs: 500, value: false },
        { fromMs: 500, toMs: 1000, value: true },
      ],
      1000,
      50,
    );
    expect(points).toBe(
      `${LABEL_WIDTH}.0,50.0 ${LABEL_WIDTH + PLOT_WIDTH / 2}.0,50.0 ` +
        `${LABEL_WIDTH + PLOT_WIDTH / 2}.0,${(50 - ROW_AMPLITUDE).toFixed(1)} ` +
        `${LABEL_WIDTH + PLOT_WIDTH}.0,${(50 - ROW_AMPLITUDE).toFixed(1)}`,
    );
  });

  it('区間長が0以下なら空文字', () => {
    expect(waveformPoints([{ fromMs: 0, toMs: 1, value: true }], 0, 10)).toBe('');
  });
});

describe('toSegments', () => {
  it('記録が無ければ全区間 OFF', () => {
    expect(toSegments([], 1000)).toEqual([{ fromMs: 0, toMs: 1000, value: false }]);
  });

  it('変化点から区間を作る', () => {
    expect(
      toSegments(
        [
          { tMs: 0, value: false },
          { tMs: 300, value: true },
          { tMs: 700, value: false },
        ],
        1000,
      ),
    ).toEqual([
      { fromMs: 0, toMs: 300, value: false },
      { fromMs: 300, toMs: 700, value: true },
      { fromMs: 700, toMs: 1000, value: false },
    ]);
  });

  it('区間長を超えた変化点は無視する', () => {
    expect(toSegments([{ tMs: 5000, value: true }], 1000)).toEqual([
      { fromMs: 0, toMs: 1000, value: false },
    ]);
  });
});

describe('liveChart', () => {
  it('指定した信号だけを並べる', () => {
    const chart = liveChart(
      [
        { name: 'PB1', label: '黒押ボタン（PB1）', kind: 'input' },
        { name: 'PL1', label: '白ランプ（PL1）', kind: 'output' },
      ],
      { PL1: [{ tMs: 200, value: true }] },
      1000,
    );
    expect(chart.signals.map((s) => s.name)).toEqual(['PB1', 'PL1']);
    expect(chart.signals[1]?.segments).toHaveLength(2);
  });
});

describe('elapsedScale', () => {
  it('打切り時間の1.2倍を全長にして目印を置く', () => {
    const scale = elapsedScale(0, { standardMin: 30, cutoffMin: 50 });
    expect(scale.fill).toBe(0);
    expect(scale.cutoff).toBeCloseTo(1 / SCALE_FACTOR, 5);
    expect(scale.standard).toBeCloseTo(30 / (50 * SCALE_FACTOR), 5);
  });

  it('全長を超えても1で止まる（強制終了はしない）', () => {
    expect(elapsedScale(10 ** 9, { standardMin: 30, cutoffMin: 50 }).fill).toBe(1);
  });
});

describe('elapsedSummary', () => {
  it('標準時間以内・超過・打切り超過を言い分ける', () => {
    expect(elapsedSummary(10 * 60_000, 30, 50)).toContain('以内');
    expect(elapsedSummary(40 * 60_000, 30, 50)).toContain('標準時間');
    expect(elapsedSummary(60 * 60_000, 30, 50)).toContain('打切り時間');
  });
});

describe('formatMs', () => {
  it('秒に直して2桁で出す', () => {
    expect(formatMs(1234)).toBe('1.23 s');
  });
});
