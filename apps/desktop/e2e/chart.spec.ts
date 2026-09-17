import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { boardPoint, SELF_HOLD_WIRES, terminalPoint, type CanvasBox } from './projection.js';

/**
 * タイムチャートの拡大表示（Task CHART-UX）。設計仕様 §7.7 / §8.1 / §8.3。
 * 「課題を開く → 仕様チャートをクリック → 拡大モーダル → Esc で閉じる」を自動操作し、
 * 判定後の結果画面でも同じ拡大表示（期待と実際の積み上げ）が開くことを確かめる。
 *
 * 文言は `src/renderer/i18n/ja.ts` の `JA.session.chart` / `JA.timeChart.openHint` と
 * 同じものをここに書き写している（E2E は成果物を外から触るので `ja.ts` を読み込まない）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

/** 仕様チャート本体（クリックで拡大できる領域）の読み上げ名。 */
const SPEC_CHART = 'タイムチャート（仕様）: クリックまたはEnterで拡大表示';
/** 結果画面の重ね表示の読み上げ名。 */
const OVERLAY_CHART = 'チャート重ね表示（薄色＝模範／濃色＝訓練者）: クリックまたはEnterで拡大表示';

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

async function canvasBox(page: Page): Promise<CanvasBox> {
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/** ソケット S1 の台座の中央（盤ローカル mm）。 */
function socketEdgePoint(): { x: number; y: number; z: number } {
  const socket = JIPM_BOARD.sockets[0];
  if (socket === undefined) throw new Error('ソケットが定義されていません');
  return {
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: 9,
  };
}

async function clickTerminal(page: Page, box: CanvasBox, terminal: string): Promise<void> {
  const point = terminalPoint(toTerminalId(terminal), box);
  await page.mouse.click(point.x, point.y);
}

test.describe('タイムチャートの拡大表示', () => {
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
      window.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1500);
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('仕様チャートをクリックで拡大し、Esc で閉じる（§7.7 / §8.1）', async () => {
    // ① 課題 b-001 を開く
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);

    // ② 小さいチャートに縦の補助線（目盛線・操作の破線）が立っている（§7.7）
    const spec = page.getByTestId('chart-spec');
    await expect(spec).toBeVisible();
    expect(await spec.locator('[data-guide="tick"]').count()).toBeGreaterThanOrEqual(5);
    expect(await spec.locator('[data-guide="edge"]').count()).toBeGreaterThan(0);
    await shot(app, 'after-01-session-chart');

    // ③ チャートをクリックすると拡大モーダルが開く（§8.1）
    await page.getByRole('button', { name: SPEC_CHART }).click();
    const modal = page.getByTestId('chart-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('chart-spec-large')).toBeVisible();
    await page.waitForTimeout(300);
    await shot(app, 'after-02-session-enlarged');

    // ④ Esc で閉じる（後ろの盤は動かない）
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('viewport')).toBeVisible();

    // ⑤ 配線 → 通電 → 判定 → 結果画面の重ね表示も同じように拡大できる（§8.3）
    const box = await canvasBox(page);
    const edge = boardPoint(socketEdgePoint(), box);
    await page.mouse.click(edge.x, edge.y);
    await page.getByRole('button', { name: '装着' }).first().click();
    for (const [from, to] of SELF_HOLD_WIRES) {
      await clickTerminal(page, box, from);
      await clickTerminal(page, box, to);
    }
    await page.getByRole('button', { name: 'ブレーカ' }).click();
    await page.getByRole('button', { name: '電源スイッチ' }).click();
    await page.getByRole('button', { name: '判定' }).click();
    await expect(page.getByTestId('chart-overlay')).toBeVisible();
    await shot(app, 'after-03-result-overlay');

    await page.getByRole('button', { name: OVERLAY_CHART }).click();
    await expect(page.getByTestId('chart-modal')).toBeVisible();
    await expect(page.getByTestId('chart-overlay-large')).toBeVisible();
    await page.waitForTimeout(300);
    await shot(app, 'after-04-result-enlarged');

    // 閉じるボタンでも閉じる
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByTestId('chart-modal')).toHaveCount(0);
  });
});
