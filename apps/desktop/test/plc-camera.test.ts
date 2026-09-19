import {
  BOARD_HEIGHT_MM,
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
 * （盤面延長の PLC が画角の外に落ちる）を隠していた（レビュー指摘）。モードDの3Dペインは
 * `PLC_VIEW_ASPECT` の箱（バッチEからは中身と同じ横長の 2）なので、その比のボックスで検査する。
 * 420×210px はいちばん狭い 1280×800 のときの実寸そのもの。
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

  it('widens the rect so a rack fits, with the outline strictly inside it', () => {
    const rack = plcViewRect(PLC_UNIT_PC10G);
    expect(rack.w).toBeGreaterThanOrEqual(PLC_VIEW_RECT.w);
    expect(rack.h).toBeGreaterThanOrEqual(PLC_VIEW_RECT.h);
    /*
     * 「辺がぴったり重なる」では余白ゼロで、画面の端に張り付いた時点で合格になってしまう
     * （レビュー M9）。ラックの外形は矩形の**内側**にあることを厳密（`>` / `<`）に見る。
     */
    for (const unit of [PLC_UNIT_PC10G, PLC_UNIT_JW300]) {
      const rect = plcViewRect(unit);
      expect(rect.x, unit.model).toBeLessThan(unit.pos.x);
      expect(rect.y, unit.model).toBeLessThan(unit.pos.y);
      expect(rect.x + rect.w, unit.model).toBeGreaterThan(unit.pos.x + unit.sizeMm.width);
      expect(rect.y + rect.h, unit.model).toBeGreaterThan(unit.pos.y + unit.sizeMm.height);
    }
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

/**
 * モードDの3Dペインの**実測**寸法で画角を検算する（UI監査バッチE）。
 *
 * `screens.module.css` の `.plcLayout`: 幅 ＝ `max(420px, min(32vw, ...))`、
 * 高さ ＝ 幅 ÷ `--plc-aspect`（＝ `PLC_VIEW_ASPECT`）。
 * バッチEまでは高さを `max-height` だけで与えていたため `align-self: center` と組み合わさって
 * ペインが中身なり（実測 150px）まで潰れ、盤がほとんど描かれず名札だけが浮いていた。
 * ここでは**3つの画面サイズの実寸**で、盤の四隅・PLC本体の四隅・壁コンセントが
 * ペインの内側に 8px 以上の余白を持って収まることを、E2E と同じ射影で確かめる。
 */
describe('モードDの3Dペインに盤・PLC本体・壁コンセントが収まる（UI監査バッチE）', () => {
  /** 画面の端からこれ以上内側に居ること[px]（デザイン規則の 8px 格子）。 */
  const MARGIN_PX = 8;

  /** `--plc-board-w` と同じ式（`ladder-layout.test.tsx` の `boardWidth()` と揃える）。 */
  function paneWidth(vw: number, vh: number): number {
    return Math.max(420, Math.min(0.32 * vw, PLC_VIEW_ASPECT * (vh - 96)));
  }

  /** 3つの画面サイズでの3Dペイン（幅 ＝ CSS の式、高さ ＝ 幅 ÷ 比）。 */
  const PANES = (
    [
      [1280, 800],
      [1440, 900],
      [1920, 1080],
    ] as const
  ).map(([vw, vh]) => {
    const width = paneWidth(vw, vh);
    return { name: `${String(vw)}x${String(vh)}`, width, height: width / PLC_VIEW_ASPECT };
  });

  it('keeps the board, the unit and the outlet inside every measured pane', () => {
    let checked = 0;
    for (const pane of PANES) {
      const box = { x: 0, y: 0, width: pane.width, height: pane.height };
      for (const unit of Object.values(PLC_UNITS)) {
        const pose = cameraPose('plc', { plcUnit: unit, aspect: pane.width / pane.height });
        const points = [
          // 盤の四隅
          { x: 0, y: 0, z: 0 },
          { x: BOARD_WIDTH_MM, y: 0, z: 0 },
          { x: 0, y: BOARD_HEIGHT_MM, z: 0 },
          { x: BOARD_WIDTH_MM, y: BOARD_HEIGHT_MM, z: 0 },
          // 机上のPLC本体の四隅
          { x: unit.pos.x, y: unit.pos.y, z: 0 },
          { x: unit.pos.x + unit.sizeMm.width, y: unit.pos.y, z: 0 },
          { x: unit.pos.x, y: unit.pos.y + unit.sizeMm.height, z: 0 },
          {
            x: unit.pos.x + unit.sizeMm.width,
            y: unit.pos.y + unit.sizeMm.height,
            z: 0,
          },
          // 壁コンセント
          { x: OUTLET_ORIGIN_MM.x, y: OUTLET_ORIGIN_MM.y, z: 0 },
        ];
        for (const point of points) {
          const at = projectToScreen(boardToWorld(toScene(point)), pose, box);
          const where = `${pane.name} / ${unit.model}`;
          expect(at.x, where).toBeGreaterThanOrEqual(MARGIN_PX);
          expect(at.x, where).toBeLessThanOrEqual(pane.width - MARGIN_PX);
          expect(at.y, where).toBeGreaterThanOrEqual(MARGIN_PX);
          expect(at.y, where).toBeLessThanOrEqual(pane.height - MARGIN_PX);
          checked += 1;
        }
      }
    }
    // ループの空振りで緑にならないように
    expect(checked).toBeGreaterThanOrEqual(3 * 4 * 9);
  });

  it('fills the pane: the board is not a speck in a black field', () => {
    for (const pane of PANES) {
      const box = { x: 0, y: 0, width: pane.width, height: pane.height };
      const pose = cameraPose('plc', { aspect: pane.width / pane.height });
      const project = (x: number, y: number): { x: number; y: number } =>
        projectToScreen(boardToWorld(toScene({ x, y, z: 0 })), pose, box);
      const left = project(0, BOARD_HEIGHT_MM / 2).x;
      const right = project(BOARD_WIDTH_MM, BOARD_HEIGHT_MM / 2).x;
      const top = project(BOARD_WIDTH_MM / 2, 0).y;
      const bottom = project(BOARD_WIDTH_MM / 2, BOARD_HEIGHT_MM).y;
      // 盤だけで横は4割以上・縦は7割以上を占める（残りは机上のPLCと壁コンセント）
      expect((right - left) / pane.width, pane.name).toBeGreaterThan(0.4);
      expect((bottom - top) / pane.height, pane.name).toBeGreaterThan(0.7);
    }
  });
});
