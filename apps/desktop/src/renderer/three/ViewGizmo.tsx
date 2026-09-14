import { GizmoHelper, GizmoViewcube } from '@react-three/drei';
import type { JSX } from 'react';

/**
 * 視点ギズモ（Blender のビューキューブ相当）。設計仕様 §12.2。
 *
 * 3Dの回転はマウスドラッグだけだと「いまどちらを向いているか」が分からなくなるため、
 * 画面左上に小さなキューブを常設し、面をクリックするとその方向へカメラをスナップさせる。
 * 面ラベルは日本語（前／後／左／右／上／下）にする。
 *
 * `frameloop="demand"` と組み合わせる。ギズモのスナップや OrbitControls の操作で
 * カメラが動く間のフレームは、`OrbitControls` の `onChange` と drei 側の `invalidate()` が要求する。
 * ここで一定間隔の `invalidate()` を回してはいけない（常時再描画になり `frameloop="demand"` の
 * 意味が無くなるうえ、ソフトウェアラスタライザの環境では描画がメインスレッドを占有してしまう）。
 */

/** キューブの面ラベル（日本語）。§15 の文言方針にあわせる。 */
export const GIZMO_FACES = {
  right: '右',
  left: '左',
  top: '上',
  bottom: '下',
  front: '前',
  back: '後',
} as const;

/** ギズモの1辺の大きさ[px]。 */
const GIZMO_SIZE = 92;
/** ビューポートの角からの余白[px]。盤の左上と重ならない値。 */
const GIZMO_MARGIN: [number, number] = [76, 76];

/** 左上のビューキューブ。 */
export function ViewGizmo(): JSX.Element {
  return (
    <GizmoHelper alignment="top-left" margin={GIZMO_MARGIN} renderPriority={1}>
      <GizmoViewcube
        faces={[
          GIZMO_FACES.right,
          GIZMO_FACES.left,
          GIZMO_FACES.top,
          GIZMO_FACES.bottom,
          GIZMO_FACES.front,
          GIZMO_FACES.back,
        ]}
        color="#E6E4DE"
        textColor="#1B1E23"
        strokeColor="#39D0FF"
        hoverColor="#39D0FF"
        opacity={0.95}
        {...({ scale: [GIZMO_SIZE, GIZMO_SIZE, GIZMO_SIZE] } as Record<string, unknown>)}
      />
    </GizmoHelper>
  );
}
