import { C, M, T, X, type Cell } from '@ojt/ladder-core';
import { JTEKT_PC10G, MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  buildCell,
  counterPresetText,
  emptyCellForm,
  formForCell,
  parseCounterPreset,
  roundSuggestionFor,
  timerPresetMs,
  type CellForm,
} from '../src/renderer/session/ladder-cell.js';

const profile = MITSUBISHI_FX5U;

function form(overrides: Partial<CellForm>): CellForm {
  return { ...emptyCellForm('contact'), ...overrides };
}

describe('buildCell（入力欄 → セル）', () => {
  it('builds the four contact types', () => {
    for (const [contact, type] of [
      ['NO', 'NO'],
      ['NC', 'NC'],
      ['P', 'P'],
      ['F', 'F'],
    ] as const) {
      const cell = buildCell(form({ contact, deviceText: 'X0' }), profile);
      expect(cell).toMatchObject({ kind: 'contact', type, device: X(0) });
    }
  });

  it('reads the Mitsubishi octal notation (X10 = index 8)', () => {
    expect(buildCell(form({ deviceText: 'X10' }), profile)).toMatchObject({ device: X(8) });
    const bad = buildCell(form({ deviceText: 'X8' }), profile);
    expect(bad).toBeInstanceOf(Error);
    if (!(bad instanceof Error)) return;
    expect(bad.message).toContain('8進');
  });

  it('builds the output cells the IR supports', () => {
    const output = (overrides: Partial<CellForm>): Cell | Error =>
      buildCell({ ...emptyCellForm('output'), ...overrides }, profile);
    expect(output({ output: 'OUT', deviceText: 'Y0' })).toMatchObject({
      kind: 'coil',
      type: 'OUT',
    });
    expect(output({ output: 'SET', deviceText: 'M1' })).toMatchObject({
      kind: 'coil',
      type: 'SET',
    });
    expect(output({ output: 'RST', deviceText: 'M1' })).toMatchObject({
      kind: 'coil',
      type: 'RST',
    });
    expect(output({ output: 'TON', deviceText: 'T0', presetText: 'K30' })).toMatchObject({
      kind: 'timer',
      presetMs: 3000,
    });
    expect(
      output({ output: 'CTU', deviceText: 'C0', presetText: '5', resetText: 'X2' }),
    ).toMatchObject({ kind: 'counter', preset: 5, resetDevice: X(2) });
    expect(output({ output: 'MC', deviceText: 'M0' })).toMatchObject({ kind: 'mc' });
    expect(output({ output: 'MCR', deviceText: 'M0' })).toMatchObject({ kind: 'mcr' });
  });

  it('refuses a device of the wrong kind', () => {
    const cell = buildCell(
      { ...emptyCellForm('output'), output: 'TON', deviceText: 'Y0', presetText: 'K30' },
      profile,
    );
    expect(cell).toBeInstanceOf(Error);
    if (!(cell instanceof Error)) return;
    expect(cell.message).toContain('タイマ');
  });

  it('round-trips an existing cell into the form', () => {
    expect(formForCell({ kind: 'contact', type: 'NC', device: X(1) }, profile)).toMatchObject({
      target: 'contact',
      contact: 'NC',
      deviceText: 'X1',
    });
    expect(
      formForCell({ kind: 'timer', type: 'TON', device: T(0), presetMs: 3000 }, profile),
    ).toMatchObject({ target: 'output', output: 'TON', deviceText: 'T0', presetText: 'K30' });
    expect(
      formForCell(
        { kind: 'counter', type: 'CTU', device: C(0), preset: 5, resetDevice: M(3) },
        profile,
      ),
    ).toMatchObject({ output: 'CTU', presetText: 'K5', resetText: 'M3' });
  });
});

describe('timerPresetMs / roundSuggestionFor（§10.5）', () => {
  it('accepts the dialect notation and plain milliseconds', () => {
    expect(timerPresetMs('K30', T(0), profile)).toBe(3000);
    expect(timerPresetMs('3000', T(0), profile)).toBe(3000);
    expect(timerPresetMs('K30', T(200), profile)).toBe(300);
  });

  it('refuses text that is neither', () => {
    expect(timerPresetMs('三十', T(0), profile)).toBeInstanceOf(Error);
    expect(timerPresetMs('', T(0), profile)).toBeInstanceOf(Error);
    expect(timerPresetMs('-100', T(0), profile)).toBeInstanceOf(Error);
  });

  it('offers the 100ms rounding the spec asks for', () => {
    const suggestion = roundSuggestionFor(3050, T(0), profile);
    // `roundTimerPreset()` は四捨五入（`Math.round(3050 / 100) * 100`）なので 3100
    expect(suggestion).toEqual({ ms: 3050, baseMs: 100, rounded: 3100 });
    // T200 帯は 10ms 単位なので 3050ms はそのまま置ける
    expect(roundSuggestionFor(3050, T(200), profile)).toBeUndefined();
  });

  it('never rounds down to zero', () => {
    expect(roundSuggestionFor(30, T(0), profile)?.rounded).toBe(100);
  });

  /**
   * 指摘 LE-4: シャープは接頭辞を持たない10進4桁・0.1秒刻み（`0100` = 10秒）。以前は素の数字を
   * ミリ秒として先に判定していたため `0100` が 100ms と読まれ、編集の往復で1/100に化けていた。
   * 4方言すべてで `formForCell(cell) → buildCell()` の往復が元のセルと等しいことを縛る。
   */
  it('round-trips a timer preset through formForCell → buildCell in all four dialects (LE-4)', () => {
    for (const dialect of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      const cell = { kind: 'timer' as const, type: 'TON' as const, device: T(0), presetMs: 10_000 };
      const asForm = formForCell(cell, dialect);
      const rebuilt = buildCell(asForm, dialect);
      expect(rebuilt, dialect.id).toMatchObject({ kind: 'timer', presetMs: 10_000 });
    }
  });

  it('reads the Sharp prefix-less notation before falling back to plain milliseconds (LE-4)', () => {
    // シャープの `0100` は方言表記で10秒（100 × 0.1秒）。旧実装はこれを100msと誤読した
    expect(timerPresetMs('0100', T(0), SHARP_JW300)).toBe(10_000);
  });

  it.each([OMRON_CP1E, JTEKT_PC10G, SHARP_JW300])(
    'uses the timer rule of $id for rounding (LE-6)',
    (dialect) => {
      const suggestion = roundSuggestionFor(155, T(0), dialect);
      expect(suggestion?.baseMs).toBe(100);
      expect(suggestion?.rounded).toBe(200);
      expect(dialect.timerPreset(suggestion!.rounded, T(0))).not.toBeInstanceOf(Error);
    },
  );
});

describe('カウンタ設定値を方言へ寄せる（§10.5 / 申し送り F-2）', () => {
  it('spells the preset the way each dialect does (4A Task 7)', () => {
    expect(counterPresetText(5, MITSUBISHI_FX5U)).toBe('K5');
    expect(counterPresetText(5, OMRON_CP1E)).toBe('#0005');
    expect(counterPresetText(5, JTEKT_PC10G)).toBe('H0005');
    expect(counterPresetText(5, SHARP_JW300)).toBe('0005');
  });

  it('reads the preset in each dialect spelling', () => {
    expect(parseCounterPreset('K5', MITSUBISHI_FX5U)).toBe(5);
    expect(parseCounterPreset('#0005', OMRON_CP1E)).toBe(5);
    // OMRON は BIN 表記（`&`）も受ける（4A 意図的な差分#7）
    expect(parseCounterPreset('&5', OMRON_CP1E)).toBe(5);
    expect(parseCounterPreset('H0005', JTEKT_PC10G)).toBe(5);
    expect(parseCounterPreset('0005', SHARP_JW300)).toBe(5);
    // 別の方言の綴りは受けない
    expect(parseCounterPreset('K5', OMRON_CP1E)).toBeInstanceOf(Error);
  });

  it('also takes a plain number, like the timer field does', () => {
    expect(parseCounterPreset('5', MITSUBISHI_FX5U)).toBe(5);
    expect(parseCounterPreset('5', OMRON_CP1E)).toBe(5);
  });

  it('refuses a preset that is not a positive integer', () => {
    expect(parseCounterPreset('K0', MITSUBISHI_FX5U)).toBeInstanceOf(Error);
    expect(parseCounterPreset('0', MITSUBISHI_FX5U)).toBeInstanceOf(Error);
    expect(parseCounterPreset('あ', MITSUBISHI_FX5U)).toBeInstanceOf(Error);
    expect(parseCounterPreset('', MITSUBISHI_FX5U)).toBeInstanceOf(Error);
  });
});
