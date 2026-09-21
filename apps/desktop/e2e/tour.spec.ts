import { expect, test } from '@playwright/test';
import { launchApp, shot } from './app.js';

test('初回の5手順を実操作で進み、完了を再起動後も保持する', async () => {
  const { app, page, userDataDir } = await launchApp({
    firstRunGuide: true,
    contentSize: { width: 1280, height: 800 },
  });
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    const guide = page.getByTestId('tour-guide');
    await expect(guide).toHaveAttribute('data-step', 'rotate');
    await shot(app, 'tour-01-rotate');
    const box = await page.locator('[data-testid=viewport] canvas').boundingBox();
    if (box === null) throw new Error('3D表示がありません');
    await page.mouse.move(box.x + box.width * 0.8, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8 + 60, box.y + 50, { steps: 12 });
    await page.mouse.up();
    await expect(guide).toHaveAttribute('data-step', 'mount');
    await page.getByTestId('socket-list-S1').click();
    await page.getByTestId('mount-relay-my4n').click();
    await expect(guide).toHaveAttribute('data-step', 'wire');
    await page.getByTestId('terminal-list-summary').click();
    await page.getByTestId('terminal-search').fill('P.1');
    await page.getByTestId('terminal-row-P.1').click();
    await page.getByTestId('terminal-search').fill('TB_PB.2c');
    await page.getByTestId('terminal-row-TB_PB.2c').click();
    await expect(guide).toHaveAttribute('data-step', 'power');
    await page.getByTestId('power-breaker').click();
    await expect(guide).toHaveAttribute('data-step', 'power');
    await page.getByTestId('power-switch').click();
    await expect(guide).toHaveAttribute('data-step', 'judge');
    await shot(app, 'tour-05-judge');
    await page.getByTestId('judge-button').click();
    await expect(guide).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(async () => (await window.ojt?.getSettings())?.tourDone))
      .toBe(true);
  } finally {
    await app.close();
  }
  const reopened = await launchApp({ firstRunGuide: true, userDataDir });
  try {
    await reopened.page.getByTestId('mode-assemble').click();
    await reopened.page.getByTestId('open-b-001').click();
    await expect(reopened.page.getByTestId('viewport')).toBeVisible();
    await expect(reopened.page.getByTestId('tour-guide')).toHaveCount(0);
    await reopened.page.keyboard.press('F1');
    await reopened.page.getByTestId('help-restart-tour').click();
    await expect(reopened.page.getByTestId('tour-guide')).toHaveAttribute('data-step', 'rotate');
    await reopened.page.keyboard.press('Escape');
    await expect(reopened.page.getByTestId('tour-guide')).toHaveCount(0);
  } finally {
    await reopened.app.close();
  }
});

test('130%表示でもガイドの操作ボタンが折り返さず、設定から再開できる', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1280, height: 800 } });
  try {
    await page.getByTestId('open-settings').click();
    await page.getByTestId('setting-ui-scale').selectOption('1.3');
    await page.getByTestId('setting-restart-tour').click();
    await page.getByTestId('open-b-001').click();
    const guide = page.getByTestId('tour-guide');
    await expect(guide).toBeVisible();
    const clipped = await guide
      .locator('button,h2,p')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => node.scrollWidth > node.clientWidth + 1)
          .map((node) => node.textContent),
      );
    expect(clipped).toEqual([]);
    await shot(app, 'tour-130-percent');
    await page.getByTestId('tour-later').click();
    await expect(guide).toHaveCount(0);
  } finally {
    await app.close();
  }
});
