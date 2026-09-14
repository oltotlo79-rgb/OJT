import { BrowserWindow, ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type AppSettings,
  type WorkFileLoadRequest,
  type WorkFileSaveRequest,
} from '../shared/ipc.js';
import { loadContent } from './content-loader.js';
import { readSettings, writeSettings } from './settings.js';
import { loadWorkFile, saveWorkFile } from './work-files.js';

/**
 * IPC ハンドラ。設計仕様 §4.3 の6チャネルだけを登録する。
 * renderer からの入力は信用せず、この層で型を確かめてから使う。
 */

/** §4.3 の6チャネルを登録する。 */
export function registerIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.contentList,
    () => loadContent(readSettings().userContentDir).payload,
  );

  ipcMain.handle(IPC_CHANNELS.contentRead, (_event, id: unknown) => {
    if (typeof id !== 'string') return null;
    return loadContent(readSettings().userContentDir).byId.get(id) ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.workfileSave, async (event, request: WorkFileSaveRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return saveWorkFile(window, request);
  });

  ipcMain.handle(IPC_CHANNELS.workfileLoad, async (event, request: WorkFileLoadRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return loadWorkFile(window, request);
  });

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => readSettings());

  ipcMain.handle(IPC_CHANNELS.settingsSet, (_event, patch: Partial<AppSettings>) =>
    writeSettings(patch ?? {}),
  );
}
