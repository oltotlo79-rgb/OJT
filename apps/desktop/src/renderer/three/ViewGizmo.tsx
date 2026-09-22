import { useTourStore } from '../tour/tour-store.js';
import { GizmoHelper } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  CircleGeometry,
  PlaneGeometry,
  RingGeometry,
  type BufferGeometry,
  type CanvasTexture,
  type Group,
} from 'three';
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import {
  interpolatePose,
  poseForDirection,
  VIEW_TRANSITION_MS,
  type CameraPose,
} from './camera.js';
import {
  GIZMO_FACE_ORDER,
  GIZMO_HIT_BOXES,
  gizmoTargetById,
  type OrbitControlsLike,
} from './navigation.js';
import { useGizmoDrag } from './use-gizmo-drag.js';
import {
  chamferedFaceGeometry,
  GIZMO_CORNER_FACET_RADIUS,
  GIZMO_EDGE_FACET_SIZE,
  GIZMO_FACETS,
} from './view-gizmo-geometry.js';
import {
  GIZMO_BUTTON,
  GIZMO_BUTTONS,
  GIZMO_FACES,
  GIZMO_PLATE_RING_THICKNESS_RATIO,
  gizmoLayoutForViewport,
  type GizmoButtonId,
} from './view-gizmo-layout.js';
import {
  gizmoActiveFace,
  GIZMO_BILLBOARD_NAME,
  GIZMO_BUTTON_PREFIX,
  GIZMO_CHAMFER_GROUP_NAME,
  GIZMO_CHAMFER_PREFIX,
  GIZMO_COLORS,
  GIZMO_FACE_MESH_NAME,
  GIZMO_FADE_MS,
  GIZMO_HIT_PREFIX,
  GIZMO_LIGHT,
  GIZMO_PLATE_NAME,
  GIZMO_PLATE_OPACITY,
  GIZMO_TIP_PREFIX,
  noRaycast,
  NO_TINT,
  paintGizmo,
  targetIdOf,
  type GizmoHighlight,
} from './view-gizmo-paint.js';
import {
  bakeButtonTexture,
  bakeFaceTexture,
  bakeTooltipTexture,
  type GizmoTooltip,
} from './view-gizmo-textures.js';

/**
 * 視点ギズモ（Blender のビューキューブ）。設計仕様 §12.2。
 *
 * 3Dの回転はマウスドラッグだけだと「いまどちらを向いているか」が分からなくなるため、
 * 画面左上にキューブを常設する。面ラベルは日本語（正面／背面／左／右／上／下）。
 *
 * 2026-09-20 の指摘 3D-16（1,080行）で**このファイルは JSX と配線だけ**にし、中身を3枚へ割った。
 * - `view-gizmo-layout.ts`: 面の名札・キューブとボタンの寸法・HUD の置き場所（純粋）
 * - `view-gizmo-paint.ts`: 色・メッシュの名前・`paintGizmo()`（three の木を直接塗る）
 * - `use-gizmo-drag.ts`: 押す→引く→放すの状態機械（慣性の退避と復帰・しきい値・クリック）
 * 形（面取りの頂点）は従来どおり `view-gizmo-geometry.ts`、名札の焼き付けは
 * `view-gizmo-textures.ts`。既存の読み手（E2E・単体テスト）のために、割り出した名前は
 * このファイルから**そのまま再輸出**している。
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
 * さらに 2026-09-19 の追加要望「3Dのキューブのデザインがシンプルすぎる」に対して、
 * 見た目を Blender のナビゲーションギズモ＋古典的なビューキューブに寄せた。
 *
 * - **角を落としたキューブ**（`view-gizmo-geometry.ts`）。面・辺・角が形として分かれるので、
 *   「辺や角も押せる」ことが見た目から読める。
 * - **面の陰影と名札**（`view-gizmo-textures.ts`）。縦のグラデーションと内側の細いふち、
 *   実寸の2倍以上で焼いた和文の名札。HUD には光が無いので、このコンポーネントが
 *   環境光＋キーライトを1組だけ置いて立体の陰影を作る。
 * - **半透明の丸い下地**。明るい盤や白い回路図パネルに重なってもキューブが消えない。
 * - **⌂ 全体表示 / ⟳ 傾きを戻す**の2ボタン（28px・和文のツールチップ付き）。
 * - ホバーは 200ms で暖色へふわりと変わり、**いまの視点の面**には淡い青が乗る。
 *
 * 操作は Blender と同じ2通り。
 * - **ドラッグ**: キューブを掴んで引くと、その量だけ本体のカメラが注視点のまわりを回る
 *   （1000px で1回転 ≒ 0.36°/px）。慣性なしで 1:1。向きは「**カメラが指に付いてくる**」
 *   （右へ引けばカメラが右へ、下へ引けばカメラが下へ回る。2026-09-20 の所有者決定）。
 * - **クリック**（`GIZMO_DRAG_THRESHOLD_PX` 未満で放す）: 面・辺・角に対応する視点へ動く。
 *   面はストアの視点プリセット（ツールバー・テンキーと同じ場所）、辺と角は45°の斜め視点。
 *
 * `frameloop="demand"` と組み合わせる。ドラッグ中は動かすたびに `invalidate()` し、
 * 辺・角のスナップとホバーの補間は `useFrame` の中で次のフレームを要求して自己終結する。
 * ここで一定間隔の `invalidate()` を回してはいけない（常時再描画になる）。
 * 毎フレームの処理は**確保なし**（四元数と色はすべて既存の入れ物へ `copy` する）。
 *
 * 2026-09-20 の利用者指摘「3Dのキューブと赤、青、緑の骨組みがある意味は？同じようなものが
 * 2つある意味がない。重なってるし。」に対して、**座標軸の三脚（X 赤・Y 緑・Z 青の球＋棒）を
 * 撤去した**。押すと視点が変わる操作はキューブの面・辺・角にすでにあり、三脚は同じ操作の
 * 見た目だけの重複だった。
 *
 * 合わせて、モードD「分割」のような狭い3Dペインでキューブが盤に重なる問題
 * （`gizmoLayoutForViewport()`）にも対応した。HUD の大きさはキャンバス幅で決まる。
 * - 900px 以上: 既定の `GIZMO_SIZE`（96px）
 * - 600〜900px未満: `GIZMO_SIZE_NARROW`（64px）
 * - 600px未満: 隠す（`null`）。視点プリセットはツールバー・テンキーからそのまま押せるので、
 *   狭いペインではキューブという「手段」を引っ込めるだけで「視点を変える」機能は失わない。
 */

export {
  GIZMO_BUTTON,
  GIZMO_BUTTONS,
  GIZMO_FACES,
  GIZMO_GRID_PX,
  GIZMO_MARGIN,
  GIZMO_MAX_FOOTPRINT_PX,
  GIZMO_MIN_VIEWPORT_PX,
  GIZMO_PLATE_RADIUS,
  GIZMO_SIZE,
  GIZMO_SIZE_NARROW,
  GIZMO_TOP_MARGIN_PX,
  GIZMO_WIDE_VIEWPORT_PX,
  gizmoLayoutForViewport,
  type GizmoButtonId,
  type GizmoLayout,
} from './view-gizmo-layout.js';
export {
  gizmoActiveFace,
  gizmoGlow,
  GIZMO_BILLBOARD_NAME,
  GIZMO_BUTTON_PREFIX,
  GIZMO_CHAMFER_GROUP_NAME,
  GIZMO_CHAMFER_PREFIX,
  GIZMO_COLORS,
  GIZMO_FACE_MESH_NAME,
  GIZMO_FADE_MS,
  GIZMO_HIT_PREFIX,
  GIZMO_LIGHT,
  GIZMO_PLATE_NAME,
  GIZMO_PLATE_OPACITY,
  GIZMO_TIP_PREFIX,
  paintGizmo,
  type GizmoHighlight,
} from './view-gizmo-paint.js';

/**
 * ギズモの毎フレーム処理の優先度。
 *
 * drei の `GizmoHelper` は優先度 0 の `useFrame` でギズモの向きを本体カメラの逆回転に合わせ、
 * `Hud` は優先度 1 で HUD シーンを描く。**その間**で走らせると、下地・ボタンの
 * 打ち消し回転が「同じフレームのキューブの向き」に必ず追随する（1フレーム遅れない）。
 */
export const GIZMO_FRAME_PRIORITY = 0.5;

/** 進行中の辺・角へのスナップ（面はストアのプリセットに任せる）。 */
interface SnapAnimation {
  from: CameraPose;
  to: CameraPose;
  startMs: number;
}

/** 進行中のホバーの出入り（暖色へふわりと変える）。 */
interface HoverFade {
  /** 消えていく側。 */
  from: string | null;
  /** 現れる側。 */
  to: string | null;
  startMs: number;
}

/** 左上のビューキューブ。`GIZMO_MIN_VIEWPORT_PX` 未満の幅では何も描かない。 */
export function ViewGizmo({ controls }: { controls: OrbitControlsLike | null }): JSX.Element {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  // `Canvas`（3Dペイン）の CSS ピクセル寸法。モードD「分割」やモードB「並べて」のように
  // 幅・高さが限られる場面で、キューブが盤の絵やペインの外へはみ出さないよう大きさ・余白を
  // ここから決める（2026-09-20 の利用者指摘 / 監査指摘 B4）。
  const viewportSize = useThree((state) => state.size);
  const layout = useMemo(
    () => gizmoLayoutForViewport(viewportSize.width, viewportSize.height),
    [viewportSize.width, viewportSize.height],
  );
  const preset = useStore((state) => state.camera);
  const cube = useRef<Group | null>(null);
  const billboard = useRef<Group | null>(null);
  const hovered = useRef<string | null>(null);
  const fade = useRef<HoverFade | null>(null);
  const snap = useRef<SnapAnimation | null>(null);

  /**
   * 面の名札・ボタン・ツールチップのテクスチャは**一度だけ**焼く。drei の
   * `GizmoViewcube` は `faces` 配列の同一性でメモ化するため、親の再描画のたびに6枚を焼き直して
   * 捨てていた（§15 / GPUのテクスチャ漏れ）。
   */
  const art = useMemo(() => {
    const faces = GIZMO_FACE_ORDER.map((face) =>
      bakeFaceTexture({
        label: GIZMO_FACES[face],
        base: GIZMO_COLORS.face,
        highlight: GIZMO_COLORS.faceTop,
        rim: GIZMO_COLORS.rim,
        text: GIZMO_COLORS.text,
      }),
    );
    const buttons: Record<GizmoButtonId, CanvasTexture> = {
      home: bakeButtonTexture({
        icon: 'home',
        base: GIZMO_COLORS.button,
        rim: GIZMO_COLORS.plateBorder,
        ink: GIZMO_COLORS.buttonInk,
      }),
      reset: bakeButtonTexture({
        icon: 'reset',
        base: GIZMO_COLORS.button,
        rim: GIZMO_COLORS.plateBorder,
        ink: GIZMO_COLORS.buttonInk,
      }),
    };
    const tips: Record<GizmoButtonId, GizmoTooltip> = {
      home: bakeTooltipTexture(JA.session.viewCubeHome, GIZMO_COLORS.buttonInk, GIZMO_COLORS.plate),
      reset: bakeTooltipTexture(
        JA.session.viewCubeReset,
        GIZMO_COLORS.buttonInk,
        GIZMO_COLORS.plate,
      ),
    };
    return { faces, buttons, tips };
  }, []);

  /**
   * 形は使い回す（辺12枚・角8枚は同じジオメトリを共有する）。下地の丸・ふちは半径1で作り、
   * `layout.plateRadius` ぶん `scale` を掛けて出す（`gizmoLayoutForViewport()` でキューブの
   * 大きさが変わっても、ジオメトリを焼き直さずに済む）。
   */
  const shapes = useMemo(
    () => ({
      faces: chamferedFaceGeometry(),
      edge: new PlaneGeometry(GIZMO_EDGE_FACET_SIZE[0], GIZMO_EDGE_FACET_SIZE[1]),
      corner: new CircleGeometry(GIZMO_CORNER_FACET_RADIUS, 3),
      plate: new CircleGeometry(1, 72),
      plateRing: new RingGeometry(1 - GIZMO_PLATE_RING_THICKNESS_RATIO, 1, 72),
      quad: new PlaneGeometry(1, 1),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const texture of art.faces) texture.dispose();
      for (const texture of Object.values(art.buttons)) texture.dispose();
      for (const tip of Object.values(art.tips)) tip.texture.dispose();
      for (const shape of Object.values(shapes) as BufferGeometry[]) shape.dispose();
    },
    [art, shapes],
  );

  /** ポインタの形（掴めることを見せる。§12.2 の操作感）。 */
  const setCursor = useCallback(
    (value: string): void => {
      const element: HTMLElement | undefined = gl?.domElement;
      if (element?.style === undefined) return;
      element.style.cursor = value;
    },
    [gl],
  );

  /** ドラッグを終えたときに戻すカーソル（まだキューブの上に居れば掴める形のまま）。 */
  const idleCursor = useCallback((): string => (hovered.current === null ? '' : 'grab'), []);

  /** いま塗るべき状態でギズモ全体を塗り直す。 */
  const paint = useCallback((highlight: GizmoHighlight): void => {
    paintGizmo(cube.current, highlight);
    paintGizmo(billboard.current, highlight);
  }, []);

  /** 視点プリセットが変わったら、いまの視点の面の色を塗り直す（初回の塗りもここ）。 */
  useEffect(() => {
    paint({
      hovered: hovered.current,
      fading: null,
      fade: 1,
      active: gizmoActiveFace(preset),
    });
    invalidate();
  }, [invalidate, paint, preset]);

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

  /** 掴んだ瞬間、進行中のスナップは打ち切る（指の動きが最優先）。 */
  const cancelSnap = useCallback((): void => {
    snap.current = null;
  }, []);

  const readPose = useCallback(
    (): CameraPose => ({
      position: [camera.position.x, camera.position.y, camera.position.z],
      up: [camera.up.x, camera.up.y, camera.up.z],
      target: [controls?.target.x ?? 0, controls?.target.y ?? 0, controls?.target.z ?? 0],
    }),
    [camera, controls],
  );

  const completeRotation = useCallback(() => useTourStore.getState().advance('rotate'), []);

  /** 押す→引く→放すの状態機械（`use-gizmo-drag.ts`）。 */
  const { onPointerDown, isDragging } = useGizmoDrag({
    controls,
    invalidate,
    setCursor,
    idleCursor,
    onTap: snapTo,
    onGrab: cancelSnap,
    onRotateComplete: completeRotation,
    readPose,
    applyPose,
  });

  /** ホバー表示を差し替える（同じなら何もしない＝ポインタが動くたびの再描画を避ける）。 */
  const setHover = useCallback(
    (id: string | null): void => {
      // ドラッグ中はキューブの外を通るので、ホバーは触らない（点滅する）
      if (isDragging() || hovered.current === id) return;
      fade.current = { from: hovered.current, to: id, startMs: performance.now() };
      hovered.current = id;
      setCursor(id === null ? '' : 'grab');
      invalidate();
    },
    [invalidate, isDragging, setCursor],
  );

  /**
   * 毎フレームの仕事。`GizmoHelper` がキューブの向きを決めたあと、`Hud` が描く前に走る。
   *
   * 1. 下地・ボタン・ツールチップを**画面に正対**させる（親の回転を打ち消す）。
   * 2. 辺・角のスナップを `VIEW_TRANSITION_MS` で補間する。
   * 3. ホバーの出入りを `GIZMO_FADE_MS` で補間する。
   * 2と3は終わったら自分でループを止める（`frameloop="demand"`）。
   *
   * `GIZMO_MIN_VIEWPORT_PX` 未満でキューブを描いていない（`layout === null`）ときは
   * `cube.current` / `billboard.current` が `null` のままなので、ここは何もしない。
   *
   * **優先度はキューブを描くときだけ 0 より大きくする**（UI監査バッチE）。R3F は
   * 「優先度 0 より大きい `useFrame` が1つでもあれば自動描画をやめ、描くのはアプリの責任」
   * という約束なので、キューブを隠しているのにここだけ 0.5 で居座ると、本体シーンを描く者
   * （`GizmoHelper` の `Hud`、優先度 1）が居なくなり**キャンバスが真っ黒のまま**になる。
   * 実際、モードDの分割（3Dペイン 457px 幅 < 600px）では盤が1枚も描かれず、drei の
   * `<Html>` の名札だけが黒地に浮いていた（監査の「盤が描かれずに名札だけ」）。
   */
  useFrame(
    () => {
      const plate = billboard.current;
      const parent = plate?.parent ?? null;
      if (plate !== null && parent !== null) {
        // 親（`GizmoHelper` が本体カメラの逆回転を入れる group）を打ち消す
        plate.quaternion.copy(parent.quaternion).invert();
      }

      const animation = snap.current;
      if (animation !== null) {
        const elapsed = performance.now() - animation.startMs;
        const t = Math.min(1, elapsed / VIEW_TRANSITION_MS);
        applyPose(interpolatePose(animation.from, animation.to, t));
        if (t < 1) invalidate();
        else snap.current = null;
      }

      const hover = fade.current;
      if (hover !== null) {
        const t = Math.min(1, (performance.now() - hover.startMs) / GIZMO_FADE_MS);
        // なめらかに出入りさせる（三次の滑り出し・滑り込み）
        paint({
          hovered: hover.to,
          fading: hover.from,
          fade: t * t * (3 - 2 * t),
          active: gizmoActiveFace(preset),
        });
        if (t < 1) invalidate();
        else fade.current = null;
      }
    },
    layout === null ? 0 : GIZMO_FRAME_PRIORITY,
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

  /**
   * ボタンの効果。どちらも**ストアへの書き込み1回**で済ませる（§15）。
   * ⌂ は正面から盤全体を見る既定の視点へ、⟳ はいまの視点プリセットへ着け直す
   * （自由に回して傾いた画を、プリセットの正しい向きへ戻す）。
   */
  const onButton = useCallback((id: GizmoButtonId, event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation();
    const store = useStore.getState();
    store.setCamera(id === 'home' ? 'front' : store.camera);
  }, []);

  // `GIZMO_MIN_VIEWPORT_PX`（600px）未満のキャンバスでは何も描かない。視点プリセットは
  // ツールバー・テンキーからそのまま押せるので、機能は失わない（コンポーネント冒頭の doc）。
  if (layout === null) return <></>;

  return (
    <GizmoHelper alignment="top-left" margin={layout.margin} renderPriority={1}>
      {/* HUD は本体シーンと別なので、ここに置く光はギズモだけを照らす */}
      <ambientLight intensity={GIZMO_LIGHT.ambient} />
      <directionalLight intensity={GIZMO_LIGHT.key} position={GIZMO_LIGHT.keyPosition} />

      <group
        ref={cube}
        scale={[layout.size, layout.size, layout.size]}
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        {/* 本体（角を落としたキューブの面6枚）。面の当たり判定はこのメッシュそのもの */}
        <mesh
          name={GIZMO_FACE_MESH_NAME}
          geometry={shapes.faces}
          onPointerMove={onFacePointerMove}
          onPointerOut={onPointerOut}
        >
          {art.faces.map((texture, index) => (
            <meshLambertMaterial
              key={GIZMO_FACE_ORDER[index] ?? index}
              attach={`material-${index}`}
              map={texture}
              color={NO_TINT}
              toneMapped={false}
            />
          ))}
        </mesh>

        {/* 面取り（辺12・角8）。見た目だけで、押す相手は下の当たり判定の箱 */}
        <group name={GIZMO_CHAMFER_GROUP_NAME}>
          {GIZMO_FACETS.map((facet) => (
            <mesh
              key={facet.id}
              name={`${GIZMO_CHAMFER_PREFIX}${facet.id}`}
              geometry={facet.kind === 'edge' ? shapes.edge : shapes.corner}
              position={[facet.position[0], facet.position[1], facet.position[2]]}
              quaternion={[
                facet.quaternion[0],
                facet.quaternion[1],
                facet.quaternion[2],
                facet.quaternion[3],
              ]}
              raycast={noRaycast}
            >
              <meshLambertMaterial color={GIZMO_COLORS.chamfer} toneMapped={false} />
            </mesh>
          ))}
        </group>

        {/* 辺12・角8の当たり判定。通常は見えず、指したときだけ光る（Blender と同じ） */}
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
              opacity={0}
              toneMapped={false}
              visible={false}
            />
          </mesh>
        ))}
      </group>

      {/*
        画面に正対したまま動かない部分。親の回転は `useFrame` で打ち消す。
        下地は深度を書かずに真っ先に描くので、キューブは必ずその上に出る。
      */}
      <group ref={billboard} name={GIZMO_BILLBOARD_NAME}>
        <mesh
          name={GIZMO_PLATE_NAME}
          geometry={shapes.plate}
          position={[0, 0, -layout.size]}
          scale={layout.plateRadius}
          renderOrder={-10}
          raycast={noRaycast}
        >
          <meshBasicMaterial
            color={GIZMO_COLORS.plate}
            transparent
            opacity={GIZMO_PLATE_OPACITY}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh
          geometry={shapes.plateRing}
          position={[0, 0, -layout.size + 0.5]}
          scale={layout.plateRadius}
          renderOrder={-9}
          raycast={noRaycast}
        >
          <meshBasicMaterial
            color={GIZMO_COLORS.plateBorder}
            transparent
            opacity={0.85}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* ⌂ 全体表示 / ⟳ 傾きを戻す（キューブのすぐ下、空き地を残さない大きさの下地の中） */}
        {GIZMO_BUTTONS.map((button) => (
          <group key={button.id} position={[button.x, layout.buttonY, 0]}>
            <mesh
              name={`${GIZMO_BUTTON_PREFIX}${button.id}`}
              geometry={shapes.quad}
              scale={[GIZMO_BUTTON.size, GIZMO_BUTTON.size, 1]}
              renderOrder={12}
              onPointerOver={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                setHover(button.id);
              }}
              onPointerOut={onPointerOut}
              onPointerDown={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
              }}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                onButton(button.id, event);
              }}
            >
              <meshBasicMaterial
                map={art.buttons[button.id]}
                color={NO_TINT}
                transparent
                depthTest={false}
                toneMapped={false}
              />
            </mesh>
            <mesh
              name={`${GIZMO_TIP_PREFIX}${button.id}`}
              geometry={shapes.quad}
              visible={false}
              position={[0, -(GIZMO_BUTTON.size / 2 + art.tips[button.id].height / 2 + 4), 0]}
              scale={[art.tips[button.id].width, art.tips[button.id].height, 1]}
              renderOrder={14}
              raycast={noRaycast}
            >
              <meshBasicMaterial
                map={art.tips[button.id].texture}
                transparent
                opacity={0}
                depthTest={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))}
      </group>
    </GizmoHelper>
  );
}
