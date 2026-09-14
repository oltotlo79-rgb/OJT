import { useThree } from '@react-three/fiber';
import { useEffect, type JSX } from 'react';
import type { CameraPreset } from '../app/store-types.js';
import { cameraPose } from './camera.js';

/**
 * 視点プリセットの適用。設計仕様 §12.2。
 * 位置・注視点・上方向の計算は `camera.ts`（純粋関数）に置き、ここは three への反映だけを行う。
 * 盤は傾斜コンソールなので、面直視（正面・ソケット拡大）ではカメラの上方向も盤面に合わせて
 * 変える（既定の `(0,1,0)` のままだと視線とほぼ平行になり画が回ってしまう）。
 */

/** `OrbitControls` のうちこの層が使う部分。 */
export interface ControlsLike {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

/** プリセットが変わったらカメラと OrbitControls の注視点を動かす。 */
export function CameraPresets({
  preset,
  controls,
}: {
  preset: CameraPreset;
  controls: ControlsLike | null;
}): JSX.Element | null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const pose = cameraPose(preset);
    camera.up.set(...pose.up);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    if (controls !== null) {
      controls.target.set(...pose.target);
      controls.update();
    }
    camera.updateProjectionMatrix();
    invalidate();
  }, [preset, camera, controls, invalidate]);
  return null;
}
