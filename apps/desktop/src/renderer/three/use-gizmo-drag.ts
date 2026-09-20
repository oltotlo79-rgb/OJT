import { useCallback, useEffect, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import {
  clamp,
  GIZMO_DRAG_THRESHOLD_PX,
  gizmoDragToSpherical,
  type OrbitControlsLike,
} from './navigation.js';
import { targetIdOf } from './view-gizmo-paint.js';

/**
 * ビューキューブの**ドラッグの状態機械**。設計仕様 §12.2 / 2026-09-19 の利用者要望。
 *
 * 2026-09-20 の指摘 3D-16（`ViewGizmo.tsx` が1,080行）で `ViewGizmo.tsx` から割り出した。
 * 「押す → 引く → 放す」の間に起きること（慣性の退避と復帰・盤側の操作の停止・ポインタの捕捉・
 * しきい値・クリックとの切り分け）が1箇所にまとまるので、回帰テストから素直に駆動できる。
 *
 * 押した時点の角度を覚えておき、**そこからの絶対値**で `setAzimuthalAngle()` /
 * `setPolarAngle()` を呼ぶ（1回ごとの差分を足し込まない）。ドラッグ中は `dampingFactor` を
 * 1 にしてあるので `update()` 1回で目標へ届く（指に 1:1 で付いてくる）。
 */

/** 進行中のキューブのドラッグ。 */
interface GizmoDrag {
  pointerId: number;
  /** 押した位置（ページ座標）。 */
  x: number;
  y: number;
  /** 押した時点のカメラの方位角・極角[rad]。ドラッグ量はここからの絶対値で足す。 */
  azimuth: number;
  polar: number;
  /** 押した時点の慣性の強さ（放したら戻す）。 */
  dampingFactor: number;
  /** 押した先の当たり判定（クリックで放したときのスナップ先）。 */
  targetId: string | null;
  /** しきい値を超えて動いたか（超えていたら放してもスナップしない）。 */
  moved: boolean;
  /** ポインタを掴んだ要素（放すときに解放する）。 */
  capture: Element | null;
}

/** `useGizmoDrag()` に渡す配線。 */
export interface GizmoDragWiring {
  /** 盤の `OrbitControls`（まだ繋がっていなければ `null`）。 */
  controls: OrbitControlsLike | null;
  /** 次のフレームを要求する（`frameloop="demand"`）。 */
  invalidate: () => void;
  /** ポインタの形を変える。 */
  setCursor: (value: string) => void;
  /** ドラッグを終えたときに戻すカーソル（ホバー中なら `grab`、外なら空）。 */
  idleCursor: () => string;
  /** しきい値未満で放した＝クリック。押した先の当たり判定の名前を渡す。 */
  onTap: (id: string) => void;
  /** 掴んだ瞬間（進行中のスナップを打ち切る）。 */
  onGrab: () => void;
}

/** `useGizmoDrag()` が返すもの。 */
export interface GizmoDragHandle {
  /** キューブの `onPointerDown`（面・辺・角のどこで押しても同じ）。 */
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  /** いまドラッグ中か（ホバー表示を止めるのに使う）。 */
  isDragging: () => boolean;
}

export function useGizmoDrag({
  controls,
  invalidate,
  setCursor,
  idleCursor,
  onTap,
  onGrab,
}: GizmoDragWiring): GizmoDragHandle {
  const drag = useRef<GizmoDrag | null>(null);

  /**
   * ドラッグの追従はウィンドウ全体で受ける。キューブは小さいので、少し引いただけで
   * ポインタがキューブの外へ出てしまい、3Dの `onPointerMove` では続きを追えない。
   */
  useEffect(() => {
    if (controls === null) return undefined;
    /** ドラッグを終う（放した・取り消された・効果が外れた）。 */
    const finish = (current: GizmoDrag): void => {
      drag.current = null;
      // 慣性と盤側の操作を元に戻す
      controls.dampingFactor = current.dampingFactor;
      controls.enabled = true;
      setCursor(idleCursor());
      if (current.capture !== null) {
        try {
          current.capture.releasePointerCapture(current.pointerId);
        } catch {
          // すでに解放されている（放したあとに来た `pointercancel` など）
        }
      }
    };
    const onMove = (event: PointerEvent): void => {
      const current = drag.current;
      if (current === null || event.pointerId !== current.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.moved && Math.hypot(dx, dy) < GIZMO_DRAG_THRESHOLD_PX) return;
      current.moved = true;
      const delta = gizmoDragToSpherical(dx, dy);
      /*
       * 押した時点の角度からの**絶対値**で指定する（1回ごとの差分を足し込まない）。
       * `setAzimuthalAngle()` は目標との差を `OrbitControls` の内部の回転量に入れて `update()` を
       * 呼ぶ。ドラッグ中は `dampingFactor` を 1 にしてあるので、その1回で目標へ届く（1:1）。
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
      finish(current);
      /*
       * 動かさずに放した＝クリック。押した先の視点へ動かす（ストアへ書くのはここ1回だけ。
       * ポインタを動かしているあいだは1度も書かない＝再描画も起きない。§15）。
       */
      if (!current.moved && current.targetId !== null) onTap(current.targetId);
      invalidate();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      // ドラッグの途中で消えても慣性と盤の操作を止めたままにしない
      if (drag.current !== null) finish(drag.current);
    };
  }, [controls, idleCursor, invalidate, onTap, setCursor]);

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>): void => {
      /*
       * 3D-15: **2本目のポインタは無視する**。タッチやペンで2本目を置くと、その時点の
       * `dampingFactor`（1本目のドラッグ中なので **1**）を「元の値」として覚えてしまい、
       * 放したあと盤の慣性が 1 のまま（＝慣性が永久に失われる）になっていた。
       */
      if (drag.current !== null) return;
      if (controls === null || event.nativeEvent.button !== 0) return;
      // キューブの後ろにある盤の端子を拾わせない（回そうとして配線が始まってしまう）
      event.stopPropagation();
      const native = event.nativeEvent;
      // 掴んだらそのポインタを最後まで受け取る（キューブの外へ出ても追える）
      const element = native.target instanceof Element ? native.target : null;
      let capture: Element | null = null;
      if (element !== null && typeof element.setPointerCapture === 'function') {
        try {
          element.setPointerCapture(native.pointerId);
          capture = element;
        } catch {
          // 捕捉できない環境ではウィンドウの `pointermove` だけで追う
        }
      }
      // 途中のスナップは掴んだ時点で打ち切る（指の動きが最優先）
      onGrab();
      drag.current = {
        pointerId: native.pointerId,
        x: native.clientX,
        y: native.clientY,
        azimuth: controls.getAzimuthalAngle(),
        polar: controls.getPolarAngle(),
        dampingFactor: controls.dampingFactor,
        targetId: targetIdOf(event),
        moved: false,
        capture,
      };
      /*
       * 盤の `OrbitControls` を止める。同じ `pointerdown` は canvas の上で drei の
       * `OrbitControls` にも届くので、止めないとキューブのドラッグと盤の左ドラッグ回転が
       * 二重に掛かる（`enabled` を落とすと `OrbitControls` は `pointermove` を無視する）。
       * あわせて慣性を切る（`dampingFactor = 1`）。ここが 0.1 のままだと `update()` 1回で
       * 目標の1割しか詰まらず、指に対して常に遅れて付いてくる（2026-09-19 の利用者要望）。
       */
      controls.enabled = false;
      controls.dampingFactor = 1;
      setCursor('grabbing');
      invalidate();
    },
    [controls, invalidate, onGrab, setCursor],
  );

  const isDragging = useCallback((): boolean => drag.current !== null, []);

  return { onPointerDown, isDragging };
}
