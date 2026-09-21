import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from '@playwright/test';
import { APP_ROOT, CHROMIUM_FLAGS } from './app.js';

export interface PackagedApp {
  page: Page;
  /** このフォルダには配布されたEXE1つしか置かない。 */
  received: string;
  close: () => Promise<void>;
}

/** fuse済みの製品版はmainのデバッガを使えないため、通常起動してCDPで操作する。 */
export async function launchPortable(): Promise<PackagedApp> {
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  // TEMPの区切りが「/」でも、作成先と削除範囲の比較を同じ絶対パスに揃える。
  const tempRoot = resolve(tmpdir());
  const root = mkdtempSync(join(tempRoot, 'ojt-portable-e2e-'));
  const received = join(root, 'received');
  const userData = join(root, 'profile');
  mkdirSync(received);
  mkdirSync(userData);
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ restorePrompt: false }));
  const name = 'DenkiKyoikuTool-' + pkg.version + '-x64-Portable.exe';
  const exe = join(received, name);
  let browser: Browser | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let childClosed: Promise<void> | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    const context = browser?.contexts()[0];
    // Chromium自体の終了命令ではなく、利用者と同じく画面を閉じる。
    // Electronのwindow-all-closed → app.quitを通し、NSISのExecWaitへ戻す。
    await Promise.all(context?.pages().map((page) => page.close()) ?? []);
    // exitより後のcloseを待つ。同期削除でイベントループを塞ぐとWindowsのEXEハンドルが残る。
    if (childClosed) await Promise.race([childClosed, delay(15_000)]);
    if (child?.exitCode === null && child.pid) {
      // この起動で作ったプロセスだけを終了する。他のElectronアプリに触れない。
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    }
    if (dirname(root) !== tempRoot) throw new Error('一時データの削除範囲が違います');
    if (childClosed) await childClosed;
    await browser?.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    copyFileSync(join(APP_ROOT, 'release', name), exe);
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('検証用ポートを取得できません');
    await new Promise<void>((done) => {
      server.close(() => {
        done();
      });
    });
    const endpoint = 'http://127.0.0.1:' + address.port;
    child = spawn(
      exe,
      ['--remote-debugging-port=' + address.port, '--user-data-dir=' + userData, ...CHROMIUM_FLAGS],
      {
        cwd: received,
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, NODE_ENV: 'production' },
      },
    );
    let spawnError: Error | undefined;
    childClosed = new Promise<void>((done) => {
      child?.once('close', () => {
        done();
      });
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    for (let n = 0; n < 120; n++) {
      if (spawnError) throw spawnError;
      try {
        if ((await fetch(endpoint + '/json/version')).ok) break;
      } catch {
        /* 起動待ち */
      }
      if (n === 119) throw new Error('配布EXEが60秒以内に起動しません');
      await delay(500);
    }
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('配布EXEの画面がありません');
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    return { page, received, close };
  } catch (error) {
    await close();
    throw error;
  }
}
