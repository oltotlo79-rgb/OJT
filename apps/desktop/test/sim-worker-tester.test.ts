import { JIPM_BOARD } from '@ojt/board-model';
import type { BoardSession } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_PROBLEMS, buildReferenceSession } from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * Worker のテスター（Plan 2B Task 3）。設計仕様 §9.3 / §5.5 / §5.6 #1 / §5.6 #2。
 * `sim-worker.test.ts` と同じ「偽の `self`」方式で、Worker を起こさず素のモジュールとして回す。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));

vi.setConfig({ testTimeout: 15_000 });

const B001 = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');

function referenceSession(): BoardSession {
  if (B001 === undefined) throw new Error('b-001 が見つかりません');
  const built = buildReferenceSession(B001, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路を作れませんでした');
  return built.value.session;
}

interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  errors: Array<Extract<SimMessage, { type: 'error' }>>;
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
    get errors() {
      return posted.filter((m) => m.type === 'error');
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

/** 通電した b-001 の盤で1周ぶん進めて最後のスナップショットを得る。 */
async function powered(): Promise<Harness> {
  const h = await boot();
  h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
  h.advance(100);
  h.send({ type: 'breaker', on: true });
  h.send({ type: 'switch', on: true });
  h.advance(200);
  return h;
}

describe('テスターのスナップショット（§9.3）', () => {
  it('つまみOFFのときは OFF を出す', async () => {
    const h = await powered();
    expect(h.snapshots.at(-1)?.tester.display).toBe('OFF');
    expect(h.snapshots.at(-1)?.tester.mode).toBe('off');
  });

  it('DCVでプローブが片方だけなら ---- を出す', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.advance(100);
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
  });

  it('DCVで母線間を測ると 24.00 V になる（§5.5）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    h.advance(100);
    expect(h.snapshots.at(-1)?.tester.display).toBe('24.00 V');
    expect(h.snapshots.at(-1)?.tester.value).toBeCloseTo(24, 1);
  });

  it('アナログで 2.5V レンジに 24V を当てると range-exceeded が1回だけ出る（§5.6 #2）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-kind', kind: 'analog' } });
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({ type: 'tester', action: { type: 'set-volt-range', range: 2.5 } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    h.advance(400);

    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.filter((e) => e.kind === 'range-exceeded')).toHaveLength(1);
    expect(h.snapshots.at(-1)?.tester.overRange).toBe(true);
    // 振り切れているのでフルスケール（90度）へ寄っていく
    expect(h.snapshots.at(-1)?.tester.needleDeg).toBeGreaterThan(80);
  });

  it('アナログ針は目標角度へ徐々に寄る（時定数100ms。§9.3）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-kind', kind: 'analog' } });
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({ type: 'tester', action: { type: 'set-volt-range', range: 250 } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    // 24V / 250V レンジ → 目標は 90 × 24/250 = 8.64 度
    h.advance(40);
    const early = h.snapshots.at(-1)?.tester.needleDeg ?? 0;
    h.advance(600);
    const settled = h.snapshots.at(-1)?.tester.needleDeg ?? 0;
    expect(early).toBeLessThan(settled);
    expect(settled).toBeGreaterThan(8);
    expect(settled).toBeLessThan(8.7);
  });

  it('通電中にΩレンジを当てると ohm-on-live が出て ---- になる（§5.6 #1）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    h.advance(100);
    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.some((e) => e.kind === 'ohm-on-live')).toBe(true);
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
    expect(h.snapshots.at(-1)?.tester.live).toBe(true);
  });

  it('課題を読み込み直すとプローブは外れるが、つまみの位置は残る（§9.1 部品の挿し替え）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    h.advance(100);
    expect(h.snapshots.at(-1)?.tester.display).toBe('24.00 V');

    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    // つまみは DCV のまま、プローブだけ外れて `----` になる
    expect(h.snapshots.at(-1)?.tester.mode).toBe('DCV');
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
    expect(h.errors).toEqual([]);
  });
});
