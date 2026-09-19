import { createSession, JIPM_BOARD, PLC_UNIT_FX5U, withPlcUnit } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { runAddWire, runRemoveWire } from '../src/renderer/session/commands.js';
import { boardForProblem, canJudgePlc, plcBoardOf } from '../src/renderer/session/plc-session.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;
const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

/** `createSession()` は既設配線（`fw-chk-1`〜3）を積んで始まるので、その本数を基準にする。 */
const FIXED_WIRE_COUNT = JIPM_BOARD.fixedWires.length;

function fresh() {
  return createSession(board, {
    roles: { S1: 'CR1', S7: 'CHK' },
    allowedColors: ['青'],
    extraParts: [],
    inventory: [],
  });
}

describe('モードDの配線（§10.2）', () => {
  it('wires a board terminal to a PLC input', () => {
    const session = fresh();
    const result = runAddWire(
      session,
      'TB_PB.1a' as TerminalId,
      'PLC.X0' as TerminalId,
      '青',
      board,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(session.wires).toHaveLength(FIXED_WIRE_COUNT + 1);
    expect(result.command.label).toContain('PLC.X0');
  });

  it('wires the PLC power to the wall outlet', () => {
    const session = fresh();
    expect(
      runAddWire(session, 'OUTLET.L' as TerminalId, 'PLC.L' as TerminalId, '青', board).ok,
    ).toBe(true);
    expect(
      runAddWire(session, 'OUTLET.N' as TerminalId, 'PLC.N' as TerminalId, '青', board).ok,
    ).toBe(true);
  });

  it('still refuses a terminal the board does not have', () => {
    const session = fresh();
    const result = runAddWire(
      session,
      'PLC.X99' as TerminalId,
      'PLC.SS' as TerminalId,
      '青',
      board,
    );
    expect(result.ok).toBe(false);
  });

  it('keeps the two-wires-per-terminal rule on PLC terminals (§5.6 #5)', () => {
    const session = fresh();
    runAddWire(session, 'TB_PB.1a' as TerminalId, 'PLC.X0' as TerminalId, '青', board);
    runAddWire(session, 'TB_PB.2a' as TerminalId, 'PLC.X0' as TerminalId, '青', board);
    const third = runAddWire(
      session,
      'TB_PB.3a' as TerminalId,
      'PLC.X0' as TerminalId,
      '青',
      board,
    );
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.code).toBe('terminal-overload');
    // 危険操作として数えるために、断った電線そのものが返る（Plan 2B と同じ規則）
    expect(third.wire).toBeDefined();
  });

  it('removes a desk wire like any other', () => {
    const session = fresh();
    const added = runAddWire(session, 'OUTLET.L' as TerminalId, 'PLC.L' as TerminalId, '青', board);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(runRemoveWire(session, added.value.id).ok).toBe(true);
    expect(session.wires).toHaveLength(FIXED_WIRE_COUNT);
  });

  it('defaults to JIPM_BOARD so the other modes keep working', () => {
    const session = createSession(JIPM_BOARD, {
      roles: { S1: 'CR1', S7: 'CHK' },
      allowedColors: ['青'],
      extraParts: [],
      inventory: [],
    });
    expect(runAddWire(session, 'P.1' as TerminalId, 'TB_PB.2c' as TerminalId, '青').ok).toBe(true);
  });
});

describe('boardForProblem / canJudgePlc', () => {
  it('gives the derived board for mode D and the plain board otherwise', () => {
    expect(boardForProblem(problem).plcUnit?.model).toBe('FX5U');
    expect(plcBoardOf(problem)?.terminals.length).toBeGreaterThan(JIPM_BOARD.terminals.length);
  });

  it('only asks whether the ladder was converted (H-1 / 決定表#7)', () => {
    expect(canJudgePlc({ converted: false, ladder: undefined })).toEqual({
      ok: false,
      reason: 'no-ladder',
    });
    expect(canJudgePlc({ converted: false, ladder: problem.referenceLadder })).toEqual({
      ok: false,
      reason: 'not-converted',
    });
    expect(canJudgePlc({ converted: true, ladder: problem.referenceLadder })).toEqual({ ok: true });
  });
});
