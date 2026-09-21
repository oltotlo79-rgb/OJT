import {
  COIL_COL,
  device,
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  T,
  ton,
  X,
  Y,
  type Cell,
  type Device,
  type DeviceKind,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  convert,
  MITSUBISHI_FX5U,
  type DeviceRange,
  type DialectError,
  type DialectProfile,
} from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

describe('convert（決定事項#15 の「変換」）', () => {
  it('returns the compiled program when both checks pass', () => {
    const result = convert(
      program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork()),
      MITSUBISHI_FX5U,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.networks).toHaveLength(2);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports structural errors with source "structure" (§10.3)', () => {
    const result = convert(program(network('n1', [rung(no(X(0)), out(Y(0)))])), MITSUBISHI_FX5U);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.source).toBe('structure');
    expect(result.errors[0]?.code).toBe('missing-end');
  });

  it('reports dialect errors with source "dialect" (§10.5)', () => {
    const result = convert(
      program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork()),
      MITSUBISHI_FX5U,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.source)).toEqual(['dialect']);
    expect(result.errors[0]?.code).toBe('timer-unit');
  });

  it('keeps the double-coil warning on a successful conversion (§10.4)', () => {
    const result = convert(
      program(
        network('n1', [rung(no(X(0)), out(Y(0)))]),
        network('n2', [rung(no(X(1)), out(Y(0)))]),
        endNetwork(),
      ),
      MITSUBISHI_FX5U,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((w) => w.code)).toEqual(['double-coil']);
  });

  it('carries the network id and the cell position of a structural error (§10.6 の出力ウィンドウ)', () => {
    const result = convert(
      program(network('n1', [rung(no(X(0)), no(X(1)))]), endNetwork()),
      MITSUBISHI_FX5U,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const positioned = result.errors.find((e) => e.code === 'contact-in-coil-column');
    expect(positioned?.networkId).toBe('n1');
    expect(positioned?.row).toBe(0);
    expect(positioned?.col).toBe(COIL_COL);
  });

  it('omits the position fields when the profile reports an issue without one', () => {
    const profile: DialectProfile = {
      ...MITSUBISHI_FX5U,
      validate: () => [{ code: 'device-range', message: '位置の分からない指摘' }],
    };
    const result = convert(
      program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork()),
      profile,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { source: 'dialect', code: 'device-range', message: '位置の分からない指摘' },
    ]);
  });

  it('runs the dialect checks even when the structure already failed', () => {
    const result = convert(
      program(network('n1', [rung(no(X(2000)), ton(T(0), 150))])),
      MITSUBISHI_FX5U,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new Set(result.errors.map((e) => e.source))).toEqual(new Set(['structure', 'dialect']));
  });
});

describe('§10.5 vendor neutrality: convert() through a non-Mitsubishi stub profile', () => {
  const STUB_RANGES: Readonly<Record<DeviceKind, DeviceRange>> = {
    input: { radix: 16, prefix: 'IN', min: 0, max: 255 },
    output: { radix: 16, prefix: 'OT', min: 0, max: 255 },
    internal: { radix: 16, prefix: 'RY', min: 0, max: 4095 },
    timer: { radix: 10, prefix: 'TMR', min: 0, max: 255 },
    counter: { radix: 10, prefix: 'CNT', min: 0, max: 255 },
    special: { radix: 10, prefix: 'SPX', min: 0, max: 2 },
  };
  const STUB: DialectProfile = {
    id: 'sharp',
    displayName: 'シャープ JW-300（JW-300風）',
    formatDevice: (d: Device) =>
      `${STUB_RANGES[d.kind].prefix}${d.index.toString(16).toUpperCase()}`,
    parseDevice: (text: string): Device | Error => {
      const m = /^([A-Z]+)([0-9A-F]+)$/u.exec(text.trim().toUpperCase());
      if (m === null) return new Error('読めません');
      const kind = (Object.keys(STUB_RANGES) as DeviceKind[]).find(
        (k) => STUB_RANGES[k].prefix === m[1],
      );
      if (kind === undefined) return new Error('読めません');
      return device(kind, parseInt(m[2] ?? '', 16));
    },
    deviceRanges: STUB_RANGES,
    timerPreset: (ms, d) => ({ text: `#${ms}`, device: d }),
    parseTimerPreset: (text) => Number(text.replace('#', '')),
    timerBaseMs: () => 1,
    instructionNames: {
      ld: 'STR',
      ldi: 'STR NOT',
      and: 'AND',
      ani: 'AND NOT',
      or: 'OR',
      ori: 'OR NOT',
      ldp: 'STR UP',
      ldf: 'STR DOWN',
      andp: 'AND UP',
      andf: 'AND DOWN',
      orp: 'OR UP',
      orf: 'OR DOWN',
      andBlock: 'AND STR',
      orBlock: 'OR STR',
      out: 'OUT',
      set: 'SET',
      rst: 'RST',
      pulseUp: 'DIFU',
      pulseDown: 'DIFD',
      timer: 'TMR',
      counter: 'CNT',
      mc: 'MCS',
      mcr: 'MCR',
      end: 'END',
    },
    specialDevices: { 0: 'R7C0', 1: 'R7C1', 2: 'R7C2' },
    symbols: {
      no: 'contact-no',
      nc: 'contact-nc',
      rise: 'contact-rise',
      fall: 'contact-fall',
      coil: 'coil-round',
      set: 'coil-set',
      rst: 'coil-reset',
      timer: 'coil-timer',
      counter: 'coil-counter',
    },
    gridCols: 10,
    shortcuts: [{ action: 'contact-no', keys: 'F1', label: 'a接点', confirmed: false }],
    convertStep: false,
    monitorColors: { powered: '#00AA00', idle: '#888888' },
    panels: { tree: 'ツリー', editor: 'エディタ', output: '出力', toolbar: ['変換'] },
    validate: (p): DialectError[] =>
      p.networks.flatMap((n) =>
        n.cells.flatMap((row, r) =>
          row.flatMap((c, col) =>
            c.kind === 'contact' && c.device.kind === 'input' && c.device.index > 255
              ? [{ code: 'device-range', message: '範囲外', networkId: n.id, row: r, col }]
              : [],
          ),
        ),
      ),
    errorMessages: { 'device-range': '範囲外です' },
  };

  it('runs convert() through a profile with a completely different device syntax', () => {
    const p = program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
    const result = convert(p, STUB);
    expect(result.ok).toBe(true);
  });

  it('routes the stub dialect errors into convert() with source "dialect"', () => {
    const p = program(network('n1', [rung(no(X(300)), out(Y(0)))]), endNetwork());
    const result = convert(p, STUB);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.source)).toEqual(['dialect']);
  });
});
