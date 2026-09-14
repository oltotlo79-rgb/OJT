import type { TimeChart, TimeChartSegment, TimeChartSignalSpec } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * タイムチャート（仕様＋ライブ実測）。設計仕様 §7.7 / §8.1 / §8.2。
 * 上段に入力（PB）、下段に出力（PL／BZ）を並べる。SVGで描き、結果画面の重ね表示
 * （`ChartOverlay`）も同じ `waveformPoints()` を使う。
 */

/** 1信号ぶんの描画高さ[px]。 */
export const ROW_HEIGHT = 22;
/** 波形の振幅[px]。 */
export const ROW_AMPLITUDE = 12;
/** 左のラベル幅[px]。 */
export const LABEL_WIDTH = 92;
/** 描画領域の幅[px]。 */
export const PLOT_WIDTH = 300;

/**
 * 区間列を SVG の `points` 文字列にする純粋関数。§7.7
 * `value` が真なら上（`baseY - ROW_AMPLITUDE`）、偽なら下（`baseY`）を通る矩形波。
 */
export function waveformPoints(
  segments: readonly TimeChartSegment[],
  durationMs: number,
  baseY: number,
): string {
  if (durationMs <= 0) return '';
  const x = (ms: number): number =>
    LABEL_WIDTH + (Math.min(ms, durationMs) / durationMs) * PLOT_WIDTH;
  const y = (value: boolean): number => (value ? baseY - ROW_AMPLITUDE : baseY);
  const out: string[] = [];
  for (const segment of segments) {
    out.push(`${x(segment.fromMs).toFixed(1)},${y(segment.value).toFixed(1)}`);
    out.push(`${x(segment.toMs).toFixed(1)},${y(segment.value).toFixed(1)}`);
  }
  return out.join(' ');
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

/** タイムチャート1枚のSVG。 */
export function TimeChartSvg({ chart, title }: { chart: TimeChart; title: string }): JSX.Element {
  const height = chart.signals.length * ROW_HEIGHT + 14;
  const width = LABEL_WIDTH + PLOT_WIDTH + 8;
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMinYMin meet"
    >
      {chart.signals.map((signal, index) => {
        const baseY = (index + 1) * ROW_HEIGHT;
        return (
          <g key={signal.name}>
            <text className={styles.chartRowLabel} x={0} y={baseY} dominantBaseline="middle">
              {signal.label}
            </text>
            <line
              className={styles.chartAxis}
              x1={LABEL_WIDTH}
              y1={baseY + 2}
              x2={LABEL_WIDTH + PLOT_WIDTH}
              y2={baseY + 2}
            />
            <polyline
              className={styles.chartLine}
              points={waveformPoints(signal.segments, chart.durationMs, baseY)}
            />
          </g>
        );
      })}
      {chart.markers.map((marker) => (
        <g key={`${marker.label}-${marker.tMs}`}>
          <line
            className={styles.chartMarker}
            x1={LABEL_WIDTH + (marker.tMs / chart.durationMs) * PLOT_WIDTH}
            y1={4}
            x2={LABEL_WIDTH + (marker.tMs / chart.durationMs) * PLOT_WIDTH}
            y2={height - 10}
          />
          <text
            className={styles.chartRowLabel}
            x={LABEL_WIDTH + (marker.tMs / chart.durationMs) * PLOT_WIDTH + 2}
            y={height - 2}
          >
            {marker.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 右パネルのタイムチャート。 */
export function TimeChartPanel({ chart }: { chart: TimeChart }): JSX.Element {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.chart}</h2>
      <TimeChartSvg chart={chart} title={JA.session.chart} />
    </section>
  );
}
