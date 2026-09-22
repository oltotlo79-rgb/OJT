import expandedRepairs from './helpers/expanded-repairs.json';
import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '../src/builtin/index.js';
import type { FaultReport, FaultSite } from '../src/faults.js';
import {
  buildInspectRepairCircuit,
  replacePart,
  REPAIR_WIRE_COLOR,
  type RepairCircuit,
} from '../src/inspect-repair.js';
import { judgeInspectRepair } from '../src/judge-inspect.js';

/**
 * 内蔵C2課題60題の弁別テスト。設計仕様 §7.8 の自己整合テストにあたる。
 * 「正しく指摘して正しく修復すれば合格し、修復しなければ不合格になる」ことを全題で見張る。
 *
 * `c2-020` はランダム故障の課題（§7.5）なので、種を固定して解決する（`SEEDS`）。種を渡さないと
 * `resolveFaults()` が `Date.now()` を使い、`REPAIRS` に書いた手順と食い違う。
 */

/** 修復の1手。 */
type Repair =
  | { op: 'remove'; wireId: string }
  | { op: 'add'; from: string; to: string }
  | { op: 'replace'; partId: string };

/** 課題IDごとの正しい修復手順。 */
const REPAIRS: Readonly<Record<string, readonly Repair[]>> = {
  ...(expandedRepairs as Readonly<Record<string, readonly Repair[]>>),
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
  'c2-009': [
    { op: 'remove', wireId: 'sw-002' },
    { op: 'add', from: 'TB_PB.1a', to: 'TB_PB.2c' },
  ],
  'c2-010': [
    { op: 'remove', wireId: 'sw-004' },
    { op: 'add', from: 'TB_PL.1+', to: 'TB_PB.2a' },
  ],
  'c2-011': [
    { op: 'replace', partId: 'CR1' },
    { op: 'remove', wireId: 'sw-008' },
    { op: 'add', from: 'CR1.5', to: 'TB_PB.3a' },
  ],
  'c2-012': [
    { op: 'replace', partId: 'CR2' },
    { op: 'remove', wireId: 'sw-015' },
    { op: 'add', from: 'CR2.2', to: 'TB_PL.2+' },
  ],
  'c2-013': [{ op: 'replace', partId: 'T1' }],
  'c2-014': [{ op: 'replace', partId: 'CR2' }],
  'c2-015': [
    { op: 'remove', wireId: 'sw-021' },
    { op: 'add', from: 'T1.7', to: 'T2.9' },
    { op: 'replace', partId: 'T2' },
  ],
  'c2-016': [{ op: 'replace', partId: 'CR3' }],
  'c2-017': [
    { op: 'replace', partId: 'CR2' },
    { op: 'remove', wireId: 'sw-024' },
    { op: 'add', from: 'CR2.8', to: 'TB_PL.1+' },
  ],
  'c2-018': [
    { op: 'remove', wireId: 'sw-019' },
    { op: 'add', from: 'T1.6', to: 'TB_PL.2+' },
    { op: 'replace', partId: 'CR1' },
    { op: 'remove', wireId: 'sw-016' },
    { op: 'add', from: 'T1.5', to: 'TB_PB.2c' },
  ],
  'c2-019': [{ op: 'replace', partId: 'T1' }],
  // c2-020 はランダム故障。`SEEDS['c2-020']` で解決した3件（sw-007 断線・sw-006 断線・
  // sw-004 誤配線）に対応する手順で、種を変えるとこの並びは合わなくなる。
  'c2-020': [
    { op: 'remove', wireId: 'sw-007' },
    { op: 'add', from: 'CR1.9', to: 'TB_PB.3c' },
    { op: 'remove', wireId: 'sw-006' },
    { op: 'add', from: 'TB_PB.1c', to: 'CR1.9' },
    { op: 'remove', wireId: 'sw-004' },
    { op: 'add', from: 'CR2.10', to: 'CR1.11' },
  ],
};

/** ランダム故障の課題で使う種（決定論のため。§7.5 / CT-04）。 */
const SEEDS: Readonly<Record<string, number>> = { 'c2-020': 20260920 };

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

/**
 * その故障箇所を直すのに要る修復手順の数。`REPAIRS[id]` の並びは `applied.sites`（＝
 * 課題の `faults`）と同じ順で、断線・誤配線は「外して張り直す」の2手、未配線・部品不良は
 * 1手で直る（`REPAIRS` の定義から数えて確認済み）。
 */
function repairOpCount(site: FaultSite): number {
  return site.kind === 'wire-open' || site.kind === 'wire-misrouted' ? 2 : 1;
}

/** 課題の修復手順を、故障箇所（`sites`）ごとに順番どおり分割する。 */
function repairsBySite(id: string, sites: readonly FaultSite[]): readonly Repair[][] {
  const all = REPAIRS[id] ?? [];
  let offset = 0;
  return sites.map((site) => {
    const count = repairOpCount(site);
    const chunk = all.slice(offset, offset + count);
    offset += count;
    return chunk;
  });
}

function circuitOf(id: string) {
  const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === id);
  if (problem === undefined) throw new Error(`no problem ${id}`);
  const seed = SEEDS[id];
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD, seed === undefined ? {} : { seed });
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

describe('内蔵C2課題60題（§7.9）', () => {
  it('registers sixty problems: thirty grade 2 and thirty grade 1', () => {
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS).toHaveLength(60);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.map((p) => p.id)).toEqual(
      Array.from({ length: 60 }, (_, i) => `c2-${String(i + 1).padStart(3, '0')}`),
    );
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.filter((p) => p.grade === 2)).toHaveLength(30);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.filter((p) => p.grade === 1)).toHaveLength(30);
  });

  it('難しさが級の帯に収まる（§4.3 Phase 7）', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const allowed = problem.grade === 2 ? [2, 3, 4] : [4, 5];
      expect(allowed, `${problem.id}（${problem.grade}級）`).toContain(problem.difficulty);
    }
  });

  it('全60題ぶんの修復手順が書いてある（新題を黙って未検証にしない）', () => {
    expect(Object.keys(REPAIRS).sort()).toEqual(
      [...BUILTIN_INSPECT_REPAIR_PROBLEMS].map((p) => p.id).sort(),
    );
  });

  it('covers wire and part faults across the sixty problems (§5.4)', () => {
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

describe('内蔵C2課題：故障箇所を1つだけ残すと必ず不合格になる（§9.2 判定①②）', () => {
  for (const id of Object.keys(REPAIRS)) {
    it(`${id}: 各故障箇所を1つずつ直し忘れると不合格になる`, () => {
      const { problem, circuit } = circuitOf(id);
      const sites = circuit.applied.sites;
      const bySite = repairsBySite(id, sites);
      const reports = correctReports(circuit);
      for (let i = 0; i < sites.length; i += 1) {
        // 他の箇所は全部直すが、この箇所だけはわざと直さない。
        const { circuit: fresh } = circuitOf(id);
        const opsForOtherSites = bySite.flatMap((ops, j) => (j === i ? [] : ops));
        const repaired = applyRepairs(fresh, opsForOtherSites);
        const judged = judgeInspectRepair(problem, JIPM_BOARD, repaired, reports);
        expect(judged.ok, `${id}[${String(i)}]`).toBe(true);
        if (!judged.ok) continue;
        expect(judged.value.passed, `${id}[${String(i)}]`).toBe(false);
        expect(judged.value.mismatches.length, `${id}[${String(i)}]`).toBeGreaterThan(0);
      }
    });
  }
});
