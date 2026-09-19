import {
  C,
  ctu,
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
import { getDialect, GX_STYLE_SHORTCUTS, JTEKT_PC10G } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = JTEKT_PC10G;

describe('JTEKT TOYOPUC PC10G-1SP のデバイス表記（§10.5 / PLC調査資料 §3-B）', () => {
  it('is registered as the jtekt dialect', () => {
    expect(getDialect('jtekt')).toBe(profile);
    expect(profile.id).toBe('jtekt');
    expect(profile.displayName).toContain('PC10G-1SP');
    expect(profile.displayName).toContain('風');
  });

  it('formats every device kind in hexadecimal with the program number 1', () => {
    expect(profile.formatDevice(X(0))).toBe('1X000');
    expect(profile.formatDevice(X(15))).toBe('1X00F');
    expect(profile.formatDevice(X(2047))).toBe('1X7FF');
    expect(profile.formatDevice(M(255))).toBe('1M0FF');
    expect(profile.formatDevice(T(511))).toBe('1T1FF');
    expect(profile.formatDevice(C(0))).toBe('1C000');
  });

  it('starts the outputs at the next 16-point boundary (決定表#16)', () => {
    // `IN-12` の16点が `1X000`〜`1X00F`、`OUT-12` の16点が `1Y010`〜`1Y01F` になる。
    // 既定の割付（`X(0)` と `Y(0)`）で X と Y のアドレスが衝突しないようにするため
    expect(profile.formatDevice(Y(0))).toBe('1Y010');
    expect(profile.formatDevice(Y(15))).toBe('1Y01F');
    expect(profile.formatDevice(Y(16))).toBe('1Y020');
    expect(profile.formatDevice(Y(2031))).toBe('1Y7FF');
  });

  it('maps the three special devices (§17 #22 の前提割当)', () => {
    expect(profile.formatDevice(SP(0))).toBe('1V00');
    expect(profile.formatDevice(SP(1))).toBe('1V01');
    expect(profile.formatDevice(SP(2))).toBe('V072');
    expect(profile.specialInverted).toBeUndefined();
  });

  it('parses the dialect notation back into IR devices', () => {
    expect(profile.parseDevice('1X00F')).toEqual(X(15));
    expect(profile.parseDevice('1x00f')).toEqual(X(15));
    expect(profile.parseDevice('1Y010')).toEqual(Y(0));
    expect(profile.parseDevice('1Y01F')).toEqual(Y(15));
    expect(profile.parseDevice('1M0FF')).toEqual(M(255));
    expect(profile.parseDevice('1T1FF')).toEqual(T(511));
    expect(profile.parseDevice('V072')).toEqual(SP(2));
  });

  it('rejects a program number other than 1 (前提表)', () => {
    expect(String(profile.parseDevice('2X000') as Error)).toContain('プログラム番号');
    expect(String(profile.parseDevice('3Y000') as Error)).toContain('プログラム番号');
  });

  it('rejects out-of-range and unreadable notations', () => {
    expect(profile.parseDevice('1X800')).toBeInstanceOf(Error);
    // 出力は `1Y010` から始まるので `1Y000`〜`1Y00F` はこの機種に無い（決定表#16）
    expect(profile.parseDevice('1Y000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1Y800')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1T200')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1G000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1XGGG')).toBeInstanceOf(Error);
    expect(profile.parseDevice('')).toBeInstanceOf(Error);
  });

  it('rejects every address below OUTPUT_BASE, not just 1Y000 (A-M6)', () => {
    // 出力は `1Y010` からしか無いので、`1Y001`〜`1Y00F` はどれも通し番号が負になり拒否される（決定表#16）
    for (let address = 1; address <= 0xf; address += 1) {
      const text = `1Y${address.toString(16).toUpperCase().padStart(3, '0')}`;
      expect(profile.parseDevice(text), text).toBeInstanceOf(Error);
    }
  });

  it('publishes the device ranges of PLC調査資料 §3-B', () => {
    expect(profile.deviceRanges.input).toEqual({ radix: 16, prefix: '1X', min: 0, max: 2047 });
    // 出力は `OUTPUT_BASE`（0x010）ぶん後ろにずれるので、上限 `1Y7FF` は通し番号 2031
    expect(profile.deviceRanges.output).toEqual({ radix: 16, prefix: '1Y', min: 0, max: 2031 });
    expect(profile.deviceRanges.internal.max).toBe(2047);
    expect(profile.deviceRanges.timer.max).toBe(511);
    expect(profile.deviceRanges.counter.max).toBe(511);
  });
});

describe('JTEKT のタイマ（§17 #20 の前提: 0.1秒単位・設定値レジスタ H）', () => {
  it('renders and parses the hexadecimal preset', () => {
    expect(profile.timerPreset(3000, T(0))).toEqual({ text: 'H001E', device: T(0) });
    expect(profile.timerPreset(100, T(0))).toEqual({ text: 'H0001', device: T(0) });
    expect(profile.parseTimerPreset('H001E', T(0))).toBe(3000);
    expect(profile.parseTimerPreset('h1e', T(0))).toBe(3000);
  });

  it('refuses a preset the 0.1 s base cannot express', () => {
    expect(profile.timerPreset(150, T(0))).toBeInstanceOf(Error);
    expect(String(profile.timerPreset(150, T(0)) as Error)).toContain('0.1秒');
    expect(profile.timerPreset(0, T(0))).toBeInstanceOf(Error);
    expect(profile.timerPreset(10_000_000, T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('30', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('H0000', T(0))).toBeInstanceOf(Error);
  });
});

describe('JTEKT 固有のバリデーション（§10.5 / 調査資料 §8.1 / 受入基準③）', () => {
  it('rejects the same address used on both X and Y', () => {
    // `X(16)` は `1X010`、`Y(0)` は `1Y010` で**同じアドレス 0x010**（利用者が明示的に重ねた場合）
    const p = program(network('n1', [rung(no(X(16)), out(Y(0)))]), endNetwork());
    const errors = profile.validate(p);
    expect(errors.map((e) => e.code)).toEqual(['device-conflict']);
    expect(errors[0]?.message).toContain('1X010');
    expect(errors[0]?.message).toContain('1Y010');
    expect(errors[0]?.networkId).toBe('n1');
  });

  it('rejects the same number used on both T and C', () => {
    const p = program(
      network('n1', [rung(no(X(1)), ton(T(0), 1000))]),
      network('n2', [rung(no(X(2)), ctu(C(0), 3, X(3)))]),
      endNetwork(),
    );
    expect(profile.validate(p).map((e) => e.code)).toEqual(['device-conflict']);
  });

  it('flags whichever device was written later, even when that is the input (A-I1)', () => {
    // `Y0`（`1Y010`）を先に、後から重なる `X16`（`1X010`。同じアドレス 0x010）を書いた場合、
    // 消させるべきは後から書いた X 側であって、いつも Y 側ではない
    const p = program(
      network('n1', [rung(no(X(0)), out(Y(0)))]),
      network('n2', [rung(no(X(16)), out(Y(1)))]),
      endNetwork(),
    );
    const errors = profile.validate(p);
    expect(errors.map((e) => e.code)).toEqual(['device-conflict']);
    expect(errors[0]?.device).toEqual(X(16));
    expect(errors[0]?.networkId).toBe('n2');
  });

  it('accepts the default assignment where X and Y never collide (決定表#16)', () => {
    // 内蔵8題はすべて `X(0)`〜`X(2)` と `Y(0)`〜`Y(3)` を使う。出力が `1Y010` から始まるので通る
    const p = program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
    expect(profile.validate(p)).toEqual([]);
  });

  it('still reports the shared device-range issues', () => {
    const p = program(network('n1', [rung(no(X(1)), ton(T(0), 150))]), endNetwork());
    expect(profile.validate(p).map((e) => e.code)).toEqual(['timer-unit']);
    expect(profile.errorMessages['device-conflict']).toBeDefined();
  });
});

describe('PCwin風スキン（§10.6 / §17 #19）', () => {
  it('is a screen editor: no conversion step and no conversion key', () => {
    expect(profile.convertStep).toBe(false);
    expect(profile.shortcuts.some((s) => s.action === 'convert')).toBe(false);
    expect(profile.shortcuts).toHaveLength(GX_STYLE_SHORTCUTS.length - 1);
    expect(profile.shortcuts.find((s) => s.action === 'contact-no')?.keys).toBe('F5');
    expect(profile.shortcuts.find((s) => s.action === 'coil')?.keys).toBe('F7');
  });

  it('uses the JTEKT monitor colour and the shared grid width (§10.6 の本アプリ既定)', () => {
    expect(profile.monitorColors.powered).toBe('#E08A1E');
    expect(profile.gridCols).toBe(11);
  });

  it('names the instructions borrowed from the Mitsubishi set (§17 #10)', () => {
    const names = profile.instructionNames;
    expect(names.ld).toBe('LD');
    expect(names.ldi).toBe('LDI');
    expect(names.pulseUp).toBe('PLS');
    expect(names.andBlock).toBe('ANB');
    expect(names.orBlock).toBe('ORB');
    expect(names.mc).toBe('MC');
    expect(names.end).toBe('END');
    expect(names.timer).toBe('OUT');
    expect(names.counter).toBe('OUT');
  });

  it('borrows no vendor artwork or vendor name outside displayName', () => {
    const text = [
      profile.panels.tree,
      profile.panels.editor,
      profile.panels.output,
      ...profile.shortcuts.map((s) => s.label),
      ...Object.values(profile.errorMessages),
    ].join('|');
    expect(text).not.toMatch(/PCwin|TOYOPUC|JTEKT|ジェイテクト/iu);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
  });
});
