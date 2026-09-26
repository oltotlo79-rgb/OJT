import {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { toSummary, type SessionMode } from '../src/shared/ipc.js';

/**
 * 課題一覧の行がモードを持つこと（Plan 2B Task 1）。設計仕様 §7.1 / §12.1。
 * Plan 2A が `SupportedProblem` へ広げた3モードすべてが、一覧行としてそのまま描ける形になる。
 */

describe('toSummary（§12.1）', () => {
  it('モードBの課題は mode: assemble の行になる', () => {
    const problem = BUILTIN_ASSEMBLE_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const row = toSummary(problem, 'builtin');
    expect(row.mode).toBe('assemble');
    expect(row.id).toBe(problem.id);
    expect(row.grade).toBe(problem.grade);
    expect(row.source).toBe('builtin');
  });

  it('モードC1の課題は mode: inspect-parts の行になる', () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    expect(toSummary(problem, 'builtin').mode).toBe('inspect-parts');
  });

  it('モードC2の課題は mode: inspect-repair の行になる', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    expect(toSummary(problem, 'user').mode).toBe('inspect-repair');
  });

  it('内蔵364題すべてが行にできる（§7.9。モードB 100 / C1 64 / C2 100 / D 100）', () => {
    const rows = BUILTIN_ALL_PROBLEMS.map((p) => toSummary(p, 'builtin'));
    expect(rows).toHaveLength(364);
    const modes = new Set<SessionMode>(rows.map((r) => r.mode));
    expect([...modes].sort()).toEqual(['assemble', 'inspect-parts', 'inspect-repair', 'plc']);
  });
});
