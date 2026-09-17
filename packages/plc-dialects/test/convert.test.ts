import {
  COIL_COL,
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
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { convert, MITSUBISHI_FX5U, type DialectProfile } from '../src/index.js';

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
