import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, settledShot } from './app.js';

/**
 * 回路図エディタのE2E（§16 Phase 5 受入基準①②）と、2026-09-19 のUXレビュー #28 / #29。
 * 設計仕様 §11.4 / §8.3 / §15、Plan 5 決定表#1・#7・#9・#11・#12。
 *
 * 起動の定型と `shot()` は `e2e/app.ts` に1か所だけ置いてある（QA-12 / QA-13）。画面の文言も `src/renderer/i18n/ja.ts` からの**書き写し**で、
 * E2E は成果物を外から触るだけにする（`inspect.spec.ts` 冒頭の注記と同じ流儀）。
 *
 * **このファイルの test は上から順に流す前提**（`polish.spec.ts` と同じ流儀。Batch E レビュー
 * Minor 5）。前の test が置いた画面の状態を次の test が引き継ぐので、`-g` で1本だけ流すと落ちる。
 * そのため `test.describe.serial` にしてある（レビュー指摘 QA-03）。
 */

let app: ElectronApplication;
let page: Page;

/** 画面が落ち着くのを待ってから撮る（`e2e/app.ts` の `settledShot()`）。 */
async function shot(name: string): Promise<void> {
  await settledShot(app, page, name);
}

/** 配線ガイドで光っている盤の端子（`app/store.ts` の `setHighlight()` が書く窓）。 */
async function highlightedTerminals(): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as unknown as { __ojtHighlight?: readonly string[] }).__ojtHighlight ?? []),
  ]);
}

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await app.close();
});

test.describe.serial('回路図エディタ（§16 Phase 5 受入基準①②）', () => {
  /*
   * 描く回路は **b-001 の模範回路（`packages/content/src/builtin/assemble/b-001-self-hold.json`）
   * と同じ形**にする。段1が `pb-b PB2 → pb-a PB1 → coil CR1`、段2（`r1h`）が
   * `{rung:'r1',node:1} → {rung:'r1',node:2}` の **cr-a CR1**（＝PB1 の a接点と並列）、
   * 段3が `cr-a CR1 → lamp PL1`。節点1〜2 のあいだにあるのは PB1 の a接点なので、
   * ここを並列にすると「押している間だけ入る PB1」を CR1 の接点が肩代わりする＝自己保持になる。
   */
  test('受入基準①: 自己保持回路を描いて検算で合格する', async () => {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.getByTestId('assemble-view-schematic').click();
    await expect(page.getByTestId('schematic-editor')).toBeVisible();

    // 段1: PB2 b接点 → PB1 a接点 → CR1 コイル
    await page.getByTestId('palette-pb-b:PB2').click();
    await page.locator('[data-slot="r1#0"]').click();
    await page.getByTestId('palette-pb-a:PB1').click();
    await page.locator('[data-slot="r1#1"]').click();
    await page.getByTestId('palette-coil:CR1').click();
    await page.locator('[data-slot="r1#2"]').click();

    // 段2: CR1 a接点を置き、「この段を分岐にする」で両端を段1の節点1 → 節点2 へ向ける
    await page.getByTestId('add-rung-button').click();
    await page.getByTestId('palette-cr-a:CR1').click();
    await page.locator('[data-slot="r2#0"]').click();
    await page.getByTestId('branch-button').click();
    await expect(page.getByTestId('branch-hint')).toContainText('分岐の始点をクリック');
    await page.locator('[data-slot="r1#1"]').click();
    await expect(page.getByTestId('branch-hint')).toContainText('分岐の終点をクリック');
    await page.locator('[data-slot="r1#2"]').click();
    // 両端が決まると分岐モードを抜ける（案内が手順帯に戻る）
    await expect(page.getByTestId('branch-hint')).toHaveCount(0);

    // 段3: CR1 a接点 → PL1。パレットは `cr-a:CR1` を選んだままなので押し直さない
    // （押すと `aria-pressed` が外れて「置く」ではなく「選択解除」になる）
    await page.getByTestId('add-rung-button').click();
    await expect(page.getByTestId('palette-cr-a:CR1')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-slot="r3#0"]').click();
    await page.getByTestId('palette-lamp:PL1').click();
    await page.locator('[data-slot="r3#1"]').click();

    // 指摘欄が空＝文書として妥当（決定表#3。ここまでは `validateDocument()` だけの判断）
    await expect(page.getByTestId('schematic-issues')).toContainText('指摘はありません');
    await shot('50-schematic-editor');
    await expect(page.getByTestId('verify-button')).toBeEnabled();
    await page.getByTestId('verify-button').click();
    await expect(page.getByTestId('verify-verdict')).toHaveText('検算 合格', { timeout: 30_000 });
    await shot('51-verify-passed');
  });

  test('受入基準②: 回路図の要素をクリックすると3D盤の端子が光る', async () => {
    await page.getByTestId('assemble-view-split').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    // パレットの選択を外す。選んだままだと、桁を押したときに「置き換え」になる（B2）
    await page.getByTestId('palette-lamp:PL1').click();
    await expect(page.getByTestId('palette-lamp:PL1')).toHaveAttribute('aria-pressed', 'false');
    /*
     * **記号そのもの**を押す。本物のブラウザは最前面の要素をクリック先に選ぶので、
     * 記号の上に敷いた当たり矩形（`data-slot`）が受け取り、その桁の要素IDが
     * `onPickCell` に回る。この重なりは JSDOM では再現できないので、ここでしか確かめられない（B2）。
     *
     * 「並べて」ではエディタの枠が縦に細く、図の一部は枠の外へはみ出す。まず記号を枠の中へ
     * 送ってから、**記号の上に当たり矩形が載っている点**を `elementsFromPoint()` で探す
     * （重なりの順まで確かめる）。見つけた点を `page.mouse.click()` で素直に押すので、
     * `force` で当たり判定の検査を省いたりはしない。
     */
    await page
      .locator('[data-testid="schematic-editor"] [data-cell]')
      .first()
      .scrollIntoViewIfNeeded();
    const target = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="schematic-editor"]');
      if (root === null) return null;
      for (const node of root.querySelectorAll('[data-cell]')) {
        const box = node.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const stack = document.elementsFromPoint(x, y);
        const slot = stack.find((el) => el.hasAttribute('data-slot'));
        // 記号がその点にあり、その手前に当たり矩形が載っていること
        if (slot === undefined || !stack.includes(node)) continue;
        if (stack.indexOf(slot) > stack.indexOf(node)) continue;
        return {
          x,
          y,
          cellId: node.getAttribute('data-cell'),
          slot: slot.getAttribute('data-slot'),
        };
      }
      return null;
    });
    expect(target).not.toBeNull();
    if (target === null) throw new Error('当たり矩形に覆われた記号が見つかりません');
    await page.mouse.click(target.x, target.y);
    // ハイライトはストアに出る（3Dの発光はスクリーンショットで見る）
    const terminals = await highlightedTerminals();
    expect(terminals.length).toBeGreaterThan(0);
    await shot('52-wiring-guide');
  });
});

test.describe.serial('結果の疑い一覧とキーボード配線（UXレビュー #28 / #29）', () => {
  test('#28: 不合格の結果から疑わしい端子を盤で見られる', async () => {
    await page.getByTestId('assemble-view-board').click();
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('verdict')).toHaveText('不合格');
    await expect(page.getByTestId('suspect-list')).toBeVisible();
    // 組が違うだけでもここに出る、という断り書きは一覧が出ているあいだ必ず添う（決定表#9b）
    await expect(page.getByTestId('suspect-note')).toBeVisible();
    await shot('53-result-suspects');
    await page.getByRole('button', { name: '盤で見る' }).first().click();
    await expect(page.getByTestId('board-focus')).toBeVisible();
    // 疑いの端子はストアの `highlight` に入っている（3Dの輪はスクリーンショットで見る）
    expect((await highlightedTerminals()).length).toBeGreaterThan(0);
    await shot('54-suspect-on-board');
    await page.getByTestId('back-to-result').click();
    await expect(page.getByTestId('verdict')).toBeVisible();
  });

  test('#29: 端子リストから Tab と Enter だけで電線を1本張れる', async () => {
    await page.getByRole('button', { name: 'もう一度' }).click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    const before = await page.getByTestId('status-overlay').textContent();
    await page.getByTestId('terminal-search').fill('CR1');
    await page.getByTestId('terminal-row-CR1.14').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('terminal-pending')).toContainText('CR1.14');
    await page.getByTestId('terminal-search').fill('P1');
    await page.getByTestId('terminal-row-P.1').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-overlay')).not.toHaveText(before ?? '');
    // 1本目の選択が残っただけではなく、電線が**実際に1本**増えている（`ja.ts` の `wireCountText()`）
    await expect(page.getByTestId('status-overlay')).toContainText('自分で張った電線 1 本');
    await expect(page.getByTestId('terminal-pending')).toHaveCount(0);
    await shot('55-keyboard-wiring');
  });
});
