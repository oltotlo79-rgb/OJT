import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  app,
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import {
  WORK_FILE_FORMAT_VERSION,
  type WorkFile,
  type WorkFileLoadRequest,
  type WorkFileLoadResult,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../shared/ipc.js';
import { MSG, readFailedText, saveFailedText } from '../shared/messages.js';

/**
 * 作業ファイルの保存／読込と一時保存。設計仕様 §12.3 / §13 #7 / §13 #8。
 * 拡張子は `.ojtw`。一時保存は `app.getPath('userData')/autosave.json` に固定で書く。
 *
 * 保存は**一時ファイル→rename**で書く（1D1 のレビュー指摘: 直接 `writeFileSync(target, ...)`
 * だと書込の途中でアプリが落ちる／電源が切れたときに本体が壊れた内容で残る。同じフォルダの
 * 一時ファイルに書いてから `renameSync()` で置き換えると、置き換え自体は1回のファイル
 * システム操作なので本体が半端な内容のまま残ることが無い）。
 *
 * 読み込む前に**大きさと本数の上限**で断る（1D2-a のレビュー指摘: 10MB・10万本の作業ファイルを
 * そのまま `JSON.parse()` して盤に載せようとすると、main も renderer も固まる）。
 */

/** 読み込める作業ファイルの最大バイト数。§13 #8 */
export const MAX_WORK_FILE_BYTES = 5 * 1024 * 1024;

/** 読み込める電線の本数の上限（renderer の `toSession()` と同じ値）。§13 #8 */
export const MAX_WORK_FILE_WIRES = 200;

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
    return { ok: false, message: MSG.workFile.badShape };
  }
  const source = raw as Record<string, unknown>;
  const version = source['formatVersion'];
  // 正の整数でなければ「形式バージョンが無い」と同じ扱いにする（0・負数・NaN・小数を含む）
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: MSG.workFile.missingVersion };
  }
  if (version > WORK_FILE_FORMAT_VERSION) {
    return { ok: false, message: MSG.workFile.tooNew };
  }
  if (
    typeof source['problemId'] !== 'string' ||
    typeof source['session'] !== 'object' ||
    source['session'] === null
  ) {
    return { ok: false, message: MSG.workFile.missingFields };
  }
  /*
   * 本数の上限はここでも見る。中身の妥当性（端子が盤にあるか等）は renderer の `toSession()` が
   * 盤の定義を見て確かめるが、「そもそも桁が違う」ものは盤に渡す前に main で断る。
   */
  const wires = (source['session'] as Record<string, unknown>)['wires'];
  if (Array.isArray(wires) && wires.length > MAX_WORK_FILE_WIRES) {
    return { ok: false, message: MSG.workFile.tooManyWires };
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

/**
 * ダイアログを出す。ウィンドウが無ければ**引数1つ**の形で呼ぶ（1D2-a のレビュー指摘）。
 * 以前は `{} as BrowserWindow` を渡していたが、Electron 側は本物の `BrowserWindow` を期待して
 * いるので、実装が変われば型を誤魔化した嘘の値で落ちる。Electron は親ウィンドウ無しの
 * 単一引数オーバーロードを備えているので、そちらを使う。
 */
async function showSave(
  window: BrowserWindow | undefined,
  options: SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  return window === undefined
    ? dialog.showSaveDialog(options)
    : dialog.showSaveDialog(window, options);
}

async function showOpen(
  window: BrowserWindow | undefined,
  options: OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  return window === undefined
    ? dialog.showOpenDialog(options)
    : dialog.showOpenDialog(window, options);
}

/** 作業ファイルを保存する。`manual` はダイアログで保存先を選ばせる。§12.3 / §13 #7 */
export async function saveWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileSaveRequest,
): Promise<WorkFileSaveResult> {
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await showSave(window, {
      title: MSG.workFile.saveTitle,
      defaultPath: join(app.getPath('documents'), `${request.file.problemId}.ojtw`),
      filters: [{ name: MSG.workFile.filterName, extensions: ['ojtw'] }],
    });
    if (picked.canceled || picked.filePath === undefined) {
      return { ok: false, canceled: true, message: MSG.workFile.saveCanceled };
    }
    target = picked.filePath;
  }
  try {
    writeFileAtomic(target, `${JSON.stringify(request.file, null, 2)}\n`);
    return { ok: true, path: target };
  } catch (cause) {
    return { ok: false, canceled: false, message: saveFailedText(String(cause)) };
  }
}

/** 作業ファイルを読み込む。`manual` はダイアログで選ばせる。§12.3 / §13 #8 */
export async function loadWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileLoadRequest,
): Promise<WorkFileLoadResult> {
  if (request.discard === true) {
    clearAutosave();
    return { ok: false, canceled: true, message: MSG.workFile.autosaveCleared };
  }
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await showOpen(window, {
      title: MSG.workFile.loadTitle,
      properties: ['openFile'],
      filters: [{ name: MSG.workFile.filterName, extensions: ['ojtw'] }],
    });
    const first = picked.filePaths[0];
    if (picked.canceled || first === undefined) {
      return { ok: false, canceled: true, message: MSG.workFile.loadCanceled };
    }
    target = first;
  }
  // 大きすぎるファイルは読む前に断る（`JSON.parse()` に何十MBも渡さない）。§13 #8
  try {
    if (statSync(target).size > MAX_WORK_FILE_BYTES) {
      return { ok: false, canceled: false, message: MSG.workFile.tooLarge };
    }
  } catch (cause) {
    return { ok: false, canceled: false, message: readFailedText(String(cause)) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(target, 'utf8'));
  } catch (cause) {
    return { ok: false, canceled: false, message: readFailedText(String(cause)) };
  }
  const parsed = parseWorkFile(raw);
  if (!parsed.ok) return { ok: false, canceled: false, message: parsed.message };
  return { ok: true, file: parsed.file, path: target };
}
