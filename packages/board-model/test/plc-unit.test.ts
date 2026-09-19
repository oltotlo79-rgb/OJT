import { describe, expect, it } from 'vitest';
import {
  FX5U_SPEC,
  isOffBoardTerminal,
  JIPM_BOARD,
  OUTLET_ID,
  PLC_PART_ID,
  PLC_UNIT_FX5U,
  plcUnitFor,
  validateBoard,
  withPlcUnit,
} from '../src/index.js';

describe('PLC_UNIT_FX5U', () => {
  it('describes the FX5U-32MR/ES body (§10.1)', () => {
    expect(PLC_UNIT_FX5U.model).toBe('FX5U');
    expect(PLC_UNIT_FX5U.vendor).toBe('mitsubishi');
    expect(PLC_UNIT_FX5U.sizeMm).toEqual({ width: 150, height: 90, depth: 83 });
    expect(PLC_UNIT_FX5U.leds).toContain('PWR');
    expect(PLC_UNIT_FX5U.leds).toContain('P.RUN');
  });

  it('names the 16 inputs and 16 outputs in octal (§10.1)', () => {
    expect(FX5U_SPEC.inputs.map((input) => input.name)).toEqual([
      'X0',
      'X1',
      'X2',
      'X3',
      'X4',
      'X5',
      'X6',
      'X7',
      'X10',
      'X11',
      'X12',
      'X13',
      'X14',
      'X15',
      'X16',
      'X17',
    ]);
    expect(FX5U_SPEC.outputs.map((o) => o.name)).toEqual([
      'Y0',
      'Y1',
      'Y2',
      'Y3',
      'Y4',
      'Y5',
      'Y6',
      'Y7',
      'Y10',
      'Y11',
      'Y12',
      'Y13',
      'Y14',
      'Y15',
      'Y16',
      'Y17',
    ]);
  });

  it('splits the outputs into four commons of four points (§17.1 の前提値)', () => {
    expect(FX5U_SPEC.commons).toEqual(['COM0', 'COM1', 'COM2', 'COM3']);
    expect(FX5U_SPEC.outputs.slice(0, 4).every((o) => o.com === 'COM0')).toBe(true);
    expect(FX5U_SPEC.outputs[4]?.com).toBe('COM1');
    expect(FX5U_SPEC.outputs[8]?.com).toBe('COM2');
    expect(FX5U_SPEC.outputs[12]?.com).toBe('COM3');
  });

  it('ties every input to the single S/S common and the AC pair to L and N (§10.1)', () => {
    expect(FX5U_SPEC.inputCommons).toEqual(['SS']);
    expect(FX5U_SPEC.inputs.every((input) => input.com === 'SS')).toBe(true);
    expect(FX5U_SPEC.acPower).toEqual(['L', 'N']);
  });

  it('uses the FX5U input circuit values (§5.1.3)', () => {
    expect(FX5U_SPEC.inputOhms).toBe(4500);
    expect(FX5U_SPEC.onAmps).toBe(0.0035);
    expect(FX5U_SPEC.offAmps).toBe(0.0015);
  });

  it('is found by its model name (§7.6 の `plc.model`)', () => {
    expect(plcUnitFor('FX5U')).toBe(PLC_UNIT_FX5U);
    // Task 9 で CP1E に本体定義が付いたので、`undefined` になるのは機種表に無い名前だけである
    expect(plcUnitFor('NOT-A-PLC')).toBeUndefined();
  });
});

describe('withPlcUnit', () => {
  const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

  it('keeps the board id so sessions still match (§8.2)', () => {
    expect(board.id).toBe(JIPM_BOARD.id);
    expect(board.plcUnit).toBe(PLC_UNIT_FX5U);
    expect(JIPM_BOARD.plcUnit).toBeUndefined();
  });

  it('adds the PLC and outlet terminals to the board terminal list', () => {
    const ids = board.terminals.map((t) => t.id);
    expect(ids).toContain('PLC.X0');
    expect(ids).toContain('PLC.X17');
    expect(ids).toContain('PLC.COM0');
    expect(ids).toContain('PLC.SS');
    expect(ids).toContain('PLC.L');
    expect(ids).toContain('OUTLET.L');
    expect(ids).toContain('OUTLET.N');
    // PLC = 電源3 ＋ S/S 1 ＋ サービス2 ＋ 入力16 ＋ COM 4 ＋ 出力16 = 42、コンセント2
    expect(board.terminals.length).toBe(JIPM_BOARD.terminals.length + 42 + 2);
  });

  it('keeps every PLC terminal wirable and labelled (§8.2)', () => {
    const plc = board.terminals.filter((t) => t.id.startsWith('PLC.'));
    expect(plc.every((t) => t.wirable)).toBe(true);
    expect(plc.every((t) => t.label.trim().length > 0)).toBe(true);
    // TerminalId は branded type なのでリテラルと `===` すると TS2367。String() で比較する
    expect(plc.find((t) => String(t.id) === 'PLC.SS')?.label).toBe('S/S');
    expect(plc.find((t) => String(t.id) === 'PLC.PE')?.label).toBe('⏚');
    expect(plc.find((t) => String(t.id) === 'PLC.X10')?.role).toBe('x');
    expect(plc.find((t) => String(t.id) === 'PLC.COM1')?.role).toBe('plc-com');
  });

  it('passes validateBoard with the desk terminals excluded from the board rect (§6.5)', () => {
    expect(validateBoard(board)).toEqual([]);
    expect(validateBoard(JIPM_BOARD)).toEqual([]);
  });

  it('does not add footprints or channels for the desk devices (§6.6)', () => {
    expect(board.footprints).toEqual(JIPM_BOARD.footprints);
    expect(board.wiringChannels).toEqual(JIPM_BOARD.wiringChannels);
  });
});

describe('isOffBoardTerminal', () => {
  it('knows the two desk devices', () => {
    expect(isOffBoardTerminal('PLC.X0')).toBe(true);
    expect(isOffBoardTerminal('OUTLET.L')).toBe(true);
    expect(isOffBoardTerminal('TB_PB.1a')).toBe(false);
    expect(isOffBoardTerminal('S1.13')).toBe(false);
    expect(PLC_PART_ID).toBe('PLC');
    expect(OUTLET_ID).toBe('OUTLET');
  });
});
