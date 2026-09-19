import {
  addWire,
  createSession,
  deskWires,
  isOffBoardTerminal,
  JIPM_BOARD,
  PLC_UNIT_CP1E,
  PLC_UNIT_FX5U,
  routeSession,
  withPlcUnit,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { deskCablePoints, offBoardTerminals } from '../src/renderer/three/DeskWires.js';
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

  it('draws a sagging cable between the two ends', () => {
    const points = deskCablePoints({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 });
    expect(points).toHaveLength(3);
    // `toScene()` は盤の中心を原点に置く（`BOARD_WIDTH_MM = 330` / `BOARD_HEIGHT_MM = 245`）
    expect(points[0]).toEqual([-165, 122.5, 0]);
    // 中間点は手前（盤モデルの y が増える方向＝シーンの −Y）へ垂れる
    expect(points[1]?.[1]).toBeLessThan(points[0]?.[1] ?? 0);
    expect(points[2]?.[0]).toBeCloseTo(100 - 165, 6);
  });
});
