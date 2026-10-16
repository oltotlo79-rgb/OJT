import { describe, expect, it } from 'vitest';
import { getDialect } from '../src/index.js';

/**
 * モニタ中のタイマ・カウンタの現在値（v2.1.0 監査 P5）。数え方（加算式・減算式）と書き方は
 * メーカーで違う。オムロン・シャープは PLC調査資料の命令表どおり減算式。
 */
describe('現在値の数え方と書き方', () => {
  it('counts up on Mitsubishi and writes the count without K', () => {
    const rule = getDialect('mitsubishi').presentValue;
    expect(rule.countsDown).toBe(false);
    expect(rule.format(12)).toBe('12');
  });

  it('counts down on OMRON (TIM / CNT) and writes four BCD digits without #', () => {
    const rule = getDialect('omron').presentValue;
    expect(rule.countsDown).toBe(true);
    expect(rule.format(18)).toBe('0018');
  });

  it('counts down on SHARP (TMR / CNT) and writes four digits', () => {
    const rule = getDialect('sharp').presentValue;
    expect(rule.countsDown).toBe(true);
    expect(rule.format(18)).toBe('0018');
  });

  it('writes JTEKT values in the same hexadecimal form as the preset, without H', () => {
    const rule = getDialect('jtekt').presentValue;
    expect(rule.countsDown).toBe(false);
    expect(rule.format(12)).toBe('000C');
  });
});
