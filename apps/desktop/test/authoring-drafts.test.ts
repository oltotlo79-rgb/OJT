import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import type * as Crypto from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_DEFINITION_BYTES, type AuthoringDraft } from '../src/shared/authoring.js';

const electron = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => electron.dir } }));
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof Crypto>('node:crypto');
  const randomUUID = (): string => 'test-backup';
  return { ...actual, randomUUID, default: { ...actual, randomUUID } };
});
const { authoringDraftPath, loadAuthoringDraft, saveAuthoringDraft } =
  await import('../src/main/authoring-drafts.js');
const tempRoot = resolve(tmpdir());
beforeEach(() => {
  electron.dir = mkdtempSync(join(tempRoot, 'ojt-authoring-draft-'));
});
afterEach(() => {
  if (dirname(electron.dir) !== tempRoot) throw new Error('下書き検証の削除範囲が違います');
  rmSync(electron.dir, { recursive: true, force: true });
});
const draft = (text = '{ "title": '): AuthoringDraft => ({
  formatVersion: 1,
  text,
  savedText: '',
  templateId: 'b-001',
  savedDirectory: '',
  savedAt: '2026-09-24T01:00:00Z',
});

describe('N02: 課題下書きの実ファイル保存', () => {
  it('未作成なら空として読み、余分なファイルを作らない', () => {
    expect(loadAuthoringDraft()).toEqual({ ok: true });
    expect(readdirSync(electron.dir)).toEqual([]);
  });
  it('構文不正の編集中JSONも文字どおり保存・復元する', () => {
    const value = draft();
    expect(saveAuthoringDraft(value)).toEqual({ ok: true });
    expect(loadAuthoringDraft()).toEqual({ ok: true, draft: value });
    expect(existsSync(`${authoringDraftPath()}.tmp`)).toBe(false);
  });
  it('BOM付きの下書きを読める', () => {
    writeFileSync(authoringDraftPath(), `\uFEFF${JSON.stringify(draft())}`);
    expect(loadAuthoringDraft()).toEqual({ ok: true, draft: draft() });
  });
  it('壊れた原本の控えを作ってから新しい下書きを保存する', () => {
    writeFileSync(authoringDraftPath(), 'broken original');
    expect(saveAuthoringDraft(draft('new draft'))).toMatchObject({ ok: true });
    expect(
      readFileSync(join(electron.dir, 'authoring-draft.invalid-test-backup.json'), 'utf8'),
    ).toBe('broken original');
    expect(loadAuthoringDraft()).toEqual({ ok: true, draft: draft('new draft') });
  });
  it('控えを作れなければ原本を上書きしない', () => {
    writeFileSync(authoringDraftPath(), 'keep original');
    mkdirSync(join(electron.dir, 'authoring-draft.invalid-test-backup.json'));
    expect(saveAuthoringDraft(draft()).ok).toBe(false);
    expect(readFileSync(authoringDraftPath(), 'utf8')).toBe('keep original');
  });
  it('新しい形式の下書きを上書きせず保護する', () => {
    const content = JSON.stringify({ ...draft(), formatVersion: 2 });
    writeFileSync(authoringDraftPath(), content);
    expect(loadAuthoringDraft()).toMatchObject({ ok: false });
    expect(saveAuthoringDraft(draft()).ok).toBe(false);
    expect(readFileSync(authoringDraftPath(), 'utf8')).toBe(content);
  });
  it('上限超過や欠落した入力で保存済みの内容を壊さない', () => {
    saveAuthoringDraft(draft('keep'));
    const before = readFileSync(authoringDraftPath(), 'utf8');
    expect(saveAuthoringDraft(draft('x'.repeat(MAX_DEFINITION_BYTES + 1))).ok).toBe(false);
    expect(saveAuthoringDraft({ formatVersion: 1, text: 'bad shape' }).ok).toBe(false);
    expect(readFileSync(authoringDraftPath(), 'utf8')).toBe(before);
  });
  it('明示的な破棄後は空の下書きとして保存される', () => {
    saveAuthoringDraft(draft('previous'));
    expect(saveAuthoringDraft(draft('')).ok).toBe(true);
    expect(loadAuthoringDraft()).toMatchObject({ draft: { text: '' } });
  });
});
