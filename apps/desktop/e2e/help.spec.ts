import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { APP_ROOT, launchApp } from './app.js';

/**
 * ヘルプと取扱説明書の E2E。§16 Phase 6 受入基準①②③⑥（Plan 6 Task 11）。
 *
 * **「説明書（PDF）を開く」は押さない**（Plan 6 決定表 P9）。押すと OS の既定の PDF
 * ビューアが本当に起動し、CI でもレビュー中でも閉じられない。ここが確かめるのは
 * 「どの画面のヘルプにもボタンが出ていて押せること」までで、`shell.openPath()` の3分岐
 * （開けた・PDFが無い・OSが拒んだ）は `test/manual-ipc.test.ts` が縛る。同梱 PDF そのもの
 * の実在は配布物の検査（`scripts/check-dist.mjs`／受入基準④）の仕事で、`build` しか
 * していないこのスペックは見ない。
 *
 * **図は見ない**（Task 12 の仕事）。ここで確かめるのは「まだ撮っていない図が壊れた画像の
 * 枠として出ていないこと」（受入基準⑥）だけである。
 *
 * 起動の定型は `e2e/app.ts` の `launchApp()` に1か所だけ置いてある（QA-12 / QA-13）。
 * `goHome()` / `setVendor()` は `plc-vendors.spec.ts` / `schematic.spec.ts` と同じ流儀。画面の文言も `src/renderer/i18n/ja.ts` と
 * `src/renderer/help/manual-content.ts` からの**書き写し**で、E2E は成果物を外から触るだけに
 * する（`inspect.spec.ts` 冒頭の注記と同じ流儀）。
 */

/** 他の E2E と同じ窓の大きさ。 */
const WINDOW = { width: 1440, height: 900 } as const;

/**
 * 正本から章の並びを拾い、ビルド済みの画面と照合する。
 * 章の追加時に、手書きの期待値だけ古いまま残ることを防ぐ。
 */
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const CHAPTER_TITLES = readdirSync(MANUAL_DIR)
  .filter((name) => /^\d{2}-.+\.md$/u.test(name))
  .sort()
  .map((name) => readFileSync(resolve(MANUAL_DIR, name), 'utf8').split(/\r?\n/u)[0]!.slice(2));

/** 画面 → 最初に出る節の見出し（`help/help-model.ts` の `HELP_SECTION_BY_SCREEN`）。 */
const HOME_SECTION = 'このアプリでできること';
const LIST_SECTION = '課題をえらぶ';
const SETTINGS_SECTION = '設定の画面';
const ASSEMBLE_SECTION = '回路を組み立てる';
const SCHEMATIC_SECTION = '回路図を描く';
const C1_SECTION = '部品を点検する';
const C2_SECTION = '回路を点検して直す';
const PLC_SECTION = 'PLCの課題を進める';
const RESULT_SECTION = '結果の画面';

let app: ElectronApplication;
let page: Page;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function boxOf(testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`${testId} の矩形を取得できませんでした`);
  return box;
}

/** 窓の大きさを変える（Playwright の `setViewportSize()` は Electron では使えない）。 */
async function setWindow(width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      window.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
    },
    { width, height },
  );
  // 折り返しの計算が終わるまで待つ（`@media` の切り替えも含む）
  await page.waitForTimeout(600);
}

/** いま焦点がある要素の目印（焦点が戻ったことを確かめるのに使う）。 */
async function activeTestId(): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

/**
 * まだ撮っていない図が「壊れた画像の枠」として出ていないこと（受入基準⑥）。
 * `src` を入れなかった図は `figure` ごと畳まれ、押せるボタンも残らない。
 * 撮ってある図（Task 12 以降）は、読み込みに成功していることまで見る。
 */
async function figureProblems(): Promise<string[]> {
  return page.evaluate(async () => {
    const problems: string[] = [];
    const root = document.querySelector('[data-testid="help-prose"]');
    if (root === null) return ['本文（help-prose）がありません'];
    /*
     * 本文の図は `loading="lazy"`（決定表 P17）なので、節の下のほうにある図は画面に
     * 入るまで読み込まれない。まず全部を画面へ送り、読み込みが終わるのを（上限つきで）待つ。
     * `decode()` で待つと、画面外の遅延読み込みの図では**解決しないまま止まる**ことがある。
     */
    const shown = [...root.querySelectorAll<HTMLImageElement>('img[data-manual-image]')];
    for (const image of shown) image.scrollIntoView({ block: 'center' });
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      shown.some((image) => (image.getAttribute('src') ?? '') !== '' && !image.complete)
    ) {
      await new Promise((done) => {
        setTimeout(done, 50);
      });
    }
    for (const image of root.querySelectorAll('img[data-manual-image]')) {
      const name = (image as HTMLImageElement).dataset['manualImage'] ?? '(名前なし)';
      const source = image.getAttribute('src') ?? '';
      const figure = image.closest('figure');
      const hidden = figure instanceof HTMLElement && figure.hidden;
      if (source === '') {
        if (!hidden) problems.push(`${name}: 図が無いのに枠が出ています`);
      } else {
        if (hidden) problems.push(`${name}: 図があるのに枠が畳まれています`);
        const img = image as HTMLImageElement;
        if (!img.complete || img.naturalWidth === 0) problems.push(`${name}: 図を読み込めません`);
      }
    }
    for (const button of root.querySelectorAll('button[data-manual-image]')) {
      const name = (button as HTMLButtonElement).dataset['manualImage'] ?? '(名前なし)';
      const image = button.querySelector('img');
      const source = image?.getAttribute('src') ?? '';
      const disabled = (button as HTMLButtonElement).disabled;
      if (source === '' && !disabled) problems.push(`${name}: 図が無いのにボタンが押せます`);
      if (source !== '' && disabled) problems.push(`${name}: 図があるのにボタンが押せません`);
    }
    return problems;
  });
}

/**
 * 受入基準①をこの画面で確かめる。
 * `F1` でも「ヘルプ」ボタンでも同じ節が開き、`Esc` で閉じて**押した人のところへ焦点が戻る**。
 * ついでに受入基準③の「どの画面のヘルプにも PDF のボタンがある」と、受入基準⑥の
 * 「壊れた図の枠が出ない」も毎回見る（押さない・撮らない）。
 */
async function expectHelpOpensHere(sectionTitle: string): Promise<void> {
  const opener = page.getByTestId('open-help');
  const drawer = page.getByTestId('help-drawer');
  const title = page.getByTestId('help-section-title');
  await expect(opener).toBeVisible();
  // 9画面すべてで同じ言葉（部品は `HelpButton` 1つだけ）
  await expect(opener).toHaveText('ヘルプ');

  // ① F1 で開く
  await opener.focus();
  await page.keyboard.press('F1');
  await expect(drawer).toBeVisible();
  await expect(title).toHaveText(sectionTitle);
  // 開いた直後の焦点は引き出しの「閉じる」（読み始める場所が毎回同じになる）
  await expect(page.getByTestId('help-close')).toBeFocused();
  // ③ 「説明書（PDF）を開く」はどの画面のヘルプにもあって押せる（**押さない**）
  await expect(page.getByTestId('help-open-pdf')).toBeEnabled();
  await expect(page.getByTestId('help-open-pdf')).toHaveText('説明書（PDF）を開く');
  // ⑥ まだ撮っていない図は枠ごと出ない
  expect(await figureProblems()).toEqual([]);
  // ① もう一度 `F1` で閉じて、開くのに使ったところへ焦点が戻る
  await page.keyboard.press('F1');
  await expect(drawer).toBeHidden();
  expect(await activeTestId()).toBe('open-help');

  // ① 「ヘルプ」ボタンでも同じ節が開き、`Esc` で閉じる
  await opener.click();
  await expect(drawer).toBeVisible();
  await expect(title).toHaveText(sectionTitle);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  expect(await activeTestId()).toBe('open-help');
}

/**
 * もくじから節へ跳ぶ。
 * 章は**いまの節が入っている章だけ**が開いているので（`HelpDrawer` の `<details open>`）、
 * 畳んである章はまず見出しを押して開く。`chapterIndex` は `CHAPTER_TITLES` の位置。
 */
async function showSection(chapterIndex: number, sectionId: string): Promise<void> {
  const button = page.getByTestId(`help-section-${sectionId}`);
  if (!(await button.isVisible())) {
    await page
      .locator('[data-testid="help-contents"] details details > summary')
      .nth(chapterIndex)
      .click();
  }
  await expect(button).toBeVisible();
  await button.click();
}

/** どの画面からでもホームへ戻る（`plc-vendors.spec.ts` の `goHome()` と同じ流儀）。 */
async function goHome(): Promise<void> {
  const home = page.getByTestId('mode-plc');
  if ((await home.count()) > 0) {
    await expect(home).toBeVisible();
    return;
  }
  const toList = page.getByRole('button', { name: '課題一覧へ', exact: true });
  if ((await toList.count()) > 0) await toList.first().click();
  const sessionBack = page.getByTestId('session-back');
  if ((await sessionBack.count()) > 0) await sessionBack.click();
  const listBack = page.getByRole('button', { name: 'ホームへ戻る', exact: true });
  if ((await listBack.count()) > 0) await listBack.click();
  await expect(home).toBeVisible();
}

/** ホーム → そのモードの一覧 → 課題を開く。 */
async function openProblem(modeKey: string, problemId: string): Promise<void> {
  await goHome();
  await page.getByTestId(`mode-${modeKey}`).click();
  await expect(page.getByTestId('problem-table')).toBeVisible();
  await page.getByTestId(`open-${problemId}`).click();
}

/**
 * 設定画面で既定メーカーを選ぶ（＝利用者と同じ道筋。Phase 4 決定表#21）。
 * **設定は `userData` に残る**ので、呼んだ側は必ず三菱へ戻す。
 */
async function setVendor(vendor: string): Promise<void> {
  await goHome();
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

test.beforeAll(async () => {
  ({ app, page } = await launchApp({ window: WINDOW }));
});

test.afterAll(async () => {
  await app.close();
});

test.describe('ヘルプ（§16 Phase 6 受入基準①②③⑥）', () => {
  test('受入基準①: ホーム・課題一覧・設定で F1 がその画面の節を開く', async () => {
    await goHome();
    await expectHelpOpensHere(HOME_SECTION);

    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('setting-user-dir')).toBeVisible();
    await expectHelpOpensHere(SETTINGS_SECTION);
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();

    await page.getByTestId('mode-assemble').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await expectHelpOpensHere(LIST_SECTION);
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await expect(page.getByTestId('mode-plc')).toBeVisible();
  });

  test('受入基準①: モードB・回路図・結果で F1 がその画面の節を開く', async () => {
    await openProblem('assemble', 'b-001');
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expectHelpOpensHere(ASSEMBLE_SECTION);

    // 同じ画面でも回路図に切り替えると「回路図を描く」が出る（`currentHelpScreen()`）
    await page.getByTestId('assemble-view-schematic').click();
    await expect(page.getByTestId('assemble-view-schematic')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectHelpOpensHere(SCHEMATIC_SECTION);
    await page.getByTestId('assemble-view-board').click();

    // 判定すると結果画面へ進む（合否は問わない）
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
    await expectHelpOpensHere(RESULT_SECTION);
    await goHome();
  });

  test('受入基準①: モードC1・C2で F1 がその画面の節を開く', async () => {
    await openProblem('inspect-parts', 'c1-001');
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expectHelpOpensHere(C1_SECTION);
    await goHome();

    await openProblem('inspect-repair', 'c2-001');
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expectHelpOpensHere(C2_SECTION);
    await goHome();
  });

  test('受入基準①: モードDは4メーカーとも F1 でヘルプが開き、トーストは出ない', async () => {
    try {
      for (const vendor of ['mitsubishi', 'jtekt', 'omron', 'sharp']) {
        await setVendor(vendor);
        await openProblem('plc', 'd-001');
        await expect(page.getByTestId('plc-session')).toBeVisible();
        // 上の帯の「ヘルプ」と窓口（`HelpRoot`）の `F1`
        await expectHelpOpensHere(PLC_SECTION);

        /*
         * ラダー編集の上で押した `F1`。三菱・JTEKT・シャープはスキンのキー割当表が
         * `help` を持っているのでそちらが開き（`LadderEditor` の `openHelp('plc')`）、
         * OMRON は表に `help` が無いので窓口の `F1` が開く（Plan 6 決定表#16）。
         * どちらの道でも同じ引き出しが同じ節で開き、**トーストは出ない**。
         */
        const editor = page.getByTestId('ladder-editor');
        await editor.press('F1');
        await expect(page.getByTestId('help-drawer')).toBeVisible();
        await expect(page.getByTestId('help-section-title')).toHaveText(PLC_SECTION);
        await expect(page.getByTestId('toast')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('help-drawer')).toBeHidden();
        expect(await activeTestId()).toBe('ladder-editor');
        await goHome();
      }
    } finally {
      // 設定は `userData` に残る。次に走る spec のために必ず三菱へ戻す（Phase 4 決定表#21）
      if (!page.isClosed()) await setVendor('mitsubishi');
    }
  });

  test('受入基準②: 「自己保持」で探すと該当節へ跳べる', async () => {
    await goHome();
    await page.getByTestId('open-help').click();
    const drawer = page.getByTestId('help-drawer');
    await expect(drawer).toBeVisible();

    await page.getByTestId('help-search').fill('自己保持');
    const hits = page.getByTestId('help-hit');
    await expect(hits.first()).toBeVisible();
    const hitTitle = await hits.first().locator('span').first().innerText();
    await hits.first().click();
    await expect(page.getByTestId('help-section-title')).toHaveText(hitTitle);
    await expect(page.getByTestId('help-prose')).toContainText('自己保持');
    // 節へ跳んだら検索の一覧は畳む（§5.3）
    await expect(page.getByTestId('help-search')).toHaveValue('');
    await expect(hits).toHaveCount(0);

    /*
     * 当たりが上限より多いときは件数のふりをせず「20 件以上」と出す（IM-12）。
     * 「画面」は47節に出て20件の上限に十分な余裕がある（「ボタン」は32節で、原稿が減ると
     * すぐ20を割り込みかねない。レビュー Minor#5）。
     */
    await page.getByTestId('help-search').fill('画面');
    await expect(hits).toHaveCount(20);
    await expect(drawer).toContainText('20 件以上見つかりました');

    // 0件のときの言葉（§9）
    await page.getByTestId('help-search').fill('ぜったいに出てこない言葉');
    await expect(hits).toHaveCount(0);
    await expect(drawer).toContainText('見つかりませんでした。別の言葉で探してください。');

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('受入基準③: もくじに全章が正本の順で出る', async () => {
    await goHome();
    await page.getByTestId('open-help').click();
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    await expect(
      page.locator('[data-testid="help-contents"] details details > summary'),
    ).toHaveText([...CHAPTER_TITLES]);
    // もくじから節へ跳べる（この節は図を載せている節でもある）
    await showSection(2, 'screens/ホームの画面');
    await expect(page.getByTestId('help-section-title')).toHaveText('ホームの画面');

    /*
     * `Tab` は引き出しの中だけを回る（`trapFocus()`）。外へ出ると、後ろの画面の
     * ボタンへ焦点が移って「読んでいるのに裏の盤を触ってしまう」ことになる。
     */
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement && active.closest('[data-testid="help-drawer"]') !== null
        );
      });
      expect(inside, `${String(i + 1)}回目の Tab で焦点が引き出しの外へ出ました`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-drawer')).toBeHidden();
  });

  test('課題索引の全72個のIDが途中で折り返されない', async () => {
    await goHome();
    await setWindow(1280, 800);
    await page.getByTestId('open-help').click();
    await showSection(CHAPTER_TITLES.length - 1, 'tutorial-features/課題の索引');
    const ids = page.locator('[data-manual-table="problem-index"] tbody tr td:first-child');
    await expect(ids).toHaveCount(72);
    const broken = await ids.evaluateAll((cells) =>
      cells.flatMap((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return range.getClientRects().length === 1 ? [] : [cell.textContent];
      }),
    );
    expect(broken).toEqual([]);
    const prose = page.getByTestId('help-prose');
    expect(await prose.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.keyboard.press('Escape');
    await setWindow(WINDOW.width, WINDOW.height);
  });

  test('受入基準③: 引き出しは「判定」を覆わず、横スクロールも出さない', async () => {
    await openProblem('assemble', 'b-001');
    await expect(page.getByTestId('viewport')).toBeVisible();

    try {
      // 1280×800（いちばん狭い想定。設計仕様 §11 の最小幅）
      await setWindow(1280, 800);
      await page.getByTestId('open-help').click();
      await expect(page.getByTestId('help-drawer')).toBeVisible();
      const drawer = await boxOf('help-drawer');
      const judge = await boxOf('judge-button');
      expect(
        intersects(drawer, judge),
        `引き出し ${JSON.stringify(drawer)} が判定ボタン ${JSON.stringify(judge)} に重なっています`,
      ).toBe(false);
      await expect(page.getByTestId('judge-button')).toBeEnabled();

      // 引き出しを開けたまま、3つの大きさで横スクロールが出ないこと
      for (const [width, height] of [
        [1280, 800],
        [1440, 900],
        [1920, 1080],
      ] as const) {
        await setWindow(width, height);
        await expect(page.getByTestId('help-drawer')).toBeVisible();
        const overflow = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
          inner: window.innerWidth,
        }));
        expect(overflow.doc, `${String(width)}px で横にはみ出しています`).toBeLessThanOrEqual(0);
        expect(overflow.body, `${String(width)}px で横にはみ出しています`).toBeLessThanOrEqual(0);
      }
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('help-drawer')).toBeHidden();
    } finally {
      if (await page.getByTestId('help-drawer').isVisible()) await page.keyboard.press('Escape');
      await setWindow(WINDOW.width, WINDOW.height);
      await goHome();
    }
  });

  /*
   * レビュー Minor#7: 「ヘルプ」ボタンの位置はホームだけ右端で、他の4画面は「もどる」の隣に
   * ある。重なりの検査がモードBの「判定」1画面だけだと、ホームや結果の見た目が変わっても
   * 気づけない。矩形の交差を見るだけなので安く、ホームと結果でも見ておく。
   */
  test('受入基準③: ホーム・結果でもヘルプは近くの操作に重ならない（Minor#7）', async () => {
    await goHome();
    const homeHelp = await boxOf('open-help');
    const homeSettings = await boxOf('open-settings');
    expect(
      intersects(homeHelp, homeSettings),
      `ホームでヘルプ ${JSON.stringify(homeHelp)} が「設定」 ${JSON.stringify(homeSettings)} に重なっています`,
    ).toBe(false);

    await openProblem('assemble', 'b-001');
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
    const resultHelp = await boxOf('open-help');
    const resultVerdict = await boxOf('verdict');
    expect(
      intersects(resultHelp, resultVerdict),
      `結果でヘルプ ${JSON.stringify(resultHelp)} が判定結果 ${JSON.stringify(resultVerdict)} に重なっています`,
    ).toBe(false);
    await goHome();
  });

  test('受入基準⑥⑧: 図が本文に出て、押すと原寸が開く。PDFのボタンは押せる', async () => {
    await goHome();
    await page.getByTestId('open-help').click();
    await expect(page.getByTestId('help-drawer')).toBeVisible();

    /*
     * 図を載せている節（`manual-content.ts` の `imageNames` が空でない節）を回る。
     * Task 12 で図を撮ったので、どの節でも**縮小版が読み込めている**ことまで見る
     * （撮る前は枠ごと畳まれていることを見ていた。`figureProblems()` は両方を見分ける）。
     */
    for (const [chapterIndex, sectionId, title] of [
      [2, 'screens/ホームの画面', 'ホームの画面'],
      [2, 'screens/画面の上の帯', '画面の上の帯'],
      [4, 'mode-c1/答えを書き込む', '答えを書き込む'],
      [9, 'settings/設定の画面', '設定の画面'],
    ] as const) {
      await showSection(chapterIndex, sectionId);
      await expect(page.getByTestId('help-section-title')).toHaveText(title);
      expect(await figureProblems(), `${sectionId} の図`).toEqual([]);
      // 図の覆いは開いていない（押せない図を押しても何も出ない）
      await expect(page.getByTestId('help-figure-modal')).toHaveCount(0);
    }

    /*
     * 受入基準⑧: 本文の図（縮小版）を押すと**原寸**が覆いで開き、`Esc` で戻って
     * 押した図へ焦点が返る。Task 12 で図が入るまでは押せるボタンが1つも無かった。
     */
    await showSection(2, 'screens/ホームの画面');
    const figure = page.locator('[data-testid="help-prose"] button[data-manual-image]').first();
    await expect(figure).toBeEnabled();
    const name = await figure.getAttribute('data-manual-image');
    expect(name).not.toBeNull();
    const small = await figure.locator('img').getAttribute('src');
    await figure.click();
    const modal = page.getByTestId('help-figure-modal');
    await expect(modal).toBeVisible();
    const full = page.getByTestId('help-figure-full');
    await expect(full).toBeVisible();
    // 覆いに出るのは**原寸**（本文の縮小版とは別の束ね先）で、読み込めている
    expect(await full.getAttribute('src')).not.toBe(small);
    expect(
      await full.evaluate((image) => {
        const shown = image as HTMLImageElement;
        return shown.complete && shown.naturalWidth > 0;
      }),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-manual-image') ?? null),
    ).toBe(name);

    // 「説明書（PDF）を開く」は出ていて押せる。**押さない**（決定表 P9）
    await expect(page.getByTestId('help-open-pdf')).toBeVisible();
    await expect(page.getByTestId('help-open-pdf')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-drawer')).toBeHidden();
  });
});
