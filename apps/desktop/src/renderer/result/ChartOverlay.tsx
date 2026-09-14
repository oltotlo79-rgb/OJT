import type { TimeChart } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { LABEL_WIDTH, PLOT_WIDTH, ROW_HEIGHT, waveformPoints } from '../panels/TimeChartPanel.js';
import panels from '../panels/panels.module.css';
import styles from './result.module.css';

/**
 * 模範波形と訓練者波形の重ね表示。設計仕様 §8.3。
 * 模範＝薄色の太線、訓練者＝濃色の細線。`waveformPoints()` はライブチャートと共用する。
 */

/** チャート重ね表示。 */
export function ChartOverlay({
  expected,
  actual,
}: {
  expected: TimeChart;
  actual: TimeChart;
}): JSX.Element {
  const height = expected.signals.length * ROW_HEIGHT + 16;
  const width = LABEL_WIDTH + PLOT_WIDTH + 8;
  const actualByName = new Map(actual.signals.map((s) => [s.name, s] as const));
  return (
    <div className={styles.card}>
      <h2>{JA.result.chartOverlay}</h2>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={JA.result.chartOverlay}
        data-testid="chart-overlay"
        style={{ width: '100%' }}
      >
        {expected.signals.map((signal, index) => {
          const baseY = (index + 1) * ROW_HEIGHT;
          const mine = actualByName.get(signal.name);
          return (
            <g key={signal.name}>
              <text className={panels.chartRowLabel} x={0} y={baseY} dominantBaseline="middle">
                {signal.label}
              </text>
              <line
                className={panels.chartAxis}
                x1={LABEL_WIDTH}
                y1={baseY + 2}
                x2={LABEL_WIDTH + PLOT_WIDTH}
                y2={baseY + 2}
              />
              <polyline
                className={styles.overlayExpected}
                points={waveformPoints(signal.segments, expected.durationMs, baseY)}
              />
              {mine === undefined ? null : (
                <polyline
                  className={styles.overlayActual}
                  points={waveformPoints(mine.segments, actual.durationMs, baseY)}
                />
              )}
            </g>
          );
        })}
        {expected.markers.map((marker) => (
          <g key={`${marker.label}-${marker.tMs}`}>
            <line
              className={panels.chartMarker}
              x1={LABEL_WIDTH + (marker.tMs / expected.durationMs) * PLOT_WIDTH}
              y1={4}
              x2={LABEL_WIDTH + (marker.tMs / expected.durationMs) * PLOT_WIDTH}
              y2={height - 12}
            />
            <text
              className={panels.chartRowLabel}
              x={LABEL_WIDTH + (marker.tMs / expected.durationMs) * PLOT_WIDTH + 2}
              y={height - 3}
            >
              {marker.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
