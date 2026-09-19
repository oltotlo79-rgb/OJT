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
import {
  collectDeviceIssues,
  collectDevices,
  makeParseTimerPreset,
  makeTimerPreset,
  type DeviceRuleSet,
  type TimerRule,
} from '../src/device-rules.js';
import { GX_STYLE_SHORTCUTS, withoutConvert } from '../src/shortcuts.js';
import { MITSUBISHI_FX5U } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** 試験用の架空方言: 10進・接頭辞つき・0.1秒刻みのタイマ。 */
const TIMER: TimerRule = {
  baseMs: 100,
  min: 1,
  max: 9999,
  unitLabel: '0.1秒',
  format: (count) => `#${String(count).padStart(4, '0')}`,
  parse: (text) => {
    const matched = /^#([0-9]{1,4})$/u.exec(text.trim());
    return matched === null ? undefined : Number(matched[1]);
  },
};

const RULES: DeviceRuleSet = {
  deviceRanges: {
    input: { radix: 10, prefix: 'I', min: 0, max: 7 },
    output: { radix: 10, prefix: 'Q', min: 0, max: 7 },
    internal: { radix: 10, prefix: 'W', min: 0, max: 15 },
    timer: { radix: 10, prefix: 'T', min: 0, max: 15 },
    counter: { radix: 10, prefix: 'K', min: 0, max: 15 },
    special: { radix: 10, prefix: 'SP', min: 0, max: 2 },
  },
  specialDevices: { 0: 'ON', 1: 'FIRST', 2: 'CLK' },
  formatDevice: (d) =>
    d.kind === 'special'
      ? (RULES.specialDevices[d.index] ?? `SP${d.index}`)
      : `${RULES.deviceRanges[d.kind].prefix}${d.index}`,
  timer: TIMER,
  counter: { min: 1, max: 999 },
};

describe('collectDevices（表記切替とバリデータが共用する走査）', () => {
  it('lists every device once, in grid order, with its place', () => {
    const p = program(
      network('n1', [rung(no(X(0)), out(Y(0))), [no(Y(0))]]),
      network('n2', [rung(no(M(1)), ctu(C(0), 3, X(1)))]),
      endNetwork(),
    );
    const uses = collectDevices(p);
    expect(uses.map((u) => `${u.device.kind}:${u.device.index}`)).toEqual([
      'input:0',
      'output:0',
      'internal:1',
      'counter:0',
      'input:1',
    ]);
    expect(uses[0]?.place).toEqual({ networkId: 'n1', row: 0, col: 0 });
  });
});

describe('makeTimerPreset / makeParseTimerPreset（時間単位が一定の方言）', () => {
  const timerPreset = makeTimerPreset(TIMER, (d) => RULES.formatDevice(d));
  const parseTimerPreset = makeParseTimerPreset(TIMER);

  it('renders and parses a preset on the fixed 0.1 s base', () => {
    expect(timerPreset(3000, T(0))).toEqual({ text: '#0030', device: T(0) });
    expect(parseTimerPreset('#0030', T(0))).toBe(3000);
  });

  it('refuses a preset the base cannot express or that is out of range', () => {
    expect(timerPreset(150, T(0))).toBeInstanceOf(Error);
    expect(String(timerPreset(150, T(0)) as Error)).toContain('0.1秒');
    expect(timerPreset(0, T(0))).toBeInstanceOf(Error);
    expect(timerPreset(1_000_000, T(0))).toBeInstanceOf(Error);
    expect(parseTimerPreset('30', T(0))).toBeInstanceOf(Error);
    expect(parseTimerPreset('#0000', T(0))).toBeInstanceOf(Error);
  });
});

describe('collectDeviceIssues（4方言で共通するデバイス検査）', () => {
  it('accepts a program inside every range', () => {
    const p = program(network('n1', [rung(no(X(0)), out(Y(1)))]), endNetwork());
    expect(collectDeviceIssues(p, RULES)).toEqual([]);
  });

  it('reports an out-of-range device with the dialect notation in the message', () => {
    const p = program(network('n1', [rung(no(X(9)), out(Y(0)))]), endNetwork());
    const errors = collectDeviceIssues(p, RULES);
    expect(errors.map((e) => e.code)).toEqual(['device-range']);
    expect(errors[0]?.message).toContain('I9');
    expect(errors[0]?.message).toContain('I0〜I7');
    expect(errors[0]?.networkId).toBe('n1');
  });

  it('separates timer-unit from timer-range', () => {
    const unit = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    expect(collectDeviceIssues(unit, RULES).map((e) => e.code)).toEqual(['timer-unit']);
    const over = program(network('n1', [rung(no(X(0)), ton(T(0), 1_000_000))]), endNetwork());
    expect(collectDeviceIssues(over, RULES).map((e) => e.code)).toEqual(['timer-range']);
  });

  it('reports a counter preset outside the range and an unmapped special device', () => {
    const counter = program(network('n1', [rung(no(X(0)), ctu(C(0), 1000, X(1)))]), endNetwork());
    expect(collectDeviceIssues(counter, RULES).map((e) => e.code)).toEqual(['counter-range']);
    const cell: Cell = { kind: 'contact', type: 'NO', device: { kind: 'special', index: 9 } };
    const special = program(network('n1', [rung(cell, out(Y(0)))]), endNetwork());
    const errors = collectDeviceIssues(special, RULES);
    expect(errors.map((e) => e.code)).toEqual(['special-unsupported']);
    expect(errors[0]?.message).toContain('SP9');
  });

  it('accepts the three special devices the rule set maps', () => {
    const p = program(network('n1', [rung(no(SP(0)), out(Y(0)))]), endNetwork());
    expect(collectDeviceIssues(p, RULES)).toEqual([]);
  });
});

describe('GX Works3風キー割当の共有（§17 #19）', () => {
  it('is the table the Mitsubishi profile publishes', () => {
    expect(MITSUBISHI_FX5U.shortcuts).toBe(GX_STYLE_SHORTCUTS);
  });

  it('drops the conversion row for skins that do not require a conversion step', () => {
    const table = withoutConvert(GX_STYLE_SHORTCUTS);
    expect(table.some((s) => s.action === 'convert')).toBe(false);
    expect(table).toHaveLength(GX_STYLE_SHORTCUTS.length - 1);
    expect(table.filter((s) => s.enabled === false)).toHaveLength(1);
  });
});

describe('命令語キーの拡張（Task 7 の命令語リストが使う）', () => {
  it('names the block, master-control, END and edge-contact instructions of 三菱', () => {
    const names = MITSUBISHI_FX5U.instructionNames;
    expect(names.andBlock).toBe('ANB');
    expect(names.orBlock).toBe('ORB');
    expect(names.mc).toBe('MC');
    expect(names.mcr).toBe('MCR');
    expect(names.end).toBe('END');
    expect(names.ldp).toBe('LDP');
    expect(names.ldf).toBe('LDF');
    expect(names.andp).toBe('ANDP');
    expect(names.andf).toBe('ANDF');
    expect(names.orp).toBe('ORP');
    expect(names.orf).toBe('ORF');
  });

  it('leaves the Mitsubishi profile without an inverted special device', () => {
    expect(MITSUBISHI_FX5U.specialInverted).toBeUndefined();
  });
});
