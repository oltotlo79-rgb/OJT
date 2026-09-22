import type { JSX } from 'react';
import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  MeshStandardMaterial,
  Shape,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noPick, sharedMaterial } from './materials.js';

/** 材質ごとに形状を結合して共有する。コイルの巻線1本ごとに描画呼出しを増やさない。 */
function joined(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('部品の共有形状を作成できませんでした');
  return geometry;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number): BoxGeometry =>
  new BoxGeometry(w, h, d).translate(x, y, z);

// 標準化した内部構造。外形に合わせて伸縮し、既存の端子・当たり判定には干渉しない。
const bobbin = joined([
  box(26, 25, 3, 0, 0, -14),
  new CylinderGeometry(4.2, 4.2, 14, 20).translate(0, -3, -3),
  new CylinderGeometry(6.2, 6.2, 1.4, 20).translate(0, -10.5, -3),
  new CylinderGeometry(6.2, 6.2, 1.4, 20).translate(0, 4.5, -3),
]);
const windings = joined(
  Array.from({ length: 18 }, (_, i) =>
    new TorusGeometry(5.0, 0.38, 6, 24).rotateX(Math.PI / 2).translate(0, -9.5 + i * 0.76, -3),
  ),
);
const iron = joined([
  box(3, 20, 3, -8, -3, -7),
  box(19, 3, 3, 0, -11.5, -7),
  box(19, 3, 3, 0, 6.5, -7),
  ...[-9, -3, 3, 9].map((x) => box(2.4, 10, 1.2, x, 7, 5)),
]);
const contacts = joined(
  [-9, -3, 3, 9].flatMap((x) => [
    box(1.5, 10, 0.65, x, 7, 8),
    new CylinderGeometry(1.4, 1.4, 0.8, 12).rotateX(Math.PI / 2).translate(x, 10.5, 7.4),
  ]),
);
const timerVents = joined(
  Array.from({ length: 6 }, (_, i) => box(0.45, 0.7, 18, 14, -7 + i * 2.1, -3)),
);

/** 透明ケースは深度を書かず、内部の巻線と接点が見える。透過用の追加描画パスは使わない。 */
export const RELAY_SHELL = new MeshStandardMaterial({
  color: '#d7e6ef',
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  metalness: 0.05,
  roughness: 0.18,
});

const housingCache = new Map<string, BufferGeometry>();
/** 面取りしたケース。最大寸法は元の当たり判定と同じ。 */
export function sharedHousing(w: number, h: number, depth: number): BufferGeometry {
  const key = `${w}/${h}/${depth}`;
  const found = housingCache.get(key);
  if (found) return found;
  const inset = 0.7;
  const x = w / 2 - inset;
  const y = h / 2 - inset;
  const s = new Shape();
  s.moveTo(-x, -y);
  s.lineTo(x, -y);
  s.lineTo(x, y);
  s.lineTo(-x, y);
  s.closePath();
  const geometry = new ExtrudeGeometry(s, {
    depth: depth - inset * 2,
    bevelEnabled: true,
    bevelSize: inset,
    bevelThickness: inset,
    bevelSegments: 2,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2 + inset);
  housingCache.set(key, geometry);
  return geometry;
}

export function ComponentDetails({
  relay,
  energized,
  width,
  height,
  center,
}: {
  relay: boolean;
  energized: boolean;
  width: number;
  height: number;
  center: [number, number, number];
}): JSX.Element {
  return (
    <group position={center} scale={[width / 28, height / 28, 1]}>
      {relay ? (
        <>
          <mesh
            geometry={bobbin}
            material={sharedMaterial('#202933', { roughness: 0.58 })}
            raycast={noPick}
          />
          <mesh
            geometry={windings}
            material={sharedMaterial('#bd642c', { metalness: 0.62, roughness: 0.3 })}
            raycast={noPick}
          />
          <mesh
            geometry={iron}
            material={sharedMaterial('#929da5', { metalness: 0.7, roughness: 0.3 })}
            raycast={noPick}
          />
          <mesh
            geometry={contacts}
            position={[0, 0, energized ? -1.5 : 0]}
            material={sharedMaterial('#dbbd68', { metalness: 0.55, roughness: 0.32 })}
            raycast={noPick}
          />
        </>
      ) : (
        <mesh
          geometry={timerVents}
          material={sharedMaterial('#454d52', { roughness: 0.8 })}
          raycast={noPick}
        />
      )}
    </group>
  );
}
