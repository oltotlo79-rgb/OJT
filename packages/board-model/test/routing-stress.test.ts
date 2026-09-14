import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  channelBandRect,
  CHANNEL_LANE_COUNT,
  CHANNEL_LANE_DIRECTION,
  CHANNEL_LANE_PITCH_MM,
  crossingFootprint,
  JIPM_BOARD,
  routeWire,
  runZ,
  WIRE_DIAMETER_MM,
  WIRE_LAYER_COUNT,
  type Vec3,
  type WireRoute,
} from '../src/index.js';

/**
 * 経路生成の「たくさん引いても壊れない」ことの担保（Task 9c）。
 *
 * ここでは {@link WireRoute.lanes} の申告ではなく、**折れ点の実座標**からスロットの占有を
 * 読みなおして検査する。申告と実物がずれる実装（走行の区間をまとめ損ねる、など）は
 * 単体テストをすり抜けても、この検査では必ず落ちる。
 */

const board = JIPM_BOARD;
const EPS = 1e-6;

function t(id: string): TerminalId {
  return id as TerminalId;
}

function route(id: string, from: string, to: string, existing: WireRoute[] = []): WireRoute {
  return routeWire(board, { id, from: t(from), to: t(to) }, existing);
}

function routeAll(pairs: ReadonlyArray<[string, string]>): WireRoute[] {
  const routes: WireRoute[] = [];
  pairs.forEach(([from, to], index) => {
    routes.push(route(`w-${index}`, from, to, routes));
  });
  return routes;
}

/** 自己保持回路ぶんの配線（routing.test.ts と同じ）。 */
const SELF_HOLD_WIRING: ReadonlyArray<[string, string]> = [
  ['P.1', 'TB_PB.2c'],
  ['TB_PB.2c', 'S1.10'],
  ['TB_PB.2b', 'TB_PB.1c'],
  ['TB_PB.1a', 'S1.14'],
  ['S1.14', 'S1.5'],
  ['N.1', 'S1.13'],
  ['S1.13', 'TB_PL.1-'],
  ['TB_PB.1c', 'S1.9'],
  ['S1.6', 'TB_PL.1+'],
];

/** フリッカ回路ぶんの配線（routing.test.ts と同じ）。 */
const FLICKER_WIRING: ReadonlyArray<[string, string]> = [
  ['P.1', 'TB_PB.1c'],
  ['TB_PB.1a', 'S1.9'],
  ['S1.9', 'S2.9'],
  ['S1.1', 'S5.14'],
  ['N.1', 'S5.13'],
  ['S5.13', 'S1.13'],
  ['S1.13', 'S6.13'],
  ['S6.13', 'S2.13'],
  ['S2.13', 'TB_PL.1-'],
  ['S2.1', 'S5.9'],
  ['S5.5', 'S1.14'],
  ['S1.10', 'S6.14'],
  ['S6.9', 'S2.14'],
  ['S1.12', 'TB_PL.1+'],
];

/** 配線できる端子（並びは盤定義どおり＝決定論）。 */
const WIRABLE = board.terminals.filter((term) => term.wirable).map((term) => term.id);

/** 折れ線の1区間。`axis` は動いている軸（直角経路なのでちょうど1つ）。 */
interface Segment {
  wireId: string;
  axis: 'x' | 'y' | 'z';
  lo: number;
  hi: number;
  a: Vec3;
  b: Vec3;
}

function segmentsOf(r: WireRoute): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < r.corners.length; i += 1) {
    const a = r.corners[i - 1];
    const b = r.corners[i];
    if (a === undefined || b === undefined) continue;
    const axis: 'x' | 'y' | 'z' =
      Math.abs(b.x - a.x) > EPS ? 'x' : Math.abs(b.y - a.y) > EPS ? 'y' : 'z';
    const va = axis === 'x' ? a.x : axis === 'y' ? a.y : a.z;
    const vb = axis === 'x' ? b.x : axis === 'y' ? b.y : b.z;
    out.push({ wireId: r.wireId, axis, lo: Math.min(va, vb), hi: Math.max(va, vb), a, b });
  }
  return out;
}

/** 配線帯の中を走る1区間（スロットは実座標から読みなおしたもの）。 */
interface BandRun {
  wireId: string;
  slot: string;
  lo: number;
  hi: number;
}

/**
 * 折れ点の実座標からスロットの占有を読みなおす。
 * 区間が丸ごと帯の矩形の中にあり、レーンの線の上で、レイヤの高さに載っているものだけを数える
 * （端子からの引き出しは帯からはみ出すので対象外）。
 */
function bandRuns(routes: readonly WireRoute[]): BandRun[] {
  const out: BandRun[] = [];
  for (const r of routes) {
    for (const s of segmentsOf(r)) {
      if (s.axis === 'z') continue;
      for (const channel of board.wiringChannels) {
        if (s.axis !== channel.axis) continue;
        const band = channelBandRect(channel);
        const inside = [s.a, s.b].every(
          (p) =>
            p.x >= band.x - EPS &&
            p.x <= band.x + band.w + EPS &&
            p.y >= band.y - EPS &&
            p.y <= band.y + band.h + EPS,
        );
        if (!inside) continue;
        const perp = channel.axis === 'x' ? s.a.y : s.a.x;
        const direction = CHANNEL_LANE_DIRECTION[channel.id] ?? 1;
        let lane = -1;
        for (let l = 0; l < CHANNEL_LANE_COUNT; l += 1) {
          const at = channel.at + l * CHANNEL_LANE_PITCH_MM * direction;
          if (Math.abs(perp - at) < EPS) lane = l;
        }
        if (lane < 0) continue;
        let layer = -1;
        for (let m = 0; m < WIRE_LAYER_COUNT; m += 1) {
          if (Math.abs(s.a.z - runZ(channel.axis, m)) < EPS) layer = m;
        }
        if (layer < 0) continue;
        out.push({ wireId: r.wireId, slot: `${channel.id}:${lane}:${layer}`, lo: s.lo, hi: s.hi });
      }
    }
  }
  return out;
}

/** 同じスロットを重なって走る組（`laneOverflow` を立てた電線が絡むものは除く）。 */
function slotClashes(routes: readonly WireRoute[]): string[] {
  const flagged = new Set(routes.filter((r) => r.laneOverflow).map((r) => r.wireId));
  const runs = bandRuns(routes);
  const clashes: string[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const a = runs[i];
      const b = runs[j];
      if (a === undefined || b === undefined) continue;
      if (a.wireId === b.wireId || a.slot !== b.slot) continue;
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) <= EPS) continue;
      if (flagged.has(a.wireId) || flagged.has(b.wireId)) continue;
      clashes.push(`${a.slot}: ${a.wireId}[${a.lo},${a.hi}] × ${b.wireId}[${b.lo},${b.hi}]`);
    }
  }
  return clashes;
}

/**
 * 同じ直線に重なって走り、管（直径 {@link WIRE_DIAMETER_MM}）が1本に見えてしまう組。
 * 同じ軸・同じ垂直座標・高さの差が管の直径未満・区間が重なる、の4条件。
 */
function collinearMerges(routes: readonly WireRoute[]): string[] {
  const segments = routes.flatMap(segmentsOf).filter((s) => s.axis !== 'z');
  const merges: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const a = segments[i];
      const b = segments[j];
      if (a === undefined || b === undefined) continue;
      if (a.wireId === b.wireId || a.axis !== b.axis) continue;
      const perpA = a.axis === 'x' ? a.a.y : a.a.x;
      const perpB = b.axis === 'x' ? b.a.y : b.a.x;
      if (Math.abs(perpA - perpB) > EPS) continue;
      if (Math.abs(a.a.z - b.a.z) + EPS >= WIRE_DIAMETER_MM) continue;
      const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
      if (overlap <= EPS) continue;
      merges.push(
        `${a.axis}@${perpA} z=${a.a.z} ${a.wireId} × ${b.wireId} (${overlap.toFixed(1)}mm)`,
      );
    }
  }
  return merges;
}

/** 直交する走行のうち、管が食い込むほど高さが近い組。 */
function tubeCrossings(routes: readonly WireRoute[]): { examined: number; bad: string[] } {
  const segments = routes.flatMap(segmentsOf).filter((s) => s.axis !== 'z');
  const bad: string[] = [];
  let examined = 0;
  const within = (v: number, lo: number, hi: number): boolean => v >= lo - EPS && v <= hi + EPS;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const a = segments[i];
      const b = segments[j];
      if (a === undefined || b === undefined) continue;
      if (a.wireId === b.wireId || a.axis === b.axis) continue;
      const xRun = a.axis === 'x' ? a : b;
      const yRun = a.axis === 'x' ? b : a;
      if (!within(yRun.a.x, xRun.lo, xRun.hi)) continue;
      if (!within(xRun.a.y, yRun.lo, yRun.hi)) continue;
      examined += 1;
      if (Math.abs(xRun.a.z - yRun.a.z) >= WIRE_DIAMETER_MM - EPS) continue;
      bad.push(`${xRun.wireId}@z${xRun.a.z} × ${yRun.wireId}@z${yRun.a.z}`);
    }
  }
  return { examined, bad };
}

/** 決定論の擬似乱数（線形合同法。実装も種も固定なので毎回同じ盤が出る）。 */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('routing: スロットの実測ガード（Task 9c）', () => {
  it('作例回路の走行は、実座標で見ても同じスロットに重ならない', () => {
    let examined = 0;
    for (const routes of [routeAll(SELF_HOLD_WIRING), routeAll(FLICKER_WIRING)]) {
      examined += bandRuns(routes).length;
      expect(slotClashes(routes)).toEqual([]);
    }
    expect(examined).toBeGreaterThanOrEqual(30);
  });

  it('端子の小集合の全組み合わせ（同じ盤に同時に載せる）でもスロットが重ならない', () => {
    // 盤の端から端まで散らばるように等間隔で選ぶ（決定論）
    const picked = WIRABLE.filter((_, index) => index % 13 === 0).slice(0, 11);
    expect(picked.length).toBeGreaterThanOrEqual(10);
    const routes: WireRoute[] = [];
    for (let i = 0; i < picked.length; i += 1) {
      for (let j = i + 1; j < picked.length; j += 1) {
        const from = picked[i];
        const to = picked[j];
        if (from === undefined || to === undefined) continue;
        routes.push(routeWire(board, { id: `p-${i}-${j}`, from, to }, routes));
      }
    }
    expect(routes.length).toBeGreaterThanOrEqual(45);
    const runs = bandRuns(routes);
    expect(runs.length).toBeGreaterThanOrEqual(30);
    expect(slotClashes(routes)).toEqual([]);
  });

  it('乱数で組んだ40面ぶんの配線でも、スロットが黙って重ならない・管が食い込まない', () => {
    const random = prng(20260914);
    const clashes: string[] = [];
    const crossings: string[] = [];
    let runs = 0;
    let examinedCrossings = 0;
    let wires = 0;
    for (let batch = 0; batch < 40; batch += 1) {
      const routes: WireRoute[] = [];
      for (let i = 0; i < 16; i += 1) {
        const from = WIRABLE[Math.floor(random() * WIRABLE.length)];
        const to = WIRABLE[Math.floor(random() * WIRABLE.length)];
        if (from === undefined || to === undefined || from === to) continue;
        routes.push(routeWire(board, { id: `b${batch}-${i}`, from, to }, routes));
      }
      wires += routes.length;
      runs += bandRuns(routes).length;
      clashes.push(...slotClashes(routes).map((m) => `#${batch} ${m}`));
      const crossed = tubeCrossings(routes);
      examinedCrossings += crossed.examined;
      crossings.push(...crossed.bad.map((m) => `#${batch} ${m}`));
    }
    expect(clashes).toEqual([]);
    expect(crossings).toEqual([]);
    // 判定が空振りしていないことの担保
    expect(wires).toBeGreaterThan(500);
    expect(runs).toBeGreaterThan(500);
    expect(examinedCrossings).toBeGreaterThan(500);
  });

  it('端子の組み合わせ（決定論の部分集合・約600通り）はすべて経路になり部品を跨がない', () => {
    const picked = WIRABLE.filter((_, index) => index % 4 === 0);
    let pairs = 0;
    for (let i = 0; i < picked.length; i += 1) {
      for (let j = i + 1; j < picked.length; j += 1) {
        const from = picked[i];
        const to = picked[j];
        if (from === undefined || to === undefined) continue;
        const r = routeWire(board, { id: `a-${i}-${j}`, from, to }, []);
        expect(crossingFootprint(board, r)).toBeUndefined();
        pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(550);
  });

  it('端子からの引き出しは、同じ列・同じネジでも1本の管に見えない（レーンごとにずらす）', () => {
    // Task 9b の時点では自己保持8か所・フリッカ8か所が重なって1本に見えていた
    expect(collinearMerges(routeAll(SELF_HOLD_WIRING)).length).toBeLessThanOrEqual(1);
    expect(collinearMerges(routeAll(FLICKER_WIRING)).length).toBeLessThanOrEqual(1);
  });
});
