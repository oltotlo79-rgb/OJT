import { BUILTIN_PROBLEMS } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/main/content-loader.js';

describe('loadContent（Plan 1D1: 内蔵課題のみ）', () => {
  it('内蔵課題8題を一覧の形で返す（§7.9）', () => {
    const { payload, byId } = loadContent('C:/not/used/yet');
    expect(payload.problems).toHaveLength(BUILTIN_PROBLEMS.length);
    expect(payload.problems.every((p) => p.source === 'builtin')).toBe(true);
    expect(payload.errors).toHaveLength(0);
    expect(payload.userDirExists).toBe(false);
    expect(byId.get('b-001')?.title).toBe('自己保持回路');
  });

  it('級・標準時間・打切り時間を一覧行に載せる（§7.1）', () => {
    const row = loadContent('').payload.problems.find((p) => p.id === 'b-001');
    expect(row?.grade).toBe(3);
    expect(row?.standardMin).toBe(30);
    expect(row?.cutoffMin).toBe(50);
  });
});
