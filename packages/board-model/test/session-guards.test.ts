import { describe, expect, it } from 'vitest';
import { createWire, validateNetlist, type TerminalId } from '@ojt/circuit-sim';
import {
  addWire,
  createSession,
  JIPM_BOARD,
  netlistIssues,
  plug,
  removeWire,
  SessionError,
  setPreset,
  TASK1_SOCKET_ROLES,
  TASK2_SOCKET_ROLES,
  toNetlist,
  wireCountAtTerminal,
  type BoardDefinition,
  type BoardSession,
} from '../src/index.js';

const board = JIPM_BOARD;

function t(id: string): TerminalId {
  return id as TerminalId;
}

function session(): BoardSession {
  return createSession(board);
}

function code(result: ReturnType<typeof addWire>): string {
  if (result.ok) throw new Error('失敗するはずの操作が成功しました');
  return result.code;
}

describe('session guards: 端子IDの正規化', () => {
  it('物理ソケットIDの端子は役割ベースの端子IDに正規化して数える（S1.13 = CR1.13）', () => {
    const s = session();
    const first = addWire(s, board, t('S1.13'), t('TB_PL.1+'));
    if (!first.ok) throw new Error(first.message);
    expect(first.value.from).toBe('CR1.13');
    expect(first.value.to).toBe('TB_PL.1+');
    expect(addWire(s, board, t('S1.13'), t('TB_PL.2+')).ok).toBe(true);
    expect(wireCountAtTerminal(s, t('CR1.13'))).toBe(2);
    expect(code(addWire(s, board, t('CR1.13'), t('TB_PL.3+')))).toBe('terminal-overload');
    expect(s.wires.every((w) => !w.from.startsWith('S1.') && !w.to.startsWith('S1.'))).toBe(true);
  });

  it('正規化した電線はネットリストの端子集合に載る（unknown-terminal を出さない）', () => {
    const s = session();
    expect(addWire(s, board, t('S1.13'), t('TB_PL.1+')).ok).toBe(true);
    expect(addWire(s, board, t('S8.14'), t('TB_PL.2+')).ok).toBe(true);
    expect(validateNetlist(toNetlist(s, board))).toEqual([]);
  });

  it('同一端子の判定も正規化後に行う（S1.13 と CR1.13）', () => {
    const s = session();
    expect(code(addWire(s, board, t('S1.13'), t('CR1.13')))).toBe('same-terminal');
  });
});

describe('session guards: 端子チェックは投げない', () => {
  it('端子IDの形式が壊れていても unknown-terminal で返す', () => {
    const s = session();
    expect(code(addWire(s, board, t('nope'), t('P.1')))).toBe('unknown-terminal');
    expect(code(addWire(s, board, t('P.1'), t('CR1.09')))).toBe('unknown-terminal');
  });

  it('割り当てられていない役割の端子は unknown-terminal で返す', () => {
    const s = createSession(board, { roles: TASK1_SOCKET_ROLES });
    expect(code(addWire(s, board, t('T1.14'), t('P.1')))).toBe('unknown-terminal');
  });
});

describe('session guards: 電線IDの採番', () => {
  it('既存の電線IDより古い wireSeq でも衝突しないIDを採る', () => {
    const s = session();
    s.wires.push(createWire('w-004', t('TB_PL.1+'), t('TB_PL.2+')));
    s.wires.push(createWire('w-005', t('TB_PL.3+'), t('TB_PL.4+')));
    s.wireSeq = 1;
    const added = addWire(s, board, t('TB_PB.1c'), t('TB_PB.2c'));
    if (!added.ok) throw new Error(added.message);
    expect(added.value.id).toBe('w-006');
    expect(s.wireSeq).toBe(7);
  });

  it('明示IDで張り直せる（undo/redo 復元）。重複IDは拒否する', () => {
    const s = session();
    const added = addWire(s, board, t('TB_PB.1c'), t('TB_PB.2c'));
    if (!added.ok) throw new Error(added.message);
    const removed = removeWire(s, added.value.id);
    expect(removed.ok).toBe(true);
    const restored = addWire(s, board, t('TB_PB.1c'), t('TB_PB.2c'), '青', {
      id: added.value.id,
    });
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.value.id).toBe(added.value.id);
    const dup = addWire(s, board, t('TB_PB.3c'), t('TB_PB.4a'), '青', { id: added.value.id });
    expect(code(dup)).toBe('duplicate-wire-id');
  });
});

describe('session guards: 本数超過の電線を呼び出し側に渡す', () => {
  it('terminal-overload には張ろうとした電線が付く。IDは消費しない', () => {
    const s = session();
    expect(addWire(s, board, t('S1.13'), t('TB_PL.1+')).ok).toBe(true);
    expect(addWire(s, board, t('S1.13'), t('TB_PL.2+')).ok).toBe(true);
    const seqBefore = s.wireSeq;
    const over = addWire(s, board, t('CR1.13'), t('TB_PL.3+'));
    if (over.ok) throw new Error('unreachable');
    expect(over.code).toBe('terminal-overload');
    expect(over.wire?.from).toBe('CR1.13');
    expect(over.wire?.to).toBe('TB_PL.3+');
    expect(over.wire?.id).toBe('w-003');
    expect(over.wire?.locked).toBe(false);
    // 拒否された電線のIDは予約しない（次に成功する電線が同じIDを使う）
    expect(s.wireSeq).toBe(seqBefore);
    const next = addWire(s, board, t('TB_PL.3+'), t('TB_PL.4+'));
    if (!next.ok) throw new Error(next.message);
    expect(next.value.id).toBe('w-003');
  });

  it('本数超過以外の失敗には電線を付けない', () => {
    const s = session();
    const unknown = addWire(s, board, t('P.1'), t('ZZ.1'));
    if (unknown.ok) throw new Error('unreachable');
    expect(unknown.wire).toBeUndefined();
  });
});

describe('session guards: タイマレンジと盤の整合', () => {
  it('カタログに無いレンジは invalid-preset（黙って既定レンジに落とさない）', () => {
    const s = createSession(board, { roles: TASK2_SOCKET_ROLES });
    const bad = plug(s, 'S5', 'timer-h3y4', { rangeMaxMs: 30_000 });
    if (bad.ok) throw new Error('unreachable');
    expect(bad.code).toBe('invalid-preset');
    expect(s.mounted.S5).toBeUndefined();

    expect(plug(s, 'S5', 'timer-h3y4').ok).toBe(true);
    s.mounted.S5 = { kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 30_000 };
    const preset = setPreset(s, 'S5', 1000);
    if (preset.ok) throw new Error('unreachable');
    expect(preset.code).toBe('invalid-preset');
  });

  it('違う盤を渡したら board-mismatch／SessionError', () => {
    const s = session();
    const other: BoardDefinition = { ...board, id: 'board-other' };
    expect(code(addWire(s, other, t('P.1'), t('TB_PB.1c')))).toBe('board-mismatch');
    expect(() => toNetlist(s, other)).toThrow(SessionError);
  });
});

describe('session guards: ネットリストの検査', () => {
  it('既定のセッションは問題なし。違う盤は問題として返す（投げない）', () => {
    const s = session();
    expect(netlistIssues(s, board)).toEqual([]);
    const other: BoardDefinition = { ...board, id: 'board-other' };
    expect(netlistIssues(s, other)).toHaveLength(1);
    expect(netlistIssues(s, other)[0]?.kind).toBe('unknown-terminal');
  });

  it('断線（open）はネットリストに引き継がれる（§5.4）', () => {
    const s = session();
    const added = addWire(s, board, t('TB_PB.1c'), t('TB_PB.2c'));
    if (!added.ok) throw new Error(added.message);
    added.value.open = true;
    const netlist = toNetlist(s, board);
    const copied = netlist.wires.find((w) => w.id === added.value.id);
    expect(copied?.open).toBe(true);
    expect(copied?.locked).toBe(false);
    expect(copied?.color).toBe('青');
    // 防御的コピー: ネットリスト側を触ってもセッションは変わらない
    if (copied !== undefined) copied.open = false;
    expect(added.value.open).toBe(true);
  });
});
