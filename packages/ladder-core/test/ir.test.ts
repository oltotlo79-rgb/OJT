import { describe, expect, it } from 'vitest';
import {
  C,
  COIL_COL,
  cellAt,
  ctu,
  device,
  deviceKey,
  deviceLabel,
  empty,
  end,
  endNetwork,
  fall,
  hline,
  IR_COLS,
  LadderError,
  M,
  MAX_ROWS,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  rise,
  rst,
  sameDevice,
  set,
  SP,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  T,
  ton,
  vline,
  X,
  Y,
} from '../src/index.js';

describe('device', () => {
  it('builds the six device kinds with a zero-based index (§10.3)', () => {
    expect(X(0)).toEqual({ kind: 'input', index: 0 });
    expect(Y(3)).toEqual({ kind: 'output', index: 3 });
    expect(M(100)).toEqual({ kind: 'internal', index: 100 });
    expect(T(1)).toEqual({ kind: 'timer', index: 1 });
    expect(C(2)).toEqual({ kind: 'counter', index: 2 });
    expect(SP(SPECIAL_ALWAYS_ON)).toEqual({ kind: 'special', index: 0 });
  });

  it('numbers the three special devices (§10.3)', () => {
    expect([SPECIAL_ALWAYS_ON, SPECIAL_FIRST_SCAN, SPECIAL_CLOCK_1S]).toEqual([0, 1, 2]);
  });

  it('rejects a negative or fractional index', () => {
    expect(() => device('input', -1)).toThrow(LadderError);
    expect(() => device('internal', 1.5)).toThrow(LadderError);
  });

  it('formats a vendor-neutral label and a comparable key', () => {
    expect(deviceLabel(X(8))).toBe('X8');
    expect(deviceLabel(SP(2))).toBe('SP2');
    expect(deviceKey(T(0))).toBe('timer:0');
    expect(sameDevice(M(1), M(1))).toBe(true);
    expect(sameDevice(M(1), Y(1))).toBe(false);
  });
});

describe('cell builders', () => {
  it('builds contacts, coils, a timer and a counter (§10.3)', () => {
    expect(no(X(0))).toEqual({ kind: 'contact', type: 'NO', device: X(0) });
    expect(nc(X(1))).toEqual({ kind: 'contact', type: 'NC', device: X(1) });
    expect(rise(X(2))).toEqual({ kind: 'contact', type: 'P', device: X(2) });
    expect(fall(X(2))).toEqual({ kind: 'contact', type: 'F', device: X(2) });
    expect(out(Y(0))).toEqual({ kind: 'coil', type: 'OUT', device: Y(0) });
    expect(set(M(0))).toEqual({ kind: 'coil', type: 'SET', device: M(0) });
    expect(rst(M(0))).toEqual({ kind: 'coil', type: 'RST', device: M(0) });
    expect(ton(T(0), 3000)).toEqual({ kind: 'timer', type: 'TON', device: T(0), presetMs: 3000 });
    expect(ctu(C(0), 3, X(1))).toEqual({
      kind: 'counter',
      type: 'CTU',
      device: C(0),
      preset: 3,
      resetDevice: X(1),
    });
    expect(mc(M(9))).toEqual({ kind: 'mc', device: M(9) });
    expect(mcr(M(9))).toEqual({ kind: 'mcr', device: M(9) });
    expect(end()).toEqual({ kind: 'end' });
    expect(hline()).toEqual({ kind: 'hline' });
    expect(vline()).toEqual({ kind: 'vline' });
  });

  it('returns a fresh object every time so cells are never shared', () => {
    expect(empty()).not.toBe(empty());
    expect(hline()).not.toBe(hline());
  });
});

describe('network', () => {
  it('pads every row to IR_COLS with empty cells (§10.3)', () => {
    const net = network('n1', [[no(X(0)), hline(), out(Y(0))]]);
    expect(net.rows).toBe(1);
    expect(net.cols).toBe(IR_COLS);
    expect(net.cells[0]).toHaveLength(IR_COLS);
    expect(cellAt(net, 0, 0)).toEqual(no(X(0)));
    expect(cellAt(net, 0, 15)).toEqual(empty());
    expect(COIL_COL).toBe(15);
  });

  it('keeps a comment when one is given', () => {
    const net = network('n1', [[out(Y(0))]], { comment: '自己保持' });
    expect(net.comment).toBe('自己保持');
    expect(network('n2', [[out(Y(0))]]).comment).toBeUndefined();
  });

  it('rejects an empty grid, too many rows and a row wider than IR_COLS', () => {
    expect(() => network('n1', [])).toThrow(LadderError);
    expect(() =>
      network(
        'n1',
        Array.from({ length: MAX_ROWS + 1 }, () => [hline()]),
      ),
    ).toThrow(LadderError);
    expect(() => network('n1', [Array.from({ length: IR_COLS + 1 }, () => hline())])).toThrow(
      LadderError,
    );
  });

  it('rejects a cell read outside the grid', () => {
    const net = network('n1', [[out(Y(0))]]);
    expect(() => cellAt(net, 1, 0)).toThrow(LadderError);
    expect(() => cellAt(net, 0, IR_COLS)).toThrow(LadderError);
  });

  it('builds the END network as a single cell (§10.3)', () => {
    const net = endNetwork();
    expect(net.id).toBe('end');
    expect(cellAt(net, 0, 0)).toEqual(end());
    expect(cellAt(net, 0, 1)).toEqual(empty());
  });
});

describe('program', () => {
  it('collects networks in order', () => {
    const p = program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
    expect(p.networks).toHaveLength(2);
    expect(p.networks[0]?.id).toBe('n1');
    expect(p.networks[1]?.id).toBe('end');
  });

  it('rejects duplicated network ids', () => {
    expect(() => program(network('n1', [[out(Y(0))]]), network('n1', [[out(Y(1))]]))).toThrow(
      LadderError,
    );
  });
});
