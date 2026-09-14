import { BOARD_HEIGHT_MM, BOARD_WIDTH_MM, JIPM_BOARD } from '@ojt/board-model';
import type { CameraPreset } from '../app/store-types.js';

/**
 * 盤の傾きと視点プリセットの純粋な計算。設計仕様 §6.5 / §12.2。
 * React も three も使わないので、単体テストからも E2E の射影計算からも読める。
 */

/** カメラの垂直視野角[度]。`BoardScene` の `Canvas` に渡す値。 */
export const CAMERA_FOV_DEG = 38;

/** ソケット段の中心の盤モデル y[mm]。盤定義のソケット原点と本体寸法から求める（ハードコードしない）。 */
export const SOCKET_ROW_CENTER_MM = ((): number => {
  const sockets = JIPM_BOARD.sockets;
  const first = sockets[0];
  if (first === undefined) return BOARD_HEIGHT_MM / 2;
  const top = Math.min(...sockets.map((socket) => socket.origin.y));
  return top + first.bodyMm.length / 2;
})();

/**
 * 盤グループの X 軸回転量[rad]。
 * 盤面ローカル（+Z が盤面の法線、+Y が盤の手前方向）を机の上に寝かせ、
 * 筐体の傾斜角ぶんだけ手前を下げる。`-90°` で完全に水平、`slopeDeg` ぶん戻して傾斜コンソールにする。
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
 */
export function cameraPose(preset: CameraPreset): CameraPose {
  const w = BOARD_WIDTH_MM;
  const h = BOARD_HEIGHT_MM;
  // 視野角38°・横基準。盤の幅330mmが収まるには距離 ≥ 165/(tan(19°)×aspect) 必要で、
  // 16:10 のビューポート（aspect 1.6）なら 305mm。1割の余白を足した w × 1.05 を面直視の距離にする。
  const faceDistance = Math.max(w * 1.05, h * 1.55);
  const socketY = h / 2 - SOCKET_ROW_CENTER_MM;
  switch (preset) {
    case 'front':
      return {
        position: boardToWorld([0, 0, faceDistance]),
        target: boardToWorld([0, 0, 0]),
        up: boardUp(),
      };
    case 'top':
      return {
        position: [-w * 0.62, h * 1.1, h * 1.05],
        target: [0, 0, -h * 0.02],
        up: [0, 1, 0],
      };
    case 'socket':
      return {
        position: boardToWorld([0, socketY, faceDistance * 0.5]),
        target: boardToWorld([0, socketY, 0]),
        up: boardUp(),
      };
  }
}
