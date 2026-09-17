import { BUILTIN_INSPECT_PARTS_PROBLEMS } from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLoadFor, probeTargets } from '../src/renderer/session/inspect-parts.js';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * 部品を挿し替えたときに危険操作の記録が引き継がれるかを Worker で確かめる
 * （Opus レビュー Plan 2B Task 8-11、Blocking #1）。C1 は部品を1つずつ挿し替えて
 * 最後にまとめて判定するので、`load()` が `new Simulation()` を作り直しても
 * 前の部品で起きた危険操作を捨ててはいけない（§5.6 / §8.3）。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));
vi.setConfig({ testTimeout: 60_000 });

interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  send: (command: SimCommand) => void;
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
  Object.defineProperty(globalThis, 'self', { value: fakeSelf, configurable: true, writable: true });
  clock.nowMs = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs);
  vi.resetModules();
  await import('../src/worker/sim.worker.js');
  return {
    posted,
    get snapshots() {
      return posted.filter((m) => m.type === 'snapshot').map((m) => m.snapshot);
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('部品を挿し替えても危険操作の記録が消えない', () => {
  it('p1 で ohm-on-live を出し、p2 に替えてから判定しても回数が残る', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const [p1, p2] = problem.parts;
    if (p1 === undefined || p2 === undefined) return;
    const coil = probeTargets()[0];
    if (coil === undefined) return;

    const first = checkLoadFor(problem, p1.id);
    if (!first.ok) throw new Error('load できません');
    const h = await boot();
    h.send({
      type: 'load',
      problemId: problem.id,
      session: first.session,
      partFaults: first.partFaults,
    });
    h.advance(50);
    h.send({ type: 'breaker', on: true });
    h.send({ type: 'switch', on: true });
    h.advance(100);

    // 危険操作: 赤PBを押したままΩを当てる
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(120);
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    h.send({ type: 'tester', action: { type: 'place-probe', probe: 'black', terminal: coil.black } });
    h.send({ type: 'tester', action: { type: 'place-probe', probe: 'red', terminal: coil.red } });
    h.advance(120);
    const bannerCount = h.snapshots
      .flatMap((s) => s.hazardDelta)
      .filter((e) => e.kind === 'ohm-on-live').length;
    expect(bannerCount).toBe(1); // 画面の帯とミス回数はこの1件を数えている

    // 次の部品へ（renderer は checkLoadFor → load を送り直す）
    const second = checkLoadFor(problem, p2.id);
    if (!second.ok) throw new Error('load できません');
    h.send({
      type: 'load',
      problemId: problem.id,
      session: second.session,
      partFaults: second.partFaults,
    });
    h.advance(100);

    h.send({
      type: 'judgeParts',
      problem,
      answers: problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      elapsedMs: 60_000,
    });
    h.advance(50);
    const message = h.posted.find((m) => m.type === 'inspectResult');
    if (message === undefined || message.type !== 'inspectResult') throw new Error('結果なし');
    if (!message.result.ok) throw new Error('判定できず');
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.hazardCount).toBe(1);
  });
});
