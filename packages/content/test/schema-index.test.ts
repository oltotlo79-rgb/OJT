import { describe, expect, it } from 'vitest';
import { parseProblem, problemJsonSchema } from '../src/schema/index.js';
import { selfHoldProblemJson } from './helpers/problems.js';

describe('parseProblem', () => {
  it('returns the parsed problem for an assemble problem', () => {
    const result = parseProblem(selfHoldProblemJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problem.id).toBe('x-001');
  });

  it('reports a schema violation with a zod path (§13 #1)', () => {
    const result = parseProblem({ ...selfHoldProblemJson(), id: 'B_001' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
    expect(result.issues.some((i) => i.path === 'id')).toBe(true);
    expect(result.id).toBe('B_001');
    expect(result.mode).toBe('assemble');
  });

  it('reports an unsupported mode instead of a schema error (§16)', () => {
    const result = parseProblem({
      ...selfHoldProblemJson(),
      id: 'c-001',
      mode: 'inspect-parts',
      parts: [{ id: 'p1', kind: 'relay-my4n', truth: 'normal' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mode');
    expect(result.mode).toBe('inspect-parts');
    expect(result.id).toBe('c-001');
    expect(result.issues).toEqual([]);
  });

  it('still reports header issues of an unsupported mode', () => {
    const result = parseProblem({ id: 'c 002', mode: 'plc' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mode');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.id).toBe('c 002');
  });

  it('leaves the id out when an unsupported mode problem has none', () => {
    const result = parseProblem({ mode: 'inspect-repair' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mode');
    expect(result.id).toBeUndefined();
  });

  it('reports a non object as a schema error at the root', () => {
    const result = parseProblem(42);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
    expect(result.issues[0]?.path).toBe('(root)');
    expect(result.id).toBeUndefined();
    expect(result.mode).toBeUndefined();
  });
});

describe('problemJsonSchema', () => {
  it('generates a draft 2020-12 schema for the whole union (§4.5)', () => {
    const schema = problemJsonSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema).toHaveProperty('oneOf');
    const text = JSON.stringify(schema);
    expect(text).toContain('inspect-repair');
    expect(text).toContain('socketRoles');
  });
});
