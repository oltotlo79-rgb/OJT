import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTimer4c,
} from '../src/index.js';
import type { Simulation } from '../src/index.js';
import { bench, firstTrue, powerOn, w } from './helpers/circuits.js';

describe('タイマ回路', () => {
  it('オンディレー3秒', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createTimer4c('T1', 3000),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'T1.14'),
        w('w3', 'T1.13', 'PS.-'),
        w('w4', 'PS.+', 'T1.9'),
        w('w5', 'T1.5', 'PL1.+'),
        w('w6', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(4000);
    const on = firstTrue(sim, 'PL1');
    expect(on).toBeDefined();
    expect(Math.abs((on ?? 0) - 3000)).toBeLessThanOrEqual(10);
  });

  it('オフディレー（リレー併用）: 停止から約500ms後に消灯', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createTimer4c('T1', 500),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'PB2.c'),
        w('w3', 'PS.+', 'CR1.9'),
        w('w4', 'CR1.5', 'PB2.c'),
        w('w5', 'PB2.b', 'CR1.14'),
        w('w6', 'CR1.13', 'PS.-'),
        w('w7', 'PS.+', 'CR1.11'),
        w('w8', 'CR1.3', 'T1.14'),
        w('w9', 'T1.13', 'PS.-'),
        w('w10', 'PS.+', 'CR1.12'),
        w('w11', 'CR1.8', 'PL1.+'),
        w('w12', 'PS.+', 'T1.10'),
        w('w13', 'T1.2', 'PL1.+'),
        w('w14', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.run(1000);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.press('PB1');
    sim.run(1100);
    sim.release('PB1');
    sim.run(1500);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB2');
    sim.run(1600);
    sim.release('PB2');
    sim.run(3000);
    const offs = sim.log.transitions('PL1').filter((e) => e.tMs > 1500 && e.value === false);
    expect(offs.length).toBe(1);
    expect(Math.abs((offs[0]?.tMs ?? 0) - 2020)).toBeLessThanOrEqual(30);
  });

  it('ワンショット（リレー併用）: 約500msだけ動作して復帰する', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createRelay4c('CR1'),
        createTimer4c('T1', 500),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'T1.11'),
        w('w3', 'PS.+', 'CR1.9'),
        w('w4', 'CR1.5', 'T1.11'),
        w('w5', 'T1.3', 'CR1.14'),
        w('w6', 'CR1.13', 'PS.-'),
        w('w7', 'PS.+', 'CR1.10'),
        w('w8', 'CR1.6', 'T1.14'),
        w('w9', 'T1.13', 'PS.-'),
        w('w10', 'PS.+', 'CR1.12'),
        w('w11', 'CR1.8', 'PL1.+'),
        w('w12', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.run(100);
    sim.press('PB1');
    sim.run(150);
    sim.release('PB1');
    sim.run(2000);
    const edges = sim.log.transitions('PL1');
    const on = edges.find((e) => e.value === true)?.tMs ?? -1;
    const off = edges.find((e) => e.value === false && e.tMs > on)?.tMs ?? -1;
    expect(on).toBeGreaterThan(100);
    expect(off - on).toBeGreaterThan(450);
    expect(off - on).toBeLessThan(600);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(sim.events.chatters().length).toBe(0);
  });

  it('フリッカ（CR2個＋T2個）: 周期的に点滅しチャタリングしない', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createRelay4c('CR1'),
        createRelay4c('CR2'),
        createTimer4c('T1', 500),
        createTimer4c('T2', 500),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'CR1.11'),
        w('w3', 'CR1.3', 'T1.14'),
        w('w4', 'T1.13', 'PS.-'),
        w('w5', 'PB1.a', 'CR2.11'),
        w('w6', 'CR2.3', 'T1.9'),
        w('w7', 'T1.5', 'CR1.14'),
        w('w8', 'CR2.3', 'CR1.9'),
        w('w9', 'CR1.5', 'CR1.14'),
        w('w10', 'CR1.13', 'PS.-'),
        w('w11', 'PB1.a', 'CR1.10'),
        w('w12', 'CR1.6', 'T2.14'),
        w('w13', 'T2.13', 'PS.-'),
        w('w14', 'PB1.a', 'T2.9'),
        w('w15', 'T2.5', 'CR2.14'),
        w('w16', 'CR2.13', 'PS.-'),
        w('w17', 'PB1.a', 'CR1.12'),
        w('w18', 'CR1.8', 'PL1.+'),
        w('w19', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(4000);
    const edges = sim.log.transitions('PL1').filter((e) => e.tMs > 0);
    expect(edges.length).toBeGreaterThanOrEqual(4);
    const gaps: number[] = [];
    for (let i = 1; i < edges.length; i += 1) {
      gaps.push((edges[i]?.tMs ?? 0) - (edges[i - 1]?.tMs ?? 0));
    }
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(400);
      expect(gap).toBeLessThan(700);
    }
    expect(sim.events.chatters().length).toBe(0);
    const t1Off = sim.log.transitions('T1.coil');
    expect(t1Off.length).toBeGreaterThan(2);
  });

  it('タイマ復帰時間: 断90msなら経過時間を保持し、110msならリセットする', () => {
    const build = (): Simulation =>
      bench(
        [createPowerSupply('PS'), createPushButton('PB1'), createTimer4c('T1', 1000)],
        [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'T1.14'), w('w3', 'T1.13', 'PS.-')],
      );

    const hold = build();
    powerOn(hold);
    hold.press('PB1');
    hold.run(500);
    hold.release('PB1');
    hold.run(590);
    hold.press('PB1');
    hold.run(2500);
    const holdAt = firstTrue(hold, 'T1') ?? -1;
    expect(Math.abs(holdAt - 1090)).toBeLessThanOrEqual(20);

    const reset = build();
    powerOn(reset);
    reset.press('PB1');
    reset.run(500);
    reset.release('PB1');
    reset.run(610);
    reset.press('PB1');
    reset.run(2500);
    const resetAt = firstTrue(reset, 'T1') ?? -1;
    expect(Math.abs(resetAt - 1600)).toBeLessThanOrEqual(20);
  });
});
