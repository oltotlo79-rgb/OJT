import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import {
  WORK_FILE_FORMAT_VERSION,
  type WorkFile,
  type WorkFileLoadRequest,
  type WorkFileLoadResult,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../shared/ipc.js';

/**
 * 作業ファイルの保存／読込と一時保存。設計仕様 §12.3 / §13 #7 / §13 #8。
 * 拡張子は `.ojtw`。一時保存は `app.getPath('userData')/autosave.json` に固定で書く。
 *
 * 保存は**一時ファイル→rename**で書く（1D1 のレビュー指摘: 直接 `writeFileSync(target, ...)`
 * だと書込の途中でアプリが落ちる／電源が切れたときに本体が壊れた内容で残る。同じフォルダの
 * 一時ファイルに書いてから `renameSync()` で置き換えると、置き換え自体は1回のファイル
 * システム操作なので本体が半端な内容のまま残ることが無い）。
 */

/** 一時保存のパス。§12.3 */
export function autosavePath(): string {
  return join(app.getPath('userData'), 'autosave.json');
}

/** 一時ファイル→rename でアトミックに書く。 */
function writeFileAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, target);
}

/** 作業ファイルの検証。未知の `formatVersion` は読み込まない。§13 #8 */
export function parseWorkFile(
  raw: unknown,
): { ok: true; file: WorkFile } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: '作業ファイルの形式が不正です' };
  }
  const source = raw as Record<string, unknown>;
  const version = source['formatVersion'];
  // 正の整数でなければ「形式バージョンが無い」と同じ扱いにする（0・負数・NaN・小数を含む）
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: '作業ファイルに形式バージョンがありません' };
  }
  if (version > WORK_FILE_FORMAT_VERSION) {
    return { ok: false, message: 'このファイルは新しいバージョンで作成されています' };
  }
  if (
    typeof source['problemId'] !== 'string' ||
    typeof source['session'] !== 'object' ||
    source['session'] === null
  ) {
    return { ok: false, message: '作業ファイルに課題IDまたは盤の状態がありません' };
  }
  return {
    ok: true,
    file: {
      formatVersion: version,
      problemId: source['problemId'],
      session: source['session'],
      elapsedMs: typeof source['elapsedMs'] === 'number' ? source['elapsedMs'] : 0,
      hazardCount: typeof source['hazardCount'] === 'number' ? source['hazardCount'] : 0,
      savedAt: typeof source['savedAt'] === 'string' ? source['savedAt'] : '',
    },
  };
}

/** 一時保存を消す（「復元しない」を選んだとき）。§12.3 */
export function clearAutosave(): void {
  try {
    rmSync(autosavePath(), { force: true });
  } catch {
    // 消せなくても起動を妨げない
  }
}

/** 作業ファイルを保存する。`manual` はダイアログで保存先を選ばせる。§12.3 / §13 #7 */
export async function saveWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileSaveRequest,
): Promise<WorkFileSaveResult> {
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await dialog.showSaveDialog(window ?? ({} as BrowserWindow), {
      title: '作業ファイルを保存',
      defaultPath: join(app.getPath('documents'), `${request.file.problemId}.ojtw`),
      filters: [{ name: 'OJT作業ファイル', extensions: ['ojtw'] }],
    });
    if (picked.canceled || picked.filePath === undefined) {
      return { ok: false, canceled: true, message: '保存を取り消しました' };
    }
    target = picked.filePath;
  }
  try {
    writeFileAtomic(target, `${JSON.stringify(request.file, null, 2)}\n`);
    return { ok: true, path: target };
  } catch (cause) {
    return { ok: false, canceled: false, message: `保存に失敗しました: ${String(cause)}` };
  }
}

/** 作業ファイルを読み込む。`manual` はダイアログで選ばせる。§12.3 / §13 #8 */
export async function loadWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileLoadRequest,
): Promise<WorkFileLoadResult> {
  if (request.discard === true) {
    clearAutosave();
    return { ok: false, canceled: true, message: '一時保存を削除しました' };
  }
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await dialog.showOpenDialog(window ?? ({} as BrowserWindow), {
      title: '作業ファイルを読み込む',
      properties: ['openFile'],
      filters: [{ name: 'OJT作業ファイル', extensions: ['ojtw'] }],
    });
    const first = picked.filePaths[0];
    if (picked.canceled || first === undefined) {
      return { ok: false, canceled: true, message: '読込を取り消しました' };
    }
    target = first;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(target, 'utf8'));
  } catch (cause) {
    return { ok: false, canceled: false, message: `ファイルを読めませんでした: ${String(cause)}` };
  }
  const parsed = parseWorkFile(raw);
  if (!parsed.ok) return { ok: false, canceled: false, message: parsed.message };
  return { ok: true, file: parsed.file, path: target };
}
