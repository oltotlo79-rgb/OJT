import { useMemo } from 'react';
import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Path,
  Shape,
  FrontSide,
  InstancedMesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Material,
  type Matrix4,
  type Side,
} from 'three';

/**
 * 共有ジオメトリ／マテリアル。設計仕様 §15「電線はチューブジオメトリを共有マテリアルで描く」。
 * 端子は 5 ソケット × 14 ピン ＋ 端子台 20 個 ＋ P/N 12 個で 100 個を超えるため、
 * 形と色が同じものは必ず 1 個を使い回してドローコールとメモリを抑える。
 */

/** ネジ端子の見た目（半径 1.8mm・高さ 1.6mm の円柱）。 */
export const SCREW_GEOMETRY = (() => {
  const head = new Shape();
  head.absarc(0, 0, 1.8, 0, Math.PI * 2, false);
  const slot = new Path();
  const points = [
    [-0.3, -1.3],
    [-0.3, -0.3],
    [-1.3, -0.3],
    [-1.3, 0.3],
    [-0.3, 0.3],
    [-0.3, 1.3],
    [0.3, 1.3],
    [0.3, 0.3],
    [1.3, 0.3],
    [1.3, -0.3],
    [0.3, -0.3],
    [0.3, -1.3],
  ] as const;
  slot.moveTo(...points[0]);
  for (const point of points.slice(1)) slot.lineTo(point[0], point[1]);
  slot.closePath();
  head.holes.push(slot);
  const geometry = new ExtrudeGeometry(head, {
    depth: 1.4,
    bevelEnabled: true,
    bevelSize: 0.1,
    bevelThickness: 0.1,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -0.7);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
})();

/** 端子の当たり判定球（実際の半径は `pickRadiusMm` でスケールする）。§6.5 */
export const PICK_GEOMETRY = new SphereGeometry(1, 10, 8);

/** 1×1×1 の箱（スケールして使い回す）。 */
export const UNIT_BOX = new BoxGeometry(1, 1, 1);

/** Y型圧着端子の輪（外径 5mm・線径 0.9mm）。§6.6 */
export const LUG_GEOMETRY = new CylinderGeometry(2.5, 2.5, 0.9, 10, 1, true);

/**
 * 差込穴・盤面の貫通穴の円柱（**半径1・高さ0.5**で作り、使う側が `scale` で実寸にする）。3D-02
 *
 * 以前は `Socket` が `<cylinderGeometry args={[…]} />` を JSX の子として書いていたため、
 * R3F が mesh ごとに新しいインスタンスを作り、8ソケット×14穴＝**112個の `CylinderGeometry` と
 * 112個の `MeshStandardMaterial`**ができていた（`FixedWires` の貫通穴20個も同じ形）。
 * このファイル冒頭の方針（形と色が同じものは1個を使い回す）に真っ向から反する。
 * 使う側は `instancedMesh` に渡して**穴をまとめて1ドローコール**で描く。
 */
export const PIN_HOLE_GEOMETRY = new CylinderGeometry(1, 1, 0.5, 8);

/**
 * レイキャストを受けない（飾りの板や輪がクリックを奪わないようにする）。
 * `Socket` / `TerminalBlock` / `TerminalField` が同じものを使う（同じ1行を3箇所に置かないため）。
 */
export function noPick(): void {
  // 交差候補を積まない
}

/**
 * 当たり判定メッシュ用のマテリアル。3D-09
 *
 * 当たり判定のメッシュには**必ず `visible={false}` も付ける**こと。three の `Raycaster` は
 * `visible` を見ない（`layers` と `raycast()` だけで絞る）ので、`visible={false}` にしても
 * クリックは拾えるのに、描画からは丸ごと外れてドローコールも深度ソートも払わなくて済む
 * （`TerminalHit` / `TerminalField` / `WirePickBody` はすべてこの形）。「`visible={false}` だと
 * レイキャストが辿らない」というのは**事実ではない**。このマテリアルはその上で、
 * 万一 `visible` を落とし忘れたときにも絵に出ないようにするための保険である。
 */
export const INVISIBLE_MATERIAL: Material = new MeshStandardMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

const materialCache = new Map<string, MeshStandardMaterial>();

/** 色ごとに1個だけ作る標準マテリアル。 */
export function sharedMaterial(
  color: string,
  options: {
    metalness?: number;
    roughness?: number;
    emissive?: string;
    emissiveIntensity?: number;
    opacity?: number;
    transparent?: boolean;
    /** 面の向き（既定 `FrontSide`）。白線のアウトラインだけ `BackSide` で内側から描く。 */
    side?: Side;
  } = {},
): MeshStandardMaterial {
  /*
   * `opacity` / `transparent` / `side` もキャッシュ鍵に混ぜる（レビュー指摘 I5）。混ぜないと、
   * 同じ色で違う設定（不透明と半透明、FrontSide と BackSide）の両方を要求したときに、
   * 先に作られた方のマテリアルを使い回してしまう。
   */
  const key = `${color}|${options.metalness ?? 0.1}|${options.roughness ?? 0.7}|${options.emissive ?? ''}|${options.emissiveIntensity ?? 0}|${options.opacity ?? 1}|${options.transparent === true ? 1 : 0}|${options.side ?? FrontSide}`;
  const cached = materialCache.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.1,
    roughness: options.roughness ?? 0.7,
    ...(options.emissive === undefined ? {} : { emissive: options.emissive }),
    emissiveIntensity: options.emissiveIntensity ?? 0,
    opacity: options.opacity ?? 1,
    transparent: options.transparent ?? false,
    side: options.side ?? FrontSide,
  });
  materialCache.set(key, material);
  return material;
}

/** 発光強度だけが変わるマテリアル（ランプ用。色ごとにインスタンスを分ける）。§5.3.4 */
export function useLampMaterial(color: string, intensity: number): MeshStandardMaterial {
  const material = useMemo(
    () =>
      new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.35 }),
    [color],
  );
  material.emissiveIntensity = intensity;
  return material;
}

/**
 * `instancedMesh` の ref へ行列を流し込み、外接球を作り直す。3D-02 / 3D-12
 *
 * 外接球は**視錐台カリングとレイキャストの足切りの両方**に使われるので、行列を入れ替えたら
 * 必ず作り直す（作らないと three が単位行列のまま＝原点に固まった球で計算し、盤を横から
 * 見たときに丸ごと消える）。
 *
 * `<Canvas>` の**外**では ref に DOM 要素が入る（RTL の単体テストは R3F の調停器を通さず
 * 素の DOM へ描くため）。その場合は何もせず `false` を返す。ここで受け止めておかないと、
 * 3Dの部品を DOM に描いて確かめている既存のテストが `setMatrixAt is not a function` で落ちる。
 */
export function applyInstanceMatrices(
  mesh: InstancedMesh | null,
  matrices: readonly Matrix4[],
): boolean {
  if (!(mesh instanceof InstancedMesh)) return false;
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return true;
}
