import { addWire, createSession, plug, type BoardSession } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, toSocketRoles } from '@ojt/content';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  carryOverBoard,
  carrySummary,
  touchesPlcDesk,
} from '../src/renderer/session/dialect-carry.js';
import { boardForProblem } from '../src/renderer/session/plc-session.js';

/**
 * メーカー切替で盤の作業を持ち越す（2026-09-26 利用者報告「3D図の画面の時に各メーカーの
 * シーケンサーを切り替えることができない」）。
 */

const problem = BUILTIN_PLC_PROBLEMS[0]!;
const roles = toSocketRoles(problem.board.socketRoles);

function wired(): BoardSession {
  const board = boardForProblem(problem);
  const session = createSession(board, { roles, includeCheckWires: false });
  expect(plug(session, 'S1', 'relay-my4n').ok).toBe(true);
  expect(plug(session, 'S5', 'timer-h3y4', { presetMs: 3000, rangeMaxMs: 10000 }).ok).toBe(true);
  for (const [from, to] of [
    ['P.1', 'CR1.9'],
    ['CR1.5', 'TB_PL.1+'],
    ['TB_PB.1a', 'PLC.X0'],
    ['PLC.Y0', 'CR1.14'],
    ['OUTLET.N', 'PLC.N'],
  ]) {
    expect(addWire(session, board, toTerminalId(from!), toTerminalId(to!)).ok).toBe(true);
  }
  return session;
}

describe('dialect-carry', () => {
  it('tells PLC and outlet wires from wires that stay inside the board', () => {
    expect(touchesPlcDesk({ from: toTerminalId('PLC.X0'), to: toTerminalId('TB_PB.1a') })).toBe(
      true,
    );
    expect(touchesPlcDesk({ from: toTerminalId('OUTLET.L'), to: toTerminalId('PLC.L') })).toBe(
      true,
    );
    expect(touchesPlcDesk({ from: toTerminalId('P.1'), to: toTerminalId('CR1.9') })).toBe(false);
  });

  it('counts what a switch drops and keeps', () => {
    expect(carrySummary(wired())).toEqual({ dropped: 3, kept: 2, parts: 2 });
  });

  it('re-lays the board wires and parts on the fresh board of the other maker', () => {
    const previous = wired();
    const omron = { ...problem, plc: { vendor: 'omron', model: 'CP1E' } } as typeof problem;
    const board = boardForProblem(omron);
    const fresh = createSession(board, { roles, includeCheckWires: false });
    const carried = carryOverBoard(previous, fresh, board);
    expect(carried.wires.map((w) => `${w.from}-${w.to}`)).toEqual(['P.1-CR1.9', 'CR1.5-TB_PL.1+']);
    // 電線IDも引き継ぐ（作業ファイルやログの参照がずれない）
    expect(carried.wires.map((w) => w.id)).toEqual(
      previous.wires.filter((w) => !touchesPlcDesk(w)).map((w) => w.id),
    );
    expect(carried.mounted.S1).toEqual({ kind: 'relay-my4n' });
    expect(carried.mounted.S5).toEqual({ kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10000 });
    // 渡した盤は書き換えない
    expect(fresh.wires).toEqual([]);
    expect(carried.wireSeq).toBeGreaterThanOrEqual(previous.wireSeq);
  });
});
