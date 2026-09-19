import {
  addWire,
  createSession,
  deskRoutes,
  deskWires,
  isOffBoardTerminal,
  JIPM_BOARD,
  PLC_UNIT_CP1E,
  PLC_UNIT_FX5U,
  PLC_UNIT_JW300,
  PLC_UNIT_PC10G,
  routeSession,
  withPlcUnit,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { offBoardTerminals } from '../src/renderer/three/DeskWires.js';
import { safeRoutes } from '../src/renderer/three/BoardScene.js';

/**
 * 机上の3D（設計仕様 §10.1 / 決定表#9）。
 * 盤の経路器（`routeSession()`）と机上のケーブル（`deskWires()`）が電線をきれいに分け合い、
 * 3D側がどちらも描けることを固定する。
 */

const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

function sessionWithDeskWire(): ReturnType<typeof createSession> {
  const session = createSession(board, {
    roles: { S1: 'CR1', S7: 'CHK' },
    allowedColors: ['青'],
    extraParts: [],
    inventory: [],
  });
  const added = addWire(session, board, 'TB_PB.1a' as TerminalId, 'PLC.X0' as TerminalId, '青');
  expect(added.ok).toBe(true);
  const power = addWire(session, board, 'OUTLET.L' as TerminalId, 'PLC.L' as TerminalId, '青');
  expect(power.ok).toBe(true);
  return session;
}

describe('机上の3D（§10.1 / 決定表#9）', () => {
  it('splits the wires between the board router and the desk cables', () => {
    const session = sessionWithDeskWire();
    // 盤の経路器が受け持つのは机上端子に繋がらない電線だけ（＝既設の固定配線3本）
    const onBoard = session.wires.filter(
      (wire) => !isOffBoardTerminal(wire.from) && !isOffBoardTerminal(wire.to),
    );
    expect(routeSession(board, session)).toHaveLength(onBoard.length);
    expect(deskWires(board, session)).toHaveLength(2);
    // 盤側の経路器は机上の電線で例外を出さない
    expect(safeRoutes(board, session).errors).toEqual([]);
  });

  it('lists the terminals that belong to the desk', () => {
    const ids = offBoardTerminals(board).map((t) => String(t.id));
    expect(ids).toContain('PLC.X0');
    expect(ids).toContain('PLC.COM0');
    expect(ids).toContain('OUTLET.L');
    expect(ids).not.toContain('TB_PB.1a');
    // FX5U は電源3・S/S・サービス2・入力16・COM4・出力16 = 42 端子 ＋ コンセント2
    expect(ids).toHaveLength(44);
  });

  it('paints the body in the colour the model describes (4A 決定表#15)', () => {
    // 3D側は `appearance` だけを読む（`three/**` に hex を書かない。4A H-7 / 決定表#15）
    expect(PLC_UNIT_FX5U.appearance.bodyColor).toBe('#3A3D42');
    expect(PLC_UNIT_CP1E.appearance.bodyColor).not.toBe(PLC_UNIT_FX5U.appearance.bodyColor);
    // 銘板は型式の文字列だけ（`displayName` とは別物。§17）
    expect(PLC_UNIT_FX5U.appearance.nameplate).toBe('FX5U-32MR/ES');
    expect(PLC_UNIT_FX5U.appearance.nameplate).not.toBe(PLC_UNIT_FX5U.displayName);
  });

  it('picks the rack drawing for a rack model and the body for a one-piece model', () => {
    expect(PLC_UNIT_PC10G.form).toBe('rack');
    expect(PLC_UNIT_JW300.form).toBe('rack');
    expect(PLC_UNIT_FX5U.form).toBe('unit');
    expect(PLC_UNIT_CP1E.form).toBe('unit');
  });

  it('routes the desk cables along the desk ducts (§11.3)', () => {
    const session = sessionWithDeskWire();
    const routes = deskRoutes(board, session);
    expect(routes).toHaveLength(2);
    // 盤の中と同じ直角の折れ線で返る（3Dは `Wire.tsx` と同じヘルパで管にするだけ）
    for (const route of routes) {
      expect(route.corners.length).toBeGreaterThan(3);
      expect(route.ductIds).toContain('desk-trunk');
    }
  });
});
