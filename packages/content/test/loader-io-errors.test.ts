import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type * as NodeFsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProblemsFromDir, MAX_PROBLEM_BYTES } from '../src/loader.js';
import { selfHoldProblemJson } from './helpers/problems.js';

/**
 * ファイルシステム側の失敗（権限が無い・途中で消えた等）を読込がどう扱うかのテスト。§13 #9
 * そういうファイルを実際に作るのは環境依存なので、`node:fs/promises` を差し替えて再現する。
 * 名前に印（`noread` / `nolist` / `nostat`）が入ったものだけ失敗させ、他は本物をそのまま使う。
 *
 * `loader.ts` は Phase 7 Task 9（DM-1 ≡ CT-06）で `node:fs/promises` を使うようになったので、
 * 差し替え先も `node:fs`（同期API）ではなく `node:fs/promises` にする。
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  const marked = (target: unknown, mark: string): boolean =>
    typeof target === 'string' && target.includes(mark);
  return {
    ...actual,
    readFile: ((...args: Parameters<typeof actual.readFile>) => {
      if (marked(args[0], 'noread')) return Promise.reject(new Error('EACCES: permission denied'));
      return actual.readFile(...args);
    }) as typeof actual.readFile,
    readdir: ((...args: Parameters<typeof actual.readdir>) => {
      if (marked(args[0], 'nolist')) return Promise.reject(new Error('EACCES: permission denied'));
      return actual.readdir(...args);
    }) as typeof actual.readdir,
    stat: ((...args: Parameters<typeof actual.stat>) => {
      if (marked(args[0], 'nostat')) {
        return Promise.reject(new Error('ENOENT: no such file or directory'));
      }
      return actual.stat(...args);
    }) as typeof actual.stat,
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
  it('reports a file it cannot read and keeps the rest', async () => {
    writeFileSync(join(dir, 'noread.json'), '{}', 'utf8');
    writeProblem('good.json', 'b-201');
    const set = await loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-201']);
    expect(set.errors).toHaveLength(1);
    expect(set.errors[0]?.reason).toBe('read-error');
    expect(set.errors[0]?.file).toBe(join(dir, 'noread.json'));
  });

  it('reports a subfolder it cannot list without dropping the other folders (§13 #9)', async () => {
    mkdirSync(join(dir, 'nolist'));
    mkdirSync(join(dir, 'assemble'));
    writeProblem(join('assemble', 'a.json'), 'b-202');
    const set = await loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-202']);
    expect(set.errors).toHaveLength(1);
    expect(set.errors[0]?.reason).toBe('read-error');
    expect(set.errors[0]?.file).toBe(join(dir, 'nolist'));
  });

  it('skips an entry whose stat fails', async () => {
    writeFileSync(join(dir, 'nostat.json'), '{}', 'utf8');
    writeProblem('good.json', 'b-203');
    const set = await loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-203']);
    expect(set.errors).toEqual([]);
  });

  // --- Phase 7 Task 9: DM-1 ≡ CT-06 ---
  it('rejects an oversized problem file before reading it and keeps loading the rest', async () => {
    // 中身は妥当なJSONだが、上限（2 MiB）を超える大きさだけで断る
    const filler = JSON.stringify({
      ...selfHoldProblemJson(),
      id: 'b-204',
      title: 'x'.repeat(3 * 1024 * 1024),
    });
    writeFileSync(join(dir, 'huge.json'), filler, 'utf8');
    writeProblem('good.json', 'b-205');
    const set = await loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-205']);
    expect(set.errors).toHaveLength(1);
    expect(set.errors[0]?.reason).toBe('read-error');
    expect(set.errors[0]?.file).toBe(join(dir, 'huge.json'));
    expect(set.errors[0]?.message).toContain(String(MAX_PROBLEM_BYTES));
  });

  /**
   * 深いネスト（`[[[[…]]]]` 10万段）を与えても例外にならないこと（CT-06）。
   *
   * 実測（Node v25 / V8）では、`JSON.parse()` はこの深さの配列を例外なく読み切り、
   * その後 `AssembleProblemSchema.safeParse()` がトップレベルの型（オブジェクトでない）で
   * 即座に不一致と判定するため、再帰的に深く辿ることはなく `reason: 'schema'` になる
   * （`'invalid-json'` にはならない）。ここで確かめたいのは正確な `reason` ではなく、
   * **例外が `loadProblemsFromDir()` の外へ漏れず、同じフォルダの他の課題も読み込まれること**。
   */
  it('does not throw on a deeply nested JSON value and keeps loading the rest', async () => {
    const depth = 100_000;
    writeFileSync(join(dir, 'deep.json'), '['.repeat(depth) + ']'.repeat(depth), 'utf8');
    writeProblem('good.json', 'b-206');
    const set = await loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-206']);
    expect(set.errors).toHaveLength(1);
    expect(set.errors[0]?.file).toBe(join(dir, 'deep.json'));
    expect(['invalid-json', 'schema']).toContain(set.errors[0]?.reason);
  });
  // --- /Phase 7 Task 9: DM-1 ≡ CT-06 ---
});
