import {
  JIPM_BOARD,
  PLC_LED_OFF,
  PLC_UNIT_CP1E,
  PLC_UNIT_FX5U,
  PLC_UNIT_JW300,
  PLC_UNIT_PC10G,
  withPlcUnit,
  type BoardTerminal,
  type PlcAppearance,
  type PlcCoverMark,
  type Vec3,
} from '@ojt/board-model';
import { parseTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  coverOpenPose,
  coverOpenTip,
  COVER_OPEN_RAD,
  faceRectToBoard,
  litLedKeys,
  PLC_BODY_Z_MM,
  type PlcLedState,
} from '../src/renderer/three/appearance.js';
import {
  blockTerminalMark,
  plateLuminance,
  roleColorsFor,
  SOCKET_ROLE_COLOR,
} from '../src/renderer/three/labels.js';

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

describe('端子カバーは開いた状態で描く（決定表#16 / 4B レビュー I2）', () => {
  const origin = { x: 100, y: 200, z: 0 };
  /** 試験用のカバー（同じ矩形のまま蝶番の辺だけ替える）。 */
  function coverAt(hinge: PlcCoverMark['hinge']): PlcCoverMark {
    return { id: `cover-${hinge}`, rect: { x: 10, y: 20, w: 40, h: 30 }, color: '#CCCCCC', hinge };
  }

  it('turns the plate about the hinge edge the model names', () => {
    const top = coverOpenPose(origin, coverAt('top'));
    expect(top.hinge).toEqual({ x: 130, y: 220, z: 0 });
    expect(top.rotation).toEqual([-COVER_OPEN_RAD, 0, 0]);
    expect(top.offset).toEqual([0, -15, 0]);
    const bottom = coverOpenPose(origin, coverAt('bottom'));
    expect(bottom.hinge).toEqual({ x: 130, y: 250, z: 0 });
    expect(bottom.rotation).toEqual([COVER_OPEN_RAD, 0, 0]);
    expect(bottom.offset).toEqual([0, 15, 0]);
    const left = coverOpenPose(origin, coverAt('left'));
    expect(left.hinge).toEqual({ x: 110, y: 235, z: 0 });
    expect(left.rotation).toEqual([0, -COVER_OPEN_RAD, 0]);
    expect(left.offset).toEqual([20, 0, 0]);
    const right = coverOpenPose(origin, coverAt('right'));
    expect(right.hinge).toEqual({ x: 150, y: 235, z: 0 });
    expect(right.rotation).toEqual([0, COVER_OPEN_RAD, 0]);
    expect(right.offset).toEqual([-20, 0, 0]);
    // ラックのベースだけ前面が奥にあるので、蝶番もそこに乗る
    expect(coverOpenPose(origin, coverAt('top'), -4).hinge.z).toBe(-4);
  });

  it('swings the free edge out of the face — up for a top hinge, down for a bottom one', () => {
    const top = coverOpenTip(coverOpenPose(origin, coverAt('top')));
    expect(top.z).toBeCloseTo(30 * Math.sin(COVER_OPEN_RAD), 6);
    expect(top.z).toBeGreaterThan(20);
    expect(top.y).toBeLessThan(220);
    const bottom = coverOpenTip(coverOpenPose(origin, coverAt('bottom')));
    expect(bottom.z).toBeCloseTo(30 * Math.sin(COVER_OPEN_RAD), 6);
    expect(bottom.y).toBeGreaterThan(250);
    const left = coverOpenTip(coverOpenPose(origin, coverAt('left')));
    expect(left.z).toBeCloseTo(40 * Math.sin(COVER_OPEN_RAD), 6);
    expect(left.x).toBeLessThan(110);
    const right = coverOpenTip(coverOpenPose(origin, coverAt('right')));
    expect(right.x).toBeGreaterThan(150);
  });

  it('never sweeps over a terminal row, the nameplate or the desk cable entry', () => {
    interface DrawnFace {
      name: string;
      origin: Vec3;
      appearance: PlcAppearance;
      terminals: readonly BoardTerminal[];
    }
    const faces: DrawnFace[] = [PLC_UNIT_FX5U, PLC_UNIT_CP1E].map((unit) => ({
      name: unit.model,
      origin: unit.pos,
      appearance: unit.appearance,
      terminals: unit.terminals,
    }));
    for (const unit of [PLC_UNIT_PC10G, PLC_UNIT_JW300]) {
      for (const module of unit.modules ?? []) {
        faces.push({
          name: `${unit.model}/${module.model}`,
          origin: module.pos,
          appearance: module.appearance,
          terminals: unit.terminals,
        });
      }
    }
    for (const face of faces) {
      const plate = face.appearance.nameplateRect;
      for (const cover of face.appearance.covers) {
        const pose = coverOpenPose(face.origin, cover);
        const tip = coverOpenTip(pose);
        const from = Math.min(pose.hinge.y, tip.y);
        const to = Math.max(pose.hinge.y, tip.y);
        // 開いた板が通る帯（盤モデルの y）に端子は1つも入らない
        for (const terminal of face.terminals) {
          const clear = terminal.pos.y < from || terminal.pos.y > to;
          expect(clear, `${face.name} ${cover.id} ${String(terminal.id)}`).toBe(true);
        }
        // 銘板も隠さない
        const plateFrom = face.origin.y + plate.y;
        const plateTo = plateFrom + plate.h;
        expect(plateFrom > to || plateTo < from, `${face.name} ${cover.id} nameplate`).toBe(true);
        // 面から出ない板は描かない（カバーは必ず前へ出る）
        expect(tip.z).toBeGreaterThan(0);
      }
    }
  });
});

describe('印字の色は背板の明るさで選ぶ（4B レビュー B1）', () => {
  it('reads a dark terminal block as needing the light ink', () => {
    for (const unit of [PLC_UNIT_FX5U, PLC_UNIT_CP1E, PLC_UNIT_PC10G, PLC_UNIT_JW300]) {
      expect(roleColorsFor(unit.appearance.terminalBlockColor), unit.model).toBe(SOCKET_ROLE_COLOR);
    }
  });

  it('keeps the dark ink for the light plate of the board terminal block', () => {
    expect(plateLuminance('#F1EFE9')).toBeGreaterThan(plateLuminance('#22262B'));
    const light = roleColorsFor('#F1EFE9');
    expect(light).not.toBe(SOCKET_ROLE_COLOR);
    expect(light.com).toBe('#1B1E23');
    expect(light['coil+']).toBe('#D14343');
  });
});

describe('消灯色は board-model が持つ（4B レビュー M7）', () => {
  it('exports PLC_LED_OFF next to the lit colours', () => {
    expect(PLC_LED_OFF).toMatch(/^#[0-9A-Fa-f]{6}$/);
    for (const led of PLC_UNIT_FX5U.appearance.leds) expect(led.color).not.toBe(PLC_LED_OFF);
  });
});
