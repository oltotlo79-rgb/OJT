import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { manualDate } from '../scripts/manual-date.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('説明書の発行日', () => {
  it('指定日を優先し、不正な日付を黙って当日へ置換しない', () => {
    expect(manualDate('.', '2026-09-20')).toBe('2026-09-20');
    for (const value of ['', '2026-02-30', '2026-9-2', 'tomorrow'])
      expect(() => manualDate('.', value)).toThrow('OJT_MANUAL_DATE');
  });
  it('Gitの履歴がないソースでは当日、履歴があれば同じコミット日を使う', () => {
    const root = mkdtempSync(join(tmpdir(), 'ojt-manual-date-'));
    roots.push(root);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('GIT_') && key !== 'OJT_MANUAL_DATE',
      ),
    );
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Date fixture',
          '-c',
          'user.email=date@example.invalid',
          '-c',
          `core.hooksPath=${join(root, 'no-hooks')}`,
          ...args,
        ],
        {
          cwd: root,
          env: {
            ...env,
            GIT_AUTHOR_DATE: '2020-01-02T12:00:00+09:00',
            GIT_COMMITTER_DATE: '2020-01-02T12:00:00+09:00',
          },
          stdio: 'ignore',
        },
      );
    // TEMPが別リポジトリの内側でも、親の履歴・設定を検証へ持ち込まない。
    git('init');
    expect(manualDate(root, undefined, new Date('2026-09-22'))).toBe('2026-09-22');
    git('commit', '--allow-empty', '-m', '日付検証');
    const child = join(root, 'sub');
    mkdirSync(child);
    expect(manualDate(child, undefined, new Date('2030-01-01'))).toBe('2020-01-02');
    expect(manualDate(child, '2026-09-20')).toBe('2026-09-20');
  });
});
