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
  blockLabelBox,
  blockMarkFontMm,
  blockTerminalMark,
  plateLuminance,
  roleColorsFor,
  SOCKET_ROLE_COLOR,
  type LabelBox,
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

  it('lays the plate flat outside the face — above for a top hinge, below for a bottom one', () => {
    // 180°まで開いて寝かせる（決定表#16 の改訂 2026-09-26）。板は机上の電線（z ≥ 9.6mm）の
    // 通り道に立たない（2026-09-26 利用者報告「配線がシーケンサを貫通する」）
    expect(COVER_OPEN_RAD).toBeCloseTo(Math.PI, 12);
    const top = coverOpenTip(coverOpenPose(origin, coverAt('top')));
    expect(top.z).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(220 - 30, 6);
    const bottom = coverOpenTip(coverOpenPose(origin, coverAt('bottom')));
    expect(bottom.z).toBeCloseTo(0, 6);
    expect(bottom.y).toBeCloseTo(250 + 30, 6);
    const left = coverOpenTip(coverOpenPose(origin, coverAt('left')));
    expect(left.z).toBeCloseTo(0, 6);
    expect(left.x).toBeCloseTo(110 - 40, 6);
    const right = coverOpenTip(coverOpenPose(origin, coverAt('right')));
    expect(right.x).toBeCloseTo(150 + 40, 6);
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
        // 取り外した状態のカバー（ラックのモジュール）は描かない
        if (cover.open === 'removed') continue;
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
        // 板は面より奥へ沈まない（本体の外に寝る）
        expect(tip.z).toBeGreaterThan(-1e-9);
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

/**
 * 端子名の印字は隣どうしと1mm以上離れていること（項目1: CP1E の出力端子名 `100.00`〜`101.03`
 * が9mmピッチの隣と重なって `COM0100.01…` のように潰れて見えた。今日のスクリーンショット確認 03）。
 */
describe('端子名の印字は隣と重ならない（項目1）', () => {
  /** 2つの矩形の間に `clearanceMm` 以上の隙間があること（どちらか1軸で離れていればよい）。 */
  function hasClearance(a: LabelBox, b: LabelBox, clearanceMm: number): boolean {
    return (
      a.x1 + clearanceMm <= b.x0 ||
      b.x1 + clearanceMm <= a.x0 ||
      a.y1 + clearanceMm <= b.y0 ||
      b.y1 + clearanceMm <= a.y0
    );
  }

  it('never overlaps two name boxes on any of the 4 PLC units (≥1mm clearance)', () => {
    const units = [PLC_UNIT_CP1E, PLC_UNIT_FX5U, PLC_UNIT_PC10G, PLC_UNIT_JW300];
    for (const unit of units) {
      const entries = unit.terminals.map((terminal) => ({
        id: String(terminal.id),
        box: blockLabelBox(terminal),
      }));
      for (let i = 0; i < entries.length; i += 1) {
        for (let j = i + 1; j < entries.length; j += 1) {
          const a = entries[i]!;
          const b = entries[j]!;
          expect(hasClearance(a.box, b.box, 1), `${unit.model}: ${a.id} vs ${b.id}`).toBe(true);
        }
      }
    }
  });

  /*
   * 縮めるかどうかは**文字数ではなく幅**で決める（`blockMarkFontMm()` の doc comment）。
   * 同じ4文字でも `0.00`（3mm で 7.1mm）は 9mm ピッチに収まり、`COM0`（同 9.2mm）は収まらない。
   */
  it('keeps the normal font for names that fit the 9mm pitch and shrinks the ones that do not', () => {
    expect(blockMarkFontMm('0.00')).toBe(blockMarkFontMm('X0')); // 収まる名前は既定のまま
    expect(blockMarkFontMm('100.00')).toBeLessThan(blockMarkFontMm('0.00')); // 6文字は縮める
    // 4文字でも太字の大文字ばかりの `COM0` は 9mm に収まらないので縮める（`100.01` と食い合っていた）
    expect(blockMarkFontMm('COM0')).toBeLessThan(blockMarkFontMm('0.00'));
  });

  it('shrinks the box for the CP1E output names that used to overlap (100.00–101.03)', () => {
    const cp1e = withPlcUnit(JIPM_BOARD, PLC_UNIT_CP1E).terminals.find(
      (t) => String(t.id) === 'PLC.100.00',
    );
    expect(blockTerminalMark(cp1e!)).toBe('100.00');
    const box = blockLabelBox(cp1e!);
    // `PLC_TERMINAL_PITCH_MM`（9mm）の同じ段の隣とのあいだに1mm以上の余地が残る幅まで縮めてある
    expect(box.x1 - box.x0).toBeLessThan(9 - 1);
  });
});
