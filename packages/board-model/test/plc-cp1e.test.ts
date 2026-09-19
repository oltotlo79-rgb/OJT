import { describe, expect, it } from 'vitest';
import {
  CP1E_SPEC,
  JIPM_BOARD,
  PLC_UNIT_CP1E,
  plcUnitFor,
  validateBoard,
  withPlcUnit,
} from '../src/index.js';

describe('PLC_UNIT_CP1E（§10.1 / §17.1 の前提値）', () => {
  it('describes the CP1E-N30DR-A body', () => {
    expect(PLC_UNIT_CP1E.model).toBe('CP1E');
    expect(PLC_UNIT_CP1E.vendor).toBe('omron');
    expect(PLC_UNIT_CP1E.form).toBe('unit');
    expect(PLC_UNIT_CP1E.sizeMm).toEqual({ width: 130, height: 90, depth: 85 });
    expect(PLC_UNIT_CP1E.leds).toEqual(['POWER', 'RUN', 'ERR', 'ALM']);
    expect(plcUnitFor('CP1E')).toBe(PLC_UNIT_CP1E);
  });

  it('names 18 inputs and 12 outputs in the CIO spelling (§10.1)', () => {
    expect(CP1E_SPEC.inputs.map((i) => i.name).slice(0, 3)).toEqual(['0.00', '0.01', '0.02']);
    expect(CP1E_SPEC.inputs.map((i) => i.name).slice(11, 14)).toEqual(['0.11', '1.00', '1.01']);
    expect(CP1E_SPEC.inputs).toHaveLength(18);
    expect(CP1E_SPEC.outputs.map((o) => o.name).slice(0, 2)).toEqual(['100.00', '100.01']);
    expect(CP1E_SPEC.outputs.map((o) => o.name).slice(8, 10)).toEqual(['101.00', '101.01']);
    expect(CP1E_SPEC.outputs).toHaveLength(12);
  });

  it('splits the outputs 3/3/2/2/2 over five commons (§17.1 の前提値)', () => {
    expect(CP1E_SPEC.commons).toEqual(['COM0', 'COM1', 'COM2', 'COM3', 'COM4']);
    expect(CP1E_SPEC.outputs.map((o) => o.com)).toEqual([
      'COM0',
      'COM0',
      'COM0',
      'COM1',
      'COM1',
      'COM1',
      'COM2',
      'COM2',
      'COM3',
      'COM3',
      'COM4',
      'COM4',
    ]);
  });

  it('uses the two input resistances of §5.1.3 and the L1 / L2N power pair', () => {
    expect(CP1E_SPEC.inputs.slice(0, 8).every((i) => i.ohms === 3300)).toBe(true);
    expect(CP1E_SPEC.inputs.slice(8).every((i) => i.ohms === 4800)).toBe(true);
    expect(CP1E_SPEC.inputCommons).toEqual(['COM']);
    expect(CP1E_SPEC.power).toEqual(['L1', 'L2N']);
    expect(CP1E_SPEC.acPower).toEqual(['L1', 'L2N']);
    expect(CP1E_SPEC.service).toEqual(['+', '-']);
  });

  it('puts every terminal on the board with a readable label (§8.2)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_CP1E);
    const ids = board.terminals.map((t) => String(t.id));
    expect(ids).toContain('PLC.0.00');
    expect(ids).toContain('PLC.1.05');
    expect(ids).toContain('PLC.100.00');
    expect(ids).toContain('PLC.COM4');
    expect(ids).toContain('PLC.L1');
    const plc = board.terminals.filter((t) => String(t.id).startsWith('PLC.'));
    // 電源2 ＋ 入力コモン1 ＋ サービス2 ＋ 入力18 ＋ COM5 ＋ 出力12 = 40
    expect(plc).toHaveLength(40);
    expect(plc.every((t) => t.wirable && t.label.trim().length > 0)).toBe(true);
    expect(plc.find((t) => String(t.id) === 'PLC.L2N')?.label).toBe('L2/N');
    expect(plc.find((t) => String(t.id) === 'PLC.COM')?.role).toBe('ss');
    expect(plc.find((t) => String(t.id) === 'PLC.100.00')?.role).toBe('y');
    expect(validateBoard(board)).toEqual([]);
  });
});
