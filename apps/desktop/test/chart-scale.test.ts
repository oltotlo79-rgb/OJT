import type { TimeChart } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import {
  chartWidth,
  edgeTimes,
  fitChartGeometry,
  LARGE_GEOMETRY,
  msToX,
  nearestSnap,
  niceTickStep,
  operationEdgeTimes,
  SMALL_GEOMETRY,
  tickLabel,
  tickPositions,
  timeReadout,
  xToMs,
} from '../src/renderer/panels/chart-scale.js';

describe('表示幅に合わせるチャート', () => {
  it.each([264, 400, 900])('%ipxでも文字を12px以上に保ち、時間座標を往復できる', (width) => {
    for (const scale of [0.9, 1, 1.15, 1.3]) {
      const geom = fitChartGeometry(SMALL_GEOMETRY, width, scale);
      expect(geom.labelFont).toBeGreaterThanOrEqual(12);
      expect(geom.tickFont).toBeGreaterThanOrEqual(12);
      expect(geom.plotWidth).toBeGreaterThanOrEqual(80);
      expect(chartWidth(geom)).toBe(Math.max(width, geom.labelWidth + geom.rightPad + 80));
      expect(xToMs(msToX(2345, 5000, geom), 5000, geom)).toBeCloseTo(2345);
    }
  });
});

/**
 * タイムチャートの目盛・補助線の純粋関数（Task CHART-UX）。設計仕様 §7.7 / §8.3。
 * 描画に触らずに「見やすさ」の計算だけを固定する。
 */

function chartOf(): TimeChart {
  return {
    durationMs: 5000,
    markers: [{ tMs: 3000, label: 'T1=3秒' }],
    signals: [
      {
        name: 'PB1',
        label: '黒押ボタン（PB1）',
        kind: 'input',
        segments: [
          { fromMs: 0, toMs: 500, value: false },
          { fromMs: 500, toMs: 800, value: true },
          { fromMs: 800, toMs: 5000, value: false },
        ],
      },
      {
        name: 'PL1',
        label: '白ランプ（PL1）',
        kind: 'output',
        segments: [
          { fromMs: 0, toMs: 500, value: false },
          { fromMs: 500, toMs: 2500, value: true },
          { fromMs: 2500, toMs: 5000, value: false },
        ],
      },
    ],
  };
}

describe('niceTickStep', () => {
  it('1・2・5 の刻みから目盛が上限以下になる最小の刻みを選ぶ', () => {
    expect(niceTickStep(5000, 12)).toBe(500);
    expect(niceTickStep(1000, 12)).toBe(100);
    expect(niceTickStep(20_000, 12)).toBe(2000);
    // 5秒刻みだと 0〜60秒で13本になり上限を超えるので10秒刻み（7本）
    expect(niceTickStep(60_000, 12)).toBe(10_000);
  });

  it('どの長さでも目盛は5本以上12本以下になる', () => {
    for (const durationMs of [300, 1000, 2500, 5000, 12_000, 45_000, 180_000]) {
      const count = Math.floor(durationMs / niceTickStep(durationMs, 12)) + 1;
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(12);
    }
  });

  it('長さが0以下でも刻みは正の値', () => {
    expect(niceTickStep(0, 12)).toBeGreaterThan(0);
  });

  it('レビューア指定の対応表（区間長 → 刻み）', () => {
    const table: ReadonlyArray<[number, number]> = [
      [300, 50],
      [1000, 100],
      [5000, 500],
      [12000, 2000],
      [47000, 5000],
      [600000, 100000],
    ];
    for (const [durationMs, expected] of table) {
      expect(niceTickStep(durationMs)).toBe(expected);
    }
  });

  it('広く区間長を振っても目盛は5〜12本に収まる', () => {
    for (let d = 100; d <= 1_200_000; d = Math.round(d * 1.07) + 1) {
      const count = tickPositions(d).length;
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(12);
    }
  });
});

describe('tickPositions', () => {
  it('0から刻みごとに区間長まで並べる', () => {
    expect(tickPositions(2000, 12)).toEqual([
      0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000,
    ]);
  });

  it('区間長を超える目盛は作らない', () => {
    expect(tickPositions(1100, 12).at(-1)).toBeLessThanOrEqual(1100);
  });

  it('長さが0以下なら空', () => {
    expect(tickPositions(0, 12)).toEqual([]);
  });
});

describe('tickLabel', () => {
  it('秒に直して `1.0 s` の形にする', () => {
    expect(tickLabel(1000, 500)).toBe('1.0 s');
    expect(tickLabel(0, 500)).toBe('0.0 s');
  });

  it('刻みが0.1秒未満なら小数2桁にする', () => {
    expect(tickLabel(50, 10)).toBe('0.05 s');
  });
});

describe('timeReadout', () => {
  it('レビューア指定の対応表（ms → 表示）', () => {
    const table: ReadonlyArray<[number, string]> = [
      [0, '0.00 s'],
      [5, '0.01 s'],
      [995, '0.99 s'],
      [1000, '1.00 s'],
      [1234, '1.23 s'],
      [61000, '61.00 s'],
    ];
    for (const [tMs, expected] of table) {
      expect(timeReadout(tMs)).toBe(expected);
    }
  });
});

describe('nearestSnap', () => {
  it('許容幅の内側で一番近い候補に吸い付く', () => {
    expect(nearestSnap(510, [0, 500, 800], 30)).toBe(500);
  });

  it('許容幅の外なら undefined', () => {
    expect(nearestSnap(560, [500, 800], 30)).toBeUndefined();
  });

  it('候補が無ければ undefined', () => {
    expect(nearestSnap(100, [], 30)).toBeUndefined();
  });

  it('同じ距離なら先に来る候補を選ぶ', () => {
    expect(nearestSnap(500, [400, 600], 100)).toBe(400);
  });
});

describe('edgeTimes', () => {
  it('全信号の変化時刻と印を昇順・重複なしで返す', () => {
    expect(edgeTimes(chartOf())).toEqual([500, 800, 2500, 3000]);
  });

  it('区間の先頭0と終端は変化点ではないので含めない', () => {
    expect(edgeTimes(chartOf())).not.toContain(0);
    expect(edgeTimes(chartOf())).not.toContain(5000);
  });
});

describe('operationEdgeTimes', () => {
  it('操作（入力信号）の変化時刻と印だけを返す', () => {
    expect(operationEdgeTimes(chartOf())).toEqual([500, 800, 3000]);
  });
});

describe('msToX / xToMs', () => {
  it('左端がラベル幅、右端がラベル幅＋描画幅', () => {
    expect(msToX(0, 1000, SMALL_GEOMETRY)).toBe(SMALL_GEOMETRY.labelWidth);
    expect(msToX(1000, 1000, SMALL_GEOMETRY)).toBe(
      SMALL_GEOMETRY.labelWidth + SMALL_GEOMETRY.plotWidth,
    );
  });

  it('逆変換で元の時刻に戻る', () => {
    expect(xToMs(msToX(1234, 5000, LARGE_GEOMETRY), 5000, LARGE_GEOMETRY)).toBeCloseTo(1234, 6);
  });

  it('長さが0以下でも落ちない', () => {
    expect(msToX(100, 0, SMALL_GEOMETRY)).toBe(SMALL_GEOMETRY.labelWidth);
  });
});
