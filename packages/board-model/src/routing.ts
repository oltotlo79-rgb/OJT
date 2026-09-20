import type { TerminalId } from '@ojt/circuit-sim';
import {
  channelBandRect,
  CHANNEL_LANE_COUNT,
  CHANNEL_LANE_DIRECTION,
  CHANNEL_LANE_PITCH_MM,
  findBoardTerminal,
  HARNESS_APPROACH_MM,
  HARNESS_PITCH_MM,
  isOffBoardTerminal,
  runZ,
  WIRE_LAYER_COUNT,
  WIRE_RUN_X_Z_MM,
  WIRE_RUN_Y_Z_MM,
  type BoardDefinition,
  type BoardTerminal,
  type Footprint,
  type WiringChannel,
} from './board-jipm.js';
import {
  distance,
  polylineLength,
  rectContains,
  rectsOverlap,
  roundVec,
  segmentIntersectsRect,
  vec3,
  vecEquals,
  type Rect,
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
 * という経路を作る。純関数・決定論（乱数も時刻も使わない）。
 *
 * 並走する電線の分け方は2方向ある。
 * - **レーン**（幅方向）: 帯の中で `CHANNEL_LANE_PITCH_MM` ピッチに `CHANNEL_LANE_COUNT` 本ずらす。
 * - **レイヤ**（高さ方向）: レーンを使い切ったら高さのはしごを2段上げる（{@link runZ}）。
 *
 * さらに走る向きで高さの段を分けてある（x方向は {@link WIRE_RUN_X_Z_MM}、y方向は
 * {@link WIRE_RUN_Y_Z_MM} 系）。直交する区間どうしは必ず1.8mm以上離れるので、
 * 直径 {@link WIRE_DIAMETER_MM}（1.6mm）の管で描いても食い込まない。高さの変わる角には
 * z だけ動く点を差し込むので、折れ点列は常に直角経路（{@link isManhattan}）である。
 *
 * 端子からの引き出し（帯までの短い区間）は、同じ列・同じネジから出る電線どうしが1本の管に
 * 見えてしまわないよう、レーンごとに**高さの段**（偶奇）と**横位置**（{@link LEAD_OUT_STAGGER_MM}）を
 * ずらしてある。ずれは帯へ入る角が吸収するので、帯の中の走る線（レーン）は変わらない
 * （区間の端は最大 ±2.1mm 動く）。
 */

/** 電線の描画直径[mm]。§6.6 */
export const WIRE_DIAMETER_MM = 1.6;
/**
 * 並走する電線の並列オフセット幅[mm]。
 * @deprecated 盤定義側の {@link CHANNEL_LANE_PITCH_MM} に一本化した。別名として残してある。
 */
export const WIRE_LANE_PITCH_MM = CHANNEL_LANE_PITCH_MM;
/**
 * 並列オフセットの最大段数（1レイヤあたり）。
 * @deprecated 盤定義側の {@link CHANNEL_LANE_COUNT} に一本化した。別名として残してある。
 */
export const MAX_WIRE_LANES = CHANNEL_LANE_COUNT;
/**
 * 端子からの引き出しをレーン1本ぶんずらす量[mm]（レーン0が −2.1mm、レーン7が +2.1mm）。
 * 端子の当たり判定半径（4mm）より小さく、いちばん詰まった列の間隔（8mm）の内側に収まる。
 */
export const LEAD_OUT_STAGGER_MM = 0.6;
/** 曲がり角のフィレット半径[mm]。 */
export const WIRE_FILLET_RADIUS_MM = 6;
/** フィレット1か所あたりの分割数（点数は控えめに）。 */
export const WIRE_FILLET_SEGMENTS = 3;
/** 同じ列の隣り合う端子を直結する渡り線が、列から張り出す距離[mm]。 */
export const DIRECT_JOG_MM = 5;
/** 渡り線が使える張り出しの段数。これを超えるぶんは配線帯の経路にする。 */
export const MAX_DIRECT_JOG_LEVELS = 3;

const EPS = 1e-6;

/** 経路を求める対象の電線（端子IDは**物理**端子ID）。 */
export interface RoutableWire {
  id: string;
  from: TerminalId;
  to: TerminalId;
}

/**
 * 経路の種類。用途の違う経路を取り違えないための判別子。
 * - `channel`: 配線帯を使う訓練者の電線（{@link routeWire} の既定）。`channelIds` は空でない。
 * - `direct`: 帯を使わない直結。`channelIds` は必ず空で `lanes` も空。
 *   同じ列の隣り合う端子を結ぶ渡り線（列からわずかに張り出す）のほか、
 *   両端が帯の**同じ節点**に出る2端子をまっすぐ渡す経路もこれになる（帯まで下りて折り返さない）。
 * - `harness`: 既設の青線ハーネス（{@link routeFixedLinks}）。帯もレーンも使わない。
 */
export type WireRouteKind = 'direct' | 'channel' | 'harness';

/** 帯に沿った占有区間（`lo`〜`hi` は帯の走行軸の座標）。 */
export interface ChannelSpan {
  channelId: string;
  lo: number;
  hi: number;
}

/**
 * 帯を1回走るごとの割当。1本の電線が同じ帯を2回走れば2つになる。
 * 区間が重なる走行どうしは必ず別の `(lane, layer)` に載る。
 */
export interface ChannelLane {
  channelId: string;
  /** 帯の幅方向の位置（0起点。`CHANNEL_LANE_DIRECTION` の向きへ `CHANNEL_LANE_PITCH_MM` ずつ）。 */
  lane: number;
  /** 帯の高さ方向の段（0起点。高さは `runZ(帯の軸, layer)`）。 */
  layer: number;
  /**
   * この走行が占める区間（帯の走行軸の座標。節点の**シフト前**の座標で、レーン割当の
   * 占有管理のための値であって描画用の幾何ではない）。
   *
   * 実際に描く線（{@link WireRoute.points}）は、帯の乗り換え点でのレーンずらし
   * （最大 `(CHANNEL_LANE_COUNT − 1) × CHANNEL_LANE_PITCH_MM` = 14mm）と、
   * 端子からの引き出しのずらし（{@link LEAD_OUT_STAGGER_MM} 起因、最大2.1mm）ぶん、
   * この区間の外にはみ出すことがある。描画はこの `span` からではなく、必ず
   * `points`（Plan 1D の描画対象）から行うこと。
   */
  span: { lo: number; hi: number };
}

/** 求めた経路。 */
export interface WireRoute {
  wireId: string;
  /** 経路の種類。渡り線・既設ハーネスを配線帯の経路と取り違えないために持つ。 */
  kind: WireRouteKind;
  /** 描画用の折れ線[mm]（曲がり角はフィレットで丸めてある）。 */
  points: Vec3[];
  /** 丸める前の直角経路の折れ点[mm]。隣り合う点は x・y・z のどれか1軸だけが変わる。 */
  corners: Vec3[];
  /** 通った配線帯のID（通過順）。 */
  channelIds: string[];
  /** 帯を走るたびのレーン・レイヤの割当（占有区間は各要素の `span`）。 */
  lanes: ChannelLane[];
  /** 最初の走行のレーン（渡り線では張り出しの段、既設ハーネスでは穴の中の並び順）。 */
  lane: number;
  /** 空きスロットが無く、やむなく他の電線と同じスロットに載せた（UIが警告できる）。 */
  laneOverflow: boolean;
  /** 盤面を貫通する位置（既設ハーネスのみ）。ここから先は盤の裏側。 */
  throughPanelAt?: Vec3;
  /** 経路長[mm]。 */
  lengthMm: number;
}

/** レーン割当の結果。 */
export interface LaneAssignment {
  /** 入力の区間と同じ並びの割当。 */
  lanes: ChannelLane[];
  /** どれかの区間で空きスロットが無かった。 */
  overflow: boolean;
}

/** 帯1本あたりのスロット数（レーン × レイヤ）。 */
const SLOT_COUNT = CHANNEL_LANE_COUNT * WIRE_LAYER_COUNT;

/** スロット番号 → レーンとレイヤ（レイヤ0のレーン0..7 → レイヤ1のレーン0..7 の順に探す）。 */
function slotAt(index: number): { lane: number; layer: number } {
  return { lane: index % CHANNEL_LANE_COUNT, layer: Math.floor(index / CHANNEL_LANE_COUNT) };
}

/** 2つの区間が重なるか（端が触れるだけでも重なりとみなす。管がぶつかるので）。 */
function spansOverlap(a: { lo: number; hi: number }, b: { lo: number; hi: number }): boolean {
  return a.lo <= b.hi + EPS && b.lo <= a.hi + EPS;
}

/**
 * 帯ごとの占有区間に、区間の重なる既存経路を避けたスロット（レーン・レイヤ）を割り当てる。
 * レイヤ0のレーン0..7 → レイヤ1のレーン0..7 の順に探し、最初の空きを使う。
 * 全スロットが埋まっていても投げず、いちばん重なりの少ないスロット（同点なら最小）に載せて
 * `overflow` を立てる（配線は描けたほうが訓練の役に立つ。UIが警告を出せばよい）。
 * 同じ電線の中でも、区間の重なる走行どうしは別スロットになる。
 */
export function pickLane(
  spans: readonly ChannelSpan[],
  existingRoutes: readonly WireRoute[],
): LaneAssignment {
  const occupied: ChannelLane[] = [];
  for (const other of existingRoutes) occupied.push(...other.lanes);
  const lanes: ChannelLane[] = [];
  let overflow = false;
  for (const span of spans) {
    let bestIndex = 0;
    let bestConflicts = Number.POSITIVE_INFINITY;
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const slot = slotAt(index);
      let conflicts = 0;
      for (const taken of occupied) {
        if (taken.channelId !== span.channelId) continue;
        if (taken.lane !== slot.lane || taken.layer !== slot.layer) continue;
        if (spansOverlap(taken.span, span)) conflicts += 1;
      }
      if (conflicts < bestConflicts) {
        bestConflicts = conflicts;
        bestIndex = index;
      }
      if (conflicts === 0) break;
    }
    const slot = slotAt(bestIndex);
    if (bestConflicts > 0) overflow = true;
    const assigned: ChannelLane = {
      channelId: span.channelId,
      lane: slot.lane,
      layer: slot.layer,
      span: { lo: span.lo, hi: span.hi },
    };
    lanes.push(assigned);
    occupied.push(assigned);
  }
  return { lanes, overflow };
}

/** 経路の探索に失敗した理由（UI・テストが分岐できるように機械可読にしてある）。 */
export type RoutingErrorReason = 'invalid-terminal' | 'unreachable' | 'footprint-crossing';

/** 経路の探索に失敗したときに投げる。 */
export class RoutingError extends Error {
  /** 失敗した電線のID。 */
  readonly wireId: string;
  /** 失敗の理由。 */
  readonly reason: RoutingErrorReason;

  constructor(message: string, wireId: string, reason: RoutingErrorReason) {
    super(`${message}（電線 ${wireId}）`);
    this.name = 'RoutingError';
    this.wireId = wireId;
    this.reason = reason;
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
 * 帯のレイヤの走行高さ[mm]。帯の `zMm` ではなく**走る向きとレイヤ**だけで決まる
 * （{@link runZ} が唯一の情報源。`zMm` は検査用の控えで、食い違えば `validateBoard` が報告する）。
 */
function channelZ(channel: WiringChannel, layer: number): number {
  return runZ(channel.axis, layer);
}

/**
 * 端子からの引き出しを、帯のレーンに合わせて横へずらす量[mm]（中央そろえ。±2.1mm）。
 * 同じネジ・同じ列から出る電線が同じ直線に重なって1本の管に見えるのを防ぐ。
 */
function leadOutOffset(lane: number): number {
  return (lane - (CHANNEL_LANE_COUNT - 1) / 2) * LEAD_OUT_STAGGER_MM;
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

/**
 * 配線帯どうしの交点（`channels` だけで決まり、電線には依存しない）。§6.6
 *
 * 総当たり（`O(C²)`）は帯の組み合わせが盤定義から変わらない限り同じ結果になるので、
 * `channels` 配列の参照ごとに1回だけ計算して使い回す（BM-05。以前は `buildChannelGraph()` が
 * 電線1本ごとにこの総当たりをやり直しており、盤内17本で1.064msかかっていた）。
 */
const intersectionAlongsCache = new WeakMap<readonly WiringChannel[], Map<string, number[]>>();

function intersectionAlongs(channels: readonly WiringChannel[]): Map<string, number[]> {
  const cached = intersectionAlongsCache.get(channels);
  if (cached !== undefined) return cached;
  const onChannel = new Map<string, number[]>();
  const add = (channel: WiringChannel, along: number): void => {
    const list = onChannel.get(channel.id) ?? [];
    if (!list.some((v) => Math.abs(v - along) < EPS)) list.push(along);
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
  for (const list of onChannel.values()) list.sort((p, q) => p - q);
  intersectionAlongsCache.set(channels, onChannel);
  return onChannel;
}

/**
 * `channel.id → WiringChannel` の索引。盤定義だけで決まるので、`channels` 配列の参照ごとに
 * 1回だけ作って使い回す（BM-05）。`routeSession()` は電線ごとに `routeWire()` を呼ぶが、
 * これも同じ `board.wiringChannels` を渡すので毎回作り直す意味が無かった。
 */
const channelByIdCache = new WeakMap<readonly WiringChannel[], Map<string, WiringChannel>>();

function channelByIdOf(channels: readonly WiringChannel[]): Map<string, WiringChannel> {
  const cached = channelByIdCache.get(channels);
  if (cached !== undefined) return cached;
  const map = new Map(channels.map((c) => [c.id, c] as const));
  channelByIdCache.set(channels, map);
  return map;
}

/**
 * 配線帯どうしの交点と、電線の出入口を節点にしたグラフを組む。
 * 交点部分は {@link intersectionAlongs} でメモ化済みなので、ここでは出入口2点の挿入だけを
 * 電線ごとに行う（BM-05）。
 */
function buildChannelGraph(
  channels: readonly WiringChannel[],
  entries: ReadonlyArray<{ channel: WiringChannel; along: number }>,
): { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge[]> } {
  const base = intersectionAlongs(channels);
  const onChannel = new Map(base);
  const cloned = new Set<string>();
  const add = (channel: WiringChannel, along: number): void => {
    let list = onChannel.get(channel.id);
    if (list === undefined || !cloned.has(channel.id)) {
      list = list === undefined ? [] : list.slice();
      onChannel.set(channel.id, list);
      cloned.add(channel.id);
    }
    if (!list.some((v) => Math.abs(v - along) < EPS)) {
      list.push(along);
      list.sort((p, q) => p - q);
    }
  };
  for (const entry of entries) add(entry.channel, entry.along);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const link = (ka: string, kb: string, channelId: string, weight: number): void => {
    const list = edges.get(ka) ?? [];
    list.push({ to: kb, channelId, weight });
    edges.set(ka, list);
  };
  for (const channel of channels) {
    const alongs = onChannel.get(channel.id) ?? [];
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
    if (last !== undefined && vecEquals(last, p, EPS)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 帯の走行座標をレーンぶんずらす。水平帯は y、垂直帯は x をずらす。
 * ずらす向きは帯ごとに固定（`CHANNEL_LANE_DIRECTION`）で、部品の無い側へ伸ばす。
 */
function laneShift(channel: WiringChannel, lane: number): { dx: number; dy: number } {
  const shift = lane * CHANNEL_LANE_PITCH_MM * (CHANNEL_LANE_DIRECTION[channel.id] ?? 1);
  return channel.axis === 'x' ? { dx: 0, dy: shift } : { dx: shift, dy: 0 };
}

/**
 * 直角経路の組み立て手順。
 * `to` は XY を1軸だけ動かす区間（`z` はその区間の走行高さ）、`rise` は同じ XY で高さだけ動かす。
 */
type RouteStep =
  | { readonly kind: 'to'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'rise'; readonly z: number };

function toStep(x: number, y: number, z: number): RouteStep {
  return { kind: 'to', x, y, z };
}

function riseStep(z: number): RouteStep {
  return { kind: 'rise', z };
}

/**
 * 手順から直角の折れ点列を組み立てる。
 * 区間ごとに走行高さが違うので、高さの変わる角には**z だけ動く点**を差し込む
 * （そうしないと角で2軸が同時に動き、直角経路でなくなる）。
 * XY が動かない `to` は長さ0なので捨てる（高さも変えない）。
 */
function buildCorners(start: Vec3, steps: readonly RouteStep[]): Vec3[] {
  const out: Vec3[] = [start];
  let x = start.x;
  let y = start.y;
  let z = start.z;
  for (const step of steps) {
    if (step.kind === 'rise') {
      if (Math.abs(step.z - z) <= EPS) continue;
      z = step.z;
      out.push(vec3(x, y, z));
      continue;
    }
    if (Math.abs(step.x - x) <= EPS && Math.abs(step.y - y) <= EPS) continue;
    if (Math.abs(step.z - z) > EPS) {
      z = step.z;
      out.push(vec3(x, y, z));
    }
    x = step.x;
    y = step.y;
    out.push(vec3(x, y, z));
  }
  return out;
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
    if (r <= EPS) {
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

/** 渡り線が x 方向に占める範囲（渡り線には必ず折れ点があるので、範囲は空にならない）。 */
function directRunXSpan(route: WireRoute): { lo: number; hi: number } {
  const xs = route.corners.map((c) => c.x);
  return { lo: Math.min(...xs), hi: Math.max(...xs) };
}

/**
 * 渡り線の張り出し（管の太さぶん広げた矩形）が、どれかの配線帯の帯に入り込むか。
 * 帯には占有領域が無い（`crossingFootprint` では見つけられない）ので、ここで直に調べる。
 */
function jogEntersChannelBand(
  board: BoardDefinition,
  lo: number,
  hi: number,
  rowY: number,
  jogY: number,
): boolean {
  const radius = WIRE_DIAMETER_MM / 2;
  const rect: Rect = {
    x: lo - radius,
    y: Math.min(rowY, jogY) - radius,
    w: hi - lo + radius * 2,
    h: Math.abs(jogY - rowY) + radius * 2,
  };
  return board.wiringChannels.some((channel) => rectsOverlap(rect, channelBandRect(channel)));
}

/**
 * 同じ列（端子台の1列、またはソケットの同じティア）の端子どうしを直結する短い渡り線。§4.5
 * 配線帯まで往復すると大回りになるので、列からわずかに張り出して直角に渡る。
 *
 * 張り出しの段は「同じ列で x 区間が重なる既存の渡り線」だけを避けて決める
 * （区間が離れていれば段0を使い回すので、端子台が別なら段が上がらない）。
 * 張り出しが配線帯の帯に届くか、段が `MAX_DIRECT_JOG_LEVELS` を超えるときは
 * `undefined` を返し、呼び出し側が配線帯の経路にフォールバックする（投げない）。
 * 部品の占有矩形を跨ぐ場合も同様。
 */
function directRunRoute(
  board: BoardDefinition,
  wire: RoutableWire,
  a: BoardTerminal,
  b: BoardTerminal,
  existingRoutes: readonly WireRoute[],
): WireRoute | undefined {
  if (ownerOf(a.id) !== ownerOf(b.id)) return undefined;
  if (Math.abs(a.pos.y - b.pos.y) > EPS) return undefined;
  if (Math.abs(a.pos.x - b.pos.x) < EPS) return undefined;
  if (a.exit !== b.exit) return undefined;
  const dir = a.exit === 'front' ? 1 : -1;
  const lo = Math.min(a.pos.x, b.pos.x);
  const hi = Math.max(a.pos.x, b.pos.x);
  const taken = new Set<number>();
  for (const other of existingRoutes) {
    if (other.kind !== 'direct' || !sameRow(other, a)) continue;
    if (!spansOverlap(directRunXSpan(other), { lo, hi })) continue;
    taken.add(other.lane);
  }
  let level = 0;
  while (taken.has(level)) level += 1;
  if (level >= MAX_DIRECT_JOG_LEVELS) return undefined;
  const jogY = a.pos.y + dir * (DIRECT_JOG_MM + level * CHANNEL_LANE_PITCH_MM);
  if (jogEntersChannelBand(board, lo, hi, a.pos.y, jogY)) return undefined;

  const corners = buildCorners(a.pos, [
    toStep(a.pos.x, jogY, WIRE_RUN_Y_Z_MM),
    toStep(b.pos.x, jogY, WIRE_RUN_X_Z_MM),
    toStep(b.pos.x, b.pos.y, WIRE_RUN_Y_Z_MM),
    riseStep(b.pos.z),
  ]);
  const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
  const route: WireRoute = {
    wireId: wire.id,
    kind: 'direct',
    points,
    corners,
    channelIds: [],
    lanes: [],
    lane: level,
    laneOverflow: false,
    lengthMm: polylineLength(points),
  };
  return crossingFootprint(board, route) === undefined ? route : undefined;
}

/** その経路が端子 `a` と同じ列の渡り線か（張り出しの段を分けるための判定）。 */
function sameRow(route: WireRoute, a: BoardTerminal): boolean {
  const first = route.corners[0];
  return first !== undefined && Math.abs(first.y - a.pos.y) < EPS;
}

/**
 * 両端の端子が同じ節点に出るとき（同じ帯の同じ位置に引き出される）の経路。
 * 帯まで下りて戻ると、帯を通り越して折り返すだけの経路になってしまうので、
 * 端子のあいだをまっすぐ直角に渡す。帯もレーンも使わないので `kind` は `direct`。
 */
function sameNodeRoute(
  board: BoardDefinition,
  wire: RoutableWire,
  a: BoardTerminal,
  b: BoardTerminal,
): WireRoute {
  const corners = buildCorners(a.pos, [
    toStep(b.pos.x, a.pos.y, WIRE_RUN_X_Z_MM),
    toStep(b.pos.x, b.pos.y, WIRE_RUN_Y_Z_MM),
    riseStep(b.pos.z),
  ]);
  const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
  const route: WireRoute = {
    wireId: wire.id,
    kind: 'direct',
    points,
    corners,
    channelIds: [],
    lanes: [],
    lane: 0,
    laneOverflow: false,
    lengthMm: polylineLength(points),
  };
  const hit = crossingFootprint(board, route);
  if (hit !== undefined) {
    throw new RoutingError(
      `経路が部品の上を通ります（${hit.kind} ${hit.id}）: ${wire.from} → ${wire.to}`,
      wire.id,
      'footprint-crossing',
    );
  }
  return route;
}

function terminalOf(board: BoardDefinition, wire: RoutableWire, id: TerminalId): BoardTerminal {
  const found = findBoardTerminal(board, id);
  if (found === undefined) {
    throw new RoutingError(`盤に無い端子です: ${id}`, wire.id, 'invalid-terminal');
  }
  return found;
}

/** 帯を1回続けて走る区間（ここがレーン割当の単位）。 */
interface Traversal {
  channelId: string;
  channel: WiringChannel;
  lo: number;
  hi: number;
  /** 帯の幅方向のレーン（`pickLane` のあとで入る）。 */
  lane: number;
  /** 帯の高さ方向のレイヤ（`pickLane` のあとで入る）。 */
  layer: number;
}

/**
 * 経路の辺を「同じ帯を続けて走るまとまり」に切り分ける。
 * 帯ごとに min..max でまとめてしまうと、離れた2回の走行が1つの大きな区間になって
 * レーンを無駄に食いつぶすので、走行ごとに区間を持つ。
 *
 * まとめ先は「直前の辺の走行」だけ（`current`）。辺を1つでも飛ばしたら区切りなおすので、
 * 同じ帯へ戻ってきた2回目の走行は必ず別の区間になる。
 */
function buildTraversals(
  path: { keys: string[]; channelIds: string[] },
  nodes: Map<string, GraphNode>,
  channelById: ReadonlyMap<string, WiringChannel>,
): { traversals: Traversal[]; edgeTraversal: number[] } {
  const traversals: Traversal[] = [];
  const edgeTraversal: number[] = [];
  let current: Traversal | undefined;
  path.channelIds.forEach((channelId, edge) => {
    const channel = channelById.get(channelId);
    const nodeA = nodes.get(path.keys[edge] ?? '');
    const nodeB = nodes.get(path.keys[edge + 1] ?? '');
    if (channel === undefined || nodeA === undefined || nodeB === undefined) {
      current = undefined;
      edgeTraversal.push(-1);
      return;
    }
    const va = alongOf(channel, nodeA.x, nodeA.y);
    const vb = alongOf(channel, nodeB.x, nodeB.y);
    if (current !== undefined && current.channelId === channelId) {
      current.lo = Math.min(current.lo, va, vb);
      current.hi = Math.max(current.hi, va, vb);
    } else {
      current = {
        channelId,
        channel,
        lo: Math.min(va, vb),
        hi: Math.max(va, vb),
        lane: 0,
        layer: 0,
      };
      traversals.push(current);
    }
    edgeTraversal.push(traversals.length - 1);
  });
  return { traversals, edgeTraversal };
}

/**
 * 1本の電線の経路を求める。§6.6
 * 端子 → 垂直に引き出す → 配線帯 → 直角に走る → 目的端子の列 → 端子。
 * `wire.from` / `wire.to` は**物理**端子ID（`S1.13` / `TB_PB.1a` など）。
 *
 * 帯を走るたびに、区間の重なる既存経路を避けたレーン（幅方向2mmピッチ）と
 * レイヤ（高さ方向）を割り当てる。空きが無ければ `laneOverflow` を立てる（投げない）。
 *
 * @param board 盤定義。
 * @param wire 経路を求める電線（物理端子ID）。
 * @param existingRoutes 先に引いてある経路。レーンを分けるために読むだけで、変更はしない。
 *   {@link routeFixedLinks} の既設ハーネスは渡さないこと（`kind: 'harness'` なので
 *   渡り線の段には数えないが、レーンの計算に混ぜる意味が無い）。
 * @param options 経路生成のオプション。`exitOverride` で端子ごとの引き出し向きを強制できる
 *   （指定すると渡り線のショートカットは使わず、必ず配線帯の経路になる）。
 * @throws {RoutingError} 端子が盤に無い（`invalid-terminal`）、帯に出られない・帯がつながって
 *   いない（`unreachable`）、部品の上を通ってしまう（`footprint-crossing`）とき。
 */
export function routeWire(
  board: BoardDefinition,
  wire: RoutableWire,
  existingRoutes: readonly WireRoute[],
  options: RouteOptions = {},
): WireRoute {
  const a = terminalOf(board, wire, wire.from);
  const b = terminalOf(board, wire, wire.to);
  if (options.exitOverride === undefined) {
    const direct = directRunRoute(board, wire, a, b, existingRoutes);
    if (direct !== undefined) return direct;
  }
  const chA = entryChannelFor(board, a, options.exitOverride?.[wire.from]);
  const chB = entryChannelFor(board, b, options.exitOverride?.[wire.to]);
  if (chA === undefined || chB === undefined) {
    throw new RoutingError(
      `端子から出られる配線帯がありません: ${wire.from} / ${wire.to}`,
      wire.id,
      'unreachable',
    );
  }

  const entryA = { channel: chA, along: alongOf(chA, a.pos.x, a.pos.y) };
  const entryB = { channel: chB, along: alongOf(chB, b.pos.x, b.pos.y) };
  const graph = buildChannelGraph(board.wiringChannels, [entryA, entryB]);
  const pa = pointOn(chA, entryA.along);
  const pb = pointOn(chB, entryB.along);
  const path = shortestPath(graph.edges, key(pa.x, pa.y), key(pb.x, pb.y));
  if (path === undefined) {
    throw new RoutingError(
      `配線帯がつながっていません: ${wire.from} → ${wire.to}`,
      wire.id,
      'unreachable',
    );
  }
  // 両端が同じ節点に出るなら、帯まで下りて折り返さずまっすぐ渡す
  if (path.channelIds.length === 0) return sameNodeRoute(board, wire, a, b);

  const channelById = options.channelById ?? channelByIdOf(board.wiringChannels);
  const { traversals, edgeTraversal } = buildTraversals(path, graph.nodes, channelById);
  const spans: ChannelSpan[] = traversals.map((t) => ({
    channelId: t.channelId,
    lo: t.lo,
    hi: t.hi,
  }));
  const assignment = pickLane(spans, existingRoutes);
  assignment.lanes.forEach((assigned, index) => {
    const traversal = traversals[index];
    if (traversal === undefined) return;
    traversal.lane = assigned.lane;
    traversal.layer = assigned.layer;
  });
  /** その辺を走る帯（辺の番号が範囲外なら `undefined`）。 */
  const traversalOf = (edge: number): Traversal | undefined =>
    traversals[edgeTraversal[edge] ?? -1];

  // 節点の位置。帯の乗り換え点では、入ってきた帯と出ていく帯の**両方**のレーンずらしを足す。
  const positions = path.keys.map((k, index) => {
    const node = graph.nodes.get(k) ?? { x: 0, y: 0, channels: [] };
    let dx = 0;
    let dy = 0;
    const applied = new Set<Traversal>();
    for (const edge of [index - 1, index]) {
      const traversal = traversalOf(edge);
      if (traversal === undefined || applied.has(traversal)) continue;
      applied.add(traversal);
      const shift = laneShift(traversal.channel, traversal.lane);
      dx += shift.dx;
      dy += shift.dy;
    }
    return { x: node.x + dx, y: node.y + dy };
  });

  const first = positions[0] ?? { x: a.pos.x, y: a.pos.y };
  const last = positions[positions.length - 1] ?? { x: b.pos.x, y: b.pos.y };
  // 引き出しのずらし。帯に入る／出る走行のレーンで高さの段（偶奇）と横位置を分ける。
  // 横ずらしは帯の走行軸に沿うので、帯へ入る角がそのまま吸収する（帯の中の走りは変わらない）。
  // 帯が縦向き（引き出しと同じ向き）のときは角が吸収できないので横ずらしはしない。
  const startRun = traversals[0];
  const endRun = traversals[traversals.length - 1];
  const startLane = startRun?.lane ?? 0;
  const endLane = endRun?.lane ?? 0;
  const startDx = startRun?.channel.axis === 'x' ? leadOutOffset(startLane) : 0;
  const endDx = endRun?.channel.axis === 'x' ? leadOutOffset(endLane) : 0;
  const startX = first.x + startDx;
  const endX = last.x + endDx;
  // 端子 → 盤面へ立ち下げ → 帯へ引き出す → 帯を走る → 目的端子の列へ → 端子
  const steps: RouteStep[] = [
    toStep(startX, a.pos.y, runZ('x', startLane % WIRE_LAYER_COUNT)),
    toStep(startX, first.y, runZ('y', startLane % WIRE_LAYER_COUNT)),
  ];
  positions.forEach((p, index) => {
    const traversal = traversalOf(index - 1);
    if (traversal === undefined) return;
    // 最後の節点は引き出しのずれを織り込んだ位置にする（帯の中で折り返さないように）
    const x = index === positions.length - 1 ? endX : p.x;
    steps.push(toStep(x, p.y, channelZ(traversal.channel, traversal.layer)));
  });
  steps.push(toStep(endX, b.pos.y, runZ('y', endLane % WIRE_LAYER_COUNT)));
  steps.push(toStep(b.pos.x, b.pos.y, runZ('x', endLane % WIRE_LAYER_COUNT)));
  steps.push(riseStep(b.pos.z));

  const corners = buildCorners(a.pos, steps);
  const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
  const route: WireRoute = {
    wireId: wire.id,
    kind: 'channel',
    points,
    corners,
    channelIds: dedupeStrings([chA.id, ...path.channelIds, chB.id]),
    lanes: assignment.lanes,
    lane: assignment.lanes[0]?.lane ?? 0,
    laneOverflow: assignment.overflow,
    lengthMm: polylineLength(points),
  };
  const hit = crossingFootprint(board, route);
  if (hit !== undefined) {
    throw new RoutingError(
      `経路が部品の上を通ります（${hit.kind} ${hit.id}）: ${wire.from} → ${wire.to}`,
      wire.id,
      'footprint-crossing',
    );
  }
  return route;
}

/** 経路生成のオプション。 */
export interface RouteOptions {
  /** 端子ごとに引き出し向きを強制する（既設ハーネスを写真どおり手前へ出すのに使う）。 */
  exitOverride?: Readonly<Record<string, 'rear' | 'front'>>;
  /**
   * `channel.id → WiringChannel` の索引。省略時は {@link channelByIdOf} が `board.wiringChannels`
   * ごとにメモ化した索引を使うので、渡さなくても電線ごとに作り直されることはない（BM-05）。
   * `routeSession()` は1セッションぶんを1回だけ作って渡す。
   */
  channelById?: ReadonlyMap<string, WiringChannel>;
}

/** 机上へ渡る電線（盤の経路生成の対象外）。§10.1 / 決定表#9 */
export interface DeskWire {
  id: string;
  from: TerminalId;
  to: TerminalId;
  fromPos: Vec3;
  toPos: Vec3;
}

/**
 * セッションの全電線の経路を、配列の並び順に求める。§6.6
 * 役割端子ID（`CR1.13`）は物理端子ID（`S1.13`）に解決してから経路にする。
 *
 * 既設の0Ωリンク（端子台 → PB／PL本体の青線ハーネス）は `session.wires` に入っていないので、
 * ここには**含まれない**。3D側はこの結果と {@link routeFixedLinks} の両方を描くこと。
 *
 * **机上の装置（PLC本体・壁コンセント）に繋がる電線は含まない。** 盤面の配線帯は机上まで
 * 伸びていないため、経路器にかけると帯・レーン・占有矩形の不変条件が壊れる。机上へ渡る
 * 電線は {@link deskWires} で取り、3D側は直線のケーブルとして描く（Plan 3B）。
 */
export function routeSession(board: BoardDefinition, session: BoardSession): WireRoute[] {
  const routes: WireRoute[] = [];
  // BM-05: 1セッションぶんの `channelById` をここで1回だけ作り、電線ごとに使い回す
  // （`routeWire()` 単体で呼ぶ他の呼び出し元は、渡さなければ `channelByIdOf()` の
  // メモ化に自動で乗る）。
  const channelById = channelByIdOf(board.wiringChannels);
  for (const wire of session.wires) {
    if (isOffBoardTerminal(wire.from) || isOffBoardTerminal(wire.to)) continue;
    routes.push(
      routeWire(
        board,
        {
          id: wire.id,
          from: toPhysicalTerminal(session.socketRoles, wire.from),
          to: toPhysicalTerminal(session.socketRoles, wire.to),
        },
        routes,
        { channelById },
      ),
    );
  }
  return routes;
}

/**
 * 机上へ渡る電線（PLC本体・壁コンセントに繋がるもの）。§10.1
 * 盤側の端子は物理端子IDに解決してから座標を引く。盤に無い端子（未割当の役割など）は飛ばす。
 */
export function deskWires(board: BoardDefinition, session: BoardSession): DeskWire[] {
  const out: DeskWire[] = [];
  for (const wire of session.wires) {
    if (!isOffBoardTerminal(wire.from) && !isOffBoardTerminal(wire.to)) continue;
    const from = toPhysicalTerminal(session.socketRoles, wire.from);
    const to = toPhysicalTerminal(session.socketRoles, wire.to);
    const fromTerminal = findBoardTerminal(board, from);
    const toTerminal = findBoardTerminal(board, to);
    if (fromTerminal === undefined || toTerminal === undefined) continue;
    out.push({ id: wire.id, from, to, fromPos: fromTerminal.pos, toPos: toTerminal.pos });
  }
  return out;
}

/**
 * 既設の青線ハーネス（端子台 → PB／PL本体）の経路。§6.4 / 写真
 * 配線帯は使わず、端子台の端子から**手前へまっすぐ降り**、機器の根元にある盤面の貫通穴に
 * 2mmピッチで平行に入って、盤の裏側の本体端子へつながる。機器の中心（押ボタンの頭・
 * ランプのレンズ）の上は通らない。
 *
 * 返す経路は `kind: 'harness'` で、レーンも配線帯も使わない。
 * {@link routeWire} / {@link routeSession} の `existingRoutes` には**渡さないこと**
 * （渡り線の段にもレーンにも数えないので意味が無い）。
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
    const holeX = hole.x + offset;
    const corners = buildCorners(block.pos, [
      toStep(block.pos.x, approachY, WIRE_RUN_Y_Z_MM),
      toStep(holeX, approachY, WIRE_RUN_X_Z_MM),
      toStep(holeX, hole.y, WIRE_RUN_Y_Z_MM),
      riseStep(0),
      riseStep(body.pos.z),
      toStep(holeX, body.pos.y, body.pos.z),
      toStep(body.pos.x, body.pos.y, body.pos.z),
    ]);
    const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
    routes.push({
      wireId: link.id,
      kind: 'harness',
      points,
      corners,
      channelIds: [],
      lanes: [],
      lane: index,
      laneOverflow: false,
      throughPanelAt: vec3(holeX, hole.y, 0),
      lengthMm: polylineLength(points),
    });
  }
  return routes;
}

/** 折れ点列が直角経路か（隣り合う点で動く軸がちょうど1つか）。 */
export function isManhattan(corners: readonly Vec3[], epsilon = EPS): boolean {
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

/**
 * 配線帯が部品の占有領域と重なっていないか（盤定義の不変条件）。§6.6
 * 帯の矩形は {@link channelBandRect} と同じもの（帯の定義は1か所だけ）。
 */
export function channelsClearOfFootprints(board: BoardDefinition): string[] {
  const bad: string[] = [];
  for (const channel of board.wiringChannels) {
    const band = channelBandRect(channel);
    for (const fp of board.footprints) {
      if (rectsOverlap(band, fp)) bad.push(`${channel.id} × ${fp.id}`);
    }
  }
  return bad;
}
