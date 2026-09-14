import { JIPM_BOARD } from '@ojt/board-model';
import {
  buildReferenceSession,
  buildTimeChart,
  defaultChartSignals,
  resolveCompareSignals,
  runOperations,
  timerMarkers,
  type AssembleProblem,
  type TimeChart,
} from '@ojt/content';

/**
 * 課題の仕様タイムチャート。設計仕様 §7.7 / §8.1。
 * 波形は課題JSONに書かれていないので、**模範回路をその場でシミュレートして**作る（決定事項#8）。
 * 5000ms の課題でも 500 tick なので renderer の同期計算で足りる（§5.2 の 1tick 1ms 未満目標）。
 */

/** 仕様チャートの構築結果。模範回路が変換できなければ理由を返す（§13 #2）。 */
export type SpecChartResult = { ok: true; chart: TimeChart } | { ok: false; errors: string[] };

/** 課題の仕様タイムチャートを作る。 */
export function buildSpecChart(problem: AssembleProblem): SpecChartResult {
  const reference = buildReferenceSession(problem, JIPM_BOARD);
  if (!reference.ok) {
    return { ok: false, errors: reference.errors.map((e) => `${e.path}: ${e.message}`) };
  }
  const run = runOperations(reference.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  const specs = defaultChartSignals(
    resolveCompareSignals(problem.judge, problem.board.extraParts ?? []),
  );
  return {
    ok: true,
    chart: buildTimeChart(
      run.log,
      specs,
      problem.durationMs,
      timerMarkers(reference.value.netlist),
    ),
  };
}
