import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { app, dialog, shell, type BrowserWindow } from 'electron';
import { validateInWorker } from './definition-validation.js';
import { MAX_DEFINITION_BYTES, type AuthoringResult } from '../shared/authoring.js';
import { isRecord } from '../shared/work-file-schema.js';
import { builtinSet, clearContentCache, loadContent } from './content-loader.js';
import { readSettings } from './settings.js';
import { writeFileAtomic } from './fs-atomic.js';

/** 選択ダイアログで利用者が指定したJSON／設定済み課題フォルダだけを扱う。 */
export async function authorContent(
  window: BrowserWindow | undefined,
  request: unknown,
): Promise<AuthoringResult> {
  const fail = (message: string): AuthoringResult => ({ ok: false, message });
  if (!isRecord(request)) return fail('課題作成の要求を読めません。');
  const directory = readSettings().userContentDir;
  try {
    if (request['action'] === 'choose-directory') {
      const options: Electron.OpenDialogOptions = {
        title: '利用者課題フォルダを選択',
        properties: ['openDirectory', 'createDirectory'],
        ...(directory ? { defaultPath: directory } : {}),
      };
      const picked =
        window === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(window, options);
      const selected = picked.filePaths[0];
      return picked.canceled || selected === undefined
        ? { ok: false, canceled: true, message: '選択を取り消しました。' }
        : { ok: true, directory: selected };
    }
    if (request['action'] === 'open-directory') {
      if (!directory || !statSync(directory).isDirectory())
        return fail('利用者課題フォルダを先に選択してください。');
      const error = await shell.openPath(directory);
      return error ? fail(error) : { ok: true };
    }
    if (request['action'] === 'template') {
      if (typeof request['id'] !== 'string') return fail('複製する課題を選択してください。');
      const source = (await loadContent(directory)).byId.get(request['id']);
      if (source === undefined) return fail('複製元の課題が見つかりません。');
      const occupied = new Set((await loadContent(directory)).byId.keys());
      let id = `user-${source.id}`,
        n = 2;
      while (occupied.has(id)) id = `user-${source.id}-${n++}`;
      return {
        ok: true,
        text: JSON.stringify({ ...source, id, title: `${source.title}（編集用）` }, null, 2),
      };
    }
    if (request['action'] === 'open') {
      const options: Electron.OpenDialogOptions = {
        title: '編集する課題JSONを開く',
        properties: ['openFile'],
        filters: [{ name: '課題JSON', extensions: ['json'] }],
      };
      const picked =
        window === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(window, options);
      const path = picked.filePaths[0];
      if (picked.canceled || path === undefined)
        return { ok: false, canceled: true, message: '読込を取り消しました。' };
      if (statSync(path).size > MAX_DEFINITION_BYTES) return fail('課題JSONは5 MBまでです。');
      return { ok: true, text: readFileSync(path, 'utf8').replace(/^\uFEFF/u, '') };
    }
    if (request['action'] !== 'validate' && request['action'] !== 'save')
      return fail('未対応の課題操作です。');
    const source = request['text'];
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_DEFINITION_BYTES)
      return fail('課題JSONは5 MBまでです。');
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      return fail(`JSONの括弧・カンマを確認してください：${String(error)}`);
    }
    const validation = await validateInWorker(parsed);
    if (request['action'] === 'validate') return { ok: true, validation };
    if (validation.reasons.length > 0 || validation.id === undefined)
      return {
        ok: false,
        message: '課題の検証が通っていません。下の指摘を直してください。',
        validation,
      };
    const builtin = (await builtinSet()).problems.some((problem) => problem.id === validation.id);
    const options: Electron.SaveDialogOptions = {
      title: builtin ? '同じIDの内蔵課題を置き換える利用者課題として保存' : '検証済み課題を保存',
      defaultPath: join(directory || app.getPath('documents'), `${validation.id}.json`),
      filters: [{ name: '課題JSON', extensions: ['json'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    };
    const picked =
      window === undefined
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(window, options);
    if (picked.canceled || picked.filePath === undefined)
      return { ok: false, canceled: true, message: '保存を取り消しました。' };
    const target = picked.filePath;
    // JSON以外を意図せず上書きしない。
    if (!basename(target).toLowerCase().endsWith('.json'))
      return fail('保存するファイル名の末尾を .json にしてください。');
    writeFileAtomic(target, `${JSON.stringify(parsed, null, 2)}\n`);
    clearContentCache();
    return { ok: true, path: target, directory: dirname(target), validation };
  } catch (error) {
    return fail(`課題ファイルを操作できません：${String(error)}`);
  }
}
