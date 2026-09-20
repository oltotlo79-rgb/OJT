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

/**
 * ランダム故障の課題で使う種。§7.5 の生成は種を渡さないと `Date.now()` を使うので、
 * 回帰テストからは必ず種を固定する（CT-04）。
 */
const SEEDS: Readonly<Record<string, number>> = { 'c2-020': 20260920 };

/** 指定した故障だけを入れた盤の不一致件数。 */
function mismatchCount(problem: InspectRepairProblem, faultIndexes: readonly number[]): number {
  const seed = SEEDS[problem.id];
  const all = resolveFaults(problem, JIPM_BOARD, seed === undefined ? {} : { seed });
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
    initialWires: built.value.session.wires.map((w) => ({ ...w })),
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

  it('故障の数は1〜3件で、級が上がるほど増える（決定表#4「2箇所を基本とする」）', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const count = Array.isArray(problem.faults)
        ? problem.faults.length
        : problem.faults.random.count;
      expect(count, problem.id).toBeGreaterThanOrEqual(1);
      expect(count, problem.id).toBeLessThanOrEqual(3);
    }
  });

  it('builds the faulted board without a problem-data error (§13 #2)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const seed = SEEDS[problem.id];
      const built = buildInspectRepairCircuit(
        problem,
        JIPM_BOARD,
        seed === undefined ? {} : { seed },
      );
      expect(built.ok, problem.id).toBe(true);
      if (!built.ok) continue;
      const count = Array.isArray(problem.faults)
        ? problem.faults.length
        : problem.faults.random.count;
      expect(built.value.applied.sites, problem.id).toHaveLength(count);
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
    it(`${problem.id}: どの故障1件だけでも模範と動作が食い違う (§7.5)`, () => {
      const seed = SEEDS[problem.id];
      const all = resolveFaults(problem, JIPM_BOARD, seed === undefined ? {} : { seed });
      expect(all.ok, problem.id).toBe(true);
      if (!all.ok) return;
      const indexes = all.value.map((_, i) => i);
      for (const i of indexes) {
        expect(mismatchCount(problem, [i]), `fault${String(i)}`).toBeGreaterThan(0);
      }
      expect(mismatchCount(problem, indexes), 'all').toBeGreaterThan(0);
    });
  }

  /**
   * ランダム故障（`c2-020`）は種ごとに別の組合せになる。`resolveFaults()` が保証するのは
   * 「組合せ全体として模範と動作が違う」ことだけなので、**1件だけでも見つけられる**ことは
   * 課題データ側（`random.types` を電線の故障に限ってある）で担保している。種を変えても
   * その性質が崩れないことをここで見張る。
   */
  it('c2-020: どの種でも、引いた故障は1件ずつ単独で症状が出る（§7.5）', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === 'c2-020');
    if (problem === undefined) throw new Error('c2-020 がありません');
    for (const seed of [1, 7, 424242]) {
      const all = resolveFaults(problem, JIPM_BOARD, { seed });
      expect(all.ok, String(seed)).toBe(true);
      if (!all.ok) continue;
      expect(all.value, String(seed)).toHaveLength(3);
      all.value.forEach((_, i) => {
        const chosen = all.value[i];
        const built = buildReferenceSession(problem, JIPM_BOARD);
        if (!built.ok) throw new Error(JSON.stringify(built.errors));
        const applied = applyFaults(built.value.session, chosen === undefined ? [] : [chosen]);
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        const circuit = {
          session: built.value.session,
          applied: applied.value,
          initialWireIds: built.value.session.wires.map((w) => w.id),
          initialWires: built.value.session.wires.map((w) => ({ ...w })),
          cells: built.value.cells,
        };
        const { netlist } = repairNetlist(circuit, JIPM_BOARD);
        const actual = runOperations(netlist, problem.operations, {
          durationMs: problem.durationMs,
        });
        const reference = referenceRun(problem);
        const diff = compareLogs(
          reference.run.log,
          actual.log,
          reference.signals,
          problem.judge.tolerance,
        );
        expect(diff.length, `seed=${String(seed)} fault${String(i)}`).toBeGreaterThan(0);
      });
    }
  });

  it('故障を入れなければ模範と完全に一致する（基準回路の自己整合）', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      expect(mismatchCount(problem, []), problem.id).toBe(0);
    }
  });

  it('難しさが級の帯に収まる（§4.3 Phase 7）', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const allowed = problem.grade === 2 ? [2, 3, 4] : [4, 5];
      expect(allowed, `${problem.id}（${problem.grade}級）`).toContain(problem.difficulty);
    }
  });

  it('each explicit fault の wireId is a generated sw-NNN wire (SC-05)', () => {
    // `sw-NNN` は回路図から生成順に振られる通し番号（schematic-core `assign.ts` の
    // `chainWires()`）。回路図を編集すると番号が付け替わり得るので、課題データの
    // `faults[].target.wireId` が実際に生成される集合に含まれていることをここで固定する。
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const built = buildReferenceSession(problem, JIPM_BOARD);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      const generated = new Set<string>(built.value.session.wires.map((wire) => wire.id));
      if (!Array.isArray(problem.faults)) continue; // ランダム故障はここでは扱わない（内蔵C2は全件明示リスト）
      for (const fault of problem.faults) {
        if ('wireId' in fault.target) {
          expect(generated.has(fault.target.wireId), `${problem.id}: ${fault.target.wireId}`).toBe(
            true,
          );
        }
      }
    }
  });
});
