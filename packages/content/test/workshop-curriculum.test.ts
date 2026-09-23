import {
  JIPM_BOARD,
  boardFromProfile,
  addWire,
  removeWire,
  plug,
  toNetlist,
  createSession,
  FREE_TRAINING_RULES,
  routeSession,
  channelsClearOfFootprints,
} from '@ojt/board-model';
import { Simulation, toTerminalId, measureVoltage } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS, BUILTIN_PLC_PROBLEMS } from '../src/builtin/index.js';
import { buildReferenceSession } from '../src/reference.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';
import { runOperations } from '../src/runner.js';
import { runPlcOperations } from '../src/plc-io.js';
import { judgeAssemble } from '../src/judge.js';
import { parseProblem } from '../src/schema/index.js';
import specifications from './helpers/workshop-specs.json';

// 回路の直並列セルではなく、課題文から書いた独立の真理値式。
const CONDITIONS = [
  (a: boolean, b: boolean, c: boolean, d: boolean) => a && b && c && d,
  (a: boolean, b: boolean, c: boolean, d: boolean) => (a && b) || (c && d),
  (a: boolean, b: boolean, c: boolean, d: boolean) => a && b && (!c || d),
  (a: boolean, b: boolean, c: boolean, d: boolean) => (a && !b && c && !d) || (!a && b && !c && d),
  (a: boolean, b: boolean, c: boolean, d: boolean) => a && !b && !c && !d,
  (a: boolean, b: boolean, c: boolean, d: boolean) => (a && c) || (b && !d),
  (a: boolean, b: boolean, c: boolean, d: boolean) => b && c && (a || d),
  (a: boolean, b: boolean, c: boolean, d: boolean) => a && (c ? !b : d),
];
const specs: Record<string, { timerMode: string; presetMs: number; secondary: boolean }> =
  specifications;

describe('追加実習の操作と期待動作', () => {
  it('自由盤の部品制限を装着時に守り、判定規則の上書きを模範判定にも反映する', () => {
    const profile = {
      id: 'expanded' as const,
      terminalPairs: 0,
      extraPushButtons: 0,
      extraLamps: 0,
      rules: {
        ...FREE_TRAINING_RULES,
        allowedParts: ['relay-my4n'] as const,
        hintPolicy: 'off' as const,
        staticChecks: { unusedParts: false },
      },
    };
    const original = BUILTIN_ASSEMBLE_PROBLEMS[0]!;
    const parsed = parseProblem({ ...original, board: { ...original.board, profile } });
    if (!parsed.ok || parsed.problem.mode !== 'assemble')
      throw new Error('自由盤の課題を検証できません');
    const problem = parsed.problem;
    const board = boardFromProfile(profile);
    const session = createSession(board);
    expect(plug(session, 'S5', 'timer-h3y4').ok).toBe(false);
    const built = buildReferenceSession(problem, board);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    expect(plug(built.value.session, 'S2', 'relay-my4n').ok).toBe(true);
    const judged = judgeAssemble(problem, board, built.value.session);
    expect(judged.ok && judged.value.passed).toBe(true);
    expect(judged.ok && judged.value.staticChecks.some((check) => check.id === 'unusedParts')).toBe(
      false,
    );
    const strict = structuredClone(problem);
    strict.board.profile!.rules.staticChecks = { unusedParts: true };
    const strictBoard = boardFromProfile(strict.board.profile);
    const strictBuilt = buildReferenceSession(strict, strictBoard);
    if (!strictBuilt.ok) throw new Error(JSON.stringify(strictBuilt.errors));
    expect(plug(strictBuilt.value.session, 'S2', 'relay-my4n').ok).toBe(true);
    const enforced = judgeAssemble(strict, strictBoard, strictBuilt.value.session);
    expect(enforced.ok && enforced.value.passed).toBe(false);
  });
  for (const problem of [
    ...BUILTIN_ASSEMBLE_PROBLEMS.slice(60, 86),
    ...BUILTIN_PLC_PROBLEMS.slice(60),
  ]) {
    it(`${problem.id}: 四入力の全16状態と時間条件を満たす`, () => {
      const spec = specs[problem.id]!;
      const condition = CONDITIONS[(Number(problem.id.split('-')[1]) - 61) % 8]!;
      const run = (() => {
        if (problem.mode === 'plc') {
          const built = buildPlcReferenceSession(problem, JIPM_BOARD);
          if (!built.ok) throw new Error(JSON.stringify(built.errors));
          return runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
            durationMs: problem.durationMs,
          });
        }
        const built = buildReferenceSession(problem, JIPM_BOARD);
        if (!built.ok) throw new Error(JSON.stringify(built.errors));
        return runOperations(built.value.netlist, problem.operations, {
          durationMs: problem.durationMs,
        });
      })();
      const inputs = [false, false, false, false];
      let cursor = 0,
        changed = 0,
        since = 0;
      let previous = false;
      const states = new Set<string>();
      for (let t = 0; t < problem.durationMs; t += 10) {
        while (problem.operations[cursor] && problem.operations[cursor]!.t <= t) {
          const op = problem.operations[cursor++]!;
          inputs[Number(op.target.slice(2)) - 1] = op.action === 'press';
          changed = op.t;
        }
        states.add(inputs.join(','));
        const on = condition(inputs[0]!, inputs[1]!, inputs[2]!, inputs[3]!);
        if (on && !previous) since = t;
        previous = on;
        const timed = spec.timerMode !== 'none';
        if (
          t % 100 !== 0 ||
          t - changed < 160 ||
          (timed && Math.abs(t - since - spec.presetMs) < 160)
        )
          continue;
        const elapsed = t - since >= spec.presetMs;
        expect(run.log.valueAt('PL1', t), `${problem.id} PL1 ${t}ms`).toBe(
          on && (!timed || (spec.timerMode === 'delay' ? elapsed : !elapsed)),
        );
        if (timed || spec.secondary)
          expect(run.log.valueAt('PL2', t), `${problem.id} PL2 ${t}ms`).toBe(
            timed ? on && (spec.timerMode === 'delay' ? !elapsed : elapsed) : inputs[3],
          );
      }
      expect(states.size).toBe(16);
    });
  }

  for (const problem of BUILTIN_ASSEMBLE_PROBLEMS.slice(86)) {
    it(`${problem.id}: 追加PB/PLは中継端子経由でも採点・電圧が一致する`, () => {
      const board = boardFromProfile(problem.board.profile);
      const built = buildReferenceSession(problem, board);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      const wire = built.value.session.wires.find(
        (w) => w.to === toTerminalId('TB_PL.5+') || w.from === toTerminalId('TB_PL.5+'),
      )!;
      expect(removeWire(built.value.session, wire.id).ok).toBe(true);
      for (const [from, to] of [
        [wire.from, 'TB_AUX.1a'],
        ['TB_AUX.1b', wire.to],
      ])
        expect(
          addWire(built.value.session, board, toTerminalId(from!), toTerminalId(to!), '黄').ok,
        ).toBe(true);
      const judged = judgeAssemble(problem, JIPM_BOARD, built.value.session);
      expect(judged.ok && judged.value.passed, JSON.stringify(judged)).toBe(true);
      const sim = new Simulation(toNetlist(built.value.session, board));
      sim.setBreaker(true);
      sim.setSwitch(true);
      sim.press('PB5');
      sim.run(300);
      expect(
        Math.abs(measureVoltage(sim, toTerminalId('TB_AUX.1a'), toTerminalId('TB_AUX.1b')).volts),
      ).toBeLessThan(0.01);
      expect(routeSession(board, built.value.session)).toHaveLength(
        built.value.session.wires.length,
      );
    });
  }

  it('自由盤の4本上限を回路計算も受け入れ、5本目は盤が拒否する', () => {
    const board = boardFromProfile({
      id: 'expanded',
      terminalPairs: 4,
      extraPushButtons: 0,
      extraLamps: 0,
      rules: FREE_TRAINING_RULES,
    });
    const session = createSession(board, { includeCheckWires: false });
    for (let n = 1; n <= 4; n++)
      expect(
        addWire(session, board, toTerminalId('P.1'), toTerminalId(`TB_AUX.${n}a`), '青').ok,
      ).toBe(true);
    expect(addWire(session, board, toTerminalId('P.1'), toTerminalId('TB_PB.1c'), '青').ok).toBe(
      false,
    );
    const sim = new Simulation(toNetlist(session, board));
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.run(100);
    expect(sim.events.hazards()).toEqual([]);
    expect(channelsClearOfFootprints(board)).toEqual([]);
  });
});
