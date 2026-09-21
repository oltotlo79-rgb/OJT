import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { expect, test, type Page } from '@playwright/test';
import { SHOT_DIR } from './app.js';
import { launchPortable, type PackagedApp } from './packaged-app.js';
import {
  boardPoint,
  SELF_HOLD_WIRES,
  selectView,
  terminalPoint,
  wireCountText,
} from './projection.js';

function resourcesDirectory(page: Page): string {
  const url = fileURLToPath(page.url());
  expect(url).toMatch(/app\.asar/);
  const resources = url.split(/app\.asar[/\\]/)[0];
  if (!resources) throw new Error('同梱ファイルの場所を取得できません');
  return resources.replace(/[/\\]$/, '');
}

/** distの後に e2e:packaged で実行。ユーザーの設定やインストール先を使わない。 */
test('EXE1個から初回ガイド・72課題・回路の合格・ヘルプ・PLCと終了時の後始末を確認する', async () => {
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
    const resources = resourcesDirectory(page);
    extracted = dirname(resources);
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
    await expect(page.getByTestId('tour-guide')).toHaveAttribute('data-step', 'rotate');
    await page.getByTestId('tour-later').click();
    await selectView(page, '正面');
    const box = await page.locator('[data-testid="viewport"] canvas').boundingBox();
    if (!box) throw new Error('配布版の3D表示の位置を取得できません');
    const socket = JIPM_BOARD.sockets[0]!;
    const center = boardPoint(
      {
        x: socket.origin.x + socket.bodyMm.width / 2,
        y: socket.origin.y + socket.bodyMm.length / 2,
        z: 9,
      },
      box,
    );
    await page.mouse.click(center.x, center.y);
    await expect(page.getByText('S1（CR1）を選択中')).toBeVisible();
    await page.getByRole('button', { name: '装着', exact: true }).first().click();
    await expect(page.getByTestId('operation-log')).toContainText('S1 に リレー MY4N を装着');
    // ストアへ模範解を注入せず、実際の端子クリックだけで回路を完成させる。
    for (const pair of SELF_HOLD_WIRES) {
      for (const terminal of pair) {
        const point = terminalPoint(toTerminalId(terminal), box);
        await page.mouse.click(point.x, point.y);
      }
    }
    await expect(page.getByTestId('status-overlay')).toContainText(wireCountText(12, 3));
    await page.getByTestId('power-breaker').click();
    await page.getByTestId('power-switch').click();
    await expect(page.getByTestId('status-overlay')).toContainText('通電中');
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('no-mismatch')).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, 'portable-result-pass.png') });
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
  await expect
    .poll(() => existsSync(extracted), {
      timeout: 10_000,
      message: `終了後に一時展開先が残っています: ${extracted}`,
    })
    .toBe(false);
});

test('同じEXEの展開先は起動ごとに変わり、片方を閉じても他方の課題を壊さない', async () => {
  const first = await launchPortable();
  let second: PackagedApp | undefined;
  let third: PackagedApp | undefined;
  let secondDir: string | undefined;
  let thirdDir: string | undefined;
  try {
    await expect(first.page.getByTestId('mode-assemble')).toBeVisible();
    const firstDir = dirname(resourcesDirectory(first.page));
    await first.close();
    await expect.poll(() => existsSync(firstDir)).toBe(false);
    second = await launchPortable();
    await expect(second.page.getByTestId('mode-assemble')).toBeVisible();
    secondDir = dirname(resourcesDirectory(second.page));
    // まず順に起動して検査する。固定名へ戻る回帰でも上書きのダイアログを出さずに拒否する。
    expect(secondDir).not.toBe(firstDir);
    third = await launchPortable();
    await expect(third.page.getByTestId('mode-assemble')).toBeVisible();
    thirdDir = dirname(resourcesDirectory(third.page));
    expect(thirdDir).not.toBe(secondDir);
    await second.close();
    await expect.poll(() => existsSync(secondDir!)).toBe(false);
    expect(existsSync(thirdDir)).toBe(true);
    await third.page.getByTestId('mode-assemble').click();
    await third.page.getByTestId('open-b-001').click();
    await expect(third.page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  } finally {
    await third?.close();
    await second?.close();
    await first.close();
  }
  if (!thirdDir) throw new Error('同時起動の検査が完了していません');
  await expect.poll(() => existsSync(thirdDir)).toBe(false);
});
