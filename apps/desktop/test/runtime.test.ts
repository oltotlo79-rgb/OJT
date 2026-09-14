import { TICK_MS } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { formatElapsed, formatSavedAt, planTicks } from '../src/worker/runtime.js';
import { MAX_CATCHUP_TICKS } from '../src/worker/protocol.js';

describe('planTicks', () => {
  it('1tick未満の遅れでは進めない', () => {
    expect(planTicks(1005, 1000, TICK_MS)).toEqual({
      ticks: 0,
      nextBaselineMs: 1000,
      dropped: 0,
    });
  });

  it('遅れたぶんだけ進めて基準を進める', () => {
    expect(planTicks(1055, 1000, TICK_MS)).toEqual({
      ticks: 5,
      nextBaselineMs: 1050,
      dropped: 0,
    });
  });

  it('追従上限までは取り返す', () => {
    const plan = planTicks(1000 + MAX_CATCHUP_TICKS * TICK_MS, 1000, TICK_MS);
    expect(plan.ticks).toBe(MAX_CATCHUP_TICKS);
    expect(plan.dropped).toBe(0);
  });

  it('ウィンドウ非表示で詰まったぶんは捨てて基準を現在に引き直す', () => {
    const now = 1000 + 5000;
    const plan = planTicks(now, 1000, TICK_MS);
    expect(plan.ticks).toBe(MAX_CATCHUP_TICKS);
    expect(plan.dropped).toBe(500 - MAX_CATCHUP_TICKS);
    expect(plan.nextBaselineMs).toBe(now);
  });

  it('tickMs が0以下なら RangeError', () => {
    expect(() => planTicks(1000, 0, 0)).toThrow(RangeError);
  });
});

describe('formatElapsed', () => {
  it('分:秒.1桁 で整える', () => {
    expect(formatElapsed(0)).toBe('00:00.0');
    expect(formatElapsed(65_400)).toBe('01:05.4');
    expect(formatElapsed(3_723_000)).toBe('62:03.0');
  });

  it('負の値は0として扱う', () => {
    expect(formatElapsed(-5)).toBe('00:00.0');
  });

  it('秒の繰り上がりで `:60.0` を出さない（先に0.1秒へ丸める）', () => {
    expect(formatElapsed(59_950)).toBe('01:00.0');
    expect(formatElapsed(119_960)).toBe('02:00.0');
    expect(formatElapsed(3_599_999)).toBe('60:00.0');
    // 丸めの境目の手前は繰り上がらない
    expect(formatElapsed(59_940)).toBe('00:59.9');
  });
});

describe('formatSavedAt', () => {
  it('ISO(UTC)文字列をローカル日時表記に整える（`T`/`Z`を含まない）', () => {
    const formatted = formatSavedAt('2026-09-14T09:00:00.000Z');
    expect(formatted).not.toContain('T');
    expect(formatted).not.toContain('Z');
    expect(formatted).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it('不正な文字列なら空文字を返す（呼び出し側は時刻無しの文言にする）', () => {
    expect(formatSavedAt('not-a-date')).toBe('');
  });

  it('空文字なら空文字を返す', () => {
    expect(formatSavedAt('')).toBe('');
  });
});
