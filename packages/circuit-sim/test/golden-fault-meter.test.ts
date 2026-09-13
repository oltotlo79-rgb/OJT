import { describe, expect, it } from 'vitest';
import {
  continuity,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  equivalentResistance,
  injectFault,
  measureResistance,
  measureVoltage,
} from '../src/index.js';
import type { Simulation } from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

describe('故障・測定・保護', () => {
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

  it('リレーのヒステリシス: 帯域内では直前の状態を保つ', () => {
    const held = coilBench();
    powerOn(held);
    held.press('PB1');
    held.run(200);
    expect(held.state().relays['CR1']?.contactsOn).toBe(true);
    injectFault(held.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 1000);
    held.run(500);
    const volts = held.state().relays['CR1']?.coilVolts ?? 0;
    expect(volts).toBeGreaterThan(2.4);
    expect(volts).toBeLessThan(19.2);
    expect(held.state().relays['CR1']?.contactsOn).toBe(true);
    held.release('PB1');
    held.run(800);
    expect(held.state().relays['CR1']?.contactsOn).toBe(false);

    const never = coilBench();
    injectFault(never.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 1000);
    powerOn(never);
    never.press('PB1');
    never.run(500);
    expect(never.state().relays['CR1']?.contactsOn).toBe(false);
  });

  it('接触不良500Ωでコイルが19.2V未満になり不動作', () => {
    const sim = coilBench();
    injectFault(sim.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 500);
    powerOn(sim);
    sim.press('PB1');
    sim.run(500);
    expect(sim.state().relays['CR1']?.coilVolts ?? 0).toBeCloseTo(13.564, 2);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
  });

  it('接触不良3000Ωでランプが暗点灯', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    injectFault(sim.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 3000);
    powerOn(sim);
    sim.press('PB1');
    sim.run(200);
    expect(sim.state().lamps['PL1']?.volts ?? 0).toBeCloseTo(10.666, 2);
    expect(sim.state().lamps['PL1']?.level).toBe('dim');
  });

  it('短絡で保護が動作し、正しい手順でのみ復帰する', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+'), w('w2', 'PL1.-', 'PS.-'), w('short', 'PS.+', 'PS.-')],
    );
    powerOn(sim);
    sim.step();
    expect(sim.state().tripped).toBe(true);
    expect(sim.events.hazards('short-circuit-power-on').length).toBe(1);
    sim.setSwitch(false);
    sim.setSwitch(true);
    expect(sim.state().tripped).toBe(true);
    sim.setSwitch(false);
    sim.setBreaker(false);
    sim.setBreaker(true);
    sim.setSwitch(true);
    expect(sim.state().tripped).toBe(false);
    sim.step();
    expect(sim.state().tripped).toBe(true);
    sim.setSwitch(false);
    sim.setBreaker(false);
    sim.removeWire('short');
    sim.setBreaker(true);
    sim.setSwitch(true);
    expect(sim.state().tripped).toBe(false);
    sim.run(sim.tMs + 200);
    expect(sim.state().tripped).toBe(false);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
  });

  it('電源ON/OFFの手順違反でイベントが出る', () => {
    const sim = bench([createPowerSupply('PS')], []);
    sim.setSwitch(true);
    expect(sim.events.countOf('power-sequence-violation')).toBe(1);
    sim.setBreaker(true);
    expect(sim.events.countOf('power-sequence-violation')).toBe(2);
    sim.setBreaker(false);
    expect(sim.events.countOf('power-sequence-violation')).toBe(3);
    const ok = bench([createPowerSupply('PS')], []);
    ok.setBreaker(true);
    ok.setSwitch(true);
    ok.setSwitch(false);
    ok.setBreaker(false);
    expect(ok.events.countOf('power-sequence-violation')).toBe(0);
  });

  it('故障注入: wire-open / 溶着 / コイル断線 / レアショート', () => {
    const open = coilBench();
    injectFault(open.netlist, { wireId: 'w3' }, 'wire-open');
    powerOn(open);
    open.press('PB1');
    open.run(300);
    expect(open.state().relays['CR1']?.contactsOn).toBe(false);

    const welded = coilBench();
    injectFault(welded.netlist, { partId: 'CR1', elementIndex: 2 }, 'contact-welded');
    powerOn(welded);
    welded.run(300);
    expect(welded.state().lamps['PL1']?.level).toBe('lit');
    const b1 = welded.netlist.parts
      .find((p) => p.id === 'CR1')
      ?.elements.find((e) => e.id === 'CR1:b1');
    expect(b1?.kind === 'contact' ? b1.fault?.kind : undefined).toBe('open');

    const broken = coilBench();
    injectFault(broken.netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-open');
    powerOn(broken);
    broken.press('PB1');
    broken.run(300);
    expect(broken.state().relays['CR1']?.contactsOn).toBe(false);

    const layer = coilBench();
    injectFault(layer.netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-layer-short');
    powerOn(layer);
    layer.press('PB1');
    layer.run(300);
    expect(layer.state().relays['CR1']?.contactsOn).toBe(true);
    expect(layer.state().lamps['PL1']?.level).toBe('lit');
  });

  it('レアショートのコイル抵抗は ratio どおりに下がる', () => {
    for (const [ratio, ohms] of [
      [0.65, 422.5],
      [0.4, 260],
      [0.85, 552.5],
    ] as const) {
      const sim = bench(
        [createPowerSupply('PS'), createRelay4c('CR1')],
        [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
      );
      injectFault(sim.netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-layer-short', ratio);
      expect(equivalentResistance(sim.netlist, t('CR1.13'), t('CR1.14'))).toBeCloseTo(ohms, 1);
    }
  });

  it('無通電の抵抗測定は回り込みを含む', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1'), createLamp('PL1', '白')],
      [
        w('w1', 'PS.+', 'CR1.14'),
        w('w2', 'CR1.13', 'PS.-'),
        w('w3', 'PS.+', 'PL1.+'),
        w('w4', 'PL1.-', 'PS.-'),
      ],
    );
    expect(measureResistance(sim, t('CR1.13'), t('CR1.14')).ohms).toBeCloseTo(511.475, 1);
    injectFault(sim.netlist, { partId: 'PL1', elementIndex: 0 }, 'lamp-open');
    expect(measureResistance(sim, t('CR1.13'), t('CR1.14')).ohms).toBeCloseTo(650, 1);
    injectFault(sim.netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-open');
    expect(measureResistance(sim, t('CR1.13'), t('CR1.14')).overRange).toBe(true);
  });

  it('電圧測定・導通・通電中Ω', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    expect(continuity(sim, t('PS.+'), t('CR1.14')).conductive).toBe(true);
    expect(continuity(sim, t('CR1.1'), t('CR1.5')).conductive).toBe(false);
    powerOn(sim);
    sim.run(100);
    expect(measureVoltage(sim, t('PS.-'), t('PS.+')).volts).toBeCloseTo(23.996, 2);
    expect(measureVoltage(sim, t('PS.+'), t('PS.-')).volts).toBeCloseTo(-23.996, 2);
    const reading = measureResistance(sim, t('CR1.13'), t('CR1.14'));
    expect(reading.live).toBe(true);
    expect(reading.display).toBe('OL');
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
  });

  it('決定論: 同じ操作列で同じログになる', () => {
    const script = (sim: Simulation): void => {
      powerOn(sim);
      sim.press('PB1');
      sim.run(200);
      sim.release('PB1');
      sim.run(600);
    };
    const a = coilBench();
    const b = coilBench();
    script(a);
    script(b);
    expect(JSON.stringify(b.log.entries())).toBe(JSON.stringify(a.log.entries()));
  });

  it('1端子の電線本数を数え、上限超過でイベントが出る', () => {
    const sim = bench([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    sim.addWire(w('w1', 'PS.+', 'PL1.+'));
    sim.addWire(w('w2', 'PS.+', 'PL1.-'));
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(0);
    sim.addWire(w('w3', 'PS.+', 'PS.-'));
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(1);
  });
});
