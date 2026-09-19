import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLC_UNIT_JW300, PLC_UNIT_PC10G } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, toSocketRoles, type PlcProblem } from '@ojt/content';
import { COIL_COL } from '@ojt/ladder-core';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { plcTerminalPointFor, type CanvasBox } from './projection.js';

/**
 * 4メーカーのE2E（§16 Phase 4 受入基準①〜⑥）。
 * `plc.spec.ts`（Phase 3 の4本）は触らない（決定表#22）。文言は `src/renderer/i18n/ja.ts` と
 * 同じものを書き写している（E2E は成果物を外から触る）。
 *
 * **設定は `userData` に残る**ので、どのテストも最後に既定メーカーを三菱へ戻す（決定表#21）。
 * 戻さないと次に走る `plc.spec.ts`（FX5U 前提）が丸ごと落ちる。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');
const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
/** 他の E2E と同じ窓の大きさ（スクリーンショットを揃える）。 */
const WINDOW = { width: 1440, height: 900 } as const;

const PROBLEM: PlcProblem = (() => {
  const found = BUILTIN_PLC_PROBLEMS[0];
  if (found === undefined) throw new Error('内蔵モードD課題がありません');
  return found;
})();

/** 課題の役割割当（3Dの物理端子へ直すのに使う）。 */
const ROLES = toSocketRoles(PROBLEM.board.socketRoles);

async function shot(app: ElectronApplication, page: Page, name: string): Promise<void> {
  /*
   * 画面を切り替えた直後に撮ると、コンポジタにはまだ**前の画面のフレーム**しか届いておらず
   * `capturePage()` がそれを返す（スキンのはずの画像に課題一覧が写る）。3Dは
   * `frameloop="demand"` なので初回の描画もひと呼吸遅れて届く（盤が真っ黒のまま写る）。
   * 2フレーム描かせてから、`showBoardOnly()` と同じだけ待って撮る。
   */
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  await page.waitForTimeout(900);
  // 3D を出している画面では、盤の1フレーム目が届くまで待つ（SwiftShader は遅い）
  if ((await page.locator('[data-testid="viewport"] canvas').count()) > 0) {
    await page.waitForTimeout(2500);
  }
  mkdirSync(SHOT_DIR, { recursive: true });
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(base64, 'base64'));
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    window.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
    window.show();
    window.focus();
  }, WINDOW);
  // 表示直後はコンポジタがまだフレームを出しておらず `capturePage()` が失敗することがある
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('mode-plc')).toBeVisible({ timeout: 30_000 });
  // 前回の実行が残した一時保存があると復元プロンプトが出るので、先に片付ける（§12.3）
  const restore = page.getByTestId('restore-prompt');
  if ((await restore.count()) > 0) {
    await page.getByRole('button', { name: '復元しない' }).click();
  }
  return { app, page };
}

/**
 * どの画面からでもホームへ戻る（`inspect.spec.ts` の `goHome()` と同じ流儀）。
 * 既定メーカーの後始末（決定表#21）は設定画面でしかできないので、**課題を開いたままでも**
 * ホームまで戻れる必要がある。
 */
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
  // ホーム画面の設定ボタン（`screens/Home.tsx` L101。`polish.spec.ts` L68 と同じ名前）
  await page.getByTestId('open-settings').click();
  const select = page.getByTestId('setting-vendor');
  await expect(select).toBeVisible();
  /*
   * 保存が**サーバ側で終わった**ことを「設定を保存しました」1件で見る（`Settings.tsx` の
   * `patch()` は `setSettings` の応答が返ってから `applyLadderSettings()` → トーストの順に動く。
   * 課題を開くときの機種はこの `applyLadderSettings()` が入れた値を使う）。
   *
   * トーストは4秒で消える積み重ね式（`store.ts` の `TOAST_TTL_MS`）なので、**先に前の保存
   * トーストが消えるのを待ってから**選び、1件出たことで確かめる（残っていると
   * `filter()` が複数に当たって strict mode 違反になる）。既にそのメーカーなら `change`
   * イベントが出ずトーストも出ないので、選び直さない。
   */
  if ((await select.inputValue()) !== vendor) {
    const saved = page.getByTestId('toast').filter({ hasText: '設定を保存しました' });
    await expect(saved).toHaveCount(0);
    await select.selectOption(vendor);
    await expect(saved).toHaveCount(1);
  }
  await expect(select).toHaveValue(vendor);
  // 設定画面の戻るボタンは `JA.problemList.back`（`screens/Settings.tsx` L150）
  await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
  await expect(page.getByTestId('mode-plc')).toBeVisible();
}

/** ホーム → PLC → 課題を開く。 */
async function openPlcProblem(page: Page): Promise<void> {
  await page.getByTestId('mode-plc').click();
  await expect(page.getByTestId('problem-table')).toBeVisible();
  await page.getByTestId(`open-${PROBLEM.id}`).click();
  await expect(page.getByTestId('plc-session')).toBeVisible();
}

/** 3D盤だけを大きく出す（端子の当たり判定が 4mm しかないので画角を稼ぐ）。決定表#10 */
async function showBoardOnly(page: Page): Promise<CanvasBox> {
  await page.getByTestId('view-board').click();
  await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'board');
  await page.waitForTimeout(900);
  await expect(page.getByTestId('viewport')).toBeVisible();
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toHaveCount(1, { timeout: 30_000 });
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/**
 * ラックのモジュールの名札（`PlcRack.tsx` L164-176 の `<Html>`）が3Dに出ていること。
 * **3Dビューポートの中だけ**を、**完全一致**で見る（右の `plc-model` にも
 * `JTEKT TOYOPUC PC10G-1SP（基本ベース＋POWER1＋CPU＋IN-12＋OUT-12）` のように型式が
 * 部分文字列として出るので、部分一致だと名札が描かれていなくても通ってしまう）。
 */
async function expectRackModules(page: Page, models: readonly string[]): Promise<void> {
  const viewport = page.locator('[data-testid="viewport"]');
  for (const model of models) {
    await expect(viewport.getByText(model, { exact: true }).first()).toBeVisible();
  }
}

/** ラダーエディタにキーを送る（`press()` は要素にフォーカスしてから押す）。 */
async function key(page: Page, name: string): Promise<void> {
  await page.getByTestId('ladder-editor').press(name);
}

/** デバイス入力欄に入れて確定する。 */
async function commitDevice(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId('device-input')).toBeVisible();
  await page.getByTestId('device-text').fill(text);
  await page.getByTestId('device-commit').click();
  await expect(page.getByTestId('device-input')).toHaveCount(0);
}

/** いちばん小さいラダー（接点1つ＋コイル1つ）をこのメーカーの綴りで組む。 */
async function buildMinimalLadder(page: Page, contact: string, coil: string): Promise<void> {
  // 3Dを触ったあとでも同じところから組めるよう、カーソルを先頭セルへ戻しておく
  await page.getByTestId('cell-n1:0:0').click();
  await key(page, 'F5');
  await commitDevice(page, contact);
  await page.getByTestId(`cell-n1:0:${String(COIL_COL)}`).click();
  await key(page, 'F7');
  await commitDevice(page, coil);
}

/**
 * そのメーカーで開いてから、片付けまでを1本で回す（設定を必ず戻す。決定表#21）。
 * 後始末は**どの画面で落ちても**効くように `goHome()` を通してから設定画面へ入る。
 */
async function withVendor(
  vendor: string,
  body: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const { app, page } = await launch();
  try {
    await setVendor(page, vendor);
    await body(page, app);
  } finally {
    try {
      if (!page.isClosed() && vendor !== 'mitsubishi') await setVendor(page, 'mitsubishi');
    } finally {
      await app.close();
    }
  }
}

test.describe('Phase 4 受入基準（4メーカー）', () => {
  test('① OMRON を選ぶと CX-Programmer風で開き「変換」ボタンが出ない', async () => {
    await withVendor('omron', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'omron');
      await expect(page.getByTestId('skin-title')).toContainText('CX-Programmer 風');
      await expect(page.getByTestId('toolbar-convert')).toHaveCount(0);
      await expect(page.getByTestId('toolbar-download')).toContainText('転送［PC → PLC］');
      /*
       * 手順表からも「変換」の段が落ちている（決定表#3）。**段そのものが無いこと**で見る。
       * UX 改善（2026-09-19）で「『変換』の操作はありません（編集すると自動で変換されます）」
       * という注記が `plc-guide` の中に入ったので、「`plc-guide` に『変換』の字が出ない」では
       * もう確かめられない（その注記自身が「変換」を含む）。
       */
      await expect(page.getByTestId('plc-step-convert')).toHaveCount(0);
      await expect(page.getByTestId('plc-auto-convert')).toContainText(
        '「変換」の操作はありません（編集すると自動で変換されます）',
      );
      // 機種も CP1E になっている（決定表#9）
      await expect(page.getByTestId('plc-model')).toContainText('CP1E');
      await shot(app, page, '41-omron-skin');
    });
  });

  test('② 三菱のラダーを OMRON 表記へ切り替えると 0.00 形式になる', async () => {
    await withVendor('mitsubishi', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'mitsubishi');
      await expect(page.getByTestId('skin-title')).toContainText('MELSOFT GX Works3 風');
      await shot(app, page, '40-mitsubishi-skin');
      // X10（＝ IRの X(8)）と Y1 を置く
      await buildMinimalLadder(page, 'X10', 'Y1');
      await expect(page.getByTestId('cell-n1:0:0')).toContainText('X10');
      // 表記切替
      await page.getByTestId('toolbar-notation').click();
      await page.getByTestId('notation-to-omron').click();
      await expect(page.getByTestId('notation-change-0')).toContainText('0.08');
      await expect(page.getByTestId('notation-warning')).toContainText('配線');
      await shot(app, page, '46-notation-dialog');
      await page.getByTestId('notation-apply').click();
      // グリッドの表示が OMRON 表記になる（受入基準②）
      await expect(page.getByTestId('cell-n1:0:0')).toContainText('0.08');
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'omron');
      await expect(page.getByTestId('skin-title')).toContainText('CX-Programmer 風');
    });
  });

  test('③ TOYOPUC のラックが3Dに出て ICOM0 へ配線でき、同番号はエラーになる', async () => {
    await withVendor('jtekt', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'jtekt');
      await expect(page.getByTestId('skin-title')).toContainText('PCwin 風');
      await expect(page.getByTestId('plc-model')).toContainText('PC10G-1SP');
      await shot(app, page, '42-jtekt-skin');
      // 3D: ラックの `IN-12` のCOM端子（`PLC.ICOM0`）へ盤の P1 から1本張る
      const box = await showBoardOnly(page);
      const from = plcTerminalPointFor(PLC_UNIT_PC10G, ROLES, 'P.1', box);
      const to = plcTerminalPointFor(PLC_UNIT_PC10G, ROLES, 'PLC.ICOM0', box);
      await page.mouse.click(from.x, from.y);
      await page.mouse.click(to.x, to.y);
      await expect(page.getByTestId('operation-log')).toContainText('PLC.ICOM0');
      // ラックのモジュール4枚の名札がDOMに出ている（`PlcRack` の `<Html>`。受入基準③）
      await expectRackModules(page, ['POWER1', 'PC10G-1SP', 'IN-12', 'OUT-12']);
      await shot(app, page, '44-jtekt-rack');
      // 同番号（`1X010` と `1Y010`）を使うとバリデータがエラーを出す（4A 決定表#16）
      await page.getByTestId('view-ladder').click();
      await buildMinimalLadder(page, '1X010', '1Y010');
      // PCwin風は自動変換（決定表#3）なので、押さずに出力ウィンドウへ出る
      const output = page.getByTestId('output-window');
      await expect(output).toContainText('機種エラー');
      await expect(output).toContainText(
        '1X010 と 1Y010 は同じアドレスです（この機種では併用できません）',
      );
    });
  });

  test('④ シャープでリレー番号に 8 を入れると8進エラーになる', async () => {
    await withVendor('sharp', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'sharp');
      await expect(page.getByTestId('skin-title')).toContainText('JW-300SP 風');
      await key(page, 'F5');
      await expect(page.getByTestId('device-text')).toHaveAttribute('placeholder', '000000');
      await page.getByTestId('device-text').fill('000008');
      await page.getByTestId('device-commit').click();
      await expect(page.getByTestId('device-error')).toContainText('8進');
      // 入力欄は開いたまま（確定していない）
      await expect(page.getByTestId('device-input')).toBeVisible();
      await shot(app, page, '43-sharp-skin');
      // 開いたままのダイアログを畳んでから後始末へ入る
      await page.getByTestId('device-cancel').click();
      await expect(page.getByTestId('device-input')).toHaveCount(0);
    });
  });

  test('⑤ JW300 のラックが3Dに出て COM.A へ配線できる', async () => {
    await withVendor('sharp', async (page, app) => {
      await openPlcProblem(page);
      // `PLC_UNIT_JW300.displayName` は「シャープ JW300（…）」（機種コードの `JW-300` とは綴りが違う）
      await expect(page.getByTestId('plc-model')).toContainText('JW300');
      const box = await showBoardOnly(page);
      const from = plcTerminalPointFor(PLC_UNIT_JW300, ROLES, 'P.1', box);
      const to = plcTerminalPointFor(PLC_UNIT_JW300, ROLES, 'PLC.COM.A', box);
      await page.mouse.click(from.x, from.y);
      await page.mouse.click(to.x, to.y);
      // 端子名が `COM` に切れていないこと（4A H-8）
      await expect(page.getByTestId('operation-log')).toContainText('PLC.COM.A');
      // ラックのモジュール4枚の名札がDOMに出ている（受入基準⑤）
      await expectRackModules(page, ['JW-301PU', 'JW-312CU', 'JW-212NA', 'JW-214SA']);
      await shot(app, page, '45-sharp-rack');
    });
  });

  test('⑥ 命令語リストが方言どおりの命令名でテキストに出る', async () => {
    const target = join(tmpdir(), `ojt-il-${String(Date.now())}.txt`);
    await withVendor('sharp', async (page, app) => {
      // 保存ダイアログを固定パスへ差し替える（`inspect.spec.ts` L189 と同じ手法）
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      }, target);
      await openPlcProblem(page);
      await buildMinimalLadder(page, '000000', '000020');
      await page.getByTestId('export-il').click();
      await expect(
        page.getByTestId('toast').filter({ hasText: '命令語リストを保存しました' }),
      ).toBeVisible();
      await shot(app, page, '47-instruction-list');
      const text = readFileSync(target, 'utf8');
      // シャープの命令名（§10.5 / 4A Task 4）で、CRLF 終端の UTF-8
      expect(text).toContain('STR');
      expect(text).toContain('OUT');
      expect(text.endsWith('\r\n')).toBe(true);
      expect(text).not.toContain('LD ');
      rmSync(target, { force: true });

      /*
       * 受入基準⑥の後半: 変換できない回路（左母線につながっていない出力）のときは
       * **保存せず理由を出す**。0列目の接点だけを消すと、横線はコイル列まで残ったまま
       * 左母線との繋がりだけが切れる（`coil-unconnected`）。
       */
      await page.getByTestId('cell-n1:0:0').click();
      await key(page, 'Delete');
      await page.getByTestId('export-il').click();
      await expect(page.getByTestId('il-issues')).toContainText('左母線');
      // 回路ブロックの内部ID（`n1`）は画面に出さない
      await expect(page.getByTestId('il-issues')).not.toContainText('n1');
      expect(existsSync(target)).toBe(false);
    });
  });

  test('どのスキンでも 1280×800 と 1920×1080 ではみ出さない（利用者要求: 画面の品質）', async () => {
    for (const vendor of ['mitsubishi', 'omron', 'jtekt', 'sharp']) {
      await withVendor(vendor, async (page, app) => {
        await openPlcProblem(page);
        for (const size of [
          { width: 1280, height: 800 },
          { width: 1920, height: 1080 },
        ]) {
          await app.evaluate(({ BrowserWindow }, bounds) => {
            BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
          }, size);
          await page.waitForTimeout(400);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `${vendor} ${size.width}x${size.height}`).toBeLessThanOrEqual(0);
          // ツールバーの項目が全部読める(文字が切れていない)
          const clipped = await page.evaluate(
            () =>
              [...document.querySelectorAll('[data-testid^="toolbar-"]')].filter(
                (el) => el.scrollWidth > el.clientWidth + 1,
              ).length,
          );
          expect(clipped, `${vendor} のツールバーの文字が切れている`).toBe(0);
        }
      });
    }
  });
});
