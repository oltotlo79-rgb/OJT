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
 * ビューポートの上端からキューブの上端までに空ける余白[px]。
 * 状態オーバーレイは右上へ移したので（`screens.module.css` の `.statusOverlay`）、
 * 左上はキューブの場所として空いている。盤の上端の名札と重ならない高さに置く。
 */
export const GIZMO_TOP_MARGIN_PX = 20;

/**
 * ビューポートの角からの**キューブ中心**の余白[px]。
 * `margin` は中心の位置なので、キューブの上端は `margin[1] - GIZMO_SIZE / 2`。
 */
export const GIZMO_MARGIN: [number, number] = [72, 72];

/**
 * キューブの色。暗い背景（`#141820`）の上で輪郭と面が読めること、かつ
 * **正面視で明るい盤（`#E6E4DE`）に重なっても面と文字が読める**ことの両方を満たす必要がある。
 * 以前は面が明るい灰（`#D8DDE6`）で盤の色とほとんど同じになり、`上` も側面も沈んで見えなかった
 * （レビュー指摘）。面を中間の青灰に落とし、文字は白、稜線は濃紺にして対比を作る。
 */
export const GIZMO_COLORS = {
  face: '#4A5563',
  text: '#FFFFFF',
  stroke: '#141820',
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
