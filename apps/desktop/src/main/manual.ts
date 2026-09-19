import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, shell } from 'electron';
import type { OpenManualResult } from '../shared/ipc.js';
import { MSG } from '../shared/messages.js';

/**
 * 同梱の取扱説明書（PDF）を OS の既定ビューアで開く。取扱説明書 設計 §8 / §9。
 *
 * **renderer からは何も受け取らない。** 開くファイルはここで組み立てた1つだけで、
 * renderer が指したパスを開くことはない（`file:saveText` は保存ダイアログを通すので
 * 利用者が行き先を決めるが、こちらは行き先がアプリの中に固定されている）。
 */

/**
 * PDF の置き場所。課題JSON（`content-loader.ts` の `builtinContentDir()`）と同じ流儀で、
 * 配布版は asar の外（`resources/manual.pdf`）、開発中はリポジトリの
 * `apps/desktop/resources/manual/manual.pdf` を見る。
 */
export function manualPdfPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'manual.pdf');
  return resolve(app.getAppPath(), 'resources', 'manual', 'manual.pdf');
}

/** PDF を開く。開けなければ理由を返す（例外にしない。§13）。 */
export async function openManual(): Promise<OpenManualResult> {
  const path = manualPdfPath();
  if (!existsSync(path)) return { ok: false, message: MSG.manual.missing };
  // `shell.openPath()` は成功すると空文字、失敗すると理由の文字列を返す
  const failure = await shell.openPath(path);
  if (failure === '') return { ok: true, path };
  return { ok: false, message: MSG.manual.openFailed(failure) };
}
