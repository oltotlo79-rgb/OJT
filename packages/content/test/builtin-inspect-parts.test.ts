import { JIPM_BOARD } from '@ojt/board-model';
import { continuity, measureResistance, Simulation } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSPECT_PARTS_PROBLEMS } from '../src/builtin/index.js';
import {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  CHECK_PART_ID,
  checkContactTerminals,
  checkSettleMs,
  expectedCheckReading,
} from '../src/inspect-parts.js';
import { judgeInspectParts } from '../src/judge-inspect.js';
import type {
  InspectPartData,
  InspectPartsProblem,
  PartTruth,
} from '../src/schema/inspect-parts.js';

/** §9.1 の手順どおりに1個を点検する。 */
function measure(problem: InspectPartsProblem, part: InspectPartData) {
  const built = buildCheckCircuit(problem, JIPM_BOARD, part.id);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const pins = checkContactTerminals(built.value.group);
  const sim = new Simulation(built.value.netlist);
  sim.setBreaker(true);
  sim.setSwitch(true);
  sim.run(100);
  const coil = measureResistance(sim, CHECK_COIL_MINUS, CHECK_COIL_PLUS);
  const aClosedOff = continuity(sim, pins.com, pins.no).conductive;
  const bClosedOff = continuity(sim, pins.com, pins.nc).conductive;
  sim.press('PB4');
  sim.run(sim.tMs + checkSettleMs(part.kind));
  const state = sim.state();
  return {
    picksUp:
      part.kind === 'timer-h3y4'
        ? (state.timers[CHECK_PART_ID]?.timedOut ?? false)
        : (state.relays[CHECK_PART_ID]?.contactsOn ?? false),
    coilOhms: coil.overRange ? null : coil.ohms,
    aClosedOff,
    bClosedOff,
    aClosedOn: continuity(sim, pins.com, pins.no).conductive,
    bClosedOn: continuity(sim, pins.com, pins.nc).conductive,
    hazards: sim.events.countOf('ohm-on-live'),
  };
}

describe('内蔵C1課題（§7.9 36セット）', () => {
  it('registers twelve sets with stable ids', () => {
    expect(BUILTIN_INSPECT_PARTS_PROBLEMS).toHaveLength(36);
    expect(BUILTIN_INSPECT_PARTS_PROBLEMS.map((p) => p.id)).toEqual(
      Array.from({ length: 36 }, (_, i) => `c1-${String(i + 1).padStart(3, '0')}`),
    );
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      expect(problem.mode).toBe('inspect-parts');
      expect(problem.board.boardId).toBe('board-jipm-std');
    }
  });

  it('mixes healthy and defective parts in every set (§7.9)', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      const truths = problem.parts.map((p) => p.truth);
      expect(truths.includes('normal'), problem.id).toBe(true);
      expect(
        truths.some((t) => t !== 'normal'),
        problem.id,
      ).toBe(true);
    }
  });

  it('never puts a layer short on a timer (§17.2 #6)', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      for (const part of problem.parts) {
        expect(part.kind === 'timer-h3y4' && part.truth === 'coil-layer-short').toBe(false);
      }
    }
  });

  it('covers all seven answer options across the twelve sets', () => {
    const seen = new Set(
      BUILTIN_INSPECT_PARTS_PROBLEMS.flatMap((p) => p.parts.map((part) => part.truth)),
    );
    expect(seen.size).toBe(7);
  });

  it('難しさが級の帯に収まる（§4.3 Phase 7）', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      const allowed = problem.grade === 3 ? [1, 2] : problem.grade === 2 ? [2, 3, 4] : [4, 5];
      expect(allowed, `${problem.id}（${problem.grade}級）`).toContain(problem.difficulty);
    }
  });

  it('自己整合: 全セットの全部品が判定表どおりの読値になる (§7.8 / §9.1)', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      for (const part of problem.parts) {
        const expected = expectedCheckReading(part);
        const actual = measure(problem, part);
        const where = `${problem.id}/${part.id}(${part.truth})`;
        expect(actual.picksUp, where).toBe(expected.picksUp);
        expect(actual.aClosedOff, where).toBe(expected.aClosedOff);
        expect(actual.aClosedOn, where).toBe(expected.aClosedOn);
        expect(actual.bClosedOff, where).toBe(expected.bClosedOff);
        expect(actual.bClosedOn, where).toBe(expected.bClosedOn);
        expect(actual.hazards, where).toBe(0);
        if (expected.coilOhms === null) expect(actual.coilOhms, where).toBeNull();
        else expect(actual.coilOhms ?? 0, where).toBeCloseTo(expected.coilOhms, 1);
      }
    }
  });

  it('自己整合: 正解どおりに答えると全セット合格する (§9.1)', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      const result = judgeInspectParts(
        problem,
        problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      );
      expect(result.passed, problem.id).toBe(true);
      expect(result.correctCount, problem.id).toBe(problem.parts.length);
    }
  });

  it('弁別: 1件だけ答えを変えると不合格になる', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      const first = problem.parts[0];
      if (first === undefined) continue;
      const wrong: PartTruth = first.truth === 'normal' ? 'coil-open' : 'normal';
      const answers = problem.parts.map((p, i) => ({
        partId: p.id,
        answer: i === 0 ? wrong : p.truth,
      }));
      const result = judgeInspectParts(problem, answers);
      expect(result.passed, problem.id).toBe(false);
      expect(result.correctCount, problem.id).toBe(problem.parts.length - 1);
    }
  });
});
