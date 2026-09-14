import { GizmoHelper, GizmoViewcube } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useRef, type JSX } from 'react';
import { useStore } from '../app/store.js';
import {
  clamp,
  GIZMO_DRAG_THRESHOLD_PX,
  gizmoDragToSpherical,
  presetForDirection,
  type OrbitControlsLike,
} from './navigation.js';

/**
 * 視点ギズモ（Blender のビューキューブ）。設計仕様 §12.2。
 *
 * 3Dの回転はマウスドラッグだけだと「いまどちらを向いているか」が分からなくなるため、
 * 画面左上に小さなキューブを常設する。面ラベルは日本語（前／後／左／右／上／下）。
 *
 * 操作は Blender と同じ2通り（2026-09-14 の利用者要望「キューブをドラッグすることで画面を回せるように」）。
 * - **ドラッグ**: キューブを掴んで引くと、その量だけ**本体のカメラ**が注視点のまわりを回る
 *   （1000px で1回転 ≒ 0.36°/px）。キューブはカメラの向きを映しているので指に付いてくる。
 * - **クリック**（`GIZMO_DRAG_THRESHOLD_PX` 未満で放す）: 面・辺・角に対応する視点へスナップする。
 *   スナップ先はストアの視点プリセットなので、ツールバーのボタン・テンキーと同じ場所に着く。
 *
 * `frameloop="demand"` と組み合わせる。ドラッグ中は動かすたびに `invalidate()` し、
 * 放したあとの慣性（ダンピング）は drei の `OrbitControls` が `change` のたびに
 * `invalidate()` するので自然に減衰して止まる。ここで一定間隔の `invalidate()` を
 * 回してはいけない（常時再描画になり `frameloop="demand"` の意味が無くなる）。
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

/** キューブの1辺の大きさ[px]。 */
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

/** 進行中のキューブのドラッグ。 */
interface GizmoDrag {
  pointerId: number;
  /** 押した位置（ページ座標）。 */
  x: number;
  y: number;
  /** 押した時点のカメラの方位角・極角[rad]。ドラッグ量はここからの絶対値で足す。 */
  azimuth: number;
  polar: number;
  /** しきい値を超えて動いたか（超えていたら放してもスナップしない）。 */
  moved: boolean;
}

/**
 * クリックされた面・辺・角が指す向き。
 * 面は当たった面の法線、辺と角は小さな当たり判定キューブの位置（中心からの向き）。
 * キューブはカメラの逆回転で置かれているので、この局所ベクトルはそのままワールドの向きになる。
 */
function clickedDirection(event: ThreeEvent<MouseEvent>): [number, number, number] | undefined {
  const { position } = event.eventObject;
  if (position.lengthSq() > 0) return [position.x, position.y, position.z];
  const normal = event.face?.normal;
  return normal === undefined || normal === null ? undefined : [normal.x, normal.y, normal.z];
}

/** 左上のビューキューブ。 */
export function ViewGizmo({ controls }: { controls: OrbitControlsLike | null }): JSX.Element {
  const invalidate = useThree((state) => state.invalidate);
  const drag = useRef<GizmoDrag | null>(null);
  /**
   * 直前のポインタ操作がドラッグだったか。`drag` は放した時点で消えるが、クリックは
   * そのあとに届くので、スナップしてよいかどうかはこちらに残しておく。
   */
  const dragged = useRef(false);

  /**
   * ドラッグの追従はウィンドウ全体で受ける。キューブは小さいので、少し引いただけで
   * ポインタがキューブの外へ出てしまい、3Dの `onPointerMove` では続きを追えない。
   */
  useEffect(() => {
    if (controls === null) return undefined;
    const onMove = (event: PointerEvent): void => {
      const current = drag.current;
      if (current === null || event.pointerId !== current.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.moved && Math.hypot(dx, dy) < GIZMO_DRAG_THRESHOLD_PX) return;
      current.moved = true;
      dragged.current = true;
      const delta = gizmoDragToSpherical(dx, dy);
      /*
       * 押した時点の角度からの**絶対値**で指定する（1回ごとの差分を足し込まない）。
       * `setAzimuthalAngle()` は目標との差を `OrbitControls` の内部の回転量に入れて `update()` を
       * 呼ぶので、ダンピングが効いたまま目標へ寄っていき、放したあとも残りが減衰して止まる。
       */
      controls.setAzimuthalAngle(current.azimuth + delta.azimuth);
      controls.setPolarAngle(
        clamp(current.polar + delta.polar, controls.minPolarAngle, controls.maxPolarAngle),
      );
      invalidate();
    };
    const onUp = (event: PointerEvent): void => {
      const current = drag.current;
      if (current === null || event.pointerId !== current.pointerId) return;
      drag.current = null;
      // 盤側の操作を戻す。残った慣性は drei の毎フレームの `update()` が減衰させ切る
      controls.enabled = true;
      invalidate();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      // ドラッグの途中で消えても盤の操作を止めたままにしない
      if (drag.current !== null) {
        drag.current = null;
        controls.enabled = true;
      }
    };
  }, [controls, invalidate]);

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>): void => {
      if (controls === null || event.nativeEvent.button !== 0) return;
      // キューブの後ろにある盤の端子を拾わせない（回そうとして配線が始まってしまう）
      event.stopPropagation();
      const native = event.nativeEvent;
      drag.current = {
        pointerId: native.pointerId,
        x: native.clientX,
        y: native.clientY,
        azimuth: controls.getAzimuthalAngle(),
        polar: controls.getPolarAngle(),
        moved: false,
      };
      /*
       * 盤の `OrbitControls` を止める。同じ `pointerdown` は canvas の上で drei の
       * `OrbitControls` にも届くので、止めないとキューブのドラッグと盤の左ドラッグ回転が
       * 二重に掛かる（`enabled` を落とすと `OrbitControls` は `pointermove` を無視する）。
       */
      controls.enabled = false;
      invalidate();
    },
    [controls, invalidate],
  );

  const onClick = useCallback((event: ThreeEvent<MouseEvent>): null => {
    // 面・辺・角のクリックは必ずここで止める（後ろの端子まで届かせない）
    event.stopPropagation();
    // ドラッグの終わりに来たクリックはスナップしない（R3F の onClick には移動量のしきい値が無い）
    if (drag.current?.moved === true) return null;
    const direction = clickedDirection(event);
    if (direction !== undefined) useStore.getState().setCamera(presetForDirection(direction));
    return null;
  }, []);

  return (
    <GizmoHelper alignment="top-left" margin={GIZMO_MARGIN} renderPriority={1}>
      <group onPointerDown={onPointerDown}>
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
          onClick={onClick}
          {...({ scale: [GIZMO_SIZE, GIZMO_SIZE, GIZMO_SIZE] } as Record<string, unknown>)}
        />
      </group>
    </GizmoHelper>
  );
}
