import { JIPM_BOARD, routeWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { checkSessionFor, sessionForProblem } from '../src/renderer/app/store-session.js';

describe('課題の用途に合った初期配線', () => {
  it('全ての組立・PLC課題は配線ゼロから始まり、点検用の3本を混ぜない', () => {
    const problems = [...BUILTIN_ASSEMBLE_PROBLEMS, ...BUILTIN_PLC_PROBLEMS];
    expect(problems).toHaveLength(180);
    for (const problem of problems) {
      expect(sessionForProblem(problem).wires, problem.id).toEqual([]);
    }
  });
  it('部品点検はチェック回路を維持する', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      expect(
        checkSessionFor(problem).wires.map((wire) => [wire.from, wire.to, wire.locked]),
      ).toEqual([
        ['P.1', 'TB_PB.4c', true],
        ['TB_PB.4a', 'CHK.14', true],
        ['CHK.13', 'N.1', true],
      ]);
    }
  });
  it('P端子の配線は、ネジから端子台の外側へ露出してから盤面に降りる（逆向きも同じ）', () => {
    for (const reverse of [false, true]) {
      const endpoints = reverse ? ['TB_PB.1c', 'P.1'] : ['P.1', 'TB_PB.1c'];
      const route = routeWire(
        JIPM_BOARD,
        {
          id: 'visible-p',
          from: toTerminalId(endpoints[0]!),
          to: toTerminalId(endpoints[1]!),
        },
        [],
      );
      const points = reverse ? [...route.corners].reverse() : route.corners;
      expect(points[0]).toEqual({ x: 20, y: 14, z: 8 });
      const exit = points.find((p) => p.x < 12);
      expect(exit?.y).toBe(14);
      expect(exit?.z).toBeGreaterThanOrEqual(10);
    }
  });
});
