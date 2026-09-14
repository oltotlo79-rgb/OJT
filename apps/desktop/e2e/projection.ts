import { boardTerminalPos, JIPM_BOARD } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  boardToWorld,
  CAMERA_FOV_DEG,
  cameraPose,
  type CameraPose,
} from '../src/renderer/three/camera.js';
import { toScene } from '../src/renderer/three/coords.js';

/**
 * 3D盤の端子をピクセル座標へ射影する（E2E用）。設計仕様 §12.2 / §14.2。
 * アプリ側の視点プリセット（`cameraPose`）と盤の傾き（`boardToWorld`）をそのまま参照するので、
 * カメラ設定や筐体の傾斜角を変えてもテストが追随する。
 */

/** キャンバスの矩形（Playwright の `boundingBox()` の戻り）。 */
export interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Vec = readonly [number, number, number];

function sub(a: Vec, b: Vec): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec, b: Vec): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

/** ワールド座標 → ページ座標（透視投影。カメラは -Z を向く three の規約に合わせる）。 */
export function projectToScreen(
  world: Vec,
  pose: CameraPose,
  box: CanvasBox,
): { x: number; y: number } {
  const forward = normalize(sub(pose.target, pose.position));
  const right = normalize(cross(forward, pose.up));
  const up = cross(right, forward);
  const relative = sub(world, pose.position);
  const depth = dot(relative, forward);
  const halfHeight = Math.tan((CAMERA_FOV_DEG / 2) * (Math.PI / 180));
  const halfWidth = halfHeight * (box.width / box.height);
  const ndcX = dot(relative, right) / (depth * halfWidth);
  const ndcY = dot(relative, up) / (depth * halfHeight);
  return {
    x: box.x + ((ndcX + 1) / 2) * box.width,
    y: box.y + ((1 - ndcY) / 2) * box.height,
  };
}

/** 盤の**物理**端子IDの中心が来るページ座標（正面視プリセット前提）。 */
export function terminalPoint(terminal: TerminalId, box: CanvasBox): { x: number; y: number } {
  const world = boardToWorld(toScene(boardTerminalPos(JIPM_BOARD, terminal)));
  return projectToScreen(world, cameraPose('front'), box);
}

/** 盤ローカル座標（mm）を指定してページ座標を得る（ソケット台座の縁など）。 */
export function boardPoint(
  point: { x: number; y: number; z: number },
  box: CanvasBox,
): { x: number; y: number } {
  return projectToScreen(boardToWorld(toScene(point)), cameraPose('front'), box);
}

/**
 * 内蔵課題 b-001「自己保持回路」の模範配線（9本）。
 * `buildReferenceSession()` が生成する配線と同じ組み合わせを、**物理**端子IDで書き下したもの。
 *
 * P/N 供給端子は `P.1` / `N.1` の各1点しかなく、うち1本はチェック用の固定配線が使うので、
 * 訓練者が母線から直接取れるのは各1本だけ（§6.1）。母線は**渡り配線**で分配する
 * （`P.1 → TB_PB.2c → S1.10`、`N.1 → S1.13 → TB_PL.1-` の鎖）。
 */
export const SELF_HOLD_WIRES: ReadonlyArray<readonly [string, string]> = [
  ['P.1', 'TB_PB.2c'],
  ['TB_PB.2c', 'S1.10'],
  ['TB_PB.2b', 'TB_PB.1c'],
  ['TB_PB.1c', 'S1.9'],
  ['TB_PB.1a', 'S1.14'],
  ['S1.14', 'S1.5'],
  ['N.1', 'S1.13'],
  ['S1.13', 'TB_PL.1-'],
  ['S1.6', 'TB_PL.1+'],
];
