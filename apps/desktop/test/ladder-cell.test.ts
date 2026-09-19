import { C, M, T, X, type Cell } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  buildCell,
  emptyCellForm,
  formForCell,
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
    ).toMatchObject({ output: 'CTU', presetText: '5', resetText: 'M3' });
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
});
