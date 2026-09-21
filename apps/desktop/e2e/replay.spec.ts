import { expect, test } from '@playwright/test';
import { launchApp, shot } from './app.js';

test('結果から全区間を見直し、差分と編集禁止を確かめて結果へ戻る', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1280, height: 800 } });
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    const verdict = await page.getByTestId('verdict').textContent();
    const elapsed = await page.getByTestId('result-elapsed').textContent();
    await page.getByTestId('replay-open').click();
    const bar = page.getByTestId('replay-bar');
    await expect(bar).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('replay-viewport')).toBeVisible();
    await expect(page.getByTestId('judge-button')).toHaveCount(0);
    await expect(page.getByTestId('power-switch')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Delete');
    let differences = 0;
    for (let index = 0; index < 100; index += 1) {
      if (await page.getByTestId('replay-mismatch').count()) {
        differences += 1;
        if (differences === 1) await shot(app, 'replay-difference');
      }
      if ((await page.getByTestId('replay-next').getAttribute('aria-disabled')) === 'true') break;
      await page.getByTestId('replay-next').click();
      await expect(bar).toHaveAttribute('aria-busy', 'false');
    }
    expect(differences).toBeGreaterThan(0);
    await expect(page.getByTestId('replay-next')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('replay-restart').click();
    await expect(bar).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('replay-prev')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('replay-stop').click();
    await expect(page.getByTestId('verdict')).toHaveText(verdict ?? '');
    await expect(page.getByTestId('result-elapsed')).toHaveText(elapsed ?? '');
  } finally {
    await app.close();
  }
});

test('点検修復も提出した故障状態のまま見直せる', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByTestId('mode-inspect-repair').click();
    await page.getByTestId('open-c2-001').click();
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    await page.getByTestId('replay-open').click();
    await expect(page.getByTestId('replay-bar')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('replay-viewport')).toBeVisible();
    await page.getByTestId('replay-stop').click();
    await expect(page.getByTestId('verdict')).toBeVisible();
  } finally {
    await app.close();
  }
});
