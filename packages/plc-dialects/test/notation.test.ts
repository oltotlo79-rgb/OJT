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
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  availableDialects,
  collectDevices,
  JTEKT_PC10G,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  SHARP_JW300,
  switchNotation,
  type DialectProfile,
} from '../src/index.js';

/** オブジェクトを再帰的に凍結する（渡した引数を書き換えないことを保証するテスト用）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const selfHold = program(
  network('n1', [rung(no(X(8)), out(Y(1))), [no(Y(1))]]),
  network('n2', [rung(no(X(0)), ton(T(0), 3000))]),
  endNetwork(),
);

describe('switchNotation（§10.7 表記切替 / §16 Phase 4 受入基準②）', () => {
  it('lists how every device is spelled in the target dialect', () => {
    const result = switchNotation(selfHold, MITSUBISHI_FX5U, OMRON_CP1E);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.changes.map((c) => [c.from, c.to])).toEqual([
      ['X10', '0.08'],
      ['Y1', '100.01'],
      ['X0', '0.00'],
    ]);
  });

  it('keeps only the devices whose spelling actually differs', () => {
    const result = switchNotation(selfHold, MITSUBISHI_FX5U, OMRON_CP1E);
    // `T0` は両方の方言で `T0` なので一覧に出ない
    expect(result.changes.some((c) => c.from === 'T0')).toBe(false);
    for (const change of result.changes) expect(change.from).not.toBe(change.to);
  });

  it('spells the same program in the other two dialects', () => {
    const jtekt = switchNotation(selfHold, MITSUBISHI_FX5U, JTEKT_PC10G);
    expect(jtekt.changes[0]).toEqual({ device: X(8), from: 'X10', to: '1X008' });
    // 出力は `OUTPUT_BASE`（0x010）ぶんずれる（決定表#16）
    expect(jtekt.changes.find((c) => c.device.kind === 'output')?.to).toBe('1Y011');
    const sharp = switchNotation(selfHold, MITSUBISHI_FX5U, SHARP_JW300);
    expect(sharp.changes[0]).toEqual({ device: X(8), from: 'X10', to: '000010' });
    expect(sharp.changes.find((c) => c.device.kind === 'output')?.to).toBe('000021');
  });

  it('reports what the target dialect cannot express (§10.7)', () => {
    const wide = program(network('n1', [rung(no(X(0)), out(device('output', 14)))]), endNetwork());
    const result = switchNotation(wide, MITSUBISHI_FX5U, OMRON_CP1E);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(['device-range']);
    // 表記の一覧は「表せない」ときも返す（UIは赤字で並べる）
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('reports a preset the target dialect cannot express', () => {
    const fine = program(network('n1', [rung(no(X(0)), ton(T(200), 150))]), endNetwork());
    // 三菱の T200 帯は 10ms 単位なので 150ms は書ける
    expect(MITSUBISHI_FX5U.validate(fine)).toEqual([]);
    const result = switchNotation(fine, MITSUBISHI_FX5U, SHARP_JW300);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(['timer-unit']);
  });

  it('is a no-op when the source and the target are the same dialect', () => {
    const result = switchNotation(selfHold, OMRON_CP1E, OMRON_CP1E);
    expect(result.changes).toEqual([]);
    expect(result.from).toBe('omron');
    expect(result.to).toBe('omron');
  });

  it('does not blame the target dialect for a device already out of range in the source (M1)', () => {
    // internal（M）は三菱で7999まで、OMRON では1599まで。8000はどちらでも範囲外
    const broken = program(network('n1', [rung(no(M(8000)), out(Y(0)))]), endNetwork());
    expect(MITSUBISHI_FX5U.validate(broken).map((e) => e.code)).toEqual(['device-range']);
    expect(OMRON_CP1E.validate(broken).map((e) => e.code)).toEqual(['device-range']);
    const result = switchNotation(broken, MITSUBISHI_FX5U, OMRON_CP1E);
    // 切替前から壊れていたデバイスなので、切替先の指摘には出さない
    expect(result.errors).toEqual([]);
  });

  it('lists the preset spelling changes for timers and counters (M2)', () => {
    // T0 に3000ms（三菱では K30、OMRON では #0030）
    const result = switchNotation(selfHold, MITSUBISHI_FX5U, OMRON_CP1E);
    expect(result.presetChanges).toEqual([{ device: T(0), from: 'K30', to: '#0030' }]);
  });

  it('lists a counter preset spelling change too, not just timers (M2)', () => {
    // C0 に5（三菱では K5、OMRON では #0005）
    const withCounter = program(network('n1', [rung(no(X(0)), ctu(C(0), 5, X(1)))]), endNetwork());
    const result = switchNotation(withCounter, MITSUBISHI_FX5U, OMRON_CP1E);
    expect(result.presetChanges).toEqual([{ device: C(0), from: 'K5', to: '#0005' }]);
  });

  it('leaves the preset list empty when nothing changes (M2)', () => {
    const result = switchNotation(selfHold, OMRON_CP1E, OMRON_CP1E);
    expect(result.presetChanges).toEqual([]);
  });
});

describe('switchNotation A→B→A over every ordered pair of dialects (M5)', () => {
  const dialects = availableDialects();
  const pairs: readonly (readonly [DialectProfile, DialectProfile])[] = dialects.flatMap((a) =>
    dialects.filter((b) => b.id !== a.id).map((b) => [a, b] as const),
  );

  it('has all 12 ordered pairs for 4 dialects', () => {
    expect(pairs).toHaveLength(12);
  });

  it.each(pairs.map(([a, b]) => [`${a.id}→${b.id}→${a.id}`, a, b] as const))(
    '%s restores every device spelling and never mutates the source',
    (_label, a, b) => {
      // 深く凍結した入力を渡す。switchNotation が書き換えようとすれば strict mode で例外になる
      const frozen = deepFreeze(structuredClone(selfHold));
      expect(() => switchNotation(frozen, a, b)).not.toThrow();
      const back = switchNotation(frozen, b, a);
      for (const use of collectDevices(frozen)) {
        const originalText = a.formatDevice(use.device);
        const restored =
          back.changes.find(
            (c) => c.device.kind === use.device.kind && c.device.index === use.device.index,
          )?.to ?? originalText; // 変わらない項目は changes に載らない（=すでに元どおり）
        expect(restored, `${a.id}→${b.id}→${a.id}: ${use.device.kind}${use.device.index}`).toBe(
          originalText,
        );
      }
    },
  );
});
