import { BUILTIN_PLC_PROBLEMS, type PlcProblem } from '@ojt/content';
import { COIL_COL } from '@ojt/ladder-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type Launched } from './app.js';

/**
 * 回路入力の3つの入口（Phase 7 Task 21 / 設計 §5.3、指摘 UX-02・PR-01）のE2E。
 *
 * **利用者要望3の中心（「F5でA接点が入力される」）が4方言すべてで実際に起きること**を、
 * 組み上がったアプリを外から触って確かめる。文言は `src/renderer/i18n/ja.ts` と同じものを
 * 書き写している（E2E は成果物を外から触る）。
 *
 * **設定は `userData` に残る**ので、どのテストも最後に既定メーカーを三菱へ戻す（決定表#21）。
 */

/** 他の E2E と同じ窓の大きさ。 */
const WINDOW = { width: 1440, height: 900 } as const;

const PROBLEM: PlcProblem = (() => {
  const found = BUILTIN_PLC_PROBLEMS[0];
  if (found === undefined) throw new Error('内蔵モードD課題がありません');
  return found;
})();

/**
 * ビルド済みの Electron を起こし、モードDのホームに立たせる（`e2e/app.ts`）。
 * `launchApp()` が起動ごとに使い捨ての `userData` を作るので、他の spec を汚さない（QA-12）。
 */
async function launch(): Promise<Launched> {
  return launchApp({ window: WINDOW, home: 'mode-plc' });
}

/** どの画面からでもホームへ戻る（`plc-vendors.spec.ts` の `goHome()` と同じ）。 */
async function goHome(page: Page): Promise<void> {
  const home = page.getByTestId('mode-plc');
  if ((await home.count()) > 0) {
    await expect(home).toBeVisible();
    return;
  }
  const sessionBack = page.getByTestId('session-back');
  if ((await sessionBack.count()) > 0) await sessionBack.click();
  const listBack = page.getByRole('button', { name: 'ホームへ戻る', exact: true });
  await expect(listBack).toBeVisible();
  await listBack.click();
  await expect(home).toBeVisible();
}

/** 設定画面で既定メーカーを選ぶ（＝利用者と同じ道筋。決定表#21）。 */
async function setVendor(page: Page, vendor: string): Promise<void> {
  await goHome(page);
  await page.getByTestId('open-settings').click();
  const select = page.getByTestId('setting-vendor');
  await expect(select).toBeVisible();
  if ((await select.inputValue()) !== vendor) {
    const saved = page.getByTestId('toast').filter({ hasText: '設定を保存しました' });
    await expect(saved).toHaveCount(0);
    await select.selectOption(vendor);
    await expect(saved).toHaveCount(1);
  }
  await expect(select).toHaveValue(vendor);
  await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
  await expect(page.getByTestId('mode-plc')).toBeVisible();
}

/** そのメーカーで開いてから、既定メーカーを必ず戻す（決定表#21）。 */
async function withVendor(vendor: string, body: (page: Page) => Promise<void>): Promise<void> {
  const { app, page } = await launch();
  let failed = false;
  let cleanupError: Error | undefined;
  try {
    await setVendor(page, vendor);
    await body(page);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      if (!page.isClosed() && vendor !== 'mitsubishi') await setVendor(page, 'mitsubishi');
    } catch (error) {
      if (failed) console.warn(`[withVendor] ${vendor} の既定メーカー復帰に失敗しました:`, error);
      else cleanupError = error instanceof Error ? error : new Error(String(error));
    }
    await app.close();
  }
  if (cleanupError !== undefined) throw cleanupError;
}

/** ホーム → PLC → 課題を開く。 */
async function openPlcProblem(page: Page): Promise<void> {
  await page.getByTestId('mode-plc').click();
  await expect(page.getByTestId('problem-table')).toBeVisible();
  await page.getByTestId(`open-${PROBLEM.id}`).click();
  await expect(page.getByTestId('plc-session')).toBeVisible();
}

/** ラダーエディタにキーを送る（`press()` は要素にフォーカスしてから押す）。 */
async function key(page: Page, name: string): Promise<void> {
  await page.getByTestId('ladder-editor').press(name);
}

/**
 * 1行直接入力に打って `Enter` で確定する（設計 §5.3）。
 * CX-Programmer 風は続けてコメント欄が開くので、もう一度 `Enter` を押す（設計 §5.2 の S4）。
 */
async function enterLine(page: Page, line: string, commentStep: boolean): Promise<void> {
  const field = page.getByTestId('direct-text');
  await expect(field).toBeVisible();
  await field.fill(line);
  await field.press('Enter');
  if (commentStep) {
    const comment = page.getByTestId('entry-comment');
    await expect(comment).toBeVisible();
    await comment.press('Enter');
  }
  await expect(page.getByTestId('device-input')).toHaveCount(0);
}

/** 方言ごとの「キー・綴り・変換の有無」。値はすべて `packages/plc-dialects` の表そのもの。 */
interface DialectCase {
  vendor: string;
  skinTitle: string;
  /** a接点のキー（実ブラウザは英字を小文字で渡す。指摘 LE-1）。 */
  contactKey: string;
  coilKey: string;
  /** 記号ボタンに併記されるキー（ツールバーの表示）。 */
  contactButton: string;
  contactLine: string;
  contactText: string;
  coilLine: string;
  coilText: string;
  /** 「変換」のキー（持たないメーカーは undefined＝自動変換）。 */
  convertKey?: string;
  convertText: string;
  /** デバイスのあとにコメント欄が続くか。 */
  commentStep: boolean;
}

const CASES: readonly DialectCase[] = [
  {
    vendor: 'mitsubishi',
    skinTitle: 'MELSOFT GX Works3 風',
    contactKey: 'F5',
    coilKey: 'F7',
    contactButton: 'a接点 (F5)',
    contactLine: 'LD X0',
    contactText: 'X0',
    coilLine: 'OUT Y0',
    coilText: 'Y0',
    convertKey: 'F4',
    convertText: '変換に成功しました',
    commentStep: false,
  },
  {
    vendor: 'omron',
    skinTitle: 'CX-Programmer 風',
    contactKey: 'c',
    coilKey: 'o',
    contactButton: 'a接点 (C)',
    contactLine: 'LD 0.00',
    contactText: '0.00',
    coilLine: 'OUT 100.00',
    coilText: '100.00',
    convertText: '変換に成功しました（自動で変換されます）',
    commentStep: true,
  },
  {
    vendor: 'jtekt',
    skinTitle: 'PCwin 風',
    contactKey: '',
    coilKey: '',
    contactButton: 'a接点',
    /*
     * PC10G は入力と出力が同じアドレス空間にあり、`1X010` と `1Y010` は**同じアドレス**に
     * なる（`plc-vendors.spec.ts` ③ がその機種エラーを見ている）。ここは変換が通ることを
     * 見たいので、ぶつからない番号にする。
     */
    contactLine: 'LD 1X000',
    contactText: '1X000',
    coilLine: 'OUT 1Y010',
    coilText: '1Y010',
    convertText: '変換に成功しました（自動で変換されます）',
    commentStep: false,
  },
  {
    vendor: 'sharp',
    skinTitle: 'JW-300SP 風',
    contactKey: 's',
    coilKey: 'x',
    contactButton: 'a接点 (S)',
    // シャープのニーモニックは `STR`（`instructionNames.ld`）
    contactLine: 'STR 000000',
    contactText: '000000',
    coilLine: 'OUT 000020',
    coilText: '000020',
    convertText: '変換に成功しました（自動で変換されます）',
    commentStep: false,
  },
];

test.describe('回路入力の入口（Phase 7 Task 21 / 利用者要望3）', () => {
  for (const item of CASES) {
    test(`${item.vendor}: ${item.contactKey} で a接点が入り、コイルを置くと変換が通る`, async () => {
      await withVendor(item.vendor, async (page) => {
        await openPlcProblem(page);
        await expect(page.getByTestId('ladder-workspace')).toHaveAttribute(
          'data-skin',
          item.vendor,
        );
        await expect(page.getByTestId('skin-title')).toContainText(item.skinTitle);
        // 入口B: 記号ボタンにそのメーカーのキーが併記されている（設計 §5.3）
        await expect(page.getByTestId('symbol-contact-no')).toContainText(item.contactButton);

        // 入口A: キー → 1行入力 → Enter で a接点が現れる（利用者要望3の中心）
        await page.getByTestId('cell-n1:0:0').click();
        if (item.contactKey) await key(page, item.contactKey);
        else await page.getByTestId('symbol-contact-no').click();
        if (item.vendor === 'sharp') {
          await expect(page.getByTestId('cell-n1:0:0')).toHaveAttribute('data-incomplete', 'true');
          await key(page, 'Enter');
        }
        await expect(page.getByTestId('device-input')).toBeVisible();
        await enterLine(page, item.contactLine, item.commentStep);
        const contactCell = page.getByTestId('cell-n1:0:0');
        await expect(contactCell).toContainText(item.contactText);
        /*
         * a接点の**線画**が描かれていること。縦棒は幅0の `<path>` なので Playwright の
         * 可視判定（外接矩形）では「隠れている」と出る。ここは「その記号で描かれた」ことを
         * 見たいので、要素が付いていることで確かめる（文字は上の `toContainText` が見ている）。
         */
        await expect(contactCell.locator('[data-symbol="contact-no"]').first()).toBeAttached();

        // コイルを置く
        await page.getByTestId(`cell-n1:0:${String(COIL_COL)}`).click();
        if (item.coilKey) await key(page, item.coilKey);
        else await page.getByTestId('symbol-coil').click();
        if (item.vendor === 'sharp') await key(page, 'Enter');
        await enterLine(page, item.coilLine, item.commentStep);
        await expect(page.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toContainText(
          item.coilText,
        );

        // 変換（持たないメーカーは自動で通る）
        if (item.convertKey !== undefined) await key(page, item.convertKey);
        await expect(page.getByTestId('convert-state')).toHaveText(item.convertText);
      });
    });
  }

  /**
   * 入口B（ツールバーの記号ボタン）と入口C（格子のダブルクリック・右クリック）。
   * 3つの入口が**同じ欄**へ合流することを、1メーカーぶんだけ外から確かめる。
   */
  test('mitsubishi: ツールバーの記号ボタンと格子のダブルクリック・右クリックから同じ欄が開く', async () => {
    await withVendor('mitsubishi', async (page) => {
      await openPlcProblem(page);

      // 入口B: 記号ボタン
      await page.getByTestId('cell-n1:0:0').click();
      await page.getByTestId('symbol-contact-no').click();
      await enterLine(page, 'LD X0', false);
      await expect(page.getByTestId('cell-n1:0:0')).toContainText('X0');

      // 入口C: 空セルのダブルクリック（単クリックではカーソルが動くだけ）
      const next = page.getByTestId('cell-n1:0:1');
      await next.click();
      await expect(page.getByTestId('device-input')).toHaveCount(0);
      await next.dblclick();
      await enterLine(page, 'X1', false);
      await expect(next).toContainText('X1');

      // 入口C: 右クリックの記号メニュー（キーが併記されている）
      await page.getByTestId('cell-n1:0:2').click({ button: 'right' });
      await expect(page.getByTestId('cell-menu')).toBeVisible();
      await expect(page.getByTestId('cell-menu-contact-no')).toContainText('a接点 (F5)');
      await page.getByTestId('cell-menu-hline').click();
      await expect(page.getByTestId('cell-menu')).toHaveCount(0);

      // 応用命令欄（F8）は扱えない命令を日本語で断る（設計 §5.2）
      await page.getByTestId(`cell-n1:0:${String(COIL_COL)}`).click();
      await key(page, 'F8');
      await page.getByTestId('direct-text').fill('MOV');
      await page.getByTestId('device-commit').click();
      await expect(page.getByTestId('device-error')).toHaveText(
        'このアプリでは扱えない命令です（扱えるのは SET / RST / MC / MCR / T / C）',
      );
      await page.getByTestId('direct-text').fill('SET Y0');
      await page.getByTestId('direct-text').press('Enter');
      await expect(page.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toContainText('SET Y0');
    });
  });
});
