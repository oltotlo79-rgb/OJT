import { BUILTIN_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/app/App.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { formatElapsed, formatSavedAt } from '../src/worker/runtime.js';
import {
  DEFAULT_SETTINGS,
  type OjtApi,
  type WorkFile,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../src/shared/ipc.js';
import type * as WorkFileModule from '../src/renderer/session/work-file.js';
import {
  EMPTY_SNAPSHOT,
  sessionForProblem,
  TOAST_LIMIT,
  useStore,
} from '../src/renderer/app/store.js';

/**
 * 外枠（例外バナー・トースト・起動時の復元プロンプト・一時保存）のテスト。
 * 設計仕様 §13 #5 / §8.2 / §12.3。
 *
 * 画面そのものは差し替える。ここで見たいのは「ルートの描画が落ちたときに外枠が生き残るか」
 * であって、どの画面が出るかではないため（3D を含む本物の画面は happy-dom では描けない）。
 * `applyWorkFile()` は `work-file.ts` 側で個別にテスト済みなので、ここでは
 * 「正しい引数で呼ばれるか」だけを見る（`toWorkFile` は実物のまま使う）。
 */

const BOOM = '描画で落ちました';
const routeMock = vi.hoisted(() => ({ throwing: false }));
const workFileMock = vi.hoisted(() => ({ applyWorkFile: vi.fn(() => Promise.resolve(true)) }));

vi.mock('../src/renderer/app/routes.js', () => ({
  renderRoute: () => {
    if (routeMock.throwing) throw new Error(BOOM);
    return createElement('div', { 'data-testid': 'route' });
  },
}));

vi.mock('../src/renderer/session/work-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkFileModule>();
  return { ...actual, applyWorkFile: workFileMock.applyWorkFile };
});

/** preload を差し替える（`delete` で「読み込まれていない」状態に戻せる）。 */
function setApi(api: Partial<OjtApi> | undefined): void {
  if (api === undefined) delete window.ojt;
  else window.ojt = api as OjtApi;
}

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');

function autosaveFile(overrides: Partial<WorkFile> = {}): WorkFile {
  // モジュール先頭の `if (PROBLEM === undefined) throw` はここへは伝播しない
  // （TS はこの関数がいつ呼ばれるか静的に追わないため。session.test.tsx と同じ書き方）
  if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');
  return {
    formatVersion: 1,
    problemId: 'b-001',
    session: sessionForProblem(PROBLEM),
    elapsedMs: 4321,
    hazardCount: 0,
    savedAt: '2026-09-14T09:00:00.000Z',
    ...overrides,
  };
}

/** React の偽タイマ。スケジューラを壊さないよう最小限だけ差し替える。 */
const FAKE_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;

beforeEach(() => {
  routeMock.throwing = false;
  workFileMock.applyWorkFile.mockClear();
  setApi(undefined);
  useStore.setState({
    route: 'home',
    toasts: [],
    logLines: [],
    fatalError: undefined,
    webglLost: false,
    judge: undefined,
    sessionEpoch: 0,
    snapshot: EMPTY_SNAPSHOT,
    reportedDroppedTicks: 0,
    problem: undefined,
    session: undefined,
    elapsedMs: 0,
    hazards: [],
    restartAttempts: 0,
    restoredHazardCount: 0,
    pendingWorkFile: undefined,
    history: { done: [], undone: [] },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setApi(undefined);
});

describe('例外バナー（§13 #5）', () => {
  it('描画中に投げられても外枠は残り、日本語のバナーとリセットボタンが出る', () => {
    // React は境界が拾った例外を console.error に流す。テスト出力を汚さないよう黙らせる
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    routeMock.throwing = true;
    render(<App />);

    const banner = screen.getByTestId('error-banner');
    expect(banner.textContent).toContain(JA.error.banner);
    expect(banner.textContent).toContain(BOOM);
    expect(screen.getByRole('button', { name: JA.error.reset })).toBeTruthy();
    // 落ちた部分木は描かれない（外枠だけが残る）
    expect(screen.queryByTestId('route')).toBeNull();
  });

  it('「セッションをリセット」で世代が進み、直った画面がまた描かれる', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    routeMock.throwing = true;
    render(<App />);
    expect(screen.getByTestId('error-banner')).toBeTruthy();

    routeMock.throwing = false;
    fireEvent.click(screen.getByTestId('error-reset'));

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(screen.getByTestId('route')).toBeTruthy();
    expect(useStore.getState().sessionEpoch).toBe(1);
    // 描けたので連続リセットの数は 0 に戻る（次に落ちても、また盤を残して1回試せる）
    expect(useStore.getState().restartAttempts).toBe(0);
  });

  /**
   * 1D2-a のレビュー指摘: 盤そのものが描けないと「セッションをリセット」を押しても
   * 同じ例外で落ち続け、訓練者は画面から一切抜け出せなかった（詰み）。
   */
  it('直らない画面でも「課題一覧へ戻る」で抜け出せる', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useStore.setState({ problem: PROBLEM, session: sessionForProblem(PROBLEM), route: 'session' });
    routeMock.throwing = true;
    render(<App />);

    // 何度リセットしても直らない
    fireEvent.click(screen.getByTestId('error-reset'));
    expect(screen.getByTestId('error-banner')).toBeTruthy();
    fireEvent.click(screen.getByTestId('error-reset'));
    expect(screen.getByTestId('error-banner')).toBeTruthy();

    // 課題ごと捨てれば一覧へ戻れる（差し替えたルートは落ちないことにして確かめる）
    routeMock.throwing = false;
    fireEvent.click(screen.getByTestId('error-to-list'));

    expect(screen.queryByTestId('error-banner')).toBeNull();
    const state = useStore.getState();
    expect(state.route).toBe('list');
    expect(state.problem).toBeUndefined();
    expect(state.session).toBeUndefined();
  });

  it('2回目のリセットでは盤を作り直して知らせる', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useStore.setState({ problem: PROBLEM, session: sessionForProblem(PROBLEM), route: 'session' });
    const original = useStore.getState().session;
    routeMock.throwing = true;
    render(<App />);

    fireEvent.click(screen.getByTestId('error-reset'));
    expect(useStore.getState().session).toBe(original);

    fireEvent.click(screen.getByTestId('error-reset'));
    expect(useStore.getState().session).not.toBe(original);
    expect(useStore.getState().toasts.at(-1)?.text).toBe(JA.error.boardReset);
  });

  it('非同期の未捕捉例外もバナーに出る', () => {
    render(<App />);
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'Worker が落ちました' }));
    });
    expect(screen.getByTestId('error-banner').textContent).toContain('Worker が落ちました');
  });
});

describe('トースト（§8.2）', () => {
  it('3秒おきに6件出しても22秒後には1件も残らない', () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    vi.setSystemTime(0);
    render(<App />);

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        useStore.getState().toast(`失敗 ${i}`, 'error');
        vi.advanceTimersByTime(3000);
      });
    }
    expect(screen.queryAllByTestId('toast').length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryAllByTestId('toast')).toHaveLength(0);
  });

  it('一度に10件出しても画面には新しい5件しか出ない', () => {
    render(<App />);
    act(() => {
      for (let i = 0; i < 10; i += 1) useStore.getState().toast(`失敗 ${i}`, 'error');
    });
    const shown = screen.queryAllByTestId('toast');
    expect(shown).toHaveLength(TOAST_LIMIT);
    expect(shown[0]?.textContent).toBe('失敗 5');
  });
});

describe('起動時の復元プロンプト（§12.3）', () => {
  it('preload が無くても落ちない', async () => {
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('restore-prompt')).toBeNull();
  });

  it('一時保存が無ければ何も出さない', async () => {
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: false, canceled: false, message: '無し' }),
    });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('restore-prompt')).toBeNull();
  });

  it('一時保存があれば復元を確認するプロンプトを出す（testid: restore-prompt）', async () => {
    const file = autosaveFile();
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: true, file, path: 'C:/autosave.json' }),
    });
    render(<App />);
    const prompt = await screen.findByTestId('restore-prompt');
    expect(prompt.textContent).toContain(JA.session.restoreTitle);
    // 生のISO(UTC)文字列ではなく、ローカル日時表記（`T`/`Z`を含まない）で出す
    expect(prompt.textContent).not.toContain(file.savedAt);
    expect(prompt.textContent).toContain(formatSavedAt(file.savedAt));
  });

  it('復元カードにモード・課題名・経過時間を出す（UXレビュー #15）', async () => {
    const file = autosaveFile({ mode: 'inspect-repair', elapsedMs: 65_000 });
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: true, file, path: 'C:/autosave.json' }),
      readProblem: () => Promise.resolve(PROBLEM),
    });
    render(<App />);
    const detail = await screen.findByTestId('restore-detail');
    expect(detail.textContent).toContain(JA.home.inspectRepair);
    expect(detail.textContent).toContain(formatElapsed(65_000));
    await screen.findByText(PROBLEM.title);
  });

  it('readProblem が無い簡易な preload でも復元カードは落ちない（既定の課題名の仮表示に留まる）', async () => {
    const file = autosaveFile();
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: true, file, path: 'C:/autosave.json' }),
    });
    render(<App />);
    const detail = await screen.findByTestId('restore-detail');
    expect(detail.textContent).toContain(JA.restoreCard.unknownProblem);
  });

  it('設定で無効化していれば一時保存を確認しない', async () => {
    const loadWorkFile = vi.fn(() =>
      Promise.resolve({ ok: true, file: autosaveFile(), path: 'C:/autosave.json' } as const),
    );
    setApi({
      getSettings: () => Promise.resolve({ ...DEFAULT_SETTINGS, restorePrompt: false }),
      loadWorkFile,
    });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadWorkFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('restore-prompt')).toBeNull();
  });

  it('「復元する」で作業ファイルを適用し、プロンプトを消す', async () => {
    const file = autosaveFile();
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: true, file, path: 'C:/autosave.json' }),
    });
    render(<App />);
    await screen.findByTestId('restore-prompt');

    fireEvent.click(screen.getByRole('button', { name: JA.session.restoreYes }));

    expect(workFileMock.applyWorkFile).toHaveBeenCalledWith(file);
    expect(screen.queryByTestId('restore-prompt')).toBeNull();
  });

  it('「復元しない」で discard: true を送り、プロンプトを消す', async () => {
    const file = autosaveFile();
    const loadWorkFile = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, file, path: 'C:/autosave.json' })
      .mockResolvedValue({ ok: false, canceled: true, message: '一時保存を削除しました' });
    setApi({ getSettings: () => Promise.resolve(DEFAULT_SETTINGS), loadWorkFile });
    render(<App />);
    await screen.findByTestId('restore-prompt');

    fireEvent.click(screen.getByRole('button', { name: JA.session.restoreNo }));

    expect(loadWorkFile).toHaveBeenLastCalledWith({ kind: 'autosave', discard: true });
    expect(workFileMock.applyWorkFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('restore-prompt')).toBeNull();
  });

  /**
   * 1D2-a のレビュー指摘: 訓練者が先に課題一覧から作業を始めても確認欄が居座り続け、
   * あとから「復元する」を押すと、いま組んでいる盤が黙って消えていた。
   */
  it('課題を開いたら確認欄は引っ込む', async () => {
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: true, file: autosaveFile(), path: 'C:/a.json' }),
    });
    render(<App />);
    await screen.findByTestId('restore-prompt');

    act(() => {
      useStore.getState().openProblem(PROBLEM);
    });

    expect(screen.queryByTestId('restore-prompt')).toBeNull();
  });

  it('設定ファイルが壊れていた警告をトーストで出す', async () => {
    setApi({
      getSettings: () => Promise.resolve({ ...DEFAULT_SETTINGS, warning: '設定が壊れていました' }),
      loadWorkFile: () => Promise.resolve({ ok: false, canceled: false, message: '無し' }),
    });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useStore.getState().toasts.map((t) => t.text)).toContain('設定が壊れていました');
  });
});

describe('別の課題を読むときの確認欄（§12.3）', () => {
  it('pendingWorkFile があれば「続行／取消」を出し、続行で適用を呼び直す', () => {
    const file = autosaveFile({ problemId: 'b-002' });
    render(<App />);
    act(() => {
      useStore.getState().setPendingWorkFile(file);
    });

    const dialog = screen.getByTestId('discard-confirm');
    expect(dialog.textContent).toContain(JA.session.discardTitle);

    fireEvent.click(screen.getByRole('button', { name: JA.session.discardYes }));

    expect(workFileMock.applyWorkFile).toHaveBeenCalledWith(file, { confirmed: true });
    expect(screen.queryByTestId('discard-confirm')).toBeNull();
    expect(useStore.getState().pendingWorkFile).toBeUndefined();
  });

  it('取消なら適用しない', () => {
    render(<App />);
    act(() => {
      useStore.getState().setPendingWorkFile(autosaveFile({ problemId: 'b-002' }));
    });

    fireEvent.click(screen.getByRole('button', { name: JA.session.discardNo }));

    expect(workFileMock.applyWorkFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('discard-confirm')).toBeNull();
  });
});

describe('30秒ごとの一時保存（§12.3）', () => {
  it('セッション中は30秒ごとに一時保存する', async () => {
    const saveWorkFile = vi.fn<(request: WorkFileSaveRequest) => Promise<WorkFileSaveResult>>(() =>
      Promise.resolve({ ok: true, path: 'C:/autosave.json' }),
    );
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: false, canceled: false, message: '無し' }),
      saveWorkFile,
    });
    useStore.setState({
      route: 'session',
      problem: PROBLEM,
      session: sessionForProblem(PROBLEM),
      elapsedMs: 999,
      hazards: [
        { type: 'hazard', kind: 'ohm-on-live', tMs: 100, detail: '' },
        { type: 'hazard', kind: 'range-exceeded', tMs: 200, detail: '' },
      ],
    });
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(saveWorkFile).toHaveBeenCalledTimes(1);
    const request = saveWorkFile.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    expect(request?.kind).toBe('autosave');
    expect(request?.file.problemId).toBe('b-001');
    expect(request?.file.elapsedMs).toBe(999);
    expect(request?.file.hazardCount).toBe(2);
  });

  it('連続2回失敗したら1度だけ知らせる（DS-4）', async () => {
    const saveWorkFile = vi.fn<(request: WorkFileSaveRequest) => Promise<WorkFileSaveResult>>(() =>
      Promise.resolve({ ok: false, canceled: false, message: '失敗' }),
    );
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: false, canceled: false, message: '無し' }),
      saveWorkFile,
    });
    useStore.setState({ route: 'session', problem: PROBLEM, session: sessionForProblem(PROBLEM) });
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });

    // トーストは既定で数秒後に期限切れで消えるので（TOAST_TTL_MS）、配列ではなく
    // `toast()` アクションの呼び出し回数そのものを見る（30秒間隔の advance とは無関係にする）
    const toastSpy = vi.spyOn(useStore.getState(), 'toast');

    // 1回目の失敗ではまだ知らせない
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(toastSpy).not.toHaveBeenCalled();

    // 2回目の失敗で1度だけ知らせる
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(saveWorkFile).toHaveBeenCalledTimes(2);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(JA.error.autosaveFailed, 'error');

    // 3回目の失敗では重ねて出さない
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(saveWorkFile).toHaveBeenCalledTimes(3);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('セッション外では一時保存しない', async () => {
    const saveWorkFile = vi.fn<(request: WorkFileSaveRequest) => Promise<WorkFileSaveResult>>(() =>
      Promise.resolve({ ok: true, path: 'C:/autosave.json' }),
    );
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      loadWorkFile: () => Promise.resolve({ ok: false, canceled: false, message: '無し' }),
      saveWorkFile,
    });
    useStore.setState({ route: 'home' });
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(saveWorkFile).not.toHaveBeenCalled();
  });
});
