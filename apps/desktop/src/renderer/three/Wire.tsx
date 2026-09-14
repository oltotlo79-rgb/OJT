import { WIRE_DIAMETER_MM, type WireRoute } from '@ojt/board-model';
import type { WireColor } from '@ojt/circuit-sim';
import { useMemo, type JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import {
  LOCKED_RING_COLOR,
  LUG_COLOR,
  WIRE_COLORS,
  WIRE_LANE_OVERFLOW_COLOR,
  WIRE_SELECTED_COLOR,
} from '../session/colors.js';
import { LUG_GEOMETRY, sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 電線。設計仕様 §6.6 / §8.2。
 * `routeWire()` が返す**直角経路の折れ線**（角はフィレット済み）を `TubeGeometry`（半径0.8mm）で
 * 描き、両端に Y型圧着端子の簡易形状（輪）を付ける。色は青／白／黄の物理色。
 *
 * 高さは経路器が `WIRE_Z_LADDER_MM` の段（x方向は 2.4 / 6.0、y方向は 4.2 / 7.8）で決めてあり、
 * 高さの変わる角には `z` だけ動く点が入っている。**ここで z を足したり丸めたりしない**
 * （直角経路が壊れ、直交する電線どうしが食い込む）。`lanes[i].span` は帯の占有記録なので
 * 描画には使わない。
 *
 * ピックは**削除モードのときだけ**受ける。配線モードでは端子より手前を通る電線が
 * 端子のクリックを奪ってしまい、配線できない端子が出るため（§8.2 の操作性を優先）。
 */

/** チューブの半径[mm]（描画直径 1.6mm の半分。§6.6）。 */
export const WIRE_RADIUS_MM = WIRE_DIAMETER_MM / 2;
/** チューブの分割数（1セグメントあたり）。 */
const SEGMENTS_PER_POINT = 4;
/** 断面の分割数。 */
const RADIAL_SEGMENTS = 6;

/** レイキャストを受けない（配線モードで端子のクリックを奪わないため）。 */
function noPick(): void {
  // 交差候補を積まない
}

/**
 * 電線の胴体の色（純粋関数。テストで固定する）。§6.3 / §6.6 / §8.2
 * 優先順位は 選択中 → 既設配線（データ上の色が何であれ実物どおり青）→ レーン重なり → 物理色。
 * `laneOverflow` は「他の電線と同じ配線位置に載った」ことの唯一の手がかりなので、
 * 琥珀色にして訓練者が2本を1本と見誤らないようにする。
 */
export function wireBodyColor(
  route: WireRoute,
  color: WireColor,
  locked: boolean,
  selected: boolean,
): string {
  if (selected) return WIRE_SELECTED_COLOR;
  if (locked) return WIRE_COLORS['青'];
  if (route.laneOverflow) return WIRE_LANE_OVERFLOW_COLOR;
  return WIRE_COLORS[color];
}

/**
 * 経路から `TubeGeometry` を作る（純粋関数。メモ化して使う）。
 * `routeWire()` が角をフィレット済みの折れ線で返すので、ここでは曲線で丸め直さず
 * **点をそのまま通す**（`curveType: 'catmullrom'` の `tension: 0` ＝ 直線補間）。
 * 勝手に丸めると直角配線の「整列して見える」利点が失われるため。
 */
export function buildTubeGeometry(route: WireRoute): TubeGeometry {
  const points = route.points.map((p) => {
    const [x, y, z] = toScene(p);
    return new Vector3(x, y, z);
  });
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0);
  const segments = Math.max(8, points.length * SEGMENTS_PER_POINT);
  return new TubeGeometry(curve, segments, WIRE_RADIUS_MM, RADIAL_SEGMENTS, false);
}

/** 電線1本。 */
export function Wire({
  route,
  color,
  locked,
  selected,
  pickable,
  onPick,
}: {
  route: WireRoute;
  color: WireColor;
  locked: boolean;
  selected: boolean;
  /** 削除モードのときだけ true。§8.2 */
  pickable: boolean;
  onPick: (wireId: string) => void;
}): JSX.Element | null {
  const geometry = useMemo(() => buildTubeGeometry(route), [route]);
  const ends = useMemo(() => {
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    return first === undefined || last === undefined ? [] : [toScene(first), toScene(last)];
  }, [route]);
  if (route.points.length < 2) return null;
  const material = sharedMaterial(wireBodyColor(route, color, locked, selected), {
    roughness: locked ? 0.35 : 0.55,
    metalness: 0.05,
  });
  return (
    <group
      name={`wire-${route.wireId}`}
      userData={{ kind: route.kind, laneOverflow: route.laneOverflow }}
    >
      <mesh
        geometry={geometry}
        material={material}
        {...(pickable ? {} : { raycast: noPick })}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onPick(route.wireId);
        }}
      />
      {ends.map((pos, index) => (
        <mesh
          key={`${route.wireId}-lug-${index}`}
          geometry={LUG_GEOMETRY}
          material={sharedMaterial(locked ? LOCKED_RING_COLOR : LUG_COLOR, {
            metalness: 0.8,
            roughness: 0.3,
          })}
          raycast={noPick}
          position={pos}
          rotation={[Math.PI / 2, 0, 0]}
          scale={locked ? 1.25 : 1}
        />
      ))}
    </group>
  );
}
