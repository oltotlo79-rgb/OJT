import { createSession, JIPM_BOARD, TASK2_SOCKET_ROLES } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyHistory, HISTORY_LIMIT } from '../src/renderer/session/commands.js';
import { droppedTicksLog } from '../src/renderer/i18n/ja.js';
import {
  EMPTY_SNAPSHOT,
  sessionForProblem,
  TOAST_LIMIT,
  TOAST_TTL_MS,
  useStore,
} from '../src/renderer/app/store.js';

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-003');

beforeEach(() => {
  useStore.setState({
    route: 'home',
    problem: undefined,
    session: undefined,
    history: emptyHistory(),
    sessionEpoch: 0,
    chartSpecs: [],
    liveTransitions: {},
    hazards: [],
    chatters: [],
    logLines: [],
    toasts: [],
    snapshot: EMPTY_SNAPSHOT,
    judge: undefined,
    fatalError: undefined,
    webglLost: false,
    reportedDroppedTicks: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sessionForProblem', () => {
  it('課題のソケット役割と在庫でセッションを作り、線色は青だけになる（§8.1）', () => {
    expect(PROBLEM).toBeDefined();
    if (PROBLEM === undefined) return;
    const session = sessionForProblem(PROBLEM);
    expect(session.allowedColors).toEqual(['青']);
    expect(session.socketRoles).toEqual(PROBLEM.board.socketRoles);
    expect(session.wires.every((w) => w.locked)).toBe(true);
  });
});

describe('openProblem', () => {
  it('セッション画面に移り、チャート信号を課題から決める（§7.7）', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.chartSpecs.map((s) => s.name)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
    expect(state.elapsedMs).toBe(0);
  });
});

describe('applySnapshot', () => {
  it('ログ差分からライブチャートの遷移点を積む（§8.2）', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    useStore.getState().applySnapshot({
      ...EMPTY_SNAPSHOT,
      tMs: 100,
      logDelta: [
        { tMs: 100, signal: 'PL1', value: true },
        { tMs: 100, signal: 'CR1.coilV', value: 24 },
        { tMs: 100, signal: 'NOT_IN_CHART', value: true },
      ],
    });
    const live = useStore.getState().liveTransitions;
    expect(live['PL1']).toEqual([{ tMs: 100, value: true }]);
    expect(live['CR1.coilV']).toBeUndefined();
    expect(live['NOT_IN_CHART']).toBeUndefined();
  });

  it('危険操作の差分を積み上げる（§5.6）', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    useStore.getState().applySnapshot({
      ...EMPTY_SNAPSHOT,
      hazardDelta: [
        { type: 'hazard', kind: 'power-sequence-violation', tMs: 0, detail: 'switch:on' },
      ],
    });
    expect(useStore.getState().hazards).toHaveLength(1);
  });
});

describe('clearLive', () => {
  it('元に戻す／やり直しでライブ記録を捨てる', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    useStore.getState().applySnapshot({
      ...EMPTY_SNAPSHOT,
      logDelta: [{ tMs: 10, signal: 'PL1', value: true }],
    });
    useStore.getState().clearLive();
    expect(useStore.getState().liveTransitions).toEqual({});
    expect(useStore.getState().snapshot.tMs).toBe(0);
  });
});

describe('toast / log', () => {
  it('トーストを積んで消せる', () => {
    useStore.getState().toast('1端子に接続できるのは2本までです', 'error');
    const toast = useStore.getState().toasts[0];
    expect(toast?.tone).toBe('error');
    useStore.getState().dismissToast(toast?.id ?? 0);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('操作ログは200行で頭を捨てる', () => {
    for (let i = 0; i < 210; i += 1) useStore.getState().addLog(`行 ${i}`);
    const lines = useStore.getState().logLines;
    expect(lines).toHaveLength(200);
    expect(lines[0]?.text).toBe('行 10');
  });

  it('3秒おきに6件出しても、どれも期限どおりに消える（§8.2）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    for (let i = 0; i < 6; i += 1) {
      useStore.getState().toast(`失敗 ${i}`, 'error');
      vi.advanceTimersByTime(3000);
    }
    // 1件目の期限（4秒）はとうに過ぎている。掃除すれば直近のものだけが残る
    useStore.getState().expireToasts();
    expect(useStore.getState().toasts.map((t) => t.text)).toEqual(['失敗 5']);

    vi.setSystemTime(22_000);
    useStore.getState().expireToasts();
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('一度に10件出しても新しい5件だけ残る（§8.2）', () => {
    for (let i = 0; i < 10; i += 1) useStore.getState().toast(`失敗 ${i}`, 'error');
    const toasts = useStore.getState().toasts;
    expect(toasts).toHaveLength(TOAST_LIMIT);
    expect(toasts[0]?.text).toBe('失敗 5');
    expect(toasts.at(-1)?.text).toBe('失敗 9');
  });

  it('期限は1件ごとに持つ（後から積んでも前の期限は延びない）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    useStore.getState().toast('先の1件');
    vi.setSystemTime(3000);
    useStore.getState().toast('後の1件');
    const [first, second] = useStore.getState().toasts;
    expect(first?.expiresAt).toBe(1000 + TOAST_TTL_MS);
    expect(second?.expiresAt).toBe(3000 + TOAST_TTL_MS);
  });
});

describe('noteDroppedTicks', () => {
  it('累計の増分だけを1行ずつ操作ログに出す（§5.2）', () => {
    useStore.getState().noteDroppedTicks(20);
    useStore.getState().noteDroppedTicks(20);
    useStore.getState().noteDroppedTicks(32);
    expect(useStore.getState().logLines.map((l) => l.text)).toEqual([
      droppedTicksLog(20),
      droppedTicksLog(12),
    ]);
    expect(useStore.getState().reportedDroppedTicks).toBe(32);
  });

  it('スナップショットが捨てた tick を報告したら操作ログに出る', () => {
    useStore.getState().applySnapshot({ ...EMPTY_SNAPSHOT, droppedTicks: 7 });
    expect(useStore.getState().logLines.at(-1)?.text).toBe(droppedTicksLog(7));
    // 同じ累計が続く間は増えない
    useStore.getState().applySnapshot({ ...EMPTY_SNAPSHOT, droppedTicks: 7 });
    expect(useStore.getState().logLines).toHaveLength(1);
  });
});

describe('pushHistory', () => {
  it('上限と「やり直し列を捨てる」規則は commands.ts と同じものを使う（§8.2）', () => {
    const before = createSession(JIPM_BOARD, {
      roles: TASK2_SOCKET_ROLES,
      allowedColors: ['青'],
    });
    useStore.setState({ history: { done: [], undone: [] } });
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      useStore.getState().pushHistory({
        kind: 'addWire',
        label: `配線 ${i}`,
        before,
        after: before,
      });
    }
    const history = useStore.getState().history;
    expect(history.done).toHaveLength(HISTORY_LIMIT);
    expect(history.done[0]?.label).toBe('配線 5');
    expect(history.undone).toEqual([]);
  });
});

describe('restartSession / resetSession（§13 #5）', () => {
  it('restartSession は盤と履歴を残し、ライブ記録とエラーだけ捨てて世代を進める', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    const session = useStore.getState().session;
    if (session === undefined) throw new Error('セッションが作られていません');
    useStore
      .getState()
      .pushHistory({ kind: 'addWire', label: '配線 A', before: session, after: session });
    useStore.getState().applySnapshot({
      ...EMPTY_SNAPSHOT,
      tMs: 500,
      logDelta: [{ tMs: 100, signal: 'PL1', value: true }],
    });
    useStore.setState({ fatalError: '描画で落ちました', webglLost: true, judge: undefined });
    const epoch = useStore.getState().sessionEpoch;

    useStore.getState().restartSession();

    const state = useStore.getState();
    expect(state.sessionEpoch).toBe(epoch + 1);
    // 作業は失わない（§13「作業保持の原則」）
    expect(state.session).toBe(session);
    expect(state.history.done).toHaveLength(1);
    // ライブ記録とエラー表示は捨てる
    expect(state.snapshot.tMs).toBe(0);
    expect(state.liveTransitions).toEqual({});
    expect(state.fatalError).toBeUndefined();
    expect(state.webglLost).toBe(false);
  });

  it('resetSession は盤を作り直し、同じ課題でも世代を進める（Worker を張り直させる）', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    const first = useStore.getState().session;
    const epoch = useStore.getState().sessionEpoch;

    useStore.getState().resetSession();

    const state = useStore.getState();
    expect(state.sessionEpoch).toBe(epoch + 1);
    expect(state.session).not.toBe(first);
    expect(state.history.done).toHaveLength(0);
    expect(state.route).toBe('session');
  });
});

describe('setMode', () => {
  it('モードを切り替えると配線待ちの端子と選択中の電線を両方とも捨てる（§12.2）', () => {
    useStore.setState({
      mode: 'wire',
      pendingTerminal: toTerminalId('CR1.13'),
      selectedWire: 'w-001',
    });
    useStore.getState().setMode('delete');
    const state = useStore.getState();
    expect(state.mode).toBe('delete');
    expect(state.pendingTerminal).toBeUndefined();
    expect(state.selectedWire).toBeUndefined();
  });
});
