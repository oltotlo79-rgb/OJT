import { describe, expect, it } from 'vitest';
import {
  createAssembleLabProblem,
  createPlcLabProblem,
  isLabMode,
  isLabProblem,
  parseProblem,
  runtimeKindOf,
  usesPlc,
  validateDefinition,
} from '../src/index.js';

/**
 * 「回路実験」「PLC実験」の課題データ（2026-10-08 利用者指示）。
 * 設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §4
 */
describe('実験課題のスキーマ', () => {
  it('既定の回路実験・PLC実験（4メーカー・配線済みと自分で配線）は検証を通る', () => {
    const assemble = parseProblem(createAssembleLabProblem());
    expect(assemble.ok, JSON.stringify(assemble)).toBe(true);
    for (const vendor of ['mitsubishi', 'jtekt', 'omron', 'sharp'] as const) {
      for (const prewired of [true, false]) {
        const parsed = parseProblem(createPlcLabProblem({ vendor, prewired }));
        expect(parsed.ok, `${vendor} ${String(prewired)} ${JSON.stringify(parsed)}`).toBe(true);
      }
    }
  });

  it('描いた入力と正解を持てる', () => {
    const problem = createAssembleLabProblem({
      durationMs: 5_000,
      operations: [
        { t: 1_000, target: 'PB1', action: 'press' },
        { t: 1_500, target: 'PB1', action: 'release' },
        { t: 3_000, target: 'PB2', action: 'press' },
      ],
      expected: [{ signal: 'PL1', on: [[1_000, 3_000]] }],
    });
    const parsed = parseProblem(problem);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  });

  it.each([
    ['PB5 は描けない', { operations: [{ t: 100, target: 'PB5', action: 'press' }] }],
    [
      '長さより後の操作',
      { operations: [{ t: 20_000, target: 'PB1', action: 'press' }], durationMs: 10_000 },
    ],
    ['離すから始まる', { operations: [{ t: 100, target: 'PB1', action: 'release' }] }],
    [
      '押す→押す',
      {
        operations: [
          { t: 100, target: 'PB1', action: 'press' },
          { t: 200, target: 'PB1', action: 'press' },
        ],
      },
    ],
    [
      '重なった正解の区間',
      {
        expected: [
          {
            signal: 'PL1',
            on: [
              [100, 500],
              [400, 900],
            ],
          },
        ],
      },
    ],
    [
      '接した正解の区間（1つにまとめた形にする）',
      {
        expected: [
          {
            signal: 'PL1',
            on: [
              [100, 500],
              [500, 900],
            ],
          },
        ],
      },
    ],
    ['長さを超える正解', { expected: [{ signal: 'PL1', on: [[100, 12_000]] }] }],
    [
      '同じランプの正解が2つ',
      {
        expected: [
          { signal: 'PL1', on: [[100, 200]] },
          { signal: 'PL1', on: [[300, 400]] },
        ],
      },
    ],
    ['短すぎる長さ', { durationMs: 1_000 }],
    ['0.1秒単位でない長さ', { durationMs: 5_050 }],
    ['10ms 単位でない時刻', { expected: [{ signal: 'PL1', on: [[105, 500]] }] }],
  ])('%s は拒む', (_name, patch) => {
    const problem = { ...createAssembleLabProblem(), ...patch };
    expect(parseProblem(problem).ok).toBe(false);
  });

  it('判定に使うランプは PL1〜PL4 だけ', () => {
    const base = createAssembleLabProblem();
    expect(parseProblem({ ...base, judge: { ...base.judge, compareSignals: ['PL2'] } }).ok).toBe(
      true,
    );
    expect(parseProblem({ ...base, judge: { ...base.judge, compareSignals: ['BZ'] } }).ok).toBe(
      false,
    );
  });

  it('モードの種類', () => {
    expect(runtimeKindOf('assemble-lab')).toBe('assemble');
    expect(runtimeKindOf('plc-lab')).toBe('plc');
    expect(runtimeKindOf('inspect-repair')).toBe('inspect-repair');
    expect(isLabMode('plc-lab')).toBe(true);
    expect(isLabMode('plc')).toBe(false);
    const plcLab = createPlcLabProblem({ vendor: 'omron', prewired: false });
    expect(usesPlc(plcLab)).toBe(true);
    expect(isLabProblem(plcLab)).toBe(true);
    expect(usesPlc(createAssembleLabProblem())).toBe(false);
  });

  it('課題ファイルとしては受け付けない（その場で作る課題。利用者の決定 D1）', () => {
    const result = validateDefinition(createAssembleLabProblem());
    expect(result.reasons.join('\n')).toContain('ファイルにしません');
  });
});
