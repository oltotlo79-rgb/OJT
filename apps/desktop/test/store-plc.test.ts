import { terminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  isPlcProblem,
} from '@ojt/content';
import { COIL_COL, no, out, X, Y } from '@ojt/ladder-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_COMMENT_COUNT_LIMIT, useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { applyLadderCell } from '../src/renderer/session/ladder.js';
import { plcBoardOf } from '../src/renderer/session/plc-session.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;
const assembleProblem = BUILTIN_ASSEMBLE_PROBLEMS[0]!;
const inspectPartsProblem = BUILTIN_INSPECT_PARTS_PROBLEMS[0]!;

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

  it('never leaves a PLC session view carried over into the next problem (UXレビュー #2)', () => {
    useStore.getState().openProblem(problem);
    expect(useStore.getState().camera).toBe('plc');
    useStore.getState().openProblem(assembleProblem);
    expect(useStore.getState().camera).toBe('front');
  });

  it('leaves the mode D fields at their defaults for a mode B problem (no leakage into Phase 2)', () => {
    expect(useStore.getState().openProblem(assembleProblem)).toBe(true);
    const state = useStore.getState();
    expect(state.ladder).toBeUndefined();
    expect(state.ladderComments).toEqual({});
    expect(state.ladderHistory).toEqual({ done: [], undone: [] });
    expect(state.ladderMode).toBe('write');
    expect(state.ladderView).toBe('split');
    expect(state.insertMode).toBe('overwrite');
    expect(state.monitorWriteNoticeShown).toBe(false);
    expect(state.converted).toBe(false);
    expect(state.plcMonitor).toBeUndefined();
    expect(state.plcRunning).toBe(false);
  });

  it('leaves the mode D fields at their defaults for a C1 problem (no leakage into Phase 2)', () => {
    expect(useStore.getState().openProblem(inspectPartsProblem)).toBe(true);
    const state = useStore.getState();
    expect(state.ladder).toBeUndefined();
    expect(state.ladderComments).toEqual({});
    expect(state.ladderHistory).toEqual({ done: [], undone: [] });
    expect(state.ladderMode).toBe('write');
    expect(state.ladderView).toBe('split');
    expect(state.insertMode).toBe('overwrite');
    expect(state.monitorWriteNoticeShown).toBe(false);
    expect(state.converted).toBe(false);
    expect(state.plcMonitor).toBeUndefined();
    expect(state.plcRunning).toBe(false);
  });
});

describe('ラダーの編集と履歴', () => {
  beforeEach(() => {
    useStore.getState().openProblem(problem);
  });

  it('records the previous program and clears the converted flag', () => {
    const store = useStore.getState();
    store.setConverted(true, { errors: [], warnings: [], usage: undefined, unused: undefined });
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
    expect(store.setDeviceComment('X0', '運転押ボタン')).toBe(true);
    expect(useStore.getState().ladderComments['X0']).toBe('運転押ボタン');
    expect(store.setDeviceComment('X0', '')).toBe(true);
    expect(useStore.getState().ladderComments['X0']).toBeUndefined();
    expect(store.setDeviceComment('Y0', 'あ'.repeat(40))).toBe(true);
    expect(useStore.getState().ladderComments['Y0']).toHaveLength(32);
  });

  it('keeps spaces typed in the middle of a comment verbatim (Batch 3 レビュー I2)', () => {
    const store = useStore.getState();
    expect(store.setDeviceComment('X1', '運転 押ボタン')).toBe(true);
    expect(useStore.getState().ladderComments['X1']).toBe('運転 押ボタン');
    // 空白だけの入力は削除として扱う（従来どおり）
    expect(store.setDeviceComment('X1', '   ')).toBe(true);
    expect(useStore.getState().ladderComments['X1']).toBeUndefined();
  });

  it('returns false and drops a new comment beyond DEVICE_COMMENT_COUNT_LIMIT (レビュー指摘 M4)', () => {
    const store = useStore.getState();
    for (let i = 0; i < DEVICE_COMMENT_COUNT_LIMIT; i += 1) {
      expect(store.setDeviceComment(`X${i}`, `コメント${i}`)).toBe(true);
    }
    expect(Object.keys(useStore.getState().ladderComments)).toHaveLength(
      DEVICE_COMMENT_COUNT_LIMIT,
    );
    // 上限に達した後でも、既存のデバイスへの上書きはできる
    expect(store.setDeviceComment('X0', '上書き')).toBe(true);
    expect(useStore.getState().ladderComments['X0']).toBe('上書き');
    // 新規デバイスは弾かれる
    expect(store.setDeviceComment('Y100', '入らない')).toBe(false);
    expect(useStore.getState().ladderComments['Y100']).toBeUndefined();
  });

  it('toggles insert/overwrite and returns the new value (決定表#12b)', () => {
    const store = useStore.getState();
    expect(useStore.getState().insertMode).toBe('overwrite');
    expect(store.toggleInsert()).toBe('insert');
    expect(useStore.getState().insertMode).toBe('insert');
    expect(store.toggleInsert()).toBe('overwrite');
    expect(useStore.getState().insertMode).toBe('overwrite');
  });

  it('shows the Shift+F3 monitor-write notice only once (決定表#11)', () => {
    const store = useStore.getState();
    expect(useStore.getState().monitorWriteNoticeShown).toBe(false);
    expect(store.markMonitorWriteNotice()).toBe(true);
    expect(useStore.getState().monitorWriteNoticeShown).toBe(true);
    expect(store.markMonitorWriteNotice()).toBe(false);
  });

  it('restores a ladder and its comments, clearing the ladder history', () => {
    const store = useStore.getState();
    const before = useStore.getState().ladder!;
    const edited = applyLadderCell(before, { networkId: 'n1', row: 0, col: 0 }, no(X(0)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    expect(useStore.getState().ladderHistory.done).toEqual([before]);
    const restored = applyLadderCell(
      edited.program,
      { networkId: 'n1', row: 0, col: COIL_COL },
      out(Y(0)),
    );
    if (!restored.ok) throw new Error(restored.message);
    store.restoreLadder(restored.program, { X0: '運転押ボタン' });
    const state = useStore.getState();
    expect(state.ladder).toBe(restored.program);
    expect(state.ladderHistory).toEqual({ done: [], undone: [] });
    expect(state.converted).toBe(false);
    expect(state.ladderComments['X0']).toBe('運転押ボタン');
  });

  it('sets and clears the PLC monitor snapshot', () => {
    const store = useStore.getState();
    expect(useStore.getState().plcMonitor).toBeUndefined();
    const snapshot: PlcMonitorSnapshot = {
      scanCount: 1,
      tMs: 10,
      powered: {},
      inputs: [true, false],
      outputs: [false],
      internals: {},
      timers: {},
      counters: {},
    };
    store.setPlcMonitor(snapshot);
    expect(useStore.getState().plcMonitor).toBe(snapshot);
    store.setPlcMonitor(undefined);
    expect(useStore.getState().plcMonitor).toBeUndefined();
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

  /*
   * Batch 4+5 レビュー I4: 結果画面の「もう一度」（`resetSession()`）はラダーを残す
   * （盤・履歴・危険操作だけ作り直す）。前は `openProblem()` が毎回 `plcFields()` で
   * ラダーも空に戻していたが、訓練者の入力を失うため変更した。
   */
  it('keeps the trainee ladder and comments on a retry, but drops the ladder history and converted flag', () => {
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
    useStore.getState().resetSession();
    const state = useStore.getState();
    expect(state.ladder).toEqual(seeded.program);
    expect(state.ladderComments['X1']).toBe('運転押ボタン');
    // 変換済みフラグ・履歴・モニタ関連は作り直す（また変換を通させる。§10.6 H-1）
    expect(state.converted).toBe(false);
    expect(state.ladderHistory.done).toEqual([]);
    expect(state.plcRunning).toBe(false);
  });

  it('drops the ladder on abandon, even right after a retry (I4 と B4 の切り分け)', () => {
    useStore.getState().openProblem(problem);
    const seeded = applyLadderCell(
      useStore.getState().ladder!,
      { networkId: 'n1', row: 0, col: 0 },
      no(X(1)),
    );
    if (!seeded.ok) throw new Error(seeded.message);
    useStore.getState().setLadder(seeded.program);
    useStore.getState().resetSession();
    useStore.getState().abandonSession();
    expect(useStore.getState().ladder).toBeUndefined();
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
