import { useThree } from '@react-three/fiber';
import { useEffect, useState, type JSX } from 'react';
import { CylinderGeometry, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { noPick, sharedMaterial } from './materials.js';

/**
 * 配線中の仮の電線（始点の端子から指先まで）。Phase 7 設計 §7.3.2 / §7.3.4。
 *
 * 端子から端子へ**ドラッグ**して配線できるようにしたとき（利用者要望9）、途中の絵が無いと
 * 「いま何をしているのか」が画面に出ない。指先まで1本伸ばすことで、①配線中であること
 * ②どこから伸びているか ③放せばそこに繋がること、の3つが同時に伝わる。
 *
 * 色は**繋げられるか**で変える。§7.3.4 の「色だけに頼らない」に従い、繋げられないときは
 * 細く（`REFUSE_RADIUS_MM`）して太さでも区別する。
 */

/** 仮の電線の太さ[mm]（繋げられるとき）。実際の電線（2mm前後）より少し細くして仮であることを示す。 */
export const PREVIEW_RADIUS_MM = 1.4;
/** 繋げられないときの太さ[mm]（色に頼らず太さでも区別する）。 */
export const REFUSE_RADIUS_MM = 0.6;
/** 繋げられるときの色（緑）。 */
export const PREVIEW_COLOR = '#3FBF6F';
/** 繋げられないときの色（灰）。 */
export const REFUSE_COLOR = '#8A8F98';

/** 単位円柱（高さ1・半径1）。長さと太さは `scale` で作る（§15: ジオメトリは使い回す）。 */
const UNIT_CYLINDER = new CylinderGeometry(1, 1, 1, 8, 1, true);

/** 円柱の既定の向き（three の `CylinderGeometry` は +Y 方向に伸びる）。 */
const CYLINDER_AXIS = new Vector3(0, 1, 0);

/** 3成分の座標。 */
export type Vec3 = readonly [number, number, number];

/**
 * 2点を結ぶ円柱の姿勢（純関数。長さと中点と回転を単体テストで縛る）。
 * 長さが0のときは回転を単位にして返す（同じ点を指しているだけなので向きが決まらない）。
 */
export function segmentTransform(
  from: Vec3,
  to: Vec3,
): {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  length: number;
} {
  const start = new Vector3(from[0], from[1], from[2]);
  const end = new Vector3(to[0], to[1], to[2]);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const quaternion = new Quaternion();
  if (length > 0) quaternion.setFromUnitVectors(CYLINDER_AXIS, direction.clone().normalize());
  const middle = start.clone().add(end).multiplyScalar(0.5);
  return {
    position: [middle.x, middle.y, middle.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    length,
  };
}

/** 配線中の仮の電線。 */
export function WirePreview({
  from,
  to,
  legal,
}: {
  /** 始点（ワールド座標）。 */
  from: Vec3;
  /** 指先（ワールド座標）。 */
  to: Vec3;
  /** いま指しているところに繋げられるか。 */
  legal: boolean;
}): JSX.Element | null {
  const { position, quaternion, length } = segmentTransform(from, to);
  if (length <= 0) return null;
  const radius = legal ? PREVIEW_RADIUS_MM : REFUSE_RADIUS_MM;
  return (
    <mesh
      name="wire-preview"
      geometry={UNIT_CYLINDER}
      material={sharedMaterial(legal ? PREVIEW_COLOR : REFUSE_COLOR, {
        roughness: 0.5,
        metalness: 0.05,
        transparent: true,
        opacity: 0.85,
      })}
      // 仮の線は当たり判定を持たない（下の端子のホバーを奪わない）
      raycast={noPick}
      position={position}
      quaternion={quaternion}
      scale={[radius, length, radius]}
      renderOrder={10}
    />
  );
}

/**
 * 指先を追いかける仮の電線。Phase 7 設計 §7.3.2。
 *
 * 指先の位置は `pointermove` のたびに変わるので、**この部品の中だけ**で状態を持つ。
 * 盤の側（`BoardContents`）で状態にすると、ドラッグ中は盤の部分木がまるごと毎回
 * 作り直しになり、§15 の性能予算に効いてしまう。
 *
 * 指先の3D位置は「始点を通り、カメラの向きに正対する面」との交点で求める。盤の面に
 * 落とすと傾斜（13°）のぶん指先から離れていくのに対し、この面なら**どの視点でも
 * ポインタの真下**に来る。
 */
export function WireDragLayer({
  from,
  legal,
}: {
  /** 始点（ワールド座標）。配線していなければ undefined。 */
  from: Vec3 | undefined;
  /** いま繋げられる相手が居るか（仮の電線の色と太さに出る）。 */
  legal: boolean;
}): JSX.Element | null {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [tip, setTip] = useState<Vec3 | null>(null);

  useEffect(() => {
    if (from === undefined) {
      setTip(null);
      return undefined;
    }
    const origin = new Vector3(from[0], from[1], from[2]);
    const normal = new Vector3();
    const plane = new Plane();
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const point = new Vector3();
    const onMove = (event: PointerEvent): void => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      camera.getWorldDirection(normal);
      plane.setFromNormalAndCoplanarPoint(normal, origin);
      if (raycaster.ray.intersectPlane(plane, point) === null) return;
      setTip([point.x, point.y, point.z]);
      // `frameloop="demand"` なので、仮の電線が伸びたぶんは自分で描き直しを要求する
      invalidate();
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, [from, camera, gl, invalidate]);

  if (from === undefined || tip === null) return null;
  return <WirePreview from={from} to={tip} legal={legal} />;
}
