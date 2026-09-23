import { constants, copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import {
  MAX_DEFINITION_BYTES,
  type AuthoringDraft,
  type AuthoringResult,
} from '../shared/authoring.js';
import { isRecord } from '../shared/work-file-schema.js';
import { writeFileAtomic } from './fs-atomic.js';

const MAX_DRAFT_FILE_BYTES = 16 * 1024 * 1024;
export function authoringDraftPath(): string {
  return join(app.getPath('userData'), 'authoring-draft.json');
}

function isDraft(raw: unknown): raw is AuthoringDraft {
  if (!isRecord(raw) || raw['formatVersion'] !== 1) return false;
  return (
    ['text', 'savedText'].every(
      (key) =>
        typeof raw[key] === 'string' && Buffer.byteLength(raw[key], 'utf8') <= MAX_DEFINITION_BYTES,
    ) &&
    ['templateId', 'savedDirectory', 'savedAt'].every(
      (key) => typeof raw[key] === 'string' && raw[key].length <= 4096,
    )
  );
}

/** 読めない原本は、控えを残せた場合だけ新しい下書きで置き換えられる。 */
export function loadAuthoringDraft(): AuthoringResult {
  const path = authoringDraftPath();
  try {
    if (!existsSync(path)) return { ok: true };
    if (statSync(path).size > MAX_DRAFT_FILE_BYTES)
      return {
        ok: false,
        message:
          '課題下書きファイルが16 MBを超えています。元のファイルを保護し、自動保存を中止しました。',
      };
    try {
      const draft: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
      if (
        isRecord(draft) &&
        typeof draft['formatVersion'] === 'number' &&
        draft['formatVersion'] > 1
      )
        return {
          ok: false,
          message:
            'この課題下書きは新しい版のアプリで作成されています。元のファイルを保護しました。',
        };
      if (isDraft(draft)) return { ok: true, draft };
    } catch {
      /* 控えを作成してから、新しい下書きを受け入れる。 */
    }
    const backup = join(app.getPath('userData'), `authoring-draft.invalid-${randomUUID()}.json`);
    copyFileSync(path, backup, constants.COPYFILE_EXCL);
    return { ok: true, warning: `前回の課題下書きを読み込めません。控えを残しました：${backup}` };
  } catch (error) {
    return {
      ok: false,
      message: `課題下書きを読み込めません。元のファイルは変更していません：${String(error)}`,
    };
  }
}

export function saveAuthoringDraft(raw: unknown): AuthoringResult {
  if (!isDraft(raw))
    return {
      ok: false,
      message: '課題下書きの形式を確認してください。編集中と保存済みのJSONはそれぞれ5 MBまでです。',
    };
  const content = `${JSON.stringify(raw)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_DRAFT_FILE_BYTES)
    return {
      ok: false,
      message: '課題下書き全体が16 MBを超えています。内容を小さくして再試行してください。',
    };
  const previous = loadAuthoringDraft();
  if (!previous.ok) return previous;
  try {
    writeFileAtomic(authoringDraftPath(), content);
    return { ok: true, ...(previous.warning === undefined ? {} : { warning: previous.warning }) };
  } catch (error) {
    return { ok: false, message: `課題下書きを保存できません：${String(error)}` };
  }
}
