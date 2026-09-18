import { C, M, SP, T, X, Y } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { getDialect, MITSUBISHI_FX5U, roundTimerPreset, timerBaseMs } from '../src/index.js';

const profile = MITSUBISHI_FX5U;

describe('三菱 FX5U のデバイス表記（§10.5）', () => {
  it('is registered as the mitsubishi dialect', () => {
    expect(getDialect('mitsubishi')).toBe(profile);
    expect(profile.id).toBe('mitsubishi');
    expect(profile.displayName).toContain('FX5U');
  });

  it('formats X and Y in octal and M/T/C in decimal', () => {
    expect(profile.formatDevice(X(0))).toBe('X0');
    expect(profile.formatDevice(X(7))).toBe('X7');
    expect(profile.formatDevice(X(8))).toBe('X10');
    expect(profile.formatDevice(Y(15))).toBe('Y17');
    expect(profile.formatDevice(M(10))).toBe('M10');
    expect(profile.formatDevice(T(200))).toBe('T200');
    expect(profile.formatDevice(C(3))).toBe('C3');
  });

  it('maps the three special devices to the FX numbers (§10.5 / §17 #22)', () => {
    expect(profile.formatDevice(SP(0))).toBe('M8000');
    expect(profile.formatDevice(SP(1))).toBe('M8002');
    expect(profile.formatDevice(SP(2))).toBe('M8013');
    expect(profile.specialDevices).toEqual({ 0: 'M8000', 1: 'M8002', 2: 'M8013' });
  });

  it('parses the dialect notation back into IR devices', () => {
    expect(profile.parseDevice('X10')).toEqual(X(8));
    expect(profile.parseDevice('Y17')).toEqual(Y(15));
    expect(profile.parseDevice('M100')).toEqual(M(100));
    expect(profile.parseDevice('T7')).toEqual(T(7));
    expect(profile.parseDevice('C0')).toEqual(C(0));
    expect(profile.parseDevice('M8002')).toEqual(SP(1));
  });

  it('rejects octal digits 8 and 9 on X and Y (§10.5 の固有バリデーション)', () => {
    expect(profile.parseDevice('X8')).toBeInstanceOf(Error);
    expect(profile.parseDevice('Y9')).toBeInstanceOf(Error);
    expect(String(profile.parseDevice('X8') as Error)).toContain('8進');
  });

  it('rejects unknown prefixes and out-of-range numbers', () => {
    expect(profile.parseDevice('Z0')).toBeInstanceOf(Error);
    expect(profile.parseDevice('')).toBeInstanceOf(Error);
    expect(profile.parseDevice('T9000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('X2000')).toBeInstanceOf(Error);
  });

  it('publishes the device ranges of §10.5', () => {
    expect(profile.deviceRanges.input).toEqual({ radix: 8, prefix: 'X', min: 0, max: 1023 });
    // M8000 以降は特殊リレー帯と重なるため internal.max は 7999（レビュー #M1）
    expect(profile.deviceRanges.internal).toEqual({ radix: 10, prefix: 'M', min: 0, max: 7999 });
    expect(profile.deviceRanges.timer).toEqual({ radix: 10, prefix: 'T', min: 0, max: 7999 });
    expect(profile.deviceRanges.counter.max).toBe(32767);
  });
});

describe('三菱 FX5U のタイマ単位（ゴールデンケース #25 / §8.2 / §17 #20）', () => {
  it('uses 100 ms up to T199, 10 ms from T200 and 1 ms from T256', () => {
    expect(timerBaseMs(T(0))).toBe(100);
    expect(timerBaseMs(T(199))).toBe(100);
    expect(timerBaseMs(T(200))).toBe(10);
    expect(timerBaseMs(T(255))).toBe(10);
    expect(timerBaseMs(T(256))).toBe(1);
  });

  it('rounds a preset to the base of its timer band (§10.5 の「100ms 刻みに丸めますか？」)', () => {
    expect(roundTimerPreset(3040, timerBaseMs(T(0)))).toBe(3000);
    // JavaScript の Math.round は .5 を上へ丸めるので 3050 は 3100 になる
    expect(roundTimerPreset(3050, timerBaseMs(T(0)))).toBe(3100);
    expect(roundTimerPreset(3055, timerBaseMs(T(200)))).toBe(3060);
    expect(roundTimerPreset(1234, timerBaseMs(T(256)))).toBe(1234);
    // 刻みより小さい値は 0 にせず1刻みへ切り上げる
    expect(roundTimerPreset(1, timerBaseMs(T(0)))).toBe(100);
    expect(() => roundTimerPreset(100, 0)).toThrow();
  });

  it('clamps a rounded preset to K32767 (MAX_K) of its band so it never overshoots (レビュー #M1)', () => {
    // 3,276,750ms は T0（100ms単位）だと32767.5刻み目 → 四捨五入で32768刻みへ丸まってしまうが、
    // K32768 は存在しないので MAX_K(32767) × 100ms = 3,276,700 へ切り下げる
    expect(roundTimerPreset(3_276_750, timerBaseMs(T(0)))).toBe(3_276_700);
    expect(profile.timerPreset(3_276_700, T(0))).toEqual({ text: 'K32767', device: T(0) });
  });

  it('renders T0 K100 as 10 s and T200 K100 as 1 s (#25)', () => {
    expect(profile.timerPreset(10_000, T(0))).toEqual({ text: 'K100', device: T(0) });
    expect(profile.timerPreset(1_000, T(200))).toEqual({ text: 'K100', device: T(200) });
    expect(profile.parseTimerPreset('K100', T(0))).toBe(10_000);
    expect(profile.parseTimerPreset('K100', T(200))).toBe(1_000);
    expect(profile.parseTimerPreset('K30', T(256))).toBe(30);
  });

  it('refuses a preset the numbering band cannot express (§10.5)', () => {
    const error = profile.timerPreset(15, T(0));
    expect(error).toBeInstanceOf(Error);
    expect(String(error as Error)).toContain('100ms');
    expect(profile.timerPreset(0, T(0))).toBeInstanceOf(Error);
    expect(profile.timerPreset(10_000_000, T(0))).toBeInstanceOf(Error);
    expect(profile.timerPreset(15, T(200))).toBeInstanceOf(Error);
    expect(profile.timerPreset(150, T(200))).toEqual({ text: 'K15', device: T(200) });
  });

  it('refuses a preset text that is not K<number>', () => {
    expect(profile.parseTimerPreset('100', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('K', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('K0', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('K40000', T(0))).toBeInstanceOf(Error);
  });
});
