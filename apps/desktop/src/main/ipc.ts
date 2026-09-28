import { BrowserWindow, ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type SaveTextRequest,
  type WorkFileLoadRequest,
  type WorkFileSaveRequest,
} from '../shared/ipc.js';

/**
 * IPC ハンドラ。設計仕様 §4.3 の9チャネルだけを登録する。
 * renderer からの入力は信用せず、この層で型を確かめてから使う。
 */

/** §4.3 の9チャネルを登録する。 */
export function registerIpc(): void {
  // 登録時は重い課題・検算・PDFモジュールを評価しない。最初に使う時だけ読み、以後は
  // ESMのキャッシュを使う。ウィンドウの初回描画を全機能の初期化で待たせない。
  ipcMain.handle(IPC_CHANNELS.contentAuthor, async (event, request: unknown) => {
    const { authorContent } = await import('./authoring.js');
    return authorContent(BrowserWindow.fromWebContents(event.sender) ?? undefined, request);
  });
  /*
   * 課題一覧と課題1件。`loadContent()` は結果を1件だけ覚えているので、
   * 一覧の直後に来る `content:read` は読み直しにならない（§7.8）。
   */
  ipcMain.handle(IPC_CHANNELS.contentList, async () => {
    const { loadContent } = await import('./content-loader.js');
    const { readSettings } = await import('./settings.js');
    const content = await loadContent(readSettings().userContentDir);
    return content.payload;
  });

  ipcMain.handle(IPC_CHANNELS.contentRead, async (_event, id: unknown) => {
    if (typeof id !== 'string') return null;
    const { loadContent } = await import('./content-loader.js');
    const { readSettings } = await import('./settings.js');
    const content = await loadContent(readSettings().userContentDir);
    return content.byId.get(id) ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.workfileSave, async (event, request: WorkFileSaveRequest) => {
    const { saveWorkFile } = await import('./work-files.js');
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return saveWorkFile(window, request);
  });

  ipcMain.handle(IPC_CHANNELS.workfileLoad, async (event, request: WorkFileLoadRequest) => {
    const { loadWorkFile } = await import('./work-files.js');
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return loadWorkFile(window, request);
  });

  // 設定ファイルが壊れていたときの警告も同じ戻りに載せる（チャネルは増やさない。§4.3）
  ipcMain.handle(IPC_CHANNELS.settingsGet, async () => {
    const { readSettingsResponse } = await import('./settings.js');
    return readSettingsResponse();
  });

  // `patch` は renderer からの生入力。型は信用せず `writeSettings()` 内で1キーずつ検証する
  ipcMain.handle(IPC_CHANNELS.settingsSet, async (_event, patch: unknown) => {
    const { writeSettings } = await import('./settings.js');
    return writeSettings(patch);
  });

  // --- Plan 4B Task 9 ---
  // 命令語リストの保存（§10.7）。中身の大きさと既定ファイル名は `saveTextFile()` が確かめる
  ipcMain.handle(IPC_CHANNELS.textfileSave, async (event, request: SaveTextRequest) => {
    const { saveTextFile } = await import('./text-files.js');
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return saveTextFile(window, request);
  });
  // --- /Plan 4B Task 9 ---

  // --- Plan 6 Task 7 ---
  // 取扱説明書（PDF）を OS の既定ビューアで開く（取扱説明書 設計 §8）。引数は取らない
  ipcMain.handle(IPC_CHANNELS.manualOpen, async () => {
    const { openManual } = await import('./manual.js');
    return openManual();
  });
  ipcMain.handle(IPC_CHANNELS.resultExport, async (event, request: unknown) => {
    const { exportResult } = await import('./result-export.js');
    return exportResult(BrowserWindow.fromWebContents(event.sender) ?? undefined, request);
  });
  // --- /Plan 6 Task 7 ---
}
