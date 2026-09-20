import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { endNetwork, network, no, program, X } from '@ojt/ladder-core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { NO_CONVERT_ISSUES } from '../src/renderer/app/store-types.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { SessionRoute } from '../src/renderer/screens/SessionRoute.js';
import { bridge } from '../src/renderer/session/worker-bridge.js';
import type * as BoardSceneModule from '../src/renderer/three/BoardScene.js';
import type { OjtApi } from '../src/shared/ipc.js';

/** 3D は happy-dom（このリポジトリのテスト環境）では描けないので `BoardScene` を差し替える。 */
vi.mock('../src/renderer/three/BoardScene.js', async (importOriginal) => {
  const actual = await importOriginal<typeof BoardSceneModule>();
  return { ...actual, BoardScene: () => <div data-testid="board-canvas" /> };
});

const problem = BUILTIN_PLC_PROBLEMS[0]!;
const sent: unknown[] = [];

/**
 * 課題名は `ProblemPanel` が級と並べて出すので前方一致で引く。先頭に錨を打つのは
 * 操作ログの「課題「…」を開きました」に当たらないようにするため。
 */
const titlePattern = new RegExp(`^${problem.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/** いま画面が「いまここ」にしている手順のキー一覧（UI監査 2026-09-20 Blocking #7 / B8）。 */
function currentSteps(): string[] {
  return screen
    .getAllByTestId(/^plc-step-/u)
    .filter((el) => el.getAttribute('data-state') === 'current')
    .map((el) => el.dataset.testid ?? '');
}

/** preload を差し替える（`session.test.tsx` と同じ形）。 */
function setApi(api: Partial<OjtApi> | undefined): void {
  if (api === undefined) delete window.ojt;
  else window.ojt = api as OjtApi;
}

/** 保存・読込は「…」メニューの中に畳んである。 */
function openToolbarOverflow(): void {
  fireEvent.click(screen.getByTestId('toolbar-overflow-toggle'));
}

beforeEach(() => {
  sent.length = 0;
  vi.spyOn(bridge, 'start').mockImplementation(() => undefined);
  vi.spyOn(bridge, 'stop').mockImplementation(() => undefined);
  vi.spyOn(bridge, 'send').mockImplementation((command) => {
    sent.push(command);
  });
  useStore.getState().abandonSession();
  useStore.getState().openProblem(problem);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setApi(undefined);
});

describe('モードDのセッション画面（§10.1 / §12.1）', () => {
  it('routes a PLC problem to its own screen', () => {
    render(<SessionRoute />);
    expect(screen.getByTestId('plc-session')).toBeInTheDocument();
    expect(screen.getByTestId('ladder-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('board-canvas')).toBeInTheDocument();
  });

  it('loads the derived board into the worker', () => {
    render(<SessionRoute />);
    expect(sent[0]).toMatchObject({ type: 'load', problemId: problem.id, plcModel: 'FX5U' });
  });

  it('switches between ladder, split and board (決定表#10)', () => {
    render(<SessionRoute />);
    expect(useStore.getState().ladderView).toBe('split');
    fireEvent.click(screen.getByTestId('view-board'));
    expect(useStore.getState().ladderView).toBe('board');
    expect(screen.queryByTestId('ladder-workspace')).toBeNull();
    fireEvent.click(screen.getByTestId('view-ladder'));
    expect(screen.queryByTestId('viewport')).toBeNull();
  });

  it('offers the PLC camera preset', () => {
    render(<SessionRoute />);
    // UXレビュー #17: 視点は「…」メニューの中に畳んである
    fireEvent.click(screen.getByTestId('toolbar-overflow-toggle'));
    fireEvent.click(screen.getByTestId('view-plc'));
    expect(useStore.getState().camera).toBe('plc');
  });

  it('refuses to judge an unconverted ladder and says why (H-1)', () => {
    render(<SessionRoute />);
    const judge = screen.getByTestId('judge-button');
    // UXレビュー #5 / UI-03・UI-06: `disabled` ではなく `aria-disabled`（title・トーストは保つ）
    expect(judge).not.toBeDisabled();
    expect(judge).toHaveAttribute('aria-disabled', 'true');
    expect(judge).toHaveAttribute('title', expect.stringContaining('変換'));
    expect(sent.filter((c) => (c as { type: string }).type === 'judgePlc')).toHaveLength(0);
  });

  it('sends the judge command once the ladder is converted', () => {
    render(<SessionRoute />);
    act(() => {
      useStore.getState().setConverted(true, NO_CONVERT_ISSUES);
    });
    fireEvent.click(screen.getByTestId('judge-button'));
    const judged = sent.find((c) => (c as { type: string }).type === 'judgePlc');
    expect(judged).toMatchObject({ type: 'judgePlc', problem: { id: problem.id } });
    expect(useStore.getState().judging).toBe(true);
  });

  it('never leaks the static checks while the session is running (決定表#7)', () => {
    const { container } = render(<SessionRoute />);
    const text = container.textContent ?? '';
    for (const forbidden of ['二段構成', '直結', 'PLCの電源が未配線', '割付どおりに配線されて']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('hands the keyboard to the ladder while the editor is focused (決定表#3)', () => {
    render(<SessionRoute />);
    act(() => {
      useStore.getState().setCamera('front');
      useStore.getState().setLadderFocused(true);
    });
    fireEvent.keyDown(window, { key: '2' });
    expect(useStore.getState().camera).toBe('front');
    act(() => {
      useStore.getState().setLadderFocused(false);
    });
    fireEvent.keyDown(window, { key: '2' });
    expect(useStore.getState().camera).toBe('top');
  });

  it('shows which step the trainee is in and what to do first (2026-09-19 の利用者決定)', () => {
    render(<SessionRoute />);
    // 空のラダーで始まるので「ラダー作成」がいまの手順、「変換」はこれから
    expect(screen.getByTestId('plc-step-ladder')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('plc-step-convert')).toHaveAttribute('data-state', 'todo');
    // 「配線」はいつでも行えるので完了印を出さない（決定表#7 に触れない）
    expect(screen.getByTestId('plc-step-wire')).toHaveAttribute('data-state', 'anytime');
    // 最初の一歩はキー割当（方言プロファイル）から作る。決定表#12
    expect(screen.getByTestId('plc-hint')).toHaveTextContent('F5');
    // 「いまここ」はちょうど1つ（UI監査 2026-09-20 Blocking #7 / B8）
    expect(currentSteps()).toEqual(['plc-step-ladder']);
  });

  /** Batch 4+5 レビュー M7: いまの手順だけの案内に絞る（前は常に「ラダー作成」の案内が出ていた）。 */
  it('shows only the hint for the current step (Batch 4+5 レビュー M7)', () => {
    render(<SessionRoute />);
    // まだ何も置いていない → 「ラダー作成」の案内（F5＝a接点／F7＝コイル）だけ。
    // 「変換」の手順の案内（`convertHintText` の「変換します」）はまだ出ない。
    expect(screen.getByTestId('plc-hint')).toHaveTextContent('F5');
    expect(screen.getByTestId('plc-hint')).not.toHaveTextContent('変換します');
    // 変換済みでない中身を積むと「変換」がいまの手順になり、その案内に切り替わる
    act(() => {
      useStore.getState().setLadder(program(network('n1', [[no(X(0))]]), endNetwork()));
    });
    expect(screen.getByTestId('plc-step-convert')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('plc-hint')).toHaveTextContent('変換します');
  });

  /*
   * 押せない理由は判定ボタンの `title` に一本化した（`refuses to judge...` テストが縛る）ので、
   * `plc-hint` はいまの手順の案内だけを見る（UI監査 2026-09-20 Important #10 / I20）。
   */
  it('shows RUN/STOP as text in the status chip', () => {
    render(<SessionRoute />);
    expect(screen.getByTestId('plc-run-status')).toHaveTextContent('停止中');
    expect(screen.getByTestId('plc-ladder-mode')).toHaveTextContent('書込モード');
    act(() => {
      useStore.getState().setPlcRunning(true);
    });
    expect(screen.getByTestId('plc-run-status')).toHaveTextContent('運転中');
  });

  /*
   * UI監査 2026-09-20 Blocking #7 / B8: 以前は「ラダー作成」「モニタ開始RUN」「判定」の
   * 3段が同時に「いまここ」になり得た（`setConverted(true)` だけで、何も書いていなくても
   * `judge` が「いまここ」になっていた）。いまは決まった順で1つずつ進む。
   */
  it('keeps exactly one current step, in order: ladder → convert → run → judge', () => {
    render(<SessionRoute />);
    expect(currentSteps()).toEqual(['plc-step-ladder']);

    act(() => {
      useStore.getState().setLadder(program(network('n1', [[no(X(0))]]), endNetwork()));
    });
    expect(currentSteps()).toEqual(['plc-step-convert']);

    act(() => {
      useStore.getState().setConverted(true, NO_CONVERT_ISSUES);
    });
    // 変換済み・RUN前は「モニタ開始RUN」がいまの手順（判定はまだ先）。判定はRUNを要らない
    // ので、ボタン自体は押せる（Batch 4+5 レビュー M8 は維持する）。
    expect(currentSteps()).toEqual(['plc-step-run']);
    expect(useStore.getState().plcRunning).toBe(false);
    expect(screen.getByTestId('judge-button')).toHaveAttribute('aria-disabled', 'false');

    act(() => {
      useStore.getState().setPlcRunning(true);
    });
    expect(currentSteps()).toEqual(['plc-step-judge']);
  });

  /**
   * UI監査 2026-09-20 Blocking #7 / B8 の再現ケース。「変換」を持たないスキン（OMRON）は
   * 課題を開いた瞬間の空のラダーでも自動変換が通ってしまうが、それは「ラダー作成」を
   * 終えたことにはならない。
   */
  it('does not let an auto-converted empty ladder skip the ladder step (OMRON / Blocking #7)', () => {
    render(<SessionRoute />);
    act(() => {
      useStore.getState().switchDialect('omron');
    });
    expect(useStore.getState().dialectId).toBe('omron');
    expect(useStore.getState().converted).toBe(true); // 自動変換は通っている
    expect(currentSteps()).toEqual(['plc-step-ladder']);
    expect(screen.getByTestId('plc-step-run')).toHaveAttribute('data-state', 'todo');
    expect(screen.getByTestId('plc-step-judge')).toHaveAttribute('data-state', 'todo');
  });

  /** Batch 4+5 レビュー B1: 決定表#7の静的な1行は判定データではないので常に出す。 */
  it('always shows the wall-outlet note (決定表#7 / Batch 4+5 レビュー B1)', () => {
    render(<SessionRoute />);
    expect(screen.getByTestId('plc-outlet-note')).toHaveTextContent('壁コンセント');
  });

  /** Plan 4B Task 7: 既定メーカーで機種が差し替わるので、いまの機種を字でも出す（決定表#9）。 */
  it('shows the model the problem was opened on', () => {
    render(<SessionRoute />);
    expect(screen.getByTestId('plc-model')).toHaveTextContent('FX5U');
  });

  it('shows the problem statement and the parts panel（リレーを装着する）', () => {
    render(<SessionRoute />);
    expect(screen.getByText(titlePattern)).toBeInTheDocument();
    expect(screen.getByTestId('parts-panel')).toBeInTheDocument();
  });

  /**
   * Batch 4+5 レビュー M13: 本体定義（`PLC_UNITS`）が無い機種は「未対応」になる。
   * Plan 4A Task 9 以降、機種表（`PLC_MODELS`）の機種には順に本体定義が付くので、この経路は
   * 「機種表に無い名前が課題データに入っていたとき」に残る。型の穴を通すため `as` で作る。
   */
  it('blocks judging and toasts once for an unsupported PLC model (§13 #2)', () => {
    useStore.getState().abandonSession();
    useStore.getState().openProblem(
      {
        ...problem,
        plc: { vendor: 'omron', model: 'CP1E-UNKNOWN' } as unknown as (typeof problem)['plc'],
      },
      // 既定メーカーで機種を差し替えられると見覚えのない機種が消えてしまう（Plan 4B Task 7）
      { vendor: 'omron' },
    );
    render(<SessionRoute />);
    expect(screen.getByTestId('judge-button')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('judge-button')).toHaveAttribute(
      'title',
      expect.stringContaining('CP1E-UNKNOWN'),
    );
    const toasts = useStore.getState().toasts.filter((t) => t.text.includes('CP1E-UNKNOWN'));
    expect(toasts).toHaveLength(1);
  });
});

/**
 * 指摘 LE-14: `onSave` / `onLoad` / `applyWorkFile` の Promise に `.catch` が無く、IPC の
 * 一時失敗が `unhandledrejection` から致命バナーに化けていた（`LadderWorkspace.exportIl()` は
 * 正しく `.catch` している）。main への IPC 自体が失敗した（Promise が reject する）ケースを
 * 直接再現し、トーストに落ちることを確かめる。
 */
describe('保存・読込のIPC失敗（指摘 LE-14）', () => {
  it('catches a rejected saveWorkFile instead of leaving an unhandled rejection', async () => {
    const saveWorkFile = vi.fn().mockRejectedValue(new Error('IPCが失敗しました'));
    setApi({ saveWorkFile });
    render(<SessionRoute />);
    openToolbarOverflow();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.save }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveWorkFile).toHaveBeenCalledTimes(1);
    const last = useStore.getState().toasts.at(-1);
    expect(last?.text).toBe('IPCが失敗しました');
    expect(last?.tone).toBe('error');
  });

  it('catches a rejected loadWorkFile instead of leaving an unhandled rejection', async () => {
    const loadWorkFile = vi.fn().mockRejectedValue(new Error('IPCが失敗しました'));
    setApi({ loadWorkFile });
    render(<SessionRoute />);
    openToolbarOverflow();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.load }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadWorkFile).toHaveBeenCalledTimes(1);
    const last = useStore.getState().toasts.at(-1);
    expect(last?.text).toBe('IPCが失敗しました');
    expect(last?.tone).toBe('error');
  });
});
