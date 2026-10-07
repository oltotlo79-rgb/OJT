import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  buildReferenceSession,
  judgeAssembleLab,
  type AssembleLabProblem,
  type LabJudgeOutcome,
} from '@ojt/content';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import {
  acceptLabResult,
  currentLabProblem,
  editLab,
  newLabProblem,
  requestLabRun,
} from '../src/renderer/session/lab.js';
import { startReplay, stopReplay } from '../src/renderer/session/replay.js';

/**
 * 実験の「動かす」「判定」「盤で動きを見る」をストアとワーカーの間で回す（2026-10-08）。
 */
const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', defaultVendor: 'mitsubishi', dialectId: 'mitsubishi' });
  bridgeMock.sent.length = 0;
});

/** 自己保持の例題を開き、模範回路の盤にしておく。 */
function openSelfHold(): AssembleLabProblem {
  useStore.getState().openProblem(
    newLabProblem('assemble-lab', {
      vendor: 'mitsubishi',
      prewired: true,
      templateId: 'self-hold',
    }),
  );
  const reference = buildReferenceSession(BUILTIN_ASSEMBLE_PROBLEMS[0]!, JIPM_BOARD);
  if (!reference.ok) throw new Error('reference');
  useStore.getState().setSession(reference.value.session);
  return currentLabProblem() as AssembleLabProblem;
}

/** ワーカーの代わりに判定して、結果の知らせを作る。 */
function workerResult(problem: AssembleLabProblem, judge: boolean) {
  const result: LabJudgeOutcome = judgeAssembleLab(
    problem,
    JIPM_BOARD,
    useStore.getState().session!,
  );
  return { type: 'labResult' as const, judge, result };
}

describe('動かす・判定', () => {
  it('「動かす」はワーカーへ頼み、届いた結果を実験の欄に入れる（結果画面へは進まない）', () => {
    const problem = openSelfHold();
    expect(requestLabRun(false)).toBe(true);
    const sent = bridgeMock.sent.at(-1);
    expect(sent?.['type']).toBe('labRun');
    expect(sent?.['judge']).toBe(false);
    expect(useStore.getState().labRunning).toBe(true);
    // 往復中は二重に頼めない
    expect(requestLabRun(false)).toBe(false);
    acceptLabResult(workerResult(problem, false));
    const state = useStore.getState();
    expect(state.labRunning).toBe(false);
    expect(state.labRun?.passed).toBe(true);
    expect(state.judge).toBeUndefined();
    expect(state.route).toBe('session');
  });

  it('「判定」は正解が無いと頼めず、正解があれば結果画面へ進む', () => {
    useStore
      .getState()
      .openProblem(newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true }));
    expect(requestLabRun(true)).toBe(false);
    expect(useStore.getState().toasts.at(-1)?.text).toBe('正解のランプの動きを描くと判定できます');
    expect(bridgeMock.sent.filter((c) => c['type'] === 'labRun')).toHaveLength(0);

    const problem = openSelfHold();
    expect(requestLabRun(true)).toBe(true);
    expect(useStore.getState().judging).toBe(true);
    acceptLabResult(workerResult(problem, true));
    const state = useStore.getState();
    expect(state.judging).toBe(false);
    expect(state.route).toBe('result');
    expect(state.judge?.mode).toBe('assemble-lab');
    expect(state.judge?.passed).toBe(true);
  });

  it('動かしている間に押し方を描き直したら、届いた結果は使わない', () => {
    const problem = openSelfHold();
    expect(requestLabRun(false)).toBe(true);
    expect(editLab((current) => ({ ...current, durationMs: 6_000 }))).toBe(true);
    acceptLabResult(workerResult(problem, false));
    expect(useStore.getState().labRun).toBeUndefined();
    expect(useStore.getState().toasts.at(-1)?.text).toContain('描き直した');
  });

  it('PLC実験は変換を通したラダーが無いと動かさない（理由を出す）', () => {
    useStore
      .getState()
      .openProblem(newLabProblem('plc-lab', { vendor: 'mitsubishi', prewired: true }));
    useStore.setState({ converted: false });
    expect(requestLabRun(false)).toBe(false);
    expect(useStore.getState().toasts.at(-1)?.text).toContain('変換');
    expect(bridgeMock.sent.filter((c) => c['type'] === 'labRun')).toHaveLength(0);
    useStore.setState({ converted: true });
    expect(requestLabRun(false)).toBe(true);
    expect(bridgeMock.sent.at(-1)?.['ladder']).toEqual(useStore.getState().ladder);
  });
});

describe('盤で動きを見る', () => {
  it('最後に動かした結果から見直し、終えたら練習の画面へ戻る', () => {
    const problem = openSelfHold();
    expect(startReplay('lab')).toBe(false);
    requestLabRun(false);
    acceptLabResult(workerResult(problem, false));
    expect(startReplay('lab')).toBe(true);
    const replay = useStore.getState().replay;
    expect(replay?.source.mode).toBe('assemble-lab');
    expect(replay?.returnTo).toBe('session');
    expect(replay?.steps.length).toBeGreaterThan(1);
    stopReplay();
    expect(useStore.getState().replay).toBeUndefined();
    expect(useStore.getState().route).toBe('session');
  });
});
