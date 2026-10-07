import { JIPM_BOARD, type BoardSession } from '@ojt/board-model';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildPrewiredPlcSession,
  buildReferenceSession,
  createAssembleLabProblem,
  createPlcLabProblem,
  findLabTemplate,
  isPlcProblem,
  type LabTemplate,
} from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand, SimMessage } from '../src/worker/protocol.js';

/**
 * 回路実験・PLC実験をワーカーで動かす（2026-10-08）。偽の `self` を置いてモジュールとして
 * 動かす流儀は `sim-worker-plc.test.ts` と同じ。
 */
const clock = vi.hoisted(() => ({ nowMs: 0 }));
vi.setConfig({ testTimeout: 20_000 });

interface Harness {
  posted: SimMessage[];
  send: (command: SimCommand) => void;
  advance: (ms: number) => void;
}

async function boot(): Promise<Harness> {
  const posted: SimMessage[] = [];
  const fakeSelf = {
    postMessage: (message: SimMessage) => {
      posted.push(message);
    },
    onmessage: undefined as unknown as (event: { data: SimCommand }) => void,
  };
  Object.defineProperty(globalThis, 'self', {
    value: fakeSelf,
    configurable: true,
    writable: true,
  });
  clock.nowMs = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs);
  vi.resetModules();
  await import('../src/worker/sim.worker.js');
  return {
    posted,
    send: (command) => {
      fakeSelf.onmessage({ data: command });
    },
    advance: (ms) => {
      for (let left = ms; left > 0; left -= 4) {
        clock.nowMs += 4;
        vi.advanceTimersByTime(4);
      }
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function template(mode: 'assemble-lab' | 'plc-lab', id: string): LabTemplate {
  const found = findLabTemplate(mode, id);
  if (found === undefined) throw new Error(id);
  return found;
}

function assembleReference(): BoardSession {
  const built = buildReferenceSession(BUILTIN_ASSEMBLE_PROBLEMS[0]!, JIPM_BOARD);
  if (!built.ok) throw new Error('reference');
  return built.value.session;
}

function labResults(h: Harness): Array<Extract<SimMessage, { type: 'labResult' }>> {
  return h.posted.filter((message) => message.type === 'labResult');
}

describe('実験をワーカーで動かす', () => {
  it('回路実験: 「動かす」は判定の印を付けずに結果を返し、ライブの盤はそのまま回る', async () => {
    const h = await boot();
    const session = assembleReference();
    h.send({ type: 'load', problemId: 'lab-assemble', session });
    h.advance(100);
    const before = h.posted.length;
    h.send({
      type: 'labRun',
      problem: createAssembleLabProblem(template('assemble-lab', 'self-hold')),
      session,
      elapsedMs: 5_000,
      judge: false,
    });
    const [message] = labResults(h);
    expect(message?.judge).toBe(false);
    expect(message?.result.ok).toBe(true);
    if (message === undefined || !message.result.ok) return;
    expect(message.result.value.mode).toBe('assemble-lab');
    expect(message.result.value.passed).toBe(true);
    expect(message.result.value.elapsedMs).toBe(5_000);
    h.advance(100);
    expect(h.posted.filter((m) => m.type === 'snapshot').length).toBeGreaterThan(0);
    expect(h.posted.length).toBeGreaterThan(before + 1);
    expect(h.posted.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('PLC実験: 配線済みの盤と元の課題の模範ラダーで「判定」が合格する', async () => {
    const h = await boot();
    const problem = createPlcLabProblem({
      vendor: 'mitsubishi',
      prewired: true,
      ...template('plc-lab', 'self-hold'),
    });
    const prewired = buildPrewiredPlcSession(problem, JIPM_BOARD);
    if (!prewired.ok) throw new Error('prewired');
    const source = BUILTIN_PLC_PROBLEMS.find((p) => p.id === 'd-001');
    if (source === undefined || !isPlcProblem(source)) throw new Error('d-001');
    h.send({ type: 'load', problemId: problem.id, session: prewired.value, plcModel: 'FX5U' });
    h.send({
      type: 'labRun',
      problem,
      session: prewired.value,
      ladder: source.referenceLadder,
      elapsedMs: 0,
      judge: true,
    });
    const [message] = labResults(h);
    expect(message?.judge).toBe(true);
    expect(message?.result.ok && message.result.value.passed).toBe(true);
  });

  it('PLC実験: ラダーを添えないと動かせない（エラーを返してループは止めない）', async () => {
    const h = await boot();
    const problem = createPlcLabProblem({ vendor: 'mitsubishi', prewired: true });
    const prewired = buildPrewiredPlcSession(problem, JIPM_BOARD);
    if (!prewired.ok) throw new Error('prewired');
    h.send({ type: 'load', problemId: problem.id, session: prewired.value, plcModel: 'FX5U' });
    h.send({ type: 'labRun', problem, session: prewired.value, elapsedMs: 0, judge: false });
    expect(labResults(h)).toEqual([]);
    const errors = h.posted.filter((m) => m.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type === 'error' && errors[0].fatal).toBe(false);
  });

  it('見直し: 実験の盤とラダーを区間ごとに再生できる', async () => {
    const h = await boot();
    const problem = createPlcLabProblem({
      vendor: 'omron',
      prewired: true,
      ...template('plc-lab', 'self-hold'),
    });
    const prewired = buildPrewiredPlcSession(problem, JIPM_BOARD);
    if (!prewired.ok) throw new Error('prewired');
    const source = BUILTIN_PLC_PROBLEMS.find((p) => p.id === 'd-001');
    if (source === undefined || !isPlcProblem(source)) throw new Error('d-001');
    h.send({ type: 'load', problemId: problem.id, session: prewired.value, plcModel: 'CP1E' });
    h.send({
      type: 'replay',
      action: 'start',
      source: { mode: 'plc-lab', problem, session: prewired.value, ladder: source.referenceLadder },
    });
    h.send({ type: 'replay', action: 'step', index: 1 });
    const frames = h.posted.filter((m) => m.type === 'replayFrame');
    expect(frames).toHaveLength(2);
    // 2つ目の区間（PB1を押した直後）で運転灯が点いている
    expect(frames[1]?.type === 'replayFrame' && frames[1].snapshot.lamps['PL1']?.level).toBe('lit');
  });

  it('回路実験の見直しも同じ盤で再生する', async () => {
    const h = await boot();
    const session = assembleReference();
    h.send({ type: 'load', problemId: 'lab-assemble', session });
    h.send({
      type: 'replay',
      action: 'start',
      source: {
        mode: 'assemble-lab',
        problem: createAssembleLabProblem(template('assemble-lab', 'self-hold')),
        session,
      },
    });
    expect(h.posted.filter((m) => m.type === 'replayFrame')).toHaveLength(1);
    expect(h.posted.filter((m) => m.type === 'error')).toEqual([]);
  });
});
