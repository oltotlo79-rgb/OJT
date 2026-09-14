import type { CameraPreset } from '../app/store-types.js';
import { cameraPose } from './camera.js';

/**
 * Blender 風の3Dナビゲーションの純粋な計算。設計仕様 §12.2（2026-09-14 の利用者要望）。
 *
 * 「3D図の回転や拡大は Blender の操作感を目指し、キューブをドラッグすることで画面を回せるように」
 * という要望に対して、①中ボタンの修飾キー割り当て、②ビューキューブのドラッグ量 → 回転角、
 * ③テンキーの視点ショートカット、④キューブの面・辺・角 → 視点プリセット、を決める。
 * React も three も使わないので、単体テストからそのまま読める（§14.2）。
 */

/**
 * `OrbitControls`（three-stdlib）のうち、この層とビューキューブが触る部分だけの型。
 * three を直接読み込まずに扱えるようにして、ストアやテストから使えるようにする。
 */
export interface OrbitControlsLike {
  /** 盤側のマウス操作を受け付けるか（キューブのドラッグ中だけ落とす）。 */
  enabled: boolean;
  /** 注視点（盤の中心）。 */
  target: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
  minPolarAngle: number;
  maxPolarAngle: number;
  /** ボタンごとの操作（`three` の `MOUSE`）。修飾キーで中ボタンだけ差し替える。 */
  mouseButtons: {
    LEFT?: number | undefined;
    MIDDLE?: number | undefined;
    RIGHT?: number | undefined;
  };
  update: () => void;
  getAzimuthalAngle: () => number;
  getPolarAngle: () => number;
  setAzimuthalAngle: (value: number) => void;
  setPolarAngle: (value: number) => void;
  getDistance: () => number;
}

/** ドラッグで起きること（`OrbitControls` の `mouseButtons` に入れる操作）。 */
export type MiddleDragAction = 'rotate' | 'pan' | 'dolly';

/**
 * 中ボタンドラッグの割り当て。Blender と同じく
 * 中＝回転／Shift＋中＝平行移動／Ctrl＋中＝ズーム（ドリー）。
 *
 * 両方押されているときは**平行移動**にする（Blender では Ctrl+Shift+中がまた別の操作だが、
 * この盤では使い道が無く、誤って視点の距離が飛ぶより画が平行に動くほうが立て直しやすい）。
 * three の `OrbitControls` には修飾キー付きのボタン割り当てが無いので、
 * `keydown` / `keyup` のたびにこの関数で `mouseButtons.MIDDLE` を差し替える（`BoardScene`）。
 */
export function middleButtonActionFor({
  shift,
  ctrl,
}: {
  shift: boolean;
  ctrl: boolean;
}): MiddleDragAction {
  if (shift) return 'pan';
  if (ctrl) return 'dolly';
  return 'rotate';
}

/**
 * やりたい操作 → `mouseButtons` に実際に入れる値。
 *
 * three の `OrbitControls` は**修飾キー（Ctrl / Shift / Meta）が押されていると
 * `ROTATE` と `PAN` を入れ替える**（`onMouseDown` の switch。Shift＋左ドラッグで平行移動、
 * という three 既定の操作のため）。Blender の割り当てをそのまま入れると
 * 「Shift＋中ドラッグ＝平行移動」が回転になってしまうので、入れ替えぶんを打ち消して入れる。
 * `DOLLY` は入れ替えの対象外なのでそのまま。
 */
export function mouseButtonAssignment(
  action: MiddleDragAction,
  modifiersHeld: boolean,
): MiddleDragAction {
  if (action === 'dolly' || !modifiersHeld) return action;
  return action === 'pan' ? 'rotate' : 'pan';
}

/** 修飾キーの状態 → 中ボタンに入れる値（three の入れ替えを打ち消したもの）。 */
export function middleButtonAssignmentFor(modifiers: {
  shift: boolean;
  ctrl: boolean;
}): MiddleDragAction {
  return mouseButtonAssignment(middleButtonActionFor(modifiers), modifiers.shift || modifiers.ctrl);
}

/**
 * ビューキューブのドラッグ感度[rad/px]。
 * Blender のナビゲーションギズモと同じく **1000px のドラッグでちょうど1回転**（≒0.36°/px）。
 */
export const GIZMO_DRAG_RAD_PER_PX = (2 * Math.PI) / 1000;

/**
 * ドラッグとみなす移動量[px]。これ未満で放したらクリック（面へスナップ）として扱う。
 * R3F の `onClick` には移動量のしきい値が無いので、ここで自前に持つ。
 */
export const GIZMO_DRAG_THRESHOLD_PX = 4;

/** ビューキューブのドラッグ量 → 方位角・極角の変化[rad]。 */
export interface SphericalDelta {
  /** 方位角の変化[rad]（`OrbitControls.getAzimuthalAngle()` に足す）。 */
  azimuth: number;
  /** 極角の変化[rad]（`OrbitControls.getPolarAngle()` に足す）。 */
  polar: number;
}

/**
 * キューブのドラッグ量[px] → 視点の回転量[rad]。
 *
 * 符号は `OrbitControls` の左ドラッグと揃える（右へ引けば方位角が減り、下へ引けば極角が減る）。
 * こうするとキューブを掴んで回したとおりに盤も回り、キューブ自身もカメラを映すので指に付いてくる。
 */
export function gizmoDragToSpherical(
  dx: number,
  dy: number,
  radPerPx: number = GIZMO_DRAG_RAD_PER_PX,
): SphericalDelta {
  return { azimuth: -dx * radPerPx, polar: -dy * radPerPx };
}

/** `value` を `[min, max]` に収める。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** ビューキューブの面が向く向き（キューブの局所軸＝ワールド軸）→ 視点プリセット。 */
const FACE_VIEWS: ReadonlyArray<{ axis: 0 | 1 | 2; sign: 1 | -1; preset: CameraPreset }> = [
  { axis: 0, sign: 1, preset: 'right' },
  { axis: 0, sign: -1, preset: 'left' },
  { axis: 1, sign: 1, preset: 'top' },
  { axis: 1, sign: -1, preset: 'bottom' },
  { axis: 2, sign: 1, preset: 'front' },
  { axis: 2, sign: -1, preset: 'back' },
];

/** 方向で選べる視点（`socket` は寄りのプリセットなので向きでは選ばない）。 */
const DIRECTIONAL_PRESETS: readonly CameraPreset[] = [
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
];

/** ある軸にほぼ沿っているとみなす成分の大きさ（＝キューブの面をクリックした）。 */
const FACE_AXIS_THRESHOLD = 0.9;

/** 3要素ベクトルを正規化する（長さ0なら 0 ベクトル）。 */
function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * ビューキューブで指した向き → 視点プリセット。§12.2
 *
 * 面（軸にほぼ沿った向き）は「その面から見る」プリセットに素直に対応させる。
 * 辺や角は斜めなので、**プリセットの実際の視線方向といちばん近いもの**を選ぶ
 * （左手前・上の角は俯瞰プリセットとほぼ同じ向きなので `top` になる）。
 * こうするとキューブのクリックとテンキー・ツールバーが同じ視点に着く。
 */
export function presetForDirection(direction: readonly [number, number, number]): CameraPreset {
  const [x, y, z] = normalize(direction);
  const components = [x, y, z] as const;
  for (const face of FACE_VIEWS) {
    if (components[face.axis] * face.sign >= FACE_AXIS_THRESHOLD) return face.preset;
  }
  let best: CameraPreset = 'front';
  let bestDot = -Infinity;
  for (const preset of DIRECTIONAL_PRESETS) {
    const pose = cameraPose(preset);
    const [px, py, pz] = normalize([
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    ]);
    const dot = px * x + py * y + pz * z;
    if (dot > bestDot) {
      bestDot = dot;
      best = preset;
    }
  }
  return best;
}

/** E2E へ出すカメラの状態（隠し要素 `camera-readout` の中身）。 */
export interface CameraReadout {
  /** 方位角[rad]。 */
  azimuth: number;
  /** 極角[rad]。 */
  polar: number;
  /** 注視点までの距離[mm]。 */
  distance: number;
  /** 注視点（ワールド mm）。 */
  target: readonly [number, number, number];
}

/** 小数点以下を丸める（読み出しの文字列が浮動小数の誤差で暴れないように）。 */
function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * カメラの状態 → 隠し要素に書く文字列（JSON）。§14.2
 * E2E から「ドラッグで本当に視点が回ったか」「平行移動で注視点が動いたか」を確かめるための窓。
 * React の再描画を起こさないよう、`OrbitControls` の `change` から DOM へ直接書く。
 */
export function cameraReadoutText(readout: CameraReadout): string {
  return JSON.stringify({
    az: round(readout.azimuth, 4),
    polar: round(readout.polar, 4),
    dist: round(readout.distance, 2),
    tx: round(readout.target[0], 2),
    ty: round(readout.target[1], 2),
    tz: round(readout.target[2], 2),
  });
}

/**
 * ドラッグで回したときに、放した先のクリックで盤を拾わないようにする見張り。§12.2
 *
 * R3F の `onClick` には移動量のしきい値が無いので、端子の上から視点を回すと
 * 放した瞬間にその端子を拾って配線が始まってしまう。押した位置からの移動量を覚えておき、
 * しきい値を超えていたらピックを捨てる（＝回転はできて誤配線は起きない）。
 */
export interface PickDragGuard {
  /** ポインタを押した。 */
  down: (x: number, y: number) => void;
  /** ポインタが動いた（ボタンを押している間だけ呼ぶ）。 */
  move: (x: number, y: number) => void;
  /** 直前の操作がドラッグだったか（＝ピックを捨てるべきか）。 */
  dragged: () => boolean;
}

/** ピックを捨てるかどうかの見張りを作る。 */
export function createPickDragGuard(threshold: number = GIZMO_DRAG_THRESHOLD_PX): PickDragGuard {
  let startX = 0;
  let startY = 0;
  let dragged = false;
  return {
    down: (x, y) => {
      startX = x;
      startY = y;
      dragged = false;
    },
    move: (x, y) => {
      if (dragged) return;
      if (Math.hypot(x - startX, y - startY) >= threshold) dragged = true;
    },
    dragged: () => dragged,
  };
}
