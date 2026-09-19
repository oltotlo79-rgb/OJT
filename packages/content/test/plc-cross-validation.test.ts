import { describe, expect, it } from 'vitest';
import { DeviceCommentsSchema } from '../src/schema/ladder.js';
import { PlcProblemSchema } from '../src/schema/plc.js';
import { noJson, outJson, plcProblemJson, rungJson } from './helpers/plc.js';

/**
 * `PlcProblemSchema` のクロスフィールド検証（レビュー #2）。
 * 模範ラダー・操作列・判定設定は、すべてI/O割付にある点だけを扱えるようにする
 * （模範ラダーの参照するX/Y、操作列のPB、`judge.compareSignals` のPL）。
 */

/** コイルが `outIndex`（Y）、接点が `inIndex`（X）の最小ラダー。 */
function ladderWith(outIndex: number, inIndex = 0): Record<string, unknown> {
  return {
    networks: [
      { id: 'n1', cells: [rungJson(noJson('input', inIndex), outJson(outIndex))] },
      { id: 'end', cells: [[{ kind: 'end' }]] },
    ],
  };
}

describe('模範ラダー・操作列・判定設定はI/O割付の範囲内でなければならない', () => {
  it('GAP 1: 模範ラダーがI/O割付にないYへ書き込むと拒否する', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({
        referenceLadder: ladderWith(7),
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    const message = JSON.stringify(p.error.issues);
    expect(message).toContain('Y7');
    expect(message).toContain('I/O割付');
  });

  it('GAP 2: 模範ラダーがI/O割付にないXを読むと拒否する', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({
        referenceLadder: ladderWith(0, 9),
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    expect(JSON.stringify(p.error.issues)).toContain('X9');
  });

  it('GAP 3: 操作列がI/O割付にないPBを押すと拒否する', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({
        operations: [
          { t: 0, target: 'PB3', action: 'press' },
          { t: 300, target: 'PB3', action: 'release' },
        ],
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    const issue = p.error.issues.find((i) => String(i.path.join('.')).includes('operations'));
    expect(issue?.message).toContain('PB3');
  });

  it('GAP 4: judge.compareSignals がI/O割付にないPLを指すと拒否する', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({
        judge: { compareSignals: ['PL4'] },
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    expect(JSON.stringify(p.error.issues)).toContain('PL4');
  });

  it('GAP 6: mode "fixed" で inputs だけ与えると拒否する（レビュー #M3: 両方指定するか両方省略）', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({ io: { mode: 'fixed', inputs: [{ x: 0, pb: 'PB1' }] } }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    const issue = p.error.issues.find((i) => String(i.path.join('.')).includes('outputs'));
    expect(issue).toBeDefined();
  });

  it('sanity: 割付内に収まっていれば通る', () => {
    const parsed = PlcProblemSchema.parse(
      plcProblemJson({
        io: {
          mode: 'fixed',
          inputs: [{ x: 15, pb: 'PB1' }],
          outputs: [{ y: 15, cr: 'CR1', pl: 'PL1' }],
        },
        referenceLadder: ladderWith(15, 15),
      }),
    );
    expect(parsed.io.inputs?.[0]?.x).toBe(15);
  });
});

describe('DeviceCommentsSchema のキー範囲（レビュー #M5）', () => {
  it('rejects SP9 (存在しない特殊デバイス番号)', () => {
    expect(DeviceCommentsSchema.safeParse({ SP9: '存在しない特殊デバイス' }).success).toBe(false);
  });

  it('rejects X999999 (機種の番号帯を大きく超える桁数)', () => {
    expect(DeviceCommentsSchema.safeParse({ X999999: '範囲外' }).success).toBe(false);
  });

  it('accepts SP0〜SP2', () => {
    expect(DeviceCommentsSchema.safeParse({ SP0: 'a', SP1: 'b', SP2: 'c' }).success).toBe(true);
  });

  it('accepts ordinary in-range keys', () => {
    expect(
      DeviceCommentsSchema.safeParse({ X0: 'a', Y1: 'b', M2: 'c', T3: 'd', C4: 'e' }).success,
    ).toBe(true);
  });
});
