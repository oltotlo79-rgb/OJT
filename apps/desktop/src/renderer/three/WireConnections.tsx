import { WIRE_LUG_REACH_MM, type WireRoute } from '@ojt/board-model';
import type { JSX } from 'react';
import {
  type BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Shape,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LUG_COLOR } from '../session/colors.js';
import { toScene } from './coords.js';
import { noPick, presetMaterial } from './materials.js';

/** Y型圧着端子。平たい二股をネジへ差し込み、その横のバレルへ電線が入る。 */
const FORKS = new Map<string, BufferGeometry>();
function forkGeometry(offset: number, slot: number, height: number): BufferGeometry {
  const key = `${offset}:${slot}:${height}`;
  const cached = FORKS.get(key);
  if (cached !== undefined) return cached;
  const fork = new Shape();
  fork.moveTo(-2.15, -1.6);
  for (const [x, y] of [
    [-2.15, 1.0],
    [offset - 1.05, 2.6],
    [offset + 1.05, 2.6],
    [2.15, 1.0],
    [2.15, -1.6],
    [1.05, -1.6],
    [1.05, 0.85],
    [-1.05, 0.85],
    [-1.05, -1.6],
  ] as const)
    fork.lineTo(x, y);
  fork.closePath();
  const plate = new ExtrudeGeometry(fork, { depth: 0.15, bevelEnabled: false, steps: 1 });
  plate.translate(0, 0, height - 1.1 + slot * 0.15);
  const barrel = new CylinderGeometry(0.95, 0.95, 2, 10);
  barrel.translate(offset, WIRE_LUG_REACH_MM - 0.8, height);
  const barrelTriangles = barrel.toNonIndexed();
  const merged = mergeGeometries([plate, barrelTriangles]);
  plate.dispose();
  barrel.dispose();
  barrelTriangles.dispose();
  if (merged === null) throw new Error('圧着端子の形状を作れません');
  FORKS.set(key, merged);
  return merged;
}
const AXIS = new Vector3(0, 1, 0);

/*
 * 絶縁スリーブ（v2.0.0 Task 6・設計 §3.5「形の作り込み」）。
 * 1.25sq 用の圧着端子には赤い絶縁被覆が付いていて、電線はその中へ入る。半径は電線より太く、
 * 長さはバレルの出口（`WIRE_LUG_REACH_MM`）から電線の直線部（`wire-dressing.ts` の
 * STRAIGHT_LEAD_MM = 10mm）の中に収まるので、曲がり角にかぶらない。
 */
/** 絶縁スリーブの半径[mm]（電線の直径 1.6 を包む）。 */
export const SLEEVE_RADIUS_MM = 1.4;
/** 絶縁スリーブの長さ[mm]。 */
export const SLEEVE_LENGTH_MM = 3.2;
/** スリーブの中心をバレルの出口（`WIRE_LUG_REACH_MM`）から電線側へずらす量[mm]。 */
export const SLEEVE_CENTER_OFFSET_MM = 0.9;
/** 絶縁スリーブの色（1.25sq ＝ 赤）。 */
export const SLEEVE_COLOR = '#C8322B';
const SLEEVE_GEOMETRY = new CylinderGeometry(SLEEVE_RADIUS_MM, SLEEVE_RADIUS_MM, SLEEVE_LENGTH_MM, 12);

export function WireConnections({
  route,
  locked,
}: {
  route: WireRoute;
  locked: boolean;
}): JSX.Element | null {
  if (route.connections === undefined || route.connections.length === 0) return null;
  return (
    <group name={`wire-connections-${route.wireId}`}>
      {route.connections.map((connection, i) => {
        const direction = new Vector3(connection.direction.x, -connection.direction.y, 0);
        const offset =
          (connection.contact.x - connection.screw.x) * connection.direction.y -
          (connection.contact.y - connection.screw.y) * connection.direction.x;
        const height = connection.contact.z - connection.screw.z;
        return (
          <group
            key={i}
            name={`wire-connection-${connection.terminalId}-${connection.slot}`}
            position={toScene(connection.screw)}
            quaternion={new Quaternion().setFromUnitVectors(AXIS, direction)}
          >
            {/* Y型の板とバレル（黄銅） */}
            <mesh
              geometry={forkGeometry(-offset, connection.slot, height)}
              material={presetMaterial('brass', LUG_COLOR, locked ? { roughness: 0.4 } : {})}
              raycast={noPick}
            />
            {/* 絶縁スリーブ（赤）。バレルの出口を覆い、電線はこの中へ入る。v2.0.0 Task 6 */}
            <mesh
              name={`wire-sleeve-${connection.terminalId}-${connection.slot}`}
              geometry={SLEEVE_GEOMETRY}
              material={presetMaterial('pvc', SLEEVE_COLOR)}
              raycast={noPick}
              position={[-offset, WIRE_LUG_REACH_MM + SLEEVE_CENTER_OFFSET_MM, height]}
            />
          </group>
        );
      })}
    </group>
  );
}
