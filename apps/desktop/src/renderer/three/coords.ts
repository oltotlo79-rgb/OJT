import { BOARD_HEIGHT_MM, BOARD_WIDTH_MM, type Vec3 } from '@ojt/board-model';

/**
 * 盤モデルの座標 → Three.js のシーン座標。設計仕様 §6.5。
 *
 * 盤モデルは「盤の左上手前を原点、x は右、y は下、z は盤面からの高さ」の mm 座標系（§6.5）。
 * シーンでは実物と同じく盤を立てて正面から見るので、XY 平面に置き、盤の中心を原点にする。
 * 単位は mm のまま扱う（カメラの near/far をそれに合わせる）ので、寸法定数を変換なしで使える。
 */

/** 盤モデル座標をシーン座標に直す純粋関数。 */
export function toScene(v: Vec3): [number, number, number] {
  return [v.x - BOARD_WIDTH_MM / 2, -(v.y - BOARD_HEIGHT_MM / 2), v.z];
}

/** x/y/z を個別に渡す版。 */
export function scenePos(x: number, y: number, z: number): [number, number, number] {
  return toScene({ x, y, z });
}
