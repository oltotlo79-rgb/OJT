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
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { getDialect, MAX_GRID_COLS, MIN_GRID_COLS, OMRON_CP1E } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = OMRON_CP1E;

describe('OMRON CP1E のデバイス表記（§10.5）', () => {
  it('is registered as the omron dialect', () => {
    expect(getDialect('omron')).toBe(profile);
    expect(profile.id).toBe('omron');
    expect(profile.displayName).toContain('CP1E');
    expect(profile.displayName).toContain('風');
  });

  it('formats inputs and outputs as CIO ch.bit (§16 Phase 4 受入基準②)', () => {
    expect(profile.formatDevice(X(0))).toBe('0.00');
    expect(profile.formatDevice(X(11))).toBe('0.11');
    expect(profile.formatDevice(X(12))).toBe('1.00');
    expect(profile.formatDevice(X(17))).toBe('1.05');
    expect(profile.formatDevice(Y(0))).toBe('100.00');
    expect(profile.formatDevice(Y(7))).toBe('100.07');
    expect(profile.formatDevice(Y(8))).toBe('101.00');
    expect(profile.formatDevice(Y(11))).toBe('101.03');
  });

  it('formats the work relays, timers and counters', () => {
    expect(profile.formatDevice(M(0))).toBe('W0.00');
    expect(profile.formatDevice(M(16))).toBe('W1.00');
    expect(profile.formatDevice(M(1599))).toBe('W99.15');
    expect(profile.formatDevice(T(0))).toBe('T0');
    expect(profile.formatDevice(C(255))).toBe('C255');
  });

  it('maps the three special devices (§17 #22)', () => {
    expect(profile.formatDevice(SP(0))).toBe('P_On');
    expect(profile.formatDevice(SP(1))).toBe('A200.11');
    expect(profile.formatDevice(SP(2))).toBe('P_1s');
    expect(profile.specialInverted).toBeUndefined();
  });

  it('parses the dialect notation back into IR devices', () => {
    expect(profile.parseDevice('0.00')).toEqual(X(0));
    expect(profile.parseDevice('1.05')).toEqual(X(17));
    expect(profile.parseDevice('100.07')).toEqual(Y(7));
    expect(profile.parseDevice('101.03')).toEqual(Y(11));
    expect(profile.parseDevice('W1.00')).toEqual(M(16));
    expect(profile.parseDevice('T3')).toEqual(T(3));
    expect(profile.parseDevice('C3')).toEqual(C(3));
    expect(profile.parseDevice('P_1s')).toEqual(SP(2));
    expect(profile.parseDevice('p_on')).toEqual(SP(0));
  });

  it('rejects a bit part outside 00〜15 (§10.5 固有バリデーション)', () => {
    expect(String(profile.parseDevice('0.16') as Error)).toContain('00〜15');
    expect(String(profile.parseDevice('W0.16') as Error)).toContain('00〜15');
    expect(profile.parseDevice('0.5')).toBeInstanceOf(Error);
  });

  it('rejects points this model does not have', () => {
    expect(profile.parseDevice('0.12')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1.06')).toBeInstanceOf(Error);
    expect(profile.parseDevice('100.08')).toBeInstanceOf(Error);
    expect(profile.parseDevice('2.00')).toBeInstanceOf(Error);
    expect(profile.parseDevice('T256')).toBeInstanceOf(Error);
    expect(profile.parseDevice('Z0')).toBeInstanceOf(Error);
    expect(profile.parseDevice('')).toBeInstanceOf(Error);
  });

  it('publishes the device ranges of this model', () => {
    expect(profile.deviceRanges.input).toEqual({ radix: 10, prefix: '', min: 0, max: 17 });
    expect(profile.deviceRanges.output).toEqual({ radix: 10, prefix: '', min: 0, max: 11 });
    expect(profile.deviceRanges.internal.max).toBe(1599);
    expect(profile.deviceRanges.timer.max).toBe(255);
    expect(profile.deviceRanges.counter.max).toBe(255);
  });
});

describe('OMRON CP1E のタイマ（§10.5 の TIM／0.1s）', () => {
  it('renders and parses the BCD preset', () => {
    expect(profile.timerPreset(3000, T(0))).toEqual({ text: '#0030', device: T(0) });
    expect(profile.timerPreset(999_900, T(0))).toEqual({ text: '#9999', device: T(0) });
    expect(profile.parseTimerPreset('#0030', T(0))).toBe(3000);
    expect(profile.parseTimerPreset('&30', T(0))).toBe(3000);
  });

  it('refuses a preset the 0.1 s base cannot express', () => {
    expect(profile.timerPreset(150, T(0))).toBeInstanceOf(Error);
    expect(String(profile.timerPreset(150, T(0)) as Error)).toContain('0.1秒');
    expect(profile.timerPreset(0, T(0))).toBeInstanceOf(Error);
    expect(profile.timerPreset(1_000_000, T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('30', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('#0000', T(0))).toBeInstanceOf(Error);
  });
});

describe('OMRON CP1E のバリデータとスキン（§10.5 / §10.6）', () => {
  it('accepts a program inside the ranges and reports one outside', () => {
    const ok = program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
    expect(profile.validate(ok)).toEqual([]);
    const ng = program(network('n1', [rung(no(X(0)), out(device('output', 12)))]), endNetwork());
    const errors = profile.validate(ng);
    expect(errors.map((e) => e.code)).toEqual(['device-range']);
    expect(errors[0]?.message).toContain('100.00〜101.03');
  });

  it('reports timer and counter presets outside the model range', () => {
    const t = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    expect(profile.validate(t).map((e) => e.code)).toEqual(['timer-unit']);
    const c = program(network('n1', [rung(no(X(0)), ctu(C(0), 10_000, X(1)))]), endNetwork());
    expect(profile.validate(c).map((e) => e.code)).toEqual(['counter-range']);
  });

  it('skips the conversion step and uses the OMRON monitor colour (§10.6 / 受入基準①)', () => {
    expect(profile.convertStep).toBe(false);
    expect(profile.monitorColors.powered).toBe('#2FA02C');
    expect(profile.gridCols).toBe(11);
    expect(profile.gridCols).toBeGreaterThanOrEqual(MIN_GRID_COLS);
    expect(profile.gridCols).toBeLessThanOrEqual(MAX_GRID_COLS);
  });

  it('binds the CX-Programmer keys of PLC調査資料 §5-4 and has no conversion key', () => {
    const keysOf = (action: string): string | undefined =>
      profile.shortcuts.find((s) => s.action === action)?.keys;
    expect(keysOf('contact-no')).toBe('C');
    expect(keysOf('contact-nc')).toBe('/');
    expect(keysOf('coil')).toBe('O');
    expect(keysOf('instruction')).toBe('I');
    expect(keysOf('online-edit')).toBe('Ctrl+E');
    expect(keysOf('transfer')).toBe('Ctrl+Shift+E');
    expect(keysOf('hline')).toBe('W');
    expect(keysOf('vline')).toBe('L');
    expect(keysOf('convert')).toBeUndefined();
  });

  it('names the instructions of §10.5', () => {
    const names = profile.instructionNames;
    expect(names.ldi).toBe('LD NOT');
    expect(names.rst).toBe('RSET');
    expect(names.pulseUp).toBe('DIFU');
    expect(names.pulseDown).toBe('DIFD');
    expect(names.ldp).toBe('LD UP');
    expect(names.orf).toBe('OR DOWN');
    expect(names.andBlock).toBe('AND LD');
    expect(names.orBlock).toBe('OR LD');
    expect(names.mc).toBe('IL');
    expect(names.mcr).toBe('ILC');
    expect(names.end).toBe('END');
    expect(names.timer).toBe('TIM');
    expect(names.counter).toBe('CNT');
  });

  it('borrows no vendor artwork or vendor name outside displayName (§17 / PLC調査資料 §6)', () => {
    const text = [
      profile.panels.tree,
      profile.panels.editor,
      profile.panels.output,
      ...profile.panels.toolbar,
      ...profile.shortcuts.map((s) => s.label),
      ...Object.values(profile.errorMessages),
    ].join('|');
    expect(text).not.toMatch(/CX-Programmer|OMRON|オムロン/iu);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
  });
});
