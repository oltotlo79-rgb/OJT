import { JIPM_BOARD, addWire, removeWire, toNetlistTerminal } from '@ojt/board-model';
import type { BoardSession } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildInspectRepairCircuit,
  buildReferenceSession,
  replacePart,
  type FaultReport,
  type FaultSite,
  type InspectRepairProblem,
  type RepairCircuit,
} from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloneSession } from '../src/renderer/session/commands.js';
import { circuitForJudge } from '../src/renderer/session/inspect-repair.js';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * モードC2の全内蔵課題（8題）を**本物の Worker モジュール**で回す（Plan 2B レビュー指摘。
 * `sim-worker-repair.test.ts` は `c2-001` 1題しか回していなかった）。設計仕様 §9.2 / §16 受入③。
 *
 * 判定は模範回路と訓練者回路を並走させるので1呼びあたり実測 0.2〜0.85秒かかる（§8.3。M6）。
 * 8題ぶんの「全箇所修復して合格」だけを `describe.each` で回し、種別違い・改造の検証は
 * 1題（`c2-001`）だけで足りるので使い回さない（追加実行時間を約25秒以内に収める）。
 */

vi.setConfig({ testTimeout: 30_000 });

const clock = vi.hoisted(() => ({ nowMs: 0 }));

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

/** 故障箇所に対する「正しい指摘」（UI が作るのと同じ形）。 */
function correctReport(site: FaultSite): FaultReport {
  if (site.kind === 'wire-missing') {
    return { target: { terminalId: String(site.terminals[0]) }, kind: site.report };
  }
  if (site.wireId !== undefined) return { target: { wireId: site.wireId }, kind: site.report };
  return { target: { partId: site.partId ?? '' }, kind: site.report };
}

function lastInspect(h: Harness): Extract<SimMessage, { type: 'inspectResult' }> | undefined {
  const messages = h.posted.filter((m) => m.type === 'inspectResult');
  return messages.at(-1);
}

/** 模範（無故障）の盤。誤配線・未配線の「正しい両端」を引くのに使う。 */
function referenceOf(problem: InspectRepairProblem): BoardSession {
  const ref = buildReferenceSession(problem, JIPM_BOARD);
  if (!ref.ok) throw new Error('reference failed');
  return ref.value.session;
}

/**
 * UI と同じ手順で1箇所を修復する。
 * 電線: 削除モードで外して（`runRemoveWire` 相当）白線を張り直す。
 * 未配線: 白線を張る。部品: `replacePart()` ＋ Worker へ `unplug`/`plug`。
 */
function repairSite(
  h: Harness,
  session: BoardSession,
  circuit: RepairCircuit,
  site: FaultSite,
  reference: BoardSession,
): RepairCircuit {
  if (site.partId !== undefined) {
    const socketId = (Object.keys(session.mounted) as Array<keyof typeof session.mounted>).find(
      (s) => session.socketRoles[s] === site.partId || s === site.partId,
    );
    const cloned = cloneSession(session);
    h.send({ type: 'unplug', partId: site.partId, session: cloned });
    if (socketId !== undefined) {
      h.send({ type: 'plug', socketId: socketId as never, session: cloned });
    }
    return replacePart(circuit, site.partId);
  }
  const wireId = site.wireId;
  if (wireId === undefined) return circuit;
  if (site.kind !== 'wire-missing') {
    const removed = removeWire(session, wireId);
    expect(removed.ok).toBe(true);
    h.send({ type: 'removeWire', wireId });
  }
  const original = reference.wires.find((w) => w.id === wireId);
  const from = (original?.from ?? site.terminals[0]) as TerminalId;
  const to = (original?.to ?? site.terminals[1]) as TerminalId;
  const added = addWire(
    session,
    JIPM_BOARD,
    toNetlistTerminal(session.socketRoles, from),
    toNetlistTerminal(session.socketRoles, to),
    '白',
  );
  expect(added.ok, `add ${String(from)}-${String(to)}: ${JSON.stringify(added)}`).toBe(true);
  const wire = session.wires.at(-1);
  if (wire !== undefined) h.send({ type: 'addWire', wire });
  return circuit;
}

describe.each(BUILTIN_INSPECT_REPAIR_PROBLEMS.map((p) => [p.id, p] as const))(
  'C2 %s',
  (id, problem) => {
    it('過不足なく指摘して全箇所を修復すると合格する（受入基準③）', async () => {
      const built = buildInspectRepairCircuit(problem, JIPM_BOARD, { seed: 7 });
      if (!built.ok) return;
      let circuit = built.value;
      const session = circuit.session;
      const reference = referenceOf(problem);
      const h = await boot();
      h.send({
        type: 'load',
        problemId: problem.id,
        session: cloneSession(session),
        partFaults: circuit.applied.partFaults,
      });
      h.advance(100);
      for (const site of circuit.applied.sites) {
        circuit = repairSite(h, session, circuit, site, reference);
      }
      h.advance(100);
      const reports = circuit.applied.sites.map(correctReport);
      h.send({
        type: 'judgeRepair',
        problem,
        circuit: circuitForJudge(circuit, cloneSession(session)),
        reports,
        elapsedMs: 300_000,
      });
      h.advance(50);
      const message = lastInspect(h);
      expect(message).toBeDefined();
      if (message === undefined || !message.result.ok) return;
      const value = message.result.value;
      if (value.mode !== 'inspect-repair') return;
      expect(value.reports.missed, `${id} missed`).toHaveLength(0);
      expect(value.reports.extra, `${id} extra`).toHaveLength(0);
      expect(value.modifications, `${id} modifications`).toHaveLength(0);
      expect(
        value.mismatches.map((m) => JSON.stringify(m)),
        `${id} mismatches`,
      ).toHaveLength(0);
      expect(
        value.staticChecks.filter((c) => !c.ok),
        `${id} staticChecks`,
      ).toHaveLength(0);
      expect(value.passed, `${id} passed`).toBe(true);
      expect(value.addedWires.length).toBeGreaterThan(0);
    });
  },
);

/*
 * 以下は種別違い・改造の検証。8題ぶん回す必要はない判定ロジックの分岐なので `c2-001` だけで
 * 確かめる（`sim-worker-repair.test.ts` が既に load / 未修復不合格 / 判定中のループは別で見ている）。
 */
const C2_ONE = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === 'c2-001');

describe('種別違い・改造（c2-001だけで確かめる）', () => {
  it('種別を間違えた指摘は 見逃し＋過剰指摘 になる', async () => {
    expect(C2_ONE).toBeDefined();
    if (C2_ONE === undefined) return;
    const built = buildInspectRepairCircuit(C2_ONE, JIPM_BOARD, { seed: 7 });
    if (!built.ok) return;
    const circuit = built.value;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2_ONE.id,
      session: cloneSession(circuit.session),
      partFaults: circuit.applied.partFaults,
    });
    h.advance(50);
    const reports = circuit.applied.sites.map((site): FaultReport => {
      const right = correctReport(site);
      // 電線なら断線↔誤配線を入れ替える。未配線は誤った種別（断線）にすり替える
      if ('wireId' in right.target) {
        return {
          target: right.target,
          kind: right.kind === 'wire-open' ? 'wire-misrouted' : 'wire-open',
        };
      }
      if ('terminalId' in right.target) {
        return {
          target: { terminalId: right.target.terminalId },
          kind: 'wire-open',
        };
      }
      return { target: right.target, kind: 'wire-open' };
    });
    h.send({
      type: 'judgeRepair',
      problem: C2_ONE,
      circuit: circuitForJudge(circuit, cloneSession(circuit.session)),
      reports,
      elapsedMs: 60_000,
    });
    h.advance(50);
    const message = lastInspect(h);
    if (message === undefined || !message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-repair') return;
    expect(value.reports.missed.length).toBeGreaterThan(0);
    expect(value.reports.extra.length).toBeGreaterThan(0);
    expect(value.passed).toBe(false);
  });

  it('故障箇所でない青線を外すと「改造」に計上され不合格になる', async () => {
    expect(C2_ONE).toBeDefined();
    if (C2_ONE === undefined) return;
    const built = buildInspectRepairCircuit(C2_ONE, JIPM_BOARD, { seed: 7 });
    if (!built.ok) return;
    let circuit = built.value;
    const session = circuit.session;
    const reference = referenceOf(C2_ONE);
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2_ONE.id,
      session: cloneSession(session),
      partFaults: circuit.applied.partFaults,
    });
    h.advance(50);
    for (const site of circuit.applied.sites) {
      circuit = repairSite(h, session, circuit, site, reference);
    }
    // 健全な青線を1本外す（＝改造）
    const faulted = new Set(circuit.applied.sites.map((s) => s.wireId));
    const healthy = session.wires.find((w) => w.color === '青' && !faulted.has(w.id) && !w.locked);
    expect(healthy).toBeDefined();
    if (healthy === undefined) return;
    removeWire(session, healthy.id);
    h.send({ type: 'removeWire', wireId: healthy.id });
    h.advance(50);
    h.send({
      type: 'judgeRepair',
      problem: C2_ONE,
      circuit: circuitForJudge(circuit, cloneSession(session)),
      reports: circuit.applied.sites.map(correctReport),
      elapsedMs: 300_000,
    });
    h.advance(50);
    const message = lastInspect(h);
    if (message === undefined || !message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-repair') return;
    expect(value.modifications).toContain(healthy.id);
    expect(value.passed).toBe(false);
  });
});
