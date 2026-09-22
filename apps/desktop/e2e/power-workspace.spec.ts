import { expect, test } from '@playwright/test';
import { launchApp, settledShot } from './app.js';
import { terminalPoint, boardPoint } from './projection.js';

test('組立は配線ゼロから開始し、P端子から配線・測定・作業の切替ができる', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1280, height: 800 } });
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('status-overlay')).toContainText('固定 0 本');
    const canvas = page.locator('[data-testid="viewport"] canvas');
    await page.keyboard.press('1');
    await page.waitForTimeout(400);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('盤面が表示されていません');
    await settledShot(app, page, 'v1.4.1-power-blank');
    const supply = terminalPoint('P.1' as Parameters<typeof terminalPoint>[0], box);
    await page.mouse.click(supply.x, supply.y);
    await expect(page.getByTestId('wire-cancel-inline')).toBeVisible();
    await expect.poll(async () => (await canvas.boundingBox())?.height).toBe(box.height);
    await page.getByTestId('wire-cancel-inline').click();
    await expect(page.getByTestId('wire-cancel-inline')).toHaveCount(0);
    await page.mouse.click(supply.x, supply.y);
    const target = terminalPoint('TB_PB.1c' as Parameters<typeof terminalPoint>[0], box);
    await page.mouse.click(target.x, target.y);
    await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 1 本');
    await settledShot(app, page, 'v1.4.1-power-wired');
    // 端子からの出線を実描画で確認できる拡大図。
    await page.mouse.move(supply.x, supply.y);
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(350);
    await settledShot(app, page, 'v1.4.1-supply-detail');
    await page.keyboard.press('Home');
    await page.getByTestId('assemble-tester').click();
    await expect.poll(async () => (await canvas.boundingBox())?.height).toBe(box.height);
    await page.getByRole('button', { name: 'DCV', exact: true }).click();
    await page.getByTestId('power-breaker').click();
    await page.getByTestId('power-switch').click();
    // 正面へ戻して、実際のネジを2か所クリックする。
    await page.keyboard.press('1');
    await page.waitForTimeout(350);
    const n = terminalPoint('N.1' as Parameters<typeof terminalPoint>[0], box);
    await page.mouse.click(n.x, n.y);
    await page.mouse.click(supply.x, supply.y);
    await expect(page.getByTestId('tester-readout')).toContainText('24');
    await page.mouse.click(box.x + box.width - 30, box.y + box.height / 2);
    await expect(page.getByTestId('tester-readout')).toContainText('24');
    await settledShot(app, page, 'v1.4.1-direct-measurement');
    await page.getByTestId('step-wire').getByRole('button').click();
    await expect(page.getByTestId('assemble-tester')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('step-parts').getByRole('button').click();
    await expect(page.getByTestId('socket-list')).toBeVisible();
    const ac = boardPoint({ x: 296, y: 21, z: 22 }, box);
    await page.mouse.move(ac.x, ac.y);
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(350);
    await settledShot(app, page, 'v1.4.1-switch-detail-on');
    await page.getByTestId('power-switch').click();
    await page.getByTestId('power-breaker').click();
    await settledShot(app, page, 'v1.4.1-switch-detail-off');
    await page.keyboard.press('2');
    await page.waitForTimeout(400);
    await settledShot(app, page, 'v1.4.1-power-perspective');
  } finally {
    await app.close();
  }
});
