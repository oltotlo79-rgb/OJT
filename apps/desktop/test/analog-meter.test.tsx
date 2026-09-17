import { NEEDLE_FULL_SCALE_DEG } from '@ojt/circuit-sim';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import {
  AnalogMeter,
  needleTip,
  ohmScaleTicks,
  voltScaleTicks,
} from '../src/renderer/panels/AnalogMeter.js';

/**
 * アナログ計器（Plan 2B Task 6）。設計仕様 §9.3。
 */

afterEach(() => {
  cleanup();
});

describe('needleTip（扇の写像）', () => {
  it('0度は左上、フルスケールは右上へ向く', () => {
    const left = needleTip(0, 100, 100, 50);
    const right = needleTip(NEEDLE_FULL_SCALE_DEG, 100, 100, 50);
    expect(left.x).toBeLessThan(100);
    expect(right.x).toBeGreaterThan(100);
    // SVG は y が下向きなので、上を向く針は y が中心より小さい
    expect(left.y).toBeLessThan(100);
    expect(right.y).toBeLessThan(100);
    // 左右対称
    expect(100 - left.x).toBeCloseTo(right.x - 100, 6);
    expect(left.y).toBeCloseTo(right.y, 6);
  });

  it('真ん中（45度）は真上を向く', () => {
    const middle = needleTip(NEEDLE_FULL_SCALE_DEG / 2, 100, 100, 50);
    expect(middle.x).toBeCloseTo(100, 6);
    expect(middle.y).toBeCloseTo(50, 6);
  });

  it('可動範囲の外は端で止まる', () => {
    expect(needleTip(-30, 100, 100, 50)).toEqual(needleTip(0, 100, 100, 50));
    expect(needleTip(200, 100, 100, 50)).toEqual(needleTip(NEEDLE_FULL_SCALE_DEG, 100, 100, 50));
  });
});

describe('voltScaleTicks（線形。§9.3）', () => {
  it('0 からレンジ値まで等間隔に5本並ぶ', () => {
    const ticks = voltScaleTicks(10);
    expect(ticks.map((t) => t.label)).toEqual(['0', '2.5', '5', '7.5', '10']);
    expect(ticks.map((t) => t.deg)).toEqual([0, 22.5, 45, 67.5, 90]);
  });

  it('2.5V レンジでも読める刻みになる', () => {
    expect(voltScaleTicks(2.5).map((t) => t.label)).toEqual(['0', '0.63', '1.3', '1.9', '2.5']);
  });
});

describe('ohmScaleTicks（中央目盛方式。§9.3）', () => {
  it('右端が0Ω・左端が∞になる', () => {
    const ticks = ohmScaleTicks(10);
    expect(ticks[0]?.label).toBe('0');
    expect(ticks[0]?.deg).toBe(NEEDLE_FULL_SCALE_DEG);
    expect(ticks.at(-1)?.label).toBe('∞');
    expect(ticks.at(-1)?.deg).toBe(0);
  });

  it('×10 レンジの 120Ω（内部抵抗と同値）が真ん中に来る', () => {
    const ticks = ohmScaleTicks(10);
    // 120Ω は刻みに無いので、式そのもので確かめる: 90 × 120/(120+120) = 45
    const hundred = ticks.find((t) => t.label === '100');
    const twoHundred = ticks.find((t) => t.label === '200');
    expect(hundred?.deg).toBeGreaterThan(45);
    expect(twoHundred?.deg).toBeLessThan(45);
  });

  it('倍率が変わると目盛の値も倍率ぶん動く', () => {
    expect(ohmScaleTicks(1).map((t) => t.label)).toContain('20');
    expect(ohmScaleTicks(1000).map((t) => t.label)).toContain('20000');
  });
});

describe('AnalogMeter の描画', () => {
  beforeEach(() => {
    useStore.setState({
      tester: { ...useStore.getState().tester, kind: 'analog', mode: 'DCV', voltRange: 50 },
      snapshot: {
        ...useStore.getState().snapshot,
        tester: {
          kind: 'analog',
          mode: 'DCV',
          value: 24,
          display: '24.00 V',
          targetDeg: 43.2,
          needleDeg: 43.2,
          overRange: false,
          live: false,
          conductive: false,
        },
      },
    });
  });

  it('針と目盛を描く', () => {
    render(<AnalogMeter />);
    const svg = screen.getByTestId('analog-meter');
    expect(svg.querySelector('[data-testid="analog-needle"]')).toBeTruthy();
    expect(svg.textContent).toContain('50');
  });

  it('針の角度を data 属性で出す（E2Eとテストが読めるように）', () => {
    render(<AnalogMeter />);
    expect(screen.getByTestId('analog-needle').getAttribute('data-deg')).toBe('43.20');
  });

  it('Ωレンジでは倍率つきの目盛になる', () => {
    useStore.setState({
      tester: { ...useStore.getState().tester, mode: 'OHM', ohmRange: 1000 },
    });
    render(<AnalogMeter />);
    expect(screen.getByTestId('analog-meter').textContent).toContain('∞');
    expect(screen.getByTestId('analog-meter').textContent).toContain('20000');
  });
});
