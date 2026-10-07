import { JIPM_BOARD, removeWire, type BoardSession } from '@ojt/board-model';
import type { LadderProgram } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  buildPrewiredPlcSession,
  buildReferenceSession,
  createAssembleLabProblem,
  createPlcLabProblem,
  expectedFromChart,
  findBuiltinProblem,
  findLabTemplate,
  isAssembleProblem,
  isPlcProblem,
  judgeAssembleLab,
  judgePlcLab,
  labSessionFor,
  labTemplatesFor,
  type AssembleProblem,
  type PlcProblem,
} from '../src/index.js';

/**
 * 「回路実験」「PLC実験」の判定（2026-10-08 利用者指示）。
 * 設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §5
 */
const VENDORS = ['mitsubishi', 'jtekt', 'omron', 'sharp'] as const;

function assembleSource(id: string): AssembleProblem {
  const problem = findBuiltinProblem(id);
  if (problem === undefined || !isAssembleProblem(problem)) throw new Error(id);
  return problem;
}

function plcSource(id: string): PlcProblem {
  const problem = findBuiltinProblem(id);
  if (problem === undefined || !isPlcProblem(problem)) throw new Error(id);
  return problem;
}

function referenceBoard(id: string): BoardSession {
  const reference = buildReferenceSession(assembleSource(id), JIPM_BOARD);
  if (!reference.ok) throw new Error(JSON.stringify(reference.errors));
  return reference.value.session;
}

function selfHold() {
  const template = findLabTemplate('assemble-lab', 'self-hold');
  if (template === undefined) throw new Error('self-hold');
  return template;
}

/** 例題「自己保持」の入力だけ（正解なし）。 */
function selfHoldInputsOnly() {
  const { operations, durationMs } = selfHold();
  return { operations, durationMs };
}

describe('回路実験の判定', () => {
  it('例題「自己保持」は元の課題の模範回路で合格する', () => {
    const outcome = judgeAssembleLab(
      createAssembleLabProblem(selfHold()),
      JIPM_BOARD,
      referenceBoard('b-001'),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.mode).toBe('assemble-lab');
    expect(outcome.value.judged).toBe(true);
    expect(outcome.value.mismatches).toEqual([]);
    expect(outcome.value.staticChecks.filter((check) => !check.ok)).toEqual([]);
    expect(outcome.value.passed).toBe(true);
    expect(outcome.value.compareSignals).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(outcome.value.charts.expected?.signals).toHaveLength(8);
    expect(outcome.value.charts.actual.signals).toHaveLength(8);
  });

  it('電線を1本抜いた盤は不合格（違いが出る）', () => {
    const session = referenceBoard('b-001');
    const wire = session.wires.find((candidate) => !candidate.locked);
    if (wire === undefined) throw new Error('no wire');
    expect(removeWire(session, wire.id).ok).toBe(true);
    const outcome = judgeAssembleLab(createAssembleLabProblem(selfHold()), JIPM_BOARD, session);
    expect(outcome.ok && outcome.value.passed).toBe(false);
    expect(outcome.ok && outcome.value.mismatches.length).toBeGreaterThan(0);
  });

  it('正解が無いときは動かすだけで、合否は出さない', () => {
    const withoutExpected = selfHoldInputsOnly();
    const outcome = judgeAssembleLab(
      createAssembleLabProblem(withoutExpected),
      JIPM_BOARD,
      referenceBoard('b-001'),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.judged).toBe(false);
    expect(outcome.value.passed).toBe(false);
    expect(outcome.value.charts.expected).toBeUndefined();
    const pl1 = outcome.value.charts.actual.signals.find((signal) => signal.name === 'PL1');
    expect(pl1?.segments.some((segment) => segment.value)).toBe(true);
  });

  it('動かした結果を正解に取り込むと合格する', () => {
    const withoutExpected = selfHoldInputsOnly();
    const session = referenceBoard('b-001');
    const first = judgeAssembleLab(createAssembleLabProblem(withoutExpected), JIPM_BOARD, session);
    if (!first.ok) throw new Error('judge');
    const captured = expectedFromChart(first.value.charts.actual);
    const second = judgeAssembleLab(
      createAssembleLabProblem({ ...withoutExpected, expected: captured }),
      JIPM_BOARD,
      session,
    );
    expect(second.ok && second.value.passed).toBe(true);
  });

  it('判定するランプだけを比べる', () => {
    const problem = createAssembleLabProblem({
      ...selfHold(),
      expected: [{ signal: 'PL2', on: [[1_000, 2_000]] }],
    });
    const all = judgeAssembleLab(problem, JIPM_BOARD, referenceBoard('b-001'));
    expect(all.ok && all.value.passed).toBe(false);
    const onlyPl3 = judgeAssembleLab(
      { ...problem, judge: { ...problem.judge, compareSignals: ['PL3'] } },
      JIPM_BOARD,
      referenceBoard('b-001'),
    );
    expect(onlyPl3.ok && onlyPl3.value.passed).toBe(true);
    expect(onlyPl3.ok && onlyPl3.value.compareSignals).toEqual(['PL3']);
  });

  it('何も付いていない盤から始める（標準のリレー・タイマの在庫）', () => {
    const session = labSessionFor(createAssembleLabProblem(), JIPM_BOARD);
    expect(session.wires).toEqual([]);
    expect(session.mounted).toEqual({});
    expect(session.inventory).toEqual([
      { kind: 'relay-my4n', count: 4 },
      { kind: 'timer-h3y4', count: 2 },
    ]);
  });
});

describe('PLC実験の判定', () => {
  it.each(VENDORS)('%s: 配線済みの盤はリレー4個と固定電線で、静的チェックに合格する', (vendor) => {
    const problem = createPlcLabProblem({ vendor, prewired: true });
    const prewired = buildPrewiredPlcSession(problem, JIPM_BOARD);
    expect(prewired.ok).toBe(true);
    if (!prewired.ok) return;
    const session = prewired.value;
    expect(Object.keys(session.mounted)).toHaveLength(4);
    expect(session.wires.length).toBeGreaterThan(0);
    expect(session.wires.every((wire) => wire.locked)).toBe(true);
    // 電線を外せないので割付も固定（割付表から変えない）
    expect(problem.io.mode).toBe('fixed');
    expect(labSessionFor(problem, JIPM_BOARD).wires.length).toBe(session.wires.length);

    const outcome = judgePlcLab(problem, JIPM_BOARD, session, plcSource('d-001').referenceLadder);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.staticChecks.filter((check) => !check.ok)).toEqual([]);
    expect(outcome.value.judged).toBe(false);
    expect(outcome.value.ladderErrors).toEqual([]);
  });

  it('自分で配線する盤はPLC本体だけ（電線もリレーも無い）で、そのままでは静的チェックに落ちる', () => {
    const problem = createPlcLabProblem({ vendor: 'mitsubishi', prewired: false });
    const session = labSessionFor(problem, JIPM_BOARD);
    expect(session.wires).toEqual([]);
    expect(session.mounted).toEqual({});
    expect(problem.io.mode).toBe('free');
    const outcome = judgePlcLab(
      createPlcLabProblem({
        vendor: 'mitsubishi',
        prewired: false,
        ...findLabTemplate('plc-lab', 'self-hold'),
      }),
      JIPM_BOARD,
      session,
      plcSource('d-001').referenceLadder,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.passed).toBe(false);
    expect(outcome.value.staticChecks.some((check) => !check.ok)).toBe(true);
  });

  it('変換できないラダーは動かさず、ラダーの指摘を返す', () => {
    const problem = createPlcLabProblem({
      vendor: 'omron',
      prewired: true,
      ...findLabTemplate('plc-lab', 'self-hold'),
    });
    const prewired = buildPrewiredPlcSession(problem, JIPM_BOARD);
    if (!prewired.ok) throw new Error('prewired');
    const broken: LadderProgram = { networks: [] };
    const outcome = judgePlcLab(problem, JIPM_BOARD, prewired.value, broken);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.ladderErrors.length).toBeGreaterThan(0);
    expect(outcome.value.passed).toBe(false);
    expect(outcome.value.judged).toBe(true);
    expect(outcome.value.charts.actual.signals).toEqual([]);
    expect(outcome.value.charts.expected?.signals).toHaveLength(8);
  });

  it('盤が課題と合わなければ課題エラー', () => {
    const problem = createPlcLabProblem({ vendor: 'sharp', prewired: false });
    const other = { ...JIPM_BOARD, id: 'board-other' };
    const outcome = judgePlcLab(
      problem,
      other,
      labSessionFor(problem, JIPM_BOARD),
      plcSource('d-001').referenceLadder,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('例題は元の課題の模範で合格する', () => {
  it.each(labTemplatesFor('assemble-lab').map((template) => [template.id, template] as const))(
    '回路実験 %s',
    (_id, template) => {
      const outcome = judgeAssembleLab(
        createAssembleLabProblem(template),
        JIPM_BOARD,
        referenceBoard(template.source),
      );
      expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.mismatches).toEqual([]);
      expect(outcome.value.staticChecks.filter((check) => !check.ok)).toEqual([]);
      expect(outcome.value.passed).toBe(true);
    },
  );

  it.each(
    labTemplatesFor('plc-lab').flatMap((template) =>
      VENDORS.map((vendor) => [template.id, vendor, template] as const),
    ),
  )('PLC実験 %s（%s・配線済み）', (_id, vendor, template) => {
    const problem = createPlcLabProblem({ vendor, prewired: true, ...template });
    const prewired = buildPrewiredPlcSession(problem, JIPM_BOARD);
    if (!prewired.ok) throw new Error(JSON.stringify(prewired.errors));
    const outcome = judgePlcLab(
      problem,
      JIPM_BOARD,
      prewired.value,
      plcSource(template.source).referenceLadder,
    );
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.mismatches).toEqual([]);
    expect(outcome.value.staticChecks.filter((check) => !check.ok)).toEqual([]);
    expect(outcome.value.passed).toBe(true);
  });
});
