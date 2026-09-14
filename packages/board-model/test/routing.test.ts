import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  addWire,
  boardTerminalPos,
  channelsClearOfFootprints,
  createSession,
  crossesFootprint,
  crossingFootprint,
  entryChannelFor,
  filletCorners,
  findBoardTerminal,
  isManhattan,
  JIPM_BOARD,
  MAX_WIRE_LANES,
  pickLane,
  plug,
  routeFixedLinks,
  routeSession,
  routeWire,
  RoutingError,
  segmentIntersectsRect,
  vec3,
  WIRE_LANE_PITCH_MM,
  type WireRoute,
} from '../src/index.js';

const board = JIPM_BOARD;

function t(id: string): TerminalId {
  return id as TerminalId;
}

function route(id: string, from: string, to: string, existing: WireRoute[] = []): WireRoute {
  return routeWire(board, { id, from: t(from), to: t(to) }, existing);
}

/** 自己保持回路ぶんの配線（役割端子ではなく物理端子で書く）。 */
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

/** フリッカ回路ぶんの配線（左右のクラスタをまたぐ）。 */
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

function routeAll(pairs: ReadonlyArray<[string, string]>): WireRoute[] {
  const routes: WireRoute[] = [];
  pairs.forEach(([from, to], index) => {
    routes.push(route(`w-${index}`, from, to, routes));
  });
  return routes;
}

describe('routing: 直角配線（§6.6 / 写真にダクトは無い）', () => {
  it('配線帯は部品の占有領域と重ならない（レーンの広がりを含む）', () => {
    expect(channelsClearOfFootprints(board)).toEqual([]);
  });

  it('端子 → 配線帯 → 端子 の直角経路を返す', () => {
    const r = route('w-1', 'TB_PB.1c', 'S1.9');
    expect(r.corners[0]).toEqual(boardTerminalPos(board, 'TB_PB.1c'));
    expect(r.corners[r.corners.length - 1]).toEqual(boardTerminalPos(board, 'S1.9'));
    expect(isManhattan(r.corners)).toBe(true);
    expect(r.channelIds.length).toBeGreaterThan(0);
    expect(r.lane).toBe(0);
    expect(r.lengthMm).toBeGreaterThan(0);
    expect(crossesFootprint(board, r)).toBe(false);
  });

  it('ソケットのネジ端子は本体の上端／下端の向きに引き出される', () => {
    const upper = findBoardTerminal(board, 'S1.1');
    const lower = findBoardTerminal(board, 'S1.13');
    if (upper === undefined || lower === undefined) throw new Error('terminal');
    expect(upper.exit).toBe('rear');
    expect(lower.exit).toBe('front');
    expect(entryChannelFor(board, upper)?.id).toBe('ch-top');
    expect(entryChannelFor(board, lower)?.id).toBe('ch-mid');
  });

  it('同じ列の隣り合う端子は配線帯を使わず短い渡り線で結ぶ（調査資料 §4.5）', () => {
    const jumper = route('w-1', 'TB_PB.2b', 'TB_PB.1c');
    expect(jumper.channelIds).toEqual([]);
    expect(isManhattan(jumper.corners)).toBe(true);
    expect(crossingFootprint(board, jumper)).toBeUndefined();
    // 端子台の列から少し張り出すだけで、配線帯（ch-mid / ch-low）までは行かない
    const ys = jumper.corners.map((c) => c.y);
    expect(Math.min(...ys)).toBeGreaterThan(142);
    expect(Math.max(...ys)).toBeLessThan(198);
    // x区間の重なる渡り線が増えると張り出し量が2mmずつ変わる
    const second = route('w-2', 'TB_PB.2c', 'TB_PB.3b', [jumper]);
    expect(second.channelIds).toEqual([]);
    expect(second.lane).toBe(1);
    const jogOf = (r: WireRoute): number => Math.min(...r.corners.map((c) => c.y));
    expect(jogOf(jumper) - jogOf(second)).toBeCloseTo(WIRE_LANE_PITCH_MM, 6);
    // ソケットの同じティア（⑬と⑭）も渡り線になる
    const coil = route('w-3', 'S1.13', 'S1.14');
    expect(coil.channelIds).toEqual([]);
    // ティアをまたぐ場合は差込穴の上を通らないよう配線帯を使う
    const across = route('w-4', 'S1.1', 'S1.13');
    expect(across.channelIds.length).toBeGreaterThan(0);
    // 別の部品どうしは配線帯を使う
    expect(route('w-5', 'TB_PB.1c', 'S1.9').channelIds.length).toBeGreaterThan(0);
  });

  it('同じ入力からは必ず同じ経路（決定論）', () => {
    expect(route('w-1', 'TB_PL.1+', 'S8.14')).toEqual(route('w-1', 'TB_PL.1+', 'S8.14'));
  });

  it('同じ帯を通る電線は2mmピッチで別レーンに割り当てられる', () => {
    const first = route('w-1', 'P.1', 'S1.1');
    const second = route('w-2', 'N.1', 'S2.1', [first]);
    const third = route('w-3', 'PS.+', 'S3.1', [first, second]);
    expect([first.lane, second.lane, third.lane]).toEqual([0, 1, 2]);
    const runY = (r: WireRoute): number => {
      const p = r.corners.find((c) => Math.abs(c.y - 42) < 12 && c.z < 5);
      return p?.y ?? -1;
    };
    expect(runY(second) - runY(first)).toBeCloseTo(WIRE_LANE_PITCH_MM, 6);
    expect(runY(third) - runY(second)).toBeCloseTo(WIRE_LANE_PITCH_MM, 6);
  });

  it('レーンを使い切ると上のレイヤ（高さの段）へ逃げる', () => {
    const existing: WireRoute[] = [];
    for (let i = 0; i < MAX_WIRE_LANES + 1; i += 1) {
      existing.push(route(`w-${i}`, 'P.1', 'S1.1', existing));
    }
    expect(existing.slice(0, MAX_WIRE_LANES).map((r) => r.lane)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const r of existing) expect(r.laneOverflow).toBe(false);
    const ninth = existing[MAX_WIRE_LANES];
    if (ninth === undefined) throw new Error('route');
    expect(ninth.lanes.map((l) => `${l.channelId}:${l.lane}:${l.layer}`)).toEqual(['ch-top:0:1']);
    expect(ninth.lane).toBe(0);
  });

  it('自己保持回路の全配線が部品の上を通らず、直角でレーンも重ならない', () => {
    const routes = routeAll(SELF_HOLD_WIRING);
    expect(routes).toHaveLength(SELF_HOLD_WIRING.length);
    for (const r of routes) {
      expect(isManhattan(r.corners)).toBe(true);
      expect(crossingFootprint(board, r)).toBeUndefined();
    }
    // 同じ帯の同じ区間を走る経路どうしはレーン／レイヤが違う（区間が離れていれば同じでよい）
    const slots = routes.flatMap((r) => r.lanes.map((lane) => ({ wireId: r.wireId, ...lane })));
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const a = slots[i];
        const b = slots[j];
        if (a === undefined || b === undefined) continue;
        if (a.wireId === b.wireId) continue;
        if (a.channelId !== b.channelId) continue;
        if (a.span.lo >= b.span.hi || b.span.lo >= a.span.hi) continue;
        expect(`${a.lane}:${a.layer}`).not.toBe(`${b.lane}:${b.layer}`);
      }
    }
  });

  it('フリッカ回路（左右クラスタをまたぐ）の全配線も部品の上を通らない', () => {
    const routes = routeAll(FLICKER_WIRING);
    expect(routes).toHaveLength(FLICKER_WIRING.length);
    for (const r of routes) {
      expect(isManhattan(r.corners)).toBe(true);
      expect(crossingFootprint(board, r)).toBeUndefined();
    }
  });

  it('既設の青線ハーネスは機器の真上から降り、貫通穴で盤面を抜ける（§6.4 / 写真）', () => {
    const routes = routeFixedLinks(board);
    // PB 12本 ＋ PL 8本。P/N供給端子どうしのリンクは筐体内なので描かない
    expect(routes).toHaveLength(20);
    for (const r of routes) {
      expect(isManhattan(r.corners)).toBe(true);
      expect(crossingFootprint(board, r)).toBeUndefined();
      expect(r.throughPanelAt).toBeDefined();
      expect(r.channelIds).toEqual([]);
      expect(r.kind).toBe('harness');
      expect(r.laneOverflow).toBe(false);
    }
    // PL1 の2本は PL1 の貫通穴に2mmピッチで入り、機器の中心は通らない
    const pl1 = routes.filter((r) => r.wireId.startsWith('lk-pl-1'));
    expect(pl1).toHaveLength(2);
    const lamp = board.lamps[0];
    if (lamp === undefined) throw new Error('PL1');
    for (const r of pl1) {
      expect(r.throughPanelAt?.y).toBe(lamp.panelHole.y);
      expect(Math.abs((r.throughPanelAt?.x ?? 0) - lamp.panelHole.x)).toBeLessThanOrEqual(
        WIRE_LANE_PITCH_MM,
      );
      // 機器の中心（レンズの真上）を通らない
      for (let i = 1; i < r.corners.length; i += 1) {
        const a = r.corners[i - 1];
        const b = r.corners[i];
        if (a === undefined || b === undefined) continue;
        if (a.z <= 0 || b.z <= 0) continue; // 盤面より下（機器の内側）は対象外
        expect(
          segmentIntersectsRect(a, b, { x: lamp.pos.x - 6, y: lamp.pos.y - 6, w: 12, h: 12 }),
        ).toBe(false);
      }
    }
    const holes = new Set(
      routes.filter((r) => r.wireId.startsWith('lk-pb-1')).map((r) => r.throughPanelAt?.x),
    );
    expect(holes.size).toBe(3);
  });

  it('セッションの全電線を並び順に経路化する', () => {
    const session = createSession(board);
    expect(plug(session, 'S7', 'relay-my4n').ok).toBe(true);
    expect(addWire(session, board, t('P.1'), t('TB_PB.1c')).ok).toBe(true);
    const routes = routeSession(board, session);
    expect(routes).toHaveLength(session.wires.length);
    expect(routes.map((r) => r.wireId)).toEqual(['fw-chk-1', 'fw-chk-2', 'fw-chk-3', 'w-001']);
    // 役割端子（CHK.14）が物理端子（S7.14）に解決されている
    const chk = routes[1];
    if (chk === undefined) throw new Error('route');
    expect(chk.corners[chk.corners.length - 1]).toEqual(boardTerminalPos(board, 'S7.14'));
    for (const r of routes) expect(crossingFootprint(board, r)).toBeUndefined();
    expect(routeSession(board, session)).toEqual(routes);
  });

  it('盤に無い端子は RoutingError', () => {
    expect(() => route('w-1', 'ZZ.1', 'P.1')).toThrow(RoutingError);
  });

  it('フィレットは角を丸め、両端の点は動かさない', () => {
    const corners = [vec3(0, 0, 0), vec3(0, 40, 0), vec3(40, 40, 0)];
    const filleted = filletCorners(corners, 6);
    expect(filleted[0]).toEqual(corners[0]);
    expect(filleted[filleted.length - 1]).toEqual(corners[2]);
    expect(filleted.length).toBeGreaterThan(corners.length);
    expect(isManhattan(filleted)).toBe(false);
    expect(filletCorners([vec3(0, 0, 0), vec3(10, 0, 0)], 6)).toHaveLength(2);
  });

  it('レーンは帯ごとの占有区間が重なるときだけ分ける', () => {
    expect(pickLane([{ channelId: 'ch-mid', lo: 0, hi: 10 }], [])).toEqual({
      lanes: [{ channelId: 'ch-mid', lane: 0, layer: 0, span: { lo: 0, hi: 10 } }],
      overflow: false,
    });
    const occupy = (lane: number, layer: number): WireRoute => ({
      wireId: `x${layer}-${lane}`,
      kind: 'channel',
      points: [],
      corners: [],
      channelIds: ['ch-mid'],
      channelSpans: [{ channelId: 'ch-mid', lo: 0, hi: 100 }],
      lanes: [{ channelId: 'ch-mid', lane, layer, span: { lo: 0, hi: 100 } }],
      lane,
      laneOverflow: false,
      lengthMm: 0,
    });
    const layer0: WireRoute[] = [0, 1, 2, 3, 4, 5, 6, 7].map((lane) => occupy(lane, 0));
    // レーンが埋まったら上のレイヤへ
    expect(pickLane([{ channelId: 'ch-mid', lo: 0, hi: 100 }], layer0)).toEqual({
      lanes: [{ channelId: 'ch-mid', lane: 0, layer: 1, span: { lo: 0, hi: 100 } }],
      overflow: false,
    });
    const busy = [...layer0, ...[0, 1, 2, 3, 4, 5, 6, 7].map((lane) => occupy(lane, 1))];
    // 全スロットが埋まっても投げず、いちばん空いたスロット（同点なら最小）に載せて印を付ける
    expect(pickLane([{ channelId: 'ch-mid', lo: 0, hi: 100 }], busy)).toEqual({
      lanes: [{ channelId: 'ch-mid', lane: 0, layer: 0, span: { lo: 0, hi: 100 } }],
      overflow: true,
    });
    // 区間が離れていればレーン0を再利用できる
    expect(pickLane([{ channelId: 'ch-mid', lo: 200, hi: 300 }], busy).lanes[0]).toMatchObject({
      lane: 0,
      layer: 0,
    });
    // 別の帯なら干渉しない
    expect(pickLane([{ channelId: 'ch-top', lo: 0, hi: 100 }], busy).lanes[0]).toMatchObject({
      lane: 0,
      layer: 0,
    });
    // 端が触れるだけでも重なりとみなす（管がぶつかるので）
    expect(pickLane([{ channelId: 'ch-mid', lo: 100, hi: 200 }], layer0).lanes[0]).toMatchObject({
      lane: 0,
      layer: 1,
    });
    // 同じ電線の中でも、重なる区間どうしは別スロットになる
    const pair = pickLane(
      [
        { channelId: 'ch-mid', lo: 0, hi: 50 },
        { channelId: 'ch-mid', lo: 40, hi: 90 },
      ],
      [],
    );
    expect(pair.lanes.map((l) => l.lane)).toEqual([0, 1]);
  });

  it('引き出し向きは端子ごとに強制できる（既設ハーネス用）', () => {
    const tb = findBoardTerminal(board, 'TB_PL.1+');
    if (tb === undefined) throw new Error('TB_PL.1+');
    expect(entryChannelFor(board, tb)?.id).toBe('ch-mid');
    expect(entryChannelFor(board, tb, 'front')?.id).toBe('ch-low');
    expect(entryChannelFor(board, tb, 'rear')?.id).toBe('ch-mid');
    const bodyTerminal = findBoardTerminal(board, 'PL1.+');
    if (bodyTerminal === undefined) throw new Error('PL1.+');
    expect(entryChannelFor(board, bodyTerminal)?.id).toBe('ch-low');
  });

  it('配線帯が無い盤では経路を作れない', () => {
    const noChannels = { ...board, wiringChannels: [] };
    expect(() => routeWire(noChannels, { id: 'w', from: t('P.1'), to: t('N.1') }, [])).toThrow(
      RoutingError,
    );
    const split = {
      ...board,
      wiringChannels: board.wiringChannels.filter((c) => c.id === 'ch-top' || c.id === 'ch-low'),
    };
    expect(() => routeWire(split, { id: 'w', from: t('P.1'), to: t('PL1.+') }, [])).toThrow(
      RoutingError,
    );
  });

  it('部品の上を通ってしまう配線帯では経路生成が失敗する（迂回できないとき）', () => {
    const bad = {
      ...board,
      wiringChannels: [{ id: 'ch-bad', axis: 'x' as const, at: 100, from: 10, to: 322, zMm: 3.5 }],
    };
    expect(() => routeWire(bad, { id: 'w', from: t('P.1'), to: t('TB_PL.1+') }, [])).toThrow(
      RoutingError,
    );
  });

  it('部品の上を通る経路は検出できる', () => {
    const bogus: WireRoute = {
      wireId: 'bogus',
      kind: 'channel',
      points: [vec3(0, 100, 3.5), vec3(330, 100, 3.5)],
      corners: [vec3(0, 100, 3.5), vec3(330, 100, 3.5)],
      channelIds: [],
      channelSpans: [],
      lanes: [],
      lane: 0,
      laneOverflow: false,
      lengthMm: 330,
    };
    expect(crossesFootprint(board, bogus)).toBe(true);
    expect(crossingFootprint(board, bogus)?.kind).toBe('socket');
  });

  it('配線帯が部品と重なる盤は検出できる（盤定義の回帰防止）', () => {
    const bad = {
      ...board,
      wiringChannels: [{ id: 'ch-bad', axis: 'x' as const, at: 100, from: 10, to: 320, zMm: 3.5 }],
    };
    expect(channelsClearOfFootprints(bad).length).toBeGreaterThan(0);
  });

  it('フィレット半径0では折れ点をそのまま返す', () => {
    const corners = [vec3(0, 0, 0), vec3(0, 40, 0), vec3(40, 40, 0)];
    expect(filletCorners(corners, 0)).toEqual(corners);
  });

  it('線分と矩形の交差判定（境界に接するだけは交差としない）', () => {
    const rect = { x: 10, y: 10, w: 20, h: 20 };
    expect(segmentIntersectsRect(vec3(0, 20), vec3(40, 20), rect)).toBe(true);
    expect(segmentIntersectsRect(vec3(0, 10), vec3(40, 10), rect)).toBe(false);
    expect(segmentIntersectsRect(vec3(0, 0), vec3(40, 0), rect)).toBe(false);
    expect(segmentIntersectsRect(vec3(20, 0), vec3(20, 40), rect)).toBe(true);
    expect(segmentIntersectsRect(vec3(0, 0), vec3(5, 5), rect)).toBe(false);
  });
});
