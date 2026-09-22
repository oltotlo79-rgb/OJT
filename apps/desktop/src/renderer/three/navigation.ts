import type { CameraPreset } from '../app/store-types.js';
import { GIZMO_FACES } from './view-gizmo-layout.js';

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
  /**
   * 慣性の強さ（`OrbitControls.dampingFactor`）。`update()` 1回で目標の何割を詰めるか。
   * ビューキューブのドラッグ中だけ **1**（＝慣性なし・1回で全部詰める）に差し替えて、
   * 指の動きに 1:1 で追従させる（2026-09-19 の利用者要望「サクサク動くように」）。
   */
  dampingFactor: number;
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
 * **カメラが指に付いてくる**向きに統一する（2026-09-20 の所有者決定）。
 * 右へ引けばカメラが右へ回り（方位角が増え）、下へ引けばカメラが下へ回る（極角が増える）。
 * 上下・左右で同じ比喩なので、どちらの軸も「引いた向きへ視点が動く」と覚えれば済む。
 *
 * 2026-09-20 までは両軸とも逆（`-dx` / `-dy`。`OrbitControls` の左ドラッグと同じ符号で、
 * 「盤が指に付いてくる」向き）だった。これだと**俯瞰から下へ引くと極角が減って真上（極）へ
 * 寄っていく**ため、利用者が「上から正面へ回そう」として下へ引くと、正面（極角が増える側）と
 * 逆へ動いたうえ極で `clamp` に張り付いた。極では方位角を変えてもカメラ位置が動かないので、
 * そこから先はどちらへ引いても画が変わらない（＝2026-09-20 の報告「回らない」）。
 * 実測は Task 19 Step 1（俯瞰 極角0.8897 → 下へ200px で 0.0000 に張り付く）。
 */
export function gizmoDragToSpherical(
  dx: number,
  dy: number,
  radPerPx: number = GIZMO_DRAG_RAD_PER_PX,
): SphericalDelta {
  return { azimuth: dx * radPerPx, polar: dy * radPerPx };
}

/** `value` を `[min, max]` に収める。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 3要素ベクトルを正規化する（長さ0なら 0 ベクトル）。 */
function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * ビューキューブの当たり判定1つ分（面6・辺12・角8 の計26）。§12.2
 * 2026-09-19 の利用者要望「blender のようにキューブを選択しサクサク動くようにしたい」。
 *
 * Blender のナビゲーションギズモと同じく、**面だけでなく辺と角も押せる**ようにする。
 * 以前は辺・角を押しても6つの面プリセットのどれかへ丸めていたので、
 * 斜め45°の視点には決して着けなかった（その丸め役だった `presetForDirection()` は
 * `gizmoTargetForDirection()` に置き換わり、3D-18 で削除した）。
 */
export interface GizmoTarget {
  /** 当たり判定の名前（`front` / `front-top` / `front-top-right` など）。 */
  id: string;
  /** 面・辺・角のどれか（押せる大きさと見た目が変わる）。 */
  kind: 'face' | 'edge' | 'corner';
  /** キューブ中心からの向き（各成分は -1 / 0 / 1。正規化はしていない）。 */
  direction: readonly [number, number, number];
  /** 面のときだけ、対応する視点プリセット（ツールバーのボタン・テンキーと同じ場所に着く）。 */
  preset?: CameraPreset | undefined;
  /** 面のときだけ、キューブに焼く日本語の名札。 */
  label?: string | undefined;
}

/**
 * キューブの面に焼く名札（three の `BoxGeometry` のマテリアル順＝ +X / -X / +Y / -Y / +Z / -Z）。
 * 盤面の法線が +Z なので、+Z が「正面」。§15 の文言方針にあわせて日本語にする。
 */
export const GIZMO_FACE_ORDER: readonly Extract<
  CameraPreset,
  'right' | 'left' | 'top' | 'bottom' | 'front' | 'back'
>[] = ['right', 'left', 'top', 'bottom', 'front', 'back'];

/** 向き（各成分 -1/0/1）→ 当たり判定の名前。前後 → 上下 → 左右 の順に並べる。 */
function gizmoTargetId(direction: readonly [number, number, number]): string {
  const parts: string[] = [];
  if (direction[2] !== 0) parts.push(direction[2] > 0 ? 'front' : 'back');
  if (direction[1] !== 0) parts.push(direction[1] > 0 ? 'top' : 'bottom');
  if (direction[0] !== 0) parts.push(direction[0] > 0 ? 'right' : 'left');
  return parts.join('-');
}

/** 面の向き → 視点プリセット。 */
const PRESET_FOR_AXIS: ReadonlyArray<{
  direction: readonly [number, number, number];
  preset: (typeof GIZMO_FACE_ORDER)[number];
}> = [
  { direction: [1, 0, 0], preset: 'right' },
  { direction: [-1, 0, 0], preset: 'left' },
  { direction: [0, 1, 0], preset: 'top' },
  { direction: [0, -1, 0], preset: 'bottom' },
  { direction: [0, 0, 1], preset: 'front' },
  { direction: [0, 0, -1], preset: 'back' },
];

/** 26個の当たり判定（面6 → 辺12 → 角8 の順）。 */
export const GIZMO_TARGETS: readonly GizmoTarget[] = ((): readonly GizmoTarget[] => {
  const axis = [-1, 0, 1] as const;
  const out: GizmoTarget[] = [];
  for (const x of axis) {
    for (const y of axis) {
      for (const z of axis) {
        const nonZero = (x === 0 ? 0 : 1) + (y === 0 ? 0 : 1) + (z === 0 ? 0 : 1);
        if (nonZero === 0) continue;
        const direction: readonly [number, number, number] = [x, y, z];
        const face = PRESET_FOR_AXIS.find(
          (entry) =>
            entry.direction[0] === x && entry.direction[1] === y && entry.direction[2] === z,
        );
        out.push({
          id: gizmoTargetId(direction),
          kind: nonZero === 1 ? 'face' : nonZero === 2 ? 'edge' : 'corner',
          direction,
          // 名札は `view-gizmo-layout.ts` の `GIZMO_FACES` が唯一の源（3D-19。以前はここに
          // 非公開の写しがあり、キューブに焼く名札とテストが見る名札が別物だった）
          ...(face === undefined ? {} : { preset: face.preset, label: GIZMO_FACES[face.preset] }),
        });
      }
    }
  }
  const rank = { face: 0, edge: 1, corner: 2 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
})();

/**
 * 辺・角の当たり判定の厚み（1辺1のキューブに対する割合）。§12.2
 *
 * 面の押せる範囲は中央の `1 - 2 × この値` の正方形になる。
 * 96px のキューブなら 角 ≒ 27px 角、辺 ≒ 27×42px、面 ≒ 42×42px。
 * drei 既定（60px・角15px）では小さすぎて狙えなかった（2026-09-19 の利用者要望）。
 */
export const GIZMO_HIT_RATIO = 0.28;

/** 辺・角の箱（キューブの局所座標。1辺を1とする）。 */
export interface GizmoHitBox {
  id: string;
  /** 箱の中心。 */
  position: readonly [number, number, number];
  /** 箱の寸法。 */
  size: readonly [number, number, number];
}

/** 辺12＋角8の当たり判定の箱（面はラベル付きの本体キューブがそのまま当たり判定になる）。 */
export const GIZMO_HIT_BOXES: readonly GizmoHitBox[] = GIZMO_TARGETS.filter(
  (target) => target.kind !== 'face',
).map((target) => {
  const offset = 0.5 - GIZMO_HIT_RATIO / 2;
  const span = 1 - 2 * GIZMO_HIT_RATIO;
  const axisSize = (value: number): number => (value === 0 ? span : GIZMO_HIT_RATIO);
  return {
    id: target.id,
    position: [
      target.direction[0] * offset,
      target.direction[1] * offset,
      target.direction[2] * offset,
    ] as const,
    size: [
      axisSize(target.direction[0]),
      axisSize(target.direction[1]),
      axisSize(target.direction[2]),
    ] as const,
  };
});

/**
 * 指した向き → 26個のうちいちばん近い当たり判定。§12.2
 * 面の法線（`event.face.normal`）からでも、辺・角の箱の向きからでも引ける。
 */
export function gizmoTargetForDirection(direction: readonly [number, number, number]): GizmoTarget {
  const [x, y, z] = normalize(direction);
  let best = GIZMO_TARGETS[0] as GizmoTarget;
  let bestDot = -Infinity;
  for (const target of GIZMO_TARGETS) {
    const [tx, ty, tz] = normalize(target.direction);
    const dot = tx * x + ty * y + tz * z;
    if (dot > bestDot) {
      bestDot = dot;
      best = target;
    }
  }
  return best;
}

/** 名前から当たり判定を引く（見つからなければ `undefined`）。 */
export function gizmoTargetById(id: string): GizmoTarget | undefined {
  return GIZMO_TARGETS.find((target) => target.id === id);
}

/** E2E へ出すカメラの状態（隠し要素 `camera-readout` の中身）。 */
export interface CameraReadout {
  position?: readonly [number, number, number];
  up?: readonly [number, number, number];
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
    ...(readout.position === undefined
      ? {}
      : { position: readout.position.map((v) => round(v, 4)) }),
    ...(readout.up === undefined ? {} : { up: readout.up.map((v) => round(v, 6)) }),
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
