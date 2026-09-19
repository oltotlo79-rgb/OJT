import {
  endNetwork,
  hline,
  IR_COLS,
  M,
  network,
  no,
  out,
  program,
  SP,
  SPECIAL_CLOCK_1S,
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import { errorCellKeys, runConvert, unusedDevices } from '../src/renderer/session/ladder-errors.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = MITSUBISHI_FX5U;

describe('runConvert（§10.6）', () => {
  it('reports success with the device usage', () => {
    const result = runConvert(
      program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork()),
      profile,
    );
    expect(result.ok).toBe(true);
    expect(result.issues.errors).toEqual([]);
    expect(result.issues.usage).toEqual({ reads: ['X0'], writes: ['Y0'] });
    expect(result.program).toBeDefined();
  });

  it('separates structural errors from dialect errors', () => {
    const result = runConvert(program(network('n1', [rung(no(X(0)), ton(T(0), 150))])), profile);
    expect(result.ok).toBe(false);
    expect(result.issues.errors.map((e) => e.source)).toContain('structure');
    expect(result.issues.errors.map((e) => e.source)).toContain('dialect');
    expect(result.issues.usage).toBeUndefined();
  });

  it('keeps the double-coil warning on a successful conversion (§10.4)', () => {
    const result = runConvert(
      program(
        network('n1', [rung(no(X(0)), out(Y(0)))]),
        network('n2', [rung(no(X(1)), out(Y(0)))]),
        endNetwork(),
      ),
      profile,
    );
    expect(result.ok).toBe(true);
    expect(result.issues.warnings.map((w) => w.code)).toEqual(['double-coil']);
    expect(result.issues.warnings[0]?.networkId).toBe('n2');
  });

  it('formats the devices with the dialect (X10 = index 8)', () => {
    const result = runConvert(
      program(network('n1', [rung(no({ kind: 'input', index: 8 }), out(Y(0)))]), endNetwork()),
      profile,
    );
    expect(result.issues.usage?.reads).toEqual(['X10']);
  });
});

describe('errorCellKeys', () => {
  it('collects only the issues that point at a cell (決定表#4)', () => {
    const keys = errorCellKeys([
      { source: 'structure', code: 'coil-column', message: '', networkId: 'n1', row: 0, col: 2 },
      { source: 'structure', code: 'missing-end', message: '' },
      { source: 'dialect', code: 'device-range', message: '', networkId: 'n2', row: 1, col: 0 },
      { source: 'structure', code: 'no-output', message: '', networkId: 'n3' },
    ]);
    expect([...keys].sort()).toEqual(['n1:0:2', 'n2:1:0']);
  });
});

describe('unusedDevices（§10.8。表示のみ。決定表#15b）', () => {
  it('lists devices that are written but never read, and the other way round', () => {
    // X・SP は設計上ラダーから書けないので `neverWritten` に入れない（I10）
    expect(
      unusedDevices({ reads: [X(0), M(1), SP(SPECIAL_CLOCK_1S)], writes: [Y(0), M(2)] }, profile),
    ).toEqual({
      neverRead: ['Y0', 'M2'],
      neverWritten: ['M1'],
    });
  });

  it('does not mistake the dialect-formatted special relay for an unwritten one (B2)', () => {
    // 三菱の特殊デバイスは `formatDevice()` で M8000 系のリレー表記になる（先頭が SP/X でない）。
    // `runConvert` は `kind` で判定するので、方言表記に化けても正しく除外される
    const result = runConvert(
      program(network('n1', [rung(no(SP(SPECIAL_CLOCK_1S)), out(Y(0)))]), endNetwork()),
      profile,
    );
    expect(result.ok).toBe(true);
    // Y0 は書くだけで読まないので `neverRead` には出る。ここで見たいのは `neverWritten` が
    // 空であること（SP が「未使用」扱いされないこと）
    expect(result.issues.unused).toEqual({ neverRead: ['Y0'], neverWritten: [] });
  });
});
