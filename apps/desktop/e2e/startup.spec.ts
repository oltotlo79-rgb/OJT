import { expect, test, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchApp, SHOT_DIR } from './app.js';

async function interceptApp(app: ElectronApplication, cancel: boolean): Promise<void> {
  await app.evaluate(({ session }, abort) => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (/\/assets\/main-[^/]+\.js$/u.test(details.url)) {
        if (abort) callback({ cancel: true });
        // ローディング中の操作を確認する間だけ応答を保留する。
      } else callback({});
    });
  }, cancel);
}

test('起動表示が先に出て、読込失敗から再読み込みでホームへ戻れる', async () => {
  const { app, page } = await launchApp();
  try {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await interceptApp(app, false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#startup-status')).toHaveText('起動しています…');
    await expect(page.getByTestId('mode-assemble')).toHaveCount(0);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
    ).toBe(true);
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(SHOT_DIR, 'startup-loading.png') });
    await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toBeVisible({
      timeout: 18_000,
    });
    await expect(page.locator('#startup-detail')).toContainText('準備に時間がかかっています');
    await interceptApp(app, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#startup-status')).toHaveText('画面を読み込めませんでした');
    await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, 'startup-error.png') });
    await app.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest(null));
    await page.getByRole('button', { name: '再読み込み', exact: true }).click();
    await expect(page.getByTestId('mode-assemble')).toBeVisible();
    await expect(page.locator('#startup')).toHaveCount(0);
    expect(errors).toEqual([]);
    // 遅延読込後も課題一覧から3D画面へ実際に進める。
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('本体の画面が読込中でも通常の終了要求で閉じられる', async () => {
  const { app, page } = await launchApp();
  let closed = false;
  try {
    await interceptApp(app, false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#startup-status')).toHaveText('起動しています…');
    const closing = app.waitForEvent('close', { timeout: 10_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await closing;
    closed = true;
  } finally {
    if (!closed) await app.close();
  }
});
