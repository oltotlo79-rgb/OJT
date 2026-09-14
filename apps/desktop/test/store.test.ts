import { BUILTIN_PROBLEMS } from '@ojt/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT, sessionForProblem, useStore } from '../src/renderer/app/store.js';

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-003');

beforeEach(() => {
  useStore.setState({
    route: 'home',
    problem: undefined,
    session: undefined,
    chartSpecs: [],
    liveTransitions: {},
    hazards: [],
    chatters: [],
    logLines: [],
    toasts: [],
    snapshot: EMPTY_SNAPSHOT,
  });
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
});
