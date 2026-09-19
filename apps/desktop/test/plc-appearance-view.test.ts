import {
  JIPM_BOARD,
  PLC_UNIT_CP1E,
  PLC_UNIT_FX5U,
  PLC_UNIT_JW300,
  withPlcUnit,
} from '@ojt/board-model';
import { parseTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  faceRectToBoard,
  litLedKeys,
  PLC_BODY_Z_MM,
  type PlcLedState,
} from '../src/renderer/three/appearance.js';
import { blockTerminalMark } from '../src/renderer/three/labels.js';

/**
 * 机上のPLC本体の3Dを `PlcAppearance` から描くための純関数（設計仕様 §10.1 / §17.1）。
 * 4B 決定表#15・#20 / 4A H-7・H-8。three を読み込まないので Node でも動く。
 */

const OFF: PlcLedState = {
  running: false,
  convertFailed: false,
  inputs: undefined,
  outputs: undefined,
};

describe('正面座標（左上原点・mm）→ 盤モデル座標（4A Task 9 / 決定表#15）', () => {
  it('puts a face rect at the unit position, measured from its top-left corner', () => {
    const unit = PLC_UNIT_FX5U;
    const rect = { x: 10, y: 20, w: 30, h: 6 };
    const box = faceRectToBoard(unit.pos, rect, 1);
    expect(box.cx).toBe(unit.pos.x + 10 + 15);
    expect(box.cy).toBe(unit.pos.y + 20 + 3);
    expect(box.z).toBe(1);
    expect(box.w).toBe(30);
    expect(box.h).toBe(6);
  });

  it('keeps the body a thin plate under the terminals (Plan 3B 意図的な差分 #1)', () => {
    expect(PLC_BODY_Z_MM).toBeGreaterThan(0);
    expect(PLC_BODY_Z_MM).toBeLessThan(PLC_UNIT_FX5U.sizeMm.depth);
  });
});

describe('LEDが映すもの（決定表#20）', () => {
  it('keeps POWER on and everything else off while the session is idle', () => {
    const lit = litLedKeys(PLC_UNIT_FX5U.appearance, OFF);
    expect(lit.has('status:PWR')).toBe(true);
    expect(lit.has('status:P.RUN')).toBe(false);
    expect(lit.has('status:ERR')).toBe(false);
    expect([...lit].every((key) => key.startsWith('status:'))).toBe(true);
  });

  it('lights RUN while the PLC runs and ERR after a failed convert', () => {
    expect(
      litLedKeys(PLC_UNIT_FX5U.appearance, { ...OFF, running: true }).has('status:P.RUN'),
    ).toBe(true);
    expect(
      litLedKeys(PLC_UNIT_FX5U.appearance, { ...OFF, convertFailed: true }).has('status:ERR'),
    ).toBe(true);
  });

  it('lights the input and output lamps only from a monitor snapshot', () => {
    const lit = litLedKeys(PLC_UNIT_CP1E.appearance, {
      ...OFF,
      inputs: [true, false, true],
      outputs: [false, true],
    });
    const inputs = PLC_UNIT_CP1E.appearance.leds.filter((led) => led.group === 'input');
    const outputs = PLC_UNIT_CP1E.appearance.leds.filter((led) => led.group === 'output');
    expect(lit.has(`input:${inputs[0]?.name ?? ''}`)).toBe(true);
    expect(lit.has(`input:${inputs[1]?.name ?? ''}`)).toBe(false);
    expect(lit.has(`input:${inputs[2]?.name ?? ''}`)).toBe(true);
    expect(lit.has(`output:${outputs[1]?.name ?? ''}`)).toBe(true);
    // 点数より短いスナップショットでも落ちない
    expect(lit.has(`input:${inputs.at(-1)?.name ?? ''}`)).toBe(false);
  });

  it('never reads the AC wiring (決定表#20: 判定結果を漏らさない)', () => {
    // `PlcLedState` に配線の情報が無いことを型で縛る
    const keys = Object.keys(OFF).sort();
    expect(keys).toEqual(['convertFailed', 'inputs', 'outputs', 'running']);
  });
});

describe('外観の記述だけで描けること（決定表#15）', () => {
  it('describes the whole face of every unit it has to draw', () => {
    for (const unit of [PLC_UNIT_FX5U, PLC_UNIT_CP1E]) {
      const face = unit.appearance;
      expect(face.faceMm.width).toBe(unit.sizeMm.width);
      expect(face.faceMm.height).toBe(unit.sizeMm.height);
      // 筐体・端子台・カバー・造作・LED・銘板の色と位置がすべて記述側にある
      expect(face.bodyColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(face.covers.length).toBeGreaterThan(0);
      expect(face.features.length).toBeGreaterThan(0);
      expect(face.leds.length).toBeGreaterThan(0);
      expect(face.nameplate.length).toBeGreaterThan(0);
      for (const led of face.leds) expect(led.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      // 銘板は型式の文字列だけ（ロゴ・ブランド名は描かない。§17）
      expect(face.nameplate).not.toMatch(/三菱|OMRON|オムロン|MELSEC/);
    }
  });

  it('keeps every drawn rect inside the face (面からはみ出さない)', () => {
    for (const unit of [PLC_UNIT_FX5U, PLC_UNIT_CP1E]) {
      const { faceMm, covers, features, leds, nameplateRect } = unit.appearance;
      const rects = [
        ...covers.map((cover) => cover.rect),
        ...features.map((feature) => feature.rect),
        ...leds.map((led) => led.rect),
        nameplateRect,
      ];
      for (const rect of rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(faceMm.width);
        expect(rect.y + rect.h).toBeLessThanOrEqual(faceMm.height);
      }
    }
  });
});

describe('端子名の名札（4A H-8）', () => {
  it('keeps a dotted terminal name whole (受入基準⑤)', () => {
    const comA = withPlcUnit(JIPM_BOARD, PLC_UNIT_JW300).terminals.find(
      (t) => String(t.id) === 'PLC.COM.A',
    );
    expect(blockTerminalMark(comA!)).toBe('COM.A');
    const cp1e = withPlcUnit(JIPM_BOARD, PLC_UNIT_CP1E).terminals.find(
      (t) => String(t.id) === 'PLC.0.00',
    );
    expect(blockTerminalMark(cp1e!)).toBe('0.00');
  });

  it('still names an ordinary board terminal the way Phase 1 did', () => {
    // 盤の端子台（§6.4 の `PL1+` / `PB1a`）と任意部品（`BZ+`）は Phase 1 の印字のまま
    const lamp = JIPM_BOARD.terminals.find((t) => String(t.id) === 'TB_PL.1+');
    expect(blockTerminalMark(lamp!)).toBe('PL1+');
    const button = JIPM_BOARD.terminals.find((t) => String(t.id) === 'TB_PB.1a');
    expect(blockTerminalMark(button!)).toBe('PB1a');
    const buzzer = JIPM_BOARD.terminals.find((t) => String(t.id) === 'BZ.+');
    expect(blockTerminalMark(buzzer!)).toBe(`BZ${parseTerminalId(buzzer!.id).name}`);
  });
});
