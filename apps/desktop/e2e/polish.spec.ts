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
import { closeOverflow, openOverflow, selectView } from './projection.js';

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
    // 商標注記は4メーカー分に増えた（§15 / `ja.ts` の `settings.trademarkNotice`）。
    // 「未確認事項の注記」はキー割当表（`ladder/ShortcutHelp.tsx`）へ移ったのでここには出ない。
    await expect(page.getByTestId('about')).toContainText('三菱電機');
    await expect(page.getByTestId('about')).toContainText('オムロン株式会社');
    await expect(page.getByTestId('about')).toContainText('商標または登録商標');
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

  test('2級課題では回路図ヒントを開閉でき、3級課題では常時出ている（§8.4）', async () => {
    // b-004 は2級課題。開閉でき、初期は閉じている
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-004').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('schematic-hint')).toHaveCount(0);

    // 回路図の開閉はツールバーの「…」の中（UXレビュー #17）。ヒントは拡大ボタン付きの
    // 「印刷した練習シート」（`SchematicView`）として出る。
    await openOverflow(page);
    await page.getByTestId('toggle-schematic').click();
    await closeOverflow(page);
    await expect(page.getByTestId('schematic-hint')).toBeVisible();
    await expect(page.getByTestId('schematic-svg')).toBeVisible();
    await expect(page.getByTestId('schematic-enlarge-button')).toBeVisible();
    await shot(app, '10-schematic-hint');
    await openOverflow(page);
    await page.getByTestId('toggle-schematic').click();
    await closeOverflow(page);
    await expect(page.getByTestId('schematic-hint')).toHaveCount(0);

    // b-001 は3級課題。常時表示で、開閉ボタンそのものが出ない
    await page.getByTestId('session-back').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('schematic-hint')).toBeVisible();
    // 3級は開閉ボタンそのものを出さない（「…」を開いても無い）
    await openOverflow(page);
    await expect(page.getByTestId('toggle-schematic')).toHaveCount(0);
    await closeOverflow(page);
    // 部品パネルより後ろに描く（回路図に押し出されて部品が画面外へ行かない）。1D2-a
    await expect(page.getByTestId('parts-panel')).toBeVisible();
  });

  test('視点プリセットを切り替えても盤が描かれ続け、端子番号が読める（§6.2 / §12.2）', async () => {
    await selectView(page, '俯瞰');
    await page.waitForTimeout(900);
    await shot(app, '11-view-top-birdseye');
    await selectView(page, 'ソケット拡大');
    await page.waitForTimeout(900);
    // ソケット拡大では ①〜⑭ の印字がはっきり読める大きさになる
    await shot(app, '12-view-socket-labels');
    await selectView(page, '正面');
    await page.waitForTimeout(900);
    // 正面でも全端子の番号・役割が見えている。左上のビューキューブも写る（§12.2）
    await shot(app, '13-view-front-labels');
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  });

  /**
   * モードBの表示切替（盤 → 並べて → 回路図）。§11.4 / Plan 5 決定表#1
   * ツールバーのボタン（`assemble-view-*`）と `F2` の巡回が同じものを指していること、
   * 「回路図」では3Dの `Canvas` を捨ててGPUを空けること（§15）を確かめる。
   */
  test('F2 で「盤 → 並べて → 回路図」と表示が巡回する（§11.4）', async () => {
    await expect(page.getByTestId('assemble-view-board')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expect(page.getByTestId('editor-pane')).toHaveCount(0);

    await page.keyboard.press('F2');
    await expect(page.getByTestId('assemble-view-split')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expect(page.getByTestId('editor-pane')).toBeVisible();
    await page.waitForTimeout(600);
    await shot(app, '14-assemble-view-split');

    await page.keyboard.press('F2');
    await expect(page.getByTestId('assemble-view-schematic')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // 回路図だけを見ているあいだは3Dビューポートを外す（§15 / Plan 5 決定表#1）
    await expect(page.getByTestId('viewport')).toHaveCount(0);
    await expect(page.getByTestId('editor-pane')).toBeVisible();
    await shot(app, '15-assemble-view-schematic');

    await page.keyboard.press('F2');
    await expect(page.getByTestId('assemble-view-board')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('viewport')).toBeVisible();
  });
});
