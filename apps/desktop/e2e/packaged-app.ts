import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from '@playwright/test';
import { APP_ROOT, CHROMIUM_FLAGS, SHOT_DIR } from './app.js';

export interface PackagedApp {
  page: Page;
  /** このフォルダには配布されたEXE1つしか置かない。 */
  received: string;
  close: () => Promise<void>;
}

/** fuse済みの製品版はmainのデバッガを使えないため、通常起動してCDPで操作する。 */
export async function launchPortable(options: { userDataDir?: string } = {}): Promise<PackagedApp> {
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  // TEMPの区切りが「/」でも、作成先と削除範囲の比較を同じ絶対パスに揃える。
  const tempRoot = resolve(tmpdir());
  const root = mkdtempSync(join(tempRoot, 'ojt-portable-e2e-'));
  const received = join(root, 'received');
  // 再起動の検査では、呼出側が所有・後始末するプロファイルを同じ場所で再利用する。
  const userData = options.userDataDir ?? join(root, 'profile');
  mkdirSync(received);
  mkdirSync(userData, { recursive: true });
  if (!existsSync(join(userData, 'settings.json')))
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ restorePrompt: false }));
  const name = 'DenkiKyoikuTool-' + pkg.version + '-x64-Portable.exe';
  const exe = join(received, name);
  let browser: Browser | undefined;
  let mainProcessId: number | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let childClosed: Promise<void> | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    let forced = false;
    let closeError: Error | undefined;
    // CDPやwindow.closeでWebContentsを先に破棄すると、BrowserWindowの保存確認を迂回する。
    // このCDP接続が返したElectron mainのウィンドウだけへ、Windows標準の終了要求を送る。
    if (mainProcessId !== undefined && child?.exitCode === null) {
      try {
        // DOMが描画されても、ready-to-show前はWindowsの主ウィンドウがまだ無い。
        // 起動直後の検査でも、同じPIDのウィンドウが現れてから終了要求を送る。
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            [
              `$ownedProcess = Get-Process -Id ${mainProcessId} -ErrorAction SilentlyContinue`,
              'if ($ownedProcess) {',
              '  $readyDeadline = [DateTime]::UtcNow.AddSeconds(15)',
              '  do {',
              '    $ownedProcess.Refresh()',
              '    if ($ownedProcess.HasExited) { exit 0 }',
              '    if ($ownedProcess.MainWindowHandle -ne 0) { break }',
              '    Start-Sleep -Milliseconds 100',
              '  } while ([DateTime]::UtcNow -lt $readyDeadline)',
              '  if (-not $ownedProcess.CloseMainWindow()) { throw "Test window did not accept WM_CLOSE (handle=$($ownedProcess.MainWindowHandle))" }',
              '}',
            ].join('\n'),
          ],
          { windowsHide: true, stdio: 'pipe', timeout: 20_000 },
        );
      } catch (error) {
        // 終了要求自体が失敗しても、所有する検証プロセスの後始末まで進める。
        closeError = error instanceof Error ? error : new Error(String(error));
      }
    }
    // exitより後のcloseを待つ。同期削除でイベントループを塞ぐとWindowsのEXEハンドルが残る。
    // 配布側のファイル解放待ち（最大60秒）が終わる前に強制終了しない。
    if (childClosed) await Promise.race([childClosed, delay(75_000)]);
    if (child?.exitCode === null && child.pid) {
      forced = true;
      mkdirSync(SHOT_DIR, { recursive: true });
      const stillOpen = browser?.contexts()[0]?.pages() ?? [];
      writeFileSync(
        join(SHOT_DIR, 'portable-close-timeout.json'),
        JSON.stringify(
          {
            mainProcessId,
            launcherPid: child.pid,
            pages: await Promise.all(
              stillOpen.map(async (page) => ({
                url: page.url(),
                text: await page.locator('body').innerText({ timeout: 3000 }).catch(String),
              })),
            ),
          },
          null,
          2,
        ),
      );
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
    if (closeError) throw closeError;
    // 強制終了は検証プロセスの後始末専用。製品の正常終了に数えない。
    if (forced || (child && child.exitCode !== 0)) {
      throw new Error(`配布EXEが正常終了していません（終了コード: ${String(child?.exitCode)}）`);
    }
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
    const cdp = await browser.newBrowserCDPSession();
    const processes = await cdp.send('SystemInfo.getProcessInfo');
    const main = processes.processInfo.find((process) => process.type === 'browser');
    if (!main || !Number.isSafeInteger(main.id) || main.id <= 0)
      throw new Error('配布EXEのメインプロセスを取得できません');
    mainProcessId = main.id;
    await cdp.detach();
    const context = browser.contexts()[0];
    if (!context) throw new Error('配布EXEの画面がありません');
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    return { page, received, close };
  } catch (error) {
    await close();
    throw error;
  }
}
