import { join } from 'node:path';
import { app, BrowserWindow, Menu, session, ipcMain, dialog, type WebContents } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc.js';
import { registerIpc } from './ipc.js';
import { isAppUrl } from './navigation.js';

/**
 * Electron main。設計仕様 §4.3 / §12。
 * `nodeIntegration` は無効、`contextIsolation` は有効。renderer には preload の9チャネルだけを渡す。
 * 完全オフライン（§1.2）のため、外部URLの読込は一切しない。
 *
 * 1D2-a のレビュー指摘を受けた強化:
 * - アプリケーションメニューを外す。既定メニューには Ctrl+R（再読込）・Ctrl+Shift+I（開発者ツール）・
 *   Ctrl+W（ウィンドウを閉じる）のアクセラレータが付いていて、訓練中に押すと作業が丸ごと消える。
 * - 新しいウィンドウを開かせない（`setWindowOpenHandler` で常に `deny`）。
 * - 自分の画面以外への遷移を止める（`will-navigate`）。§1.2
 * - 上の2つは**あとから作られる WebContents にも**効くよう `web-contents-created` で仕掛ける。
 *
 * Phase 7 Task 8（指摘 DM-4 / DM-5 ≡ QA-05）でさらに締めた:
 * - `sandbox: true`。renderer は OS のサンドボックスの中で動き、preload も Node の全体では
 *   なく限られた API しか持たない（preload は CommonJS で読み込まれる。§後述）。
 * - 権限要求（カメラ・マイク・通知・位置情報など）を**全部断る**。完全オフラインの
 *   訓練ツールなので、renderer がこれらを欲しがる正当な場面が1つも無い。§1.2
 * - `webviewTag` / `allowRunningInsecureContent` / `webSecurity` を明示する。いずれも
 *   既定値と同じだが、**書いていないと既定値が変わったときに黙って緩む**。
 */

if (process.env['OJT_RECORDING'] === '1') {
  for (const flag of [
    'disable-background-timer-throttling',
    'disable-renderer-backgrounding',
    'disable-backgrounding-occluded-windows',
  ])
    app.commandLine.appendSwitch(flag);
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

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
    title: '電気教育ツール',
    backgroundColor: '#1b1e24',
    webPreferences: {
      /*
       * サンドボックス化した renderer は preload を **CommonJS** として読み込む。
       * electron-vite の preload ビルドを `{ format: 'cjs', entryFileNames: 'index.cjs' }`
       * にしてあるので、読み込み先も `.cjs`。**この2つは必ず対で直すこと**——片方だけ
       * 直すと preload が読み込まれず `window.ojt` が生えないまま起動してしまう
       * （`test/hardening.test.ts` が対になっていることを見ている）。
       */
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      backgroundThrottling: process.env['OJT_RECORDING'] !== '1',
      contextIsolation: true,
      nodeIntegration: false,
      /*
       * renderer を OS のサンドボックスに入れる（DM-4。所有者決定 2026-09-20 (a)）。
       * preload は `electron` の `contextBridge` / `ipcRenderer` しか使っていないので、
       * サンドボックスの中でもそのまま動く。Node の `fs` などが要る仕事は元から全部
       * main 側（§4.3 の9チャネル）にある。
       */
      sandbox: true,
      /** `<webview>` は使わない。埋め込みブラウザの面をそもそも持たせない。 */
      webviewTag: false,
      /** 安全でない内容を混ぜて読ませない（既定と同じだが明示する）。 */
      allowRunningInsecureContent: false,
      /** 同一生成元ポリシーを切らない（既定と同じだが明示する）。 */
      webSecurity: true,
    },
  });
  let mayClose = false;
  let token = 0;
  let waiting = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const ready = (event: Electron.IpcMainEvent, answer: unknown, ok: unknown): void => {
    if (event.sender !== window.webContents || answer !== token || !waiting) return;
    waiting = false;
    clearTimeout(timeout);
    if (ok === true) {
      mayClose = true;
      window.close();
    }
  };
  ipcMain.on(IPC_CHANNELS.closeReady, ready);
  window.on('close', (event) => {
    if (mayClose || window.webContents.isDestroyed()) return;
    event.preventDefault();
    if (waiting) return;
    waiting = true;
    token += 1;
    window.webContents.send(IPC_CHANNELS.closeRequest, token);
    timeout = setTimeout(() => {
      waiting = false;
      void dialog.showMessageBox(window, {
        type: 'error',
        message: '作業の保存を確認できないため、終了を中止しました。',
        detail: 'アプリの応答を確認し、作業ファイルを保存してから終了してください。',
        buttons: ['作業に戻る'],
      });
    }, 15_000);
  });
  window.on('closed', () => {
    clearTimeout(timeout);
    ipcMain.removeListener(IPC_CHANNELS.closeReady, ready);
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
  /*
   * 権限要求は一律で断る（DM-5 ≡ QA-05）。カメラ・マイク・位置情報・通知・クリップボード
   * 読み取りなど、この訓練ツールが必要とするものは1つも無い。既定のハンドラは種類に
   * よっては黙って許してしまうので、明示的に「全部 false」を置く。§1.2
   */
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
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
