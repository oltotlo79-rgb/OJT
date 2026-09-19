import { describe, expect, it } from 'vitest';
import {
  availableDialects,
  JTEKT_PC10G,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  SHARP_JW300,
  type DialectId,
  type DialectProfile,
} from '../src/index.js';

/**
 * カウンタ設定値の方言表記（4B 申し送り F-2）。
 * タイマ（`timerPreset` / `parseTimerPreset`）と同じ対になっていて、4B のカウンタ設定値欄が
 * 入力を読み、命令語リスト（§10.7）が書き出す。
 */

/** 方言 → 「5」の綴りとその機種のカウンタ設定値の上限。 */
const CASES: readonly (readonly [DialectId, DialectProfile, string, number])[] = [
  ['mitsubishi', MITSUBISHI_FX5U, 'K5', 32_767],
  ['omron', OMRON_CP1E, '#0005', 9_999],
  ['jtekt', JTEKT_PC10G, 'H0005', 65_535],
  ['sharp', SHARP_JW300, '0005', 9_999],
];

describe('カウンタ設定値の方言表記（§10.7 / 4B 申し送り F-2）', () => {
  it('implements the pair in every dialect', () => {
    for (const profile of availableDialects()) {
      const text = profile.counterPresetText?.(5);
      expect(text, profile.id).toBeDefined();
      expect(profile.parseCounterPreset?.(text ?? ''), profile.id).toBe(5);
    }
  });
});

describe.each(CASES)(
  '%s のカウンタ設定値',
  (_id: DialectId, profile: DialectProfile, five: string, max: number) => {
    it('spells 5 the way the vendor does', () => {
      expect(profile.counterPresetText?.(5)).toBe(five);
    });

    it('round-trips the values this machine can hold', () => {
      for (const preset of [1, 5, 30, 9_999, max]) {
        const text = profile.counterPresetText?.(preset) ?? '';
        expect(profile.parseCounterPreset?.(text), text).toBe(preset);
      }
    });

    it('refuses a value outside the machine range', () => {
      const one = profile.counterPresetText?.(1) ?? '';
      expect(profile.parseCounterPreset?.(one)).toBe(1);
      for (const text of [one.replace('1', '0'), profile.counterPresetText?.(max + 1) ?? '']) {
        const parsed = profile.parseCounterPreset?.(text);
        expect(parsed, text).toBeInstanceOf(Error);
        if (parsed instanceof Error) expect(parsed.message).toContain('カウンタ設定値');
      }
    });

    it('refuses text it cannot read', () => {
      for (const text of ['', 'カウンタ', '12345678']) {
        expect(profile.parseCounterPreset?.(text), text).toBeInstanceOf(Error);
      }
    });
  },
);
