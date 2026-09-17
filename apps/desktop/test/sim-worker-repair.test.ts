import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildInspectRepairCircuit,
  replacePart,
  type RepairCircuit,
} from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { circuitForJudge } from '../src/renderer/session/inspect-repair.js';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * モードC2を Worker で判定する（Plan 2B Task 12）。設計仕様 §9.2 / §16 Phase 2 受入基準③。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));

vi.setConfig({ testTimeout: 30_000 });

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];

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

describe('C2 の盤（§9.2）', () => {
  it('故障入りの盤を load できて回り続ける', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2.id,
      session: built.value.session,
      partFaults: built.value.applied.partFaults,
    });
    h.advance(100);
    h.send({ type: 'breaker', on: true });
    h.send({ type: 'switch', on: true });
    h.advance(200);
    expect(h.snapshots.at(-1)?.powered).toBe(true);
    expect(h.posted.filter((m) => m.type === 'error')).toEqual([]);
  });
});

describe('C2 の部品交換（§9.2 / Plan 2B Task 12 (e)）', () => {
  /** コイル断線のリレーを持つ内蔵C2課題を1つ選ぶ。 */
  function coilOpenRelay(): { circuit: RepairCircuit; problemId: string; partId: string } {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
      if (!built.ok) continue;
      for (const spec of built.value.applied.partFaults) {
        if (spec.kind !== 'coil-open' || !('partId' in spec.target)) continue;
        if (!spec.target.partId.startsWith('CR')) continue;
        return { circuit: built.value, problemId: problem.id, partId: spec.target.partId };
      }
    }
    throw new Error('コイル断線のリレーを持つ内蔵C2課題がありません');
  }

  /** そのリレーのコイル端子をΩレンジで測る（無通電）。 */
  function measureCoil(h: Harness, partId: string): void {
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId(`${partId}.13`) },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId(`${partId}.14`) },
    });
    h.advance(100);
  }

  it('交換した部品は良品として測れる（故障は load のたびに入れ直す）', async () => {
    const { circuit, problemId, partId } = coilOpenRelay();
    const faulted = await boot();
    faulted.send({
      type: 'load',
      problemId,
      session: circuit.session,
      partFaults: circuit.applied.partFaults,
    });
    faulted.advance(50);
    measureCoil(faulted, partId);
    expect(faulted.snapshots.at(-1)?.tester.display).toBe('OL');

    // 3Dで抜いて挿し直す＝renderer 側は `replacePart()` で故障を落とし、`load` を送り直す
    const replaced = replacePart(circuit, partId);
    expect(replaced.applied.partFaults).toHaveLength(circuit.applied.partFaults.length - 1);
    const healthy = await boot();
    healthy.send({
      type: 'load',
      problemId,
      session: replaced.session,
      partFaults: replaced.applied.partFaults,
    });
    healthy.advance(50);
    measureCoil(healthy, partId);
    expect(healthy.snapshots.at(-1)?.tester.display).not.toBe('OL');
  });
});

describe('C2 の判定（§9.2 / §16 Phase 2 受入基準③）', () => {
  it('修復も指摘もしなければ不合格になる', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2.id,
      session: built.value.session,
      partFaults: built.value.applied.partFaults,
    });
    h.advance(100);
    h.send({
      type: 'judgeRepair',
      problem: C2,
      circuit: circuitForJudge(built.value, built.value.session),
      reports: [],
      elapsedMs: 60_000,
    });
    h.advance(50);

    const message = h.posted.find((m) => m.type === 'inspectResult');
    expect(message).toBeDefined();
    if (message === undefined || message.type !== 'inspectResult') return;
    expect(message.result.ok).toBe(true);
    if (!message.result.ok) return;
    const value = message.result.value;
    expect(value.mode).toBe('inspect-repair');
    if (value.mode !== 'inspect-repair') return;
    expect(value.passed).toBe(false);
    // 故障2箇所を1つも指摘していない（§17.2 #4）
    expect(value.reports.missed).toHaveLength(2);
    expect(value.reports.extra).toHaveLength(0);
  });

  it('指摘だけ正しくても修復しなければ不合格（動作が模範と食い違う。§9.2 判定②）', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const reports = built.value.applied.sites.map((site) =>
      site.wireId !== undefined && site.kind !== 'wire-missing'
        ? { target: { wireId: site.wireId }, kind: site.report }
        : site.partId !== undefined
          ? { target: { partId: site.partId }, kind: site.report }
          : { target: { terminalId: String(site.terminals[0]) }, kind: site.report },
    );
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2.id,
      session: built.value.session,
      partFaults: built.value.applied.partFaults,
    });
    h.advance(100);
    h.send({
      type: 'judgeRepair',
      problem: C2,
      circuit: circuitForJudge(built.value, built.value.session),
      reports,
      elapsedMs: 60_000,
    });
    h.advance(50);

    const message = h.posted.find((m) => m.type === 'inspectResult');
    if (message === undefined || message.type !== 'inspectResult') return;
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-repair') return;
    expect(value.reports.missed).toHaveLength(0);
    expect(value.reports.extra).toHaveLength(0);
    expect(value.passed).toBe(false);
    expect(value.mismatches.length).toBeGreaterThan(0);
  });

  it('判定中もループは1本のまま（§8.3）', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2.id,
      session: built.value.session,
      partFaults: built.value.applied.partFaults,
    });
    h.advance(200);
    h.send({
      type: 'judgeRepair',
      problem: C2,
      circuit: circuitForJudge(built.value, built.value.session),
      reports: [],
      elapsedMs: 1000,
    });
    h.advance(200);
    expect(vi.getTimerCount()).toBe(1);
    expect(h.snapshots.at(-1)?.droppedTicks).toBe(0);
  });
});
