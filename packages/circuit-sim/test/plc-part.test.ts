import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createPlcUnit,
  PLC_INPUT_OFF_AMPS,
  PLC_INPUT_ON_AMPS,
  PLC_INPUT_OHMS,
  plcMetaOf,
  type PlcUnitSpec,
} from '../src/index.js';
import { tinySpec } from './helpers/plc.js';

describe('createPlcUnit', () => {
  it('lays the terminals out in the order the spec lists them (§10.1 / §17 #11)', () => {
    const part = createPlcUnit('PLC', tinySpec());
    expect(part.kind).toBe('plc');
    expect(part.terminals).toEqual([
      'PLC.L',
      'PLC.N',
      'PLC.PE',
      'PLC.SS',
      'PLC.24V',
      'PLC.0V',
      'PLC.X0',
      'PLC.X1',
      'PLC.COM0',
      'PLC.Y0',
      'PLC.Y1',
    ]);
  });

  it('models every input as a resistive load between S/S and Xn (§4.4)', () => {
    const part = createPlcUnit('PLC', tinySpec());
    const input = part.elements.find((el) => el.id === 'PLC:in0');
    expect(input).toEqual({
      kind: 'load',
      id: 'PLC:in0',
      from: 'PLC.SS',
      to: 'PLC.X0',
      load: 'plcInput',
      nominalOhms: 4500,
    });
  });

  it('models every output as an externally driven a-contact to its COM (§4.4)', () => {
    const part = createPlcUnit('PLC', tinySpec());
    const output = part.elements.find((el) => el.id === 'PLC:out1');
    expect(output).toEqual({
      kind: 'contact',
      id: 'PLC:out1',
      from: 'PLC.Y1',
      to: 'PLC.COM0',
      contact: 'a',
      driver: 'external',
      driverId: 'PLC',
      group: 1,
      energized: false,
      closedOhms: 0.001,
    });
  });

  it('gives the power terminals no element at all (§5.2 は交流を扱わない)', () => {
    const part = createPlcUnit('PLC', tinySpec());
    const touching = part.elements.filter(
      (el) => el.from.startsWith('PLC.L') || el.to.startsWith('PLC.N'),
    );
    expect(touching).toEqual([]);
  });

  it('records the channel map in the part meta', () => {
    const part = createPlcUnit('PLC', tinySpec());
    const meta = plcMetaOf(part);
    expect(meta?.model).toBe('TEST-2');
    expect(meta?.inputCommons).toEqual(['PLC.SS']);
    expect(meta?.inputs).toEqual([
      { name: 'X0', terminal: 'PLC.X0', elementId: 'PLC:in0' },
      { name: 'X1', terminal: 'PLC.X1', elementId: 'PLC:in1' },
    ]);
    expect(meta?.outputs[1]).toEqual({
      name: 'Y1',
      terminal: 'PLC.Y1',
      com: 'PLC.COM0',
      elementId: 'PLC:out1',
    });
    expect(meta?.power).toEqual(['PLC.L', 'PLC.N', 'PLC.PE']);
    expect(meta?.onAmps).toBe(0.0035);
    expect(meta?.offAmps).toBe(0.0015);
  });

  it('falls back to the spec defaults of §5.1.3 when the model does not give them', () => {
    const spec: PlcUnitSpec = { ...tinySpec(), inputOhms: PLC_INPUT_OHMS };
    delete (spec as { onAmps?: number }).onAmps;
    delete (spec as { offAmps?: number }).offAmps;
    const meta = plcMetaOf(createPlcUnit('PLC', spec));
    expect(meta?.onAmps).toBe(PLC_INPUT_ON_AMPS);
    expect(meta?.offAmps).toBe(PLC_INPUT_OFF_AMPS);
    expect(PLC_INPUT_ON_AMPS).toBe(0.003);
    expect(PLC_INPUT_OFF_AMPS).toBe(0.0015);
  });

  it('rejects an output whose COM is not in the commons list', () => {
    const spec = tinySpec();
    expect(() =>
      createPlcUnit('PLC', { ...spec, outputs: [{ name: 'Y0', com: 'COM9' }] }),
    ).toThrow();
  });

  it('rejects an input whose common is not in the inputCommons list (§10.1)', () => {
    const spec = tinySpec();
    expect(() =>
      createPlcUnit('PLC', { ...spec, inputs: [{ name: 'X0', com: 'ICOM9' }] }),
    ).toThrow();
  });

  it('rejects an AC power terminal that is not one of the power terminals (§10.1)', () => {
    const spec = tinySpec();
    expect(() => createPlcUnit('PLC', { ...spec, acPower: ['L1', 'L2N'] })).toThrow();
  });

  it('takes the per-point resistance over the model-wide one (§5.1.3)', () => {
    const spec = tinySpec();
    const part = createPlcUnit('PLC', {
      ...spec,
      inputs: [
        { name: 'X0', com: 'SS', ohms: 3300 },
        { name: 'X1', com: 'SS' },
      ],
    });
    const ohms = part.elements
      .filter((el): el is Extract<typeof el, { kind: 'load' }> => el.kind === 'load')
      .map((el) => el.nominalOhms);
    expect(ohms).toEqual([3300, 4500]);
  });

  it('returns undefined for a part that is not a PLC', () => {
    expect(plcMetaOf(createLamp('PL1', '白'))).toBeUndefined();
  });
});
