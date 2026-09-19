import { createPlcUnit, plcMetaOf } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  BoardError,
  FX5U_SPEC,
  JIPM_BOARD,
  JW300_SPEC,
  PC10G_SPEC,
  PLC_ORIGIN_MM,
  PLC_PART_ID,
  PLC_UNIT_JW300,
  PLC_UNIT_PC10G,
  PLC_UNITS,
  plcUnitFor,
  RACK_MODULE_HEIGHT_MM,
  RACK_MODULE_WIDTH_MM,
  rackTerminals,
  TERMINAL_PICK_RADIUS_MM,
  validateBoard,
  withPlcUnit,
} from '../src/index.js';

describe('PLC_UNIT_PC10G（§10.1 / §17 #21）', () => {
  it('is a rack of four modules', () => {
    expect(PLC_UNIT_PC10G.model).toBe('PC10G-1SP');
    expect(PLC_UNIT_PC10G.vendor).toBe('jtekt');
    expect(PLC_UNIT_PC10G.form).toBe('rack');
    expect(PLC_UNIT_PC10G.modules?.map((m) => m.model)).toEqual([
      'POWER1',
      'PC10G-1SP',
      'IN-12',
      'OUT-12',
    ]);
    expect(plcUnitFor('PC10G-1SP')).toBe(PLC_UNIT_PC10G);
  });

  it('sizes the base from the module widths (§17.1 の前提値)', () => {
    expect(PLC_UNIT_PC10G.sizeMm).toEqual({
      width: 4 * RACK_MODULE_WIDTH_MM + 20,
      height: 140,
      depth: 120,
    });
    for (const module of PLC_UNIT_PC10G.modules ?? []) {
      expect(module.sizeMm).toEqual({
        width: RACK_MODULE_WIDTH_MM,
        height: RACK_MODULE_HEIGHT_MM,
        depth: 120,
      });
      expect(module.pos.x).toBeGreaterThanOrEqual(PLC_ORIGIN_MM.x);
    }
  });

  it('wires 16 inputs on two commons of eight and 16 relay outputs likewise (§10.1)', () => {
    expect(PC10G_SPEC.inputCommons).toEqual(['ICOM0', 'ICOM1']);
    expect(PC10G_SPEC.inputs.map((i) => i.name).slice(0, 3)).toEqual(['X0', 'X1', 'X2']);
    expect(PC10G_SPEC.inputs.map((i) => i.name).slice(14)).toEqual(['XE', 'XF']);
    expect(PC10G_SPEC.inputs.slice(0, 8).every((i) => i.com === 'ICOM0')).toBe(true);
    expect(PC10G_SPEC.inputs.slice(8).every((i) => i.com === 'ICOM1')).toBe(true);
    expect(PC10G_SPEC.inputs.every((i) => i.ohms === 2400)).toBe(true);
    expect(PC10G_SPEC.commons).toEqual(['COM0', 'COM1']);
    // 出力端子の印字は `OUT-12` のアドレス（方言の `1Y010`〜`1Y01F` と同じ番号）。決定表#16
    expect(PC10G_SPEC.outputs.map((o) => o.name).slice(0, 3)).toEqual(['Y10', 'Y11', 'Y12']);
    expect(PC10G_SPEC.outputs.map((o) => o.name).slice(14)).toEqual(['Y1E', 'Y1F']);
    expect(PC10G_SPEC.outputs.map((o) => o.com).slice(7, 9)).toEqual(['COM0', 'COM1']);
    expect(PC10G_SPEC.acPower).toEqual(['L', 'N']);
  });

  it('describes each module front so 4B can draw it (決定表#15)', () => {
    const modules = PLC_UNIT_PC10G.modules ?? [];
    const byModel = new Map(modules.map((m) => [m.model, m.appearance]));
    expect(byModel.get('IN-12')?.leds.filter((l) => l.group === 'input')).toHaveLength(16);
    expect(byModel.get('IN-12')?.covers.map((c) => c.id)).toEqual(['terminal-cover']);
    expect(byModel.get('PC10G-1SP')?.features.map((f) => f.id)).toEqual([
      'run-stop',
      'peripheral',
      'latch',
    ]);
    expect(byModel.get('POWER1')?.leds.map((l) => l.name)).toEqual(['POWER']);
    for (const module of modules) expect(module.appearance.nameplate).toBe(module.model);
  });

  it('keeps every terminal inside its module box and 8 mm apart (前提#15)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_PC10G);
    const plc = board.terminals.filter((t) => String(t.id).startsWith('PLC.'));
    // 電源3 ＋ 入力コモン2 ＋ 入力16 ＋ COM2 ＋ 出力16 = 39
    expect(plc).toHaveLength(39);
    expect(String(plc.find((t) => String(t.id) === 'PLC.ICOM0')?.role)).toBe('ss');
    for (let i = 0; i < plc.length; i += 1) {
      for (let j = i + 1; j < plc.length; j += 1) {
        const a = plc[i];
        const b = plc[j];
        if (a === undefined || b === undefined) continue;
        expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThanOrEqual(
          2 * TERMINAL_PICK_RADIUS_MM,
        );
      }
    }
    expect(validateBoard(board)).toEqual([]);
  });
});

describe('PLC_UNIT_JW300（§10.1 / 受入基準⑤）', () => {
  it('is a rack of four units with the A / B input groups', () => {
    expect(PLC_UNIT_JW300.model).toBe('JW-300');
    expect(PLC_UNIT_JW300.vendor).toBe('sharp');
    expect(PLC_UNIT_JW300.form).toBe('rack');
    expect(PLC_UNIT_JW300.modules?.map((m) => m.model)).toEqual([
      'JW-301PU',
      'JW-312CU',
      'JW-212NA',
      'JW-214SA',
    ]);
    expect(PLC_UNIT_JW300.modules?.[1]?.sizeMm.depth).toBe(99.8);
    expect(JW300_SPEC.inputCommons).toEqual(['COM.A', 'COM.B']);
    expect(JW300_SPEC.inputs.map((i) => i.name).slice(0, 2)).toEqual(['A0', 'A1']);
    expect(JW300_SPEC.inputs.map((i) => i.name).slice(8, 10)).toEqual(['B0', 'B1']);
    expect(JW300_SPEC.inputs.slice(0, 8).every((i) => i.com === 'COM.A')).toBe(true);
    expect(JW300_SPEC.inputs.every((i) => i.ohms === 3300)).toBe(true);
    expect(JW300_SPEC.commons).toEqual(['COM.C', 'COM.D']);
    expect(JW300_SPEC.outputs.map((o) => o.name).slice(0, 2)).toEqual(['C0', 'C1']);
    // 群の境界（M3: 三項演算子から Math.floor の一般形に直しても同じ結果であること）
    expect(JW300_SPEC.inputs[7]?.com).toBe('COM.A');
    expect(JW300_SPEC.inputs[8]?.com).toBe('COM.B');
    expect(JW300_SPEC.outputs[7]?.com).toBe('COM.C');
    expect(JW300_SPEC.outputs[8]?.com).toBe('COM.D');
  });

  it('shows the A / B input lamps in two rows of eight (§10.1)', () => {
    const na = PLC_UNIT_JW300.modules?.find((m) => m.model === 'JW-212NA')?.appearance;
    const lamps = na?.leds.filter((l) => l.group === 'input') ?? [];
    expect(lamps.map((l) => l.name)).toEqual(JW300_SPEC.inputs.map((i) => i.name));
    expect(new Set(lamps.map((l) => l.rect.y)).size).toBe(2);
    expect(
      PLC_UNIT_JW300.modules
        ?.find((m) => m.model === 'JW-312CU')
        ?.appearance.leds.map((l) => l.name),
    ).toEqual(['RUN', 'FLT', 'MW']);
  });

  it('exposes COM.A as a wirable terminal (受入基準⑤)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_JW300);
    const comA = board.terminals.find((t) => String(t.id) === 'PLC.COM.A');
    expect(comA).toBeDefined();
    expect(comA?.wirable).toBe(true);
    expect(comA?.role).toBe('ss');
    expect(comA?.label).toBe('COM.A');
    expect(validateBoard(board)).toEqual([]);
  });
});

describe('createPlcUnit()（circuit-sim。board-model の *_SPEC がそのまま通ることを確認する。I2）', () => {
  it.each(Object.values(PLC_UNITS))(
    'builds a $model part with the same terminal set as board-model, every input above the ON threshold at 24V',
    (unit) => {
      const part = createPlcUnit(PLC_PART_ID, unit.spec);
      expect(new Set(part.terminals)).toEqual(new Set(unit.terminals.map((t) => t.id)));
      const meta = plcMetaOf(part);
      expect(meta, unit.model).toBeDefined();
      for (const element of part.elements) {
        if (element.kind !== 'load') continue;
        expect(24 / element.nominalOhms, `${unit.model} / ${element.id}`).toBeGreaterThan(
          meta?.onAmps ?? Infinity,
        );
      }
    },
  );

  it('matches the terminal counts from §10.1', () => {
    expect(PLC_UNITS['FX5U']?.terminals).toHaveLength(42);
    expect(PLC_UNITS['CP1E']?.terminals).toHaveLength(40);
    expect(PLC_UNITS['PC10G-1SP']?.terminals).toHaveLength(39);
    expect(PLC_UNITS['JW-300']?.terminals).toHaveLength(39);
  });
});

describe('rackTerminals()（防御的な例外。M6）', () => {
  it('throws past the 18-terminal-per-module cap instead of silently overlapping the next module', () => {
    const names = Array.from({ length: 19 }, (_unused, i) => `Z${i}`);
    expect(() => rackTerminals(FX5U_SPEC, names, 0)).toThrow(BoardError);
  });
});
