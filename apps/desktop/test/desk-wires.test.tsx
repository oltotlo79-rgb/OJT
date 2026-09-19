import {
  addWire,
  createSession,
  deskRoutes,
  JIPM_BOARD,
  PLC_UNIT_FX5U,
  PLC_UNIT_PC10G,
  withPlcUnit,
  type BoardDefinition,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { cleanup, render } from '@testing-library/react';
import { TubeGeometry } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeskWires, deskWireSignature } from '../src/renderer/three/DeskWires.js';

/**
 * 机上のケーブルの描画（§10.1 / §11.3 / 決定表#9）。
 * 経路1本につき管1本であること（`deskRoutes()` の結果をそのまま描いていること）と、
 * 外れたときに `TubeGeometry` を解放すること（§15。レビュー Test gaps）を固定する。
 * `wire-geometry.test.ts` が盤側（`Wire.tsx`）で確かめているのと同じ約束である。
 */

afterEach(() => {
  cleanup();
});

const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

function sessionWith(
  target: BoardDefinition,
  wires: ReadonlyArray<readonly [string, string]>,
  colors: readonly ['青'] | readonly ['青', '白'] = ['青'],
): ReturnType<typeof createSession> {
  const session = createSession(target, {
    roles: { S1: 'CR1', S7: 'CHK' },
    allowedColors: colors,
    extraParts: [],
    inventory: [],
  });
  for (const [from, to] of wires) {
    const added = addWire(
      session,
      target,
      from as TerminalId,
      to as TerminalId,
      colors[colors.length - 1],
    );
    expect(added.ok).toBe(true);
  }
  return session;
}

describe('DeskWires（§10.1 / 決定表#9）', () => {
  it('draws one tube per desk route and disposes it on unmount', () => {
    const session = sessionWith(board, [
      ['TB_PB.1a', 'PLC.X0'],
      ['OUTLET.L', 'PLC.L'],
    ]);
    expect(deskRoutes(board, session)).toHaveLength(2);
    const disposeSpy = vi.spyOn(TubeGeometry.prototype, 'dispose');
    const { unmount } = render(<DeskWires board={board} session={session} />);
    expect(disposeSpy).not.toHaveBeenCalled();
    unmount();
    // 青いケーブルは胴体だけ（縁取りは白線にしか付かない）
    expect(disposeSpy).toHaveBeenCalledTimes(2);
    disposeSpy.mockRestore();
  });

  it('adds the dark outline only to a white cable', () => {
    const session = sessionWith(board, [['TB_PB.1a', 'PLC.X0']], ['青', '白']);
    const disposeSpy = vi.spyOn(TubeGeometry.prototype, 'dispose');
    const { unmount } = render(<DeskWires board={board} session={session} />);
    unmount();
    // 白線は盤面に同化するので胴体＋縁取りの2本になる（`Wire.tsx` と同じ扱い）
    expect(disposeSpy).toHaveBeenCalledTimes(2);
    disposeSpy.mockRestore();
  });

  it('draws nothing when no wire reaches the desk', () => {
    const session = createSession(board, {
      roles: { S1: 'CR1', S7: 'CHK' },
      allowedColors: ['青'],
      extraParts: [],
      inventory: [],
    });
    const { container } = render(<DeskWires board={board} session={session} />);
    expect(container.textContent).toBe('');
  });

  it('routes the same desk cable when the PLC is a rack (受入基準③)', () => {
    // ラックの `IN-12` の端子は `X0`〜（4A 決定表#16）。端子IDにモジュール名は入らない（H-6）
    const rackBoard = withPlcUnit(JIPM_BOARD, PLC_UNIT_PC10G);
    const session = sessionWith(rackBoard, [['TB_PB.1a', 'PLC.X0']]);

    const disposeSpy = vi.spyOn(TubeGeometry.prototype, 'dispose');
    const { unmount } = render(<DeskWires board={rackBoard} session={session} />);
    expect(disposeSpy).not.toHaveBeenCalled();
    unmount();
    // 机上のケーブルがちょうど1本（＝ラックの端子も FX5U と同じように引けている）
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });
});

describe('deskWireSignature（M2: Plan 5 C/D レビュー）', () => {
  it('changes when only the PLC obstacle (outline) moves, wire endpoints unchanged', () => {
    const session = sessionWith(board, [['TB_PB.1a', 'PLC.X0']]);
    /*
     * 端子（`unit.terminals`）はそのまま流用し、本体の設置位置だけずらす。
     * `PLC.X0` の生座標（＝配線の両端）は1mmも動いていないのに、本体（障害物）の外形は変わる
     * ——机上の端子位置が同じまま機種だけ差し替わる盤（`withPlcUnit()`）と同じ状況を作る。
     */
    const shiftedUnit: PlcUnitDefinition = {
      ...PLC_UNIT_FX5U,
      pos: { x: PLC_UNIT_FX5U.pos.x + 50, y: PLC_UNIT_FX5U.pos.y, z: PLC_UNIT_FX5U.pos.z },
    };
    const shiftedBoard = withPlcUnit(JIPM_BOARD, shiftedUnit);
    expect(deskWireSignature(board, session)).not.toBe(deskWireSignature(shiftedBoard, session));
  });

  it('stays the same when nothing (board id, PLC outline, wires) changed', () => {
    const session = sessionWith(board, [['TB_PB.1a', 'PLC.X0']]);
    expect(deskWireSignature(board, session)).toBe(deskWireSignature(board, session));
  });
});
