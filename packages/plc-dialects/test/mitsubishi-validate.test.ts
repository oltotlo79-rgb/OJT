import {
  C,
  ctu,
  endNetwork,
  hline,
  IR_COLS,
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
import { MITSUBISHI_FX5U } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = MITSUBISHI_FX5U;

describe('三菱バリデータ（§10.5 固有バリデーション / §10.8）', () => {
  it('accepts a program that stays inside the device ranges', () => {
    const p = program(network('n1', [rung(no(X(0)), out(Y(3)))]), endNetwork());
    expect(profile.validate(p)).toEqual([]);
  });

  it('reports a device number outside the range', () => {
    const p = program(network('n1', [rung(no(X(2000)), out(Y(0)))]), endNetwork());
    const errors = profile.validate(p);
    expect(errors.map((e) => e.code)).toEqual(['device-range']);
    expect(errors[0]?.message).toContain('X');
    expect(errors[0]?.networkId).toBe('n1');
  });

  it('reports a timer preset the numbering band cannot express (§10.5)', () => {
    const p = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    const errors = profile.validate(p);
    expect(errors.map((e) => e.code)).toEqual(['timer-unit']);
    expect(errors[0]?.message).toContain('100ms');
    // T200 帯なら 10ms 単位なので 150ms は通る
    const ok = program(network('n1', [rung(no(X(0)), ton(T(200), 150))]), endNetwork());
    expect(profile.validate(ok)).toEqual([]);
  });

  it('reports a counter preset outside the range', () => {
    const p = program(network('n1', [rung(no(X(0)), ctu(C(0), 40_000, X(1)))]), endNetwork());
    expect(profile.validate(p).map((e) => e.code)).toEqual(['counter-range']);
  });

  it('accepts the three special devices the profile maps', () => {
    const p = program(
      network('n1', [rung(no(SP(0)), out(Y(0)))]),
      network('n2', [rung(no(SP(2)), out(Y(1)))]),
      endNetwork(),
    );
    expect(profile.validate(p)).toEqual([]);
  });

  it('reports a special device this model does not map (§10.5)', () => {
    // `SP()` は SP0〜SP2 しか作らないが、ファイルから読んだIRには未対応番号が混じりうる
    const unsupported: Cell = {
      kind: 'contact',
      type: 'NO',
      device: { kind: 'special', index: 9 },
    };
    const p = program(network('n1', [rung(unsupported, out(Y(0)))]), endNetwork());
    const errors = profile.validate(p);
    expect(errors.map((e) => e.code)).toEqual(['special-unsupported']);
    expect(errors[0]?.message).toContain('SP9');
    expect(errors[0]?.message).toContain('SP0〜SP2');
  });

  it('has a Japanese message for every error code it can raise', () => {
    for (const code of ['device-range', 'timer-unit', 'counter-range', 'special-unsupported']) {
      expect(profile.errorMessages[code]).toBeDefined();
    }
  });
});
