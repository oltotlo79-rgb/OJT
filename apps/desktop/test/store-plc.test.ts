import { addWire, plcUnitFor, plug } from '@ojt/board-model';
import { terminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  isPlcProblem,
} from '@ojt/content';
import { COIL_COL, deviceKey, no, out, X, Y, type LadderProgram } from '@ojt/ladder-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_COMMENT_COUNT_LIMIT, useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { applyLadderCell } from '../src/renderer/session/ladder.js';
import { boardForProblem, plcBoardOf } from '../src/renderer/session/plc-session.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;
const assembleProblem = BUILTIN_ASSEMBLE_PROBLEMS[0]!;
const inspectPartsProblem = BUILTIN_INSPECT_PARTS_PROBLEMS[0]!;

beforeEach(() => {
  useStore.getState().abandonSession();
  // 既定メーカーは設定なので `abandonSession()` では戻らない。ケース間で漏らさないよう明示に戻す
  useStore.setState({
    route: 'home',
    problems: undefined,
    defaultVendor: 'mitsubishi',
    dialectId: 'mitsubishi',
  });
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

describe('既定メーカーの機種で開く（§7.6 / 決定表#9・#24）', () => {
  it('swaps the model of a mode D problem to the default vendor', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    expect(useStore.getState().openProblem(problem)).toBe(true);
    expect(useStore.getState().dialectId).toBe('omron');
    const opened = useStore.getState().problem;
    expect(opened?.mode).toBe('plc');
    expect(opened !== undefined && isPlcProblem(opened) ? opened.plc : undefined).toEqual({
      vendor: 'omron',
      model: 'CP1E',
    });
    // 盤も機種に追随する（3Dとワーカーが同じ端子名を見る。4A H-1）
    expect(boardForProblem(opened).terminals.map((t) => String(t.id))).toContain('PLC.0.00');
  });

  it('puts the TOYOPUC rack on the desk for the JTEKT default', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'jtekt' });
    useStore.getState().openProblem(problem);
    const board = boardForProblem(useStore.getState().problem);
    expect(board.plcUnit?.form).toBe('rack');
    expect(board.plcUnit?.modules?.map((m) => m.model)).toEqual([
      'POWER1',
      'PC10G-1SP',
      'IN-12',
      'OUT-12',
    ]);
    expect(board.terminals.map((t) => String(t.id))).toContain('PLC.ICOM0');
  });

  it('keeps the original model when the vendor cannot host the assignment (決定表#10)', () => {
    const wide = {
      ...problem,
      io: {
        ...problem.io,
        mode: 'fixed' as const,
        inputs: [{ x: 0, pb: 'PB1' as const }],
        outputs: [{ y: 12, cr: 'CR1' as const, pl: 'PL1' as const }],
      },
    };
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    expect(useStore.getState().openProblem(wide)).toBe(true);
    const opened = useStore.getState().problem;
    expect(opened !== undefined && isPlcProblem(opened) ? opened.plc.model : undefined).toBe(
      'FX5U',
    );
    expect(useStore.getState().toasts.at(-1)?.text).toContain('CP1E');
    /*
     * レビュー指摘 #9: 生のID(機種コード)ではなく本体の表示名を出す(`PlcSession.tsx` の
     * `plc-model` 表示と同じ流儀)。`plcUnitFor()` はここでも `PlcSession.tsx` と同じ関数。
     */
    expect(useStore.getState().toasts.at(-1)?.text).toContain(plcUnitFor('CP1E')!.displayName);
    expect(useStore.getState().toasts.at(-1)?.text).toContain(plcUnitFor('FX5U')!.displayName);
    // 方言も課題の機種に合わせる（ラダーの表記だけ OMRON になってしまわないように）
    expect(useStore.getState().dialectId).toBe('mitsubishi');
  });

  it('leaves the other modes alone', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'sharp' });
    useStore.getState().openProblem(assembleProblem);
    expect(useStore.getState().problem?.id).toBe(assembleProblem.id);
  });

  it('lets the caller pin a vendor (作業ファイルの復元。決定表#24)', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    useStore.getState().openProblem(problem, { vendor: 'jtekt' });
    expect(useStore.getState().dialectId).toBe('jtekt');
    const opened = useStore.getState().problem;
    expect(opened !== undefined && isPlcProblem(opened) ? opened.plc.model : undefined).toBe(
      'PC10G-1SP',
    );
    // 設定（既定メーカー）は動かない
    expect(useStore.getState().defaultVendor).toBe('omron');
  });

  it('keeps the session dialect through 「もう一度」 (MERGE 注意 #5 / 決定表#24)', () => {
    // 既定メーカーは三菱のまま、セッションだけ JTEKT にしてある状態
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'mitsubishi' });
    useStore.getState().openProblem(problem, { vendor: 'jtekt' });
    expect(useStore.getState().dialectId).toBe('jtekt');
    useStore.getState().resetSession();
    // やり直しても既定メーカー（三菱）へ戻らない
    expect(useStore.getState().dialectId).toBe('jtekt');
    const again = useStore.getState().problem;
    expect(again !== undefined && isPlcProblem(again) ? again.plc.model : undefined).toBe(
      'PC10G-1SP',
    );
  });

  /**
   * レビュー指摘 #11: 既定メーカーはあくまで「次に開くときの既定」であって、いま開いている
   * 課題を動かすものではない（決定表#24）。`applyLadderSettings()` は設定画面が保存のたびに
   * 呼ぶので、開いたままの課題の `plc`（機種）まで書き換えてしまうと3Dの端子名とラダーの
   * デバイス名が食い違う。
   */
  it('does not touch the already-open problem when the default vendor changes mid-session (決定表#24)', () => {
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'mitsubishi' });
    useStore.getState().openProblem(problem);
    const before = useStore.getState().problem;
    const plcBefore = before !== undefined && isPlcProblem(before) ? before.plc : undefined;
    expect(plcBefore).toEqual({ vendor: 'mitsubishi', model: 'FX5U' });

    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });

    const after = useStore.getState().problem;
    const plcAfter = after !== undefined && isPlcProblem(after) ? after.plc : undefined;
    expect(plcAfter).toEqual(plcBefore);
    expect(useStore.getState().dialectId).toBe('mitsubishi');
    expect(useStore.getState().defaultVendor).toBe('omron');
  });
});

// --- Plan 4B Task 8 ---
describe('switchDialect（表記切替。§10.7 / 決定表#11・#12）', () => {
  /** 接点1つと出力1つ（出力はコイル列に置く）。 */
  function editedLadder(): LadderProgram {
    const base = useStore.getState().ladder!;
    const contact = applyLadderCell(base, { networkId: 'n1', row: 0, col: 0 }, no(X(0)));
    if (!contact.ok) throw new Error(contact.message);
    const coil = applyLadderCell(
      contact.program,
      { networkId: 'n1', row: 0, col: COIL_COL },
      out(Y(0)),
    );
    if (!coil.ok) throw new Error(coil.message);
    return coil.program;
  }

  it('swaps the dialect and the model but keeps the ladder, the comments and the undo stack', () => {
    useStore.getState().openProblem(problem);
    const ladder = editedLadder();
    useStore.getState().setLadder(ladder);
    useStore.getState().setDeviceComment(deviceKey(X(0)), '起動');
    const boardBefore = useStore.getState().session;

    useStore.getState().switchDialect('omron');

    const state = useStore.getState();
    expect(state.dialectId).toBe('omron');
    const opened = state.problem;
    expect(opened !== undefined && isPlcProblem(opened) ? opened.plc : undefined).toEqual({
      vendor: 'omron',
      model: 'CP1E',
    });
    // IRは書き換えない（4A H-2）。コメントも持ち越す（決定表#12）
    expect(state.ladder).toEqual(ladder);
    expect(Object.values(state.ladderComments)).toContain('起動');
    expect(state.converted).toBe(false);
    // 盤は作り直す（端子名が変わるので配線は残せない）
    expect(state.session).not.toBe(boardBefore);
    // 取り消しスタックはそのまま（決定表#11）
    expect(useStore.getState().undoLadderEdit()).toBe(true);
  });

  it('keeps the dialect and the model when the I/O does not fit the maker’s unit (決定表#10)', () => {
    useStore.getState().openProblem(problem);
    // CP1E は出力12点なので `y: 12` の割付は収まらない（4A 前提#23）
    useStore.setState({
      problem: { ...problem, io: { ...problem.io, outputs: [{ y: 12, cr: 'CR1', pl: 'PL1' }] } },
    });

    useStore.getState().switchDialect('omron');

    const state = useStore.getState();
    expect(state.dialectId).toBe('mitsubishi');
    const opened = state.problem;
    expect(opened !== undefined && isPlcProblem(opened) ? opened.plc.model : undefined).toBe(
      'FX5U',
    );
    expect(state.toasts.at(-1)?.tone).toBe('error');
  });

  it('only swaps the dialect when no PLC problem is open', () => {
    useStore.getState().abandonSession();
    useStore.getState().switchDialect('sharp');
    expect(useStore.getState().dialectId).toBe('sharp');
    expect(useStore.getState().problem).toBeUndefined();
  });

  /*
   * レビュー指摘 DS-1: `openProblem()` は `problem.id` が変わらないので `sessionEpoch` を
   * 進めない。`Session` は Worker を `[problemId, sessionEpoch]` で張り直すので、進めないと
   * 表記切替後も Worker が旧機種のネットリストのままになる。
   */
  it('bumps the session epoch on a dialect switch so the worker reloads, without changing the problem id', () => {
    useStore.getState().openProblem(problem);
    const before = useStore.getState();
    const epoch = before.sessionEpoch;
    const problemId = before.problem?.id;

    useStore.getState().switchDialect('omron');

    const after = useStore.getState();
    expect(after.sessionEpoch).toBe(epoch + 1);
    expect(after.problem?.id).toBe(problemId);
  });

  it('keeps the wiring inside the board and the mounted parts, and drops only the PLC wires (2026-09-26)', () => {
    useStore.getState().openProblem(problem);
    const board = boardForProblem(problem);
    const session = useStore.getState().session!;
    const mounted = plug(session, 'S1', 'relay-my4n');
    expect(mounted.ok).toBe(true);
    // 盤の中の2本と、PLC本体・コンセントへの2本
    for (const [from, to] of [
      ['P.1', 'CR1.9'],
      ['N.1', 'CR1.13'],
      ['TB_PB.1a', 'PLC.X0'],
      ['OUTLET.L', 'PLC.L'],
    ] as const) {
      expect(addWire(session, board, terminalId(...split(from)), terminalId(...split(to))).ok).toBe(
        true,
      );
    }
    useStore.getState().setSession(session);

    useStore.getState().switchDialect('omron');

    const after = useStore.getState().session!;
    const ends = after.wires.filter((w) => !w.locked).map((w) => `${w.from}-${w.to}`);
    expect(ends).toEqual(['P.1-CR1.9', 'N.1-CR1.13']);
    expect(after.mounted.S1?.kind).toBe('relay-my4n');
    // 結果の知らせに、残した本数と張り直す本数が出る
    expect(useStore.getState().toasts.at(-1)?.text).toContain('盤内の配線2本と部品1個');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('2本を張り直してください');
  });
});
// --- /Plan 4B Task 8 ---

/** `P.1` → `['P', '1']`（`terminalId()` へ渡す形）。 */
function split(id: string): [string, string] {
  const dot = id.indexOf('.');
  return [id.slice(0, dot), id.slice(dot + 1)];
}
