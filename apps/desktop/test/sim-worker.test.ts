import { JIPM_BOARD } from '@ojt/board-model';
import type { BoardSession } from '@ojt/board-model';
import { createWire } from '@ojt/circuit-sim';
import type * as CircuitSim from '@ojt/circuit-sim';
import { BUILTIN_PROBLEMS, buildReferenceSession } from '@ojt/content';
import type * as Content from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * Simulation Worker 本体のテスト（§4.3 / §5.2 / §13 #6）。
 *
 * `sim.worker.ts` は `self.onmessage` を張るだけのモジュールなので、**偽の `self`** を
 * `globalThis` に置いてから読み込めば、Worker を起こさずに素のモジュールとして動かせる。
 * `performance.now()` と `setTimeout` は偽物に差し替え、追従ループの1周期ずつを手で進める。
 *
 * `judgeAssemble` は差し替えて「判定に掛かった実時間」を模す（判定は 240〜440ms かかる。§8.3）。
 * ここを模さないと「判定中にループを止める」修正の効き目が測れない。
 */

/** 偽の時計と、判定1回が食う実時間[ms]。`vi.mock` の工場から触るので hoisted に置く。 */
const clock = vi.hoisted(() => ({ nowMs: 0, judgeCostMs: 0 }));

vi.mock('@ojt/content', async (importOriginal) => {
  const actual = await importOriginal<typeof Content>();
  return {
    ...actual,
    judgeAssemble: ((...args: Parameters<typeof actual.judgeAssemble>) => {
      clock.nowMs += clock.judgeCostMs;
      return actual.judgeAssemble(...args);
    }) as typeof actual.judgeAssemble,
  };
});

// 既定の5秒だと並列実行時の負荷でまれに超過する（既知のflake）。このファイルだけ延ばす。
vi.setConfig({ testTimeout: 15_000 });

const B001 = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');

/** b-001 の模範回路のセッション（配線も部品も揃った状態）。 */
function referenceSession(): BoardSession {
  if (B001 === undefined) throw new Error('b-001 が見つかりません');
  const built = buildReferenceSession(B001, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路を作れませんでした');
  return built.value.session;
}

/** 偽 `self` で動かした Worker を操作する道具一式。 */
interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  errors: Array<Extract<SimMessage, { type: 'error' }>>;
  send: (command: SimCommand) => void;
  /** 実時間とタイマを `stepMs` 刻みで進める。 */
  advance: (ms: number, stepMs?: number) => void;
  /** worker と同じ実体の `circuit-sim`（`step` を壊す検査で使う）。 */
  sim: typeof CircuitSim;
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
  clock.judgeCostMs = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs);
  vi.resetModules();
  // `resetModules()` 後に読み直すことで、worker と同じ `Simulation` クラスを掴む
  const sim = await import('@ojt/circuit-sim');
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
    sim,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Simulation Worker の基本動作（§4.3）', () => {
  it('load → ブレーカ → スイッチ → PB1 押下 で PL1 が点く', async () => {
    const h = await boot();
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    h.send({ type: 'breaker', on: true });
    h.send({ type: 'switch', on: true });
    h.advance(200);
    expect(h.snapshots.at(-1)?.powered).toBe(true);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');

    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(420);
    // 開始からおよそ 720ms 以内に点灯する（自己保持なので離しても点いたまま）
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
    h.send({ type: 'release', pbId: 'PB1' });
    h.advance(100);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
    expect(h.errors).toEqual([]);
  });

  it('reset と2回目の load を受けても追従ループは1本のまま', async () => {
    const h = await boot();
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    expect(vi.getTimerCount()).toBe(1);

    h.send({ type: 'reset' });
    h.advance(100);
    expect(vi.getTimerCount()).toBe(1);

    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    expect(vi.getTimerCount()).toBe(1);
    // 2本走っていれば時計が倍速になる。100ms 進めたぶんしか進んでいないことを見る
    const tMs = h.snapshots.at(-1)?.tMs ?? 0;
    expect(tMs).toBeGreaterThan(60);
    expect(tMs).toBeLessThan(160);
  });

  it('load 前のコマンドは理由付きで断り（致命ではない）、その後の load は通る', async () => {
    const h = await boot();
    h.send({ type: 'press', pbId: 'PB1' });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.message).toContain('課題が読み込まれていません');
    expect(h.errors[0]?.fatal).toBe(false);
    expect(h.snapshots).toHaveLength(0);

    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(200);
    expect(h.snapshots.length).toBeGreaterThan(0);
    expect(h.errors).toHaveLength(1);
  });

  it('知らない押ボタンはエラーになるが、スナップショットは流れ続ける', async () => {
    const h = await boot();
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    const before = h.snapshots.length;

    h.send({ type: 'press', pbId: 'PB9' });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.fatal).toBe(false);

    h.advance(200);
    expect(h.snapshots.length).toBeGreaterThan(before);
  });

  it('未知のコマンド種別は黙って無視せず、理由付きで断る（DW-2）', async () => {
    const h = await boot();
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    const before = h.snapshots.length;

    // `SimCommand` に無い `type` を実行時に送る（tsc をすり抜けた壊れたメッセージを模す）。
    h.send({ type: 'not-a-real-command' } as unknown as SimCommand);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.message).toContain('未知のコマンドです');
    expect(h.errors[0]?.fatal).toBe(false);

    // 1件断られてもループは回り続ける。
    h.advance(200);
    expect(h.snapshots.length).toBeGreaterThan(before);
  });
});

describe('追従ループの例外（§13 #6）', () => {
  it('Simulation.step が投げたら致命エラーを1回だけ出してループを畳む', async () => {
    const h = await boot();
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    expect(h.errors).toHaveLength(0);

    vi.spyOn(h.sim.Simulation.prototype, 'step').mockImplementation(() => {
      throw new h.sim.SimulationError('回路の状態を解けませんでした');
    });
    h.advance(300);

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.fatal).toBe(true);
    expect(h.errors[0]?.message).toContain('回路の状態を解けませんでした');
    // ループは止まっている（タイマが残っていない）
    expect(vi.getTimerCount()).toBe(0);
    // 最後の状態を1枚だけ送ってある
    expect(h.posted.at(-1)?.type).toBe('snapshot');

    h.advance(300);
    expect(h.errors).toHaveLength(1);
  });
});

describe('判定中の一時停止（§8.3）', () => {
  it('判定に 400ms かかっても tick を取りこぼさない', async () => {
    const h = await boot();
    if (B001 === undefined) return;
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(200);
    expect(h.snapshots.at(-1)?.droppedTicks).toBe(0);

    clock.judgeCostMs = 400;
    h.send({ type: 'judge', problem: B001, session: referenceSession(), elapsedMs: 90_000 });
    h.advance(300);

    expect(h.posted.some((m) => m.type === 'judgeResult')).toBe(true);
    expect(h.snapshots.at(-1)?.droppedTicks).toBe(0);
    // 判定後もループは1本だけ回っている
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('1端子3本目（§5.6 #5 / §17 #25）', () => {
  it('盤が断った電線を送ると危険操作だけが記録され、回路は変わらない', async () => {
    const h = await boot();
    const session = referenceSession();
    h.send({ type: 'load', problemId: 'b-001', session });
    h.advance(100);

    // 模範回路で既に使われている端子どうしに、さらに電線を重ねて上限を超えさせる
    const target = session.wires.find((w) => !w.locked);
    expect(target).toBeDefined();
    if (target === undefined) return;
    for (let i = 0; i < 3; i += 1) {
      h.send({
        type: 'addWire',
        wire: createWire(`w-over-${i}`, target.from, target.to, '青', false),
      });
    }
    h.advance(100);

    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.some((e) => e.kind === 'over-wires-per-terminal')).toBe(true);
    // 断られただけなのでループは生きており、致命エラーも出ない
    expect(h.errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
  });
});

/**
 * 1D2-a のレビュー指摘: 盤の食い違い（別の盤で保存した作業ファイル）で `load` が失敗しても
 * `fatal: false` のトーストしか出ず、画面は「課題を開いた」つもりのまま無反応になっていた。
 * `load` に失敗したら追従ループは動いていないので、致命として例外バナーを出させる（§13 #5 / #6）。
 */
describe('load の失敗（§13 #5）', () => {
  it('別の盤のセッションを load したら致命エラーにしてループを畳む', async () => {
    const h = await boot();
    const session = { ...referenceSession(), boardId: 'jipm-2024' };

    h.send({ type: 'load', problemId: 'b-001', session });

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.fatal).toBe(true);
    expect(h.errors[0]?.message).toContain('jipm-2024');
    expect(vi.getTimerCount()).toBe(0);

    h.advance(300);
    expect(h.snapshots).toHaveLength(0);
  });

  it('動いている最中に load が失敗しても、古い盤を回し続けない', async () => {
    const h = await boot();
    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    const before = h.snapshots.length;
    expect(before).toBeGreaterThan(0);

    h.send({ type: 'load', problemId: 'b-002', session: { ...referenceSession(), boardId: 'x' } });
    expect(h.errors.at(-1)?.fatal).toBe(true);

    h.advance(300);
    expect(h.snapshots).toHaveLength(before);
  });
});
