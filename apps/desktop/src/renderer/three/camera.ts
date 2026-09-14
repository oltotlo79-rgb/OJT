import { BOARD_HEIGHT_MM, BOARD_WIDTH_MM, JIPM_BOARD } from '@ojt/board-model';
import type { CameraPreset } from '../app/store-types.js';

/**
 * 盤の傾きと視点プリセットの純粋な計算。設計仕様 §6.5 / §12.2。
 * React も three も使わないので、単体テストからも E2E の射影計算からも読める。
 */

/** カメラの垂直視野角[度]。`BoardScene` の `Canvas` に渡す値。 */
export const CAMERA_FOV_DEG = 38;

/** カメラが盤へ寄れる最短距離[mm]（端子の印字が読める程度まで）。§12.2 */
export const MIN_CAMERA_DISTANCE_MM = 90;

/** カメラが離れられる最長距離[mm]。 */
export const MAX_CAMERA_DISTANCE_MM = 1200;

/**
 * 仰角（極角）の上限[rad]。盤の裏側・真下へ回り込ませない。§12.2
 *
 * `OrbitControls` は `update()` のたびに極角をこの値へ丸めるので、**プリセットの視点も
 * この範囲に収まっていなければならない**（超えた視点を置くと、次のフレームで引き戻される）。
 * `cameraPose('bottom')` がちょうどこの角度を使うのはそのため。
 */
export const MAX_POLAR_ANGLE = Math.PI * 0.48;

/** ソケット段の中心の盤モデル y[mm]。盤定義のソケット原点と本体寸法から求める（ハードコードしない）。 */
export const SOCKET_ROW_CENTER_MM = ((): number => {
  const sockets = JIPM_BOARD.sockets;
  const first = sockets[0];
  if (first === undefined) return BOARD_HEIGHT_MM / 2;
  const top = Math.min(...sockets.map((socket) => socket.origin.y));
  return top + first.bodyMm.length / 2;
})();

/** 「ソケット拡大」で必ず画角に入れる余白[mm]（機器の外形の外側）。§12.2 */
export const SOCKET_VIEW_MARGIN_MM = 10;

/**
 * 「ソケット拡大」で使うビューポートの想定縦横比。
 * 3D表示領域は「ウィンドウ幅 − 右パネル380px」×「ウィンドウ高 − ツールバー − 下部パネル200px」で、
 * 1280×800 でも 1440×900 でも 1.6 程度になる。狭いほうに倒して 1.5 を想定にしておけば、
 * 実際の縦横比がこれより横長な限り左右が切れない。
 */
export const SOCKET_VIEW_ASPECT = 1.5;

/**
 * 「ソケット拡大」が収める盤の矩形（盤モデル mm）。§12.2
 *
 * ソケット8個の本体に加え、**その手前のランプ用／押ボタン用端子台まで**を含める。
 * 配線はソケットと端子台のあいだを往復するので、寄ったときに端子台が切れていると
 * 「どこへ繋ぐか」が見えず拡大の意味が無い（レビュー指摘: S1/S8 と端子台が画面外）。
 * 数値は盤定義（`sockets` と `footprints`）から求めるのでハードコードしない。
 */
export const SOCKET_VIEW_RECT = ((): { x: number; y: number; w: number; h: number } => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const socket of JIPM_BOARD.sockets) {
    xs.push(socket.origin.x, socket.origin.x + socket.bodyMm.width);
    ys.push(socket.origin.y, socket.origin.y + socket.bodyMm.length);
  }
  for (const footprint of JIPM_BOARD.footprints) {
    if (footprint.kind !== 'block') continue;
    xs.push(footprint.x, footprint.x + footprint.w);
    ys.push(footprint.y, footprint.y + footprint.h);
  }
  if (xs.length === 0 || ys.length === 0) {
    return { x: 0, y: 0, w: BOARD_WIDTH_MM, h: BOARD_HEIGHT_MM };
  }
  const x = Math.min(...xs) - SOCKET_VIEW_MARGIN_MM;
  const y = Math.min(...ys) - SOCKET_VIEW_MARGIN_MM;
  return {
    x,
    y,
    w: Math.max(...xs) + SOCKET_VIEW_MARGIN_MM - x,
    h: Math.max(...ys) + SOCKET_VIEW_MARGIN_MM - y,
  };
})();

/** 視野角の半分の tan（画角計算の共通項）。 */
const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEG / 2) * (Math.PI / 180));

/** 幅 `widthMm` × 高さ `heightMm` の矩形が視野 38° に収まる面直距離[mm]。 */
export function fitDistanceMm(widthMm: number, heightMm: number, aspect: number): number {
  return Math.max(widthMm / 2 / (HALF_FOV_TAN * aspect), heightMm / 2 / HALF_FOV_TAN);
}

/**
 * 盤グループの X 軸回転量[rad]。
 * 盤面ローカル（+Z が盤面の法線、+Y が盤の奥方向）を机の上に寝かせ、
 * 筐体の傾斜角ぶんだけ手前を下げる。`-90°` で完全に水平、`slopeDeg` ぶん戻して傾斜コンソールにする。
 *
 * 「+Y が奥」の根拠: この関数や `boardToWorld` 全般が受け取るのは `toScene()` の結果空間で、
 * `toScene()` は盤モデルの y（0 = 奥のソケット側、BOARD_HEIGHT_MM = 手前の PL/PB 側）を
 * `-(v.y - BOARD_HEIGHT_MM / 2)` で反転する。したがってこの空間の +Y は盤モデルの y が
 * 小さくなる向き＝奥へ向かう（盤モデルの y 自体は手前が大きい）。
 * `scene.test.ts`「盤の奥（盤ローカル +Y）は画面の奥へ倒れる」で検証している。
 */
export const BOARD_TILT_RAD = -(Math.PI / 2 - (JIPM_BOARD.console.slopeDeg * Math.PI) / 180);

/** 盤ローカル座標（`toScene()` の結果）→ ワールド座標。盤グループと同じ回転を掛ける。 */
export function boardToWorld(
  [x, y, z]: readonly [number, number, number],
  tiltRad: number = BOARD_TILT_RAD,
): [number, number, number] {
  const cos = Math.cos(tiltRad);
  const sin = Math.sin(tiltRad);
  return [x, y * cos - z * sin, y * sin + z * cos];
}

/** カメラ位置・注視点・上方向（すべてワールド座標）。 */
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

/** 盤面の「上」方向（盤ローカルの +Y を回した向き）。面直視のときのカメラ上方向。 */
export function boardUp(): [number, number, number] {
  return boardToWorld([0, 1, 0]);
}

/**
 * プリセット → 視点。§12.2
 * - `front`（正面）: 盤面の法線方向から見る。面直なので端子が重ならずいちばん操作しやすい
 * - `top`（俯瞰）: 実物写真と同じ左手前・上からの斜め俯瞰。盤の立体感を見せる
 * - `socket`（ソケット拡大）: 面直のままソケット段へ寄る
 * - `back`（後）: 盤の裏側から。盤面の裏（板の背面）を見る
 * - `left` / `right`（左・右）: 盤の側面から。傾斜角と機器の高さが分かる
 * - `bottom`（下）: 盤を下から見上げる。ただし `MAX_POLAR_ANGLE` より下へは回り込めないので
 *   「許される範囲でいちばん低い位置から見上げる」視点になる（2026-09-14 の利用者要望の注記）
 */
export function cameraPose(preset: CameraPreset): CameraPose {
  const w = BOARD_WIDTH_MM;
  const h = BOARD_HEIGHT_MM;
  // 視野角38°・横基準。盤の幅330mmが収まるには距離 ≥ 165/(tan(19°)×aspect) 必要で、
  // 16:10 のビューポート（aspect 1.6）なら 305mm。1割の余白を足した w × 1.05 を面直視の距離にする。
  const faceDistance = Math.max(w * 1.05, h * 1.55);
  switch (preset) {
    case 'front':
      return {
        position: boardToWorld([0, 0, faceDistance]),
        target: boardToWorld([0, 0, 0]),
        up: boardUp(),
      };
    case 'back':
      return {
        position: boardToWorld([0, 0, -faceDistance]),
        target: boardToWorld([0, 0, 0]),
        up: boardUp(),
      };
    case 'right':
      return { position: [faceDistance, 0, 0], target: [0, 0, 0], up: boardUp() };
    case 'left':
      return { position: [-faceDistance, 0, 0], target: [0, 0, 0], up: boardUp() };
    case 'bottom':
      // 極角の上限ちょうど（＝許される範囲でいちばん低い位置）に置く。これより下は
      // `OrbitControls` が `update()` で引き戻すので、視点が落ち着かない。§12.2
      return {
        position: [
          0,
          faceDistance * Math.cos(MAX_POLAR_ANGLE),
          faceDistance * Math.sin(MAX_POLAR_ANGLE),
        ],
        target: [0, 0, 0],
        up: [0, 1, 0],
      };
    case 'top':
      return {
        position: [-w * 0.62, h * 1.1, h * 1.05],
        target: [0, 0, -h * 0.02],
        up: [0, 1, 0],
      };
    case 'socket': {
      // ソケット段＋端子台の外接矩形がちょうど収まる距離まで寄る（固定倍率で寄せない）
      const rect = SOCKET_VIEW_RECT;
      const distance = fitDistanceMm(rect.w, rect.h, SOCKET_VIEW_ASPECT);
      const center: [number, number, number] = [
        rect.x + rect.w / 2 - w / 2,
        h / 2 - (rect.y + rect.h / 2),
        0,
      ];
      return {
        position: boardToWorld([center[0], center[1], distance]),
        target: boardToWorld(center),
        up: boardUp(),
      };
    }
  }
}

/** `t`∈[0,1] を ease-out（3次）に変換する。速く動き出し、減速しながら止まる。 */
function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** 3要素タプルの線形補間。 */
function lerp3(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/**
 * 2つの視点を ease-out で補間する純粋関数。§12.2「視点プリセットとギズモのスナップは
 * 同じ短い補間で遷移」。`t = 0` で `from` に、`t = 1` で `to` に一致し、その間は各成分が
 * 単調に変化する（イージングは内部で完結するので、呼び出し側は経過時間から求めた
 * 線形の `t`（0→1）を渡すだけでよい）。`CameraPresets` が `useFrame` から毎フレーム呼ぶ。
 */
export function interpolatePose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const eased = easeOutCubic(t);
  return {
    position: lerp3(from.position, to.position, eased),
    target: lerp3(from.target, to.target, eased),
    up: lerp3(from.up, to.up, eased),
  };
}
