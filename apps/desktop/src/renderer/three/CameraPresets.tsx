import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, type JSX } from 'react';
import type { CameraPreset } from '../app/store-types.js';
import { cameraPose, interpolatePose, type CameraPose } from './camera.js';

/**
 * 視点プリセットの適用。設計仕様 §12.2。
 * 位置・注視点・上方向の計算は `camera.ts`（純粋関数）に置き、ここは three への反映だけを行う。
 * 盤は傾斜コンソールなので、面直視（正面・ソケット拡大）ではカメラの上方向も盤面に合わせて
 * 変える（既定の `(0,1,0)` のままだと視線とほぼ平行になり画が回ってしまう）。
 *
 * プリセットの切り替えは瞬間移動させず、`interpolatePose()`（`camera.ts`）で ~300ms の
 * ease-out 補間を掛ける（§12.2「視点プリセットとギズモのスナップは同じ短い補間で遷移」。
 * ギズモ（`ViewGizmo`）のクリックは drei の `GizmoHelper` が内部で角速度一定の短い補間を
 * 自前で行うので実装は共有できないが、遷移時間を揃えることで体感を合わせる）。
 *
 * `frameloop="demand"` の下で動かすため、補間中は `useFrame` の中で毎フレーム `invalidate()`
 * を呼んで次のフレームを要求し、`t = 1` に達したら呼ぶのをやめてループを自己終結させる
 * （`OrbitControls` の慣性や drei `GizmoHelper` の `tweenCamera` と同じ考え方）。
 * マウント直後（および `OrbitControls` 接続前）は補間せず即座に反映する。
 */

/** プリセット遷移の所要時間[ms]。ギズモのスナップと体感を揃える短い値。§12.2 */
const TRANSITION_MS = 300;

/** `OrbitControls` のうちこの層が使う部分。 */
export interface ControlsLike {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

/** 進行中の視点補間。 */
interface PoseAnimation {
  from: CameraPose;
  to: CameraPose;
  startMs: number;
}

/** プリセットが変わったらカメラと OrbitControls の注視点を ~300ms で補間して動かす。 */
export function CameraPresets({
  preset,
  controls,
}: {
  preset: CameraPreset;
  controls: ControlsLike | null;
}): JSX.Element | null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  // 直近に反映した視点（次の遷移の `from`）。マウント直後は null。
  const currentPose = useRef<CameraPose | null>(null);
  const animation = useRef<PoseAnimation | null>(null);

  /**
   * カメラと OrbitControls に1つの視点を反映する。
   * `useCallback` で包むのは、下の `useEffect` の依存に素直に並べられるようにするため
   * （`camera` / `controls` が変わったときだけ作り直され、挙動は変わらない）。
   */
  const applyPose = useCallback(
    (pose: CameraPose): void => {
      camera.up.set(...pose.up);
      camera.position.set(...pose.position);
      camera.lookAt(...pose.target);
      if (controls !== null) {
        controls.target.set(...pose.target);
        controls.update();
      }
      camera.updateProjectionMatrix();
      currentPose.current = pose;
    },
    [camera, controls],
  );

  useEffect(() => {
    const to = cameraPose(preset);
    if (currentPose.current === null) {
      // マウント直後・OrbitControls 接続前は補間せず即座に合わせる
      // （Canvas の初期カメラ位置から意図しない“飛行”をしないため）。
      animation.current = null;
      applyPose(to);
    } else {
      animation.current = { from: currentPose.current, to, startMs: performance.now() };
    }
    invalidate();
  }, [preset, applyPose, invalidate]);

  useFrame(() => {
    const anim = animation.current;
    if (anim === null) return;
    const t = Math.min(1, (performance.now() - anim.startMs) / TRANSITION_MS);
    applyPose(interpolatePose(anim.from, anim.to, t));
    if (t < 1) {
      invalidate();
    } else {
      animation.current = null;
    }
  });

  return null;
}
