import {
  BOARD_WIDTH_MM,
  JIPM_BOARD,
  OUTLET_ORIGIN_MM,
  PLC_UNIT_FX5U,
  PLC_UNIT_JW300,
  PLC_UNIT_PC10G,
  PLC_UNITS,
  withPlcUnit,
} from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  boardToWorld,
  cameraPose,
  fitDistanceMm,
  MAX_CAMERA_DISTANCE_MM,
  MIN_CAMERA_DISTANCE_MM,
  PLC_VIEW_ASPECT,
  PLC_VIEW_RECT,
  plcViewRect,
  SOCKET_VIEW_RECT,
} from '../src/renderer/three/camera.js';
import { projectToScreen } from '../e2e/projection.js';
import { toScene } from '../src/renderer/three/coords.js';

/**
 * 「盤＋PLC」視点プリセットのテスト（設計仕様 §10.1 / §12.2 / 決定表#6）。
 * モードDの配線は「盤の端子 ⇄ 机上のPLCの端子」を往復するので、**両端が同じ画角に入っている**
 * ことが操作の前提になる。ここではそれを射影計算（E2E と同じ `projectToScreen`）で確かめる。
 */

/*
 * `900×600`（aspect 1.5）は分割画面の3Dペインの実際の形を再現しておらず、I2 のバグ
 * （盤面延長の PLC が画角の外に落ちる）を隠していた（レビュー指摘）。分割画面の右ペイン
 * は `PLC_VIEW_ASPECT`（0.6）ぶんだけ縦長になるので、ここでもその比のボックスで検査する。
 */
const BOX = { x: 0, y: 0, width: 420, height: 420 / PLC_VIEW_ASPECT };

describe('plc 視点プリセット（§12.2 / 決定表#6）', () => {
  it('covers the board, the PLC unit and the wall outlet', () => {
    expect(PLC_VIEW_RECT.x).toBeLessThanOrEqual(0);
    expect(PLC_VIEW_RECT.x + PLC_VIEW_RECT.w).toBeGreaterThanOrEqual(
      PLC_UNIT_FX5U.pos.x + PLC_UNIT_FX5U.sizeMm.width,
    );
    expect(PLC_VIEW_RECT.y).toBeLessThanOrEqual(0);
    expect(PLC_VIEW_RECT.y + PLC_VIEW_RECT.h).toBeGreaterThanOrEqual(OUTLET_ORIGIN_MM.y);
  });

  it('stays inside the distance limits', () => {
    const pose = cameraPose('plc');
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    expect(distance).toBeGreaterThanOrEqual(MIN_CAMERA_DISTANCE_MM);
    expect(distance).toBeLessThanOrEqual(MAX_CAMERA_DISTANCE_MM);
    expect(distance).toBeCloseTo(
      fitDistanceMm(PLC_VIEW_RECT.w, PLC_VIEW_RECT.h, PLC_VIEW_ASPECT),
      3,
    );
  });

  it('puts every terminal — board and desk — inside the viewport', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const pose = cameraPose('plc');
    const offBoard = board.terminals.filter(
      (t) => t.id.startsWith('PLC.') || t.id.startsWith('OUTLET.'),
    );
    expect(offBoard.length).toBeGreaterThan(30);
    for (const terminal of board.terminals) {
      const point = projectToScreen(boardToWorld(toScene(terminal.pos)), pose, BOX);
      expect(point.x).toBeGreaterThan(BOX.x);
      expect(point.x).toBeLessThan(BOX.x + BOX.width);
      expect(point.y).toBeGreaterThan(BOX.y);
      expect(point.y).toBeLessThan(BOX.y + BOX.height);
    }
  });

  it('does not change the other presets', () => {
    expect(cameraPose('front').position[2]).toBeGreaterThan(0);
    /*
     * `socket` は今までどおり「ソケット段＋端子台の外接矩形の中心」を見る。
     * （プラン本文は `target[0] < 0` と書いていたが、`SOCKET_VIEW_RECT` の中心は盤の中心の
     *   わずかに右（+2.5mm）なので、矩形から導いた値そのものと突き合わせる。）
     */
    expect(cameraPose('socket').target[0]).toBeCloseTo(
      SOCKET_VIEW_RECT.x + SOCKET_VIEW_RECT.w / 2 - BOARD_WIDTH_MM / 2,
      6,
    );
    expect(cameraPose('socket').target).not.toEqual(cameraPose('plc').target);
  });
});

describe('機種ごとの「盤＋PLC」視点（決定表#18）', () => {
  it('keeps the FX5U rect as the default', () => {
    expect(plcViewRect(PLC_UNIT_FX5U)).toEqual(PLC_VIEW_RECT);
    expect(cameraPose('plc')).toEqual(cameraPose('plc', { plcUnit: PLC_UNIT_FX5U }));
  });

  it('widens the rect so a rack fits', () => {
    const rack = plcViewRect(PLC_UNIT_PC10G);
    expect(rack.w).toBeGreaterThanOrEqual(PLC_VIEW_RECT.w);
    expect(rack.h).toBeGreaterThanOrEqual(PLC_VIEW_RECT.h);
    // ラックの下端まで入る
    expect(rack.y + rack.h).toBeGreaterThanOrEqual(
      PLC_UNIT_PC10G.pos.y + PLC_UNIT_PC10G.sizeMm.height,
    );
  });

  it('stays inside the orbit distance limits for every model', () => {
    for (const unit of Object.values(PLC_UNITS)) {
      const rect = plcViewRect(unit);
      const distance = fitDistanceMm(rect.w, rect.h, PLC_VIEW_ASPECT);
      expect(distance, unit.model).toBeLessThanOrEqual(MAX_CAMERA_DISTANCE_MM);
      expect(distance, unit.model).toBeGreaterThanOrEqual(MIN_CAMERA_DISTANCE_MM);
    }
  });

  it('moves the target when the model changes', () => {
    expect(cameraPose('plc', { plcUnit: PLC_UNIT_JW300 }).target).not.toEqual(
      cameraPose('plc', { plcUnit: PLC_UNIT_FX5U }).target,
    );
    // 他のプリセットは機種で変わらない
    expect(cameraPose('front', { plcUnit: PLC_UNIT_JW300 })).toEqual(cameraPose('front'));
  });
});
