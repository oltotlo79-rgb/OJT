import { BrowserWindow, ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type SaveTextRequest,
  type WorkFileLoadRequest,
  type WorkFileSaveRequest,
} from '../shared/ipc.js';
import { loadContent } from './content-loader.js';
import { authorContent } from './authoring.js';
import { openManual } from './manual.js';
import { exportResult } from './result-export.js';
import { readSettings, readSettingsResponse, writeSettings } from './settings.js';
import { saveTextFile } from './text-files.js';
import { loadWorkFile, saveWorkFile } from './work-files.js';

/**
 * IPC ハンドラ。設計仕様 §4.3 の9チャネルだけを登録する。
 * renderer からの入力は信用せず、この層で型を確かめてから使う。
 */

/** §4.3 の9チャネルを登録する。 */
export function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.contentAuthor, (event, request: unknown) =>
    authorContent(BrowserWindow.fromWebContents(event.sender) ?? undefined, request),
  );
  /*
   * 課題一覧と課題1件。`loadContent()` は結果を1件だけ覚えているので、
   * 一覧の直後に来る `content:read` は読み直しにならない（§7.8）。
   */
  ipcMain.handle(IPC_CHANNELS.contentList, async () => {
    const content = await loadContent(readSettings().userContentDir);
    return content.payload;
  });

  ipcMain.handle(IPC_CHANNELS.contentRead, async (_event, id: unknown) => {
    if (typeof id !== 'string') return null;
    const content = await loadContent(readSettings().userContentDir);
    return content.byId.get(id) ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.workfileSave, async (event, request: WorkFileSaveRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return saveWorkFile(window, request);
  });

  ipcMain.handle(IPC_CHANNELS.workfileLoad, async (event, request: WorkFileLoadRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return loadWorkFile(window, request);
  });

  // 設定ファイルが壊れていたときの警告も同じ戻りに載せる（チャネルは増やさない。§4.3）
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => readSettingsResponse());

  // `patch` は renderer からの生入力。型は信用せず `writeSettings()` 内で1キーずつ検証する
  ipcMain.handle(IPC_CHANNELS.settingsSet, (_event, patch: unknown) => writeSettings(patch));

  // --- Plan 4B Task 9 ---
  // 命令語リストの保存（§10.7）。中身の大きさと既定ファイル名は `saveTextFile()` が確かめる
  ipcMain.handle(IPC_CHANNELS.textfileSave, async (event, request: SaveTextRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return saveTextFile(window, request);
  });
  // --- /Plan 4B Task 9 ---

  // --- Plan 6 Task 7 ---
  // 取扱説明書（PDF）を OS の既定ビューアで開く（取扱説明書 設計 §8）。引数は取らない
  ipcMain.handle(IPC_CHANNELS.manualOpen, () => openManual());
  ipcMain.handle(IPC_CHANNELS.resultExport, (event, request: unknown) =>
    exportResult(BrowserWindow.fromWebContents(event.sender) ?? undefined, request),
  );
  // --- /Plan 6 Task 7 ---
}
