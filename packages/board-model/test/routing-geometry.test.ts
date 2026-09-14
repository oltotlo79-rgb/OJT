import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  channelBandRect,
  entryChannelFor,
  findBoardTerminal,
  isManhattan,
  JIPM_BOARD,
  MAX_WIRE_LANES,
  routeFixedLinks,
  routeWire,
  RoutingError,
  WIRE_DIAMETER_MM,
  WIRE_LAYER_COUNT,
  WIRE_Z_LADDER_MM,
  type Vec3,
  type WireRoute,
  type WiringChannel,
} from '../src/index.js';

const board = JIPM_BOARD;
const EPS = 1e-6;
/** 管の半径[mm]。直交する経路はこれの2倍（＝直径）以上離れていなければ食い込む。 */
const TUBE_RADIUS_MM = WIRE_DIAMETER_MM / 2;

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

/** 折れ線の1区間。`axis` は動いている軸（直角経路なのでちょうど1つ）。 */
interface Segment {
  wireId: string;
  axis: 'x' | 'y' | 'z';
  /** 動いている軸の範囲。 */
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

function within(value: number, lo: number, hi: number): boolean {
  return value >= lo - EPS && value <= hi + EPS;
}

describe('routing: 高さのはしごとレーンのスロット（Task 9b）', () => {
  it('フリッカ回路: 区間の重なる走行は必ず別スロット（レイヤ1は3本・あふれ無し）', () => {
    const routes = routeAll(FLICKER_WIRING);
    expect(routes).toHaveLength(14);
    for (const r of routes) expect(r.laneOverflow).toBe(false);

    const all = routes.flatMap((r) => r.lanes.map((lane) => ({ wireId: r.wireId, ...lane })));
    const clashes: string[] = [];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i];
        const b = all[j];
        if (a === undefined || b === undefined) continue;
        if (a.channelId !== b.channelId) continue;
        if (a.span.lo > b.span.hi + EPS || b.span.lo > a.span.hi + EPS) continue;
        if (a.lane !== b.lane || a.layer !== b.layer) continue;
        clashes.push(`${a.channelId} ${a.lane}:${a.layer} ${a.wireId} × ${b.wireId}`);
      }
    }
    expect(clashes).toEqual([]);
    // どのレーンも 0..7、レイヤは 0..1
    for (const lane of all) {
      expect(lane.lane).toBeGreaterThanOrEqual(0);
      expect(lane.lane).toBeLessThan(MAX_WIRE_LANES);
      expect(lane.layer).toBeGreaterThanOrEqual(0);
      expect(lane.layer).toBeLessThan(WIRE_LAYER_COUNT);
    }
    // ch-mid が混むので、はみ出したぶんが上のレイヤへ逃げている
    expect(all.filter((lane) => lane.layer === 1)).toHaveLength(3);
  });

  it('直交する走行区間は必ず 1.6mm 以上高さが違う（管が食い込まない）', () => {
    const routes = [
      ...routeAll(SELF_HOLD_WIRING),
      ...routeAll(FLICKER_WIRING),
      ...routeFixedLinks(board),
    ];
    const segments = routes.flatMap(segmentsOf).filter((s) => s.axis !== 'z');
    const violations: string[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 1; j < segments.length; j += 1) {
        const a = segments[i];
        const b = segments[j];
        if (a === undefined || b === undefined) continue;
        if (a.wireId === b.wireId) continue;
        if (a.axis === b.axis) continue;
        const xRun = a.axis === 'x' ? a : b;
        const yRun = a.axis === 'x' ? b : a;
        if (!within(yRun.a.x, xRun.lo, xRun.hi)) continue;
        if (!within(xRun.a.y, yRun.lo, yRun.hi)) continue;
        if (Math.abs(xRun.a.z - yRun.a.z) >= WIRE_DIAMETER_MM - EPS) continue;
        violations.push(
          `${xRun.wireId}@z${xRun.a.z} × ${yRun.wireId}@z${yRun.a.z} at (${yRun.a.x},${xRun.a.y})`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('配線帯の中では、同じ高さ・同じレーンを重なって走る区間が無い', () => {
    // 帯の中を帯に沿って走る区間だけを見る（端子からの引き出しは帯からはみ出すので対象外）
    const runsInBand = (channel: WiringChannel, s: Segment): boolean => {
      if (s.axis !== channel.axis) return false;
      const band = channelBandRect(channel);
      return [s.a, s.b].every(
        (p) =>
          p.x >= band.x - EPS &&
          p.x <= band.x + band.w + EPS &&
          p.y >= band.y - EPS &&
          p.y <= band.y + band.h + EPS,
      );
    };
    const overlaps: string[] = [];
    let examined = 0;
    // レーンは同じ盤面に同時に載る配線のあいだで分ける。回路ごとに別々に見る
    for (const routes of [routeAll(SELF_HOLD_WIRING), routeAll(FLICKER_WIRING)]) {
      const segments = routes.flatMap(segmentsOf);
      for (const channel of board.wiringChannels) {
        const runs = segments.filter((s) => runsInBand(channel, s));
        examined += runs.length;
        for (let i = 0; i < runs.length; i += 1) {
          for (let j = i + 1; j < runs.length; j += 1) {
            const a = runs[i];
            const b = runs[j];
            if (a === undefined || b === undefined) continue;
            if (a.wireId === b.wireId) continue;
            const perpA = channel.axis === 'x' ? a.a.y : a.a.x;
            const perpB = channel.axis === 'x' ? b.a.y : b.a.x;
            if (Math.abs(perpA - perpB) > EPS) continue;
            if (Math.abs(a.a.z - b.a.z) > EPS) continue;
            if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) <= EPS) continue;
            overlaps.push(`${channel.id}: ${a.wireId} × ${b.wireId}`);
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
    // 帯の中の走行をちゃんと拾えている（判定が空振りしていないことの担保）
    expect(examined).toBeGreaterThan(30);
  });

  it('レイヤ1に載る経路も直角のまま（高さの変わる角に z だけ動く点が入る）', () => {
    const routes: WireRoute[] = [];
    for (let i = 0; i < 9; i += 1) {
      routes.push(route(`w-${i}`, 'S1.13', 'S8.14', routes));
    }
    for (const r of routes) {
      expect(isManhattan(r.corners)).toBe(true);
      expect(r.laneOverflow).toBe(false);
    }
    const last = routes[8];
    if (last === undefined) throw new Error('route');
    const mid = last.lanes.find((lane) => lane.channelId === 'ch-mid');
    expect(mid?.layer).toBe(1);
    expect(mid?.lane).toBe(0);
    // 帯の中の走行は上の段（6.0mm）に載っている
    const midRun = segmentsOf(last).find((s) => s.axis === 'x' && s.hi - s.lo > 100);
    expect(midRun?.a.z).toBeCloseTo(WIRE_Z_LADDER_MM[2], 6);
    // 引き出し（y方向・4.2mm）から帯（6.0mm）へ上がる、z だけ動く点がある
    const hops = segmentsOf(last).filter(
      (s) =>
        s.axis === 'z' &&
        Math.min(s.a.z, s.b.z) > WIRE_Z_LADDER_MM[0] &&
        Math.max(s.a.z, s.b.z) < 8,
    );
    expect(hops.length).toBeGreaterThanOrEqual(2);
    for (const hop of hops) {
      expect(Math.abs(hop.hi - hop.lo)).toBeCloseTo(WIRE_Z_LADDER_MM[2] - WIRE_Z_LADDER_MM[1], 6);
    }
  });

  it('渡り線の段は配線帯に入らず、x区間が離れていれば段0を使い回す', () => {
    // 端子台 TB_PL の同じ列で x 区間が互いに重なる渡り線を6本
    const pairs: ReadonlyArray<[string, string]> = [
      ['TB_PL.1+', 'TB_PL.4-'],
      ['TB_PL.1-', 'TB_PL.4+'],
      ['TB_PL.2+', 'TB_PL.3-'],
      ['TB_PL.2-', 'TB_PL.3+'],
      ['TB_PL.1+', 'TB_PL.3+'],
      ['TB_PL.1-', 'TB_PL.4-'],
    ];
    const routes = routeAll(pairs);
    expect(routes.map((r) => r.kind)).toEqual([
      'direct',
      'direct',
      'direct',
      'channel',
      'channel',
      'channel',
    ]);
    expect(routes.slice(0, 3).map((r) => r.lane)).toEqual([0, 1, 2]);
    // 渡り線は配線帯（管の半径ぶん広げた帯）に入らない
    const bands = board.wiringChannels.map((c) => channelBandRect(c));
    for (const r of routes.filter((x) => x.kind === 'direct')) {
      for (const p of r.corners) {
        for (const band of bands) {
          const inside =
            p.x > band.x - TUBE_RADIUS_MM &&
            p.x < band.x + band.w + TUBE_RADIUS_MM &&
            p.y > band.y - TUBE_RADIUS_MM &&
            p.y < band.y + band.h + TUBE_RADIUS_MM;
          expect(inside).toBe(false);
        }
      }
    }
    // 別の端子台（x が離れている）の渡り線は段を上げない
    const pb = route('j-pb', 'TB_PB.1c', 'TB_PB.2b');
    const pl = route('j-pl', 'TB_PL.1+', 'TB_PL.2-', [pb]);
    expect(pb.kind).toBe('direct');
    expect(pl.kind).toBe('direct');
    expect(pb.lane).toBe(0);
    expect(pl.lane).toBe(0);
    // 既設ハーネス（端子台の列から手前へ降りる）は渡り線として数えない
    const withHarness = route('j-pl', 'TB_PL.1+', 'TB_PL.2-', routeFixedLinks(board));
    expect(withHarness).toEqual(pl);
  });

  it('張り出しが配線帯の帯に届く渡り線は、段を上げずに配線帯の経路へ逃がす', () => {
    // ソケットの奥ティア（y=66）は ch-top の帯（42〜58mm）が近い。
    // 段2（y=57）は管の太さを入れると帯に食い込むので、そこで配線帯にフォールバックする。
    const routes = routeAll([
      ['S1.1', 'S1.3'],
      ['S1.1', 'S1.2'],
      ['S1.2', 'S1.3'],
    ]);
    expect(routes.map((r) => r.kind)).toEqual(['direct', 'direct', 'channel']);
    expect(routes.slice(0, 2).map((r) => r.lane)).toEqual([0, 1]);
    const chTop = board.wiringChannels.find((c) => c.id === 'ch-top');
    if (chTop === undefined) throw new Error('ch-top');
    const band = channelBandRect(chTop);
    for (const r of routes.slice(0, 2)) {
      expect(Math.min(...r.corners.map((c) => c.y))).toBeGreaterThan(
        band.y + band.h + TUBE_RADIUS_MM,
      );
    }
    expect(routes[2]?.channelIds).toContain('ch-top');
  });

  it('同じ節点に出る2端子でも、部品の上を通るなら RoutingError', () => {
    const blocked = {
      ...board,
      footprints: [
        ...board.footprints,
        { id: 'blocker', kind: 'block' as const, x: 18, y: 18, w: 4, h: 8 },
      ],
    };
    expect(() => routeWire(blocked, { id: 'w-b', from: t('P.1'), to: t('N.1') }, [])).toThrow(
      RoutingError,
    );
  });

  it('前後どちらにも出られる端子（BZ）は近いほうの配線帯へ出る', () => {
    const bz = findBoardTerminal(board, t('BZ.+'));
    if (bz === undefined) throw new Error('BZ.+');
    expect(bz.exit).toBe('either');
    // BZ は y=168。ch-mid(142) より ch-low(178) のほうが近い
    expect(entryChannelFor(board, bz)?.id).toBe('ch-low');
    const r = route('w-bz', 'BZ.+', 'TB_PL.4-');
    expect(isManhattan(r.corners)).toBe(true);
    expect(r.channelIds).toContain('ch-low');
  });

  it('電線を1本足しても、先に引いた経路は1点も変わらない', () => {
    const before = routeAll(FLICKER_WIRING);
    const after = [...before];
    after.push(route('w-extra', 'S3.1', 'S7.13', after));
    expect(after.slice(0, before.length)).toEqual(before);
    // 追加ぶんも決定論
    expect(route('w-extra', 'S3.1', 'S7.13', before)).toEqual(after[before.length]);
  });

  it('同じ節点に出る2端子は往復せずまっすぐ渡る（P.1 → N.1）', () => {
    const r = route('w-1', 'P.1', 'N.1');
    expect(isManhattan(r.corners)).toBe(true);
    expect(r.corners.length).toBeLessThanOrEqual(5);
    expect(r.kind).toBe('channel');
    expect(r.lanes).toEqual([]);
    // 折り返しが無い（隣り合う進行方向の内積が負にならない）
    const dirs: Vec3[] = [];
    for (let i = 1; i < r.corners.length; i += 1) {
      const a = r.corners[i - 1];
      const b = r.corners[i];
      if (a === undefined || b === undefined) continue;
      dirs.push({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    }
    for (let i = 1; i < dirs.length; i += 1) {
      const u = dirs[i - 1];
      const v = dirs[i];
      if (u === undefined || v === undefined) continue;
      expect(u.x * v.x + u.y * v.y + u.z * v.z).toBeGreaterThanOrEqual(0);
    }
    // 端子の外（y=42 の配線帯）まで出ない
    expect(Math.max(...r.corners.map((c) => c.y))).toBeLessThanOrEqual(30 + EPS);
  });

  it('RoutingError は電線IDと理由を持つ', () => {
    const caught = (run: () => unknown): RoutingError => {
      try {
        run();
      } catch (error) {
        if (error instanceof RoutingError) return error;
        throw error;
      }
      throw new Error('RoutingError が投げられませんでした');
    };

    const missing = caught(() => route('w-missing', 'ZZ.1', 'P.1'));
    expect(missing.reason).toBe('invalid-terminal');
    expect(missing.wireId).toBe('w-missing');
    expect(missing.message).toContain('w-missing');

    const noChannels = { ...board, wiringChannels: [] };
    const unreachable = caught(() =>
      routeWire(noChannels, { id: 'w-nc', from: t('P.1'), to: t('S1.1') }, []),
    );
    expect(unreachable.reason).toBe('unreachable');
    expect(unreachable.wireId).toBe('w-nc');

    const split = {
      ...board,
      wiringChannels: board.wiringChannels.filter((c) => c.id === 'ch-top' || c.id === 'ch-low'),
    };
    const disconnected = caught(() =>
      routeWire(split, { id: 'w-split', from: t('P.1'), to: t('PL1.+') }, []),
    );
    expect(disconnected.reason).toBe('unreachable');
    expect(disconnected.wireId).toBe('w-split');

    const bad = {
      ...board,
      wiringChannels: [
        { id: 'ch-bad', axis: 'x' as const, at: 100, from: 10, to: 322, zMm: WIRE_Z_LADDER_MM[0] },
      ],
    };
    const crossing = caught(() =>
      routeWire(bad, { id: 'w-bad', from: t('P.1'), to: t('TB_PL.1+') }, []),
    );
    expect(crossing.reason).toBe('footprint-crossing');
    expect(crossing.wireId).toBe('w-bad');
    expect(crossing.message).toContain('w-bad');
  });

  it('スロットを使い切っても投げず、laneOverflow を立てて最も空いたスロットを使う', () => {
    const routes: WireRoute[] = [];
    for (let i = 0; i < MAX_WIRE_LANES * WIRE_LAYER_COUNT + 1; i += 1) {
      routes.push(route(`w-${i}`, 'S1.13', 'S8.14', routes));
    }
    expect(routes).toHaveLength(17);
    for (let i = 0; i < 16; i += 1) expect(routes[i]?.laneOverflow).toBe(false);
    const last = routes[16];
    if (last === undefined) throw new Error('route');
    expect(last.laneOverflow).toBe(true);
    expect(isManhattan(last.corners)).toBe(true);
    // 同点なら最小のスロット（レイヤ0・レーン0）
    expect(last.lanes.find((lane) => lane.channelId === 'ch-mid')).toMatchObject({
      lane: 0,
      layer: 0,
    });
  });
});
