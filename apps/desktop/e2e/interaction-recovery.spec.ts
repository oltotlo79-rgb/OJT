import { expect, test } from '@playwright/test';
import { toTerminalId } from '@ojt/circuit-sim';
import { launchApp, settledShot } from './app.js';
import { selectView, terminalPoint } from './projection.js';
interface Readout {
  tx: number;
  ty: number;
  tz: number;
  az: number;
  polar: number;
}

test('ヒントは途中でも閉じられ、開き直しても段数が増えず画面内に収まる', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1280, height: 800 } });
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    const toggle = page.getByTestId('hint-button');
    const panel = page.getByTestId('hint-panel');
    await toggle.click();
    await expect(panel).toContainText('1 / 3');
    await page.getByTestId('hint-close').click();
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await expect(panel).toContainText('1 / 3');
    await page.getByTestId('hint-next').click();
    await expect(panel).toContainText('2 / 3');
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
    await settledShot(app, page, 'interaction-hint-open');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(panel).toContainText('2 / 3');
    const canvas = await page.locator('[data-testid=viewport] canvas').boundingBox();
    if (!canvas) throw new Error('3D盤がありません');
    await page.mouse.click(canvas.x + 12, canvas.y + canvas.height - 12);
    await expect(panel).toBeHidden();
    await toggle.click();
    await toggle.click();
    await expect(panel).toBeHidden();
  } finally {
    await app.close();
  }
});

test('PLCの手順から配線とラダーへ切り替え、編集内容を保持する', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1280, height: 800 } });
  try {
    await page.getByTestId('mode-plc').click();
    await page.getByTestId('open-d-001').click();
    const ladder = page.getByTestId('ladder-grid');
    await expect(ladder).toBeVisible();
    await page.getByTestId('cell-n1:0:0').click();
    await page.getByTestId('ladder-editor').press('F5');
    await page.getByTestId('device-text').fill('X0');
    await page.getByTestId('device-commit').click();
    await expect(ladder).toContainText('X0');
    const before = await ladder.textContent();
    await page.getByTestId('plc-step-wire').getByRole('button').click();
    await expect(page.locator('[data-testid=viewport] canvas')).toBeVisible();
    await expect(ladder).toBeHidden();
    await settledShot(app, page, 'interaction-plc-wiring');
    await page.getByTestId('plc-step-ladder').getByRole('button').click();
    await expect(ladder).toBeVisible();
    await expect(ladder).toHaveText(before!);
  } finally {
    await app.close();
  }
});

test('端子上の通常ドラッグは配線を変更せず平行移動し、装着部品の立体形状を確認できる', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1440, height: 900 } });
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    for (const [socket, kind] of [
      ['S1', 'relay-my4n'],
      ['S5', 'timer-h3y4'],
    ] as const) {
      await page.getByTestId(`socket-list-${socket}`).click();
      await page.getByTestId(`mount-${kind}`).click();
      await page.getByTestId('socket-list-back').click();
    }
    const canvas = page.locator('[data-testid=viewport] canvas');
    const status = page.getByTestId('status-overlay');
    for (const button of ['left', 'right'] as const) {
      await selectView(page, '正面');
      await page.waitForTimeout(800);
      const box = await canvas.boundingBox();
      if (!box) throw new Error('3D盤がありません');
      const point = terminalPoint(toTerminalId('S1.9'), box);
      const before = JSON.parse(
        (await page.getByTestId('camera-readout').textContent())!,
      ) as Readout;
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button });
      await page.mouse.move(point.x + 50, point.y + 35, { steps: 10 });
      await page.mouse.up({ button });
      await page.waitForTimeout(700);
      const after = JSON.parse(
        (await page.getByTestId('camera-readout').textContent())!,
      ) as Readout;
      expect(
        Math.hypot(after.tx - before.tx, after.ty - before.ty, after.tz - before.tz),
      ).toBeGreaterThan(5);
      expect(after.az).toBeCloseTo(before.az, 4);
      expect(after.polar).toBeCloseTo(before.polar, 4);
      await expect(status).toContainText('端子未選択');
      await expect(status).toContainText('自分で張った電線 0 本');
    }
    await selectView(page, '俯瞰');
    await settledShot(app, page, 'interaction-3d-relay-timer');
    await selectView(page, 'ソケット拡大');
    await settledShot(app, page, 'interaction-3d-details');
  } finally {
    await app.close();
  }
});
