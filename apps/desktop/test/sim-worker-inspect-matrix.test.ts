import type { TerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  checkSettleMs,
  diagnoseCheckReading,
  expectedCheckReading,
  type ExpectedCheckReading,
  type InspectPartData,
  type InspectPartsProblem,
} from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLoadFor, probeTargets } from '../src/renderer/session/inspect-parts.js';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * C1（部品点検）を Worker で全部品×全接点測る（Opus レビュー Plan 2B Task 8-11）。
 * `test/sim-worker-inspect.test.ts` は代表的な部品だけを見るので、a-open/a-weld/b-open/b-weld
 * のような a/b 接点だけが壊れる故障は今日どのテストも測っていない（§16 Phase 2 受入基準①②）。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));

vi.setConfig({ testTimeout: 120_000 });

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

function last(h: Harness): SimSnapshot {
  const snapshot = h.snapshots.at(-1);
  if (snapshot === undefined) throw new Error('スナップショットがありません');
  return snapshot;
}

/** その部品を挿し、ブレーカ・スイッチを入れた Worker。 */
async function open(
  problem: InspectPartsProblem,
  partId: string,
): Promise<{ h: Harness; group: number; settleMs: number }> {
  const loaded = checkLoadFor(problem, partId);
  if (!loaded.ok) throw new Error(`checkLoadFor が失敗: ${JSON.stringify(loaded.errors)}`);
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
  return { h, group: loaded.group, settleMs: loaded.settleMs };
}

function place(h: Harness, black: TerminalId, red: TerminalId): void {
  h.send({ type: 'tester', action: { type: 'place-probe', probe: 'black', terminal: black } });
  h.send({ type: 'tester', action: { type: 'place-probe', probe: 'red', terminal: red } });
  h.advance(60);
}

const TARGETS = probeTargets();

function targetOf(id: string): { black: TerminalId; red: TerminalId } {
  const found = TARGETS.find((t) => t.id === id);
  if (found === undefined) throw new Error(`プローブの置き場所がありません: ${id}`);
  return { black: found.black, red: found.red };
}

/** 4組の a接点 / b接点 を測り、どれか1組でも異常なら訓練者が気づく形にまとめる。 */
function measureContacts(h: Harness): {
  anyAClosed: boolean;
  allAClosed: boolean;
  anyBClosed: boolean;
  allBClosed: boolean;
} {
  h.send({ type: 'tester', action: { type: 'set-mode', mode: 'CONT' } });
  const a: boolean[] = [];
  const b: boolean[] = [];
  for (let group = 1; group <= 4; group += 1) {
    const at = targetOf(`a${String(group)}`);
    place(h, at.black, at.red);
    a.push(last(h).tester.conductive);
    const bt = targetOf(`b${String(group)}`);
    place(h, bt.black, bt.red);
    b.push(last(h).tester.conductive);
  }
  return {
    anyAClosed: a.some(Boolean),
    allAClosed: a.every(Boolean),
    anyBClosed: b.some(Boolean),
    allBClosed: b.every(Boolean),
  };
}

/** §9.1 の手順どおりに1部品を点検し、訓練者が読み取る値を組み立てる。 */
async function inspect(
  problem: InspectPartsProblem,
  part: InspectPartData,
): Promise<{ reading: ExpectedCheckReading; picksUp: boolean; hazards: string[] }> {
  const { h, settleMs } = await open(problem, part.id);

  // 測定1: 赤PBを離したままコイル抵抗（§9.1 測定1。通電中でも安全）
  h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
  const coil = targetOf('coil');
  place(h, coil.black, coil.red);
  const coilDisplay = last(h).tester.display;
  const coilOhms = coilDisplay === 'OL' ? null : Number(coilDisplay);

  // 励磁OFFの接点
  const off = measureContacts(h);

  // 手順①: 赤PBを押して吸引を見る（タイマはタイムアップを待つ）
  h.send({ type: 'press', pbId: 'PB4' });
  h.advance(settleMs + 100);
  const state = last(h);
  const picksUp =
    part.kind === 'timer-h3y4'
      ? (state.timers['CHK']?.timedOut ?? false)
      : (state.relays['CHK']?.coilOn ?? false);

  // 励磁ONの接点
  const on = measureContacts(h);
  h.send({ type: 'release', pbId: 'PB4' });
  h.advance(100);

  const hazards = h.snapshots.flatMap((s) => s.hazardDelta).map((e) => e.kind);
  return {
    picksUp,
    hazards,
    reading: {
      picksUp,
      coilOhms,
      aClosedOff: off.anyAClosed,
      aClosedOn: on.allAClosed,
      bClosedOff: off.allBClosed,
      bClosedOn: on.anyBClosed,
    },
  };
}

describe('C1 内蔵4セット × 全部品を §9.1 の手順で点検する（受入基準①②）', () => {
  for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
    for (const part of problem.parts) {
      it(`${problem.id} / ${part.id}（${part.truth}・${part.kind}）は判定表どおりに読める`, async () => {
        const observed = await inspect(problem, part);
        const expectedReading = expectedCheckReading(part);

        // 吸引（コイル断線だけが吸引しない）
        expect(observed.picksUp).toBe(expectedReading.picksUp);

        // コイル抵抗
        if (expectedReading.coilOhms === null) {
          expect(observed.reading.coilOhms).toBeNull();
        } else {
          expect(observed.reading.coilOhms).not.toBeNull();
          expect(observed.reading.coilOhms ?? 0).toBeCloseTo(expectedReading.coilOhms, 0);
        }

        // 接点（4組すべてを測った結果のまとめ）
        expect({
          aClosedOff: observed.reading.aClosedOff,
          aClosedOn: observed.reading.aClosedOn,
          bClosedOff: observed.reading.bClosedOff,
          bClosedOn: observed.reading.bClosedOn,
        }).toEqual({
          aClosedOff: expectedReading.aClosedOff,
          aClosedOn: expectedReading.aClosedOn,
          bClosedOff: expectedReading.bClosedOff,
          bClosedOn: expectedReading.bClosedOn,
        });

        // 判定表（溶着優先）で原因が1つに決まり、マークシートの正解と一致する
        expect(diagnoseCheckReading(observed.reading)).toBe(part.truth);

        // 手順どおり（赤PBを押したままΩを当てない）なら危険操作は出ない
        expect(observed.hazards).toEqual([]);
      });
    }
  }
});

describe('タイマの安定待ち（c1-003 / checkSettleMs = 1100ms）', () => {
  it('1100ms 待たないと限時接点は反転しない', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS.find((p) => p.id === 'c1-003');
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const part = problem.parts[0];
    expect(part?.truth).toBe('normal');
    if (part === undefined) return;
    expect(checkSettleMs(part.kind)).toBe(1100);
    const { h } = await open(problem, part.id);
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(500);
    expect(last(h).timers['CHK']?.timedOut).toBe(false);
    h.advance(700);
    expect(last(h).timers['CHK']?.timedOut).toBe(true);
  });
});

describe('危険操作（§5.6 #1 / 受入基準④）', () => {
  it('赤PBを押したままコイルにΩを当てると ohm-on-live が1回だけ出て表示は ----', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const part = problem.parts[0];
    if (part === undefined) return;
    const { h } = await open(problem, part.id);
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(150);
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    const coil = targetOf('coil');
    place(h, coil.black, coil.red);
    h.advance(500); // 当てたまま放置しても回数は増えない（同じ1回の違反）
    const hazards = h.snapshots
      .flatMap((s) => s.hazardDelta)
      .filter((e) => e.kind === 'ohm-on-live');
    expect(last(h).tester.display).toBe('----');
    expect(hazards).toHaveLength(1);
  });

  it('同じ端子に当て直しても再発行しない（プローブ配置が変わらない限り§5.6#1）', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const part = problem.parts[0];
    if (part === undefined) return;
    const { h } = await open(problem, part.id);
    const coil = targetOf('coil');
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(100);
    place(h, coil.black, coil.red);
    h.advance(100);
    h.send({ type: 'tester', action: { type: 'place-probe', probe: 'red', terminal: undefined } });
    h.advance(100);
    // 離す→同じ端子へ当て直す（配置は変わっていない）ので再発行しない
    place(h, coil.black, coil.red);
    h.advance(100);
    const hazards = h.snapshots
      .flatMap((s) => s.hazardDelta)
      .filter((e) => e.kind === 'ohm-on-live');
    expect(hazards).toHaveLength(1);
  });
});

describe('部品の差し替え（load）はプローブだけ外し 0Ω調整とレンジを残す', () => {
  it('アナログの0Ω調整は load をまたいで残る（未調整なら +5%）', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const p1 = problem.parts[0];
    const p4 = problem.parts[3];
    if (p1 === undefined || p4 === undefined) return;
    const { h } = await open(problem, p1.id);
    const coil = targetOf('coil');
    h.send({ type: 'tester', action: { type: 'set-kind', kind: 'analog' } });
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    h.send({ type: 'tester', action: { type: 'set-ohm-range', range: 1000 } });
    place(h, coil.black, coil.red);
    const unadjusted = last(h).tester.value;
    expect(unadjusted).toBeCloseTo(650 * 1.05, 0);

    h.send({ type: 'tester', action: { type: 'zero-adjust' } });
    h.advance(60);
    expect(last(h).tester.value).toBeCloseTo(650, 0);

    // 次の部品へ（renderer は checkLoadFor → load を送り直す）
    const next = checkLoadFor(problem, p4.id);
    if (!next.ok) throw new Error('load できません');
    h.send({
      type: 'load',
      problemId: problem.id,
      session: next.session,
      partFaults: next.partFaults,
    });
    h.advance(100);
    // プローブは外れている（表示は ----）が、つまみ・レンジ・0Ω調整は残る
    expect(last(h).tester.display).toBe('----');
    expect(last(h).tester.kind).toBe('analog');
    expect(last(h).tester.mode).toBe('OHM');
    h.send({ type: 'breaker', on: true });
    h.send({ type: 'switch', on: true });
    place(h, coil.black, coil.red);
    expect(last(h).tester.value).toBeCloseTo(650, 0);
  });
});

describe('judgeParts（§9.1 判定）', () => {
  async function judge(
    problem: InspectPartsProblem,
    answers: { partId: string; answer: InspectPartData['truth'] }[],
    elapsedMs = 60_000,
  ): Promise<SimMessage & { type: 'inspectResult' }> {
    const first = problem.parts[0];
    if (first === undefined) throw new Error('部品がありません');
    const { h } = await open(problem, first.id);
    h.send({ type: 'judgeParts', problem, answers, elapsedMs });
    h.advance(50);
    const message = h.posted.find((m) => m.type === 'inspectResult');
    if (message === undefined || message.type !== 'inspectResult') {
      throw new Error('inspectResult が返りません');
    }
    return message;
  }

  it('全問正解なら合格（1級の6部品セット c1-004 でも）', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS.find((p) => p.id === 'c1-004');
    if (problem === undefined) return;
    const message = await judge(
      problem,
      problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      900_000,
    );
    expect(message.result.ok).toBe(true);
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.passed).toBe(true);
    expect(value.correctCount).toBe(6);
    expect(value.total).toBe(6);
    expect(value.elapsedMs).toBe(900_000);
  });

  it('1問だけ間違えると 5/6 で不合格', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS.find((p) => p.id === 'c1-004');
    if (problem === undefined) return;
    const answers = problem.parts.map((p, i) => ({
      partId: p.id,
      answer: i === 0 ? ('normal' as const) : p.truth,
    }));
    const message = await judge(problem, answers);
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.passed).toBe(false);
    expect(value.correctCount).toBe(5);
    expect(value.scores[0]?.answer).toBe('normal');
    expect(value.scores[0]?.truth).toBe('coil-layer-short');
  });

  it('未解答（空）は全問不正解になり、行には answer: undefined が並ぶ', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const message = await judge(problem, []);
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.passed).toBe(false);
    expect(value.correctCount).toBe(0);
    expect(value.scores.map((s) => s.answer)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('同じ部品を2回答えた解答（重複）でも落ちない', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const first = problem.parts[0];
    if (first === undefined) return;
    const answers = [
      ...problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      { partId: first.id, answer: 'b-weld' as const },
    ];
    const message = await judge(problem, answers);
    expect(message.result.ok).toBe(true);
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.total).toBe(problem.parts.length);
    expect(value.scores).toHaveLength(problem.parts.length);
    // `judgeInspectParts` は `Map` に積むので後勝ち（`judge-inspect.ts`）
    expect(value.scores[0]?.answer).toBe('b-weld');
  });

  it('課題に無い部品IDの解答は無視される', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const message = await judge(problem, [
      ...problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      { partId: 'ghost', answer: 'normal' as const },
    ]);
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.total).toBe(problem.parts.length);
    expect(value.passed).toBe(true);
  });

  it('危険操作の回数が判定結果に載る（合否には効かない）', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const first = problem.parts[0];
    if (first === undefined) return;
    const { h } = await open(problem, first.id);
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(120);
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    const coil = targetOf('coil');
    place(h, coil.black, coil.red);
    h.advance(120);
    h.send({
      type: 'judgeParts',
      problem,
      answers: problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      elapsedMs: 10_000,
    });
    h.advance(50);
    const message = h.posted.find((m) => m.type === 'inspectResult');
    if (message === undefined || message.type !== 'inspectResult') return;
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.hazardCount).toBeGreaterThanOrEqual(1);
    expect(value.hazardsByKind['ohm-on-live']).toBeGreaterThanOrEqual(1);
    expect(value.passed).toBe(true);
  });
});
