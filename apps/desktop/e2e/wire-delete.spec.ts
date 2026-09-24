import { addWire, createSession, JIPM_BOARD, routeSession } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './app.js';
import { boardPoint, terminalPoint, wireCountText, type CanvasBox } from './projection.js';

/**
 * 電線を選んで `Delete` で外す（2026-09-24 利用者報告「配線を選択してDeleteを押しても
 * 配線が外れない」）。取扱説明書「電線をつなぐ・外す」の手順どおり、削除モードに切り替えずに
 * 3Dの電線を押して選び、`Delete` で外せること。電線一覧で選んだ場合も同じく外れること。
 */

const FROM = toTerminalId('P.1');
const TO = toTerminalId('TB_PB.2c');

async function canvasBox(page: Page): Promise<CanvasBox> {
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/** P.1 → TB_PB.2c の電線が通る点（区間の途中）をページ座標で並べる。 */
function wireCandidates(box: CanvasBox): Array<{ x: number; y: number }> {
  const session = createSession(JIPM_BOARD, { includeCheckWires: false });
  const added = addWire(session, JIPM_BOARD, FROM, TO, '青');
  if (!added.ok) throw new Error(added.message);
  const route = routeSession(JIPM_BOARD, session).find((r) => r.wireId === added.value.id);
  if (route === undefined) throw new Error('電線の経路を計算できませんでした');
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < route.corners.length; index += 1) {
    const a = route.corners[index];
    const b = route.corners[index + 1];
    if (a === undefined || b === undefined) continue;
    for (const t of [0.5, 0.35, 0.65]) {
      points.push(
        boardPoint(
          { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
          box,
        ),
      );
    }
  }
  return points;
}

async function wireOnce(page: Page, box: CanvasBox): Promise<void> {
  const from = terminalPoint(FROM, box);
  const to = terminalPoint(TO, box);
  await page.mouse.click(from.x, from.y);
  await page.mouse.click(to.x, to.y);
  await expect(page.getByTestId('status-overlay')).toContainText(wireCountText(1, 0));
}

test.describe.serial('電線を選んで Delete で外す（2026-09-24 利用者報告）', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('配線モードのまま3Dの電線を押して選び、Delete で外せる', async () => {
    const box = await canvasBox(page);
    await wireOnce(page, box);
    const overlay = page.getByTestId('status-overlay');
    let selected = false;
    for (const point of wireCandidates(box)) {
      if (point.x < box.x || point.x > box.x + box.width) continue;
      if (point.y < box.y || point.y > box.y + box.height) continue;
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(150);
      const text = (await overlay.textContent()) ?? '';
      // 端子の近くを押して配線の始点になったら取り消して次の点へ
      if (text.includes('始点:')) {
        await page.keyboard.press('Escape');
        continue;
      }
      if (text.includes('選択:')) {
        selected = true;
        break;
      }
    }
    expect(selected, '3Dで電線を選べませんでした').toBe(true);
    // 端子を押しても配線が始まる（電線の当たり判定が端子を横取りしない）
    await expect(overlay).toContainText('端子未選択');
    await page.keyboard.press('Delete');
    await expect(overlay).toContainText(wireCountText(0, 0));
    await expect(overlay).not.toContainText('選択:');
  });

  test('電線が付いた端子を押すと、電線ではなく端子が選ばれる', async () => {
    const box = await canvasBox(page);
    await wireOnce(page, box);
    const from = terminalPoint(FROM, box);
    await page.mouse.click(from.x, from.y);
    await expect(page.getByTestId('status-overlay')).toContainText('始点: P.1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status-overlay')).toContainText('端子未選択');
  });

  test('電線一覧で選んでも Delete で外せる', async () => {
    const overlay = page.getByTestId('status-overlay');
    const row = page.locator('[data-testid^="wire-row-"]').first();
    // 3Dで電線を選ぶと一覧は自動で開くので、閉じているときだけ開く
    if (!(await row.isVisible())) await page.getByText('電線一覧・接続先の変更').click();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await expect(overlay).toContainText('選択:');
    await page.keyboard.press('Delete');
    await expect(overlay).toContainText(wireCountText(0, 0));
  });
});
