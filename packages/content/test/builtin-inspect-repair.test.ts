import { JIPM_BOARD } from '@ojt/board-model';
import { compareLogs } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '../src/builtin/index.js';
import { applyFaults } from '../src/faults.js';
import { buildInspectRepairCircuit, repairNetlist } from '../src/inspect-repair.js';
import { resolveFaults } from '../src/random-faults.js';
import { buildReferenceSession } from '../src/reference.js';
import { runOperations } from '../src/runner.js';
import { resolveCompareSignals } from '../src/schema/judge.js';
import type { InspectRepairProblem } from '../src/schema/inspect-repair.js';
import { startsAndEndsLow, buildTimeChart, defaultChartSignals } from '../src/timechart.js';

/** 模範回路（故障なし）の信号ログと比較信号。 */
function referenceRun(problem: InspectRepairProblem) {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const run = runOperations(built.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  return { run, signals: resolveCompareSignals(problem.judge, problem.board.extraParts ?? []) };
}

/** 指定した故障だけを入れた盤の不一致件数。 */
function mismatchCount(problem: InspectRepairProblem, faultIndexes: readonly number[]): number {
  const all = resolveFaults(problem, JIPM_BOARD);
  if (!all.ok) throw new Error(JSON.stringify(all.errors));
  const chosen = faultIndexes.map((i) => all.value[i]).filter((f) => f !== undefined);
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const applied = applyFaults(built.value.session, chosen);
  if (!applied.ok) throw new Error(JSON.stringify(applied.errors));
  const circuit = {
    session: built.value.session,
    applied: applied.value,
    initialWireIds: built.value.session.wires.map((w) => w.id),
    cells: built.value.cells,
  };
  const { netlist, errors } = repairNetlist(circuit, JIPM_BOARD);
  expect(errors).toEqual([]);
  const actual = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
  const reference = referenceRun(problem);
  return compareLogs(reference.run.log, actual.log, reference.signals, problem.judge.tolerance)
    .length;
}

describe('内蔵C2課題', () => {
  it('registers the problems with stable ids and the right hint setting (§9.2)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      expect(problem.mode, problem.id).toBe('inspect-repair');
      expect(problem.board.boardId, problem.id).toBe('board-jipm-std');
      expect(problem.hints.schematicVisible, problem.id).toBe(problem.grade === 2);
      expect(problem.grade === 1 || problem.grade === 2, problem.id).toBe(true);
    }
  });

  it('gives every problem exactly two faults (§17.2 #4)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      expect(Array.isArray(problem.faults), problem.id).toBe(true);
      if (!Array.isArray(problem.faults)) continue;
      expect(problem.faults, problem.id).toHaveLength(2);
    }
  });

  it('builds the faulted board without a problem-data error (§13 #2)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
      expect(built.ok, problem.id).toBe(true);
      if (!built.ok) continue;
      expect(built.value.applied.sites, problem.id).toHaveLength(2);
      expect(built.value.session.allowedColors, problem.id).toEqual(['白']);
    }
  });

  it('keeps the reference chart starting and ending low (§7.3)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const { run, signals } = referenceRun(problem);
      const chart = buildTimeChart(run.log, defaultChartSignals(signals), problem.durationMs);
      expect(startsAndEndsLow(chart), problem.id).toBe(true);
    }
  });

  // 弁別テストは課題ごとに個別の it() へ分割する(B-6)。coverage 計測込みで1テストに
  // まとめると136秒かかり、既定のテストタイムアウトを超えて落ちるため(Task 15 で
  // testTimeout/hookTimeout を180_000へ上げる対応と合わせて、個別化して報告も見やすくする)。
  for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
    it(`${problem.id}: どちらか片方の故障だけでも模範と動作が食い違う (§7.5)`, () => {
      expect(mismatchCount(problem, [0]), 'fault0').toBeGreaterThan(0);
      expect(mismatchCount(problem, [1]), 'fault1').toBeGreaterThan(0);
      expect(mismatchCount(problem, [0, 1]), 'both').toBeGreaterThan(0);
    });
  }

  it('故障を入れなければ模範と完全に一致する（基準回路の自己整合）', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      expect(mismatchCount(problem, []), problem.id).toBe(0);
    }
  });
});
