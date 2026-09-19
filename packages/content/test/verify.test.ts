import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUS_N,
  BUS_P,
  coil,
  crA,
  createDocument,
  emptySchematic,
  lamp,
  pbA,
  rung,
} from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '../src/builtin/index.js';
import { verifySchematic } from '../src/verify.js';

/** 内蔵課題 b-001（自己保持回路。§16 Phase 5 受入基準①と同じ題材）。 */
const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

describe('verifySchematic（§11.4 検算）', () => {
  it('passes when the drawing is the problem own reference circuit', () => {
    const result = verifySchematic(problem, JIPM_BOARD, problem.schematic);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passed).toBe(true);
    expect(result.judge.mismatches).toEqual([]);
    expect(result.judge.mode).toBe('assemble');
  });

  it('runs the same operations as the real judge (charts come back)', () => {
    const result = verifySchematic(problem, JIPM_BOARD, problem.schematic);
    expect(result.ok && result.judge.charts.expected.signals.length).toBeGreaterThan(0);
    expect(result.ok && result.judge.charts.actual.signals.length).toBeGreaterThan(0);
  });

  it('never counts hazards (a desk check has no board operations)', () => {
    const result = verifySchematic(problem, JIPM_BOARD, problem.schematic);
    expect(result.ok && result.judge.hazardCount).toBe(0);
  });

  it('reports the structural errors of a half-finished drawing without judging', () => {
    const result = verifySchematic(problem, JIPM_BOARD, emptySchematic('draft', '下書き'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.message)).toContain('段に要素がありません: r1');
    expect(result.errors[0]?.source).toBe('document');
  });

  it('points at the cell when the physical assignment fails', () => {
    // CR1 の接点を5個使う（§11.3: 1部品につき4組まで）
    const doc = createDocument('draft', '下書き', [
      rung('r1', BUS_P, BUS_N, [
        crA('c1', 'CR1'),
        crA('c2', 'CR1'),
        crA('c3', 'CR1'),
        crA('c4', 'CR1'),
        crA('c5', 'CR1'),
        lamp('c6', 'PL1'),
      ]),
      rung('r2', BUS_P, BUS_N, [pbA('c7', 'PB1'), coil('c8', 'CR1')]),
    ]);
    const result = verifySchematic(problem, JIPM_BOARD, doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.cellId === 'c5');
    expect(issue?.message).toContain('5個目');
    expect(issue?.source).toBe('assign');
  });

  it('fails the check when the drawing does not reproduce the timing', () => {
    // 自己保持の帰還接点（CR1 の a接点）を落とすと、PBを離した瞬間に消える
    const doc = createDocument('draft', '下書き', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
    ]);
    const result = verifySchematic(problem, JIPM_BOARD, doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passed).toBe(false);
    expect(result.judge.mismatches.length).toBeGreaterThan(0);
  });

  it('carries the elapsed time when the caller gives one', () => {
    const result = verifySchematic(problem, JIPM_BOARD, problem.schematic, { elapsedMs: 12_000 });
    expect(result.ok && result.judge.elapsedMs).toBe(12_000);
  });

  it('refuses a board that is not the one the problem asks for', () => {
    const other = { ...JIPM_BOARD, id: 'other-board' };
    const result = verifySchematic(problem, other, problem.schematic);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('渡された盤');
  });
});

describe('verifySchematic: 全内蔵モードB課題の模範回路が検算に通る（§7.8 の自己整合）', () => {
  it.each(BUILTIN_ASSEMBLE_PROBLEMS.map((p) => [p.id, p] as const))('%s', (_id, p) => {
    const result = verifySchematic(p, JIPM_BOARD, p.schematic);
    expect(result.ok).toBe(true);
    expect(result.ok && result.passed).toBe(true);
  });
});
