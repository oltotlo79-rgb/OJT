import { GizmoHelper } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { useStore } from '../app/store.js';
import {
  interpolatePose,
  poseForDirection,
  VIEW_TRANSITION_MS,
  type CameraPose,
} from './camera.js';
import {
  clamp,
  GIZMO_DRAG_THRESHOLD_PX,
  GIZMO_FACE_ORDER,
  GIZMO_HIT_BOXES,
  gizmoDragToSpherical,
  gizmoTargetById,
  gizmoTargetForDirection,
  type OrbitControlsLike,
} from './navigation.js';

/**
 * 視点ギズモ（Blender のビューキューブ）。設計仕様 §12.2。
 *
 * 3Dの回転はマウスドラッグだけだと「いまどちらを向いているか」が分からなくなるため、
 * 画面左上にキューブを常設する。面ラベルは日本語（正面／背面／左／右／上／下）。
 *
 * 2026-09-19 の利用者要望「3Dの視点の角度を変えるの少し動かしづらい。blender のように
 * キューブを選択しサクサク動くようにしたい」に対して、以下の3点を直した。
 *
 * 1. **ドラッグが 1:1 で効く**。以前は `OrbitControls` の慣性（`dampingFactor` 0.1）が
 *    掛かったまま `setAzimuthalAngle()` を呼んでいたため、`update()` 1回で目標の**1割**しか
 *    詰まらなかった。`frameloop="demand"` では1回の `pointermove` につき1フレームしか描かないので、
 *    指の動きに対して常に9割ぶん遅れて付いてくる（＝「動かしづらい」）。ドラッグ中だけ
 *    `dampingFactor` を 1 に差し替え、放したら元へ戻す。
 * 2. **キューブが大きく、辺と角も押せる**。drei の `GizmoViewcube` は `scale` を無視して
 *    60px 固定で描く（`scale` を渡しても内側の `group` には届かない）ので、以前の
 *    `GIZMO_SIZE = 92` は効いていなかった。自前で描いて 96px にし、26箇所（面6・辺12・角8）
 *    それぞれに当たり判定を持たせる。
 * 3. **面のテクスチャを焼き直さない**。drei の `FaceMaterial` は `faces` 配列の同一性で
 *    `useMemo` するので、親が再描画されるたびに 128×128 のキャンバスを6枚焼き直していた
 *    （GPUのテクスチャも捨てられず溜まる）。ここでは一度だけ作って `unmount` で解放する。
 *
 * 操作は Blender と同じ2通り。
 * - **ドラッグ**: キューブを掴んで引くと、その量だけ本体のカメラが注視点のまわりを回る
 *   （1000px で1回転 ≒ 0.36°/px）。慣性なしで 1:1。
 * - **クリック**（`GIZMO_DRAG_THRESHOLD_PX` 未満で放す）: 面・辺・角に対応する視点へ動く。
 *   面はストアの視点プリセット（ツールバー・テンキーと同じ場所）、辺と角は45°の斜め視点。
 *
 * `frameloop="demand"` と組み合わせる。ドラッグ中は動かすたびに `invalidate()` し、
 * 辺・角のスナップは `useFrame` の中で補間しながら次のフレームを要求して自己終結する。
 * ここで一定間隔の `invalidate()` を回してはいけない（常時再描画になる）。
 */

/** キューブの面ラベル（日本語）。§15 の文言方針にあわせる。 */
export const GIZMO_FACES = {
  right: '右',
  left: '左',
  top: '上',
  bottom: '下',
  front: '正面',
  back: '背面',
} as const;

/**
 * キューブの1辺の大きさ[px]。§12.2 / 2026-09-19 の利用者要望
 *
 * `GizmoHelper` は HUD 用の正射影カメラを画面と同じ寸法で作る（`margin` がそのまま px で
 * 効くのと同じ空間）ので、**この値はそのまま CSS ピクセル**になる。実際の描画解像度は
 * `Canvas` の `dpr` が面倒を見るため、高DPI環境でも見た目の大きさは変わらない。
 */
export const GIZMO_SIZE = 96;

/**
 * ビューポートの上端からキューブの上端までに空ける余白[px]。
 * 状態オーバーレイは右上へ移したので（`screens.module.css` の `.statusOverlay`）、
 * 左上はキューブの場所として空いている。盤の上端の名札と重ならない高さに置く。
 */
export const GIZMO_TOP_MARGIN_PX = 20;

/**
 * ビューポートの角からの**キューブ中心**の余白[px]。
 * `margin` は中心の位置なので、キューブの上端は `margin[1] - GIZMO_SIZE / 2`。
 *
 * キューブは回るので、いちばん遠い角までの距離は `GIZMO_SIZE × √3 / 2 ≒ 83px`。
 * どの向きでも画面の外へはみ出さないよう、余白はそれより大きく取る。
 */
export const GIZMO_MARGIN: [number, number] = [100, 100];

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

/** 面のメッシュの名前（当たり判定の箱と区別する）。 */
export const GIZMO_FACE_MESH_NAME = 'view-cube-faces';

/** 辺・角の当たり判定のメッシュ名の接頭辞。 */
export const GIZMO_HIT_PREFIX = 'view-cube-hit-';

/** ホバーしていない面の色（テクスチャをそのまま出す）。 */
const NO_TINT = '#FFFFFF';

/** 面に焼くキャンバスの1辺[px]（高DPIでも文字がぼけない程度）。 */
const FACE_TEXTURE_PX = 256;

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

/** 進行中の辺・角へのスナップ（面はストアのプリセットに任せる）。 */
interface SnapAnimation {
  from: CameraPose;
  to: CameraPose;
  startMs: number;
}

/** 面に名札を焼いたテクスチャを作る。 */
function createFaceTexture(label: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_TEXTURE_PX;
  canvas.height = FACE_TEXTURE_PX;
  try {
    const context = canvas.getContext('2d');
    if (context !== null) {
      context.fillStyle = GIZMO_COLORS.face;
      context.fillRect(0, 0, FACE_TEXTURE_PX, FACE_TEXTURE_PX);
      context.lineWidth = FACE_TEXTURE_PX / 24;
      context.strokeStyle = GIZMO_COLORS.stroke;
      context.strokeRect(0, 0, FACE_TEXTURE_PX, FACE_TEXTURE_PX);
      context.font = `bold ${Math.round(FACE_TEXTURE_PX * (label.length > 1 ? 0.26 : 0.4))}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = GIZMO_COLORS.text;
      context.fillText(label, FACE_TEXTURE_PX / 2, FACE_TEXTURE_PX / 2);
    }
  } catch {
    // テスト環境（happy-dom）には 2D コンテキストが無い。名札が無いだけで形は出る
  }
  return new CanvasTexture(canvas);
}

/**
 * ホバー中の当たり判定だけを光らせる（React の再描画を起こさず直接触る）。§15
 *
 * 辺・角の箱は**マテリアルの** `visible` で出し入れする。メッシュ自体を隠すと
 * three の当たり判定の対象から外れかねないが、マテリアルなら見た目だけが消える
 * （drei の `GizmoViewcube` も同じ手を使っている）。
 */
export function applyGizmoHover(group: Group | null, id: string | null): void {
  if (group === null) return;
  for (const child of group.children) {
    const mesh = child as Mesh;
    if (mesh.name.startsWith(GIZMO_HIT_PREFIX)) {
      const material = mesh.material as MeshBasicMaterial | undefined;
      if (material !== undefined) material.visible = mesh.name === `${GIZMO_HIT_PREFIX}${id ?? ''}`;
      continue;
    }
    if (mesh.name !== GIZMO_FACE_MESH_NAME) continue;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material, index) => {
      const face = GIZMO_FACE_ORDER[index];
      (material as MeshBasicMaterial).color.set(
        face !== undefined && face === id ? GIZMO_COLORS.hover : NO_TINT,
      );
    });
  }
}

/**
 * 押した（あるいは指した）先の当たり判定の名前。
 * 辺・角は専用のメッシュ名から、面は当たった三角形の法線から引く
 * （キューブはカメラの逆回転で置かれているので、局所の法線はそのままワールドの向きになる）。
 */
function targetIdOf(event: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>): string | null {
  const name = event.object.name;
  if (name.startsWith(GIZMO_HIT_PREFIX)) return name.slice(GIZMO_HIT_PREFIX.length);
  const normal = event.face?.normal;
  if (normal === undefined || normal === null) return null;
  return gizmoTargetForDirection([normal.x, normal.y, normal.z]).id;
}

/** 左上のビューキューブ。 */
export function ViewGizmo({ controls }: { controls: OrbitControlsLike | null }): JSX.Element {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const cube = useRef<Group | null>(null);
  const drag = useRef<GizmoDrag | null>(null);
  const hovered = useRef<string | null>(null);
  const snap = useRef<SnapAnimation | null>(null);

  /**
   * 面の名札テクスチャは**一度だけ**焼く。drei の `GizmoViewcube` は `faces` 配列の同一性で
   * メモ化するため、親の再描画のたびに6枚を焼き直して捨てていた（§15 / GPUのテクスチャ漏れ）。
   */
  const faceTextures = useMemo(
    () => GIZMO_FACE_ORDER.map((face) => createFaceTexture(GIZMO_FACES[face])),
    [],
  );
  useEffect(
    () => () => {
      for (const texture of faceTextures) texture.dispose();
    },
    [faceTextures],
  );

  /** ホバー表示を差し替える（同じなら何もしない＝ポインタが動くたびの再描画を避ける）。 */
  const setHover = useCallback(
    (id: string | null): void => {
      // ドラッグ中はキューブの外を通るので、ホバーは触らない（点滅する）
      if (drag.current !== null || hovered.current === id) return;
      hovered.current = id;
      applyGizmoHover(cube.current, id);
      invalidate();
    },
    [invalidate],
  );

  /** カメラと `OrbitControls` に1つの視点を反映する（辺・角のスナップ専用）。 */
  const applyPose = useCallback(
    (pose: CameraPose): void => {
      if (controls === null) return;
      camera.up.set(...pose.up);
      camera.position.set(...pose.position);
      camera.lookAt(...pose.target);
      controls.target.set(...pose.target);
      controls.update();
      camera.updateProjectionMatrix();
    },
    [camera, controls],
  );

  /** 押した先の視点へ動かす。面はストアのプリセット、辺・角は45°の斜め視点。 */
  const snapTo = useCallback(
    (id: string): void => {
      const target = gizmoTargetById(id);
      if (target === undefined || controls === null) return;
      if (target.preset !== undefined) {
        // 面はツールバー・テンキーと同じ場所に着く（`CameraPresets` が補間する）
        useStore.getState().setCamera(target.preset);
        return;
      }
      snap.current = {
        from: {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
          up: [camera.up.x, camera.up.y, camera.up.z],
        },
        to: poseForDirection(target.direction, {
          distance: controls.getDistance(),
          target: [controls.target.x, controls.target.y, controls.target.z],
        }),
        startMs: performance.now(),
      };
      invalidate();
    },
    [camera, controls, invalidate],
  );

  /** 辺・角のスナップを `VIEW_TRANSITION_MS` で補間する（終わったら自分でループを止める）。 */
  useFrame(() => {
    const animation = snap.current;
    if (animation === null) return;
    const elapsed = performance.now() - animation.startMs;
    const t = Math.min(1, elapsed / VIEW_TRANSITION_MS);
    applyPose(interpolatePose(animation.from, animation.to, t));
    if (t < 1) invalidate();
    else snap.current = null;
  });

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
      if (!current.moved && current.targetId !== null) snapTo(current.targetId);
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
  }, [controls, invalidate, snapTo]);

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>): void => {
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
      snap.current = null;
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
      invalidate();
    },
    [controls, invalidate],
  );

  /** 面の上でポインタが動いたら、その面を光らせる。 */
  const onFacePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>): void => {
      event.stopPropagation();
      setHover(targetIdOf(event));
    },
    [setHover],
  );

  const onPointerOut = useCallback((): void => {
    setHover(null);
  }, [setHover]);

  /** クリックは必ずここで止める（後ろの端子まで届かせない。スナップは `pointerup` で済ませる）。 */
  const onClick = useCallback((event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation();
  }, []);

  return (
    <GizmoHelper alignment="top-left" margin={GIZMO_MARGIN} renderPriority={1}>
      <group
        ref={cube}
        scale={[GIZMO_SIZE, GIZMO_SIZE, GIZMO_SIZE]}
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        {/* 本体（面6つ）。面の当たり判定はこのキューブそのもの */}
        <mesh
          name={GIZMO_FACE_MESH_NAME}
          onPointerMove={onFacePointerMove}
          onPointerOut={onPointerOut}
        >
          <boxGeometry />
          {faceTextures.map((texture, index) => (
            <meshBasicMaterial
              key={GIZMO_FACE_ORDER[index] ?? index}
              attach={`material-${index}`}
              map={texture}
              color={NO_TINT}
              toneMapped={false}
            />
          ))}
        </mesh>
        {/* 辺12・角8。ふだんは見えず、指したときだけ光る（Blender と同じ） */}
        {GIZMO_HIT_BOXES.map((box) => (
          <mesh
            key={box.id}
            name={`${GIZMO_HIT_PREFIX}${box.id}`}
            position={[box.position[0], box.position[1], box.position[2]]}
            scale={1.02}
            onPointerOver={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              setHover(box.id);
            }}
            onPointerOut={onPointerOut}
          >
            <boxGeometry args={[box.size[0], box.size[1], box.size[2]]} />
            <meshBasicMaterial
              color={GIZMO_COLORS.hover}
              transparent
              opacity={0.75}
              toneMapped={false}
              visible={false}
            />
          </mesh>
        ))}
      </group>
    </GizmoHelper>
  );
}
