import { describe, expect, it } from 'vitest';
import {
  applyTesterAction,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTesterState,
  readTester,
  TESTER_NO_PROBE_DISPLAY,
  TESTER_OFF_DISPLAY,
} from '../src/index.js';
import type { Simulation, TesterState } from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

/** リレー1個・ランプ1個の点検台。PB1でコイルを励磁する。 */
function coilBench(): Simulation {
  return bench(
    [
      createPowerSupply('PS'),
      createPushButton('PB1'),
      createRelay4c('CR1'),
      createLamp('PL1', '白'),
    ],
    [
      w('w1', 'PS.+', 'PB1.c'),
      w('w2', 'PB1.a', 'CR1.14'),
      w('w3', 'CR1.13', 'PS.-'),
      w('w4', 'PS.+', 'CR1.9'),
      w('w5', 'CR1.5', 'PL1.+'),
      w('w6', 'PL1.-', 'PS.-'),
    ],
  );
}

/** 黒→赤の順にプローブを置いた状態を作る。 */
function probed(state: TesterState, black: string, red: string): TesterState {
  const withBlack = applyTesterAction(state, {
    type: 'place-probe',
    probe: 'black',
    terminal: t(black),
  });
  return applyTesterAction(withBlack, { type: 'place-probe', probe: 'red', terminal: t(red) });
}

describe('createTesterState', () => {
  it('starts as a digital tester with the knob off and no probes', () => {
    const state = createTesterState();
    expect(state.kind).toBe('digital');
    expect(state.mode).toBe('off');
    expect(state.black).toBeUndefined();
    expect(state.red).toBeUndefined();
    expect(state.zeroAdjusted).toBe(false);
    expect(state.needleDeg).toBe(0);
  });

  it('can start as an analog tester (decision #10)', () => {
    expect(createTesterState('analog').kind).toBe('analog');
  });
});

describe('applyTesterAction', () => {
  it('returns a new object and leaves the previous state untouched', () => {
    const state = createTesterState();
    const next = applyTesterAction(state, { type: 'set-mode', mode: 'DCV' });
    expect(next).not.toBe(state);
    expect(state.mode).toBe('off');
    expect(next.mode).toBe('DCV');
  });

  it('places the black probe and then the red probe', () => {
    const state = probed(createTesterState(), 'PS.-', 'PS.+');
    expect(state.black).toBe('PS.-');
    expect(state.red).toBe('PS.+');
  });

  it('lifts a probe when the terminal is undefined', () => {
    const placed = probed(createTesterState(), 'PS.-', 'PS.+');
    const lifted = applyTesterAction(placed, {
      type: 'place-probe',
      probe: 'red',
      terminal: undefined,
    });
    expect(lifted.red).toBeUndefined();
    expect(lifted.black).toBe('PS.-');
  });

  it('switches between digital and analog', () => {
    const state = applyTesterAction(createTesterState(), { type: 'set-kind', kind: 'analog' });
    expect(state.kind).toBe('analog');
    expect(applyTesterAction(state, { type: 'set-kind', kind: 'digital' }).kind).toBe('digital');
  });

  it('keeps the zero-ohm adjustment when a probe moves, but clears it on range/mode/kind changes (§9.3)', () => {
    const zeroed = applyTesterAction(createTesterState(), { type: 'zero-adjust' });
    expect(zeroed.zeroAdjusted).toBe(true);
    const moved = applyTesterAction(zeroed, {
      type: 'place-probe',
      probe: 'red',
      terminal: t('PS.+'),
    });
    expect(moved.zeroAdjusted).toBe(true);
    expect(applyTesterAction(zeroed, { type: 'set-mode', mode: 'DCV' }).zeroAdjusted).toBe(false);
    expect(applyTesterAction(zeroed, { type: 'set-volt-range', range: 10 }).zeroAdjusted).toBe(
      false,
    );
    expect(applyTesterAction(zeroed, { type: 'set-ohm-range', range: 1 }).zeroAdjusted).toBe(false);
    expect(applyTesterAction(zeroed, { type: 'set-kind', kind: 'analog' }).zeroAdjusted).toBe(
      false,
    );
  });
});

describe('readTester (digital)', () => {
  it('shows OFF while the knob is off', () => {
    const sim = coilBench();
    const state = probed(createTesterState(), 'PS.-', 'PS.+');
    const reading = readTester(sim, state);
    expect(reading.display).toBe(TESTER_OFF_DISPLAY);
    expect(Number.isNaN(reading.value)).toBe(true);
  });

  it('shows ---- until both probes are placed', () => {
    const sim = coilBench();
    const state = applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'DCV' });
    expect(readTester(sim, state).display).toBe(TESTER_NO_PROBE_DISPLAY);
  });

  it('reads DC volts as red minus black with 0.01 V resolution (§9.3)', () => {
    const sim = coilBench();
    powerOn(sim);
    sim.press('PB1');
    sim.run(200);
    const state = probed(
      applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'DCV' }),
      'PS.-',
      'PS.+',
    );
    const reading = readTester(sim, state);
    // 電源内部抵抗0.1Ωぶんだけ24Vより下がる（コイル650Ω∥ランプ2400Ωの負荷で 23.995V）。
    expect(reading.value).toBeCloseTo(24, 1);
    expect(reading.display).toBe('24.00 V');
    // 黒と赤を入れ替えると符号が反転する（§5.5）。
    const reversed = probed(state, 'PS.+', 'PS.-');
    expect(readTester(sim, reversed).value).toBeCloseTo(-24, 1);
  });

  it('always reads 0.00 V on ACV (§5.5)', () => {
    const sim = coilBench();
    powerOn(sim);
    sim.run(100);
    const state = probed(
      applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'ACV' }),
      'PS.-',
      'PS.+',
    );
    expect(readTester(sim, state).display).toBe('0.00 V');
  });

  it('reads the coil resistance with 0.1 ohm resolution while the circuit is dead', () => {
    const sim = coilBench();
    const state = probed(
      applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'OHM' }),
      'CR1.13',
      'CR1.14',
    );
    const reading = readTester(sim, state);
    expect(reading.value).toBeCloseTo(650, 1);
    expect(reading.display).toBe('650.0');
    expect(reading.live).toBe(false);
  });

  it('refuses to measure ohms on a live circuit and raises ohm-on-live (§5.6 #1)', () => {
    const sim = coilBench();
    powerOn(sim);
    sim.press('PB1');
    sim.run(200);
    const state = probed(
      applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'OHM' }),
      'CR1.13',
      'CR1.14',
    );
    const reading = readTester(sim, state);
    expect(reading.live).toBe(true);
    expect(reading.display).toBe(TESTER_NO_PROBE_DISPLAY);
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
  });

  it('buzzes on continuity below 50 ohms and stays silent above it (§5.5)', () => {
    const sim = coilBench();
    const state = applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'CONT' });
    const closed = readTester(sim, probed(state, 'PS.+', 'CR1.9'));
    expect(closed.conductive).toBe(true);
    expect(closed.display).toBe('導通');
    const open = readTester(sim, probed(state, 'CR1.1', 'CR1.5'));
    expect(open.conductive).toBe(false);
    expect(open.display).toBe('OL');
  });
});
