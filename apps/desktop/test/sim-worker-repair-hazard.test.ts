import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS, buildInspectRepairCircuit } from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloneSession } from '../src/renderer/session/commands.js';
import { circuitForJudge } from '../src/renderer/session/inspect-repair.js';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * 危険操作（`ohm-on-live`）が C2 の判定で1回だけ数えられるか。§5.6 / §9.2 判定④
 * 元に戻す（`load` の送り直し）をまたいでも落ちず・二重に数えないことを確かめる
 * （Plan 2B レビュー: `restore()` が `load` を送り直すたびに Worker 側が危険操作の
 * カウントを失っていないかは、実際に Worker を回さないと確かめられない）。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));

interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  send: (c: SimCommand) => void;
  advance: (ms: number) => void;
}

async function boot(): Promise<Harness> {
  const posted: SimMessage[] = [];
  const fakeSelf = {
    postMessage: (m: SimMessage) => {
      posted.push(m);
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
    get snapshots() {
      return posted.filter((m) => m.type === 'snapshot').map((m) => m.snapshot);
    },
    send: (c) => {
      fakeSelf.onmessage({ data: c });
    },
    advance: (ms) => {
      let left = ms;
      while (left > 0) {
        const chunk = Math.min(4, left);
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

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === 'c2-001');

describe('ohm-on-live in mode C2', () => {
  it('通電中にΩを当てると1回だけ数える／元に戻し（load）をまたいでも残る', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD, { seed: 7 });
    if (!built.ok) return;
    const h = await boot();
    const load = (): void => {
      h.send({
        type: 'load',
        problemId: C2.id,
        session: cloneSession(built.value.session),
        partFaults: built.value.applied.partFaults,
      });
    };
    load();
    h.advance(40);
    h.send({ type: 'breaker', on: true });
    h.send({ type: 'switch', on: true });
    h.advance(100);
    // P（+24V）と N（0V）の間にΩを当てる＝通電中のΩ測定（§5.6 #1）
    h.send({ type: 'tester', action: { type: 'set-kind', kind: 'digital' } });
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('P.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('N.1') },
    });
    h.advance(300);
    const hazardsAfterMeasure = h.posted
      .filter((m) => m.type === 'snapshot')
      .flatMap((m) => m.snapshot.hazardDelta);
    const ohmLive = hazardsAfterMeasure.filter((x) => x.kind === 'ohm-on-live');
    expect(ohmLive.length, 'ohm-on-live should be reported once per probe placement').toBe(1);

    // 元に戻す＝`load` を送り直す。これで危険操作が消えないこと（carriedHazards）
    load();
    h.advance(100);
    h.send({
      type: 'judgeRepair',
      problem: C2,
      circuit: circuitForJudge(built.value, cloneSession(built.value.session)),
      reports: [],
      elapsedMs: 60_000,
    });
    h.advance(50);
    const message = h.posted.filter((m) => m.type === 'inspectResult').at(-1);
    expect(message).toBeDefined();
    if (message === undefined || !message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-repair') return;
    expect(value.hazardsByKind['ohm-on-live'], 'hazard must survive the reload exactly once').toBe(
      1,
    );
  });
});
