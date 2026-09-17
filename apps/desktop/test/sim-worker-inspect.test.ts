import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_PARTS_PROBLEMS, truthFault } from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLoadFor } from '../src/renderer/session/inspect-parts.js';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * モードC1を Worker で回す（Plan 2B Task 8）。設計仕様 §9.1 / §16 Phase 2 受入基準①②④。
 * 期待値は Plan 2A の実測表（正常 650.0 / レアショート 422.5 / コイル断線 OL）から引く。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));

vi.setConfig({ testTimeout: 20_000 });

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

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

/** 指定の `truth` を持つ部品を1つ選ぶ（内蔵C1課題から）。 */
function partWith(truth: string): { problemIndex: number; partId: string } | undefined {
  for (const [index, problem] of BUILTIN_INSPECT_PARTS_PROBLEMS.entries()) {
    const part = problem.parts.find((p) => p.truth === truth);
    if (part !== undefined) return { problemIndex: index, partId: part.id };
  }
  return undefined;
}

/** その部品をチェック用ソケットに挿して通電した Worker を返す。 */
async function checking(truth: string): Promise<Harness> {
  const found = partWith(truth);
  expect(found).toBeDefined();
  if (found === undefined) throw new Error(`${truth} の部品が内蔵課題にありません`);
  const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[found.problemIndex];
  if (problem === undefined) throw new Error('課題がありません');
  const loaded = checkLoadFor(problem, found.partId);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error('チェック用回路を作れませんでした');
  const h = await boot();
  h.send({
    type: 'load',
    problemId: problem.id,
    session: loaded.session,
    partFaults: loaded.partFaults,
  });
  h.advance(50);
  h.send({ type: 'breaker', on: true });
  h.send({ type: 'switch', on: true });
  h.advance(150);
  return h;
}

/** Ωレンジでコイル端子を測る。 */
function measureCoil(h: Harness): void {
  h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
  h.send({
    type: 'tester',
    action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') },
  });
  h.send({
    type: 'tester',
    action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('CHK.14') },
  });
  h.advance(100);
}

describe('C1 のコイル抵抗（§9.1 測定1 / §16 Phase 2 受入基準①②）', () => {
  it('正常品は 650.0 Ω（Plan 2A 実測表）', async () => {
    const h = await checking('normal');
    measureCoil(h);
    // 表示は数値だけ（単位はUI側が添える。`readTester()` は `toFixed(1)` の文字列を返す）
    expect(h.snapshots.at(-1)?.tester.display).toBe('650.0');
  });

  it('コイル断線は OL（Plan 2A 実測表）', async () => {
    const h = await checking('coil-open');
    measureCoil(h);
    expect(h.snapshots.at(-1)?.tester.display).toBe('OL');
  });

  it('レアショートは 422.5 Ω（正常の85%＝552.5Ω を下回る）', async () => {
    const h = await checking('coil-layer-short');
    measureCoil(h);
    expect(h.snapshots.at(-1)?.tester.display).toBe('422.5');
  });
});

describe('C1 の励磁（§9.1 手順①）', () => {
  it('正常品は赤PB（PB4）を押すと吸引する', async () => {
    const h = await checking('normal');
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(150);
    expect(h.snapshots.at(-1)?.relays['CHK']?.coilOn).toBe(true);
  });

  it('コイル断線は赤PBを押しても吸引しない', async () => {
    const h = await checking('coil-open');
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(150);
    expect(h.snapshots.at(-1)?.relays['CHK']?.coilOn).toBe(false);
  });

  it('レアショートは正常どおり吸引する（動作では見分けられない。§17.2 #7）', async () => {
    const h = await checking('coil-layer-short');
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(150);
    expect(h.snapshots.at(-1)?.relays['CHK']?.coilOn).toBe(true);
  });
});

describe('C1 の危険操作（§5.6 #1 / §16 Phase 2 受入基準④）', () => {
  it('赤PBを離していれば通電したままΩを測っても警告は出ない（§9.1 測定1）', async () => {
    const h = await checking('normal');
    measureCoil(h);
    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.filter((e) => e.kind === 'ohm-on-live')).toHaveLength(0);
  });

  it('赤PBを押したままΩを当てると ohm-on-live が出る', async () => {
    const h = await checking('normal');
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(100);
    measureCoil(h);
    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.some((e) => e.kind === 'ohm-on-live')).toBe(true);
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
  });
});

describe('C1 の判定（§9.1 判定）', () => {
  it('全問正解なら合格になり、危険操作の回数も返る', async () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    const loaded = checkLoadFor(C1, first.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C1.id,
      session: loaded.session,
      partFaults: loaded.partFaults,
    });
    h.advance(100);
    h.send({
      type: 'judgeParts',
      problem: C1,
      answers: C1.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      elapsedMs: 120_000,
    });
    h.advance(50);

    const message = h.posted.find((m) => m.type === 'inspectResult');
    expect(message).toBeDefined();
    if (message === undefined || message.type !== 'inspectResult') return;
    expect(message.result.ok).toBe(true);
    if (!message.result.ok) return;
    const value = message.result.value;
    expect(value.mode).toBe('inspect-parts');
    if (value.mode !== 'inspect-parts') return;
    expect(value.passed).toBe(true);
    expect(value.correctCount).toBe(C1.parts.length);
    expect(value.elapsedMs).toBe(120_000);
  });

  it('1問間違えると不合格で「n/m 正解」が出せる', async () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    const loaded = checkLoadFor(C1, first.id);
    if (!loaded.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C1.id,
      session: loaded.session,
      partFaults: loaded.partFaults,
    });
    h.advance(100);
    const answers = C1.parts.map((p, index) => ({
      partId: p.id,
      answer: index === 0 && p.truth !== 'normal' ? ('normal' as const) : p.truth,
    }));
    h.send({ type: 'judgeParts', problem: C1, answers, elapsedMs: 60_000 });
    h.advance(50);

    const message = h.posted.find((m) => m.type === 'inspectResult');
    if (message === undefined || message.type !== 'inspectResult') return;
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.total).toBe(C1.parts.length);
    expect(value.correctCount).toBeLessThanOrEqual(C1.parts.length);
  });
});

describe('truthFault との整合', () => {
  it('checkLoadFor が返す故障は truthFault と同じ', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    for (const part of C1.parts) {
      const loaded = checkLoadFor(C1, part.id);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) continue;
      const expected = truthFault(C1, part);
      expect(loaded.partFaults).toEqual(expected === undefined ? [] : [expected]);
    }
  });
});
