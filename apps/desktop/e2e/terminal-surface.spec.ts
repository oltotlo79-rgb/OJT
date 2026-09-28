import { toTerminalId } from '@ojt/circuit-sim';
import { expect, test } from '@playwright/test';
import { launchApp, shot } from './app.js';
import { terminalPoint, wireCountText } from './projection.js';

test('端子台とソケットの各段へ3Dで接続し、正面・斜めから接続部を確認できる', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    const canvas = page.locator('[data-testid="viewport"] canvas');
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(1500);
    const box = await canvas.boundingBox();
    if (box === null) throw new Error('3D表示の寸法を取得できません');
    const pairs = [
      ['P.1', 'TB_PL.1+'],
      ['N.1', 'TB_PL.4-'],
      ['S3.14', 'TB_PB.1c'],
      ['S3.9', 'TB_PB.4b'],
      ['S1.1', 'S2.3'],
      ['S1.5', 'S2.7'],
      ['S1.9', 'S2.10'],
      ['S1.14', 'S2.13'],
    ] as const;
    for (const [index, [from, to]] of pairs.entries()) {
      for (const terminal of [from, to]) {
        const point = terminalPoint(toTerminalId(terminal), box);
        await page.mouse.click(point.x, point.y);
      }
      await expect(page.getByTestId('status-overlay')).toContainText(wireCountText(index + 1, 0));
    }
    await page.mouse.move(0, 0);
    await shot(app, 'terminal-surface-front');
    await page.keyboard.press('2');
    await page.waitForTimeout(700);
    await shot(app, 'terminal-surface-oblique');
    await page.keyboard.press('3');
    await page.waitForTimeout(700);
    await shot(app, 'terminal-surface-close');
  } finally {
    await app.close();
  }
});
