import type { WireRoute } from '@ojt/board-model';
import { useMemo, type JSX } from 'react';
import { CylinderGeometry, Quaternion, Vector3 } from 'three';
import { toScene } from './coords.js';
import { bakeSharedTexture, labelFont, makeCanvasTexture } from './labels.js';
import { noPick } from './materials.js';

export const MARKER_LENGTH_MM = 6;
export const MARKER_RADIUS_MM = 1.25;
const SLEEVE = new CylinderGeometry(MARKER_RADIUS_MM, MARKER_RADIUS_MM, MARKER_LENGTH_MM, 12);
// 側面印字の中心を盤の正面へ向ける（UVの1/4・3/4周の位置）。
SLEEVE.rotateY(Math.PI / 2);
const AXIS = new Vector3(0, 1, 0);

/** 端子から最初の直線部へ置く。曲がり角や端子ネジへはかぶせない。 */
export function wireMarkerPoses(
  route: WireRoute,
): { position: Vector3; quaternion: Quaternion; length: number }[] {
  const allPoints = route.points.map((p) => new Vector3(...toScene(p)));
  const halfLength =
    allPoints.reduce(
      (sum, point, i) => sum + (i === 0 ? 0 : point.distanceTo(allPoints[i - 1]!)),
      0,
    ) / 2;
  const gap = 0.2;
  return [false, true].flatMap((reverse) => {
    const points = reverse ? [...allPoints].reverse() : allPoints;
    // 正面で読める横向きを優先。短い渡り線では縦の立ち上がりも利用する。
    for (const [minimumLength, horizontalOnly] of [
      [MARKER_LENGTH_MM, true],
      [MARKER_LENGTH_MM, false],
      [2.5, true],
      [2.5, false],
    ] as const) {
      let walked = 0;
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1]!,
          b = points[i]!;
        const length = a.distanceTo(b);
        // 各端の半分に収め、同じ短い直線へ2個を重ねない。
        const available = Math.min(length, halfLength - walked);
        if (
          (!horizontalOnly || Math.abs(a.z - b.z) < 0.01) &&
          available + 1e-8 >= minimumLength + gap * 2
        ) {
          const direction = b.clone().sub(a).normalize();
          const sleeveLength = Math.min(MARKER_LENGTH_MM, available - gap * 2);
          const position = a.clone().addScaledVector(direction, sleeveLength / 2 + gap);
          const dominant =
            Math.abs(direction.x) > Math.abs(direction.y) ? direction.x : direction.y;
          if (dominant < 0 || (Math.abs(dominant) < 0.01 && direction.z < 0)) direction.negate();
          return [
            {
              position,
              quaternion: new Quaternion().setFromUnitVectors(AXIS, direction),
              length: sleeveLength,
            },
          ];
        }
        walked += length;
        if (walked >= halfLength) break;
      }
    }
    return [];
  });
}

/** 線の周囲を包む白いチューブ。番号を表裏に刷り、正面の印字が重ならないようにする。 */
export function WireMarkers({ route, number }: { route: WireRoute; number: string }): JSX.Element {
  const poses = useMemo(() => wireMarkerPoses(route), [route]);
  const texture = useMemo(
    () =>
      bakeSharedTexture('wire-marker', number, () =>
        makeCanvasTexture(
          MARKER_RADIUS_MM * Math.PI * 2,
          MARKER_LENGTH_MM,
          (ctx, width, height) => {
            ctx.fillStyle = '#fffdf0';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#101820';
            ctx.font = labelFont(Math.min(3.2, 8 / Math.max(2, number.length)));
            for (let face = 0; face < 2; face += 1) {
              ctx.save();
              ctx.translate((width * (face + 0.5)) / 2, height / 2);
              ctx.rotate(-Math.PI / 2);
              ctx.fillText(number, 0, 0, height * 0.84);
              ctx.restore();
            }
          },
        ),
      ),
    [number],
  );
  return (
    <group name={`wire-markers-${route.wireId}`} userData={{ wireNumber: number }}>
      {poses.map((pose, index) => (
        <mesh
          key={index}
          name={`wire-marker-${route.wireId}-${index}`}
          geometry={SLEEVE}
          position={pose.position}
          quaternion={pose.quaternion}
          scale={[1, pose.length / MARKER_LENGTH_MM, 1]}
          raycast={noPick}
        >
          <meshBasicMaterial color="#fffdf0" {...(texture === undefined ? {} : { map: texture })} />
        </mesh>
      ))}
    </group>
  );
}
