import type { Mismatch } from '@ojt/circuit-sim';
import type { TimeChart } from '@ojt/content';
import { useMemo, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { edgeTimes, LARGE_STACKED_GEOMETRY, operationEdgeTimes } from '../panels/chart-scale.js';
import { EnlargeableChart, type ChartBand, type ChartFigure } from '../panels/TimeChartView.js';
import panels from '../panels/panels.module.css';
import styles from './result.module.css';

/**
 * 模範波形と訓練者波形の見比べ。設計仕様 §8.3。
 *
 * - 小さい図（カードの中）は**重ね表示**。模範＝薄色の太線、訓練者＝濃色の細線。
 * - クリックで開く拡大表示は**積み上げ**。期待（模範）8行の下に実際（訓練者）8行を並べ、
 *   目盛・破線・カーソルは**1本の時間軸**を共有する（重なった2本の線を目で追うより、
 *   同じ時刻で上下に見比べるほうが読み取りやすい、という利用者要望）。
 * - どちらにも差分（`mismatches`）の区間を赤く敷く。
 */

/** 差分を敷く区間の最小幅（区間長に対する割合）。細い差分でも目に入る太さにする。 */
const MIN_BAND_RATIO = 0.015;

/** ある信号の差分区間。期待時刻と実際の時刻のあいだを敷く。 */
function bandsOf(
  mismatches: readonly Mismatch[],
  signalName: string,
  durationMs: number,
): ChartBand[] {
  const minWidth = durationMs * MIN_BAND_RATIO;
  return mismatches
    .filter((mismatch) => mismatch.signal === signalName)
    .map((mismatch) => {
      const other = mismatch.actualTMs ?? mismatch.tMs;
      const from = Math.min(mismatch.tMs, other);
      const to = Math.max(mismatch.tMs, other);
      const pad = Math.max(0, (minWidth - (to - from)) / 2);
      return {
        fromMs: Math.max(0, from - pad),
        toMs: Math.min(durationMs, to + pad),
      };
    });
}

/** 重ね表示（カードの中の小さい図）。 */
function overlayFigure(
  expected: TimeChart,
  actual: TimeChart,
  mismatches: readonly Mismatch[],
): ChartFigure {
  const actualByName = new Map(actual.signals.map((s) => [s.name, s] as const));
  return {
    durationMs: expected.durationMs,
    markers: expected.markers,
    edges: operationEdgeTimes(expected),
    snaps: edgeTimes(expected),
    rows: expected.signals.map((signal) => {
      const mine = actualByName.get(signal.name);
      return {
        key: signal.name,
        label: signal.label,
        bands: bandsOf(mismatches, signal.name, expected.durationMs),
        waves: [
          {
            key: 'expected',
            className: styles.overlayExpected ?? '',
            segments: signal.segments,
          },
          ...(mine === undefined
            ? []
            : [
                {
                  key: 'actual',
                  className: styles.overlayActual ?? '',
                  segments: mine.segments,
                },
              ]),
        ],
      };
    }),
  };
}

/** 積み上げ表示（拡大したときの図）。期待と実際が同じ時間軸に並ぶ。 */
function stackedFigure(
  expected: TimeChart,
  actual: TimeChart,
  mismatches: readonly Mismatch[],
): ChartFigure {
  const rows: ChartFigure['rows'] = [
    { key: 'head-expected', label: JA.timeChart.expected, heading: true, waves: [] },
    ...expected.signals.map((signal) => ({
      key: `expected-${signal.name}`,
      label: signal.label,
      bands: bandsOf(mismatches, signal.name, expected.durationMs),
      waves: [
        {
          key: 'expected',
          // UXレビュー #7: 拡大表示も小さい重ね表示と同じ2色を使う（`panels.chartLine` は使わない）
          className: styles.overlayExpected ?? '',
          segments: signal.segments,
        },
      ],
    })),
    { key: 'head-actual', label: JA.timeChart.actual, heading: true, waves: [] },
    ...actual.signals.map((signal) => ({
      key: `actual-${signal.name}`,
      label: signal.label,
      bands: bandsOf(mismatches, signal.name, expected.durationMs),
      waves: [
        {
          key: 'actual',
          className: styles.overlayActual ?? '',
          segments: signal.segments,
        },
      ],
    })),
  ];
  return {
    durationMs: expected.durationMs,
    markers: expected.markers,
    edges: operationEdgeTimes(expected),
    snaps: edgeTimes(expected),
    rows,
  };
}

/** チャート重ね表示。 */
export function ChartOverlay({
  expected,
  actual,
  mismatches = [],
}: {
  expected: TimeChart;
  actual: TimeChart;
  /** 許容差を超えた遷移。区間を赤く敷いて見比べの手がかりにする。§8.3 */
  mismatches?: readonly Mismatch[];
}): JSX.Element {
  const small = useMemo(
    () => overlayFigure(expected, actual, mismatches),
    [expected, actual, mismatches],
  );
  const large = useMemo(
    () => stackedFigure(expected, actual, mismatches),
    [expected, actual, mismatches],
  );
  return (
    <div className={styles.card}>
      <h2>{JA.result.chartOverlay}</h2>
      <EnlargeableChart
        title={JA.result.chartOverlay}
        figure={small}
        largeFigure={large}
        largeGeom={LARGE_STACKED_GEOMETRY}
        testId="chart-overlay"
        smallClassName={panels.chart}
        legend={<ChartLegend />}
      />
    </div>
  );
}

/**
 * 波形の見比べの凡例（UXレビュー #7）。色見本は `result.module.css` の
 * `.overlayExpected` / `.overlayActual` / `.legendBand` と同じ見た目にする。
 */
function ChartLegend(): JSX.Element {
  return (
    <p className={styles.legend} data-testid="chart-legend">
      <span className={styles.legendItem}>
        <span className={`${styles.legendSwatch} ${styles.legendExpected}`} aria-hidden="true" />
        {JA.chartLegend.expected}
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.legendSwatch} ${styles.legendActual}`} aria-hidden="true" />
        {JA.chartLegend.actual}
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.legendSwatch} ${styles.legendBand}`} aria-hidden="true" />
        {JA.chartLegend.diff}
      </span>
    </p>
  );
}
