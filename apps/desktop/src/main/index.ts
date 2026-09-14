import { join } from 'node:path';
import { app, BrowserWindow, Menu, type WebContents } from 'electron';
import { registerIpc } from './ipc.js';
import { isAppUrl } from './navigation.js';

/**
 * Electron main。設計仕様 §4.3 / §12。
 * `nodeIntegration` は無効、`contextIsolation` は有効。renderer には preload の6チャネルだけを渡す。
 * 完全オフライン（§1.2）のため、外部URLの読込は一切しない。
 *
 * 1D2-a のレビュー指摘を受けた強化:
 * - アプリケーションメニューを外す。既定メニューには Ctrl+R（再読込）・Ctrl+Shift+I（開発者ツール）・
 *   Ctrl+W（ウィンドウを閉じる）のアクセラレータが付いていて、訓練中に押すと作業が丸ごと消える。
 * - 新しいウィンドウを開かせない（`setWindowOpenHandler` で常に `deny`）。
 * - 自分の画面以外への遷移を止める（`will-navigate`）。§1.2
 * - 上の2つは**あとから作られる WebContents にも**効くよう `web-contents-created` で仕掛ける。
 */

/** 起動時のウィンドウ寸法（FHDで盤と右パネルが同時に見える大きさ）。§15 */
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;

/** renderer の `index.html`（本番のビルド成果物）。 */
function rendererFile(): string {
  return join(import.meta.dirname, '../renderer/index.html');
}

/** 開発サーバのURL（`electron-vite dev` が渡す）。本番では `undefined`。 */
function devUrl(): string | undefined {
  const url = process.env['ELECTRON_RENDERER_URL'];
  return url !== undefined && url.length > 0 ? url : undefined;
}

/**
 * 外へ出て行く動きを塞ぐ。§1.2 / §13
 * 新規ウィンドウは常に拒否し、遷移はアプリ自身の画面だけに限る。
 */
function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, { rendererFile: rendererFile(), devUrl: devUrl() })) return;
    event.preventDefault();
  });
}

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
      /*
       * `sandbox: true` にできない理由（1D1-e のレビュー指摘に対する記録）:
       * electron-vite は preload を **ESM の `.js`** として出力するが、サンドボックス化した
       * preload は CommonJS でしか読み込めないため、このままだと preload が丸ごと読み込まれず
       * `window.ojt` が生えない。`.cjs` 出力へ切り替えて `sandbox: true` にする作業は
       * 影響範囲（ビルド設定・E2E・配布）が本タスクの外なので **Plan 1D2 で扱う**。
       * それまでの安全網として、renderer は `window.ojt` を直接触らず `app/ojt-api.ts` の
       * `ojtApi()` を通し、preload が無い場合は日本語の理由付きで例外バナーに出す（§13 #5）。
       */
      sandbox: false,
    },
  });
  window.setMenuBarVisibility(false);
  window.on('ready-to-show', () => {
    window.show();
  });
  const dev = devUrl();
  if (dev !== undefined) {
    void window.loadURL(dev);
  } else {
    void window.loadFile(rendererFile());
  }
  return window;
}

void app.whenReady().then(() => {
  /*
   * 既定のアプリケーションメニューを外す（アクセラレータごと無効になる）。
   * 開発時は electron-vite の `--inspect` や `webContents.openDevTools()` で足りるので、
   * 開発者ツール用のショートカットも敢えて付け直さない（訓練者の誤操作を増やさない）。
   */
  Menu.setApplicationMenu(null);
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents);
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
