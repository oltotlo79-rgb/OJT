import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  isAssembleProblem,
  type JudgeInspectPartsResult,
} from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { renderRoute } from '../src/renderer/app/routes.js';
import { dispatchTester } from '../src/renderer/panels/TesterPanel.js';
import { InspectPartsSession } from '../src/renderer/screens/InspectPartsSession.js';
import { SessionRoute } from '../src/renderer/screens/SessionRoute.js';
import type { BridgeHandlers } from '../src/renderer/session/worker-bridge.js';

/**
 * モードC1の判定往復とモードB乗り越え防止（Opus レビュー Plan 2B Task 8-11）。
 * `test/inspect-parts-screen.test.tsx` は画面の骨格・部品挿抜・プローブを見るが、
 * `bridge.start` の `onInspect` / `onError` の往復とモードBへの乗り越え防止は
 * 今日どのテストも見ていない。
 */

const mocks = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  handlers: undefined as BridgeHandlers | undefined,
}));

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    start: (next: BridgeHandlers) => {
      mocks.handlers = next;
    },
    stop: () => {
      mocks.handlers = undefined;
    },
    send: (command: Record<string, unknown>) => {
      mocks.sent.push(command);
    },
  },
}));

vi.mock('../src/renderer/three/BoardScene.js', () => ({
  BoardScene: () => <div data-testid="board-canvas" />,
  safeRoutes: () => ({ routes: [], errors: [] }),
}));

const { sent } = mocks;

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
const MODE_B = BUILTIN_ALL_PROBLEMS.find(isAssembleProblem);

beforeEach(() => {
  sent.length = 0;
  mocks.handlers = undefined;
  if (C1 !== undefined) useStore.getState().openProblem(C1);
});

afterEach(() => {
  cleanup();
});

function judgeResult(overrides: Partial<JudgeInspectPartsResult> = {}): JudgeInspectPartsResult {
  const problem = C1;
  if (problem === undefined) throw new Error('C1 がありません');
  return {
    mode: 'inspect-parts',
    passed: true,
    correctCount: problem.parts.length,
    total: problem.parts.length,
    scores: problem.parts.map((p) => ({
      partId: p.id,
      truth: p.truth,
      answer: p.truth,
      correct: true,
    })),
    hazardCount: 0,
    hazardsByKind: {
      'ohm-on-live': 0,
      'range-exceeded': 0,
      'short-circuit-power-on': 0,
      'power-sequence-violation': 0,
      'over-wires-per-terminal': 0,
      overcurrent: 0,
    },
    elapsedMs: 300_000,
    ...overrides,
  };
}

describe('判定の往復（judgeParts → inspectResult → 結果画面）', () => {
  it('inspectResult が届くと judging が下り、judge が入って結果画面へ移る', () => {
    if (C1 === undefined) return;
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId('judge-button'));
    expect(useStore.getState().judging).toBe(true);
    expect(mocks.handlers).toBeDefined();
    mocks.handlers?.onInspect?.({
      type: 'inspectResult',
      result: { ok: true, value: judgeResult() },
    });
    expect(useStore.getState().judging).toBe(false);
    expect(useStore.getState().route).toBe('result');
    expect(useStore.getState().judge?.mode).toBe('inspect-parts');
  });

  it('判定に失敗（ok:false）したら結果画面へ移らずトーストを出す', () => {
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId('judge-button'));
    mocks.handlers?.onInspect?.({
      type: 'inspectResult',
      result: { ok: false, errors: [{ path: 'parts', message: '壊れた課題' }] },
    });
    expect(useStore.getState().route).toBe('session');
    expect(useStore.getState().judging).toBe(false);
    expect(useStore.getState().toasts.at(-1)?.text).toContain('壊れた課題');
  });

  it('Worker が落ちたら judging を下げ、致命エラーを立てる', () => {
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId('judge-button'));
    mocks.handlers?.onError('回路を解けません', true);
    expect(useStore.getState().judging).toBe(false);
    expect(useStore.getState().fatalError).toContain('回路を解けません');
  });

  it('判定中はボタンが無効になり2回目を送らない', () => {
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId('judge-button'));
    // UXレビュー #5 / UI-03・UI-06: 判定ボタンも `aria-disabled` に揃えた（`disabled` ではない）
    expect(screen.getByTestId('judge-button')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('judge-button'));
    expect(sent.filter((c) => c['type'] === 'judgeParts')).toHaveLength(1);
  });

  it('結果画面が正解数・所要時間・危険操作を出す', () => {
    if (C1 === undefined) return;
    useStore.getState().setJudge(judgeResult({ hazardCount: 2 }));
    useStore.getState().setRoute('result');
    render(<>{renderRoute('result')}</>);
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.getByTestId('correct-count').textContent).toContain(
      `${String(C1.parts.length)} / ${String(C1.parts.length)}`,
    );
    expect(screen.getByTestId('result-elapsed').textContent).toContain('05:00.0');
  });

  it('「もう一度」でマークシート・点検中の部品・プローブが消えてセッションへ戻る', () => {
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    useStore.getState().setAnswer(first.id, 'a-weld');
    useStore.getState().setCheckPart(first.id);
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
    useStore.getState().setJudge(judgeResult());
    useStore.getState().setRoute('result');
    render(<>{renderRoute('result')}</>);
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.answers).toEqual([]);
    expect(state.checkPartId).toBeUndefined();
    expect(state.tester.black).toBeUndefined();
    expect(state.judge).toBeUndefined();
    expect(state.judging).toBe(false);
  });
});

describe('部品の挿し替え時にテスターの状態を読み直す（レビュー指摘 UI-01）', () => {
  it('Ωレンジ＋両プローブを置いた状態で部品を挿し替えても、外したはずの旧プローブを再送しない', () => {
    if (C1 === undefined) return;
    const first = C1.parts[0];
    const second = C1.parts[1];
    if (first === undefined || second === undefined) return;
    render(<InspectPartsSession />);
    act(() => {
      useStore.getState().setCheckPart(first.id);
    });
    act(() => {
      dispatchTester({ type: 'set-kind', kind: 'analog' });
      dispatchTester({ type: 'set-mode', mode: 'OHM' });
      dispatchTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
      dispatchTester({ type: 'place-probe', probe: 'red', terminal: toTerminalId('CHK.14') });
    });
    expect(useStore.getState().tester.black).toBeDefined();
    expect(useStore.getState().tester.red).toBeDefined();
    sent.length = 0;
    // Ωレンジのまま挿し替える。バグがあると外したはずの旧プローブが新しい盤へ再配置される
    act(() => {
      useStore.getState().setCheckPart(second.id);
    });
    expect(useStore.getState().tester.black).toBeUndefined();
    expect(useStore.getState().tester.red).toBeUndefined();
    const placeProbeSent = sent.some((c) => {
      const action = c['action'] as { type?: string } | undefined;
      return c['type'] === 'tester' && action?.type === 'place-probe';
    });
    expect(placeProbeSent).toBe(false);
  });
});

describe('C1 → 一覧 → モードB に持ち越さない', () => {
  it('ツールバーの「戻る」のあとモードBを開くと C1 の状態が残らない', () => {
    if (C1 === undefined || MODE_B === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    const view = render(<SessionRoute />);
    fireEvent.click(screen.getByTestId(`plug-${first.id}`));
    fireEvent.click(screen.getByTestId(`answer-${first.id}-b-weld`));
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
    fireEvent.click(screen.getByTestId('session-back'));
    expect(useStore.getState().route).toBe('list');
    // ここで C1 の状態はまだ残っている（課題を離れていないため）
    expect(useStore.getState().checkPartId).toBe(first.id);

    useStore.getState().openProblem(MODE_B);
    const state = useStore.getState();
    expect(state.answers).toEqual([]);
    expect(state.checkPartId).toBeUndefined();
    expect(state.tester.black).toBeUndefined();
    expect(state.mode).toBe('wire');
    view.rerender(<SessionRoute />);
    // モードBの画面に戻り、配線の道具が出る
    expect(screen.queryByTestId('mark-sheet')).toBeNull();
    expect(screen.getByRole('button', { name: '削除モード' })).toBeTruthy();
  });
});
