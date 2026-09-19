import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import type { GIZMO_FACE_ORDER } from './navigation.js';
import { GIZMO_TARGETS } from './navigation.js';

/**
 * ビューキューブの**形**の計算。設計仕様 §12.2 / 2026-09-19 の利用者要望
 * 「3Dのキューブのデザインがシンプルすぎる」。
 *
 * 以前のキューブは素の `BoxGeometry` 1個だったので、面・辺・角が全部同じ平らな箱に見え、
 * 「辺や角も押せる」ことが形から読み取れなかった。ここでは Blender のナビゲーションギズモと
 * 同じく**角を落としたキューブ（chamfered cube）**を組み立てる。
 *
 * - 面 … 一辺 `GIZMO_FACE_SPAN`（= 1 − 2×`GIZMO_CHAMFER`）の正方形が6枚。名札を焼く。
 * - 辺 … 面と面のあいだの細長い面取り（12枚）。
 * - 角 … 3枚の面取りが集まる正三角形（8枚）。
 *
 * 数値はすべて**一辺を1としたキューブの局所座標**。画面上の大きさは `ViewGizmo` が
 * `GIZMO_SIZE`[px] で拡大する。当たり判定（`navigation.ts` の `GIZMO_HIT_BOXES`）とは
 * 別物で、こちらは**見た目だけ**を受け持つ（当たり判定は押しやすさ優先で少し大きい）。
 *
 * three だけに依存し React には触れないので、単体テストからそのまま読める（§14.2）。
 */

/** 面取りの深さ（一辺を1としたときの割合）。各軸でこの分だけ角を削る。 */
export const GIZMO_CHAMFER = 0.12;

/** 面（名札を焼く正方形）の一辺。 */
export const GIZMO_FACE_SPAN = 1 - 2 * GIZMO_CHAMFER;

/** 辺の面取り1枚の寸法 [長辺, 短辺]。短辺は削った直角三角形の斜辺 = 深さ×√2。 */
export const GIZMO_EDGE_FACET_SIZE: readonly [number, number] = [
  GIZMO_FACE_SPAN,
  GIZMO_CHAMFER * Math.SQRT2,
];

/**
 * 角の面取り（正三角形）の外接円半径。
 * 頂点はキューブの稜線上の `(0.5 - 深さ, 0.5, 0.5)` などに来るので、
 * 重心からの距離は `深さ × √6 / 3`。
 */
export const GIZMO_CORNER_FACET_RADIUS = (GIZMO_CHAMFER * Math.sqrt(6)) / 3;

/** 面取り1枚の置き場所（`ViewGizmo` がそのまま `position` / `quaternion` に渡す）。 */
export interface GizmoFacet {
  /** 当たり判定と同じ名前（`front-top` / `front-top-right`）。ホバーの塗り分けに使う。 */
  id: string;
  kind: 'edge' | 'corner';
  position: readonly [number, number, number];
  /** `[x, y, z, w]`。面取りの法線が局所 +Z になる向き。 */
  quaternion: readonly [number, number, number, number];
}

/** 面の置き方（three の `BoxGeometry` と同じ材質順 +X / −X / +Y / −Y / +Z / −Z）。 */
interface FaceBasis {
  /** 面の法線。 */
  normal: readonly [number, number, number];
  /** 名札テクスチャの横方向（u が増える向き）。 */
  u: readonly [number, number, number];
  /** 名札テクスチャの縦方向（v が増える向き）。`u × v = normal` になっている。 */
  v: readonly [number, number, number];
}

/**
 * 6面の向き。名札が正立して読めるように u/v を選ぶ。
 * 上下の面は「正面の面が手前（画面の下）に来るように見下ろす／見上げる」ときに正立する向き。
 */
const FACE_BASES: readonly FaceBasis[] = [
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/**
 * 角を落としたキューブの**面だけ**のジオメトリ（6枚の正方形）。
 *
 * 材質グループを面ごとに分けてあるので、`BoxGeometry` と同じように
 * `attach="material-0..5"` の6枚のマテリアル（＝名札テクスチャ）をそのまま貼れる。
 * 面の法線は各軸ぴったりなので、`event.face.normal` から視点を引く既存の仕掛けも変わらない。
 */
export function chamferedFaceGeometry(): BufferGeometry {
  const half = GIZMO_FACE_SPAN / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  FACE_BASES.forEach((basis, faceIndex) => {
    const corners: readonly (readonly [number, number])[] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [su, sv] of corners) {
      for (let axis = 0; axis < 3; axis += 1) {
        const n = basis.normal[axis] ?? 0;
        const u = basis.u[axis] ?? 0;
        const v = basis.v[axis] ?? 0;
        positions.push(n * 0.5 + u * su * half + v * sv * half);
        normals.push(n);
      }
      uvs.push((su + 1) / 2, (sv + 1) / 2);
    }
    const base = faceIndex * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  for (let face = 0; face < FACE_BASES.length; face += 1) geometry.addGroup(face * 6, 6, face);
  return geometry;
}

/** 基底ベクトル3本 → `[x, y, z, w]` の四元数。 */
function quaternionFromBasis(
  x: Vector3,
  y: Vector3,
  z: Vector3,
): readonly [number, number, number, number] {
  const matrix = new Matrix4().makeBasis(x, y, z);
  const quaternion = new Quaternion().setFromRotationMatrix(matrix);
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

/**
 * 辺12枚・角8枚の面取り。`GIZMO_TARGETS`（当たり判定）と同じ id を持つので、
 * ホバー中の当たり判定に対応する面取りをそのまま光らせられる。
 */
export const GIZMO_FACETS: readonly GizmoFacet[] = GIZMO_TARGETS.filter(
  (target) => target.kind !== 'face',
).map((target) => {
  const [dx, dy, dz] = target.direction;
  const normal = new Vector3(dx, dy, dz).normalize();
  if (target.kind === 'edge') {
    // 長辺は「0 の軸」に沿う（例: front-top なら X 軸）
    const along = new Vector3(dx === 0 ? 1 : 0, dy === 0 ? 1 : 0, dz === 0 ? 1 : 0);
    const across = new Vector3().crossVectors(normal, along);
    const offset = 0.5 - GIZMO_CHAMFER / 2;
    return {
      id: target.id,
      kind: 'edge',
      position: [dx * offset, dy * offset, dz * offset] as const,
      quaternion: quaternionFromBasis(along, across, normal),
    };
  }
  // 角は3本の稜線の中点を向く正三角形。頂点0が「X 軸に平行な稜線」へ向くようにそろえる
  const toEdge = new Vector3(0, dy, dz).normalize();
  const x = toEdge.sub(normal.clone().multiplyScalar(toEdge.dot(normal))).normalize();
  const y = new Vector3().crossVectors(normal, x);
  const offset = 0.5 - GIZMO_CHAMFER / 3;
  return {
    id: target.id,
    kind: 'corner',
    position: [dx * offset, dy * offset, dz * offset] as const,
    quaternion: quaternionFromBasis(x, y, normal),
  };
});

/** 座標軸の三脚（Blender のナビゲーションギズモの X/Y/Z）の1本。 */
export interface GizmoAxisStub {
  /** 当たり判定と同じ名前（`right` / `left` …）。押すと同じ視点プリセットへ着く。 */
  id: (typeof GIZMO_FACE_ORDER)[number];
  /** 軸の名前（球に焼く文字）。 */
  letter: 'X' | 'Y' | 'Z';
  /** 正の向きか（負の向きは球を小さく・暗くして、棒も描かない）。 */
  positive: boolean;
  /** 軸の向き（単位ベクトル）。球はこの向きの先に置く。 */
  direction: readonly [number, number, number];
  /** 棒（円柱は局所 +Y が軸）をこの向きへ倒す四元数 `[x, y, z, w]`。 */
  quaternion: readonly [number, number, number, number];
}

/** 面の当たり判定 → 軸の文字と符号。 */
const AXIS_OF_FACE: Readonly<
  Record<(typeof GIZMO_FACE_ORDER)[number], { letter: 'X' | 'Y' | 'Z'; positive: boolean }>
> = {
  right: { letter: 'X', positive: true },
  left: { letter: 'X', positive: false },
  top: { letter: 'Y', positive: true },
  bottom: { letter: 'Y', positive: false },
  front: { letter: 'Z', positive: true },
  back: { letter: 'Z', positive: false },
};

/**
 * 座標軸の三脚6本（+X/−X/+Y/−Y/+Z/−Z）。§12.2
 * キューブと同じ回転で回るので「いま画面のどちらがどの軸か」が一目で分かる。
 * 球を押すと**面と同じ視点プリセット**へ着く（`id` が面の当たり判定と同じ）。
 */
export const GIZMO_AXIS_STUBS: readonly GizmoAxisStub[] = GIZMO_TARGETS.filter(
  (target) => target.kind === 'face',
).map((target) => {
  const [dx, dy, dz] = target.direction;
  const direction = new Vector3(dx, dy, dz).normalize();
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
  const id = (target.preset ?? 'front') as (typeof GIZMO_FACE_ORDER)[number];
  const axis = AXIS_OF_FACE[id];
  return {
    id,
    letter: axis.letter,
    positive: axis.positive,
    direction: [direction.x, direction.y, direction.z] as const,
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] as const,
  };
});
