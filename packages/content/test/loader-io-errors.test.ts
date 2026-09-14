import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProblemsFromDir } from '../src/loader.js';
import { selfHoldProblemJson } from './helpers/problems.js';

/**
 * ファイルシステム側の失敗（権限が無い・途中で消えた等）を読込がどう扱うかのテスト。§13 #9
 * そういうファイルを実際に作るのは環境依存なので、`node:fs` を差し替えて再現する。
 * 名前に印（`noread` / `nolist` / `nostat`）が入ったものだけ失敗させ、他は本物をそのまま使う。
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  const marked = (target: unknown, mark: string): boolean =>
    typeof target === 'string' && target.includes(mark);
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (marked(args[0], 'noread')) throw new Error('EACCES: permission denied');
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
    readdirSync: ((...args: Parameters<typeof actual.readdirSync>) => {
      if (marked(args[0], 'nolist')) throw new Error('EACCES: permission denied');
      return actual.readdirSync(...args);
    }) as typeof actual.readdirSync,
    statSync: ((...args: Parameters<typeof actual.statSync>) => {
      if (marked(args[0], 'nostat')) throw new Error('ENOENT: no such file or directory');
      return actual.statSync(...args);
    }) as typeof actual.statSync,
  };
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ojt-content-io-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 正常な課題を1件書く。 */
function writeProblem(relative: string, id: string): void {
  writeFileSync(join(dir, relative), JSON.stringify({ ...selfHoldProblemJson(), id }), 'utf8');
}

describe('loadProblemsFromDir — 入出力の失敗', () => {
  it('reports a file it cannot read and keeps the rest', () => {
    writeFileSync(join(dir, 'noread.json'), '{}', 'utf8');
    writeProblem('good.json', 'b-201');
    const set = loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-201']);
    expect(set.errors).toHaveLength(1);
    expect(set.errors[0]?.reason).toBe('read-error');
    expect(set.errors[0]?.file).toBe(join(dir, 'noread.json'));
  });

  it('reports a subfolder it cannot list without dropping the other folders (§13 #9)', () => {
    mkdirSync(join(dir, 'nolist'));
    mkdirSync(join(dir, 'assemble'));
    writeProblem(join('assemble', 'a.json'), 'b-202');
    const set = loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-202']);
    expect(set.errors).toHaveLength(1);
    expect(set.errors[0]?.reason).toBe('read-error');
    expect(set.errors[0]?.file).toBe(join(dir, 'nolist'));
  });

  it('skips an entry whose stat fails', () => {
    writeFileSync(join(dir, 'nostat.json'), '{}', 'utf8');
    writeProblem('good.json', 'b-203');
    const set = loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-203']);
    expect(set.errors).toEqual([]);
  });
});
