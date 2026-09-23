import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selfHoldProblemJson } from './helpers/problems.js';

/**
 * 課題ファイルを確かめる道具（`scripts/validate.ts`）。§16 Phase 7 §4.3。
 * **中身を import せず、指導者が実際に打つのと同じやり方（別のプロセスとして起動）で確かめる。**
 * 終了コードが落ちた件数になることと、理由が日本語で出ることの2つがこの道具の約束である。
 */

const PACKAGE_ROOT = join(import.meta.dirname, '..');

/** 道具を1回起動する。 */
function validate(...args: string[]): { code: number; out: string } {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--import',
      './scripts/ts-source-resolve.js',
      'scripts/validate.ts',
      ...args,
    ],
    { cwd: PACKAGE_ROOT, encoding: 'utf8' },
  );
  return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ojt-validate-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('validate（課題を確かめる道具）', () => {
  it('ends with 0 件の問題 and exit code 0 for the 72 built-in problems', () => {
    const { code, out } = validate('src/builtin');
    expect(out).toContain('0 件の問題');
    expect(out.split('\n').filter((line) => line.startsWith('合格'))).toHaveLength(324);
    expect(code).toBe(0);
  }, 600_000);

  it('exits non zero with a Japanese reason for a file that is not valid JSON', () => {
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{ "id": "x-001",,, }', 'utf8');
    const { code, out } = validate(file);
    expect(code).toBeGreaterThanOrEqual(1);
    expect(out).toContain('ファイルを読めません');
    expect(out).toContain('1 件の問題');
  });

  it('exits non zero with a Japanese reason for a problem that breaks the schema', () => {
    const file = join(dir, 'bad-difficulty.json');
    writeFileSync(file, JSON.stringify({ ...selfHoldProblemJson(), difficulty: 9 }), 'utf8');
    const { code, out } = validate(file);
    expect(code).toBe(1);
    expect(out).toContain('課題の形式が正しくありません');
    expect(out).toContain('difficulty');
    expect(out).toContain('1 件の問題');
  });

  it('counts every failing problem, so the exit code is the number of them', () => {
    const one = join(dir, 'bad-grade.json');
    const two = join(dir, 'bad-mode.json');
    writeFileSync(one, JSON.stringify({ ...selfHoldProblemJson(), grade: 9 }), 'utf8');
    writeFileSync(two, JSON.stringify({ ...selfHoldProblemJson(), mode: 'nope' }), 'utf8');
    const { code, out } = validate(one, two);
    expect(code).toBe(2);
    expect(out).toContain('2 件の問題');
  });

  it('accepts a problem that writes neither difficulty nor tags', () => {
    const file = join(dir, 'defaults.json');
    writeFileSync(file, JSON.stringify(selfHoldProblemJson()), 'utf8');
    const { code, out } = validate(file);
    expect(code).toBe(0);
    expect(out).toContain('難しさ3');
    expect(out).toContain('テーマなし');
    expect(out).toContain('0 件の問題');
  }, 120_000);

  it('says so plainly when the path does not exist', () => {
    const { code, out } = validate(join(dir, 'no-such-folder'));
    expect(code).toBe(1);
    expect(out).toContain('そのファイルやフォルダはありません');
  });

  it('prints how to use it when no path is given', () => {
    const { code, out } = validate();
    expect(code).toBe(1);
    expect(out).toContain('使い方');
  });
});
