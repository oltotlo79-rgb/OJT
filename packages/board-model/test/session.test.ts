import { describe, expect, it } from 'vitest';
import type { PartId, TerminalId, Wire } from '@ojt/circuit-sim';
import {
  addWire,
  createSession,
  JIPM_BOARD,
  mountedKinds,
  plug,
  removeWire,
  SessionError,
  setPreset,
  TASK2_SOCKET_ROLES,
  unplug,
  wireCountAtTerminal,
  wiresAt,
  type BoardSession,
  type SocketId,
  type SocketRoles,
} from '../src/index.js';

const BZ_ID = 'BZ' as PartId;

const board = JIPM_BOARD;

function t(id: string): TerminalId {
  return id as TerminalId;
}

function session(): BoardSession {
  return createSession(board);
}

function added(result: ReturnType<typeof addWire>): Wire {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe('session: 装着と配線', () => {
  it('生成時にチェック用ソケットの既設固定配線3本（青・locked）を持つ（§6.3）', () => {
    const s = session();
    expect(s.wires).toHaveLength(3);
    expect(s.wires.every((w) => w.locked && w.color === '青')).toBe(true);
    expect(s.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.1-TB_PB.4c',
      'TB_PB.4a-CHK.14',
      'CHK.13-N.1',
    ]);
    expect(s.allowedColors).toEqual(['青']);
    expect(s.boardId).toBe('board-jipm-std');
  });

  it('役割割当が不正ならセッションを作れない', () => {
    const broken: SocketRoles = { S1: 'CR1', S2: 'CR1', S7: 'CHK' };
    expect(() => createSession(board, { roles: broken })).toThrow(SessionError);
  });

  it('電線を張る／外す（§8.2）', () => {
    const s = session();
    const wire = added(addWire(s, board, t('P.1'), t('TB_PB.1c')));
    expect(wire.id).toBe('w-001');
    expect(wire.color).toBe('青');
    expect(wire.locked).toBe(false);
    // P.1 はチェック用の既設配線で1本使われているので、訓練者の1本と合わせて2本
    expect(wiresAt(s, t('P.1'))).toHaveLength(2);
    const removed = removeWire(s, 'w-001');
    expect(removed.ok).toBe(true);
    expect(s.wires).toHaveLength(3);
    const missing = removeWire(s, 'w-001');
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('unreachable');
    expect(missing.code).toBe('unknown-wire');
  });

  it('固定配線は削除できない（§6.3）', () => {
    const s = session();
    const result = removeWire(s, 'fw-chk-1');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('locked-wire');
    expect(result.message).toBe('チェック用回路の黄色配線は変更できません');
  });

  it('1端子2本まで。既設配線が1本ある端子には1本しか足せない（§6.3 / §6.6）', () => {
    const s = session();
    expect(wireCountAtTerminal(s, t('TB_PB.4c'))).toBe(1);
    expect(addWire(s, board, t('TB_PB.4c'), t('TB_PB.3c')).ok).toBe(true);
    const third = addWire(s, board, t('TB_PB.4c'), t('TB_PB.2c'));
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('unreachable');
    expect(third.code).toBe('terminal-overload');

    const free = session();
    expect(addWire(free, board, t('TB_PL.1+'), t('TB_PL.2+')).ok).toBe(true);
    expect(addWire(free, board, t('TB_PL.1+'), t('TB_PL.3+')).ok).toBe(true);
    const over = addWire(free, board, t('TB_PL.1+'), t('TB_PL.4+'));
    expect(over.ok).toBe(false);
    if (over.ok) throw new Error('unreachable');
    expect(over.code).toBe('terminal-overload');
  });

  it('パレット外の色・同一端子・配線不可端子・未知端子を拒否する（§6.4 / §8.1）', () => {
    const s = session();
    const color = addWire(s, board, t('P.1'), t('TB_PB.1c'), '白');
    expect(color.ok).toBe(false);
    if (color.ok) throw new Error('unreachable');
    expect(color.code).toBe('color-not-allowed');

    const same = addWire(s, board, t('P.1'), t('P.1'));
    if (same.ok) throw new Error('unreachable');
    expect(same.code).toBe('same-terminal');

    const body = addWire(s, board, t('PB1.c'), t('P.1'));
    if (body.ok) throw new Error('unreachable');
    expect(body.code).toBe('terminal-not-wirable');

    const unknown = addWire(s, board, t('P.1'), t('ZZ.1'));
    if (unknown.ok) throw new Error('unreachable');
    expect(unknown.code).toBe('unknown-terminal');

    const buzzer = addWire(s, board, t('BZ.+'), t('P.1'));
    if (buzzer.ok) throw new Error('unreachable');
    expect(buzzer.code).toBe('terminal-unavailable');

    const withBz = createSession(board, { extraParts: [BZ_ID] });
    expect(addWire(withBz, board, t('BZ.+'), t('P.1')).ok).toBe(true);
  });

  it('白線モード（C2）では青を拒否する（§8.1）', () => {
    const s = createSession(board, { allowedColors: ['白'] });
    const white = added(addWire(s, board, t('TB_PB.2b'), t('TB_PB.1c')));
    expect(white.color).toBe('白');
    const blue = addWire(s, board, t('TB_PB.2c'), t('TB_PB.1b'), '青');
    if (blue.ok) throw new Error('unreachable');
    expect(blue.code).toBe('color-not-allowed');
  });

  it('装着・取り外し・在庫（§8.2 / §7.1）', () => {
    const s = createSession(board, { roles: TASK2_SOCKET_ROLES });
    expect(plug(s, 'S1', 'relay-my4n').ok).toBe(true);
    expect(mountedKinds(s)).toEqual(['relay-my4n']);
    const twice = plug(s, 'S1', 'relay-my4n');
    if (twice.ok) throw new Error('unreachable');
    expect(twice.code).toBe('socket-occupied');

    const unknown = plug(s, 'S9' as SocketId, 'relay-my4n');
    if (unknown.ok) throw new Error('unreachable');
    expect(unknown.code).toBe('unknown-socket');

    expect(plug(s, 'S5', 'timer-h3y4', { presetMs: 3000 }).ok).toBe(true);
    expect(plug(s, 'S6', 'timer-h3y4', { presetMs: 500, rangeMaxMs: 60_000 }).ok).toBe(true);
    const noStock = plug(s, 'S8', 'timer-h3y4');
    if (noStock.ok) throw new Error('unreachable');
    expect(noStock.code).toBe('inventory-exhausted');

    expect(s.mounted.S6).toEqual({ kind: 'timer-h3y4', presetMs: 500, rangeMaxMs: 60_000 });
    const removed = unplug(s, 'S1');
    expect(removed.ok).toBe(true);
    const again = unplug(s, 'S1');
    if (again.ok) throw new Error('unreachable');
    expect(again.code).toBe('socket-empty');
  });

  it('役割なしの予備ソケット（S8）にも部品を装着でき、端子に配線できる', () => {
    const s = session();
    expect(plug(s, 'S8', 'relay-my4n').ok).toBe(true);
    expect(s.mounted.S8).toEqual({ kind: 'relay-my4n' });
    expect(addWire(s, board, t('S8.14'), t('P.1')).ok).toBe(true);
  });

  it('タイマ設定はレンジの分解能に丸める（§5.3.2 / §8.2）', () => {
    const s = createSession(board, { roles: TASK2_SOCKET_ROLES });
    expect(plug(s, 'S5', 'timer-h3y4').ok).toBe(true);
    expect(s.mounted.S5).toEqual({ kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 });
    const updated = setPreset(s, 'S5', 5040);
    if (!updated.ok) throw new Error(updated.message);
    expect(updated.value).toEqual({ kind: 'timer-h3y4', presetMs: 5000, rangeMaxMs: 10_000 });
    const clamped = setPreset(s, 'S5', 99_999);
    if (!clamped.ok) throw new Error(clamped.message);
    expect(clamped.value.kind === 'timer-h3y4' ? clamped.value.presetMs : 0).toBe(10_000);

    expect(plug(s, 'S1', 'relay-my4n').ok).toBe(true);
    const notTimer = setPreset(s, 'S1', 1000);
    if (notTimer.ok) throw new Error('unreachable');
    expect(notTimer.code).toBe('not-a-timer');
    const empty = setPreset(s, 'S2', 1000);
    if (empty.ok) throw new Error('unreachable');
    expect(empty.code).toBe('socket-empty');
  });
});
