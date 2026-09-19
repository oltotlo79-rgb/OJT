import { terminalId } from '@ojt/circuit-sim';
import { BUILTIN_PLC_PROBLEMS, isPlcProblem } from '@ojt/content';
import { COIL_COL, no, out, X, Y } from '@ojt/ladder-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { applyLadderCell, initialLadder } from '../src/renderer/session/ladder.js';
import { plcBoardOf } from '../src/renderer/session/plc-session.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', problems: undefined });
});

describe('openProblem（モードD）', () => {
  it('opens a PLC problem with an empty ladder and the board that carries the PLC unit', () => {
    expect(isPlcProblem(problem)).toBe(true);
    expect(useStore.getState().openProblem(problem)).toBe(true);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.mode).toBe('wire');
    expect(state.wireColor).toBe('青');
    expect(state.session?.allowedColors).toEqual(['青']);
    expect(state.ladder?.networks.map((n) => n.id)).toEqual(['n1', 'end']);
    expect(state.ladderCursor).toEqual({ networkId: 'n1', row: 0, col: 0 });
    expect(state.ladderMode).toBe('write');
    expect(state.ladderView).toBe('split');
    expect(state.dialectId).toBe('mitsubishi');
    expect(state.converted).toBe(false);
    expect(state.plcRunning).toBe(false);
    expect(state.schematicVisible).toBe(false);
  });

  it('never seeds the trainee ladder from referenceLadder (決定表#14)', () => {
    useStore.getState().openProblem(problem);
    const ladder = useStore.getState().ladder;
    expect(ladder).toBeDefined();
    const cells = ladder!.networks.flatMap((net) => net.cells.flat());
    expect(cells.filter((c) => c.kind === 'contact')).toHaveLength(0);
    expect(cells.filter((c) => c.kind === 'coil')).toHaveLength(0);
  });

  it('derives the board with the PLC unit and the wall outlet', () => {
    useStore.getState().openProblem(problem);
    const board = plcBoardOf(useStore.getState().problem!);
    expect(board?.plcUnit?.model).toBe('FX5U');
    // `TerminalId` はブランド付きの文字列型なので、素の文字列とは直接比べない
    expect(board?.terminals.some((t) => t.id === terminalId('PLC', 'X0'))).toBe(true);
    expect(board?.terminals.some((t) => t.id === terminalId('OUTLET', 'L'))).toBe(true);
    expect(board?.id).toBe('board-jipm-std');
  });
});

describe('ラダーの編集と履歴', () => {
  beforeEach(() => {
    useStore.getState().openProblem(problem);
  });

  it('records the previous program and clears the converted flag', () => {
    const store = useStore.getState();
    store.setConverted(true, { errors: [], warnings: [], usage: undefined });
    const before = useStore.getState().ladder!;
    const edited = applyLadderCell(before, { networkId: 'n1', row: 0, col: 0 }, no(X(0)));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    store.setLadder(edited.program);
    const state = useStore.getState();
    expect(state.ladderHistory.done).toEqual([before]);
    expect(state.converted).toBe(false);
    expect(state.convertIssues.errors).toEqual([]);
  });

  it('undoes and redoes through the ladder stack only', () => {
    const store = useStore.getState();
    const before = useStore.getState().ladder!;
    const edited = applyLadderCell(before, { networkId: 'n1', row: 0, col: COIL_COL }, out(Y(0)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    expect(useStore.getState().undoLadderEdit()).toBe(true);
    expect(useStore.getState().ladder).toBe(before);
    // 盤の履歴は動かない
    expect(useStore.getState().history.done).toEqual([]);
    expect(useStore.getState().redoLadderEdit()).toBe(true);
    expect(useStore.getState().ladder).toBe(edited.program);
    expect(useStore.getState().redoLadderEdit()).toBe(false);
  });

  it('keeps device comments inside the caps (§10.7)', () => {
    const store = useStore.getState();
    store.setDeviceComment('X0', '運転押ボタン');
    expect(useStore.getState().ladderComments['X0']).toBe('運転押ボタン');
    store.setDeviceComment('X0', '');
    expect(useStore.getState().ladderComments['X0']).toBeUndefined();
    store.setDeviceComment('Y0', 'あ'.repeat(40));
    expect(useStore.getState().ladderComments['Y0']).toHaveLength(32);
  });
});

describe('モードDの状態を持ち越さない（Plan 2B Batch 1 B4 と同じ規則）', () => {
  it('drops the ladder when the session is abandoned', () => {
    useStore.getState().openProblem(problem);
    useStore.getState().setPlcRunning(true);
    useStore.getState().abandonSession();
    const state = useStore.getState();
    expect(state.ladder).toBeUndefined();
    expect(state.ladderHistory.done).toEqual([]);
    expect(state.plcMonitor).toBeUndefined();
    expect(state.plcRunning).toBe(false);
    expect(state.converted).toBe(false);
  });

  it('starts a retry from an empty ladder again', () => {
    useStore.getState().openProblem(problem);
    const seeded = applyLadderCell(
      useStore.getState().ladder!,
      { networkId: 'n1', row: 0, col: 0 },
      no(X(1)),
    );
    if (!seeded.ok) throw new Error(seeded.message);
    useStore.getState().setLadder(seeded.program);
    useStore.getState().resetSession();
    expect(useStore.getState().ladder).toEqual(initialLadder());
    expect(useStore.getState().ladderHistory.done).toEqual([]);
  });

  it('bumps the session epoch on a retry so the worker reloads', () => {
    useStore.getState().openProblem(problem);
    const epoch = useStore.getState().sessionEpoch;
    useStore.getState().resetSession();
    expect(useStore.getState().sessionEpoch).toBe(epoch + 1);
  });

  it('keeps the trainee ladder across restartSession (§13 #5。レビュー指摘 B3)', () => {
    useStore.getState().openProblem(problem);
    const seeded = applyLadderCell(
      useStore.getState().ladder!,
      { networkId: 'n1', row: 0, col: 0 },
      no(X(1)),
    );
    if (!seeded.ok) throw new Error(seeded.message);
    useStore.getState().setLadder(seeded.program);
    useStore.getState().setDeviceComment('X1', '運転押ボタン');
    useStore.setState({ converted: true, plcRunning: true, ladderMode: 'monitor' });
    useStore.getState().restartSession();
    const state = useStore.getState();
    // 組んだラダーとコメントは残る
    expect(state.ladder).toBe(seeded.program);
    expect(state.ladderComments['X1']).toBe('運転押ボタン');
    // Worker と同期している派生状態だけが落ちる
    expect(state.converted).toBe(false);
    expect(state.plcRunning).toBe(false);
    expect(state.plcMonitor).toBeUndefined();
    expect(state.ladderMode).toBe('write');
  });
});

describe('画面の分割とフォーカス（決定表#3 / #10）', () => {
  it('switches the split view', () => {
    useStore.getState().openProblem(problem);
    useStore.getState().setLadderView('board');
    expect(useStore.getState().ladderView).toBe('board');
  });

  it('remembers which pane has the keyboard', () => {
    useStore.getState().openProblem(problem);
    useStore.getState().setLadderFocused(true);
    expect(useStore.getState().ladderFocused).toBe(true);
    useStore.getState().setLadderFocused(false);
    expect(useStore.getState().ladderFocused).toBe(false);
  });
});
