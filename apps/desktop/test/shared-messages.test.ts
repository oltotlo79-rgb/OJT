import { describe, expect, it } from 'vitest';
import { problemIssueText } from '../src/shared/messages.js';

/**
 * 課題データの読込エラーを日本語で要約する（UXレビュー #6d）。
 * zodの生の `message`（英語まじり）を画面に出さず、既知のフィールドは日本語名で、
 * 未知のフィールドは「項目 <name> が不正です」で言い直す。
 */
describe('problemIssueText', () => {
  it('既知のフィールドは日本語名で言い直す（description）', () => {
    const text = problemIssueText({ path: 'description', message: 'Required' });
    expect(text).toBe('説明文（description）が不正です');
    expect(text).not.toContain('Required');
  });

  it('入れ子のパスは末尾のキーで引く（schematic.rungs.0.from → from ではなく known key）', () => {
    const text = problemIssueText({ path: 'board.extraParts', message: 'Invalid input' });
    expect(text).toBe('追加部品（extraParts）が不正です');
  });

  it('配列添字つきのパスも末尾のキーを取り出す', () => {
    const text = problemIssueText({ path: 'faults[2].kind', message: 'Invalid enum value' });
    expect(text).toContain('種別');
    expect(text).toContain('kind');
  });

  it('未知のフィールドは「項目 <name> が不正です」に落とす', () => {
    const text = problemIssueText({ path: 'schematic.rungs.0.weirdField', message: 'x' });
    expect(text).toBe('項目 schematic.rungs.0.weirdField が不正です');
  });

  it('ルート（パスなし）は課題データ全体の形式エラーとして言う', () => {
    expect(problemIssueText({ path: '', message: 'x' })).toBe('課題データの形式が不正です');
    expect(problemIssueText({ path: '(root)', message: 'x' })).toBe('課題データの形式が不正です');
  });

  it('英語まじりの message をどの分岐でも画面に出さない', () => {
    const cases = [
      { path: 'description', message: 'Required' },
      { path: 'unknownField', message: 'Invalid input' },
      { path: '', message: 'Expected object, received undefined' },
    ];
    for (const issue of cases) {
      expect(problemIssueText(issue)).not.toMatch(/Required|Invalid|Expected|received/);
    }
  });
});
