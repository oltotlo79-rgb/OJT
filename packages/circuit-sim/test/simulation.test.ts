import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createPowerSupply,
  createPushButton,
  createTimer4c,
  SimulationError,
  TICK_MS,
} from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

function lampBench(): ReturnType<typeof bench> {
  return bench(
    [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
    [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    { watch: [t('PL1.+')] },
  );
}

describe('simulation', () => {
  it('通電していなければ全信号が0のまま（§5.3.5）', () => {
    const sim = lampBench();
    sim.press('PB1');
    sim.run(100);
    expect(sim.state().powered).toBe(false);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(sim.log.valueAt('V:PL1.+', 90)).toBe(0);
  });

  it('step は既定10ms、run は指定時刻まで進める（§5.2）', () => {
    const sim = lampBench();
    expect(sim.tMs).toBe(0);
    sim.step();
    expect(sim.tMs).toBe(TICK_MS);
    sim.run(100);
    expect(sim.tMs).toBe(100);
    expect(sim.log.transitions('POWER')[0]?.tMs).toBe(0);
  });

  it('監視端子の電位がログに残る（§5.7）', () => {
    const sim = lampBench();
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    expect(sim.log.valueAt('V:PL1.+', 90)).toBeCloseTo(23.99, 1);
    expect(sim.log.valueAt('PL1.level', 90)).toBe(2);
  });

  it('タイマ設定はレンジに丸めて反映される（§5.3.2）', () => {
    const sim = bench([createPowerSupply('PS'), createTimer4c('T1', 3000)], []);
    sim.setTimerPreset('T1', 20_000);
    expect(sim.state().timers['T1']?.presetMs).toBe(10_000);
    sim.setTimerPreset('T1', 5000);
    expect(sim.state().timers['T1']?.presetMs).toBe(5000);
    expect(() => sim.setTimerPreset('XX', 1000)).toThrow(SimulationError);
  });

  it('存在しない押ボタンの操作は SimulationError', () => {
    const sim = lampBench();
    expect(() => sim.press('PB9')).toThrow(SimulationError);
    expect(() => sim.release('PB9')).toThrow(SimulationError);
  });

  it('電線の追加と削除が次のtickから反映される', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+')],
    );
    powerOn(sim);
    sim.run(50);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.addWire(w('w2', 'PL1.-', 'PS.-'));
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    expect(sim.removeWire('w2')).toBe(true);
    sim.run(150);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });
});
