import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { JIPM_BOARD, removeWire, type BoardSession } from '@ojt/board-model';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  buildReferenceSession,
  judgeAssembleLab,
  type AssembleLabProblem,
} from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { resultReportHtml } from '../src/renderer/result/report-html.js';
import { Result } from '../src/renderer/screens/Result.js';
import { currentLabProblem, newLabProblem } from '../src/renderer/session/lab.js';
import { stopReplay } from '../src/renderer/session/replay.js';

/**
 * 回路実験・PLC実験の結果画面（2026-10-08）。見比べる相手は描いた正解。設計 §6.4
 */
const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', defaultVendor: 'mitsubishi', dialectId: 'mitsubishi' });
  bridgeMock.sent.length = 0;
});

afterEach(() => {
  cleanup();
});

function referenceBoard(): BoardSession {
  const built = buildReferenceSession(BUILTIN_ASSEMBLE_PROBLEMS[0]!, JIPM_BOARD);
  if (!built.ok) throw new Error('reference');
  return built.value.session;
}

/** 自己保持の例題を開き、盤で判定した結果を入れて結果画面にする。 */
function judged(mutate: (session: BoardSession) => void = () => undefined): void {
  useStore.getState().openProblem(
    newLabProblem('assemble-lab', {
      vendor: 'mitsubishi',
      prewired: true,
      templateId: 'self-hold',
    }),
  );
  const session = referenceBoard();
  mutate(session);
  useStore.getState().setSession(session);
  const outcome = judgeAssembleLab(currentLabProblem() as AssembleLabProblem, JIPM_BOARD, session, {
    elapsedMs: 42_000,
  });
  if (!outcome.ok) throw new Error('judge');
  useStore.setState({ judge: outcome.value, route: 'result' });
}

describe('実験の結果画面', () => {
  it('合格: 描いた正解と動かした結果を重ねて見せる', () => {
    judged();
    render(<Result />);
    expect(screen.getByTestId('verdict')).toHaveTextContent('合格');
    expect(screen.getByTestId('lab-why-passed')).toHaveTextContent('描いた正解どおり');
    expect(
      screen.getByText('チャート重ね表示（薄色＝描いた正解／濃色＝動かした結果）'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('動かした結果（太い線）');
    // 結果画面の上の帯（見直し・見くらべ・書き出し）も使える
    expect(screen.getByTestId('replay-open')).toBeInTheDocument();
    expect(screen.getByTestId('compare-open')).toBeInTheDocument();
    expect(screen.getByTestId('result-export')).toBeInTheDocument();
  });

  it('不合格: 理由と違いの一覧を出す', () => {
    judged((session) => {
      const wire = session.wires.find((candidate) => !candidate.locked);
      if (wire === undefined) throw new Error('wire');
      removeWire(session, wire.id);
    });
    render(<Result />);
    expect(screen.getByTestId('verdict')).toHaveTextContent('不合格');
    expect(screen.getByTestId('lab-why').querySelectorAll('li').length).toBeGreaterThan(0);
  });

  it('「もう一度」は盤を作り直し、描いたタイムチャートは残す', () => {
    judged();
    const expected = currentLabProblem()?.expected;
    render(<Result />);
    fireEvent.click(screen.getByText('もう一度'));
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.session?.wires).toEqual([]);
    expect(currentLabProblem()?.expected).toEqual(expected);
  });

  it('戻るとホームへ', () => {
    judged();
    render(<Result />);
    fireEvent.click(screen.getByText('ホームへ戻る'));
    expect(useStore.getState().route).toBe('home');
  });

  it('見直しは結果画面から始めて、終えたら結果画面へ戻る', () => {
    judged();
    render(<Result />);
    fireEvent.click(screen.getByTestId('replay-open'));
    expect(useStore.getState().replay?.source.mode).toBe('assemble-lab');
    expect(useStore.getState().replay?.returnTo).toBe('result');
    stopReplay();
    expect(useStore.getState().route).toBe('result');
  });

  it('書き出しの1枚に実験のモード名と合否が入る', () => {
    judged();
    const state = useStore.getState();
    const html = resultReportHtml({
      problem: state.problem!,
      result: state.judge!,
      sessionOpenedAtMs: 0,
      restoredHazardCount: 0,
      hintStage: 0,
      schematicOpenCount: 0,
    });
    expect(html).toContain('回路実験');
    expect(html).toContain('合格');
  });
});
