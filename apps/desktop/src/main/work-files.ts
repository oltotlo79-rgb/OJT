import { parseWorkFile } from '../shared/work-file-codec.js';
export { parseWorkFile } from '../shared/work-file-codec.js';
import { MAX_NETWORKS } from '@ojt/ladder-core';
import { MAX_RESTORED_WIRES } from '../shared/work-file-schema.js';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import {
  type WorkFileLoadRequest,
  type WorkFileLoadResult,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../shared/ipc.js';
import { errnoText, MSG, readFailedText, saveFailedText } from '../shared/messages.js';
import { safeFileName } from '../shared/safe-file-name.js';
import { writeFileAtomic } from './fs-atomic.js';
import { rescueOversizedWorkFile } from './work-file-rescue.js';

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
export const MAX_WORK_FILE_WIRES = MAX_RESTORED_WIRES;

/**
 * C1/C2 の並び（解答・指摘・故障・交換した部品）に載せられる要素数の上限。§13 #8
 *
 * 内蔵課題の実際の上限は解答12件・故障3件ほどなので、桁で余裕を持たせた値にする。
 * ここで断るのは「そもそも桁が違う」ファイルだけで、中身の妥当性（その部品が課題にあるか等）は
 * 課題を知っている renderer が確かめる。
 */
export const MAX_WORK_FILE_ENTRIES = 200;

/**
 * 回路図ヒントを開いた回数の上限（§8.4）。実際に何百回も開くことは無いが、
 * 壊れた／悪意ある作業ファイルの数値をそのまま結果画面に出さないよう桁で断る。
 */
export const MAX_SCHEMATIC_OPEN_COUNT = 10_000;

/**
 * プローブの端子IDとして受け入れる文字数の上限（renderer の `toProbeTerminal()` と同じ値）。
 * §12.3
 */
export const MAX_PROBE_TERMINAL_ID_LENGTH = 32;

/** 作業ファイルに載せられるネットワーク数の上限（`LadderProgramSchema` と同じ値）。§10.3 */
export const MAX_WORK_FILE_NETWORKS = MAX_NETWORKS;

/** 一時保存のパス。§12.3 */
export function autosavePath(): string {
  return join(app.getPath('userData'), 'autosave.json');
}

/**
 * `tester.black` / `tester.red`（探針を挿した端子ID）を、壊れた／作為的な値から守る。§12.3 / §13 #8
 *
 * main は盤の定義を知らないので「その端子が盤に実在するか」までは確かめない（renderer の
 * `toSession()` / `ProbeMarkers.scenePosOf()` が黙って落とす）。ここで見るのは形だけ:
 * 文字列で、空でなく、上限文字数以内であること。それ以外（他の型・空文字・長すぎる文字列）は
 * その項目だけ落とす（`tester` オブジェクト自体は残す。壊れているのは探針の位置だけなので、
 * つまみ・レンジ・0Ω調整まで道連れにして読込を断る理由はない）。
 */
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

/**
 * 作業ファイルを保存する。`manual` はダイアログで保存先を選ばせる。§12.3 / §13 #7
 *
 * `request` は renderer からの生入力（IPC は実行時に型を強制しない）なので、`text-files.ts` の
 * `saveTextFile()` と同じ3点を冒頭で確かめる（レビュー DM-2）:
 * ①型（`problemId` が文字列か）②既定ファイル名を `safeFileName()` で無害化 ③大きさの上限。
 */
export async function saveWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileSaveRequest,
): Promise<WorkFileSaveResult> {
  if (typeof request.file?.problemId !== 'string') {
    return { ok: false, canceled: false, message: MSG.workFile.badShape };
  }
  const parsed = parseWorkFile(request.file);
  if (!parsed.ok) return { ok: false, canceled: false, message: parsed.message };
  const content = `${JSON.stringify(parsed.file, null, 2)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_WORK_FILE_BYTES) {
    return { ok: false, canceled: false, message: MSG.workFile.tooLarge };
  }
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await showSave(window, {
      title: MSG.workFile.saveTitle,
      // `problemId` は renderer からの生入力（例: `../../evil`）をそのまま使わない（DM-2）
      defaultPath: join(
        app.getPath('documents'),
        safeFileName(`${request.file.problemId}.ojtw`, 'work-file.ojtw'),
      ),
      filters: [{ name: MSG.workFile.filterName, extensions: ['ojtw'] }],
    });
    if (picked.canceled || picked.filePath === undefined) {
      return { ok: false, canceled: true, message: MSG.workFile.saveCanceled };
    }
    target = picked.filePath;
  }
  try {
    writeFileAtomic(target, content);
    return { ok: true, path: target };
  } catch (cause) {
    return { ok: false, canceled: false, message: saveFailedText(errnoText(cause)) };
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
    return { ok: false, canceled: false, message: readFailedText(errnoText(cause)) };
  }
  let raw: unknown;
  let originalText: string;
  try {
    originalText = readFileSync(target, 'utf8');
    raw = JSON.parse(originalText.replace(/^\uFEFF/u, ''));
  } catch (cause) {
    return { ok: false, canceled: false, message: readFailedText(errnoText(cause)) };
  }
  const parsed = parseWorkFile(raw);
  if (!parsed.ok) {
    const message =
      parsed.message === MSG.workFile.tooManyNetworks
        ? await rescueOversizedWorkFile(window, raw, originalText)
        : parsed.message;
    return { ok: false, canceled: false, message };
  }
  return { ok: true, file: parsed.file, path: target };
}
