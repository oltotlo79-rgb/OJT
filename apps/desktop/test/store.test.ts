import { createSession, JIPM_BOARD, TASK2_SOCKET_ROLES } from '@ojt/board-model';
import { HAZARD_KINDS, toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyHistory, HISTORY_LIMIT } from '../src/renderer/session/commands.js';
import { droppedTicksLog, JA } from '../src/renderer/i18n/ja.js';
import {
  EMPTY_SNAPSHOT,
  MAX_LIVE_POINTS,
  RESTART_FALLBACK_ATTEMPTS,
  schematicPolicy,
  sessionFields,
  sessionForProblem,
  TOAST_LIMIT,
  TOAST_TTL_MS,
  useStore,
  type AppState,
} from '../src/renderer/app/store.js';
import { createLadderSlice } from '../src/renderer/app/store-ladder.js';
import { createSchematicSlice } from '../src/renderer/app/store-schematic.js';
import { createSessionSlice } from '../src/renderer/app/store-session.js';
import { createUiSlice } from '../src/renderer/app/store-ui.js';

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
    droppedTicksNotice: undefined,
    restartAttempts: 0,
    restoredHazardCount: 0,
    pendingWorkFile: undefined,
    elapsedMs: 0,
    startedAtMs: 0,
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

  it('遷移点を数千件流しても上限で切り詰める（指摘 DS-2 ≡ UI-02）', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    // 0.8秒フリッカを30分回した相当（1信号あたり4,500点）を100件ずつ流し込む
    for (let batch = 0; batch < 45; batch += 1) {
      const logDelta = Array.from({ length: 100 }, (_unused, i) => {
        const n = batch * 100 + i;
        return { tMs: n * 400, signal: 'PL1', value: n % 2 === 0 };
      });
      useStore.getState().applySnapshot({ ...EMPTY_SNAPSHOT, tMs: 1_800_000, logDelta });
    }
    const points = useStore.getState().liveTransitions['PL1'];
    expect(points).toBeDefined();
    expect(points?.length).toBeLessThanOrEqual(MAX_LIVE_POINTS);
    // 直近は1点も落とさない（最後に流した変化点がそのまま残る）
    expect(points?.at(-1)).toEqual({ tMs: 4499 * 400, value: false });
    // 切り詰めた先頭は必ず「false → true」の変化点（`toSegments()` の前提に揃える）
    expect(points?.[0]?.value).toBe(true);
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

describe('JA.hazard（§5.6 網羅性）', () => {
  it('HAZARD_KINDS の全種別に日本語名がある', () => {
    const missing = HAZARD_KINDS.filter(
      (k) => (JA.hazard as Record<string, string | undefined>)[k] === undefined,
    );
    expect(missing).toEqual([]);
  });
});

describe('dismissHazard（間引きタイマの期限境界）', () => {
  const expiresAt = 1_000_000;

  beforeEach(() => {
    useStore.setState({ hazardBanner: { kind: 'ohm-on-live', detail: 'x', expiresAt } });
  });

  it('期限の1ms手前ではまだ畳まない', () => {
    useStore.getState().dismissHazard(expiresAt - 1);
    expect(useStore.getState().hazardBanner).toBeDefined();
  });

  it('期限の1ms後で畳む', () => {
    useStore.getState().dismissHazard(expiresAt + 1);
    expect(useStore.getState().hazardBanner).toBeUndefined();
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
  it('連続する通知は1行にまとめ、tick数と回数を積算する（§5.2 / 復元プロンプトのレビュー指摘）', () => {
    useStore.getState().noteDroppedTicks(5);
    useStore.getState().noteDroppedTicks(9);
    useStore.getState().noteDroppedTicks(12);
    expect(useStore.getState().logLines.map((l) => l.text)).toEqual([droppedTicksLog(12, 3)]);
    expect(useStore.getState().reportedDroppedTicks).toBe(12);
  });

  it('最初の行のidは書き換えず、まとめた行として更新する（§5.2）', () => {
    useStore.getState().noteDroppedTicks(20);
    const firstId = useStore.getState().logLines.at(-1)?.id;
    useStore.getState().noteDroppedTicks(32);
    expect(useStore.getState().logLines).toHaveLength(1);
    expect(useStore.getState().logLines[0]?.id).toBe(firstId);
    expect(useStore.getState().logLines[0]?.text).toBe(droppedTicksLog(32, 2));
  });

  it('間に別の操作ログが挟まれば、通知はまとめずに別の行になる（§5.2）', () => {
    useStore.getState().noteDroppedTicks(5);
    useStore.getState().addLog('別の操作ログ');
    useStore.getState().noteDroppedTicks(9);
    expect(useStore.getState().logLines.map((l) => l.text)).toEqual([
      droppedTicksLog(5),
      '別の操作ログ',
      droppedTicksLog(4),
    ]);
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

  /**
   * 1D2-a のレビュー指摘: 盤そのもの（保存データ由来の壊れた電線など）が原因で落ちていると、
   * 盤を残す `restartSession()` を何度押しても同じ例外で落ち続け、画面から抜け出せなかった。
   */
  it('2回続けてリセットしたら盤を作り直し、知らせを出す', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    const original = useStore.getState().session;
    if (original === undefined) throw new Error('セッションが作られていません');
    useStore
      .getState()
      .pushHistory({ kind: 'addWire', label: '配線 A', before: original, after: original });

    useStore.getState().restartSession();
    // 1回目は作業を残す（§13「作業保持の原則」）
    expect(useStore.getState().session).toBe(original);
    expect(useStore.getState().restartAttempts).toBe(1);
    expect(useStore.getState().toasts).toHaveLength(0);

    useStore.getState().restartSession();

    const state = useStore.getState();
    expect(RESTART_FALLBACK_ATTEMPTS).toBe(2);
    expect(state.session).not.toBe(original);
    expect(state.history.done).toHaveLength(0);
    expect(state.restartAttempts).toBe(0);
    expect(state.toasts.at(-1)?.text).toBe(JA.error.boardReset);
  });

  it('画面を描けたら連続リセットの数は 0 に戻る', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    useStore.getState().restartSession();
    expect(useStore.getState().restartAttempts).toBe(1);

    useStore.getState().noteRenderSuccess();
    expect(useStore.getState().restartAttempts).toBe(0);

    // 数え直したあとの1回目は、また盤を残す
    const session = useStore.getState().session;
    useStore.getState().restartSession();
    expect(useStore.getState().session).toBe(session);
  });

  it('abandonSession は課題を捨てて一覧へ戻し、世代を進める', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    useStore.setState({ fatalError: '描画で落ちました', restartAttempts: 3 });
    const epoch = useStore.getState().sessionEpoch;

    useStore.getState().abandonSession();

    const state = useStore.getState();
    expect(state.route).toBe('list');
    expect(state.problem).toBeUndefined();
    expect(state.session).toBeUndefined();
    expect(state.judge).toBeUndefined();
    expect(state.fatalError).toBeUndefined();
    expect(state.history.done).toHaveLength(0);
    expect(state.sessionEpoch).toBe(epoch + 1);
    expect(state.restartAttempts).toBe(0);
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

describe('restoreProgress（§12.3: 作業ファイルから経過時間と危険操作を戻す）', () => {
  it('経過時間を戻し、始点を巻き戻して続きから計時する', () => {
    const before = Date.now();
    useStore.getState().restoreProgress(754_000, 3);
    const state = useStore.getState();
    expect(state.elapsedMs).toBe(754_000);
    expect(state.restoredHazardCount).toBe(3);
    expect(state.startedAtMs).toBeGreaterThanOrEqual(before - 754_000);

    // そのまま計時を進めると、復元した時間の続きから増える
    useStore.getState().tickElapsed();
    expect(useStore.getState().elapsedMs).toBeGreaterThanOrEqual(754_000);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0])('壊れた経過時間 %s は 0 にする', (bad) => {
    useStore.getState().restoreProgress(bad, 0);
    expect(useStore.getState().elapsedMs).toBe(0);
  });

  it.each([Number.NaN, -5])('壊れた危険操作回数 %s は 0 にする', (bad) => {
    useStore.getState().restoreProgress(0, bad);
    expect(useStore.getState().restoredHazardCount).toBe(0);
  });
});

describe('schematicPolicy（§8.4: 級ごとの回路図ヒント）', () => {
  it('3級は常時表示で開閉させない', () => {
    expect(schematicPolicy(3)).toEqual({ shown: true, toggleable: false });
  });

  it('2級は開閉でき、初期は閉じている', () => {
    expect(schematicPolicy(2)).toEqual({ shown: false, toggleable: true });
  });

  it('1級は出さない', () => {
    expect(schematicPolicy(1)).toEqual({ shown: false, toggleable: false });
  });

  it('課題を開いたときの初期表示は級で決まる（課題JSONの hints では決めない）', () => {
    for (const grade of [1, 2, 3] as const) {
      const problem = BUILTIN_PROBLEMS.find((p) => p.grade === grade);
      expect(problem, `${grade}級の課題`).toBeDefined();
      if (problem === undefined) continue;
      useStore.getState().openProblem(problem);
      expect(useStore.getState().schematicVisible, `${grade}級`).toBe(schematicPolicy(grade).shown);
    }
  });
});

describe('ストアの4分割（指摘 DS-3）', () => {
  /**
   * 分割前の `AppState` が持っていた欄と操作の数。§12.1
   * 4スライスの公開キーの和がこれと一致することを固定して、割り直しで欄が
   * 迷子になる（どのスライスにも入らない／二重に入る）ことを止める。
   *
   * 144 → 148: Phase 7 Task 27（3D盤の直接操作）で `dragging` / `hoverHint` と
   * その差し替え（`setDragging` / `setHoverHint`）の4つが増えた。
   * 148 → 150: Phase 7 Task 25（指摘 PR-02）で `hintStage` と `revealHint` の2つが増えた。
   */
  const APP_STATE_KEY_COUNT = 152;

  /** スライスを1つ組み立てて、公開するキーだけを取り出す（中身は呼ばない）。 */
  function keysOf(
    create: (
      set: typeof useStore.setState,
      get: typeof useStore.getState,
      store: typeof useStore,
    ) => object,
  ): string[] {
    return Object.keys(create(useStore.setState, useStore.getState, useStore));
  }

  it('4スライスの公開キーの和がストアのキー集合と一致する', () => {
    const slices = [
      keysOf(createSessionSlice),
      keysOf(createSchematicSlice),
      keysOf(createLadderSlice),
      keysOf(createUiSlice),
    ];
    const union = new Set(slices.flat());
    expect(union.size).toBe(slices.reduce((total, keys) => total + keys.length, 0));
    expect([...union].sort()).toEqual(Object.keys(useStore.getState()).sort());
    expect(union.size).toBe(APP_STATE_KEY_COUNT);
  });
});

describe('sessionFields（課題を開く・やり直す・捨てるの初期値。指摘 DS-3）', () => {
  /** いまの状態を「途中まで進めた」形に汚す。 */
  function dirty(): void {
    useStore.setState({
      judging: true,
      fatalError: 'こわれました',
      webglLost: true,
      pendingTerminal: toTerminalId('CR1.9'),
      hoveredTerminal: toTerminalId('CR1.5'),
      selectedWire: 'w-1',
      selectedSocket: 'S1',
      nextProbe: 'red',
      answers: [{ partId: 'p1', answer: 'normal' }],
      checkPartId: 'p1',
      schematicOpenCount: 3,
      assembleView: 'schematic',
    });
  }

  /** `sessionFields()` が決める欄が、いま全部その値になっているか。 */
  function expectFresh(): void {
    const state = useStore.getState();
    const fresh = sessionFields(state);
    for (const [key, value] of Object.entries(fresh)) {
      expect(state[key as keyof AppState], key).toEqual(value);
    }
  }

  it('openProblem が同じ初期値から始める', () => {
    expect(PROBLEM).toBeDefined();
    if (PROBLEM === undefined) return;
    dirty();
    expect(useStore.getState().openProblem(PROBLEM)).toBe(true);
    expectFresh();
  });

  it('restartSession が同じ初期値へ戻す', () => {
    expect(PROBLEM).toBeDefined();
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    dirty();
    useStore.getState().restartSession();
    expectFresh();
  });

  it('abandonSession が同じ初期値へ戻す', () => {
    expect(PROBLEM).toBeDefined();
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    dirty();
    useStore.getState().abandonSession();
    expectFresh();
  });
});
