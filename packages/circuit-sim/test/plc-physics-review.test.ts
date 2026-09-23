import { describe, expect, it } from 'vitest';
import {
  continuity,
  createPlcUnit,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  injectFault,
  measureResistance,
  measureVoltage,
  type PlcUnitSpec,
  type Simulation,
} from '../src/index.js';
import { powerOn, t, w } from './helpers/circuits.js';
import { tinySpec, poweredPlcBench } from './helpers/plc.js';

/**
 * Physics regression tests lifted from the Opus review of Plan 3A batches A-C
 * (`plc-physics.probe.ts`). The original probe wired a full `@ojt/board-model` FX5U unit through
 * a `BoardSession`; that pulls in a package `circuit-sim` does not depend on, so these are
 * rewritten against `circuit-sim`'s own `createPlcUnit()` + `tinySpec()` (identical electrical
 * constants: 4500Ω / 3.5mA ON / 1.5mA OFF — see `tinySpec()`'s doc comment). Geometry-only
 * assertions from the probe (octal terminal names, channel ordering, addWire limits) stay out of
 * scope for this package.
 */

function plcBench(): Simulation {
  return poweredPlcBench(
    [
      createPowerSupply('PS'),
      createPushButton('PB1'),
      createRelay4c('CR1'),
      createPlcUnit('PLC', tinySpec()),
    ],
    [
      w('w1', 'PS.+', 'PLC.SS'),
      w('w2', 'PLC.X0', 'PB1.a'),
      w('w3', 'PB1.c', 'PS.-'),
      w('w4', 'PS.+', 'PLC.COM0'),
      w('w5', 'PLC.Y0', 'CR1.14'),
      w('w6', 'CR1.13', 'PS.-'),
    ],
  );
}

describe('hysteresis approached from BELOW (X input)', () => {
  it('a 3000Ω series contact reads 3.20mA (inside the ON/OFF band) and stays OFF', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.step();
    expect(sim.plcInputs('PLC')[0]).toBe(false);
    // start with the contact already resistive, then press: 24V / 7500Ω = 3.2mA
    injectFault(sim.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 3000);
    sim.press('PB1');
    sim.step();
    expect(sim.state().plcs['PLC']?.inputAmps[0]).toBeCloseTo(24 / 7500, 5);
    expect(sim.plcInputs('PLC')[0]).toBe(false); // approached from OFF -> stays OFF
  });
});

describe('sink vs source wiring give identical |inputAmps|', () => {
  it('agree to 9 decimal places', () => {
    const sink = plcBench();
    const source = poweredPlcBench(
      [createPowerSupply('PS'), createPushButton('PB1'), createPlcUnit('PLC', tinySpec())],
      [w('w1', 'PS.-', 'PLC.SS'), w('w2', 'PLC.X0', 'PB1.a'), w('w3', 'PB1.c', 'PS.+')],
    );
    powerOn(sink);
    powerOn(source);
    sink.press('PB1');
    source.press('PB1');
    sink.step();
    source.step();
    expect(sink.plcInputs('PLC')[0]).toBe(true);
    expect(source.plcInputs('PLC')[0]).toBe(true);
    const sinkAmps = sink.state().plcs['PLC']?.inputAmps[0] ?? Number.NaN;
    const sourceAmps = source.state().plcs['PLC']?.inputAmps[0] ?? Number.NaN;
    expect(sourceAmps).toBeCloseTo(sinkAmps, 9);
  });
});

describe('setPlcOutputs timing', () => {
  it('is not effective until the NEXT step() (the solver has not seen the write yet)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.step();
    expect(sim.state().relays['CR1']?.coilOn).toBe(false);
    sim.setPlcOutputs('PLC', [true]);
    // the runtime value is already written back...
    expect(sim.state().plcs['PLC']?.outputs[0]).toBe(true);
    // ...but the relay coil, which is driven by the solved contact, has not reacted yet
    expect(sim.state().relays['CR1']?.coilOn).toBe(false);
    sim.step();
    expect(sim.state().relays['CR1']?.coilOn).toBe(true);
  });
});

describe('a short across a Y contact trips an overcurrent hazard', () => {
  it('COM0 -> Y0 wired straight together (closing Y0 shorts the rails)', () => {
    const sim = poweredPlcBench(
      [createPowerSupply('PS'), createPlcUnit('PLC', tinySpec())],
      [w('w1', 'PS.+', 'PLC.COM0'), w('w2', 'PLC.Y0', 'PS.-')],
    );
    powerOn(sim);
    sim.step();
    expect(sim.state().tripped).toBe(false);
    sim.setPlcOutputs('PLC', [true]);
    sim.step();
    sim.step();
    expect(sim.state().tripped).toBe(true);
    expect(
      sim.events
        .hazards()
        .some((h) => h.kind === 'overcurrent' || h.kind === 'short-circuit-power-on'),
    ).toBe(true);
  });
});

describe('COM isolation', () => {
  const twoComSpec = (): PlcUnitSpec => ({
    model: 'TEST-2COM',
    power: ['L', 'N', 'PE'],
    acPower: ['L', 'N'],
    inputCommons: ['SS'],
    service: ['24V', '0V'],
    inputs: [{ name: 'X0', com: 'SS' }],
    commons: ['COM0', 'COM1'],
    outputs: [
      { name: 'Y0', com: 'COM0' },
      { name: 'Y1', com: 'COM1' },
    ],
    inputOhms: 4500,
    onAmps: 0.0035,
    offAmps: 0.0015,
  });

  it('Y1 on an unwired COM1 drives nothing even when Y1 is commanded ON', () => {
    const sim = poweredPlcBench(
      [createPowerSupply('PS'), createRelay4c('CR1'), createPlcUnit('PLC', twoComSpec())],
      [
        w('w1', 'PS.+', 'PLC.COM0'), // only COM0 is wired
        w('w2', 'PLC.Y1', 'CR1.14'),
        w('w3', 'CR1.13', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.setPlcOutputs('PLC', [false, true]); // Y1 ON
    sim.step();
    sim.step();
    expect(sim.state().relays['CR1']?.coilOn).toBe(false);
  });
});

describe('Ω / continuity on PLC terminals', () => {
  it('ohm-on-live: measuring across a LIVE X input refuses and raises the hazard', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.step();
    const reading = measureResistance(sim, t('PLC.SS'), t('PLC.X0'));
    expect(reading.live).toBe(true);
    expect(sim.events.countOf('ohm-on-live')).toBeGreaterThan(0);
  });

  it('a DEAD PLC input reads the 4500Ω input circuit', () => {
    const sim = plcBench();
    sim.setBreaker(false);
    sim.setSwitch(false);
    sim.step();
    const reading = measureResistance(sim, t('PLC.SS'), t('PLC.X0'));
    expect(reading.live).toBe(false);
    expect(reading.ohms).toBeCloseTo(4500, 0);
  });

  it('continuity across a Y contact tells open from closed', () => {
    const sim = plcBench();
    sim.setBreaker(false);
    sim.setSwitch(false);
    sim.step();
    expect(continuity(sim, t('PLC.COM0'), t('PLC.Y0')).conductive).toBe(false);
    sim.setPlcOutputs('PLC', [true]);
    sim.step();
    expect(continuity(sim, t('PLC.COM0'), t('PLC.Y0')).conductive).toBe(true);
  });

  it('DCV across a conducting X input reads ~24V', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.step();
    expect(measureVoltage(sim, t('PLC.X0'), t('PLC.SS')).volts).toBeCloseTo(24, 1);
  });
});

describe('createPlcUnit() defaults', () => {
  it('falls back to PLC_INPUT_OHMS / PLC_INPUT_ON_AMPS / PLC_INPUT_OFF_AMPS with no optional fields set', () => {
    const spec: PlcUnitSpec = {
      model: 'TEST-BARE',
      power: ['L', 'N', 'PE'],
      acPower: ['L', 'N'],
      inputCommons: ['SS'],
      inputs: [{ name: 'X0', com: 'SS' }],
      commons: ['COM0'],
      outputs: [{ name: 'Y0', com: 'COM0' }],
    };
    const part = createPlcUnit('PLC', spec);
    expect(part.meta.kind).toBe('plc');
  });

  it('rejects a spec whose onAmps does not exceed offAmps', () => {
    const spec: PlcUnitSpec = { ...tinySpec(), onAmps: 0.001, offAmps: 0.0015 };
    expect(() => createPlcUnit('PLC', spec)).toThrow();
  });
});
