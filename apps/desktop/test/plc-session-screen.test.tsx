import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { NO_CONVERT_ISSUES } from '../src/renderer/app/store-types.js';
import { SessionRoute } from '../src/renderer/screens/SessionRoute.js';
import { bridge } from '../src/renderer/session/worker-bridge.js';
import type * as BoardSceneModule from '../src/renderer/three/BoardScene.js';

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
    fireEvent.click(screen.getByTestId('view-plc'));
    expect(useStore.getState().camera).toBe('plc');
  });

  it('refuses to judge an unconverted ladder and says why (H-1)', () => {
    render(<SessionRoute />);
    const judge = screen.getByTestId('judge-button');
    expect(judge).toBeDisabled();
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
    expect(screen.getByTestId('plc-hint')).toHaveTextContent('F4');
  });

  it('says why the judge button is disabled and shows RUN/STOP as text', () => {
    render(<SessionRoute />);
    expect(screen.getByTestId('plc-hint')).toHaveTextContent('判定できません');
    expect(screen.getByTestId('plc-run-status')).toHaveTextContent('停止中');
    expect(screen.getByTestId('plc-ladder-mode')).toHaveTextContent('書込モード');
    act(() => {
      useStore.getState().setPlcRunning(true);
    });
    expect(screen.getByTestId('plc-run-status')).toHaveTextContent('運転中');
  });

  it('shows the problem statement and the parts panel（リレーを装着する）', () => {
    render(<SessionRoute />);
    expect(screen.getByText(titlePattern)).toBeInTheDocument();
    expect(screen.getByTestId('parts-panel')).toBeInTheDocument();
  });
});
