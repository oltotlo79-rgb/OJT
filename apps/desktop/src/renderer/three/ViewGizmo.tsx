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
export const GIZMO_SIZE = 92;

/**
 * 左上の状態オーバーレイ（`screens.module.css` の `.statusOverlay`）が占める帯の下端[px]。
 * `top: 12px` ＋ 高さ約22px ＋ 余白。
 */
export const STATUS_OVERLAY_BOTTOM_PX = 44;

/**
 * ビューポートの角からの**キューブ中心**の余白[px]。
 * `margin` は中心の位置なので、キューブの上端は `margin[1] - GIZMO_SIZE / 2`。
 * 状態オーバーレイと固定機器の名札の帯より下に降ろし、正面視点でも文字と重ならないようにする。
 */
export const GIZMO_MARGIN: [number, number] = [72, 104];

/**
 * キューブの色。暗い背景（`#141820`）の上で輪郭と面が読めるよう、
 * 面は明るい灰、稜線は水色、ホバーは面とも稜線とも違う琥珀色にする
 * （以前は稜線とホバーが同色で、どの面を指しているのか分からなかった）。
 */
export const GIZMO_COLORS = {
  face: '#D8DDE6',
  text: '#141820',
  stroke: '#39D0FF',
  hover: '#FFB400',
} as const;

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
        color={GIZMO_COLORS.face}
        textColor={GIZMO_COLORS.text}
        strokeColor={GIZMO_COLORS.stroke}
        hoverColor={GIZMO_COLORS.hover}
        opacity={1}
        {...({ scale: [GIZMO_SIZE, GIZMO_SIZE, GIZMO_SIZE] } as Record<string, unknown>)}
      />
    </GizmoHelper>
  );
}
