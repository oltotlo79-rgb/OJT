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

/**
 * 実測（`stepTester()` / `readTester()`）を呼んだ回数。前提Dの間引きを固定するために数える。
 * 本物をそのまま呼ぶ薄い包みなので、他のテストの挙動は変わらない。
 */
const measured = vi.hoisted(() => ({ step: 0, read: 0 }));

vi.mock('@ojt/circuit-sim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ojt/circuit-sim')>();
  return {
    ...actual,
    stepTester: (...args: Parameters<typeof actual.stepTester>) => {
      measured.step += 1;
      return actual.stepTester(...args);
    },
    readTester: (...args: Parameters<typeof actual.readTester>) => {
      measured.read += 1;
      return actual.readTester(...args);
    },
  };
});

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
  measured.step = 0;
  measured.read = 0;
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

describe('測れないときのスナップショット（Plan 2B Batch 1 レビュー）', () => {
  it('プローブを置かずに種別とレンジを回すと、いまのつまみの位置がそのまま出る', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-kind', kind: 'analog' } });
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.advance(100);

    const tester = h.snapshots.at(-1)?.tester;
    expect(tester?.kind).toBe('analog');
    expect(tester?.mode).toBe('DCV');
    expect(tester?.display).toBe('----');
  });

  it('測ったあとにレンジを回してプローブを外すと、外したあとも新しいレンジが出る', async () => {
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
    expect(h.snapshots.at(-1)?.tester.mode).toBe('DCV');

    // 実測を挟まずにΩへ回し、赤プローブを離す（測れなくなる）
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: undefined },
    });
    h.advance(100);

    expect(h.snapshots.at(-1)?.tester.mode).toBe('OHM');
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
  });
});

describe('実測の間引き（§9.3 前提D）', () => {
  it('つまみOFFのままなら1秒回しても1度も測らない', async () => {
    const h = await powered();
    measured.step = 0;
    measured.read = 0;
    h.advance(1000);
    expect(measured.step + measured.read).toBe(0);
  });

  it('プローブが片方だけなら1秒回しても1度も測らない', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.advance(100);
    measured.step = 0;
    measured.read = 0;
    h.advance(1000);
    expect(measured.step + measured.read).toBe(0);
  });

  it('両プローブ・アナログDCVでも1秒あたり30回までしか測らない', async () => {
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
    h.advance(100);
    measured.step = 0;
    measured.read = 0;
    h.advance(1000);

    // 毎tick（100回）ではなくスナップショット間隔（33ms）ごと
    expect(measured.step).toBeGreaterThan(0);
    expect(measured.step + measured.read).toBeLessThanOrEqual(30);
  });

  it('知らないテスター操作は無視してスナップショットを流し続ける', async () => {
    const h = await powered();
    const before = h.snapshots.length;
    h.send({ type: 'tester', action: { type: 'set-bogus' } } as unknown as SimCommand);
    h.advance(200);

    expect(h.errors).toEqual([]);
    expect(h.snapshots.length).toBeGreaterThan(before);
  });
});

describe('0Ω調整の保持（§9.3 / Plan 2B Batch 1 レビュー）', () => {
  /** コイル（CR1.13 − CR1.14）にプローブを当てる。 */
  function probeCoil(h: Harness): void {
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('CR1.13') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('CR1.14') },
    });
  }

  it('課題を読み込み直しても0Ω調整はやり直さなくてよい（§9.1 部品の挿し替え）', async () => {
    const h = await boot();
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    // 0Ω調整の誤差（+5%）が読値に乗るのはアナログのΩレンジ（§9.3）
    h.send({ type: 'tester', action: { type: 'set-kind', kind: 'analog' } });
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    probeCoil(h);
    h.advance(100);
    const raw = h.snapshots.at(-1)?.tester.value ?? 0;
    expect(raw).toBeGreaterThan(0);

    // 0Ω調整をすると +5% の誤差が消える（§9.3）
    h.send({ type: 'tester', action: { type: 'zero-adjust' } });
    h.advance(100);
    const adjusted = h.snapshots.at(-1)?.tester.value ?? 0;
    expect(adjusted).toBeLessThan(raw);

    // 盤を作り直す（C1は部品を挿し替えるたびに `load` が飛ぶ）。プローブは外れるが校正は残る
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    probeCoil(h);
    h.advance(100);

    expect(h.snapshots.at(-1)?.tester.value).toBeCloseTo(adjusted, 6);
    expect(h.errors).toEqual([]);
  });
});
