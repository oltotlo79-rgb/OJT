import { describe, expect, it } from 'vitest';
import {
  continuity,
  createPowerSupply,
  createRelay4c,
  equivalentResistance,
  HAZARD_KINDS,
  measureAcVolts,
  measureResistance,
  measureVoltage,
  OVER_RANGE_OHMS,
} from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

/** 通電済みのPS+CR1ベンチ。コイル端子がそのまま電源両極に直結される。 */
function poweredBench() {
  const sim = bench(
    [createPowerSupply('PS'), createRelay4c('CR1')],
    [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
  );
  powerOn(sim);
  sim.run(50);
  return sim;
}

describe('ohm-on-live は probe placement ごとに1回だけ発行する（§5.6 #1）', () => {
  it('measureResistance: 同じ活線ペアの連続呼び出しは1回、ペアが変われば増える', () => {
    const sim = poweredBench();

    for (let i = 0; i < 5; i += 1) measureResistance(sim, t('PS.-'), t('PS.+'));
    expect(sim.events.countOf('ohm-on-live')).toBe(1);

    // 別ペア（電気的には同じ2ネットだが端子IDが違う）→ 新規発行
    measureResistance(sim, t('CR1.13'), t('CR1.14'));
    expect(sim.events.countOf('ohm-on-live')).toBe(2);

    // 同一ネット同士（0V・非活線）を挟む
    measureResistance(sim, t('PS.+'), t('CR1.14'));
    expect(sim.events.countOf('ohm-on-live')).toBe(2);

    // 活線ペアに戻る → 直前記録は非活線ペアなので再発行
    measureResistance(sim, t('PS.-'), t('PS.+'));
    expect(sim.events.countOf('ohm-on-live')).toBe(3);
  });

  it('continuity は Ω レンジと独立に発行判定する', () => {
    const sim = poweredBench();

    for (let i = 0; i < 3; i += 1) continuity(sim, t('PS.-'), t('PS.+'));
    expect(sim.events.countOf('ohm-on-live')).toBe(1);

    // レンジを切り替えると（別レンジ扱いなので）再発行
    measureResistance(sim, t('PS.-'), t('PS.+'));
    expect(sim.events.countOf('ohm-on-live')).toBe(2);
  });

  it('test/meter.test.ts の単発呼び出しの期待値と同じ流れを再確認する', () => {
    const sim = poweredBench();
    expect(measureResistance(sim, t('PS.-'), t('PS.+')).live).toBe(true);
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
    expect(continuity(sim, t('PS.-'), t('PS.+')).live).toBe(true);
    expect(sim.events.countOf('ohm-on-live')).toBe(2);
  });
});

describe('OhmReading.rawOhms', () => {
  it('孤立ノードはOLクランプ前の生値をそのまま持つ（数値安定化用リークのため有限大の場合がある）（§5.5）', () => {
    const sim = bench([createPowerSupply('PS'), createRelay4c('CR1')], []);
    const reading = measureResistance(sim, t('CR1.1'), t('CR1.5'));
    expect(reading.overRange).toBe(true);
    // クランプ前の生値＝equivalentResistanceの計算結果そのもの（Infinityのこともあれば、
    // 数値安定化用のリークにより10MΩ超の有限大になることもある）。
    expect(reading.rawOhms).toBe(equivalentResistance(sim.netlist, t('CR1.1'), t('CR1.5')));
    if (Number.isFinite(reading.rawOhms)) {
      expect(reading.rawOhms).toBeGreaterThan(OVER_RANGE_OHMS);
    }
  });

  it('活線で拒否されたときは NaN（§5.6 #1）', () => {
    const sim = poweredBench();
    const reading = measureResistance(sim, t('PS.-'), t('PS.+'));
    expect(reading.live).toBe(true);
    expect(Number.isNaN(reading.rawOhms)).toBe(true);
  });

  it('OL未満の実測ではクランプ前後の値が一致する（無通電のコイル抵抗650Ω）', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    const reading = measureResistance(sim, t('CR1.13'), t('CR1.14'));
    expect(reading.live).toBe(false);
    expect(reading.overRange).toBe(false);
    expect(reading.rawOhms).toBeCloseTo(650, 2);
    expect(reading.ohms).toBe(reading.rawOhms);
  });
});

describe('VoltReading.display', () => {
  it('未対応のACVは数値の0Vと区別する', () => {
    expect(measureAcVolts().display).toBe('ACV未対応');
  });

  it('非通電回路は "0.00 V"', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    const reading = measureVoltage(sim, t('PS.-'), t('PS.+'));
    expect(reading.volts).toBe(0);
    expect(reading.display).toBe('0.00 V');
  });

  it('小数点2桁と単位、符号は volts と整合する（§5.5）', () => {
    const sim = poweredBench();
    const positive = measureVoltage(sim, t('PS.-'), t('PS.+'));
    expect(positive.volts).toBeGreaterThan(0);
    expect(positive.display).toBe(`${positive.volts.toFixed(2)} V`);
    expect(positive.display).not.toMatch(/^-/);

    const negative = measureVoltage(sim, t('PS.+'), t('PS.-'));
    expect(negative.volts).toBeLessThan(0);
    expect(negative.display).toBe(`${negative.volts.toFixed(2)} V`);
    expect(negative.display).toMatch(/^-\d+\.\d{2} V$/);
  });
});

describe('HAZARD_KINDS', () => {
  it('overcurrent を含み、重複がない', () => {
    expect(HAZARD_KINDS).toContain('overcurrent');
    expect(new Set(HAZARD_KINDS).size).toBe(HAZARD_KINDS.length);
  });
});
