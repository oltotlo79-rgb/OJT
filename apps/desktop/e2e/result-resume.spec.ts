import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { WorkFile } from '../src/shared/ipc.js';
import { launchApp } from './app.js';

for (const [mode, id] of [
  ['assemble', 'b-001'],
  ['inspect-parts', 'c1-001'],
  ['inspect-repair', 'c2-001'],
  ['plc', 'd-001'],
] as const) {
  test(`${mode}: 結果から戻っても保存される作業が変わらず再判定できる`, async () => {
    const { app, page, userDataDir } = await launchApp({
      contentSize: { width: 1280, height: 800 },
    });
    try {
      await page.getByTestId(`mode-${mode}`).click();
      await page.getByTestId(`open-${id}`).click();
      if (mode === 'assemble') {
        await page.getByTestId('socket-list-S1').click();
        await page.getByTestId('mount-relay-my4n').click();
      }
      if (mode === 'inspect-parts') {
        const sheet = page.getByTestId('mark-sheet');
        await sheet.getByRole('radio').first().check();
      }
      if (mode === 'plc') {
        await page.getByTestId('view-ladder').click();
        await page.getByTestId('ladder-editor').press('F5');
        await page.getByTestId('device-text').fill('X0');
        await page.getByTestId('device-commit').click();
        await page.getByTestId('cell-n1:0:15').click();
        await page.getByTestId('ladder-editor').press('F7');
        await page.getByTestId('device-text').fill('Y0');
        await page.getByTestId('device-commit').click();
        await page.getByTestId('ladder-editor').press('F4');
        await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
      }
      const save = async (name: string): Promise<WorkFile> => {
        const path = join(userDataDir, `${name}.ojtw`);
        await app.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
        }, path);
        const overflow = page.getByTestId('toolbar-overflow-toggle');
        if (await overflow.isVisible()) await overflow.click();
        await page.getByRole('button', { name: '作業を保存', exact: true }).click();
        await expect.poll(() => existsSync(path)).toBe(true);
        return JSON.parse(readFileSync(path, 'utf8')) as WorkFile;
      };
      const before = await save('before');
      await page.getByTestId('judge-button').click();
      await page.getByTestId('result-resume').click();
      await expect(page.getByTestId('judge-button')).toBeEnabled();
      const after = await save('after');
      for (const key of [
        'session',
        'answers',
        'reports',
        'tester',
        'ladder',
        'checkPartId',
        'resolvedFaults',
        'faultSeed',
        'hazardCount',
        'replacedPartIds',
      ] as const)
        expect(after[key], key).toEqual(before[key]);
      await page.getByTestId('power-breaker').click();
      await expect(page.getByTestId('power-breaker')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('judge-button').click();
      await expect(page.getByTestId('result-resume')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });
}
