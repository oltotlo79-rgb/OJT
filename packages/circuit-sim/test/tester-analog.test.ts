import { describe, expect, it } from 'vitest';
import {
  applyTesterAction,
  createPowerSupply,
  createRelay4c,
  createTesterState,
  NEEDLE_FULL_SCALE_DEG,
  ohmNeedleDeg,
  readTester,
  stepTester,
  voltNeedleDeg,
  voltRangesFor,
  withZeroAdjustError,
} from '../src/index.js';
import type { Simulation, TesterState } from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

/** コイル650Ωだけをぶら下げた測定台。 */
function relayBench(): Simulation {
  return bench(
    [createPowerSupply('PS'), createRelay4c('CR1')],
    [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
  );
}

function analog(mode: 'DCV' | 'ACV' | 'OHM' | 'CONT', black: string, red: string): TesterState {
  let state = applyTesterAction(createTesterState('analog'), { type: 'set-mode', mode });
  state = applyTesterAction(state, { type: 'place-probe', probe: 'black', terminal: t(black) });
  return applyTesterAction(state, { type: 'place-probe', probe: 'red', terminal: t(red) });
}

describe('voltNeedleDeg', () => {
  it('is linear against the range', () => {
    expect(voltNeedleDeg(0, 50)).toBe(0);
    expect(voltNeedleDeg(25, 50)).toBeCloseTo(45, 6);
    expect(voltNeedleDeg(50, 50)).toBeCloseTo(NEEDLE_FULL_SCALE_DEG, 6);
  });

  it('pins the needle at the left stop for a reversed reading and at full scale above the range', () => {
    expect(voltNeedleDeg(-10, 50)).toBe(0);
    expect(voltNeedleDeg(120, 50)).toBeCloseTo(NEEDLE_FULL_SCALE_DEG, 6);
  });
});

describe('ohmNeedleDeg', () => {
  it('uses the centre scale law Rin over Rin plus R', () => {
    // ×10 は Rin = 120Ω なので、120Ω を測るとちょうど中央（45度）を指す。
    expect(ohmNeedleDeg(120, 10)).toBeCloseTo(45, 6);
    expect(ohmNeedleDeg(0, 10)).toBeCloseTo(NEEDLE_FULL_SCALE_DEG, 6);
    expect(ohmNeedleDeg(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });

  it('moves the whole scale when the range multiplier changes', () => {
    expect(ohmNeedleDeg(650, 1)).toBeCloseTo(90 * (12 / 662), 6);
    expect(ohmNeedleDeg(650, 1000)).toBeCloseTo(90 * (12000 / 12650), 6);
  });
});

describe('withZeroAdjustError', () => {
  it('adds 5 percent until the zero ohm adjustment is done', () => {
    expect(withZeroAdjustError(650, false)).toBeCloseTo(682.5, 6);
    expect(withZeroAdjustError(650, true)).toBe(650);
    expect(withZeroAdjustError(Number.POSITIVE_INFINITY, false)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('voltRangesFor', () => {
  it('offers 2.5/10/50/250 on DCV and 10/50/250 on ACV', () => {
    expect(voltRangesFor('DCV')).toEqual([2.5, 10, 50, 250]);
    expect(voltRangesFor('ACV')).toEqual([10, 50, 250]);
  });

  it('snaps the knob to the nearest range of the new mode', () => {
    let state = applyTesterAction(createTesterState('analog'), { type: 'set-mode', mode: 'DCV' });
    state = applyTesterAction(state, { type: 'set-volt-range', range: 2.5 });
    expect(state.voltRange).toBe(2.5);
    state = applyTesterAction(state, { type: 'set-mode', mode: 'ACV' });
    expect(state.voltRange).toBe(10);
  });
});

describe('readTester (analog)', () => {
  it('points the needle at 43.19 deg for 24 V on the 50 V range', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    const state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 50,
    });
    const reading = readTester(sim, state);
    expect(reading.value).toBeCloseTo(23.996, 2);
    expect(reading.targetDeg).toBeCloseTo(43.19, 1);
    expect(reading.overRange).toBe(false);
  });

  it('flags over range on the 10 V range and shows OL', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    const state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 10,
    });
    const reading = readTester(sim, state);
    expect(reading.overRange).toBe(true);
    expect(reading.display).toBe('OL');
    expect(reading.targetDeg).toBeCloseTo(NEEDLE_FULL_SCALE_DEG, 6);
  });

  it('adds the zero ohm adjustment error to the coil reading until adjusted', () => {
    const sim = relayBench();
    const state = applyTesterAction(analog('OHM', 'CR1.13', 'CR1.14'), {
      type: 'set-ohm-range',
      range: 10,
    });
    const raw = readTester(sim, state);
    expect(raw.display).toBe('682.5');
    expect(raw.targetDeg).toBeCloseTo(13.458, 2);
    const adjusted = readTester(sim, applyTesterAction(state, { type: 'zero-adjust' }));
    expect(adjusted.display).toBe('650.0');
    expect(adjusted.targetDeg).toBeCloseTo(14.026, 2);
  });

  it('rests the needle at the infinity end when the path is open', () => {
    const sim = relayBench();
    const state = applyTesterAction(analog('OHM', 'CR1.1', 'CR1.5'), {
      type: 'set-ohm-range',
      range: 10,
    });
    const reading = readTester(sim, state);
    expect(reading.display).toBe('OL');
    expect(reading.targetDeg).toBe(0);
    expect(reading.overRange).toBe(false);
  });
});

describe('stepTester', () => {
  it('moves the needle with a 100 ms exponential lag', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    let state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 10,
    });
    const first = stepTester(sim, state);
    expect(first.state.needleDeg).toBeCloseTo(8.565, 2);
    state = first.state;
    for (let i = 0; i < 9; i += 1) state = stepTester(sim, state).state;
    // 目標90度へ 1 - exp(-1) = 0.63212 ぶん進む。
    expect(state.needleDeg).toBeCloseTo(56.891, 2);
  });

  it('snaps the needle onto the target within 0.05 degrees so it stops changing (コーディネータ指示#3)', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    let state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 10,
    });
    // 76 tick前後で目標90度との差が0.05度を切る（90 × 0.904837^76 ≒ 0.049）。余裕を見て200tick進める。
    for (let i = 0; i < 200; i += 1) state = stepTester(sim, state).state;
    expect(state.needleDeg).toBe(90);
    // スナップ後はこれ以上動かない（同じ値が続く＝描画側は再レンダーしなくてよい）。
    const settled = stepTester(sim, state).state;
    expect(settled.needleDeg).toBe(90);
  });

  it('keeps the digital needle at zero', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    let state = applyTesterAction(createTesterState('digital'), { type: 'set-mode', mode: 'DCV' });
    state = applyTesterAction(state, { type: 'place-probe', probe: 'black', terminal: t('PS.-') });
    state = applyTesterAction(state, { type: 'place-probe', probe: 'red', terminal: t('PS.+') });
    const stepped = stepTester(sim, state);
    expect(stepped.state.needleDeg).toBe(0);
    expect(stepped.reading.overRange).toBe(false);
    expect(sim.events.countOf('range-exceeded')).toBe(0);
  });

  it('raises range-exceeded once per excursion and re-arms after the reading returns in range', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    let state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 10,
    });
    state = stepTester(sim, state).state;
    state = stepTester(sim, state).state;
    expect(sim.events.countOf('range-exceeded')).toBe(1);
    state = applyTesterAction(state, { type: 'set-volt-range', range: 250 });
    state = stepTester(sim, state).state;
    expect(sim.events.countOf('range-exceeded')).toBe(1);
    state = applyTesterAction(state, { type: 'set-volt-range', range: 10 });
    stepTester(sim, state);
    expect(sim.events.countOf('range-exceeded')).toBe(2);
    expect(sim.events.hazards('range-exceeded')[0]?.detail).toContain('DCV');
  });
});
