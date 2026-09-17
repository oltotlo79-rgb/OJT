import type { TimeChart, TimeChartSegment, TimeChartSignalSpec } from '@ojt/content';
import { useMemo, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import {
  edgeTimes,
  operationEdgeTimes,
  SMALL_GEOMETRY,
  type ChartGeometry,
} from './chart-scale.js';
import { EnlargeableChart, wavePoints, type ChartFigure } from './TimeChartView.js';
import styles from './panels.module.css';

/**
 * タイムチャート（仕様＋ライブ実測）。設計仕様 §7.7 / §8.1 / §8.2。
 * 上段に入力（PB）、下段に出力（PL／BZ）を並べる。SVGで描き、結果画面の重ね表示
 * （`ChartOverlay`）も同じ `waveformPoints()` を使う。
 *
 * 描画そのもの（縦の補助線・カーソル線・クリックで拡大）は `TimeChartView.tsx` が持つ。
 * ここは「信号ログをチャートの材料にする」側の責務だけを残す。
 */

/** 1信号ぶんの描画高さ[px]。 */
export const ROW_HEIGHT = SMALL_GEOMETRY.rowHeight;
/** 波形の振幅[px]。 */
export const ROW_AMPLITUDE = SMALL_GEOMETRY.amplitude;
/** 左のラベル幅[px]。 */
export const LABEL_WIDTH = SMALL_GEOMETRY.labelWidth;
/** 描画領域の幅[px]。 */
export const PLOT_WIDTH = SMALL_GEOMETRY.plotWidth;

/**
 * 区間列を SVG の `points` 文字列にする純粋関数。§7.7
 * `value` が真なら上（`baseY - ROW_AMPLITUDE`）、偽なら下（`baseY`）を通る矩形波。
 * 寸法を渡さなければ小さいチャートの寸法で描く（従来どおり）。
 */
export function waveformPoints(
  segments: readonly TimeChartSegment[],
  durationMs: number,
  baseY: number,
  geom: ChartGeometry = SMALL_GEOMETRY,
): string {
  return wavePoints(segments, durationMs, baseY, geom);
}

/**
 * 変化点の列（ライブ記録）を区間列にする純粋関数。§8.2
 * 記録が無い信号は「全区間 false」になる。
 */
export function toSegments(
  points: ReadonlyArray<{ tMs: number; value: boolean }>,
  durationMs: number,
): TimeChartSegment[] {
  const segments: TimeChartSegment[] = [];
  let value = false;
  let from = 0;
  for (const point of points) {
    if (point.tMs > durationMs) break;
    if (point.tMs > from && point.value !== value) {
      segments.push({ fromMs: from, toMs: point.tMs, value });
      from = point.tMs;
    }
    value = point.value;
  }
  segments.push({ fromMs: from, toMs: durationMs, value });
  return segments;
}

/** ライブ記録から `TimeChart` を作る。§8.2 */
export function liveChart(
  specs: readonly TimeChartSignalSpec[],
  transitions: Readonly<Record<string, Array<{ tMs: number; value: boolean }>>>,
  durationMs: number,
): TimeChart {
  return {
    durationMs,
    markers: [],
    signals: specs.map((spec) => ({
      name: spec.name,
      label: spec.label,
      kind: spec.kind,
      segments: toSegments(transitions[spec.name] ?? [], durationMs),
    })),
  };
}

/** チャート1枚ぶんの描画材料にする（縦の補助線と吸い付き候補もここで決まる）。§7.7 */
export function chartFigure(chart: TimeChart, waveClassName: string): ChartFigure {
  return {
    durationMs: chart.durationMs,
    markers: chart.markers,
    edges: operationEdgeTimes(chart),
    snaps: edgeTimes(chart),
    rows: chart.signals.map((signal) => ({
      key: signal.name,
      label: signal.label,
      waves: [
        {
          key: 'value',
          className: waveClassName,
          segments: signal.segments,
        },
      ],
    })),
  };
}

/** タイムチャート1枚（クリックで拡大できる）。 */
export function TimeChartSvg({
  chart,
  title,
  testId,
}: {
  chart: TimeChart;
  title: string;
  testId?: string | undefined;
}): JSX.Element {
  const figure = useMemo(() => chartFigure(chart, styles.chartLine ?? ''), [chart]);
  return (
    <EnlargeableChart title={title} figure={figure} testId={testId} smallClassName={styles.chart} />
  );
}

/** 右パネルのタイムチャート。 */
export function TimeChartPanel({ chart }: { chart: TimeChart }): JSX.Element {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.chart}</h2>
      <TimeChartSvg chart={chart} title={JA.session.chart} testId="chart-spec" />
    </section>
  );
}
