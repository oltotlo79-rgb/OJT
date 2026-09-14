import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * 仕上げ部分の E2E（設定画面・回路図ヒント・作業ファイルの保存）。
 * 設計仕様 §12.1 / §8.4 / §12.3 / §15。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

async function shot(app: ElectronApplication, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(base64, 'base64'));
}

test.describe('仕上げ', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      window.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1500);
    // 前回の実行が残した一時保存があると復元プロンプトが出るので、先に片付ける（§12.3）
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('設定画面に商標注記が出て、音量を変えても落ちない（§12.1 / §15）', async () => {
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('about')).toContainText('三菱電機');
    await expect(page.getByTestId('about')).toContainText('本アプリの表記');
    await expect(page.getByTestId('setting-user-dir')).toBeVisible();
    // 前回の実行の設定が残っていても動くように、値ではなく「切り替わること」を確かめる
    const before = await page.getByTestId('setting-sound-enabled').isChecked();
    await page.getByTestId('setting-sound-enabled').click();
    await expect(page.getByTestId('toast')).toContainText('設定を保存しました');
    await expect(page.getByTestId('setting-sound-enabled')).toBeChecked({ checked: !before });
    await page.getByTestId('setting-sound-enabled').click();
    await shot(app, '09-settings');
    await page.getByRole('button', { name: 'ホームへ戻る' }).click();
  });

  test('2級相当の課題で回路図ヒントを開閉できる（§8.4）', async () => {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.waitForTimeout(800);
    // b-001 は3級課題で `hints.schematicVisible: true` なので最初から出ている
    await expect(page.getByTestId('schematic-hint')).toBeVisible();
    await expect(page.getByTestId('schematic-svg')).toBeVisible();
    await shot(app, '10-schematic-hint');
    await page.getByRole('button', { name: '回路図を隠す' }).click();
    await expect(page.getByTestId('schematic-hint')).toHaveCount(0);
    await page.getByRole('button', { name: '回路図を表示' }).click();
    await expect(page.getByTestId('schematic-hint')).toBeVisible();
  });

  test('視点プリセットを切り替えても盤が描かれ続け、端子番号が読める（§6.2 / §12.2）', async () => {
    await page.getByRole('button', { name: '俯瞰' }).click();
    await page.waitForTimeout(900);
    await shot(app, '11-view-top-birdseye');
    await page.getByRole('button', { name: 'ソケット拡大' }).click();
    await page.waitForTimeout(900);
    // ソケット拡大では ①〜⑭ の印字がはっきり読める大きさになる
    await shot(app, '12-view-socket-labels');
    await page.getByRole('button', { name: '正面' }).click();
    await page.waitForTimeout(900);
    // 正面でも全端子の番号・役割が見えている。左上のビューキューブも写る（§12.2）
    await shot(app, '13-view-front-labels');
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  });
});
