import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  JIPM_BOARD,
  MOUNTED_PART_HEIGHT_MM,
  PLC_UNITS,
  SOCKET_STEP_HEIGHTS_MM,
} from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { projectToScreen, type CanvasBox } from '../e2e/projection.js';
import type { CameraPreset } from '../src/renderer/app/store-types.js';
import {
  boardToWorld,
  CAMERA_FOV_DEG,
  cameraPose,
  gizmoReservePx,
  MAX_CAMERA_DISTANCE_MM,
  MIN_CAMERA_DISTANCE_MM,
  plcViewRect,
  SOCKET_VIEW_RECT,
} from '../src/renderer/three/camera.js';
import { toScene } from '../src/renderer/three/coords.js';
import { gizmoLayoutForViewport } from '../src/renderer/three/view-gizmo-layout.js';

/**
 * カメラはビューキューブ（左上）を避けて中身を収める（v2.1.0 点検 U1・U4・U10）。
 *
 * 点検（`OJT/release/verification/audit-2026-10-16`）では、盤の視点でキューブの下地の丸と
 * ⌂・⟳ のボタンが DC24V 電源の P/N 端子と S1 ソケットに重なり、ソケット拡大では S1・S2 が
 * キューブの下に隠れていた。ここでは盤ペインの実寸（3サイズの窓の内側）と各プリセットについて、
 * 中身の箱（部品の天面まで）の8隅を射影した外接矩形が、キューブの正方形と交わらず、
 * ペインの内側に収まることを確かめる。
 */

const PART_TOP_MM = SOCKET_STEP_HEIGHTS_MM[2] + MOUNTED_PART_HEIGHT_MM;

type Rect = { x: number; y: number; w: number; h: number };

/** 盤モデルの矩形の4隅（高さ `z`）。 */
function rectCorners(rect: Rect, z: number): Array<{ x: number; y: number; z: number }> {
  return [
    { x: rect.x, y: rect.y, z },
    { x: rect.x + rect.w, y: rect.y, z },
    { x: rect.x, y: rect.y + rect.h, z },
    { x: rect.x + rect.w, y: rect.y + rect.h, z },
  ];
}

/** 盤面の矩形と、ソケット（部品の天面まで）の範囲。 */
function corners(rect: Rect): Array<{ x: number; y: number; z: number }> {
  const xs = JIPM_BOARD.sockets.flatMap((s) => [s.origin.x, s.origin.x + s.bodyMm.width]);
  const ys = JIPM_BOARD.sockets.flatMap((s) => [s.origin.y, s.origin.y + s.bodyMm.length]);
  const tall = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  return [...rectCorners(rect, 0), ...rectCorners(tall, PART_TOP_MM)];
}

const BOARD_RECT = { x: 0, y: 0, w: BOARD_WIDTH_MM, h: BOARD_HEIGHT_MM };

/** 窓の内側 1264×761・1424×861・1904×1041 での盤ペインの実測に近い大きさ。 */
const BOARD_PANES: readonly CanvasBox[] = [
  { x: 0, y: 0, width: 884, height: 486 },
  { x: 0, y: 0, width: 1046, height: 574 },
  { x: 0, y: 0, width: 1590, height: 770 },
  // モードB「並べて」（1920 幅で3D・エディタが左右）
  { x: 0, y: 0, width: 790, height: 700 },
];

function contentOf(preset: CameraPreset): Array<{ x: number; y: number; z: number }> {
  if (preset === 'socket') return corners(SOCKET_VIEW_RECT);
  return corners(BOARD_RECT);
}

describe('視野角と寄れる距離（v2.1.0 点検 U4）', () => {
  it('視野角は 24°。寄せ切ったとき・離し切ったときに見える幅は以前（38°・90〜1200mm）と同じ', () => {
    expect(CAMERA_FOV_DEG).toBe(24);
    const width = (fovDeg: number, distance: number): number =>
      2 * distance * Math.tan((fovDeg / 2) * (Math.PI / 180));
    expect(width(24, MIN_CAMERA_DISTANCE_MM)).toBeCloseTo(width(38, 90), -1);
    expect(width(24, MAX_CAMERA_DISTANCE_MM)).toBeCloseTo(width(38, 1200), -2);
  });
});

describe('ビューキューブを避けて中身を収める（v2.1.0 点検 U1）', () => {
  for (const pane of BOARD_PANES) {
    for (const preset of ['front', 'socket', 'top'] as const) {
      it(`${String(pane.width)}×${String(pane.height)} / ${preset}`, () => {
        const reserve = gizmoReservePx({ width: pane.width, height: pane.height });
        expect(reserve, 'この大きさならキューブは出る').toBeGreaterThan(0);
        const pose = cameraPose(preset, {
          aspect: pane.width / pane.height,
          viewportPx: { width: pane.width, height: pane.height },
        });
        const points = contentOf(preset).map((point) =>
          projectToScreen(boardToWorld(toScene(point)), pose, pane),
        );
        const left = Math.min(...points.map((p) => p.x));
        const right = Math.max(...points.map((p) => p.x));
        const top = Math.min(...points.map((p) => p.y));
        const bottom = Math.max(...points.map((p) => p.y));
        // ペインの内側に収まる
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(right).toBeLessThanOrEqual(pane.width);
        expect(bottom).toBeLessThanOrEqual(pane.height);
        // キューブの正方形（左上の角から reserve px）と交わらない
        const clear = left >= reserve || top >= reserve;
        expect(
          clear,
          `left ${left.toFixed(1)} / top ${top.toFixed(1)} / reserve ${String(reserve)}`,
        ).toBe(true);
      });
    }
  }

  it('PLC の視点（盤ペイン）でも、4社の机上の本体・壁コンセントまで含めてキューブを避ける', () => {
    const pane: CanvasBox = { x: 0, y: 0, width: 1590, height: 770 };
    for (const unit of Object.values(PLC_UNITS)) {
      const pose = cameraPose('plc', {
        plcUnit: unit,
        aspect: pane.width / pane.height,
        viewportPx: { width: pane.width, height: pane.height },
      });
      const reserve = gizmoReservePx({ width: pane.width, height: pane.height });
      const points = corners(plcViewRect(unit)).map((point) =>
        projectToScreen(boardToWorld(toScene(point)), pose, pane),
      );
      const left = Math.min(...points.map((p) => p.x));
      const top = Math.min(...points.map((p) => p.y));
      expect(left >= reserve || top >= reserve, unit.model).toBe(true);
      expect(Math.max(...points.map((p) => p.x)), unit.model).toBeLessThanOrEqual(pane.width);
      expect(Math.max(...points.map((p) => p.y)), unit.model).toBeLessThanOrEqual(pane.height);
    }
  });

  it('キューブが出ない低いペイン（PLC分割の 614×307px）では避けずに、いままでどおり収める', () => {
    expect(gizmoLayoutForViewport(614, 307)).toBeNull();
    expect(gizmoReservePx({ width: 614, height: 307 })).toBe(0);
    const withViewport = cameraPose('plc', {
      aspect: 2,
      viewportPx: { width: 614, height: 307 },
    });
    expect(withViewport).toEqual(cameraPose('plc', { aspect: 2 }));
  });
});
