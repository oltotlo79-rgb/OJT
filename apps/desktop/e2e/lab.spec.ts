import { expect, test, type Page } from '@playwright/test';
import { launchApp, settledShot } from './app.js';

/**
 * 回路実験・PLC実験の通し検査（2026-10-08 利用者指示）。
 * 設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §8
 *
 * ビルド済みの Electron を起こし、ホームの開始の窓 → タイムチャートを描く → 動かす →
 * 結果を正解に取り込む → 判定 → 盤で見直す、を実際の画面で通す。
 * 文言は `src/renderer/i18n/ja.ts` と同じものを書き写している（E2E は成果物を外から触る）。
 */

/** WebGL の初期化とシーンの1フレーム目を待つ（`plc.spec.ts` と同じ）。 */
async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
      timeout: 30_000,
    })
    .toBe(1);
}

/** デバイス入力欄に入れて確定する（`plc.spec.ts` と同じ）。 */
async function commitDevice(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId('device-input')).toBeVisible();
  await page.getByTestId('device-text').fill(text);
  await page.getByTestId('device-commit').click();
  await expect(page.getByTestId('device-input')).toHaveCount(0);
}

/** 編集窓の行を、描画域の割合 `from`〜`to`（0〜1）だけドラッグする。 */
async function dragRow(page: Page, signal: string, from: number, to: number): Promise<void> {
  const box = await page.getByTestId(`lab-row-hit-${signal}`).boundingBox();
  if (box === null) throw new Error(`${signal} の行が見つかりません`);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from + to) / 2), y, { steps: 4 });
  await page.mouse.move(box.x + box.width * to, y, { steps: 4 });
  await page.mouse.up();
}

test('回路実験: 例題から描いて動かし、結果を正解に取り込んで判定し、盤で見直す', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1440, height: 900 } });
  try {
    await page.getByTestId('mode-assemble-lab').click();
    await expect(page.getByTestId('lab-start')).toBeVisible();
    await page.getByTestId('lab-start-template').selectOption('self-hold');
    await expect(page.getByTestId('lab-start-template-note')).toContainText('PB1を押すとPL1');
    await settledShot(app, page, 'lab-start');
    await page.getByTestId('lab-start-go').click();

    await expect(page.getByTestId('lab-panel')).toBeVisible();
    await waitForBoard(page);
    await expect(page.getByTestId('lab-status')).toContainText('押し方 2区間・正解 1行');
    await expect(page.getByTestId('step-inputs')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('judge-button')).toHaveAttribute('aria-disabled', 'false');

    // 編集窓: 押ボタン4の行に 2.0〜2.5 秒の押し方を描き足す（長さ5秒の 40%〜50%）
    await page.getByTestId('lab-open-editor').click();
    await expect(page.getByTestId('lab-editor')).toBeVisible();
    await dragRow(page, 'PB4', 0.4, 0.5);
    await expect(page.getByTestId('lab-row-PB4')).toHaveAttribute('data-intervals', '2000-2500');
    await expect(page.getByTestId('lab-interval-PB4-0-from')).toHaveValue('2');

    // 何も配線していない盤で動かすと、正解（PL1 の点灯）と違う
    await page.getByTestId('lab-run-in-editor').click();
    await expect(page.getByTestId('lab-editor-status')).toContainText('正解と違う所');
    await expect(
      page.locator('[data-testid="lab-row-PL1"] [data-role="mismatch"]'),
    ).not.toHaveCount(0);
    // 動かした結果を正解に取り込む（確認付き）
    await page.getByTestId('lab-capture').click();
    await page.getByTestId('lab-capture-confirm').click();
    await expect(page.getByTestId('lab-editor-status')).toContainText('正解どおり');
    await settledShot(app, page, 'lab-editor');
    await page.getByTestId('lab-close').click();
    await expect(page.getByTestId('lab-editor')).toHaveCount(0);

    // 盤で動きを見る（実験の欄から始めた見直しは練習の画面へ戻る）
    await page.getByTestId('lab-replay').click();
    await expect(page.getByTestId('replay-bar')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('replay-viewport')).toBeVisible();
    await page.getByTestId('replay-stop').click();
    await expect(page.getByTestId('lab-panel')).toBeVisible();

    // 判定は上のツールバーの1か所（取り込んだ正解と同じ動きなので合格）
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('lab-why-passed')).toBeVisible();
    await expect(page.getByTestId('chart-legend')).toContainText('動かした結果（太い線）');
    await settledShot(app, page, 'lab-result');

    // もう一度: 盤を作り直し、タイムチャートは残る
    await page.getByRole('button', { name: 'もう一度' }).click();
    await expect(page.getByTestId('lab-panel')).toBeVisible();
    await expect(page.getByTestId('lab-status')).toContainText('押し方 3区間');
  } finally {
    await app.close();
  }
});

test('PLC実験: 配線済みの盤で始め、変換したラダーで動かし、自分で配線する盤へ作り直す', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1440, height: 900 } });
  try {
    await page.getByTestId('mode-plc-lab').click();
    await expect(page.getByTestId('lab-start')).toBeVisible();
    await expect(page.getByTestId('lab-start-prewired')).toBeChecked();
    await page.getByTestId('lab-start-template').selectOption('self-hold');
    await page.getByTestId('lab-start-go').click();

    await expect(page.getByTestId('plc-session')).toBeVisible();
    await expect(page.getByTestId('lab-wiring-mode')).toHaveText('盤: 配線済み');
    await expect(page.getByTestId('plc-step-wire')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('status-overlay')).toContainText('固定');
    await waitForBoard(page);
    await settledShot(app, page, 'lab-plc-prewired');

    // 変換していないラダーでは動かさない（理由を出す）
    await page.getByTestId('lab-run').click();
    await expect(page.getByTestId('toast').last()).toContainText('変換');

    // X0 で Y0 を出すだけのラダーを F5 / F7 で組み、F4 で変換して動かす。
    // 押している間しか点かないので、自己保持の正解とは違う
    await page.getByTestId('view-ladder').click();
    await expect(page.getByTestId('ladder-editor')).toBeVisible();
    await page.getByTestId('cell-n1:0:0').click();
    await page.getByTestId('ladder-editor').press('F5');
    await commitDevice(page, 'X0');
    await page.getByTestId('cell-n1:0:15').click();
    await page.getByTestId('ladder-editor').press('F7');
    await commitDevice(page, 'Y0');
    await page.getByTestId('ladder-editor').press('F4');
    await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
    await page.getByTestId('view-split').click();
    await page.getByTestId('lab-run').click();
    await expect(page.getByTestId('lab-status')).toContainText('正解と違う所');
    await settledShot(app, page, 'lab-plc-ladder');

    // 自分で配線する盤へ作り直す（タイムチャートは残る）
    await page.getByTestId('lab-restart-board').click();
    await expect(page.getByTestId('lab-restart')).toBeVisible();
    await page.getByTestId('lab-restart-self-wire').check();
    await page.getByTestId('lab-restart-go').click();
    await expect(page.getByTestId('lab-wiring-mode')).toHaveText('盤: 自分で配線');
    await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 0 本');
    await expect(page.getByTestId('lab-status')).toContainText('押し方 3区間');
  } finally {
    await app.close();
  }
});
