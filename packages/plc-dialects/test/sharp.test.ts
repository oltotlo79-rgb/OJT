import {
  C,
  ctu,
  device,
  endNetwork,
  hline,
  IR_COLS,
  M,
  network,
  no,
  out,
  program,
  SP,
  SPECIAL_ALWAYS_ON,
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { getDialect, GX_STYLE_SHORTCUTS, SHARP_JW300 } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = SHARP_JW300;

describe('シャープ JW300 のリレー番号（§10.5 / 前提表）', () => {
  it('is registered as the sharp dialect', () => {
    expect(getDialect('sharp')).toBe(profile);
    expect(profile.id).toBe('sharp');
    expect(profile.displayName).toContain('JW300');
    expect(profile.displayName).toContain('風');
  });

  it('numbers the relays in octal by unit slot', () => {
    expect(profile.formatDevice(X(0))).toBe('000000');
    expect(profile.formatDevice(X(7))).toBe('000007');
    expect(profile.formatDevice(X(8))).toBe('000010');
    expect(profile.formatDevice(X(15))).toBe('000017');
    expect(profile.formatDevice(Y(0))).toBe('000020');
    expect(profile.formatDevice(Y(15))).toBe('000037');
    expect(profile.formatDevice(M(0))).toBe('001000');
    expect(profile.formatDevice(M(511))).toBe('001777');
  });

  it('prefixes timers and counters so the notation can be read back (前提表)', () => {
    expect(profile.formatDevice(T(0))).toBe('TMR00000');
    expect(profile.formatDevice(T(8191))).toBe('TMR17777');
    expect(profile.formatDevice(C(9))).toBe('CNT00011');
  });

  it('maps the three special relays and marks the always-on one as a b contact (§17 #22)', () => {
    expect(profile.formatDevice(SP(0))).toBe('007366');
    expect(profile.formatDevice(SP(1))).toBe('007362');
    expect(profile.formatDevice(SP(2))).toBe('007364');
    expect(profile.specialInverted).toEqual([SPECIAL_ALWAYS_ON]);
  });

  it('parses the dialect notation back into IR devices', () => {
    expect(profile.parseDevice('000010')).toEqual(X(8));
    expect(profile.parseDevice('000020')).toEqual(Y(0));
    expect(profile.parseDevice('001000')).toEqual(M(0));
    expect(profile.parseDevice('TMR00000')).toEqual(T(0));
    expect(profile.parseDevice('cnt00011')).toEqual(C(9));
    expect(profile.parseDevice('007366')).toEqual(SP(0));
    expect(profile.parseDevice('20')).toEqual(Y(0));
  });

  it('rejects the octal digits 8 and 9 (§16 Phase 4 受入基準④)', () => {
    expect(profile.parseDevice('000008')).toBeInstanceOf(Error);
    expect(String(profile.parseDevice('000008') as Error)).toContain('8進');
    expect(String(profile.parseDevice('8') as Error)).toContain('8進');
    expect(String(profile.parseDevice('TMR00009') as Error)).toContain('8進');
  });

  it('rejects numbers no unit of this rack owns', () => {
    expect(profile.parseDevice('000040')).toBeInstanceOf(Error);
    expect(profile.parseDevice('002000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('TMR20000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('ABC')).toBeInstanceOf(Error);
    expect(profile.parseDevice('')).toBeInstanceOf(Error);
  });

  it('publishes the device ranges of this rack', () => {
    expect(profile.deviceRanges.input).toEqual({ radix: 8, prefix: '', min: 0, max: 15 });
    expect(profile.deviceRanges.output).toEqual({ radix: 8, prefix: '', min: 0, max: 15 });
    expect(profile.deviceRanges.internal.max).toBe(511);
    expect(profile.deviceRanges.timer).toEqual({ radix: 8, prefix: 'TMR', min: 0, max: 8191 });
  });
});

describe('シャープのタイマ（§10.5 の TMR／0.1秒）', () => {
  it('renders and parses the 4-digit preset', () => {
    expect(profile.timerPreset(3000, T(0))).toEqual({ text: '0030', device: T(0) });
    expect(profile.parseTimerPreset('0030', T(0))).toBe(3000);
    expect(profile.parseTimerPreset('30', T(0))).toBe(3000);
  });

  it('refuses a preset the 0.1 s base cannot express', () => {
    expect(profile.timerPreset(150, T(0))).toBeInstanceOf(Error);
    expect(String(profile.timerPreset(150, T(0)) as Error)).toContain('0.1秒');
    expect(profile.timerPreset(1_000_000, T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('0000', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('K30', T(0))).toBeInstanceOf(Error);
  });
});

describe('シャープのバリデータと JW-300SP風スキン（§10.5 / §10.6）', () => {
  it('accepts a program inside the ranges and reports one outside', () => {
    const ok = program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
    expect(profile.validate(ok)).toEqual([]);
    const ng = program(network('n1', [rung(no(device('input', 16)), out(Y(0)))]), endNetwork());
    const errors = profile.validate(ng);
    expect(errors.map((e) => e.code)).toEqual(['device-range']);
    expect(errors[0]?.message).toContain('000000〜000017');
  });

  it('reports timer and counter presets outside the model range', () => {
    const t = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    expect(profile.validate(t).map((e) => e.code)).toEqual(['timer-unit']);
    const c = program(network('n1', [rung(no(X(0)), ctu(C(0), 10_000, X(1)))]), endNetwork());
    expect(profile.validate(c).map((e) => e.code)).toEqual(['counter-range']);
  });

  it('keeps the conversion step and reuses the GX-style keys (§17.1 の前提)', () => {
    expect(profile.convertStep).toBe(true);
    expect(profile.shortcuts).toBe(GX_STYLE_SHORTCUTS);
    expect(profile.monitorColors.powered).toBe('#00A0C8');
    expect(profile.gridCols).toBe(11);
  });

  it('names the instructions confirmed in PLC調査資料 §4-C (§17 #10)', () => {
    const names = profile.instructionNames;
    expect(names.ld).toBe('STR');
    expect(names.ldi).toBe('STR NOT');
    expect(names.ldp).toBe('STR POS');
    expect(names.andf).toBe('AND NEG');
    expect(names.pulseUp).toBe('OUT POS');
    expect(names.pulseDown).toBe('OUT NEG');
    expect(names.andBlock).toBe('AND STR');
    expect(names.orBlock).toBe('OR STR');
    expect(names.mc).toBe('F-47');
    expect(names.mcr).toBe('F-48');
    expect(names.end).toBe('F-40');
    expect(names.timer).toBe('TMR');
    expect(names.counter).toBe('CNT');
  });

  it('borrows no vendor artwork or vendor name outside displayName', () => {
    const text = [
      profile.panels.tree,
      profile.panels.editor,
      profile.panels.output,
      ...profile.panels.toolbar,
      ...Object.values(profile.errorMessages),
    ].join('|');
    expect(text).not.toMatch(/JW-300SP|SHARP|シャープ/iu);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
  });
});
