import { expect, test, type Page } from '@playwright/test';
import { launchApp, settledShot } from './app.js';
import { closeOverflow, openOverflow, pushButtonPoint, selectView } from './projection.js';

async function buttonPoint(page: Page, id: string) {
  const box = await page.locator('[data-testid=viewport] canvas').boundingBox();
  if (!box) throw new Error('3D盤がありません');
  return pushButtonPoint(id, box);
}

test('保持したボタンと別の3Dボタンを同時に押せて、それぞれ解除できる', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1280, height: 800 } });
  try {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await selectView(page, '正面');
    const state = page.getByTestId('push-button-state');
    await expect(state).toHaveText('押下中: なし');
    await page.getByTestId('hold-PB1').click();
    await expect(state).toHaveText('押下中: PB1');
    const pb2 = await buttonPoint(page, 'PB2');
    await page.mouse.move(pb2.x, pb2.y);
    await page.mouse.down();
    await expect(state).toHaveText('押下中: PB1・PB2');
    // ボタンの外へ移動しても、離すまでは押下を続ける。
    await page.mouse.move(pb2.x + 60, pb2.y - 30, { steps: 5 });
    await expect(state).toHaveText('押下中: PB1・PB2');
    await settledShot(app, page, 'buttons-held-and-pressed');
    await page.mouse.up();
    await expect(state).toHaveText('押下中: PB1');
    await page.getByTestId('hold-PB2').click();
    await expect(state).toHaveText('押下中: PB1・PB2');
    await page.getByTestId('hold-PB1').click();
    await expect(state).toHaveText('押下中: PB2');
    await page.getByTestId('release-all-buttons').click();
    await expect(state).toHaveText('押下中: なし');

    const pb1 = await buttonPoint(page, 'PB1');
    await page.keyboard.down('Shift');
    await page.mouse.click(pb1.x, pb1.y);
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('hold-PB1')).toHaveAttribute('aria-pressed', 'true');
    await expect(state).toHaveText('押下中: PB1');
    await page.keyboard.press('Escape');
    await expect(state).toHaveText('押下中: なし');
    await expect(page.getByTestId('hold-PB1')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('release-all-buttons')).toBeDisabled();
    await page.getByTestId('hold-PB3').focus();
    await page.keyboard.press('Space');
    await expect(state).toHaveText('押下中: PB3');
    await page.getByTestId('socket-list-S1').click();
    await page.getByTestId('mount-relay-my4n').click();
    await expect(page.getByTestId('hold-PB3')).toHaveAttribute('aria-pressed', 'false');
    await expect(state).toHaveText('押下中: なし');
  } finally {
    await app.close();
  }
});

test('C2で線番を回路図と照合でき、新しい操作説明がありインストール章はない', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1440, height: 900 } });
  try {
    await page.getByTestId('mode-inspect-repair').click();
    await page.getByTestId('open-c2-001').click();
    await openOverflow(page);
    await page.getByTestId('toggle-schematic').click();
    await closeOverflow(page);
    const numbers = page.getByTestId('schematic-svg').locator('[data-wire-number]');
    await expect(numbers.first()).toBeVisible();
    const printed = new Set(await numbers.allTextContents());
    expect(printed.has('P')).toBe(true);
    expect(printed.has('N')).toBe(true);
    expect([...printed].some((number) => /^\d+$/u.test(number))).toBe(true);
    await page.getByTestId('wire-list-summary').click();
    const rows = page.locator('[data-testid^="wire-row-"]');
    const labels = await rows.allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const number = /回路図の線番 ([^・]+)・/u.exec(label)?.[1];
      expect(number, label).toBeDefined();
      expect(printed.has(number!)).toBe(true);
    }
    const search = page.getByRole('searchbox', { name: '電線・端子・線番を検索' });
    await search.fill('01');
    await expect(rows.first()).toBeVisible();
    for (const label of await rows.allTextContents()) expect(label).toContain('回路図の線番 01・');
    await search.fill('');
    await selectView(page, 'ソケット拡大');
    await settledShot(app, page, 'c2-wire-markers-close');
    const box = await page.locator('[data-testid=viewport] canvas').boundingBox();
    if (!box) throw new Error('3D盤がありません');
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.57);
    await page.mouse.wheel(0, -400);
    await page.mouse.move(0, 0);
    await settledShot(app, page, 'c2-wire-markers-reading');
    await selectView(page, '俯瞰');
    await settledShot(app, page, 'c2-wire-markers-oblique');

    await page.getByTestId('open-help').click();
    const contents = page.getByTestId('help-contents');
    await expect(contents).not.toContainText('パソコンに入れる');
    await expect(contents).toContainText('押しボタンを同時に押す');
    await expect(contents).toContainText('回路図とマークチューブを照合する');
    await page.getByTestId('help-search').fill('インストール');
    await expect(page.getByTestId('help-hit')).toHaveCount(0);
    await expect(page.getByTestId('help-drawer')).toContainText('見つかりませんでした');
  } finally {
    await app.close();
  }
});
