import { describe, expect, it } from 'vitest';
import { createLamp, createPowerSupply, createPushButton, createTimer4c } from '../src/index.js';
import { bench, powerOn, w } from './helpers/circuits.js';

describe('禁則回路', () => {
  it('タイマ自己遮断ワンショットはチャタリングする', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createTimer4c('T1', 300),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'T1.11'),
        w('w3', 'T1.3', 'T1.14'),
        w('w4', 'T1.13', 'PS.-'),
        w('w5', 'PB1.a', 'T1.9'),
        w('w6', 'T1.5', 'PL1.+'),
        w('w7', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(2000);
    expect(sim.events.chatters().length).toBeGreaterThan(0);
    expect(sim.events.chatters('T1').length).toBeGreaterThan(0);
  });

  it('タイマ2個だけのフリッカはチャタリングする', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createTimer4c('T1', 300),
        createTimer4c('T2', 300),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'T2.11'),
        w('w3', 'T2.3', 'T1.14'),
        w('w4', 'T1.13', 'PS.-'),
        w('w5', 'PB1.a', 'T1.9'),
        w('w6', 'T1.5', 'T2.14'),
        w('w7', 'T2.13', 'PS.-'),
        w('w8', 'PB1.a', 'T1.10'),
        w('w9', 'T1.6', 'PL1.+'),
        w('w10', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(3000);
    expect(sim.events.chatters().length).toBeGreaterThan(0);
  });
});
