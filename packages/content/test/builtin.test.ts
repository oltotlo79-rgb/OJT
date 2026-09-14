import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  BuiltinProblemError,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_PROBLEMS,
  findBuiltinProblem,
  parseBuiltinProblems,
} from '../src/builtin/index.js';
import { judgeReference } from '../src/judge.js';
import { startsAndEndsLow } from '../src/timechart.js';

/**
 * 内蔵課題の自己整合テスト。設計仕様 §7.8 / §14.1 #30。
 * 「模範回路を自分の操作列で判定にかけると合格する」ことを全件検証する。
 */

describe('builtin problems', () => {
  it('parses every builtin problem and finds them by id', () => {
    expect(BUILTIN_PROBLEMS).toBe(BUILTIN_ASSEMBLE_PROBLEMS);
    expect(BUILTIN_PROBLEMS.every((p) => p.mode === 'assemble')).toBe(true);
    expect(new Set(BUILTIN_PROBLEMS.map((p) => p.id)).size).toBe(BUILTIN_PROBLEMS.length);
    expect(findBuiltinProblem('b-001')?.title).toBe('自己保持回路');
    expect(findBuiltinProblem('nope')).toBeUndefined();
  });

  it('refuses to start when a builtin problem is broken', () => {
    expect(() => parseBuiltinProblems([{ mode: 'assemble' }])).toThrow(BuiltinProblemError);
    try {
      parseBuiltinProblems([{ mode: 'assemble', id: 'b-999' }]);
    } catch (error) {
      expect(error).toBeInstanceOf(BuiltinProblemError);
      expect((error as BuiltinProblemError).message).toContain('b-999');
      expect((error as BuiltinProblemError).issues.length).toBeGreaterThan(0);
    }
  });

  it('ships 8 assemble problems (§7.9)', () => {
    expect(BUILTIN_PROBLEMS).toHaveLength(8);
    expect(BUILTIN_PROBLEMS.map((p) => p.id)).toEqual([
      'b-001',
      'b-002',
      'b-003',
      'b-004',
      'b-005',
      'b-006',
      'b-007',
      'b-008',
    ]);
  });

  it('covers every hint level (§8.4)', () => {
    const grades = new Set(BUILTIN_PROBLEMS.map((p) => p.grade));
    expect([...grades].sort()).toEqual([1, 2, 3]);
    for (const problem of BUILTIN_PROBLEMS) {
      expect(problem.hints.schematicVisible).toBe(problem.grade === 3);
    }
  });

  describe.each(BUILTIN_PROBLEMS.map((p) => [p.id, p] as const))('%s', (_id, problem) => {
    const result = judgeReference(problem, JIPM_BOARD);

    it('builds its reference circuit', () => {
      if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
      expect(result.ok).toBe(true);
    });

    it('passes its own judging run', () => {
      if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
      if (!result.value.passed) {
        throw new Error(
          JSON.stringify(
            {
              mismatches: result.value.mismatches,
              failed: result.value.staticChecks.filter((c) => !c.ok),
            },
            null,
            2,
          ),
        );
      }
      expect(result.value.passed).toBe(true);
      expect(result.value.chatter).toEqual([]);
      expect(result.value.hazardCount).toBe(0);
    });

    it('draws a non-empty time chart that starts and ends low (§7.3)', () => {
      if (!result.ok) return;
      const chart = result.value.charts.expected;
      expect(chart.durationMs).toBe(problem.durationMs);
      expect(chart.signals.length).toBeGreaterThan(0);
      const active = chart.signals.filter((s) => s.segments.some((g) => g.value));
      expect(active.length).toBeGreaterThan(1);
      expect(active.some((s) => s.kind === 'output')).toBe(true);
      expect(startsAndEndsLow(chart)).toBe(true);
    });

    it('labels every timer it uses (§7.7)', () => {
      if (!result.ok) return;
      const timers = new Set<string>();
      for (const rung of problem.schematic.rungs) {
        for (const cell of rung.cells) {
          if (cell.kind === 'coil' && cell.device.startsWith('T')) timers.add(cell.device);
        }
      }
      expect(result.value.charts.expected.markers).toHaveLength(timers.size);
    });
  });
});
