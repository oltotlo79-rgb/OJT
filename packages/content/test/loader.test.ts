import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProblemsFromDir, mergeProblemSets } from '../src/loader.js';
import { selfHoldProblemJson } from './helpers/problems.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ojt-content-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, value: unknown): void {
  const full = join(dir, relative);
  writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

describe('loadProblemsFromDir', () => {
  it('reads problems from the folder and from one level of subfolders', () => {
    mkdirSync(join(dir, 'assemble'));
    write('assemble/a.json', { ...selfHoldProblemJson(), id: 'b-101' });
    write('b.json', { ...selfHoldProblemJson(), id: 'b-102' });
    write('notes.txt', 'ignored');
    const set = loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-101', 'b-102']);
    expect(set.errors).toEqual([]);
  });

  it('keeps loading after a broken file and reports the reason', () => {
    write('broken.json', '{ "oops"');
    write('good.json', { ...selfHoldProblemJson(), id: 'b-103' });
    write('bad-schema.json', { ...selfHoldProblemJson(), id: 'B_104' });
    write('other-mode.json', { ...selfHoldProblemJson(), id: 'd-001', mode: 'plc' });
    const set = loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-103']);
    expect(set.errors.map((e) => e.reason).sort()).toEqual([
      'invalid-json',
      'schema',
      'unsupported-mode',
    ]);
    const schemaError = set.errors.find((e) => e.reason === 'schema');
    expect(schemaError?.issues.length).toBeGreaterThan(0);
  });

  it('reports a duplicated id inside one folder', () => {
    write('a.json', { ...selfHoldProblemJson(), id: 'b-105' });
    write('b.json', { ...selfHoldProblemJson(), id: 'b-105' });
    const set = loadProblemsFromDir(dir);
    expect(set.problems).toHaveLength(1);
    expect(set.errors[0]?.reason).toBe('duplicate-id');
    expect(set.errors[0]?.id).toBe('b-105');
  });

  it('returns a read error for a missing folder instead of throwing', () => {
    const set = loadProblemsFromDir(join(dir, 'nope'));
    expect(set.problems).toEqual([]);
    expect(set.errors[0]?.reason).toBe('read-error');
  });
});

describe('mergeProblemSets', () => {
  it('lets the user folder win on the same id and keeps new ones', () => {
    const builtin = {
      problems: [
        { ...selfHoldProblemJson(), id: 'b-001' },
        { ...selfHoldProblemJson(), id: 'b-002' },
      ],
      errors: [],
    };
    const user = {
      problems: [
        { ...selfHoldProblemJson(), id: 'b-002', title: '差し替え' },
        { ...selfHoldProblemJson(), id: 'u-001' },
      ],
      errors: [],
    };
    mkdirSync(join(dir, 'builtin'));
    write('builtin/b1.json', builtin.problems[0]);
    write('builtin/b2.json', builtin.problems[1]);
    mkdirSync(join(dir, 'user'));
    write('user/b2.json', user.problems[0]);
    write('user/u1.json', user.problems[1]);

    const merged = mergeProblemSets(
      loadProblemsFromDir(join(dir, 'builtin')),
      loadProblemsFromDir(join(dir, 'user')),
    );
    expect(merged.problems.map((p) => p.id)).toEqual(['b-001', 'b-002', 'u-001']);
    expect(merged.problems[1]?.title).toBe('差し替え');
    expect(merged.errors).toEqual([]);
  });

  it('concatenates the errors of both sets', () => {
    write('broken.json', 'nope');
    const set = loadProblemsFromDir(dir);
    const merged = mergeProblemSets(set, set);
    expect(merged.errors).toHaveLength(2);
  });
});
