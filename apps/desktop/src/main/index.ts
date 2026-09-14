import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc.js';

/**
 * Electron main。設計仕様 §4.3 / §12。
 * `nodeIntegration` は無効、`contextIsolation` は有効。renderer には preload の6チャネルだけを渡す。
 * 完全オフライン（§1.2）のため、外部URLの読込は一切しない。
 */

/** 起動時のウィンドウ寸法（FHDで盤と右パネルが同時に見える大きさ）。§15 */
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'OJT電気保全トレーナー',
    backgroundColor: '#1b1e24',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.setMenuBarVisibility(false);
  window.on('ready-to-show', () => {
    window.show();
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl !== undefined && devUrl.length > 0) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  return window;
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
