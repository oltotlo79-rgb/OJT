import { labExpectedChart, type LabJudgeResult, type LabProblem } from '@ojt/content';
import { edgeTimes, operationEdgeTimes } from '../panels/chart-scale.js';
import type { ChartFigure, ChartWave } from '../panels/TimeChartView.js';
import { bandsOf } from '../result/ChartOverlay.js';
import { labRows, segmentsOf } from './chart-model.js';

/**
 * 実験の欄の小さいチャート（2026-10-08）。押ボタン4行は描いた押し方、ランプ4行は正解（破線）と
 * 最後に動かした結果（太線）を重ね、違いを赤い帯で敷く（結果画面の重ね表示と同じ読み方）。
 */

/** 線の見た目（呼び手の CSS モジュールのクラス）。 */
export interface LabFigureClasses {
  input: string;
  expected: string;
  actual: string;
}

/** 実験のチャート1枚の材料。 */
export function labFigure(
  problem: LabProblem,
  run: LabJudgeResult | undefined,
  classes: LabFigureClasses,
  notJudgedSuffix: string,
): ChartFigure {
  const durationMs = problem.durationMs;
  const actualByName = new Map(run?.charts.actual.signals.map((signal) => [signal.name, signal]));
  const reference = labExpectedChart(problem);
  const snaps = new Set([
    ...edgeTimes(reference),
    ...(run === undefined ? [] : edgeTimes(run.charts.actual)),
  ]);
  return {
    durationMs,
    markers: run?.charts.actual.markers ?? [],
    edges: operationEdgeTimes(reference),
    snaps: [...snaps].sort((a, b) => a - b),
    rows: labRows(problem).map((row) => {
      const waves: ChartWave[] = [];
      if (row.kind === 'input') {
        waves.push({
          key: 'input',
          className: classes.input,
          segments: segmentsOf(row.intervals, durationMs),
        });
      } else {
        if (problem.expected !== undefined) {
          waves.push({
            key: 'expected',
            className: classes.expected,
            segments: segmentsOf(row.intervals, durationMs),
          });
        }
        const actual = actualByName.get(row.signal);
        if (actual !== undefined) {
          waves.push({ key: 'actual', className: classes.actual, segments: actual.segments });
        }
      }
      return {
        key: row.signal,
        label: row.kind === 'output' && !row.judged ? `${row.label}${notJudgedSuffix}` : row.label,
        waves,
        bands: run === undefined ? [] : bandsOf(run.mismatches, row.signal, durationMs),
      };
    }),
  };
}
