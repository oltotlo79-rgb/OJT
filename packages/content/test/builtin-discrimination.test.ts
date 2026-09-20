import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { findBuiltinProblem } from '../src/builtin/index.js';
import { judgeAssemble, judgeReference } from '../src/judge.js';
import { buildReferenceSession } from '../src/reference.js';
import type { AssembleProblem } from '../src/schema/assemble.js';
import { isAssembleProblem } from '../src/schema/index.js';
import type { TimeChart } from '../src/timechart.js';
import { parseOrThrow } from './helpers/problems.js';

/**
 * 内蔵課題の**弁別力**のテスト。設計仕様 §7.8 / §14.1 #30。
 *
 * 「模範回路が自分の操作列で合格する」（`builtin.test.ts`）だけでは、その操作列が
 * **要点を外した回路を落とせる**ことまでは保証できない。優先（インターロック・早押し）や
 * 再起動（ワンショットの復帰）は、押す順番と回数を欠くと手抜き回路でも同じ波形になってしまう。
 * ここでは課題の回路図から要点だけを抜いた「訓練者の誤った回路」を組み、
 * その課題の操作列がちゃんと不合格にすることを確かめる。
 */

/** 内蔵課題を取り出す（見つからなければテストを落とす）。 */
function builtin(id: string): AssembleProblem {
  const problem = findBuiltinProblem(id);
  if (problem === undefined || !isAssembleProblem(problem))
    throw new Error(`内蔵課題 ${id} がありません`);
  return problem;
}

/** 課題の複製（元の内蔵課題を壊さずに回路図をいじるため）。 */
function copyOf(problem: AssembleProblem): AssembleProblem {
  return structuredClone(problem);
}

/**
 * 課題の回路図をそのまま盤に組んだセッション（＝訓練者の回路として使う）。
 * 変形した回路図も課題スキーマを通してから組むので、「訓練者が実際に作れる回路」であることを確かめられる。
 */
function traineeSession(variant: AssembleProblem) {
  const built = buildReferenceSession(parseOrThrow(variant), JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors, null, 2));
  return built.value.session;
}

/** その課題の操作列で、変形回路を判定した結果。 */
function judgeVariant(problem: AssembleProblem, variant: AssembleProblem) {
  const result = judgeAssemble(problem, JIPM_BOARD, traineeSession(variant));
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.value;
}

/** 模範波形の点灯区間（`[開始ms, 終了ms]` の列）。 */
function onIntervals(chart: TimeChart, name: string): [number, number][] {
  const signal = chart.signals.find((s) => s.name === name);
  if (signal === undefined) throw new Error(`信号 ${name} がチャートにありません`);
  return signal.segments.filter((s) => s.value).map((s) => [s.fromMs, s.toMs]);
}

/** その課題の模範回路が自分の操作列で合格することと、その模範波形。 */
function referenceChart(problem: AssembleProblem): TimeChart {
  const result = judgeReference(problem, JIPM_BOARD);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  expect(result.value.passed).toBe(true);
  return result.value.charts.expected;
}

describe('b-002 インターロック（先行優先）', () => {
  const problem = builtin('b-002');

  it('lights each lamp in turn on the reference circuit', () => {
    const chart = referenceChart(problem);
    expect(onIntervals(chart, 'PL1')).toEqual([[520, 3020]]);
    expect(onIntervals(chart, 'PL2')).toEqual([[4520, 6520]]);
  });

  it('fails a circuit whose CR1 rung has no CR2 b-contact (interlock in one direction only)', () => {
    const variant = copyOf(problem);
    for (const rung of variant.schematic.rungs) {
      rung.cells = rung.cells.filter((cell) => cell.id !== 'c03');
    }
    const judged = judgeVariant(problem, variant);
    expect(judged.mismatches.length).toBeGreaterThan(0);
    expect(judged.mismatches.some((m) => m.signal === 'PL1')).toBe(true);
    expect(judged.passed).toBe(false);
  });
});

describe('b-005 ワンショット', () => {
  const problem = builtin('b-005');

  it('re-arms for a second press on the reference circuit', () => {
    const chart = referenceChart(problem);
    expect(onIntervals(chart, 'PL1')).toEqual([
      [520, 2040],
      [3020, 4540],
    ]);
  });

  it('fails a circuit that latches CR1 for good and only gates the lamp with the timer', () => {
    const variant = copyOf(problem);
    variant.schematic.rungs = [
      {
        id: 'r1',
        from: { bus: 'P' },
        to: { bus: 'N' },
        cells: [
          { kind: 'pb-a', id: 'c02', device: 'PB1' },
          { kind: 'coil', id: 'c03', device: 'CR1' },
        ],
      },
      {
        id: 'r1h',
        from: { rung: 'r1', node: 0 },
        to: { rung: 'r1', node: 1 },
        cells: [{ kind: 'cr-a', id: 'c04', device: 'CR1' }],
      },
      {
        id: 'r2',
        from: { bus: 'P' },
        to: { bus: 'N' },
        cells: [
          { kind: 'cr-a', id: 'c05', device: 'CR1' },
          { kind: 'coil', id: 'c06', device: 'T1', presetMs: 1500 },
        ],
      },
      {
        id: 'r3',
        from: { bus: 'P' },
        to: { bus: 'N' },
        cells: [
          { kind: 'cr-a', id: 'c07', device: 'CR1' },
          { kind: 't-b', id: 'c01', device: 'T1' },
          { kind: 'lamp', id: 'c08', device: 'PL1' },
        ],
      },
    ];
    const judged = judgeVariant(problem, variant);
    expect(judged.mismatches.length).toBeGreaterThan(0);
    expect(judged.mismatches.some((m) => m.signal === 'PL1' && m.reason === 'missing')).toBe(true);
    expect(judged.passed).toBe(false);
  });
});

describe('b-007 早押し優先（3点）', () => {
  const problem = builtin('b-007');

  it('lights one lamp per round on the reference circuit', () => {
    const chart = referenceChart(problem);
    expect(onIntervals(chart, 'PL1')).toEqual([[520, 4000]]);
    expect(onIntervals(chart, 'PL2')).toEqual([[5020, 7000]]);
    expect(onIntervals(chart, 'PL3')).toEqual([[8020, 9000]]);
  });

  it('fails a circuit with no PB2/CR2/PL2 branch at all', () => {
    const variant = copyOf(problem);
    variant.schematic.rungs = variant.schematic.rungs.filter(
      (rung) => rung.id !== 'r2' && rung.id !== 'r2h' && rung.id !== 'r5',
    );
    const judged = judgeVariant(problem, variant);
    expect(judged.mismatches.length).toBeGreaterThan(0);
    expect(judged.mismatches.some((m) => m.signal === 'PL2')).toBe(true);
    expect(judged.mismatches.some((m) => m.signal === 'PL1')).toBe(true);
    expect(judged.passed).toBe(false);
  });
});

describe('b-013 両手押し（AND 条件）', () => {
  const problem = builtin('b-013');

  it('lights PL1 only while both buttons are held, PL2 while only one is', () => {
    const chart = referenceChart(problem);
    expect(onIntervals(chart, 'PL1')).toEqual([[3020, 3820]]);
    expect(onIntervals(chart, 'PL2')).toEqual([
      [520, 820],
      [1520, 1820],
      [2520, 3020],
      [3820, 4320],
    ]);
  });

  it('fails a circuit that lights PL1 from one button alone (AND dropped to a single contact)', () => {
    const variant = copyOf(problem);
    for (const rung of variant.schematic.rungs) {
      rung.cells = rung.cells.filter((cell) => cell.id !== 'c06');
    }
    const judged = judgeVariant(problem, variant);
    expect(judged.mismatches.length).toBeGreaterThan(0);
    expect(judged.mismatches.some((m) => m.signal === 'PL1' && m.reason === 'extra')).toBe(true);
    expect(judged.passed).toBe(false);
  });
});

describe('b-015 相互インタロック（正転・逆転）', () => {
  const problem = builtin('b-015');

  it('runs one direction at a time and lights PL3 for either one', () => {
    const chart = referenceChart(problem);
    expect(onIntervals(chart, 'PL1')).toEqual([[520, 3020]]);
    expect(onIntervals(chart, 'PL2')).toEqual([[4520, 7020]]);
    expect(onIntervals(chart, 'PL3')).toEqual([
      [520, 3020],
      [4520, 7020],
    ]);
  });

  it('fails a circuit interlocked in one direction only (CR2 b-contact missing from the CR1 rung)', () => {
    const variant = copyOf(problem);
    for (const rung of variant.schematic.rungs) {
      rung.cells = rung.cells.filter((cell) => cell.id !== 'c03');
    }
    const judged = judgeVariant(problem, variant);
    expect(judged.mismatches.length).toBeGreaterThan(0);
    // 逆転中に正転を押すと CR1 が入ってしまい（PL1 が余分）、その b接点で CR2 が落ちる（PL2 がずれる）
    expect(judged.mismatches.some((m) => m.signal === 'PL1' && m.reason === 'extra')).toBe(true);
    expect(judged.mismatches.some((m) => m.signal === 'PL2')).toBe(true);
    expect(judged.passed).toBe(false);
  });
});

describe('b-017 後着優先', () => {
  const problem = builtin('b-017');

  it('hands the lamp over to whichever button was pressed last', () => {
    const chart = referenceChart(problem);
    expect(onIntervals(chart, 'PL1')).toEqual([
      [540, 2040],
      [3540, 5040],
    ]);
    expect(onIntervals(chart, 'PL2')).toEqual([
      [2040, 3540],
      [5040, 6520],
    ]);
  });

  it('fails a circuit wired as first-press priority (each output blocking the other)', () => {
    const variant = copyOf(problem);
    for (const rung of variant.schematic.rungs) {
      for (const cell of rung.cells) {
        if (cell.id === 'c06') cell.device = 'CR2';
        if (cell.id === 'c10') cell.device = 'CR1';
      }
    }
    const judged = judgeVariant(problem, variant);
    expect(judged.mismatches.length).toBeGreaterThan(0);
    // 先行優先では2回目以降の押下が通らず、PL2 が一度も点かないまま PL1 が点きっぱなしになる
    expect(judged.mismatches.some((m) => m.signal === 'PL1')).toBe(true);
    expect(judged.mismatches.some((m) => m.signal === 'PL2' && m.reason === 'missing')).toBe(true);
    expect(judged.passed).toBe(false);
  });
});
