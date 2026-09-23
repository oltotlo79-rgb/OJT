import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, shot, SHOT_DIR } from './app.js';
import { verifyTutorials } from './tutorial-checks.js';
import { clickOverflowButton, openOverflow, closeOverflow } from './projection.js';

test('4種類の解答動画をオフライン再生し、日本語字幕・シーク・速度とフォーカスを確認する', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1600, height: 900 } });
  try {
    await verifyTutorials(page);
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await page.getByTestId('tutorial-assemble').click();
    // 動画を見ている間のキーボード操作が後ろの作業へ流れないことを確かめる。
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-drawer')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tutorial-player')).toHaveCount(0);
    for (const width of [1280, 1100]) {
      await app.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size, 800),
        width,
      );
      // setContentSizeの応答時点では広幅のインライン欄がまだ残ることがある。
      // Reactが狭幅のメニューボタンへ切り替わったことを待ってから開く。
      await expect(page.getByTestId('toolbar-overflow-toggle')).toBeVisible();
      await openOverflow(page);
      for (const name of ['作業を保存', '作業を読込']) {
        await expect
          .poll(() =>
            page.getByRole('button', { name, exact: true }).evaluate((button) => {
              const r = button.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return r.left >= 0 && r.right <= innerWidth && hit !== null && button.contains(hit);
            }),
          )
          .toBe(true);
      }
      await closeOverflow(page);
    }
  } finally {
    await app.close();
  }
});

test('測定・診断メモを保存して読み直し、PDFに端子・単位・根拠を残す', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1600, height: 900 } });
  mkdirSync(SHOT_DIR, { recursive: true });
  const work = join(SHOT_DIR, 'review-measurement.ojtw');
  const pdf = join(SHOT_DIR, 'review-measurement.pdf');
  try {
    await page.getByTestId('mode-inspect-parts').click();
    await page
      .getByTestId('grade-filter')
      .getByRole('button', { name: 'すべて', exact: true })
      .click();
    await page.getByTestId('open-c1-001').click();
    await page.getByTestId('plug-p1').click();
    await page.getByTestId('tester-modes').getByRole('button', { name: 'Ω', exact: true }).click();
    await page.getByTestId('probe-target-coil').click();
    await expect(page.getByTestId('tester-readout')).toContainText('650.0');
    await page.getByTestId('measurement-panel-summary').click();
    const panel = page.getByTestId('measurement-panel');
    await panel.getByLabel('測定の目的・気付いたこと').fill('コイル断線の有無を抵抗値で確認する。');
    await page.getByTestId('record-measurement').click();
    await expect(page.getByTestId('measurement-record')).toContainText('650.0 Ω');
    await panel.getByRole('checkbox').check();
    await panel.getByLabel('対象の線・端子・部品').fill('部品 p1 のコイル');
    await panel.getByLabel('予測', { exact: true }).fill('断線ならOLになる。');
    await panel
      .getByLabel('測定から分かったこと・次に調べること')
      .fill('約650Ωなので断線はない。次は励磁前後の接点を調べる。');
    await panel.getByRole('button', { name: '選んだ測定記録とメモを保存', exact: true }).click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, work);
    await clickOverflowButton(page, '作業を保存');
    await expect(page.getByTestId('toast').filter({ hasText: '保存しました' })).toBeVisible();
    await expect.poll(() => existsSync(work)).toBe(true);
    const saved = JSON.parse(readFileSync(work, 'utf8')) as {
      measurements: unknown[];
      diagnosisNotes: unknown[];
    };
    expect(saved.measurements).toHaveLength(1);
    expect(saved.diagnosisNotes).toHaveLength(1);
    await panel.getByRole('button', { name: '記録を削除', exact: true }).click();
    await expect(page.getByTestId('measurement-record')).toHaveCount(0);
    await clickOverflowButton(page, '作業を読込');
    await expect(page.getByTestId('discard-confirm')).toBeVisible();
    await page
      .getByTestId('discard-confirm')
      .getByRole('button', { name: '保存せず開く', exact: true })
      .click();
    await expect(page.getByTestId('discard-confirm')).toHaveCount(0);
    if ((await page.getByTestId('measurement-panel-details').getAttribute('open')) === null)
      await page.getByTestId('measurement-panel-summary').click();
    await expect(page.getByTestId('measurement-record')).toContainText('650.0 Ω');
    await expect(panel).toContainText('約650Ωなので断線はない');
    await page
      .getByTestId('tester-modes')
      .getByRole('button', { name: 'OFF', exact: true })
      .click();
    await expect(page.getByTestId('measurement-record')).toContainText('650.0 Ω');
    await shot(app, 'review-measurement-restored');
    await page.getByTestId('judge-button').click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, pdf);
    await page.getByTestId('result-export').click();
    await expect(page.getByTestId('toast').filter({ hasText: '結果を書き出しました' })).toBeVisible(
      {
        timeout: 35_000,
      },
    );
    await expect.poll(() => existsSync(pdf), { timeout: 35_000 }).toBe(true);
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  } finally {
    await app.close();
  }
});

test('自由I/O割付の重複を拒否し、一括配線とUndo・Redoを画面から操作する', async () => {
  const { app, page } = await launchApp({ contentSize: { width: 1600, height: 900 } });
  try {
    await page.getByTestId('mode-plc').click();
    await page
      .getByTestId('grade-filter')
      .getByRole('button', { name: 'すべて', exact: true })
      .click();
    await page.getByTestId('open-d-061').click();
    await page.getByTestId('view-ladder').click();
    const editor = page.getByTestId('io-assignment-editor');
    await editor.getByRole('button', { name: 'I/O割付を変更', exact: true }).click();
    await editor.getByLabel('PB1 の入力', { exact: true }).selectOption('1');
    await expect(editor.getByRole('button', { name: '確認して確定', exact: true })).toBeDisabled();
    await expect(editor.getByRole('alert')).toBeVisible();
    await editor.getByLabel('PB1 の入力', { exact: true }).selectOption('4');
    await editor.getByLabel('CR1 の出力', { exact: true }).selectOption('4');
    await editor.getByLabel('入力方式').selectOption('source');
    await editor.getByRole('checkbox').check();
    await editor.getByText('配線の変更内容', { exact: true }).click();
    await expect(editor).toContainText('追加 OUTLET.L');
    await editor.getByRole('button', { name: '確認して確定', exact: true }).click();
    await expect(page.getByTestId('io-input-0')).toContainText('X4');
    await expect(page.getByTestId('io-output-0')).toContainText('Y4');
    await expect(page.getByTestId('io-wiring')).toContainText('ソース');
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('status-overlay')).not.toContainText('自分で張った電線 0 本');
    await shot(app, 'review-free-io-wiring');
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 0 本');
    await page.getByRole('button', { name: 'やり直し', exact: true }).click();
    await expect(page.getByTestId('status-overlay')).not.toContainText('自分で張った電線 0 本');
    await page.getByTestId('view-ladder').click();
    await expect(page.getByTestId('io-input-0')).toContainText('X4');
  } finally {
    await app.close();
  }
});

test('GUIで拡張盤を複製・編集・模範検証・保存し、追加端子の配線を完成して合格する', async () => {
  const { app, page, userDataDir } = await launchApp({ contentSize: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const directory = join(userDataDir, 'authored');
  mkdirSync(directory);
  const output = join(directory, 'user-review-expanded.json');
  try {
    // OSの保存先選択だけを専用フォルダへ固定し、作成・検証・読込は配布コードを使う。
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, output);
    await page.getByTestId('open-settings').click();
    await page.getByTestId('problem-authoring-summary').click();
    const authoring = page.getByTestId('problem-authoring');
    await authoring.getByLabel('複製元の課題').selectOption('b-087');
    await authoring.getByRole('button', { name: '課題を複製', exact: true }).click();
    await authoring.getByLabel('課題ID', { exact: true }).fill('user-review-expanded');
    await authoring.getByLabel('課題名', { exact: true }).fill('追加端子の検証課題');
    await authoring.getByLabel('1端子の最大本数', { exact: true }).selectOption('3');
    await authoring.getByLabel('ヒントの出し方', { exact: true }).selectOption('off');
    await authoring.getByLabel('追加押ボタン数（PB5〜）', { exact: true }).fill('2');
    await authoring.getByText('操作列（2件）', { exact: true }).click();
    await authoring.getByLabel('操作列 1 押ボタン', { exact: true }).selectOption('PB6');
    await authoring.getByLabel('操作列 2 押ボタン', { exact: true }).selectOption('PB6');
    await authoring.getByTestId('author-reference-open').click();
    const reference = page.getByTestId('author-reference-editor');
    await reference.getByTestId('palette-pb-a:PB6').click();
    await reference.locator('[data-slot="r0#0"]').click();
    await reference.getByRole('button', { name: '元に戻す', exact: true }).click();
    await reference.getByRole('button', { name: 'やり直し', exact: true }).click();
    await shot(app, 'v160-authoring-schematic');
    await reference.getByRole('button', { name: '編集を終える', exact: true }).click();
    await expect(authoring.getByLabel('課題定義JSON')).toHaveValue(/"device": "PB6"/u);
    await authoring
      .getByRole('button', { name: '課題を検証（模範の自己判定）', exact: true })
      .click();
    await expect(authoring.getByRole('status')).toContainText('検証合格', { timeout: 65_000 });
    await shot(app, 'review-authoring-validated.png');
    await authoring.getByRole('button', { name: '検証してJSONを保存', exact: true }).click();
    await expect(authoring.getByRole('status')).toContainText('保存しました', { timeout: 65_000 });
    const definition: unknown = JSON.parse(readFileSync(output, 'utf8'));
    expect(definition).toMatchObject({
      id: 'user-review-expanded',
      board: { profile: { rules: { hintPolicy: 'off', maxWiresPerTerminal: 3 } } },
    });
    await authoring
      .getByRole('button', { name: '保存先を利用者課題フォルダに設定する', exact: true })
      .click();
    await expect(page.getByTestId('setting-user-dir')).toHaveValue(directory);
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-user-review-expanded').click();
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
    await page.getByTestId('terminal-list-summary').click();
    for (const [from, to] of [
      ['P.1', 'TB_PB.6c'],
      ['TB_PB.6a', 'TB_AUX.1a'],
      ['TB_AUX.1b', 'TB_PL.5+'],
      ['TB_PL.5-', 'N.1'],
    ]) {
      await page.getByTestId(`terminal-row-${from}`).click();
      await page.getByTestId(`terminal-row-${to}`).click();
    }
    await expect(page.getByTestId('status-overlay')).toContainText('4 本');
    await shot(app, 'review-expanded-board-wired.png');
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toHaveText('合格', { timeout: 60_000 });
    expect(errors).toEqual([]);
    await shot(app, 'review-expanded-result.png');
    mkdirSync(SHOT_DIR, { recursive: true });
    copyFileSync(output, join(SHOT_DIR, 'review-created-problem.json'));
  } finally {
    await app.close();
  }
});
