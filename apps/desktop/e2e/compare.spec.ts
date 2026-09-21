import { BUILTIN_PROBLEMS } from '@ojt/content';
import { expect, test } from '@playwright/test';
import { launchApp, shot } from './app.js';

for (const grade of [1, 3] as const) {
  test(`${grade}級の比較は開示範囲を守り、拡大とEscが重なった画面でも動く`, async () => {
    const problem = BUILTIN_PROBLEMS.find((p) => p.grade === grade)!;
    const { app, page } = await launchApp({ contentSize: { width: 1280, height: 800 } });
    try {
      await page.getByTestId('mode-assemble').click();
      if (grade === 1)
        await page
          .getByTestId('grade-filter')
          .getByRole('button', { name: '1級', exact: true })
          .click();
      await page.getByTestId(`open-${problem.id}`).click();
      await page.getByTestId('judge-button').click();
      await page.getByTestId('compare-open').click();
      const dialog = page.getByTestId('compare-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('compare-close')).toBeFocused();
      await expect(page.getByTestId('compare-chart')).toBeVisible();
      await page.getByTestId('compare-differences').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('compare-differences')).toContainText('▲');
      if (grade === 1) await expect(page.getByTestId('compare-reference')).toHaveCount(0);
      else {
        await page.getByTestId('compare-reference').locator('summary').click();
        await expect(page.getByTestId('compare-reference')).toContainText('自分の配線との差');
      }
      await dialog.getByTestId('chart-enlarge-button').click();
      await expect(page.getByTestId('chart-modal')).toBeVisible();
      const close = page.getByTestId('chart-modal').getByRole('button');
      await expect(close).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chart-modal')).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await page.getByTestId('compare-chart').scrollIntoViewIfNeeded();
      await shot(app, `compare-grade-${grade}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('compare-open')).toBeFocused();
    } finally {
      await app.close();
    }
  });
}
