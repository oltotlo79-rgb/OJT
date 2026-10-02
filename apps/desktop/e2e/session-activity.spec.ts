import { expect, test } from '@playwright/test';
import { launchApp, shot } from './app.js';

test('全モードのログは初期に閉じ、時間を表示し、開閉しても内容を保持する', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1600, height: 900 } });
  try {
    for (const [mode, id] of [
      ['assemble', 'b-001'],
      ['inspect-parts', 'c1-001'],
      ['inspect-repair', 'c2-001'],
      ['plc', 'd-001'],
    ]) {
      await page.getByTestId(`mode-${mode}`).click();
      await page
        .getByTestId('grade-filter')
        .getByRole('button', { name: 'すべて', exact: true })
        .click();
      await page.getByTestId(`open-${id}`).click();
      const activity = page.getByTestId('session-activity');
      await expect(activity).not.toHaveAttribute('open');
      await expect(page.getByTestId('elapsed')).toBeVisible();
      await expect(page.getByTestId('operation-log')).not.toBeVisible();
      const viewport = page.getByTestId('viewport');
      const closed = await viewport.boundingBox();
      const elapsed = await page.getByTestId('elapsed').textContent();
      await expect.poll(() => page.getByTestId('elapsed').textContent()).not.toBe(elapsed);
      await page.getByTestId('activity-toggle').click();
      await expect(activity).toHaveAttribute('open');
      await expect(page.getByTestId('operation-log')).toBeVisible();
      const expanded = await viewport.boundingBox();
      if (mode !== 'plc') {
        expect(closed!.height - expanded!.height).toBeGreaterThanOrEqual(115);
        expect((await activity.boundingBox())!.height).toBeLessThanOrEqual(165);
      }
      await page.getByTestId('power-breaker').click();
      await expect(page.getByTestId('operation-log')).not.toBeEmpty();
      // 動作中の遅延通知は追記・集約更新される。保持を確認するのは操作履歴の各行。
      // 警告を止めたり、再試行で隠したりせず、閉じている間の新しい操作も確認する。
      const readOperations = async (): Promise<string[]> =>
        (await page.getByTestId('operation-log').locator('li').allTextContents()).filter(
          (text) => !text.startsWith('処理の遅れにより '),
        );
      await expect.poll(readOperations).toContain('ブレーカ ON');
      const log = await readOperations();
      await page.getByTestId('activity-toggle').click();
      await expect(activity).not.toHaveAttribute('open');
      await expect(page.getByTestId('elapsed')).toBeVisible();
      await page.getByTestId('power-breaker').click();
      await shot(app, `activity-collapsed-${mode}`);
      await page.getByTestId('activity-toggle').click();
      await expect.poll(async () => (await readOperations()).slice(0, log.length)).toEqual(log);
      await expect.poll(async () => (await readOperations())[log.length]).toBe('ブレーカ OFF');
      await page.getByTestId('session-back').click();
      await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    }
  } finally {
    await app.close();
  }
});
