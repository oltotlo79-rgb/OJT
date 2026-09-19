import { GizmoHelper } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  CircleGeometry,
  Color,
  PlaneGeometry,
  RingGeometry,
  type BufferGeometry,
  type CanvasTexture,
  type Group,
  type Material,
  type Mesh,
  type MeshBasicMaterial,
  type MeshLambertMaterial,
  type Object3D,
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
  clamp,
  GIZMO_DRAG_THRESHOLD_PX,
  GIZMO_FACE_ORDER,
  GIZMO_HIT_BOXES,
  gizmoDragToSpherical,
  gizmoTargetById,
  gizmoTargetForDirection,
  type OrbitControlsLike,
} from './navigation.js';
import {
  chamferedFaceGeometry,
  GIZMO_CORNER_FACET_RADIUS,
  GIZMO_EDGE_FACET_SIZE,
  GIZMO_FACE_SPAN,
  GIZMO_FACETS,
} from './view-gizmo-geometry.js';
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
 *   `gizmoLayoutForViewport()` の大きさぶんだけ、キューブと⌂/⟳の2ボタンの外接円ちょうどに絞る
 *   （空き地を残さない。2026-09-20 の利用者指摘）。
 * - **⌂ 全体表示 / ⟳ 傾きを戻す**の2ボタン（28px・和文のツールチップ付き）。
 * - ホバーは 200ms で暖色へふわりと変わり、**いまの視点の面**には淡い青が乗る。
 *
 * 操作は Blender と同じ2通り。
 * - **ドラッグ**: キューブを掴んで引くと、その量だけ本体のカメラが注視点のまわりを回る
 *   （1000px で1回転 ≒ 0.36°/px）。慣性なしで 1:1。
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
 * キューブの1辺の大きさ[px]（キャンバス幅が `GIZMO_WIDE_VIEWPORT_PX` 以上のときの既定値）。
 * §12.2 / 2026-09-19 の利用者要望
 *
 * `GizmoHelper` は HUD 用の正射影カメラを画面と同じ寸法で作る（`margin` がそのまま px で
 * 効くのと同じ空間）ので、**この値はそのまま CSS ピクセル**になる。実際の描画解像度は
 * `Canvas` の `dpr` が面倒を見るため、高DPI環境でも見た目の大きさは変わらない。
 */
export const GIZMO_SIZE = 96;

/**
 * 狭いキャンバス（`GIZMO_MIN_VIEWPORT_PX` 〜 `GIZMO_WIDE_VIEWPORT_PX` 未満）でのキューブの
 * 大きさ[px]。2026-09-20 の利用者指摘「重なってるし」対応。モードD「分割」の3Dペインのように
 * 幅が限られる場面で、キューブが盤の絵を大きく覆わないよう縮める。
 */
export const GIZMO_SIZE_NARROW = 64;

/** これ以上の幅[px]ならキューブを `GIZMO_SIZE`（96px）で出す。 */
export const GIZMO_WIDE_VIEWPORT_PX = 900;

/**
 * これ未満の幅[px]ならキューブごと隠す。視点プリセットはツールバーの「…」とテンキーに
 * 変わらず残るので、機能は失わない（`gizmoLayoutForViewport()` の doc を参照）。
 */
export const GIZMO_MIN_VIEWPORT_PX = 600;

/**
 * ビューポートの上端からキューブの上端までに空ける余白[px]。
 * 状態オーバーレイは右上へ移したので（`screens.module.css` の `.statusOverlay`）、
 * 左上はキューブの場所として空いている。盤の上端の名札と重ならない高さに置く。
 */
export const GIZMO_TOP_MARGIN_PX = 20;

/** レイアウトの基準になる余白の単位[px]（§UX方針の8pxグリッド）。 */
export const GIZMO_GRID_PX = 8;

/**
 * 角を落としたキューブの外形（面取り込み）の中心からの最大半径[px] ÷ キューブの1辺[px]。
 * 面の頂点（面中心から局所 `±GIZMO_FACE_SPAN/2` だけ離れた四隅）がいちばん遠く、
 * 中心からの距離は一辺1の局所座標で `√(0.5² + (GIZMO_FACE_SPAN/2)² × 2)` になる
 * （面直の距離0.5・面内の2成分が最大）。検算は `view-gizmo.test.tsx` に置く。
 */
const GIZMO_CUBE_RADIUS_RATIO = Math.sqrt(0.5 ** 2 + 2 * (GIZMO_FACE_SPAN / 2) ** 2);

/** キューブの外形の半径[px]。 */
function gizmoCubeRadiusPx(size: number): number {
  return size * GIZMO_CUBE_RADIUS_RATIO;
}

/** ボタン（⌂ / ⟳）の1辺[px]。押しやすさのため 24px 以上にする（UXレビュー #4）。 */
const GIZMO_BUTTON_SIZE_PX = 28;

/** ボタン（⌂ / ⟳）の置き場所と大きさ[px]。 */
export const GIZMO_BUTTON = {
  size: GIZMO_BUTTON_SIZE_PX,
  /** 中心からの左右の位置（2つのボタンのあいだに `GIZMO_GRID_PX` を空ける）。 */
  x: GIZMO_BUTTON_SIZE_PX / 2 + GIZMO_GRID_PX / 2,
} as const;

/** キューブの外形からボタンの中心までの隙間[px]（8pxグリッド）。 */
const GIZMO_BUTTON_CUBE_GAP_PX = GIZMO_GRID_PX;

/**
 * ボタン行のY位置（キューブ中心からの下方向オフセット）[px]。三脚を撤去したので、
 * キューブの外形のすぐ下（`GIZMO_BUTTON_CUBE_GAP_PX` の隙間だけ空けて）に置ける
 * （2026-09-20 の利用者指摘。以前は三脚の場所ぶん `-108px` まで離れていた）。
 */
function gizmoButtonYPx(size: number): number {
  return -(gizmoCubeRadiusPx(size) + GIZMO_BUTTON_CUBE_GAP_PX + GIZMO_BUTTON.size / 2);
}

/** 下地の丸がキューブ・ボタンの外接円からさらに空ける余白[px]。 */
const GIZMO_PLATE_PAD_PX = GIZMO_GRID_PX;

/**
 * 下地の丸の半径[px]。キューブとボタン2つ、両方の外接円ちょうど（空き地を残さない。
 * 2026-09-20 の利用者指摘「重なってるし」への対応: 三脚が無くなった分、下地は
 * **キューブ＋ボタンだけ**を包む大きさに絞る）。
 */
function gizmoPlateRadiusPx(size: number): number {
  const cubeRadius = gizmoCubeRadiusPx(size);
  const buttonY = gizmoButtonYPx(size);
  const buttonOuterCorner = Math.hypot(
    GIZMO_BUTTON.x + GIZMO_BUTTON.size / 2,
    Math.abs(buttonY) + GIZMO_BUTTON.size / 2,
  );
  return Math.max(cubeRadius, buttonOuterCorner) + GIZMO_PLATE_PAD_PX;
}

/** ビューポートの角から HUD（下地の外形）までの隙間[px]（8pxグリッド2つぶん）。 */
const GIZMO_EDGE_GAP_PX = GIZMO_GRID_PX * 2;

/** HUD（`GizmoHelper` の `margin`）の中心位置[px]。下地の丸の半径＋角の隙間。 */
function gizmoMarginPx(size: number): [number, number] {
  const margin = gizmoPlateRadiusPx(size) + GIZMO_EDGE_GAP_PX;
  return [margin, margin];
}

/** HUD の置き方（キューブの大きさ・余白・下地の半径・ボタン行のY位置）。 */
export interface GizmoLayout {
  size: number;
  margin: [number, number];
  plateRadius: number;
  buttonY: number;
}

/**
 * キャンバス幅・高さから HUD の置き方を決める。`null` なら隠す。§12.2 / 2026-09-20 の利用者指摘
 * 「3Dのキューブと赤、青、緑の骨組みがある意味は？…重なってるし」への対応の一環で、
 * モードD「分割」のような狭い3Dペインでキューブが盤の絵に重ならないようにする。
 *
 * - `GIZMO_WIDE_VIEWPORT_PX`（900px）以上: 既定の `GIZMO_SIZE`（96px）
 * - `GIZMO_MIN_VIEWPORT_PX`（600px）〜900px未満: `GIZMO_SIZE_NARROW`（64px）
 * - 600px未満: `null`（隠す）。視点プリセットはツールバー・テンキーからそのまま押せる
 *
 * `heightPx` は 2026-09-20 の監査指摘 B4 で足した引数（省略可・幅だけの既存呼び出しは
 * そのまま動く）。モードB「並べて」を1280px幅で見ると、3Dペインは横こそ900px前後あるが
 * 縦は盤・エディタの2段に割られて約200px台まで潰れる。幅だけで判定すると、その高さでは
 * 下地の丸（縦の占有が `margin[1] + plateRadius`）がペインの下端を越え、`panels/ViewHint.tsx`
 * の「?」（ペイン自身の下端基準の `bottom` 指定）と重なりかねない。高さも渡されたときは、
 * 選ばれた大きさの下地の丸がペインの高さに収まるか確かめ、収まらなければ幅の判定にかかわらず
 * 隠す（視点プリセットの機能はツールバー・テンキーに残るので失われない）。
 */
export function gizmoLayoutForViewport(widthPx: number, heightPx?: number): GizmoLayout | null {
  if (widthPx < GIZMO_MIN_VIEWPORT_PX) return null;
  const size = widthPx < GIZMO_WIDE_VIEWPORT_PX ? GIZMO_SIZE_NARROW : GIZMO_SIZE;
  const margin = gizmoMarginPx(size);
  const plateRadius = gizmoPlateRadiusPx(size);
  if (heightPx !== undefined && margin[1] + plateRadius > heightPx) return null;
  return {
    size,
    margin,
    plateRadius,
    buttonY: gizmoButtonYPx(size),
  };
}

/** 既定（キャンバス幅900px以上・96px）のときの下地の丸の半径[px]。 */
export const GIZMO_PLATE_RADIUS = gizmoPlateRadiusPx(GIZMO_SIZE);

/**
 * 既定（キャンバス幅900px以上・96px）のときのビューポートの角から**キューブ中心**までの
 * 余白[px]。`margin` は中心の位置なので、下地の上端は `margin[1] - GIZMO_PLATE_RADIUS`。
 */
export const GIZMO_MARGIN: [number, number] = gizmoMarginPx(GIZMO_SIZE);

/**
 * 下地の丸（キューブ＋⌂/⟳ボタン一式）がビューポートの**左上から**占める最大の半径[px]
 * （既定・キャンバス幅900px以上の場合）。`panels/ViewHint.tsx` の「?」を安全に離す位置の
 * 根拠として使う（2026-09-20 の監査指摘 B4）。実際の位置合わせは `ViewHint` 側で
 * 「対角のコーナー（右下）に置く」という単純な方法を取るため、この値は
 * `view-gizmo.test.tsx` の検算にのみ使う（ここより狭い／低いキャンバスではキューブ自体が
 * 縮む・消えるので、左上の占有はこの値を超えない）。
 */
export const GIZMO_MAX_FOOTPRINT_PX = GIZMO_MARGIN[0] + GIZMO_PLATE_RADIUS;

/** ホバーの出入りに掛ける時間[ms]（§12.2 の「控えめな演出」）。 */
export const GIZMO_FADE_MS = 200;

/**
 * ギズモの毎フレーム処理の優先度。
 *
 * drei の `GizmoHelper` は優先度 0 の `useFrame` でギズモの向きを本体カメラの逆回転に合わせ、
 * `Hud` は優先度 1 で HUD シーンを描く。**その間**で走らせると、下地・ボタンの
 * 打ち消し回転が「同じフレームのキューブの向き」に必ず追随する（1フレーム遅れない）。
 */
export const GIZMO_FRAME_PRIORITY = 0.5;

/**
 * キューブの色。暗い背景（`#141820`）の上で輪郭と面が読めること、かつ
 * **正面視で明るい盤（`#E6E4DE`）に重なっても面と文字が読める**ことの両方を満たす必要がある。
 * 以前は面が明るい灰（`#D8DDE6`）で盤の色とほとんど同じになり、`上` も側面も沈んで見えなかった
 * （レビュー指摘）。面を中間の青灰に落とし、文字は白、稜線は濃紺にして対比を作る。
 *
 * 2026-09-19 の「デザインがシンプルすぎる」への追加分（面取り・下地・ボタン）は
 * `global.css` の配色変数（`--bg` `--panel` `--line` `--muted` `--accent`）から取る。
 */
export const GIZMO_COLORS = {
  face: '#4A5563',
  text: '#FFFFFF',
  stroke: '#141820',
  hover: '#FFB347',
  /** 面の上側（グラデーションの明るい端）。 */
  faceTop: '#57626F',
  /** 面の内側に通す細い明るいふち（`--muted`）。 */
  rim: '#9AA4B5',
  /** 角・辺の面取り（`--line` と同じ暗さ）。 */
  chamfer: '#39404E',
  /** 下地の丸（`--bg`）。 */
  plate: '#141820',
  /** 下地のふち（`--line`）。 */
  plateBorder: '#39404E',
  /** いまの視点の面に乗せる淡い色（`--accent`）。 */
  accent: '#39D0FF',
  /** ボタンの地（`--panel`）と絵記号（`--text`）。 */
  button: '#1E232D',
  buttonInk: '#E7EBF2',
} as const;

/** 下地の透け具合（明るい盤の上でもキューブが浮くぎりぎりの濃さ）。 */
export const GIZMO_PLATE_OPACITY = 0.6;

/** 面のメッシュの名前（当たり判定の箱と区別する）。 */
export const GIZMO_FACE_MESH_NAME = 'view-cube-faces';

/** 辺・角の当たり判定のメッシュ名の接頭辞。 */
export const GIZMO_HIT_PREFIX = 'view-cube-hit-';

/** 面取り（見た目だけ。当たり判定は持たない）のメッシュ名の接頭辞。 */
export const GIZMO_CHAMFER_PREFIX = 'view-cube-chamfer-';

/** 面取りをまとめる `group` の名前。 */
export const GIZMO_CHAMFER_GROUP_NAME = 'view-cube-chamfer';

/** ボタンのメッシュ名の接頭辞。 */
export const GIZMO_BUTTON_PREFIX = 'view-cube-button-';

/** ツールチップのメッシュ名の接頭辞（接尾辞はボタンと同じ）。 */
export const GIZMO_TIP_PREFIX = 'view-cube-tip-';

/** 画面に貼り付く（キューブと一緒に回らない）入れ物の名前。 */
export const GIZMO_BILLBOARD_NAME = 'view-cube-billboard';

/** 下地の丸の名前。 */
export const GIZMO_PLATE_NAME = 'view-cube-plate';

/** ホバーしていない面の色（テクスチャをそのまま出す）。 */
const NO_TINT = '#FFFFFF';

/** ボタン（⌂ / ⟳）の並び。 */
export const GIZMO_BUTTONS = [
  { id: 'home', x: -GIZMO_BUTTON.x },
  { id: 'reset', x: GIZMO_BUTTON.x },
] as const;

/** ボタンの名前。 */
export type GizmoButtonId = (typeof GIZMO_BUTTONS)[number]['id'];

/** HUD シーンの光。ここを消すと `meshLambertMaterial` が真っ黒になる。 */
export const GIZMO_LIGHT = {
  /**
   * 環境光。three の拡散反射は `色 × 強さ / π` なので、**π を入れるとテクスチャの色がそのまま出る**。
   * 少し落として、キーライトの当たる面との差を作る。
   */
  ambient: 2.8,
  /** キーライト（左上手前から）。面の向きで陰影が変わり、回すと立体に見える。 */
  key: 1.2,
  keyPosition: [-80, 140, 160] as [number, number, number],
} as const;

/** 色の入れ物（毎フレームの `copy`/`lerp` 用。確保はここだけ）。 */
const NO_GLOW = /* @__PURE__ */ new Color('#000000');
const WHITE = /* @__PURE__ */ new Color(NO_TINT);
/** ホバー中の自発光（強すぎると名札が飛ぶ）。 */
const HOVER_EMISSIVE = /* @__PURE__ */ new Color(GIZMO_COLORS.hover).multiplyScalar(0.62);
/** いまの視点の面に乗せる淡い自発光。 */
const ACTIVE_EMISSIVE = /* @__PURE__ */ new Color(GIZMO_COLORS.accent).multiplyScalar(0.2);
/** ホバー中の球・ボタンの色（テクスチャに掛ける）。 */
const HOVER_TINT = /* @__PURE__ */ new Color(GIZMO_COLORS.hover);

/** 辺・角の当たり判定が光るときの濃さ。 */
const HIT_OPACITY = 0.78;

/** 当たり判定を持たせない（見た目だけの部品）。 */
function noRaycast(): void {
  // three の当たり判定から外す（面取り・下地はクリックの邪魔をしない）
}

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

/** 進行中のホバーの出入り（暖色へふわりと変える）。 */
interface HoverFade {
  /** 消えていく側。 */
  from: string | null;
  /** 現れる側。 */
  to: string | null;
  startMs: number;
}

/** ギズモの塗り分けの状態。 */
export interface GizmoHighlight {
  /** いま指している当たり判定（面・辺・角・ボタン）。 */
  hovered: string | null;
  /** 直前に指していた当たり判定（`fade` の分だけ光が残る）。 */
  fading: string | null;
  /** 0→1 の補間の進み。 */
  fade: number;
  /** いまの視点プリセットに対応する面（淡い色を乗せる）。無ければ `null`。 */
  active: string | null;
}

/** ある部品の光り具合（0＝ふだん、1＝ホバー中）。 */
export function gizmoGlow(id: string, highlight: GizmoHighlight): number {
  let glow = 0;
  if (highlight.hovered === id) glow += highlight.fade;
  if (highlight.fading === id) glow += 1 - highlight.fade;
  return Math.min(1, Math.max(0, glow));
}

/** メッシュのマテリアルを1枚ずつ見る（面のメッシュだけ6枚ある）。 */
function materialsOf(mesh: Mesh): readonly Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** 名前が接頭辞で始まれば、その後ろ（＝当たり判定の名前）を返す。 */
function suffixOf(name: string, prefix: string): string | null {
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}

/**
 * ホバー中・いまの視点の部品だけを光らせる（React の再描画を起こさず直接触る）。§15
 *
 * 辺・角の箱は**マテリアルの** `visible` と `opacity` で出し入れする。メッシュ自体を隠すと
 * three の当たり判定の対象から外れかねないが、マテリアルなら見た目だけが消える
 * （drei の `GizmoViewcube` も同じ手を使っている）。
 *
 * 毎フレーム呼ばれるので、色は必ず既存の `Color` へ `copy`/`lerp` する（確保しない）。
 */
export function paintGizmo(root: Object3D | null, highlight: GizmoHighlight): void {
  if (root === null) return;
  for (const child of root.children) {
    paintGizmo(child, highlight);
  }
  const mesh = root as Mesh;
  const name = mesh.name;
  if (name === '') return;

  if (name === GIZMO_FACE_MESH_NAME) {
    materialsOf(mesh).forEach((material, index) => {
      const face = GIZMO_FACE_ORDER[index];
      const lambert = material as MeshLambertMaterial;
      if (face === undefined || lambert.emissive === undefined) return;
      const base = highlight.active === face ? ACTIVE_EMISSIVE : NO_GLOW;
      lambert.emissive.copy(base).lerp(HOVER_EMISSIVE, gizmoGlow(face, highlight));
    });
    return;
  }

  const hit = suffixOf(name, GIZMO_HIT_PREFIX);
  if (hit !== null) {
    const glow = gizmoGlow(hit, highlight);
    for (const material of materialsOf(mesh)) {
      const basic = material as MeshBasicMaterial;
      basic.opacity = glow * HIT_OPACITY;
      basic.visible = glow > 0.002;
    }
    return;
  }

  const chamfer = suffixOf(name, GIZMO_CHAMFER_PREFIX);
  if (chamfer !== null) {
    const glow = gizmoGlow(chamfer, highlight);
    for (const material of materialsOf(mesh)) {
      const lambert = material as MeshLambertMaterial;
      if (lambert.emissive === undefined) continue;
      lambert.emissive.copy(NO_GLOW).lerp(HOVER_EMISSIVE, glow);
    }
    return;
  }

  const tinted = suffixOf(name, GIZMO_BUTTON_PREFIX);
  if (tinted !== null) {
    const glow = gizmoGlow(tinted, highlight);
    for (const material of materialsOf(mesh)) {
      const basic = material as MeshBasicMaterial;
      if (basic.color === undefined) continue;
      basic.color.copy(WHITE).lerp(HOVER_TINT, glow * 0.85);
    }
    return;
  }

  const tip = suffixOf(name, GIZMO_TIP_PREFIX);
  if (tip !== null) {
    const glow = gizmoGlow(tip, highlight);
    mesh.visible = glow > 0.5;
    for (const material of materialsOf(mesh)) {
      const basic = material as MeshBasicMaterial;
      basic.opacity = glow;
    }
  }
}

/** 視点プリセット → 淡く色を乗せる面（`socket` / `plc` は面に対応しないので `null`）。 */
export function gizmoActiveFace(preset: string): string | null {
  return (GIZMO_FACE_ORDER as readonly string[]).includes(preset) ? preset : null;
}

/**
 * 押した（あるいは指した）先の当たり判定の名前。
 * 辺・角は専用のメッシュ名から、面は当たった三角形の法線から引く
 * （キューブはカメラの逆回転で置かれているので、局所の法線はそのままワールドの向きになる）。
 */
function targetIdOf(event: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>): string | null {
  const name = event.object.name;
  const hit = suffixOf(name, GIZMO_HIT_PREFIX);
  if (hit !== null) return hit;
  const normal = event.face?.normal;
  if (normal === undefined || normal === null) return null;
  return gizmoTargetForDirection([normal.x, normal.y, normal.z]).id;
}

/**
 * 下地の丸の外周のふちの厚み ÷ 半径。以前の固定サイズ（半径80px・ふち1.4px）と同じ見た目の
 * 比率にする（`gizmoLayoutForViewport()` でキューブの大きさが変わっても、ふちの太さの
 * 見た目の比率は変わらない）。
 */
const GIZMO_PLATE_RING_THICKNESS_RATIO = 1.4 / 80;

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
  const drag = useRef<GizmoDrag | null>(null);
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

  /** いま塗るべき状態でギズモ全体を塗り直す。 */
  const paint = useCallback((highlight: GizmoHighlight): void => {
    paintGizmo(cube.current, highlight);
    paintGizmo(billboard.current, highlight);
  }, []);

  /** ホバー表示を差し替える（同じなら何もしない＝ポインタが動くたびの再描画を避ける）。 */
  const setHover = useCallback(
    (id: string | null): void => {
      // ドラッグ中はキューブの外を通るので、ホバーは触らない（点滅する）
      if (drag.current !== null || hovered.current === id) return;
      fade.current = { from: hovered.current, to: id, startMs: performance.now() };
      hovered.current = id;
      setCursor(id === null ? '' : 'grab');
      invalidate();
    },
    [invalidate, setCursor],
  );

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
   */
  useFrame(() => {
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
  }, GIZMO_FRAME_PRIORITY);

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
      setCursor(hovered.current === null ? '' : 'grab');
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
  }, [controls, invalidate, setCursor, snapTo]);

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
      setCursor('grabbing');
      invalidate();
    },
    [controls, invalidate, setCursor],
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

        {/* 辺12・角8の当たり判定。ふだんは見えず、指したときだけ光る（Blender と同じ） */}
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
