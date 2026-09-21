import { compareLogs, SignalLog, type Mismatch, type Tolerance } from '@ojt/circuit-sim';
import type { SupportedProblem, TimeChart, TimeChartSegment } from '@ojt/content';
import { outputSignalLabel } from '../i18n/ja.js';

export interface CompareRow {
  signal: string;
  label: string;
  expected: readonly TimeChartSegment[];
  actual: readonly TimeChartSegment[];
  differences: readonly Mismatch[];
  diffWindows: readonly { fromMs: number; toMs: number }[];
}

/** 波形の変化点を復元して、採点と同じ比較器を使う。独自の許容差判定を作らない。 */
function chartLog(chart: TimeChart): SignalLog {
  const log = new SignalLog();
  const points = chart.signals.flatMap((signal) =>
    signal.segments.map((segment) => ({
      signal: signal.name,
      tMs: segment.fromMs,
      value: segment.value,
    })),
  );
  points.sort((a, b) => a.tMs - b.tMs);
  for (const point of points) log.record(point.tMs, new Map([[point.signal, point.value]]));
  return log;
}

export function compareCharts(
  expected: TimeChart,
  actual: TimeChart,
  tolerance: Tolerance,
): readonly CompareRow[] {
  const signals = [
    ...new Set(
      expected.signals.filter((signal) => signal.kind === 'output').map((signal) => signal.name),
    ),
  ];
  const mismatches = compareLogs(chartLog(expected), chartLog(actual), signals, tolerance);
  return signals.map((signal) => {
    const want = expected.signals.find((row) => row.name === signal)?.segments ?? [];
    const got = actual.signals.find((row) => row.name === signal)?.segments ?? [];
    const differences = mismatches.filter((m) => m.signal === signal);
    const boundaries = [
      ...new Set([
        0,
        expected.durationMs,
        ...[...want, ...got].flatMap((segment) => [segment.fromMs, segment.toMs]),
      ]),
    ]
      .filter((time) => time >= 0 && time <= expected.durationMs)
      .sort((a, b) => a - b);
    const raw: Array<{ fromMs: number; toMs: number }> = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const fromMs = boundaries[index]!;
      const toMs = boundaries[index + 1]!;
      const at = (segments: readonly TimeChartSegment[]) =>
        segments.find((segment) => segment.fromMs <= fromMs && segment.toMs > fromMs)?.value;
      if (at(want) === at(got)) continue;
      const previous = raw.at(-1);
      if (previous?.toMs === fromMs) previous.toMs = toMs;
      else raw.push({ fromMs, toMs });
    }
    // 値が違う区間のうち、採点で許容されなかった変化を含む区間だけ塗る。
    // 値が一致する時刻の欠落・余分も、differencesの▲一覧からは消さない。
    const merged = raw.filter((window) =>
      differences.some((m) =>
        [m.tMs, m.actualTMs].some(
          (time) => time !== undefined && time >= window.fromMs && time <= window.toMs,
        ),
      ),
    );
    return {
      signal,
      label: outputSignalLabel(signal),
      expected: want,
      actual: got,
      differences,
      diffWindows: merged,
    };
  });
}

/** 級だけでなく課題側の公開フラグも確認する。PLCの模範ラダーは常に非公開。 */
export function mayShowReference(problem: SupportedProblem): boolean {
  return (
    (problem.mode === 'assemble' && problem.grade === 3 && problem.hints.schematicVisible) ||
    (problem.mode === 'inspect-repair' && problem.grade === 2 && problem.hints.schematicVisible)
  );
}
