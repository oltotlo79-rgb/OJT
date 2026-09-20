import type { ThreeEvent } from '@react-three/fiber';
import {
  Color,
  type Material,
  type Mesh,
  type MeshBasicMaterial,
  type MeshLambertMaterial,
  type Object3D,
} from 'three';
import { GIZMO_FACE_ORDER, gizmoTargetForDirection } from './navigation.js';

/**
 * ビューキューブの**色と塗り分け**の層。設計仕様 §12.2 / §15。
 *
 * React を使わず、three の木（`Object3D`）を直接触って「指している部品だけを光らせる」。
 * 毎フレーム呼ばれるので、色は必ず既存の `Color` へ `copy`/`lerp` する（確保しない）。
 * 2026-09-20 の指摘 3D-16（`ViewGizmo.tsx` が1,080行）で `ViewGizmo.tsx` から割り出した。
 */

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
export const NO_TINT = '#FFFFFF';

/** ホバーの出入りに掛ける時間[ms]（§12.2 の「控えめな演出」）。 */
export const GIZMO_FADE_MS = 200;

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
export function noRaycast(): void {
  // three の当たり判定から外す（面取り・下地はクリックの邪魔をしない）
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
export function targetIdOf(
  event: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>,
): string | null {
  const name = event.object.name;
  const hit = suffixOf(name, GIZMO_HIT_PREFIX);
  if (hit !== null) return hit;
  const normal = event.face?.normal;
  if (normal === undefined || normal === null) return null;
  return gizmoTargetForDirection([normal.x, normal.y, normal.z]).id;
}
