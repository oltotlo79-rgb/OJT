import { describe, expect, it } from 'vitest';
import { compareLogs, createLamp, createPowerSupply, createPushButton } from '../src/index.js';
import type { Simulation } from '../src/index.js';
import { bench, powerOn, w } from './helpers/circuits.js';

describe('判定の突き合わせ', () => {
  function logOf(times: number[]): Simulation {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    powerOn(sim);
    const [on = 0, off = 0] = times;
    sim.run(on);
    sim.press('PB1');
    sim.run(off);
    sim.release('PB1');
    sim.run(off + 1000);
    return sim;
  }

  it('150msずれは合格、250msずれは不合格', () => {
    const want = logOf([1000, 2000]);
    const near = logOf([1150, 2150]);
    const far = logOf([1250, 2250]);
    expect(compareLogs(want.log, near.log, ['PL1'])).toEqual([]);
    expect(compareLogs(want.log, far.log, ['PL1']).length).toBeGreaterThan(0);
  });

  it('許容差の境界: 200msちょうどは合格、210msは不合格', () => {
    const want = logOf([1000, 2000]);
    const edge = logOf([1200, 2200]);
    const over = logOf([1210, 2210]);
    expect(compareLogs(want.log, edge.log, ['PL1'])).toEqual([]);
    expect(compareLogs(want.log, over.log, ['PL1']).length).toBeGreaterThan(0);
  });

  it('区間長の10%規則が効く', () => {
    const want = logOf([1000, 6000]);
    const shifted = logOf([1000, 6400]);
    expect(compareLogs(want.log, shifted.log, ['PL1'])).toEqual([]);
    expect(compareLogs(want.log, shifted.log, ['PL1'], { edgeMs: 200, ratio: 0 }).length).toBe(1);
  });
});
