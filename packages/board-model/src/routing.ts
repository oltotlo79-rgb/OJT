import type { TerminalId } from '@ojt/circuit-sim';
import {
  CHANNEL_LANE_DIRECTION,
  findBoardTerminal,
  HARNESS_APPROACH_MM,
  HARNESS_PITCH_MM,
  WIRE_RUN_Z_MM,
  type BoardDefinition,
  type BoardTerminal,
  type Footprint,
  type WiringChannel,
} from './board-jipm.js';
import {
  distance,
  polylineLength,
  rectContains,
  roundVec,
  segmentIntersectsRect,
  vec3,
  vecEquals,
  type Vec3,
} from './geometry.js';
import { toPhysicalTerminal } from './roles.js';
import type { BoardSession } from './session.js';

/**
 * 電線の自動経路生成。設計仕様 §6.6。
 *
 * 実物（写真）には配線ダクトが無いが、電線は盤面の上を**直角**に整列して走っている。
 * そこで盤定義に「配線帯」（見えないガイド。機器の列と列のあいだ）を置き、
 * 端子 → 盤面に垂直に引き出す → 最寄りの配線帯 → 帯の中を直角に走る → 目的端子の列で曲がる → 端子
 * という経路を作る。並走する電線は帯の幅方向に2mmピッチでレーンを割り当て、曲がり角は
 * 半径6mmのフィレットで丸める。純関数・決定論（乱数も時刻も使わない）。
 */

/** 電線の描画直径[mm]。§6.6 */
export const WIRE_DIAMETER_MM = 1.6;
/** 並走する電線の並列オフセット幅[mm]。§6.6 */
export const WIRE_LANE_PITCH_MM = 2;
/** 並列オフセットの最大段数。 */
export const MAX_WIRE_LANES = 8;
/** 曲がり角のフィレット半径[mm]。 */
export const WIRE_FILLET_RADIUS_MM = 6;
/** フィレット1か所あたりの分割数（点数は控えめに）。 */
export const WIRE_FILLET_SEGMENTS = 3;
/** 同じ列の隣り合う端子を直結する渡り線が、列から張り出す距離[mm]。 */
export const DIRECT_JOG_MM = 5;

/** 経路を求める対象の電線（端子IDは**物理**端子ID）。 */
export interface RoutableWire {
  id: string;
  from: TerminalId;
  to: TerminalId;
}

/** 求めた経路。 */
export interface WireRoute {
  wireId: string;
  /** 描画用の折れ線[mm]（曲がり角はフィレットで丸めてある）。 */
  points: Vec3[];
  /** 丸める前の直角経路の折れ点[mm]。隣り合う点は x・y・z のどれか1軸だけが変わる。 */
  corners: Vec3[];
  /** 通った配線帯のID（通過順）。 */
  channelIds: string[];
  /** 帯ごとの占有区間（帯に沿った座標の範囲）。同じ区間を使う電線は別レーンになる。 */
  channelSpans: Array<{ channelId: string; lo: number; hi: number }>;
  /** 帯の中での並走レーン（0起点）。 */
  lane: number;
  /** 盤面を貫通する位置（既設ハーネスのみ）。ここから先は盤の裏側。 */
  throughPanelAt?: Vec3;
  /** 経路長[mm]。 */
  lengthMm: number;
}

/** 帯ごとの占有区間が重なる既存経路を避けて、最小の空きレーンを選ぶ。 */
export function pickLane(
  spans: ReadonlyArray<{ channelId: string; lo: number; hi: number }>,
  existingRoutes: readonly WireRoute[],
): number {
  const taken = new Set<number>();
  for (const other of existingRoutes) {
    const conflicts = other.channelSpans.some((b) =>
      spans.some((a) => a.channelId === b.channelId && a.lo < b.hi + 1e-6 && b.lo < a.hi + 1e-6),
    );
    if (conflicts) taken.add(other.lane);
  }
  for (let lane = 0; lane < MAX_WIRE_LANES; lane += 1) {
    if (!taken.has(lane)) return lane;
  }
  return MAX_WIRE_LANES - 1;
}

/** 経路の探索に失敗したときに投げる。 */
export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}

function key(x: number, y: number): string {
  const r = roundVec(vec3(x, y, 0), 3);
  return `${r.x},${r.y}`;
}

interface GraphNode {
  x: number;
  y: number;
  /** この節点が載っている配線帯のID。 */
  channels: string[];
}

interface GraphEdge {
  to: string;
  channelId: string;
  weight: number;
}

/** 帯の上の位置（`axis: 'x'` なら x、`axis: 'y'` なら y）。 */
function alongOf(channel: WiringChannel, x: number, y: number): number {
  return channel.axis === 'x' ? x : y;
}

/** 帯の上の位置から座標に戻す。 */
function pointOn(channel: WiringChannel, along: number): { x: number; y: number } {
  return channel.axis === 'x' ? { x: along, y: channel.at } : { x: channel.at, y: along };
}

function contains(channel: WiringChannel, along: number): boolean {
  return along >= Math.min(channel.from, channel.to) && along <= Math.max(channel.from, channel.to);
}

/**
 * 端子から引き出す先の配線帯を選ぶ。
 * ソケットのネジ端子は本体の上端／下端に寄っているので向きが決まっている（`exit`）。
 * 端子台・P/N・本体端子は `either` で、近いほうの帯に出る。
 */
export function entryChannelFor(
  board: BoardDefinition,
  terminal: BoardTerminal,
  exitOverride?: 'rear' | 'front',
): WiringChannel | undefined {
  const exit = exitOverride ?? terminal.exit;
  const candidates = board.wiringChannels.filter(
    (c) => c.axis === 'x' && contains(c, terminal.pos.x),
  );
  const rear = candidates.filter((c) => c.at <= terminal.pos.y);
  const front = candidates.filter((c) => c.at >= terminal.pos.y);
  const nearest = (list: WiringChannel[]): WiringChannel | undefined =>
    list.length === 0
      ? undefined
      : list.reduce((best, c) =>
          Math.abs(c.at - terminal.pos.y) < Math.abs(best.at - terminal.pos.y) ? c : best,
        );
  if (exit === 'rear') return nearest(rear) ?? nearest(front);
  if (exit === 'front') return nearest(front) ?? nearest(rear);
  const a = nearest(rear);
  const b = nearest(front);
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.abs(a.at - terminal.pos.y) <= Math.abs(b.at - terminal.pos.y) ? a : b;
}

/** 配線帯どうしの交点と、電線の出入口を節点にしたグラフを組む。 */
function buildChannelGraph(
  channels: readonly WiringChannel[],
  entries: ReadonlyArray<{ channel: WiringChannel; along: number }>,
): { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge[]> } {
  const onChannel = new Map<string, number[]>();
  const add = (channel: WiringChannel, along: number): void => {
    const list = onChannel.get(channel.id) ?? [];
    if (!list.some((v) => Math.abs(v - along) < 1e-6)) list.push(along);
    onChannel.set(channel.id, list);
  };
  for (const a of channels) {
    for (const b of channels) {
      if (a.axis === b.axis) continue;
      if (!contains(a, alongOf(a, b.at, b.at))) continue;
      if (!contains(b, alongOf(b, a.at, a.at))) continue;
      add(a, b.at);
      add(b, a.at);
    }
  }
  for (const entry of entries) add(entry.channel, entry.along);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const link = (ka: string, kb: string, channelId: string, weight: number): void => {
    const list = edges.get(ka) ?? [];
    list.push({ to: kb, channelId, weight });
    edges.set(ka, list);
  };
  for (const channel of channels) {
    const alongs = (onChannel.get(channel.id) ?? []).slice().sort((p, q) => p - q);
    for (const along of alongs) {
      const p = pointOn(channel, along);
      const k = key(p.x, p.y);
      const node = nodes.get(k) ?? { x: p.x, y: p.y, channels: [] };
      if (!node.channels.includes(channel.id)) node.channels.push(channel.id);
      nodes.set(k, node);
    }
    for (let i = 1; i < alongs.length; i += 1) {
      const a = alongs[i - 1];
      const b = alongs[i];
      if (a === undefined || b === undefined) continue;
      const pa = pointOn(channel, a);
      const pb = pointOn(channel, b);
      link(key(pa.x, pa.y), key(pb.x, pb.y), channel.id, Math.abs(b - a));
      link(key(pb.x, pb.y), key(pa.x, pa.y), channel.id, Math.abs(b - a));
    }
  }
  return { nodes, edges };
}

/** ダイクストラ法で最短経路（節点キーの列と通った帯）を求める。 */
function shortestPath(
  edges: Map<string, GraphEdge[]>,
  startKey: string,
  goalKey: string,
): { keys: string[]; channelIds: string[] } | undefined {
  if (startKey === goalKey) return { keys: [startKey], channelIds: [] };
  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, { key: string; channelId: string }>();
  const visited = new Set<string>();
  for (;;) {
    let current: string | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const [k, d] of dist) {
      if (visited.has(k) || d >= best) continue;
      current = k;
      best = d;
    }
    if (current === undefined || current === goalKey) break;
    visited.add(current);
    for (const edge of edges.get(current) ?? []) {
      const next = best + edge.weight;
      if (next >= (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      dist.set(edge.to, next);
      prev.set(edge.to, { key: current, channelId: edge.channelId });
    }
  }
  if (!dist.has(goalKey)) return undefined;
  const keys = [goalKey];
  const channelIds: string[] = [];
  let cursor = goalKey;
  while (cursor !== startKey) {
    const step = prev.get(cursor);
    if (step === undefined) return undefined;
    keys.push(step.key);
    channelIds.push(step.channelId);
    cursor = step.key;
  }
  keys.reverse();
  channelIds.reverse();
  return { keys, channelIds };
}

function dedupeStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v.length === 0 || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

function dedupePoints(points: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && vecEquals(last, p, 1e-6)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 帯の走行座標をレーンぶんずらす。水平帯は y、垂直帯は x をずらす。
 * ずらす向きは帯ごとに固定（`CHANNEL_LANE_DIRECTION`）で、部品の無い側へ伸ばす。
 */
function laneShift(channel: WiringChannel, lane: number): { dx: number; dy: number } {
  const shift = lane * WIRE_LANE_PITCH_MM * (CHANNEL_LANE_DIRECTION[channel.id] ?? 1);
  return channel.axis === 'x' ? { dx: 0, dy: shift } : { dx: shift, dy: 0 };
}

/** 直角の折れ点列を、角を半径 `radius` で丸めた折れ線にする。 */
export function filletCorners(corners: readonly Vec3[], radius: number): Vec3[] {
  if (corners.length < 3 || radius <= 0) return [...corners];
  const out: Vec3[] = [];
  const first = corners[0];
  if (first !== undefined) out.push(first);
  for (let i = 1; i < corners.length - 1; i += 1) {
    const prev = corners[i - 1];
    const cur = corners[i];
    const next = corners[i + 1];
    if (prev === undefined || cur === undefined || next === undefined) continue;
    const inLen = distance(prev, cur);
    const outLen = distance(cur, next);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 1e-6) {
      out.push(cur);
      continue;
    }
    const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
      vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    const a = lerp(cur, prev, r / inLen);
    const b = lerp(cur, next, r / outLen);
    for (let k = 0; k <= WIRE_FILLET_SEGMENTS; k += 1) {
      const t = k / WIRE_FILLET_SEGMENTS;
      const u = 1 - t;
      out.push(
        vec3(
          u * u * a.x + 2 * u * t * cur.x + t * t * b.x,
          u * u * a.y + 2 * u * t * cur.y + t * t * b.y,
          u * u * a.z + 2 * u * t * cur.z + t * t * b.z,
        ),
      );
    }
  }
  const last = corners[corners.length - 1];
  if (last !== undefined) out.push(last);
  return dedupePoints(out);
}

/** 端子IDの持ち主（`TB_PB.1c` → `TB_PB`）。 */
function ownerOf(id: TerminalId): string {
  const dot = id.indexOf('.');
  return dot < 0 ? id : id.slice(0, dot);
}

/**
 * 同じ列（端子台の1列、またはソケットの同じティア）の端子どうしを直結する短い渡り線。§4.5
 * 配線帯まで往復すると大回りになるので、列からわずかに張り出して直角に渡る。
 * 部品の占有矩形を跨ぐ場合は使わない（呼び出し側が配線帯の経路にフォールバックする）。
 */
function directRunRoute(
  board: BoardDefinition,
  wire: RoutableWire,
  a: BoardTerminal,
  b: BoardTerminal,
  existingRoutes: readonly WireRoute[],
): WireRoute | undefined {
  if (ownerOf(a.id) !== ownerOf(b.id)) return undefined;
  if (Math.abs(a.pos.y - b.pos.y) > 1e-6) return undefined;
  if (Math.abs(a.pos.x - b.pos.x) < 1e-6) return undefined;
  if (a.exit !== b.exit) return undefined;
  const dir = a.exit === 'front' ? 1 : -1;
  const siblings = existingRoutes.filter(
    (r) => r.channelIds.length === 0 && r.corners.length > 0 && sameRow(r, a),
  );
  const lane = Math.min(siblings.length, MAX_WIRE_LANES - 1);
  const jogY = a.pos.y + dir * (DIRECT_JOG_MM + lane * WIRE_LANE_PITCH_MM);
  const corners = dedupePoints([
    a.pos,
    vec3(a.pos.x, a.pos.y, WIRE_RUN_Z_MM),
    vec3(a.pos.x, jogY, WIRE_RUN_Z_MM),
    vec3(b.pos.x, jogY, WIRE_RUN_Z_MM),
    vec3(b.pos.x, b.pos.y, WIRE_RUN_Z_MM),
    b.pos,
  ]);
  const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
  const route: WireRoute = {
    wireId: wire.id,
    points,
    corners,
    channelIds: [],
    channelSpans: [],
    lane,
    lengthMm: polylineLength(points),
  };
  return crossingFootprint(board, route) === undefined ? route : undefined;
}

/** その経路が端子 `a` と同じ列の渡り線か（レーンを分けるための判定）。 */
function sameRow(route: WireRoute, a: BoardTerminal): boolean {
  const first = route.corners[0];
  return first !== undefined && Math.abs(first.y - a.pos.y) < 1e-6;
}

function terminalOf(board: BoardDefinition, id: TerminalId): BoardTerminal {
  const found = findBoardTerminal(board, id);
  if (found === undefined) throw new RoutingError(`盤に無い端子です: ${id}`);
  return found;
}

/**
 * 1本の電線の経路を求める。§6.6
 * 端子 → 垂直に引き出す → 配線帯 → 直角に走る → 目的端子の列 → 端子。
 * 既存経路のうち同じ帯を通るものの本数だけ、2mmピッチで帯の幅方向にずらす。
 * `wire.from` / `wire.to` は**物理**端子ID（`S1.13` / `TB_PB.1a` など）。
 */
export function routeWire(
  board: BoardDefinition,
  wire: RoutableWire,
  existingRoutes: readonly WireRoute[],
  options: RouteOptions = {},
): WireRoute {
  const a = terminalOf(board, wire.from);
  const b = terminalOf(board, wire.to);
  if (options.exitOverride === undefined) {
    const direct = directRunRoute(board, wire, a, b, existingRoutes);
    if (direct !== undefined) return direct;
  }
  const chA = entryChannelFor(board, a, options.exitOverride?.[wire.from]);
  const chB = entryChannelFor(board, b, options.exitOverride?.[wire.to]);
  if (chA === undefined || chB === undefined) {
    throw new RoutingError(`端子から出られる配線帯がありません: ${wire.from} / ${wire.to}`);
  }

  const entryA = { channel: chA, along: alongOf(chA, a.pos.x, a.pos.y) };
  const entryB = { channel: chB, along: alongOf(chB, b.pos.x, b.pos.y) };
  const graph = buildChannelGraph(board.wiringChannels, [entryA, entryB]);
  const pa = pointOn(chA, entryA.along);
  const pb = pointOn(chB, entryB.along);
  const path = shortestPath(graph.edges, key(pa.x, pa.y), key(pb.x, pb.y));
  if (path === undefined) {
    throw new RoutingError(`配線帯がつながっていません: ${wire.from} → ${wire.to}`);
  }

  const channelIds = dedupeStrings(
    path.channelIds.length === 0 ? [chA.id] : [chA.id, ...path.channelIds, chB.id],
  );
  // 帯ごとの占有区間を求め、区間が重なる電線とだけレーンを分ける
  const channelById = new Map(board.wiringChannels.map((c) => [c.id, c]));
  const spanMap = new Map<string, { channelId: string; lo: number; hi: number }>();
  path.keys.forEach((k, index) => {
    const channelId = path.channelIds[index];
    if (channelId === undefined) return;
    const channel = channelById.get(channelId);
    const nodeA = graph.nodes.get(k);
    const nodeB = graph.nodes.get(path.keys[index + 1] ?? '');
    if (channel === undefined || nodeA === undefined || nodeB === undefined) return;
    const a = alongOf(channel, nodeA.x, nodeA.y);
    const b = alongOf(channel, nodeB.x, nodeB.y);
    const prev = spanMap.get(channelId);
    const lo = Math.min(a, b, prev?.lo ?? Number.POSITIVE_INFINITY);
    const hi = Math.max(a, b, prev?.hi ?? Number.NEGATIVE_INFINITY);
    spanMap.set(channelId, { channelId, lo, hi });
  });
  if (spanMap.size === 0) {
    const along = alongOf(chA, pa.x, pa.y);
    spanMap.set(chA.id, { channelId: chA.id, lo: along, hi: along });
  }
  const channelSpans = [...spanMap.values()];
  const lane = pickLane(channelSpans, existingRoutes);

  const runPoints: Vec3[] = [];
  path.keys.forEach((k, index) => {
    const node = graph.nodes.get(k);
    if (node === undefined) return;
    // 帯の乗り換え点では、入ってきた帯と出ていく帯の**両方**のレーンずらしを足す。
    // こうしないと角で x と y が同時に動いてしまい、直角経路でなくなる。
    const incoming = index > 0 ? path.channelIds[index - 1] : undefined;
    const outgoing = path.channelIds[index];
    let dx = 0;
    let dy = 0;
    let zMm = WIRE_RUN_Z_MM;
    // 同じ帯を通り抜けるだけの節点では二重に足さない（帯ごとに1回だけ）
    const applied = new Set<string>();
    for (const id of [incoming, outgoing]) {
      if (id === undefined || applied.has(id)) continue;
      applied.add(id);
      const channel = channelById.get(id);
      if (channel === undefined) continue;
      const shift = laneShift(channel, lane);
      dx += shift.dx;
      dy += shift.dy;
      zMm = channel.zMm;
    }
    if (incoming === undefined && outgoing === undefined) {
      const shift = laneShift(chA, lane);
      dx = shift.dx;
      dy = shift.dy;
      zMm = chA.zMm;
    }
    runPoints.push(vec3(node.x + dx, node.y + dy, zMm));
  });

  const firstRun = runPoints[0];
  const lastRun = runPoints[runPoints.length - 1];
  if (firstRun === undefined || lastRun === undefined) {
    throw new RoutingError(`経路が空です: ${wire.id}`);
  }

  // 端子 → 盤面の走行高さへ立ち下げ → 帯へ垂直に入る（各区間は1軸だけ動く）
  const corners = dedupePoints([
    a.pos,
    vec3(a.pos.x, a.pos.y, WIRE_RUN_Z_MM),
    vec3(firstRun.x, a.pos.y, WIRE_RUN_Z_MM),
    firstRun,
    ...runPoints.slice(1, -1),
    lastRun,
    vec3(lastRun.x, b.pos.y, WIRE_RUN_Z_MM),
    vec3(b.pos.x, b.pos.y, WIRE_RUN_Z_MM),
    b.pos,
  ]);
  const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
  const route: WireRoute = {
    wireId: wire.id,
    points,
    corners,
    channelIds,
    channelSpans,
    lane,
    lengthMm: polylineLength(points),
  };
  const hit = crossingFootprint(board, route);
  if (hit !== undefined) {
    throw new RoutingError(
      `経路が部品の上を通ります（${hit.kind} ${hit.id}）: ${wire.from} → ${wire.to}`,
    );
  }
  return route;
}

/** 経路生成のオプション。 */
export interface RouteOptions {
  /** 端子ごとに引き出し向きを強制する（既設ハーネスを写真どおり手前へ出すのに使う）。 */
  exitOverride?: Readonly<Record<string, 'rear' | 'front'>>;
}

/** セッションの全電線の経路を、配列の並び順に求める。§6.6 */
export function routeSession(board: BoardDefinition, session: BoardSession): WireRoute[] {
  const routes: WireRoute[] = [];
  for (const wire of session.wires) {
    routes.push(
      routeWire(
        board,
        {
          id: wire.id,
          from: toPhysicalTerminal(session.socketRoles, wire.from),
          to: toPhysicalTerminal(session.socketRoles, wire.to),
        },
        routes,
      ),
    );
  }
  return routes;
}

/**
 * 既設の青線ハーネス（端子台 → PB／PL本体）の経路。§6.4 / 写真
 * 配線帯は使わず、端子台の端子から**手前へまっすぐ降り**、機器の根元にある盤面の貫通穴に
 * 2mmピッチで平行に入って、盤の裏側の本体端子へつながる。機器の中心（押ボタンの頭・
 * ランプのレンズ）の上は通らない。
 */
export function routeFixedLinks(board: BoardDefinition): WireRoute[] {
  const holeOf = new Map<string, Vec3>();
  for (const lamp of board.lamps) holeOf.set(lamp.id, lamp.panelHole);
  for (const pb of board.pushButtons) holeOf.set(pb.id, pb.panelHole);

  const routes: WireRoute[] = [];
  const seen = new Map<string, number>();
  for (const link of board.fixedLinks) {
    const owner = [...holeOf.keys()].find(
      (id) => link.from.startsWith(`${id}.`) || link.to.startsWith(`${id}.`),
    );
    if (owner === undefined) continue; // P/N供給端子どうしのリンクは筐体内なので描かない
    const hole = holeOf.get(owner);
    const blockId = link.from.startsWith(`${owner}.`) ? link.to : link.from;
    const bodyId = link.from.startsWith(`${owner}.`) ? link.from : link.to;
    const block = findBoardTerminal(board, blockId);
    const body = findBoardTerminal(board, bodyId);
    if (hole === undefined || block === undefined || body === undefined) continue;

    const index = seen.get(owner) ?? 0;
    seen.set(owner, index + 1);
    const total = link.from.startsWith('PB') || link.to.startsWith('PB') ? 3 : 2;
    const offset = (index - (total - 1) / 2) * HARNESS_PITCH_MM;
    const approachY = hole.y - HARNESS_APPROACH_MM;
    const corners = dedupePoints([
      block.pos,
      vec3(block.pos.x, block.pos.y, WIRE_RUN_Z_MM),
      vec3(block.pos.x, approachY, WIRE_RUN_Z_MM),
      vec3(hole.x + offset, approachY, WIRE_RUN_Z_MM),
      vec3(hole.x + offset, hole.y, WIRE_RUN_Z_MM),
      vec3(hole.x + offset, hole.y, 0),
      vec3(hole.x + offset, hole.y, body.pos.z),
      vec3(hole.x + offset, body.pos.y, body.pos.z),
      body.pos,
    ]);
    const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
    routes.push({
      wireId: link.id,
      points,
      corners,
      channelIds: [],
      channelSpans: [],
      lane: index,
      throughPanelAt: vec3(hole.x + offset, hole.y, 0),
      lengthMm: polylineLength(points),
    });
  }
  return routes;
}

/** 折れ点列が直角経路か（隣り合う点で動く軸がちょうど1つか）。 */
export function isManhattan(corners: readonly Vec3[], epsilon = 1e-6): boolean {
  for (let i = 1; i < corners.length; i += 1) {
    const p = corners[i - 1];
    const q = corners[i];
    if (p === undefined || q === undefined) return false;
    const moved = [Math.abs(q.x - p.x), Math.abs(q.y - p.y), Math.abs(q.z - p.z)].filter(
      (d) => d > epsilon,
    );
    if (moved.length !== 1) return false;
  }
  return true;
}

/**
 * 経路が部品の占有領域の内側を通っていないか。§6.6
 * 両端の端子が載っている部品（引き出し区間が必ず通る）は除いて調べる。
 * 通っていればその占有領域を返す。
 */
export function crossingFootprint(board: BoardDefinition, route: WireRoute): Footprint | undefined {
  const own = new Set<string>();
  const ends = [route.corners[0], route.corners[route.corners.length - 1]];
  for (const end of ends) {
    if (end === undefined) continue;
    for (const fp of board.footprints) {
      if (rectContains(fp, end)) own.add(fp.id);
    }
  }
  for (const fp of board.footprints) {
    if (own.has(fp.id)) continue;
    for (let i = 1; i < route.points.length; i += 1) {
      const p = route.points[i - 1];
      const q = route.points[i];
      if (p === undefined || q === undefined) continue;
      if (segmentIntersectsRect(p, q, fp)) return fp;
    }
  }
  return undefined;
}

/** 経路が部品の上を横切っているか。 */
export function crossesFootprint(board: BoardDefinition, route: WireRoute): boolean {
  return crossingFootprint(board, route) !== undefined;
}

/** 配線帯が部品の占有領域と重なっていないか（盤定義の不変条件）。§6.6 */
export function channelsClearOfFootprints(board: BoardDefinition): string[] {
  const bad: string[] = [];
  for (const channel of board.wiringChannels) {
    const lanes = MAX_WIRE_LANES - 1;
    const dir = CHANNEL_LANE_DIRECTION[channel.id] ?? 1;
    const spread = lanes * WIRE_LANE_PITCH_MM * dir;
    const a =
      channel.axis === 'x' ? vec3(channel.from, channel.at, 0) : vec3(channel.at, channel.from, 0);
    const b =
      channel.axis === 'x'
        ? vec3(channel.to, channel.at + spread, 0)
        : vec3(channel.at + spread, channel.to, 0);
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
    for (const fp of board.footprints) {
      const overlap =
        rect.x < fp.x + fp.w &&
        rect.x + rect.w > fp.x &&
        rect.y < fp.y + fp.h &&
        rect.y + rect.h > fp.y;
      if (overlap) bad.push(`${channel.id} × ${fp.id}`);
    }
  }
  return bad;
}
