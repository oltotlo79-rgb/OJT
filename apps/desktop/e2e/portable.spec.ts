import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { SHOT_DIR } from './app.js';
import { launchPortable } from './packaged-app.js';

/** distの後に e2e:packaged で実行。ユーザーの設定やインストール先を使わない。 */
test('EXE1個から72課題・3D判定・ヘルプ・PLCを開き、終了時に展開物を片付ける', async () => {
  const app = await launchPortable();
  let extracted: string | undefined;
  try {
    const page = app.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await expect(page.getByTestId('mode-assemble')).toBeVisible({ timeout: 30_000 });
    expect(readdirSync(app.received)).toHaveLength(1);
    expect(readdirSync(app.received)[0]).toMatch(/-Portable\.exe$/);
    const url = fileURLToPath(page.url());
    expect(url).toMatch(/app\.asar/);
    const resources = url.split(/app\.asar[/\\]/)[0];
    if (!resources) throw new Error('同梱ファイルの場所を取得できません');
    extracted = dirname(resources.replace(/[/\\]$/, ''));
    expect(readFileSync(join(resources, 'manual.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    const counts = await page.evaluate(async () => {
      if (!window.ojt) throw new Error('配布版のpreloadが読み込まれていません');
      const payload = await window.ojt.listProblems();
      return payload.problems.reduce<Record<string, number>>((out, p) => {
        out[p.mode] = (out[p.mode] ?? 0) + 1;
        return out;
      }, {});
    });
    expect(counts).toEqual({ assemble: 20, 'inspect-parts': 12, 'inspect-repair': 20, plc: 20 });
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('power-breaker').click();
    await page.getByTestId('power-switch').click();
    await expect(page.getByTestId('status-overlay')).toContainText('通電中');
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '課題一覧へ', exact: true }).click();
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await page.getByTestId('mode-plc').click();
    await page.getByTestId('open-d-001').click();
    await expect(page.getByTestId('plc-session')).toBeVisible();
    await page.getByTestId('view-ladder').click();
    await expect(page.getByTestId('ladder-workspace')).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, 'portable-plc.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
  if (!extracted) throw new Error('展開先の検査が完了していません');
  await expect.poll(() => existsSync(extracted), { timeout: 10_000 }).toBe(false);
});
