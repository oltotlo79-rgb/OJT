import {
  addWire,
  createSession,
  JIPM_BOARD,
  PLC_UNIT_FX5U,
  PLC_UNIT_PC10G,
  withPlcUnit,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { cleanup, render } from '@testing-library/react';
import { TubeGeometry } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeskWires } from '../src/renderer/three/DeskWires.js';

/**
 * 机上のケーブルの `TubeGeometry` の解放（§15。レビュー Test gaps）。
 * `wire-geometry.test.ts` が盤側（`Wire.tsx`）で確かめているのと同じ「外れたら解放する」を
 * 机上ケーブル（`DeskWires.tsx`）側でも固定する。
 */

afterEach(() => {
  cleanup();
});

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
  return session;
}

describe('DeskWires（§10.1 / 決定表#9）', () => {
  it('disposes the cable TubeGeometry on unmount', () => {
    const session = sessionWithDeskWire();
    const disposeSpy = vi.spyOn(TubeGeometry.prototype, 'dispose');
    const { unmount } = render(<DeskWires board={board} session={session} />);
    expect(disposeSpy).not.toHaveBeenCalled();
    unmount();
    // このセッションは机上の電線を1本だけ張る（PLC電源は別途）
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });

  it('routes the same desk cable when the PLC is a rack (受入基準③)', () => {
    // ラックの `IN-12` の端子は `X0`〜（4A 決定表#16）。端子IDにモジュール名は入らない（H-6）
    const rackBoard = withPlcUnit(JIPM_BOARD, PLC_UNIT_PC10G);
    const session = createSession(rackBoard, {
      roles: { S1: 'CR1', S7: 'CHK' },
      allowedColors: ['青'],
      extraParts: [],
      inventory: [],
    });
    const added = addWire(
      session,
      rackBoard,
      'TB_PB.1a' as TerminalId,
      'PLC.X0' as TerminalId,
      '青',
    );
    expect(added.ok).toBe(true);

    const disposeSpy = vi.spyOn(TubeGeometry.prototype, 'dispose');
    const { unmount } = render(<DeskWires board={rackBoard} session={session} />);
    expect(disposeSpy).not.toHaveBeenCalled();
    unmount();
    // 机上のケーブルがちょうど1本（＝`deskWires()` がラックの端子を FX5U と同じように引けている）
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });
});
