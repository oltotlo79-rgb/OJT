import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '../src/builtin/index.js';
import type { FaultReport } from '../src/faults.js';
import {
  buildInspectRepairCircuit,
  replacePart,
  REPAIR_WIRE_COLOR,
  type RepairCircuit,
} from '../src/inspect-repair.js';
import { judgeInspectRepair } from '../src/judge-inspect.js';

/**
 * 内蔵C2課題8題の弁別テスト。設計仕様 §7.8 の自己整合テストにあたる。
 * 「正しく指摘して正しく修復すれば合格し、修復しなければ不合格になる」ことを全題で見張る。
 */

/** 修復の1手。 */
type Repair =
  | { op: 'remove'; wireId: string }
  | { op: 'add'; from: string; to: string }
  | { op: 'replace'; partId: string };

/** 課題IDごとの正しい修復手順。 */
const REPAIRS: Readonly<Record<string, readonly Repair[]>> = {
  'c2-001': [
    { op: 'remove', wireId: 'sw-005' },
    { op: 'add', from: 'TB_PB.1a', to: 'CR1.14' },
    { op: 'add', from: 'CR1.6', to: 'TB_PL.1+' },
  ],
  'c2-002': [
    { op: 'remove', wireId: 'sw-002' },
    { op: 'add', from: 'TB_PB.2c', to: 'CR1.10' },
    { op: 'replace', partId: 'CR1' },
  ],
  'c2-003': [
    { op: 'remove', wireId: 'sw-011' },
    { op: 'add', from: 'CR1.6', to: 'T1.14' },
    { op: 'replace', partId: 'T1' },
  ],
  'c2-004': [
    { op: 'remove', wireId: 'sw-012' },
    { op: 'add', from: 'CR1.7', to: 'TB_PL.1+' },
    { op: 'replace', partId: 'T1' },
  ],
  'c2-005': [
    { op: 'remove', wireId: 'sw-010' },
    { op: 'add', from: 'CR2.1', to: 'CR1.14' },
    { op: 'replace', partId: 'CR2' },
  ],
  'c2-006': [
    { op: 'add', from: 'T1.6', to: 'T2.14' },
    { op: 'remove', wireId: 'sw-016' },
    { op: 'add', from: 'T1.5', to: 'TB_PL.1+' },
  ],
  'c2-007': [
    { op: 'remove', wireId: 'sw-020' },
    { op: 'add', from: 'T1.5', to: 'CR2.14' },
    { op: 'replace', partId: 'CR2' },
  ],
  'c2-008': [
    { op: 'add', from: 'TB_PB.3a', to: 'CR2.14' },
    { op: 'replace', partId: 'CR1' },
  ],
};

/** 故障の在処から「正しい指摘」を組み立てる（訓練者が3D盤でクリックする内容と同じ）。§9.2 */
function correctReports(circuit: RepairCircuit): FaultReport[] {
  return circuit.applied.sites.map((site) => {
    if (site.report === 'part-defect') {
      return { target: { partId: site.partId ?? '' }, kind: site.report };
    }
    if (site.report === 'wire-missing') {
      return { target: { terminalId: site.terminals[0] ?? '' }, kind: site.report };
    }
    return { target: { wireId: site.wireId ?? '' }, kind: site.report };
  });
}

/** 修復手順を適用する。 */
function applyRepairs(circuit: RepairCircuit, repairs: readonly Repair[]): RepairCircuit {
  let current = circuit;
  for (const repair of repairs) {
    if (repair.op === 'remove') {
      const removed = removeWire(current.session, repair.wireId);
      if (!removed.ok) throw new Error(`${repair.wireId}: ${removed.message}`);
    } else if (repair.op === 'add') {
      const added = addWire(
        current.session,
        JIPM_BOARD,
        toTerminalId(repair.from),
        toTerminalId(repair.to),
        REPAIR_WIRE_COLOR,
      );
      if (!added.ok) throw new Error(`${repair.from}-${repair.to}: ${added.message}`);
    } else {
      current = replacePart(current, repair.partId);
    }
  }
  return current;
}

function circuitOf(id: string) {
  const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === id);
  if (problem === undefined) throw new Error(`no problem ${id}`);
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

describe('内蔵C2課題8題（§7.9）', () => {
  it('registers eight problems: four grade 2 and four grade 1', () => {
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS).toHaveLength(8);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.map((p) => p.id)).toEqual([
      'c2-001',
      'c2-002',
      'c2-003',
      'c2-004',
      'c2-005',
      'c2-006',
      'c2-007',
      'c2-008',
    ]);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.filter((p) => p.grade === 2)).toHaveLength(4);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.filter((p) => p.grade === 1)).toHaveLength(4);
  });

  it('covers wire and part faults across the eight problems (§5.4)', () => {
    const kinds = new Set<string>();
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      if (!Array.isArray(problem.faults)) continue;
      for (const fault of problem.faults) kinds.add(fault.kind);
    }
    expect(kinds.has('wire-open')).toBe(true);
    expect(kinds.has('wire-missing')).toBe(true);
    expect(kinds.has('wire-misrouted')).toBe(true);
    expect(kinds.has('contact-welded')).toBe(true);
    expect(kinds.has('contact-open')).toBe(true);
    expect(kinds.has('contact-resistive')).toBe(true);
    expect(kinds.has('coil-open')).toBe(true);
  });

  for (const id of Object.keys(REPAIRS)) {
    it(`${id}: 指摘して修復すると合格する（§16 受入基準③）`, () => {
      const { problem, circuit } = circuitOf(id);
      const reports = correctReports(circuit);
      const repaired = applyRepairs(circuit, REPAIRS[id] ?? []);
      const judged = judgeInspectRepair(problem, JIPM_BOARD, repaired, reports);
      expect(judged.ok, id).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.mismatches, id).toEqual([]);
      expect(judged.value.reports.missed, id).toEqual([]);
      expect(judged.value.reports.extra, id).toEqual([]);
      expect(judged.value.modifications, id).toEqual([]);
      expect(
        judged.value.staticChecks.every((c) => c.ok),
        id,
      ).toBe(true);
      expect(judged.value.passed, id).toBe(true);
    });

    it(`${id}: 修復しなければ不合格になる`, () => {
      const { problem, circuit } = circuitOf(id);
      const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, correctReports(circuit));
      expect(judged.ok, id).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.reports.missed, id).toEqual([]);
      expect(judged.value.mismatches.length, id).toBeGreaterThan(0);
      expect(judged.value.passed, id).toBe(false);
    });

    it(`${id}: 指摘を1件落とすと不合格になる`, () => {
      const { problem, circuit } = circuitOf(id);
      const reports = correctReports(circuit).slice(1);
      const repaired = applyRepairs(circuit, REPAIRS[id] ?? []);
      const judged = judgeInspectRepair(problem, JIPM_BOARD, repaired, reports);
      expect(judged.ok, id).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.reports.missed.length, id).toBe(1);
      expect(judged.value.passed, id).toBe(false);
    });
  }
});
