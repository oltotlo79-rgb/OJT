import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { toTerminalId, type HazardEvent } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  buildInspectRepairCircuit,
  replacePart,
  REPAIR_WIRE_COLOR,
} from '../src/inspect-repair.js';
import {
  judgeInspectParts,
  judgeInspectRepair,
  scoreReports,
  type InspectPartAnswer,
} from '../src/judge-inspect.js';
import type { FaultReport } from '../src/faults.js';
import { findBuiltinProblem } from '../src/builtin/index.js';
import { isInspectPartsProblem } from '../src/schema/index.js';
import {
  inspectPartsProblemJson,
  inspectRepairProblemJson,
  parseInspectPartsOrThrow,
  parseInspectRepairOrThrow,
} from './helpers/inspect.js';

const OHM_ON_LIVE: HazardEvent = {
  type: 'hazard',
  kind: 'ohm-on-live',
  tMs: 1200,
  detail: 'CHK.13-CHK.14',
};

const SHORT_CIRCUIT: HazardEvent = {
  type: 'hazard',
  kind: 'short-circuit-power-on',
  tMs: 0,
  detail: '電源電流 240.0A',
};

/** 既定の課題（`sw-005` 断線 ＋ `sw-009` 未配線）で初期盤を作る。 */
function repairCircuit() {
  const problem = parseInspectRepairOrThrow(inspectRepairProblemJson());
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

/** 正しい指摘2件。 */
const CORRECT_REPORTS: FaultReport[] = [
  { target: { wireId: 'sw-005' }, kind: 'wire-open' },
  { target: { terminalId: 'CR1.6' }, kind: 'wire-missing' },
];

describe('judgeInspectParts', () => {
  it('passes when every answer matches the truth (§9.1)', () => {
    const problem = parseInspectPartsOrThrow(inspectPartsProblemJson());
    const answers: InspectPartAnswer[] = problem.parts.map((p) => ({
      partId: p.id,
      answer: p.truth,
    }));
    const result = judgeInspectParts(problem, answers);
    expect(result.mode).toBe('inspect-parts');
    expect(result.passed).toBe(true);
    expect(result.correctCount).toBe(4);
    expect(result.total).toBe(4);
  });

  it('受入基準②: コイル断線とレアショートを選び分けられれば正解になる', () => {
    const problem = parseInspectPartsOrThrow(inspectPartsProblemJson());
    const result = judgeInspectParts(problem, [
      { partId: 'p1', answer: 'normal' },
      { partId: 'p2', answer: 'coil-open' },
      { partId: 'p3', answer: 'coil-layer-short' },
      { partId: 'p4', answer: 'a-weld' },
    ]);
    expect(result.passed).toBe(true);
    expect(result.scores.find((s) => s.partId === 'p2')?.correct).toBe(true);
    expect(result.scores.find((s) => s.partId === 'p3')?.correct).toBe(true);
  });

  it('reports a partial score and marks the wrong rows (§9.1)', () => {
    const problem = parseInspectPartsOrThrow(inspectPartsProblemJson());
    const result = judgeInspectParts(problem, [
      { partId: 'p1', answer: 'normal' },
      { partId: 'p2', answer: 'coil-open' },
      { partId: 'p3', answer: 'normal' },
    ]);
    expect(result.passed).toBe(false);
    expect(result.correctCount).toBe(2);
    expect(result.total).toBe(4);
    expect(result.scores.find((s) => s.partId === 'p3')?.correct).toBe(false);
    expect(result.scores.find((s) => s.partId === 'p4')?.answer).toBeUndefined();
  });

  it('records hazards and elapsed time without changing the verdict (§17.2 #3)', () => {
    const problem = parseInspectPartsOrThrow(inspectPartsProblemJson());
    const answers: InspectPartAnswer[] = problem.parts.map((p) => ({
      partId: p.id,
      answer: p.truth,
    }));
    const result = judgeInspectParts(problem, answers, {
      elapsedMs: 900_000,
      sessionHazards: [OHM_ON_LIVE],
    });
    expect(result.passed).toBe(true);
    expect(result.hazardCount).toBe(1);
    expect(result.hazardsByKind['ohm-on-live']).toBe(1);
    expect(result.hazardsByKind['range-exceeded']).toBe(0);
    expect(result.elapsedMs).toBe(900_000);
  });

  it('同じ部品に複数の回答があれば最後の回答を採用する（重複回答の上書き）', () => {
    const problem = findBuiltinProblem('c1-001');
    if (problem === undefined || !isInspectPartsProblem(problem)) {
      throw new Error('c1-001 が見つかりません');
    }
    const p1 = problem.parts.find((p) => p.id === 'p1');
    expect(p1?.truth).toBe('normal');
    const answers: InspectPartAnswer[] = [
      ...problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      // p1 の本当の状態は 'normal' なので、この追加回答が採用されると不正解になる。
      { partId: 'p1', answer: 'coil-open' },
    ];
    const result = judgeInspectParts(problem, answers);
    expect(result.scores.find((s) => s.partId === 'p1')?.answer).toBe('coil-open');
    expect(result.scores.find((s) => s.partId === 'p1')?.correct).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe('scoreReports', () => {
  it('splits the reports into matched, missed and extra (§9.2)', () => {
    const { circuit } = repairCircuit();
    const scored = scoreReports(circuit.applied.sites, [
      ...CORRECT_REPORTS,
      { target: { wireId: 'sw-004' }, kind: 'wire-open' },
    ]);
    expect(scored.matched).toHaveLength(2);
    expect(scored.missed).toHaveLength(0);
    expect(scored.extra).toHaveLength(1);
  });

  it('counts an unreported fault as missed', () => {
    const { circuit } = repairCircuit();
    const first = CORRECT_REPORTS[0];
    if (first === undefined) return;
    const scored = scoreReports(circuit.applied.sites, [first]);
    expect(scored.matched).toHaveLength(1);
    expect(scored.missed).toHaveLength(1);
    expect(scored.missed[0]?.kind).toBe('wire-missing');
  });

  it('never lets one report cover two faults', () => {
    const { circuit } = repairCircuit();
    const first = CORRECT_REPORTS[0];
    if (first === undefined) return;
    const scored = scoreReports(circuit.applied.sites, [first, first]);
    expect(scored.matched).toHaveLength(1);
    expect(scored.extra).toHaveLength(1);
  });
});

describe('judgeInspectRepair', () => {
  /** 白線で正しく修復する（断線した青線を外して張り直し、未配線を足す）。 */
  function repair(session: ReturnType<typeof repairCircuit>['circuit']['session']): void {
    const removed = removeWire(session, 'sw-005');
    if (!removed.ok) throw new Error(removed.message);
    const a = addWire(
      session,
      JIPM_BOARD,
      toTerminalId('TB_PB.1a'),
      toTerminalId('CR1.14'),
      REPAIR_WIRE_COLOR,
    );
    if (!a.ok) throw new Error(a.message);
    const b = addWire(
      session,
      JIPM_BOARD,
      toTerminalId('CR1.6'),
      toTerminalId('TB_PL.1+'),
      REPAIR_WIRE_COLOR,
    );
    if (!b.ok) throw new Error(b.message);
  }

  it('受入基準③: 故障2箇所を指摘し白線で修復すると合格する (§9.2)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.mode).toBe('inspect-repair');
    expect(judged.value.passed).toBe(true);
    expect(judged.value.mismatches).toEqual([]);
    expect(judged.value.reports.missed).toEqual([]);
    expect(judged.value.reports.extra).toEqual([]);
    expect(judged.value.modifications).toEqual([]);
    expect(judged.value.addedWires).toHaveLength(2);
    expect(judged.value.staticChecks.every((c) => c.ok)).toBe(true);
    expect(judged.value.charts.expected.signals.length).toBeGreaterThan(0);
  });

  it('reports a dead reference circuit instead of a verdict, same as mode B (CT-02)', () => {
    // 操作列を空にすると、PB1を一度も押さないのでCR1もPL1も1回も変化しない
    // （模範回路そのものは正しく組めているが、実質動かない模範回路の別の作り方）。
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      operations: [],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const judged = judgeInspectRepair(problem, JIPM_BOARD, built.value, CORRECT_REPORTS);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.errors[0]?.message).toBe(
      '模範回路が動作しません（ランプ・コイルの変化がありません）',
    );
  });

  it('reports a problem-data error (not a trainee failure) when compareSignals names a signal absent from the reference log (CT-02)', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      judge: { compareSignals: ['PL9'] },
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const judged = judgeInspectRepair(problem, JIPM_BOARD, built.value, CORRECT_REPORTS);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.errors).toEqual([
      { path: 'judge.compareSignals[0]', message: '比較信号 PL9 は模範回路の記録にありません' },
    ]);
  });

  it('fails when the board still behaves differently from the reference', () => {
    const { problem, circuit } = repairCircuit();
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
  });

  it('fails when a fault is missed even though the behaviour is right', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const first = CORRECT_REPORTS[0];
    if (first === undefined) return;
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, [first]);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.reports.missed).toHaveLength(1);
  });

  it('counts deleting a healthy blue wire as a modification and fails (§9.2 改造)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const removed = removeWire(circuit.session, 'sw-004');
    expect(removed.ok).toBe(true);
    const added = addWire(
      circuit.session,
      JIPM_BOARD,
      toTerminalId('TB_PB.2b'),
      toTerminalId('TB_PB.1c'),
      REPAIR_WIRE_COLOR,
    );
    expect(added.ok).toBe(true);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.modifications).toEqual(['sw-004']);
    expect(judged.value.passed).toBe(false);
  });

  it('fails the wire colour rule when a repair wire is not white (§8.1)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const wire = circuit.session.wires.find((w) => w.id === addedIdOf(circuit.session));
    if (wire === undefined) return;
    wire.color = '青';
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'wireColorRule')?.ok).toBe(false);
    expect(judged.value.passed).toBe(false);
  });

  it('白線ルールは judge.staticChecks.wireColorRule を無効にしても外れない (I-2)', () => {
    const json = inspectRepairProblemJson();
    const judge = json.judge as { tolerance: unknown; staticChecks: Record<string, boolean> };
    const problem = parseInspectRepairOrThrow({
      ...json,
      judge: { ...judge, staticChecks: { ...judge.staticChecks, wireColorRule: false } },
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const circuit = built.value;
    repair(circuit.session);
    const wire = circuit.session.wires.find((w) => w.id === addedIdOf(circuit.session));
    if (wire === undefined) return;
    wire.color = '青';
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'wireColorRule')).toBeUndefined();
    expect(judged.value.passed).toBe(false);
  });

  it('keeps the surviving blue initial wiring out of the colour rule (§9.2)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'wireColorRule')?.ok).toBe(true);
  });

  it('passes after replacing a faulty relay (§9.2 部品交換)', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      faults: [{ target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-open' }],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const replaced = replacePart(built.value, 'CR1');
    const judged = judgeInspectRepair(problem, JIPM_BOARD, replaced, [
      { target: { partId: 'CR1' }, kind: 'part-defect' },
    ]);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.mismatches).toEqual([]);
    expect(judged.value.reports.missed).toEqual([]);
    expect(judged.value.passed).toBe(true);
  });

  it('records hazards without changing the verdict (§17.2 #3)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS, {
      elapsedMs: 1_500_000,
      sessionHazards: [OHM_ON_LIVE],
    });
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(true);
    expect(judged.value.hazardsByKind['ohm-on-live']).toBe(1);
    expect(judged.value.elapsedMs).toBe(1_500_000);
  });

  it('危険操作はセッションの記録だけを数える（判定の再生ぶんを二重計上しない。§5.6）', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    // P側（`CR1.10`）とN側（`TB_PL.1-`）を直結した盤。判定の再生でも通電直後に短絡保護が
    // 動作するので、セッションの記録と再生の記録を足すと同じ1回の短絡が2件に見えてしまう。
    const shorted = addWire(
      circuit.session,
      JIPM_BOARD,
      toTerminalId('CR1.10'),
      toTerminalId('TB_PL.1-'),
      REPAIR_WIRE_COLOR,
    );
    expect(shorted.ok).toBe(true);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS, {
      sessionHazards: [SHORT_CIRCUIT],
    });
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.hazardCount).toBe(1);
    expect(judged.value.hazardsByKind['short-circuit-power-on']).toBe(1);
  });
});

/** `repair()` が最後に足した電線のID（採番は `w-NNN`）。 */
function addedIdOf(session: { wires: { id: string }[] }): string {
  const added = session.wires.filter((w) => w.id.startsWith('w-'));
  return added[added.length - 1]?.id ?? '';
}
