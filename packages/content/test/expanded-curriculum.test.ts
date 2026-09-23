import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
} from '../src/builtin/index.js';
import { buildReferenceSession } from '../src/reference.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';
import { runOperations } from '../src/runner.js';
import { runPlcOperations } from '../src/plc-io.js';

// 教材原稿の直並列配列を参照せず、課題文の条件を独立した真理値式で定義する。
const CONDITIONS = [
  (a: boolean, b: boolean) => a && !b,
  (a: boolean, b: boolean) => a !== b,
  (a: boolean, b: boolean, c: boolean) => a && b && c,
  (a: boolean, b: boolean, c: boolean) => (a || b) && c,
  (a: boolean, b: boolean, c: boolean) => a || (b && c),
  (a: boolean, b: boolean, c: boolean) => a && !b && !c,
  (a: boolean, b: boolean, c: boolean) => (a || b) && !c,
  (a: boolean, b: boolean, c: boolean) => a && b && !c,
  (a: boolean, b: boolean, c: boolean) => Number(a) + Number(b) + Number(c) >= 2,
  (a: boolean, b: boolean, c: boolean) => Number(a) + Number(b) + Number(c) === 1,
  (a: boolean, b: boolean, c: boolean) => Number(a) + Number(b) + Number(c) === 2,
  (a: boolean, b: boolean, c: boolean) => !(a === b && b === c),
  (a: boolean, b: boolean, c: boolean) => (a ? c : b),
  (a: boolean, b: boolean, c: boolean) => (a && !b) || (b && c),
  (a: boolean, b: boolean, c: boolean) => (a ? b : c),
  (a: boolean, b: boolean, c: boolean) => c && a !== b,
  (a: boolean, b: boolean, c: boolean) => c && a === b,
  (a: boolean, b: boolean, c: boolean) => (Number(a) + Number(b) + Number(c)) % 2 === 1,
  (a: boolean, b: boolean, c: boolean) => a && (!b || c),
  (a: boolean, b: boolean, c: boolean) => c || (a && b),
];

describe('追加教材の独立した仕様検証', () => {
  it('各モードが旧版の3倍以上あり、同じ題名で水増ししない', () => {
    for (const [mode, minimum] of [
      ['assemble', 90],
      ['inspect-parts', 54],
      ['inspect-repair', 90],
      ['plc', 90],
    ] as const) {
      const problems = BUILTIN_ALL_PROBLEMS.filter((p) => p.mode === mode);
      expect(problems.length).toBeGreaterThanOrEqual(minimum);
      expect(new Set(problems.map((p) => p.title)).size).toBe(problems.length);
    }
    const fingerprints = CONDITIONS.map((condition) =>
      Array.from({ length: 8 }, (_, state) =>
        condition(Boolean(state & 1), Boolean(state & 2), Boolean(state & 4)),
      ).join(','),
    );
    expect(new Set(fingerprints).size).toBe(CONDITIONS.length);
  });

  for (const problem of [
    ...BUILTIN_ASSEMBLE_PROBLEMS.slice(20, 60),
    ...BUILTIN_PLC_PROBLEMS.slice(20, 60),
  ]) {
    it(`${problem.id}: 全入力条件・時間条件が課題文に一致する`, () => {
      const index = Number(problem.id.split('-')[1]) - 21;
      const timed = index >= 20;
      const pulse = index >= 30;
      const condition = CONDITIONS[timed ? (index - 20) % 10 : index]!;
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
      const inputs = [false, false, false];
      let cursor = 0;
      let previous = false;
      let since = 0;
      let changed = 0;
      for (let t = 0; t < problem.durationMs; t += 100) {
        while (problem.operations[cursor] && problem.operations[cursor]!.t <= t) {
          const op = problem.operations[cursor++]!;
          inputs[Number(op.target.slice(2)) - 1] = op.action === 'press';
          changed = op.t;
        }
        const on = condition(inputs[0]!, inputs[1]!, inputs[2]!);
        if (on && !previous) since = t;
        previous = on;
        // 物理リレーの吸引時間とPLCスキャン境界は判定の許容差以内で比較する。
        if (t - changed < 150 || (timed && Math.abs(t - since - 1000) < 150)) continue;
        const elapsed = t - since >= 1000;
        expect(run.simulation.log.valueAt('PL1', t), `${problem.id} ${t}ms`).toBe(
          on && (!timed || (pulse ? !elapsed : elapsed)),
        );
        if (timed)
          expect(run.simulation.log.valueAt('PL2', t), `${problem.id} PL2 ${t}ms`).toBe(
            on && (pulse ? elapsed : !elapsed),
          );
      }
    });
  }
});
