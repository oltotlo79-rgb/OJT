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
        return (
          <mesh
            key={i}
            name={`wire-connection-${connection.terminalId}-${connection.slot}`}
            geometry={forkGeometry(
              -offset,
              connection.slot,
              connection.contact.z - connection.screw.z,
            )}
            position={toScene(connection.screw)}
            quaternion={new Quaternion().setFromUnitVectors(AXIS, direction)}
            material={presetMaterial('brass', LUG_COLOR, locked ? { roughness: 0.4 } : {})}
            raycast={noPick}
          />
        );
      })}
    </group>
  );
}
