/**
 * 盤の幾何ユーティリティ。すべて純関数で、単位は mm。
 * 座標系（設計仕様 §6.5 / §12.2）: 盤の左上手前が原点。
 * x = 右方向、y = 下方向（盤面に沿う）、z = 盤面からの高さ（表側が正、裏側が負）。
 */

/** 3D座標[mm]。 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 折れ線（経路）。 */
export type Polyline = readonly Vec3[];

/** 座標を作る。z を省略すると盤面（0）。 */
export function vec3(x: number, y: number, z = 0): Vec3 {
  return { x, y, z };
}

/** 加算。 */
export function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** 減算（a − b）。 */
export function subVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** スカラー倍。 */
export function scaleVec(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** ベクトルの長さ[mm]。 */
export function vecLength(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** 2点間の距離[mm]。 */
export function distance(a: Vec3, b: Vec3): number {
  return vecLength(subVec(a, b));
}

/** 指定桁で丸める。経路の同一性判定・スナップショット比較に使う。 */
export function roundVec(v: Vec3, decimals = 3): Vec3 {
  const scale = 10 ** decimals;
  return {
    x: Math.round(v.x * scale) / scale,
    y: Math.round(v.y * scale) / scale,
    z: Math.round(v.z * scale) / scale,
  };
}

/** 2点が（誤差内で）同じか。 */
export function vecEquals(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.z - b.z) < epsilon
  );
}

/** 折れ線の全長[mm]。 */
export function polylineLength(line: Polyline): number {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    const prev = line[i - 1];
    const cur = line[i];
    if (prev === undefined || cur === undefined) continue;
    total += distance(prev, cur);
  }
  return total;
}

/** 最寄り点の探索結果。 */
export interface NearestPoint {
  /** 最寄り点の座標。 */
  point: Vec3;
  /** 折れ線の何番目の区間か（0起点）。線分に対しては常に0。 */
  index: number;
  /** その区間内の位置（0=始点、1=終点）。 */
  t: number;
  /** 元の点からの距離[mm]。 */
  distance: number;
}

/** 線分 a–b 上で p に最も近い点。 */
export function nearestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): NearestPoint {
  const ab = subVec(b, a);
  const lengthSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  if (lengthSq === 0) return { point: a, index: 0, t: 0, distance: distance(p, a) };
  const ap = subVec(p, a);
  const raw = (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / lengthSq;
  const t = Math.min(Math.max(raw, 0), 1);
  const point = addVec(a, scaleVec(ab, t));
  return { point, index: 0, t, distance: distance(p, point) };
}

/**
 * 折れ線上で p に最も近い点。折れ線が空のときは p 自身を返す（距離0）。
 * 同距離の候補が複数あるときは先に現れた区間を選ぶ（決定論）。
 */
export function nearestPointOnPolyline(p: Vec3, line: Polyline): NearestPoint {
  let best: NearestPoint = { point: p, index: 0, t: 0, distance: 0 };
  let found = false;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    if (a === undefined || b === undefined) continue;
    const hit = nearestPointOnSegment(p, a, b);
    if (!found || hit.distance < best.distance) {
      best = { point: hit.point, index: i - 1, t: hit.t, distance: hit.distance };
      found = true;
    }
  }
  if (!found && line.length === 1) {
    const only = line[0];
    if (only !== undefined) return { point: only, index: 0, t: 0, distance: distance(p, only) };
  }
  return best;
}

/**
 * 線分 a–b のXY平面内の単位法線。
 * 進行方向によらず同じ側を返すため、方向ベクトルを辞書順で正規化してから回す。
 * ダクト内の並列オフセット（§6.6）の向きを決定論にするための規約。
 */
export function normalXY(a: Vec3, b: Vec3): Vec3 {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return vec3(0, 0, 0);
  return vec3(unsignZero(-dy / len), unsignZero(dx / len), 0);
}

/** `-0` を `0` に正規化する（比較とスナップショットの安定のため）。 */
function unsignZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** 盤面上の軸並行矩形[mm]（部品の占有領域など）。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 矩形の右端・下端。 */
export function rectRight(r: Rect): number {
  return r.x + r.w;
}

/** 矩形の下端。 */
export function rectBottom(r: Rect): number {
  return r.y + r.h;
}

/** 点が矩形の内側（境界を含む）にあるか。 */
export function rectContains(r: Rect, p: Vec3, epsilon = 1e-9): boolean {
  return (
    p.x >= r.x - epsilon &&
    p.x <= rectRight(r) + epsilon &&
    p.y >= r.y - epsilon &&
    p.y <= rectBottom(r) + epsilon
  );
}

/** 2つの矩形が重なるか（辺で接するだけは重なりとみなさない）。 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y;
}

/**
 * 線分（XY平面に射影したもの）が矩形の**内部**を通るか。
 * 境界に接するだけ（辺の上をなぞる・角に触れる）は通過とみなさない。
 * 配線が部品の上を横切っていないことの検査に使う。
 */
export function segmentIntersectsRect(a: Vec3, b: Vec3, r: Rect, epsilon = 1e-9): boolean {
  const x0 = r.x + epsilon;
  const x1 = rectRight(r) - epsilon;
  const y0 = r.y + epsilon;
  const y1 = rectBottom(r) - epsilon;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky のクリッピングで、線分と矩形内部の共通部分が長さを持つかを見る
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < epsilon) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - x0)) return false;
  if (!clip(dx, x1 - a.x)) return false;
  if (!clip(-dy, a.y - y0)) return false;
  if (!clip(dy, y1 - a.y)) return false;
  return t1 - t0 > epsilon;
}
