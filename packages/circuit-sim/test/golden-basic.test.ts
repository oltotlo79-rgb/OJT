import { describe, expect, it } from 'vitest';
import { createLamp, createPowerSupply, createPushButton, createRelay4c } from '../src/index.js';
import { bench, firstTrue, powerOn, w } from './helpers/circuits.js';

describe('基本回路', () => {
  it('a接点: 押下で点灯、離すと消灯', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    powerOn(sim);
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.press('PB1');
    sim.run(200);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.release('PB1');
    sim.run(300);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(firstTrue(sim, 'PL1')).toBe(100);
  });

  it('b接点: 押下で消灯', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.b', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    powerOn(sim);
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB1');
    sim.run(200);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('AND: 2個同時押下でのみ点灯', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'PB2.c'),
        w('w3', 'PB2.a', 'PL1.+'),
        w('w4', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.press('PB2');
    sim.run(200);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
  });

  it('OR: どちらかの押下で点灯', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PS.+', 'PB2.c'),
        w('w3', 'PB1.a', 'PL1.+'),
        w('w4', 'PB2.a', 'PL1.+'),
        w('w5', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB2');
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
  });

  it('自己保持（停止接点先頭形）', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB2.c'),
        w('w2', 'PB2.b', 'PB1.c'),
        w('w3', 'PB1.a', 'CR1.14'),
        w('w4', 'PB2.b', 'CR1.9'),
        w('w5', 'CR1.5', 'CR1.14'),
        w('w6', 'CR1.13', 'PS.-'),
        w('w7', 'PS.+', 'CR1.10'),
        w('w8', 'CR1.6', 'PL1.+'),
        w('w9', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.run(100);
    sim.press('PB1');
    sim.run(150);
    sim.release('PB1');
    sim.run(400);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB2');
    sim.run(500);
    sim.release('PB2');
    sim.run(600);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('自己保持（起動先頭形）', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'PB2.c'),
        w('w3', 'PS.+', 'CR1.9'),
        w('w4', 'CR1.5', 'PB2.c'),
        w('w5', 'PB2.b', 'CR1.14'),
        w('w6', 'CR1.13', 'PS.-'),
        w('w7', 'PS.+', 'CR1.10'),
        w('w8', 'CR1.6', 'PL1.+'),
        w('w9', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    sim.release('PB1');
    sim.run(300);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB2');
    sim.run(400);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('インターロック（先行優先）', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createRelay4c('CR2'),
        createLamp('PL1', '白'),
        createLamp('PL2', '黄'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'CR1.14'),
        w('w3', 'PS.+', 'CR1.9'),
        w('w4', 'CR1.5', 'CR1.14'),
        w('w5', 'CR1.13', 'CR2.11'),
        w('w6', 'CR2.3', 'PS.-'),
        w('w7', 'PS.+', 'PB2.c'),
        w('w8', 'PB2.a', 'CR2.14'),
        w('w9', 'PS.+', 'CR2.9'),
        w('w10', 'CR2.5', 'CR2.14'),
        w('w11', 'CR2.13', 'CR1.11'),
        w('w12', 'CR1.3', 'PS.-'),
        w('w13', 'PS.+', 'CR1.10'),
        w('w14', 'CR1.6', 'PL1.+'),
        w('w15', 'PL1.-', 'PS.-'),
        w('w16', 'PS.+', 'CR2.10'),
        w('w17', 'CR2.6', 'PL2.+'),
        w('w18', 'PL2.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    sim.release('PB1');
    sim.run(200);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    sim.press('PB2');
    sim.run(400);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().relays['CR2']?.contactsOn).toBe(false);
    expect(sim.state().lamps['PL2']?.level).toBe('off');
  });

  it('新入力優先', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createRelay4c('CR2'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'CR1.14'),
        w('w3', 'PB1.b', 'PB2.c'),
        w('w4', 'PB2.a', 'CR2.14'),
        w('w5', 'PB2.b', 'CR1.9'),
        w('w6', 'CR1.5', 'CR1.14'),
        w('w7', 'CR1.13', 'PS.-'),
        w('w8', 'PB1.b', 'CR2.9'),
        w('w9', 'CR2.5', 'CR2.14'),
        w('w10', 'CR2.13', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    sim.release('PB1');
    sim.run(200);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    sim.press('PB2');
    sim.run(300);
    sim.release('PB2');
    sim.run(400);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
    expect(sim.state().relays['CR2']?.contactsOn).toBe(true);
    sim.press('PB1');
    sim.run(500);
    sim.release('PB1');
    sim.run(600);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().relays['CR2']?.contactsOn).toBe(false);
  });

  it('コイル極性違反では励磁しない', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'CR1.13'), w('w3', 'CR1.14', 'PS.-')],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(300);
    expect(sim.state().relays['CR1']?.coilVolts).toBeLessThan(-20);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
  });
});
