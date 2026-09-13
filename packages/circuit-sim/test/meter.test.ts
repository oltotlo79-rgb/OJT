import { describe, expect, it } from 'vitest';
import {
  continuity,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  equivalentResistance,
  measureAcVolts,
  measureResistance,
  measureVoltage,
  OVER_RANGE_OHMS,
} from '../src/index.js';
import { bench, net, powerOn, t, w } from './helpers/circuits.js';

describe('meter', () => {
  it('DCVは赤プローブ − 黒プローブ（§5.5）', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    powerOn(sim);
    sim.run(50);
    expect(measureVoltage(sim, t('PS.-'), t('PS.+')).volts).toBeCloseTo(23.996, 2);
    expect(measureVoltage(sim, t('PS.+'), t('PS.-')).volts).toBeCloseTo(-23.996, 2);
    expect(measureAcVolts().volts).toBe(0);
  });

  it('無通電のコイル抵抗は650Ω（調査資料 §6.3）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    expect(equivalentResistance(netlist, t('CR1.13'), t('CR1.14'))).toBeCloseTo(650, 2);
  });

  it('開放はOL、10MΩ超もOL（§5.5）', () => {
    const sim = bench([createPowerSupply('PS'), createRelay4c('CR1')], []);
    const reading = measureResistance(sim, t('CR1.1'), t('CR1.5'));
    expect(reading.overRange).toBe(true);
    expect(reading.display).toBe('OL');
    expect(reading.ohms).toBe(Number.POSITIVE_INFINITY);
    expect(OVER_RANGE_OHMS).toBe(10_000_000);
  });

  it('導通は50Ω以下（§5.5）', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    expect(continuity(sim, t('PS.+'), t('PB1.c')).conductive).toBe(true);
    expect(continuity(sim, t('PS.+'), t('PB1.c')).display).toBe('導通');
    const openContact = continuity(sim, t('PB1.c'), t('PB1.a'));
    expect(openContact.conductive).toBe(false);
    expect(openContact.display).toBe('OL');
    sim.press('PB1');
    expect(continuity(sim, t('PB1.c'), t('PB1.a')).conductive).toBe(true);
    const lamp = continuity(sim, t('PL1.+'), t('PL1.-'));
    expect(lamp.conductive).toBe(false);
    expect(lamp.display).toBe('−−−');
    expect(lamp.ohms).toBeCloseTo(2400, 1);
  });

  it('通電中にΩを当てると ohm-on-live でOL（§5.6 #1）', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    powerOn(sim);
    sim.run(50);
    const reading = measureResistance(sim, t('PS.-'), t('PS.+'));
    expect(reading.live).toBe(true);
    expect(reading.display).toBe('OL');
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
    expect(continuity(sim, t('PS.-'), t('PS.+')).live).toBe(true);
    expect(sim.events.countOf('ohm-on-live')).toBe(2);
  });

  it('測定してもネットリストは元に戻る', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    powerOn(sim);
    sim.run(50);
    const before = sim.netlist.parts.length;
    measureResistance(sim, t('CR1.1'), t('CR1.5'));
    expect(sim.netlist.parts.length).toBe(before);
    sim.run(100);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
  });
});
