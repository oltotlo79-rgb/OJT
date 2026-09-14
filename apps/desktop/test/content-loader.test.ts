import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { afterEach, describe, expect, it } from 'vitest';
import { builtinSet, loadContent } from '../src/main/content-loader.js';

/**
 * 課題の供給テスト。設計仕様 §7.8（利用者側優先）/ §13 #1（読込エラー） / §13 #9（フォルダ無し）。
 * Plan 1D1 の内蔵課題だけのテストを置き換える（Plan 1D2 Task 1）。
 */

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ojt-content-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('builtinSet', () => {
  it('内蔵課題8題を返す（§7.9）', () => {
    expect(builtinSet().problems).toHaveLength(BUILTIN_PROBLEMS.length);
    expect(builtinSet().errors).toHaveLength(0);
  });
});

describe('loadContent', () => {
  it('利用者フォルダが無ければ内蔵課題だけで動く（§13 #9）', () => {
    const payload = loadContent(join(tmpdir(), 'ojt-does-not-exist')).payload;
    expect(payload.userDirExists).toBe(false);
    expect(payload.problems).toHaveLength(BUILTIN_PROBLEMS.length);
    expect(payload.problems.every((p) => p.source === 'builtin')).toBe(true);
  });

  it('利用者フォルダの課題を合流し、同一IDは利用者側を優先する（§7.8）', () => {
    const dir = tempDir();
    const builtin = BUILTIN_PROBLEMS[0];
    expect(builtin).toBeDefined();
    if (builtin === undefined) return;
    writeFileSync(
      join(dir, 'override.json'),
      JSON.stringify({ ...builtin, title: '利用者版の自己保持回路' }),
      'utf8',
    );
    const { payload, byId } = loadContent(dir);
    expect(payload.userDirExists).toBe(true);
    const row = payload.problems.find((p) => p.id === builtin.id);
    expect(row?.title).toBe('利用者版の自己保持回路');
    expect(row?.source).toBe('user');
    expect(byId.get(builtin.id)?.title).toBe('利用者版の自己保持回路');
  });

  it('壊れた課題は理由付きで一覧に出し、他の課題は読み込む（§13 #1）', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'broken.json'), '{ this is not json', 'utf8');
    const payload = loadContent(dir).payload;
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]?.reason).toBe('invalid-json');
    expect(payload.problems).toHaveLength(BUILTIN_PROBLEMS.length);
  });

  it('スキーマ違反はzodのパス付きで理由を出す（§13 #1）', () => {
    const dir = tempDir();
    const builtin = BUILTIN_PROBLEMS[0];
    if (builtin === undefined) return;
    writeFileSync(
      join(dir, 'bad-grade.json'),
      JSON.stringify({ ...builtin, id: 'u-001', grade: 9 }),
      'utf8',
    );
    const payload = loadContent(dir).payload;
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]?.details.join(' ')).toContain('grade');
  });
});
