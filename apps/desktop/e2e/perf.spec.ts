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
import { selectView } from './projection.js';

/**
 * 性能とオフライン（§16 Phase 5 受入基準③の通信部分・④）。§15 / Plan 5 決定表#16・#17。
 *
 * E2E は `--use-gl=swiftshader` で動く（CI・リモートデスクトップにGPUが無い。`smoke.spec.ts`
 * の注記）ので、**GPUに依らない予算だけ**を自動で縛る。60fps そのものは実機（内蔵GPU・FHD）で
 * `OJT_PERF_TARGET=1` を立てて同じ E2E を走らせ、リリース手順チェックリストに記録する。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');
const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
const WINDOW = { width: 1440, height: 900 } as const;

/** 性能の予算（§15 / Plan 5 決定表#17）。GPU に依らない値だけを自動で縛る。 */
const TRIANGLE_BUDGET = 200_000;
const DRAW_CALL_BUDGET = 120;
/** 実機確認のときだけ 60fps を要求する（`OJT_PERF_TARGET=1`）。 */
const FPS_TARGET = 60;

let app: ElectronApplication;
let page: Page;

async function readPerf(target: Page): Promise<Record<string, number> & { total: number }> {
  const node = target.getByTestId('perf-readout');
  // `PerfProbe` は**描いたフレーム**のときだけ書くので、1枚目が焼き上がるまで待つ
  await expect(node).not.toBeEmpty({ timeout: 30_000 });
  const text = await node.textContent();
  const total = await node.getAttribute('data-total-frames');
  if (text === null || text.length === 0) throw new Error('perf-readout が空です');
  return { ...(JSON.parse(text) as Record<string, number>), total: Number(total ?? '0') };
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    window.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
    window.show();
    window.focus();
  }, WINDOW);
  await page.waitForTimeout(1500);
  const restore = page.getByTestId('restore-prompt');
  if ((await restore.count()) > 0) {
    await page.getByRole('button', { name: '復元しない' }).click();
  }
  await expect(page.getByTestId('mode-assemble')).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app.close();
});

test.describe('性能（§16 Phase 5 受入基準④）', () => {
  test('三角形数とドローコールが予算に収まる', async () => {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    // 視点プリセットは「…」の中（UXレビュー #17。`projection.ts` の `selectView()`）
    await selectView(page, '俯瞰');
    await page.waitForTimeout(1500);
    const perf = await readPerf(page);
    expect(perf['triangles']).toBeLessThanOrEqual(TRIANGLE_BUDGET);
    expect(perf['calls']).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    mkdirSync(SHOT_DIR, { recursive: true });
    writeFileSync(join(SHOT_DIR, 'perf-report.json'), JSON.stringify(perf, null, 2), 'utf8');
  });

  test('無操作では1枚も描かない（frameloop="demand" の監査）', async () => {
    await page.mouse.move(4, 4);
    await page.waitForTimeout(1500);
    const before = (await readPerf(page)).total;
    await page.waitForTimeout(3000);
    const after = (await readPerf(page)).total;
    // 慣性の減衰が残ることがあるので 1 枚だけ許す
    expect(after - before).toBeLessThanOrEqual(1);
  });

  test('実機では60fpsを保つ（OJT_PERF_TARGET=1 のときだけ）', async () => {
    test.skip(process.env['OJT_PERF_TARGET'] !== '1', '内蔵GPU実機でのみ確認する（決定表#17）');
    for (const view of ['正面', '俯瞰', 'ソケット拡大']) {
      await selectView(page, view);
      await page.waitForTimeout(1200);
      expect((await readPerf(page))['fps']).toBeGreaterThanOrEqual(FPS_TARGET);
    }
  });

  test('外部へ1件も通信しない（§15 のオフライン）', async () => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/u.test(request.url())) requests.push(request.url());
    });
    /*
     * ここで「検算」は押さない（B7）。この spec は課題を開いたばかりで下書きが空なので、
     * 「検算」ボタンは `disabled`（指摘が残っている）である。Playwright の `click()` は
     * 要素が操作可能になるまで待つので、押そうとすると時間切れで落ちるだけで、
     * しかも**通信の件数を数えるのに検算は1件も寄与しない**（検算は Worker の中で完結する）。
     * 画面を一通り動かして、その間に外向きの要求が1件も出ないことだけを見る。
     */
    await page.getByTestId('assemble-view-schematic').click();
    await expect(page.getByTestId('schematic-editor')).toBeVisible();
    await page.getByTestId('assemble-view-split').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.getByTestId('assemble-view-board').click();
    await page.waitForTimeout(3000);
    await page.getByTestId('session-back').click();
    expect(requests).toEqual([]);
  });
});
