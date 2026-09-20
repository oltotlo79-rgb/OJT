import { describe, expect, it } from 'vitest';
import {
  BUZZER_OHMS,
  clampPreset,
  createBuzzer,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTerminalBlockLink,
  createTimer4c,
  LAMP_OHMS,
  SOURCE_INTERNAL_OHMS,
  SOURCE_VOLTS,
  terminalId,
  TIMER_RANGE_10S_MS,
} from '../src/index.js';

describe('parts', () => {
  it('リレーは14ピンで c接点4組とコイルを持つ（§5.3.1 / §6.2）', () => {
    const cr = createRelay4c('CR1');
    expect(cr.terminals).toHaveLength(14);
    expect(cr.terminals[0]).toBe('CR1.1');
    expect(cr.terminals[13]).toBe('CR1.14');
    expect(cr.elements).toHaveLength(9);
    const coil = cr.elements[0];
    expect(coil?.from).toBe('CR1.14');
    expect(coil?.to).toBe('CR1.13');
    const pairs = cr.elements
      .filter((e) => e.kind === 'contact')
      .map((e) => `${e.id}:${e.from}-${e.to}`);
    expect(pairs).toEqual([
      'CR1:b1:CR1.9-CR1.1',
      'CR1:a1:CR1.9-CR1.5',
      'CR1:b2:CR1.10-CR1.2',
      'CR1:a2:CR1.10-CR1.6',
      'CR1:b3:CR1.11-CR1.3',
      'CR1:a3:CR1.11-CR1.7',
      'CR1:b4:CR1.12-CR1.4',
      'CR1:a4:CR1.12-CR1.8',
    ]);
  });

  it('タイマはリレーとピン互換で、接点の駆動源が timer になる（§5.3.2 / §6.2）', () => {
    const t1 = createTimer4c('T1', 3000);
    expect(t1.terminals).toEqual(createRelay4c('T1').terminals);
    expect(t1.elements.every((e) => e.kind !== 'contact' || e.driver === 'timer')).toBe(true);
    expect(t1.meta.kind === 'timer-h3y4' ? t1.meta.presetMs : 0).toBe(3000);
    expect(t1.meta.kind === 'timer-h3y4' ? t1.meta.rangeMaxMs : 0).toBe(TIMER_RANGE_10S_MS);
    expect(t1.meta.kind === 'timer-h3y4' ? t1.meta.resetGapMs : 0).toBe(100);
  });

  it('タイマの要素の並びは配列全体で固定（CS-07: 課題JSONの faults[].target.elementIndex の契約）', () => {
    // `parts.ts` の JSDoc（§5.3.2）が明記するとおり、この並びは内蔵C2課題・利用者課題の
    // `faults[].target.elementIndex` が指す配列そのもの。並びを変えると別の故障になる。
    const t1 = createTimer4c('T1', 3000);
    expect(t1.elements).toHaveLength(9);
    const coil = t1.elements[0];
    expect(coil?.kind).toBe('load');
    expect(coil?.from).toBe('T1.14');
    expect(coil?.to).toBe('T1.13');
    const contacts = t1.elements
      .filter((e) => e.kind === 'contact')
      .map((e) => `${e.id}:${e.from}-${e.to}`);
    expect(contacts).toEqual([
      'T1:b1:T1.9-T1.1',
      'T1:a1:T1.9-T1.5',
      'T1:b2:T1.10-T1.2',
      'T1:a2:T1.10-T1.6',
      'T1:b3:T1.11-T1.3',
      'T1:a3:T1.11-T1.7',
      'T1:b4:T1.12-T1.4',
      'T1:a4:T1.12-T1.8',
    ]);
  });

  it('タイマ設定値はレンジに丸められる（§5.3.2）', () => {
    expect(clampPreset(50, 10_000)).toBe(100);
    expect(clampPreset(3000, 10_000)).toBe(3000);
    expect(clampPreset(20_000, 10_000)).toBe(10_000);
    const clamped = createTimer4c('T2', 50);
    expect(clamped.meta.kind === 'timer-h3y4' ? clamped.meta.presetMs : 0).toBe(100);
  });

  it('押ボタンは c/a/b の3端子を持つ（§5.3.3）', () => {
    const pb = createPushButton('PB1');
    expect(pb.terminals).toEqual(['PB1.c', 'PB1.a', 'PB1.b']);
    expect(pb.elements.map((e) => e.id)).toEqual(['PB1:a', 'PB1:b']);
  });

  it('ランプとブザーの抵抗値（§5.1.3）', () => {
    const pl = createLamp('PL1', '白');
    expect(pl.terminals).toEqual(['PL1.+', 'PL1.-']);
    expect(pl.elements[0]?.kind === 'load' ? pl.elements[0].nominalOhms : 0).toBe(LAMP_OHMS);
    const bz = createBuzzer('BZ');
    expect(bz.elements[0]?.kind === 'load' ? bz.elements[0].nominalOhms : 0).toBe(BUZZER_OHMS);
  });

  it('電源は DC24V・内部抵抗0.1Ωで、初期状態は非通電（§5.1.1）', () => {
    const ps = createPowerSupply('PS');
    expect(ps.terminals).toEqual(['PS.+', 'PS.-']);
    const source = ps.elements[0];
    expect(source?.kind).toBe('source');
    if (source?.kind !== 'source') throw new Error('source');
    expect(source.volts).toBe(SOURCE_VOLTS);
    expect(source.internalOhms).toBe(SOURCE_INTERNAL_OHMS);
    expect(source.protectionAmps).toBe(1);
    expect(source.enabled).toBe(false);
  });

  it('端子台リンクは既定で locked（§6.4）', () => {
    const link = createTerminalBlockLink('lk-1', terminalId('PB1', 'c'), terminalId('TB_PB', '1c'));
    expect(link).toEqual({
      kind: 'link',
      id: 'lk-1',
      from: 'PB1.c',
      to: 'TB_PB.1c',
      locked: true,
    });
  });
});
