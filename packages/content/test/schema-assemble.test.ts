import { describe, expect, it } from 'vitest';
import { AssembleProblemSchema } from '../src/schema/assemble.js';
import { selfHoldProblemJson } from './helpers/problems.js';

describe('AssembleProblemSchema', () => {
  it('accepts a well formed problem and fills the judge defaults', () => {
    const parsed = AssembleProblemSchema.safeParse({ ...selfHoldProblemJson(), judge: {} });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mode).toBe('assemble');
    expect(parsed.data.judge.tolerance).toEqual({ edgeMs: 200, ratio: 0.1 });
    expect(parsed.data.judge.staticChecks.coilPolarity).toBe(true);
  });

  it('rejects a duration shorter than the last operation (§7.3)', () => {
    const parsed = AssembleProblemSchema.safeParse({ ...selfHoldProblemJson(), durationMs: 1000 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['durationMs']);
  });

  it('rejects a visible schematic hint on a grade 1 problem (§8.4)', () => {
    const parsed = AssembleProblemSchema.safeParse({
      ...selfHoldProblemJson(),
      grade: 1,
      hints: { schematicVisible: true },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['hints', 'schematicVisible']);
  });

  it('accepts a physicalOverride of exactly two terminals (§7.2)', () => {
    expect(
      AssembleProblemSchema.safeParse({
        ...selfHoldProblemJson(),
        physicalOverride: { c03: ['CR1.13', 'CR1.14'] },
      }).success,
    ).toBe(true);
    expect(
      AssembleProblemSchema.safeParse({
        ...selfHoldProblemJson(),
        physicalOverride: { c03: ['CR1.13'] },
      }).success,
    ).toBe(false);
  });

  it('surfaces schematic structure errors under the schematic path', () => {
    const json = selfHoldProblemJson();
    const schematic = json.schematic as { rungs: unknown[] };
    schematic.rungs[2] = {
      id: 'r2',
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [{ kind: 'cr-a', id: 'c05', device: 'CR1' }],
    };
    const parsed = AssembleProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['schematic', 'rungs', 2]);
  });
});
