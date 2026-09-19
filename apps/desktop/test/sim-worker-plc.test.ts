import { JIPM_BOARD } from '@ojt/board-model';
import type { BoardSession } from '@ojt/board-model';
import { createWire } from '@ojt/circuit-sim';
import {
  BUILTIN_PLC_PROBLEMS,
  buildPlcReferenceSession,
  isPlcProblem,
  type PlcProblem,
} from '@ojt/content';
import {
  COIL_COL,
  empty,
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  T,
  ton,
  X,
  Y,
  type Cell,
  type LadderProgram,
} from '@ojt/ladder-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * モードDの Worker 連携（§10.4 / §10.8 / 3A 引渡し注記 H-2・H-4）。
 * 偽の `self` を置いてモジュールとして動かす流儀は `sim-worker.test.ts` と同じ。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));
vi.setConfig({ testTimeout: 20_000 });

const D001 = BUILTIN_PLC_PROBLEMS[0];

function plcProblem(): PlcProblem {
  if (D001 === undefined || !isPlcProblem(D001)) throw new Error('モードD課題がありません');
  return D001;
}

/** 模範配線の盤（PLC本体・コンセントへの配線を含む）。 */
function referenceSession(): BoardSession {
  const built = buildPlcReferenceSession(plcProblem(), JIPM_BOARD);
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join(' / '));
  return built.value.session;
}

/** 1行ぶんのセル（コイル列まで横線で詰める）。 */
function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** X0 で Y0 を出すだけのラダー。 */
function simpleLadder(): LadderProgram {
  return program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
}

interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  errors: Array<Extract<SimMessage, { type: 'error' }>>;
  plcResults: Array<Extract<SimMessage, { type: 'plcResult' }>>;
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
    get plcResults() {
      return posted.filter((m) => m.type === 'plcResult');
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

/** 盤を読み、ラダーを載せ、RUN にして通電まで済ませる。 */
async function running(ladder: LadderProgram = simpleLadder()): Promise<Harness> {
  const h = await boot();
  h.send({
    type: 'load',
    problemId: plcProblem().id,
    session: referenceSession(),
    plcModel: 'FX5U',
  });
  h.send({ type: 'plc', action: { kind: 'load', program: ladder } });
  h.send({ type: 'plc', action: { kind: 'run', on: true } });
  h.send({ type: 'breaker', on: true });
  h.send({ type: 'switch', on: true });
  h.advance(200);
  return h;
}

describe('モードDの盤とスキャン（§10.1 / §10.4）', () => {
  it('loads the derived board so PLC.* terminals exist', async () => {
    const h = await running();
    expect(h.errors).toEqual([]);
    expect(h.snapshots.at(-1)?.powered).toBe(true);
  });

  it('runs one scan per tick and drives the lamp through the relay (受入基準③の中身)', async () => {
    const h = await running();
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');
    h.send({ type: 'press', pbId: 'PB1' });
    // 入力は1スキャン遅れ、Y接点が閉じてから盤のリレーが動くまでさらに1tick（合計 20〜30ms）
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
    h.send({ type: 'release', pbId: 'PB1' });
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');
  });

  it('does not scan while the PLC is stopped', async () => {
    const h = await running();
    h.send({ type: 'plc', action: { kind: 'run', on: false } });
    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(300);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');
    // RUN に戻せば動く
    h.send({ type: 'plc', action: { kind: 'run', on: true } });
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
  });

  it('opens the Y contacts when the PLC stops（3A 引渡し表: reset() は writeOutputs も呼ぶ）', async () => {
    const h = await running();
    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
    h.send({ type: 'plc', action: { kind: 'run', on: false } });
    h.advance(100);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');
  });

  it('keeps the board when the ladder is replaced（tMs も信号ログも切れない。決定表#9）', async () => {
    const h = await running();
    h.advance(300);
    const before = h.snapshots.at(-1)?.tMs ?? 0;
    expect(before).toBeGreaterThan(0);
    h.send({ type: 'plc', action: { kind: 'load', program: simpleLadder() } });
    h.advance(100);
    expect(h.snapshots.at(-1)?.tMs).toBeGreaterThan(before);
  });

  it('reports a ladder that cannot be compiled without killing the loop (H-1 の保険)', async () => {
    const h = await running();
    h.send({
      type: 'plc',
      action: { kind: 'load', program: program(network('n1', [[empty()]])) },
    });
    h.advance(100);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.fatal).toBe(false);
    expect(h.errors[0]?.message).toContain('END');
    // 前のラダーはそのまま動き続ける
    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
  });
});

describe('モニタのスナップショット（決定表#5）', () => {
  it('carries no PLC payload until monitoring starts', async () => {
    const h = await running();
    expect(h.snapshots.at(-1)?.plc).toBeUndefined();
    h.send({ type: 'plc', action: { kind: 'monitor', on: true } });
    h.advance(100);
    expect(h.snapshots.at(-1)?.plc).toBeDefined();
    h.send({ type: 'plc', action: { kind: 'monitor', on: false } });
    h.advance(100);
    expect(h.snapshots.at(-1)?.plc).toBeUndefined();
  });

  it('encodes the powered cells as one string per network', async () => {
    const h = await running();
    h.send({ type: 'plc', action: { kind: 'monitor', on: true } });
    h.advance(100);
    const before = h.snapshots.at(-1)?.plc;
    expect(before).toBeDefined();
    const row = before?.powered['n1'];
    expect(row).toHaveLength(IR_COLS); // 1行 × 16列
    // X0 が OFF なら接点の右側（列1以降）は通電していない
    expect(row?.[0]).toBe('1');
    expect(row?.[1]).toBe('0');
    expect(before?.powered['end']).toBeUndefined();

    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(200);
    const after = h.snapshots.at(-1)?.plc;
    expect(after?.powered['n1']?.[COIL_COL]).toBe('1');
    expect(after?.outputs[0]).toBe(true);
    expect(after?.inputs[0]).toBe(true);
    expect(after?.scanCount).toBeGreaterThan(0);
  });

  it('carries the timer preset alongside the elapsed time (Batch 3 レビュー M4)', async () => {
    const timerLadder = program(network('n1', [rung(no(X(0)), ton(T(0), 3_000))]), endNetwork());
    const h = await running(timerLadder);
    h.send({ type: 'plc', action: { kind: 'monitor', on: true } });
    h.advance(100);
    const snapshot = h.snapshots.at(-1)?.plc;
    expect(snapshot?.timers[0]?.presetMs).toBe(3_000);
  });

  it('sizes outputs to the PLC unit output count instead of the default full length (レビュー指摘 I3)', async () => {
    const h = await running();
    h.send({ type: 'plc', action: { kind: 'monitor', on: true } });
    h.advance(100);
    const snapshot = h.snapshots.at(-1)?.plc;
    expect(snapshot).toBeDefined();
    // FX5U は16点（`FX5U_SPEC.outputs`）。既定の `outputCount` 未指定時のフルレングスと
    // 一致しないよう、実機の点数で切り詰まっていることを確かめる。
    expect(snapshot?.outputs).toHaveLength(16);
  });
});

describe('モードDの判定（§10.8 / H-4）', () => {
  it('stops the catch-up loop while judging and posts the verdict', async () => {
    const h = await running();
    h.advance(200);
    const judgingFrom = h.snapshots.length;
    h.send({
      type: 'judgePlc',
      problem: plcProblem(),
      session: referenceSession(),
      ladder: plcProblem().referenceLadder,
      elapsedMs: 123_000,
    });
    expect(h.plcResults).toHaveLength(1);
    const result = h.plcResults[0]?.result;
    expect(result?.ok).toBe(true);
    if (result === undefined || !result.ok) return;
    expect(result.value.mode).toBe('plc');
    expect(result.value.passed).toBe(true);
    expect(result.value.elapsedMs).toBe(123_000);
    expect(result.value.ladderErrors).toEqual([]);
    // 判定のあともループは回り続ける
    h.advance(200);
    expect(h.snapshots.length).toBeGreaterThan(judgingFrom);
    expect(h.errors).toEqual([]);
  });

  it('fails a ladder that does not match the reference', async () => {
    const h = await running();
    const wrong = program(network('n1', [rung(no(X(1)), out(Y(0)))]), endNetwork());
    h.send({
      type: 'judgePlc',
      problem: plcProblem(),
      session: referenceSession(),
      ladder: wrong,
      elapsedMs: 0,
    });
    const result = h.plcResults[0]?.result;
    expect(result?.ok).toBe(true);
    if (result === undefined || !result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.mismatches.length).toBeGreaterThan(0);
  });

  it('carries the session hazards into the verdict', async () => {
    const h = await running();
    // 1端子に3本目を繋ぐ（`over-wires-per-terminal`。§5.6 #5）
    const session = referenceSession();
    const first = session.wires[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    // `Wire.id` は branded な `WireId` なので、素の文字列ではなく `createWire()` で組む
    h.send({ type: 'addWire', wire: createWire('extra', first.from, first.to, '青') });
    h.send({ type: 'addWire', wire: createWire('extra2', first.from, first.to, '青') });
    h.advance(100);
    h.send({
      type: 'judgePlc',
      problem: plcProblem(),
      session,
      ladder: plcProblem().referenceLadder,
      elapsedMs: 0,
    });
    const result = h.plcResults[0]?.result;
    expect(result?.ok).toBe(true);
    if (result === undefined || !result.ok) throw new Error('judgePlc did not return ok');
    expect(result.value.hazardCount).toBeGreaterThan(0);
  });
});
