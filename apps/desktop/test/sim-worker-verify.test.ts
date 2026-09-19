import { JIPM_BOARD } from '@ojt/board-model';
import type { BoardSession } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS, buildReferenceSession } from '@ojt/content';
import type * as Content from '@ojt/content';
import { emptySchematic } from '@ojt/schematic-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * 検算コマンド（`verify`）のテスト（§11.4 / Plan 5 決定表#4）。
 *
 * 定型（偽の `self`・偽の時計・追従ループの手回し）は `sim-worker.test.ts` から写している。
 * `verifySchematic` は差し替えて「検算に掛かった実時間」を模す（模範＋訓練者の2回ぶんで
 * 0.3〜0.6 秒かかる）。ここを模さないと「検算中は追従ループを止める」効き目が測れない。
 */

/** 偽の時計と、検算1回が食う実時間[ms]。`vi.mock` の工場から触るので hoisted に置く。 */
const clock = vi.hoisted(() => ({ nowMs: 0, verifyCostMs: 0 }));

vi.mock('@ojt/content', async (importOriginal) => {
  const actual = await importOriginal<typeof Content>();
  return {
    ...actual,
    verifySchematic: ((...args: Parameters<typeof actual.verifySchematic>) => {
      clock.nowMs += clock.verifyCostMs;
      return actual.verifySchematic(...args);
    }) as typeof actual.verifySchematic,
  };
});

// 既定の5秒だと並列実行時の負荷でまれに超過する（既知のflake）。このファイルだけ延ばす。
vi.setConfig({ testTimeout: 15_000 });

const B001 = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (B001 === undefined) throw new Error('b-001 が見つかりません');
const problem = B001;

/** b-001 の模範回路のセッション（配線も部品も揃った状態）。 */
function referenceSession(): BoardSession {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路を作れませんでした');
  return built.value.session;
}

/** 偽 `self` で動かした Worker を操作する道具一式。 */
interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  errors: Array<Extract<SimMessage, { type: 'error' }>>;
  verifyResults: Array<Extract<SimMessage, { type: 'verifyResult' }>>;
  send: (command: SimCommand) => void;
  /** 実時間とタイマを `stepMs` 刻みで進める。 */
  advance: (ms: number, stepMs?: number) => void;
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
  clock.verifyCostMs = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs);
  vi.resetModules();
  await import('../src/worker/sim.worker.js');
  return {
    posted,
    get snapshots() {
      return posted.filter((m) => m.type === 'snapshot').map((m) => m.snapshot);
    },
    get errors() {
      return posted.filter((m) => m.type === 'error');
    },
    get verifyResults() {
      return posted.filter((m) => m.type === 'verifyResult');
    },
    send: (command) => {
      fakeSelf.onmessage({ data: command });
    },
    advance: (ms, stepMs = 4) => {
      let left = ms;
      while (left > 0) {
        const chunk = Math.min(stepMs, left);
        clock.nowMs += chunk;
        vi.advanceTimersByTime(chunk);
        left -= chunk;
      }
    },
  };
}

/** 課題を読ませて追従ループを回し始める。 */
async function loaded(): Promise<Harness> {
  const h = await boot();
  h.send({ type: 'load', problemId: problem.id, session: referenceSession() });
  h.advance(100);
  return h;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('verify コマンド（§11.4 / Plan 5 決定表#4）', () => {
  it('returns a passing result for the reference drawing of the problem', async () => {
    const h = await loaded();
    h.send({ type: 'verify', problem, document: problem.schematic, elapsedMs: 0 });
    const message = h.verifyResults[0];
    expect(message?.result.ok).toBe(true);
    expect(message?.result.ok === true && message.result.passed).toBe(true);
    expect(h.errors).toEqual([]);
  });

  it('returns ok:false with the document issues for a half-finished drawing', async () => {
    const h = await loaded();
    h.send({
      type: 'verify',
      problem,
      document: emptySchematic('draft', '下書き'),
      elapsedMs: 0,
    });
    const message = h.verifyResults[0];
    expect(message?.result.ok).toBe(false);
    expect(message?.result.ok === false && message.result.errors.map((e) => e.message)).toContain(
      '段に要素がありません: r1',
    );
  });

  it('does not disturb the running simulation (tMs keeps advancing afterwards)', async () => {
    const h = await loaded();
    h.send({ type: 'breaker', on: true });
    h.send({ type: 'switch', on: true });
    h.advance(100);
    const before = h.snapshots.at(-1)?.tMs ?? 0;
    // 検算は 0.3〜0.6 秒かかる。その間ループを止めないと「捨てた tick」が計上される
    clock.verifyCostMs = 400;
    h.send({ type: 'verify', problem, document: problem.schematic, elapsedMs: 0 });
    h.advance(200);
    const after = h.snapshots.at(-1);
    expect(after?.tMs ?? 0).toBeGreaterThan(before);
    expect(after?.droppedTicks).toBe(0);
  });

  it('reports a broken command as { type: "error", fatal: false } instead of dying', async () => {
    const h = await loaded();
    const before = h.snapshots.length;
    h.send({ type: 'verify', problem, document: undefined as never, elapsedMs: 0 });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.fatal).toBe(false);
    h.advance(100);
    expect(h.snapshots.length).toBeGreaterThan(before);
  });
});
