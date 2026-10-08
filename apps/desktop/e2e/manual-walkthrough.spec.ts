import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildInspectRepairCircuit,
  toSocketRoles,
} from '@ojt/content';
import { COIL_COL } from '@ojt/ladder-core';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { launchApp } from './app.js';
import { visibleRoutes } from '../src/renderer/session/wire-routes.js';
import {
  boardPoint,
  roleTerminalPoint,
  SELF_HOLD_WIRES,
  terminalPoint,
  type CanvasBox,
} from './projection.js';

/**
 * 取扱説明書の記述を実画面で確かめる通し点検（v2.0.0 総点検 Task 1）。
 *
 *   pnpm --filter @ojt/desktop build
 *   pnpm --filter @ojt/desktop exec playwright test --project=walkthrough
 *
 * 図を撮る `manual-shots.spec.ts` と違い、ここは**説明書が「こう出る」「こう動く」と書いている
 * こと**を1件ずつ実画面で観測し、`OJT/release/verification/v<version>/manual-walkthrough.json`
 * と同名の `.md` に「記述 → 観測 → 一致／不一致」を残す。不一致はテストの失敗にしない
 * （記録を読んで、画面か説明書のどちらを直すかを決める）。観測の手順そのものが壊れたときは
 * `observed` に例外文を残して次へ進む。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OJT_ROOT = dirname(
  execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
  }).trim(),
);
const VERSION = (
  JSON.parse(
    execFileSync('node', ['-e', 'process.stdout.write(JSON.stringify(require("./package.json")))'], {
      cwd: APP_ROOT,
      encoding: 'utf8',
    }),
  ) as { version: string }
).version;
const OUT_DIR = process.env['OJT_WALKTHROUGH_OUT'] ?? join(OJT_ROOT, 'release', 'verification', `v${VERSION}`);

interface Observation {
  id: string;
  where: string;
  says: string;
  observed: string;
  ok: boolean | 'skip';
}

const RESULTS: Observation[] = [];
let app: ElectronApplication;
let page: Page;
let userDataDir: string;

/** 1件の記述を確かめる。`run` は観測した文字列と一致したかを返す。例外は記録して先へ進む。 */
async function claim(
  id: string,
  where: string,
  says: string,
  run: () => Promise<{ observed: string; ok: boolean | 'skip' }>,
): Promise<void> {
  try {
    const result = await run();
    RESULTS.push({ id, where, says, ...result });
  } catch (error) {
    RESULTS.push({
      id,
      where,
      says,
      observed: `手順が通らない: ${error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error)}`,
      ok: false,
    });
  }
}

/** 要素の文字（無ければ空）。 */
async function textOf(locator: Locator): Promise<string> {
  if ((await locator.count()) === 0) return '';
  return ((await locator.first().textContent()) ?? '').replace(/\s+/gu, ' ').trim();
}

/** 期待する語がすべて含まれるか。 */
function includesAll(text: string, words: readonly string[]): boolean {
  return words.every((word) => text.includes(word));
}

/** 語の存在で判定する定型。 */
async function expectText(
  id: string,
  where: string,
  says: string,
  locator: Locator,
  words: readonly string[],
): Promise<void> {
  await claim(id, where, says, async () => {
    await locator.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    const observed = await textOf(locator);
    return { observed, ok: includesAll(observed, words) };
  });
}

async function goHome(): Promise<void> {
  const home = page.getByTestId('mode-assemble');
  if ((await home.count()) > 0) return;
  for (const name of ['session-back']) {
    const button = page.getByTestId(name);
    if ((await button.count()) > 0) {
      await button.click();
      break;
    }
  }
  const toList = page.getByRole('button', { name: '課題一覧へ', exact: true });
  if ((await home.count()) === 0 && (await toList.count()) > 0) await toList.first().click();
  const homeButton = page.getByRole('button', { name: 'ホームへ戻る', exact: true });
  if ((await home.count()) === 0 && (await homeButton.count()) > 0) await homeButton.first().click();
  await expect(home).toBeVisible({ timeout: 20_000 });
}

async function confirmChange(): Promise<void> {
  const change = page.getByTestId('problem-change-confirm');
  await expect(change.or(page.getByTestId('session-back'))).toBeVisible({ timeout: 60_000 });
  if (await change.isVisible())
    await change.getByRole('button', { name: '保存せず進む', exact: true }).click();
  await expect(page.getByTestId('session-back')).toBeVisible({ timeout: 60_000 });
}

async function openProblem(modeTestId: string, problemId: string): Promise<void> {
  await goHome();
  await page.getByTestId(modeTestId).click();
  await expect(page.getByTestId('problem-table')).toBeVisible();
  await page.getByTestId('grade-filter').getByRole('button', { name: 'すべて', exact: true }).click();
  await page.getByTestId(`open-${problemId}`).click();
  await confirmChange();
}

async function waitForBoard(): Promise<CanvasBox> {
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), { timeout: 30_000 })
    .toBe(1);
  await page.waitForTimeout(1500);
  const box = await page.locator('[data-testid="viewport"] canvas').boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

async function powerOn(): Promise<void> {
  const breaker = page.getByTestId('power-breaker');
  if ((await breaker.getAttribute('aria-pressed')) !== 'true') await breaker.click();
  const supply = page.getByTestId('power-switch');
  if ((await supply.getAttribute('aria-pressed')) !== 'true') await supply.click();
  await expect(page.getByTestId('status-overlay')).toContainText('通電中');
}

async function powerOff(): Promise<void> {
  const supply = page.getByTestId('power-switch');
  if ((await supply.getAttribute('aria-pressed')) === 'true') await supply.click();
  const breaker = page.getByTestId('power-breaker');
  if ((await breaker.getAttribute('aria-pressed')) === 'true') await breaker.click();
}

async function openPanel(testId: string): Promise<void> {
  if ((await page.getByTestId(`${testId}-details`).getAttribute('open')) === null)
    await page.getByTestId(`${testId}-summary`).click();
}

async function ladderKey(name: string): Promise<void> {
  await page.getByTestId('ladder-editor').press(name);
}

async function commitDevice(text: string): Promise<void> {
  await expect(page.getByTestId('device-input')).toBeVisible();
  await page.getByTestId('device-text').fill(text);
  await page.getByTestId('device-commit').click();
  await expect(page.getByTestId('device-input')).toHaveCount(0);
}

async function moveToCoil(networkId: string, fromCol: number): Promise<void> {
  const coil = page.getByTestId(`cell-${networkId}:0:${String(COIL_COL)}`);
  for (let step = fromCol; step < COIL_COL; step += 1) {
    if ((await coil.getAttribute('aria-selected')) === 'true') break;
    await ladderKey('ArrowRight');
  }
}

function socketBodyPoint(socketId = 'S1'): { x: number; y: number; z: number } {
  const socket = JIPM_BOARD.sockets.find((s) => s.id === socketId);
  if (socket === undefined) throw new Error(`ソケットがありません: ${socketId}`);
  return {
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: 9,
  };
}

/** 記録を書き出す（JSON と Markdown）。 */
function writeRecord(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'manual-walkthrough.json'),
    `${JSON.stringify({ checkedAt: new Date().toISOString(), version: VERSION, results: RESULTS }, null, 2)}\n`,
    'utf8',
  );
  const mark = (ok: Observation['ok']): string => (ok === 'skip' ? '対象外' : ok ? '一致' : '**不一致**');
  const rows = RESULTS.map(
    (r) =>
      `| ${r.id} | ${r.where} | ${r.says.replace(/\|/gu, '｜')} | ${r.observed.replace(/\|/gu, '｜').slice(0, 220)} | ${mark(r.ok)} |`,
  );
  const bad = RESULTS.filter((r) => r.ok === false).length;
  const skipped = RESULTS.filter((r) => r.ok === 'skip').length;
  const md = [
    `# 説明書と実画面の通し点検（v${VERSION}）`,
    '',
    `点検日時: ${new Date().toISOString()} ／ 記述 ${String(RESULTS.length)} 件 ／ 不一致 ${String(bad)} 件 ／ 対象外 ${String(skipped)} 件`,
    '',
    '実画面を自動操作して、説明書の記述（章・節）ごとに観測した文字や状態を並べた。「不一致」は画面か説明書のどちらかを直す。',
    '',
    '| ID | 章・節 | 説明書の記述 | 実画面の観測 | 判定 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'manual-walkthrough.md'), md, 'utf8');
}

test.describe.serial('説明書の通し点検', () => {
  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), '電気教育ツール-通し点検-'));
    ({ app, page } = await launchApp({ contentSize: { width: 1440, height: 900 }, userDataDir }));
    page.on('pageerror', (error) => {
      RESULTS.push({
        id: 'pageerror',
        where: '全体',
        says: '画面エラーが出ない',
        observed: error.message,
        ok: false,
      });
    });
  });

  test.afterAll(async () => {
    writeRecord();
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('00 はじめに／02 ホーム・一覧・ヘルプ', async () => {
    await expectText('02-home-cards', '02 ホームの画面', '中央に6つの大きなカード（回路組立・部品点検・回路点検・修復・PLC・回路実験・PLC実験）', page.locator('[data-testid^="mode-"]:not([data-testid="mode-filter"])'), []);
    await claim('02-home-6', '02 ホームの画面', '6枚のカード', async () => {
      const n = await page.locator('[data-testid^="mode-"]:not([data-testid="mode-filter"])').count();
      return { observed: `${String(n)} 枚`, ok: n === 6 };
    });
    await expectText('02-home-start', '02 ホームの画面', '左は「初めての方はここから」で「3級の回路組立を開く」', page.getByTestId('start-here'), ['初めての方はここから', '3級の回路組立を開く']);
    await expectText('02-home-continue', '02 ホームの画面', '前回の続きが無いときは「前回の続きはありません。上のモードから課題を選んでください。」', page.getByTestId('continue-card'), ['前回の続きはありません。上のモードから課題を選んでください。']);
    await expectText('02-home-help', '02 ホームの画面', '右上に「ヘルプ」ボタン', page.getByTestId('open-help'), ['ヘルプ']);
    await expectText('02-home-settings', '02 ホームの画面', '右上の「設定」', page.getByTestId('open-settings'), ['設定']);
    await expectText('02-home-tutorials', '02 動画で操作を学ぶ', 'ホームの「動画で操作を学ぶ」。回路組立・部品点検・回路点検・修復・PLC・回路実験・PLC実験', page.getByRole('heading', { name: '動画で操作を学ぶ' }).locator('xpath=..'), ['回路組立', '部品点検', '回路点検・修復', 'PLC', '回路実験', 'PLC実験']);

    // ヘルプ: F1 で開閉、言葉で探す、件数、見つからない文言、PDF、閉じる
    await claim('02-help-f1', '02 画面の上の帯', 'F1 を押すと開き、もう一度押すと閉じる', async () => {
      await page.keyboard.press('F1');
      const opened = await page.getByTestId('help-drawer').isVisible();
      await page.keyboard.press('F1');
      await page.waitForTimeout(300);
      const closed = !(await page.getByTestId('help-drawer').isVisible());
      return { observed: `F1で開く=${String(opened)} / もう一度F1で閉じる=${String(closed)}`, ok: opened && closed };
    });
    await page.getByTestId('open-help').click();
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    await expectText('02-help-parts', '02 画面の上の帯', '左側の「目次」、上の「言葉で探す」、「説明書全体をPDFで開く」、「閉じる」', page.getByTestId('help-drawer'), ['目次', '言葉で探す', '説明書全体をPDFで開く', '閉じる']);
    await claim('02-help-search-count', '02 画面の上の帯', '言葉を入れると「3 件見つかりました」のように件数が出る', async () => {
      await page.getByTestId('help-search').fill('配線 保存');
      await page.waitForTimeout(500);
      const observed = await textOf(page.getByTestId('help-drawer').getByText(/件見つかりました/u));
      return { observed, ok: /\d+ 件見つかりました/u.test(observed) };
    });
    await claim('02-help-search-more', '02 画面の上の帯', '結果が多いときは「続きを表示」', async () => {
      await page.getByTestId('help-search').fill('押');
      await page.waitForTimeout(500);
      const more = page.getByRole('button', { name: /続きを表示/u });
      const observed = (await more.count()) > 0 ? await textOf(more) : '（「続きを表示」が無い）';
      return { observed, ok: (await more.count()) > 0 };
    });
    await claim('02-help-search-none', '02 画面の上の帯', 'どこにも無いときは「見つかりませんでした。別の言葉で探してください。」', async () => {
      await page.getByTestId('help-search').fill('ｘｙｚｑ存在しない語');
      await page.waitForTimeout(500);
      const observed = await textOf(page.getByTestId('help-drawer').getByText(/見つかりませんでした/u));
      return { observed, ok: observed.includes('見つかりませんでした。別の言葉で探してください。') };
    });
    await page.getByTestId('help-search').fill('');
    await claim('02-help-figure', '02 画面の上の帯', '図を押すと大きく出て「図を閉じる」で戻る。乗せると「図を大きく見る」', async () => {
      await page.locator('[data-testid^="help-section-screens/"]').first().click().catch(() => undefined);
      const figure = page.getByTestId('help-prose').locator('button[data-manual-image]').first();
      await figure.waitFor({ state: 'visible', timeout: 10_000 });
      const title = (await figure.getAttribute('title')) ?? (await figure.getAttribute('aria-label')) ?? '';
      await figure.click();
      const modal = page.getByTestId('help-figure-modal');
      const shown = await modal.isVisible();
      const close = await textOf(page.getByTestId('help-figure-close'));
      await page.keyboard.press('Escape');
      return { observed: `乗せた文字「${title}」／拡大=${String(shown)}／閉じる=「${close}」`, ok: shown && close.includes('図を閉じる') && title.includes('図を大きく見る') };
    });
    await claim('02-help-esc', '02 画面の上の帯', 'Esc を押しても閉じる', async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const visible = await page.getByTestId('help-drawer').isVisible();
      return { observed: `Esc後に表示=${String(visible)}`, ok: !visible };
    });

    // 一覧
    await page.getByTestId('start-here-open').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await claim('02-list-grade-default', '02 課題を選ぶ', '初めての人には「3級（おすすめ）」が最初から選ばれている', async () => {
      const pressed = page.getByTestId('grade-filter').locator('[aria-pressed="true"]');
      const observed = await textOf(pressed);
      return { observed, ok: observed.includes('3級') };
    });
    await expectText('02-list-filters', '02 課題を選ぶ', '上にある「すべて」から練習の種類で絞り込める。「課題を探す」「難しさ」「学習テーマ」', page.locator('[data-testid="problem-table"]').locator('xpath=..'), ['すべて', '課題を探す', '難しさ', '学習テーマ']);
    await claim('02-list-columns', '02 課題を選ぶ', '表の「課題名」の列に題名、その他の列に級とだいたいの時間。行の右端に課題ID', async () => {
      const header = await textOf(page.getByTestId('problem-table').locator('thead'));
      const row = await textOf(page.getByTestId('open-b-001').locator('xpath=ancestor::tr[1]'));
      return { observed: `見出し「${header}」 行「${row.slice(0, 120)}」`, ok: header.includes('課題名') && row.includes('b-001') };
    });
    await claim('02-list-search-none', '02 課題を選ぶ', '当たる課題が無いときは「入力した言葉に当たる課題がありません。別の言葉で探してください。」', async () => {
      await page.getByTestId('search-filter').fill('存在しない課題ｚｚ');
      await page.waitForTimeout(400);
      const observed = await textOf(page.getByTestId('problem-table').locator('xpath=..').getByText(/当たる課題がありません/u));
      await page.getByTestId('search-filter').fill('');
      return { observed, ok: observed.includes('入力した言葉に当たる課題がありません。別の言葉で探してください。') };
    });
    await expectText('02-list-reset', '02 作業の続きへ戻る', '「絞り込みをリセット」で初期表示に戻せる', page.getByRole('button', { name: '絞り込みをリセット' }), ['絞り込みをリセット']);
    await expectText('02-list-home', '02 課題を選ぶ', '左上の「ホームへ戻る」', page.getByRole('button', { name: 'ホームへ戻る', exact: true }), ['ホームへ戻る']);
    await claim('02-list-enter', '02 課題を選ぶ', 'キーボードで選んでいるときは Enter か Space でも始まる', async () => {
      await page.getByTestId('grade-filter').getByRole('button', { name: 'すべて', exact: true }).click();
      const row = page.getByTestId('open-b-001').locator('xpath=ancestor::tr[1]');
      await row.focus();
      await page.keyboard.press('Enter');
      await confirmChange();
      const opened = await page.getByTestId('session-toolbar').isVisible();
      return { observed: `Enterで開いた=${String(opened)}`, ok: opened };
    });
  });

  test('02 練習中の画面・03 回路組立', async () => {
    await openProblem('mode-assemble', 'b-001');
    let box = await waitForBoard();
    await expectText('02-session-areas', '02 練習中の画面の並び', '上の帯・手順・3Dの画面・右の欄・下の欄（操作ログ・経過時間）', page.locator('body'), ['手順', '操作ログ', '経過時間']);
    await expectText('02-session-steps', '02 練習中の画面の並び', '済んだ段階に「済」、いまの段階に「いまここ」。「3D盤の端子を2つクリックして配線します。」', page.getByTestId('step-guide'), ['いまここ']);
    await expectText('02-session-overlay', '02 練習中の画面の並び', '3Dの左上に状態。自分で張った電線 N 本', page.getByTestId('status-overlay'), ['無通電', '自分で張った電線 0 本']);
    await claim('02-session-log', '02 練習中の画面の並び', '操作ログは最初は折りたたみ。帯にログの件数・経過時間。クリックで開閉', async () => {
      const toggle = page.getByTestId('activity-toggle');
      const before = await textOf(toggle);
      const expanded = (await toggle.getAttribute('aria-expanded')) === 'true';
      await toggle.click();
      await page.waitForTimeout(300);
      const after = (await toggle.getAttribute('aria-expanded')) === 'true';
      await toggle.click();
      return { observed: `帯「${before}」 初期=${expanded ? '開' : '閉'} → 押すと ${after ? '開' : '閉'}`, ok: !expanded && after && /操作ログ/u.test(before) };
    });
    await expectText('02-toolbar', '02 画面の上の帯', '「課題一覧へ戻る」「元に戻す」「やり直し」「表示」「表示・作業ファイル」「ヒント」「判定」「ヘルプ」', page.getByTestId('session-toolbar'), ['課題一覧へ戻る', '元に戻す', 'やり直し', '表示', '表示・作業ファイル', 'ヒント', '判定', 'ヘルプ']);
    await claim('02-undo-reason', '02 画面の上の帯', '戻せる操作が無いときは「元に戻せる操作がありません」', async () => {
      const observed = await textOf(page.getByTestId('undo-reason'));
      return { observed, ok: observed.includes('元に戻せる操作がありません') };
    });
    await claim('02-overflow', '02 画面の上の帯', '「表示・作業ファイル」の中に視点の切替と「作業を保存」「作業を読込」', async () => {
      await page.getByTestId('toolbar-overflow-toggle').click();
      const observed = await textOf(page.getByTestId('toolbar-overflow'));
      await page.getByTestId('toolbar-overflow-toggle').click();
      return { observed, ok: includesAll(observed, ['作業を保存', '作業を読込', '正面']) };
    });
    await claim('02-hint', '02 画面の上の帯', 'ヒントは「次のヒント」で1段ずつ。最後に「ヒントはここまでです」「考え方と確認手順を読む」。「ヒントを閉じる」・Esc で閉じる', async () => {
      await page.getByTestId('hint-button').click();
      const panel = page.getByTestId('hint-panel');
      await expect(panel).toBeVisible();
      for (let i = 0; i < 4; i += 1) {
        const next = page.getByTestId('hint-next');
        if ((await next.count()) === 0 || !(await next.isEnabled())) break;
        await next.click();
      }
      const observed = await textOf(panel);
      await page.keyboard.press('Escape');
      const closed = !(await panel.isVisible());
      return { observed: `${observed.slice(0, 200)} ／ Escで閉じた=${String(closed)}`, ok: includesAll(observed, ['ヒントはここまでです', '考え方と確認手順を読む', 'ヒントを閉じる']) && closed };
    });
    await claim('02-view-keys', '02 3Dの見方と動かし方', 'キー 1 正面・2 上・3 ソケット・Home 全体', async () => {
      const readout = page.getByTestId('camera-readout');
      const read = async (): Promise<{ polar: number; dist: number }> => {
        const text = (await readout.textContent()) ?? '{}';
        const parsed = JSON.parse(text) as { polar?: number; dist?: number };
        return { polar: parsed.polar ?? Number.NaN, dist: parsed.dist ?? Number.NaN };
      };
      const states: Record<string, { polar: number; dist: number }> = {};
      for (const key of ['1', '2', '3', 'Home']) {
        await page.getByTestId('viewport').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
        await page.keyboard.press(key);
        await page.waitForTimeout(700);
        states[key] = await read();
      }
      const observed = Object.entries(states)
        .map(([key, value]) => `${key}: 極角 ${value.polar.toFixed(2)} 距離 ${value.dist.toFixed(0)}`)
        .join(' / ');
      const front = states['1']!;
      const top = states['2']!;
      const socket = states['3']!;
      const home = states['Home']!;
      return {
        observed,
        ok: top.polar < front.polar && socket.dist < front.dist && Math.abs(home.dist - front.dist) < 1,
      };
    });
    await expectText('02-view-hint', '02 3Dの見方と動かし方', '右の欄の「視点操作の早見表」', page.getByTestId('view-hint-toggle'), ['視点操作の早見表']);
    await claim('02-terminal-tooltip', '02 端子に触れると出る札', '札には「CR1 の ⑨（COM）」のように、どの部品のどの番号で、何のための端子か', async () => {
      await page.mouse.click(boardPoint(socketBodyPoint(), box).x, boardPoint(socketBodyPoint(), box).y);
      await page.getByTestId('socket-card').waitFor({ state: 'visible' });
      await page.getByTestId('mount-relay-my4n').click();
      await page.keyboard.press('Escape');
      const point = terminalPoint(toTerminalId('S1.9'), box);
      await page.mouse.move(point.x, point.y);
      const tooltip = page.locator('.terminal-tooltip');
      await expect(tooltip).toBeVisible({ timeout: 15_000 });
      const observed = await textOf(tooltip);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
      return { observed, ok: observed.includes('CR1 の ⑨（COM）') };
    });
    await claim('02-coil-tooltip', '02 端子に触れると出る札', '札にも「コイル P(+)側」「コイル N(−)側」と出る', async () => {
      const point = terminalPoint(toTerminalId('S1.14'), box);
      await page.mouse.move(point.x, point.y);
      const tooltip = page.locator('.terminal-tooltip');
      await expect(tooltip).toBeVisible({ timeout: 15_000 });
      const observed = await textOf(tooltip);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
      return { observed, ok: observed.includes('コイル P(+)側') };
    });
    await claim('02-lamp-tooltip', '02 端子に触れると出る札', '札には「TB_PL PL1+: 白ランプ PL1 の P(+)側」のように出る', async () => {
      const point = terminalPoint(toTerminalId('TB_PL.1+'), box);
      await page.mouse.move(point.x, point.y);
      const tooltip = page.locator('.terminal-tooltip');
      await expect(tooltip).toBeVisible({ timeout: 15_000 });
      const observed = await textOf(tooltip);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
      return { observed, ok: observed.includes('TB_PL PL1+: 白ランプ PL1 の P(+)側') };
    });
    await claim('02-socket-card', '02 部品を入れ替える', 'カードに「ソケット」の名前と部品。「ソケット一覧へ」「取り外す」「交換…」「選択中」', async () => {
      await page.mouse.click(boardPoint(socketBodyPoint(), box).x, boardPoint(socketBodyPoint(), box).y);
      await page.getByTestId('socket-card').waitFor({ state: 'visible' });
      const observed = await textOf(page.getByTestId('socket-card'));
      return { observed: observed.slice(0, 220), ok: includesAll(observed, ['ソケット', 'リレー MY4N', 'ソケット一覧へ', '取り外す', '交換', '選択中']) };
    });
    await claim('02-socket-swap', '02 部品を入れ替える', '「交換…」→「選択」→「これに交換」。やめるときは「交換をやめる」', async () => {
      await page.getByTestId('card-swap').click();
      const observed = await textOf(page.getByTestId('socket-card'));
      const cancel = page.getByTestId('swap-cancel');
      const cancelText = await textOf(cancel);
      await cancel.click();
      return { observed: `${observed.slice(0, 200)} ／ 取消ボタン「${cancelText}」`, ok: observed.includes('これに交換') && cancelText.includes('交換をやめる') };
    });
    // 配線（03章）
    await claim('03-wire-start', '03 電線をつなぐ・外す', '1つ目の端子を押すと左上に「始点: P.1」、下の1行に「P.1 → 接続先の端子をクリック」', async () => {
      const p1 = terminalPoint(toTerminalId('P.1'), box);
      await page.mouse.click(p1.x, p1.y);
      const overlay = await textOf(page.getByTestId('status-overlay'));
      const hint = await textOf(page.getByTestId('hover-hint'));
      return { observed: `${overlay} ／ ${hint}`, ok: overlay.includes('始点: P.1') && hint.includes('P.1 → 接続先の端子をクリック') };
    });
    await claim('03-wire-cancel', '03 電線をつなぐ・外す', 'やめたいときは Esc か下の1行の「取消」', async () => {
      const cancel = await textOf(page.getByTestId('wire-cancel-inline'));
      await page.keyboard.press('Escape');
      const overlay = await textOf(page.getByTestId('status-overlay'));
      return { observed: `取消ボタン「${cancel}」／Esc後「${overlay}」`, ok: cancel.includes('取消') && overlay.includes('端子未選択') };
    });
    for (const [from, to] of SELF_HOLD_WIRES) {
      const a = terminalPoint(toTerminalId(from), box);
      const b = terminalPoint(toTerminalId(to), box);
      await page.mouse.click(a.x, a.y);
      await page.mouse.click(b.x, b.y);
    }
    await expectText('03-wire-count', '03 電線をつなぐ・外す', '左上の「自分で張った電線」の本数が増える', page.getByTestId('status-overlay'), ['自分で張った電線 9 本']);
    await claim('03-wire-limit', '03 1つの端子は2本まで', '2本つながった端子を押すと「注意：1つの端子に接続できる電線は2本までです」。閉じるで消える', async () => {
      const full = terminalPoint(toTerminalId('S1.14'), box);
      await page.mouse.move(full.x, full.y);
      const hover = await textOf(page.getByTestId('hover-hint'));
      await page.mouse.click(full.x, full.y);
      const notice = await textOf(page.getByTestId('wire-limit-notice'));
      await page.getByTestId('wire-limit-close').click();
      const gone = (await page.getByTestId('wire-limit-notice').count()) === 0;
      return { observed: `乗せた時「${hover}」／注意文「${notice.slice(0, 160)}」／閉じた=${String(gone)}`, ok: hover.includes('この端子にはすでに2本つながっています。3本目は接続できません') && notice.includes('注意：1つの端子に接続できる電線は2本までです') && gone };
    });
    await claim('03-wire-select-delete', '03 電線をつなぐ・外す', '電線の途中を押すと「選択:」。Delete で外れ、Backspace でも外れる。「この電線を外す」ボタン', async () => {
      await openPanel('wire-list');
      const rows = page.locator('[data-testid^="wire-row-"]');
      const before = await rows.count();
      await rows.first().click();
      const overlay = await textOf(page.getByTestId('status-overlay'));
      const button = await textOf(page.getByRole('button', { name: /この電線を外す/u }));
      await page.keyboard.press('Delete');
      await page.waitForTimeout(300);
      const afterDelete = await rows.count();
      await rows.first().click();
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(300);
      const afterBackspace = await rows.count();
      await page.getByTestId('toolbar-undo').click().catch(() => undefined);
      await page.getByRole('button', { name: '元に戻す', exact: true }).click().catch(() => undefined);
      await page.getByRole('button', { name: '元に戻す', exact: true }).click().catch(() => undefined);
      return { observed: `選択時「${overlay}」／ボタン「${button}」／${String(before)}本→Delete後${String(afterDelete)}→Backspace後${String(afterBackspace)}`, ok: overlay.includes('選択:') && afterDelete === before - 1 && afterBackspace === before - 2 && button.includes('この電線を外す') };
    });
    await claim('03-terminal-list', '03 キーボードでつなぐ', '「端子リスト（キーボード配線）」「端子を探す」。案内「Tab で端子を移動し、Enter で選びます。2つ選ぶと電線が1本つながります。」。2本の端子は「2/2」', async () => {
      await openPanel('terminal-list');
      const panel = page.getByTestId('terminal-list');
      await page.getByTestId('terminal-search').fill('S1');
      const observed = await textOf(panel);
      await page.getByTestId('terminal-search').fill('');
      return { observed: observed.slice(0, 260), ok: includesAll(observed, ['端子を探す', 'Tab で端子を移動し、Enter で選びます。2つ選ぶと電線が1本つながります。', '2/2']) };
    });
    await claim('03-wire-list-edit', '03 電線一覧で接続を探す・直す', '「電線一覧・接続先の変更」に検索、「接続先を変更」「線番」「注記」「線番・注記を保存」「チェックした電線○本を削除（Undo可）」「編集対象」「一括削除の対象」「通す配線帯」', async () => {
      await openPanel('wire-list');
      const observed = await textOf(page.getByTestId('wire-list'));
      return { observed: observed.slice(0, 300), ok: includesAll(observed, ['接続先を変更', '線番', '注記', '線番・注記を保存', '本を削除', '編集対象', '一括削除の対象', '通す配線帯']) };
    });
    await claim('03-power-order', '03 電気を流す', '順番を逆にすると危険操作として数えられる（警告の帯が出て「閉じる」で消せる）', async () => {
      await page.getByTestId('power-switch').click();
      await page.getByTestId('power-breaker').click();
      await page.waitForTimeout(500);
      const banner = await textOf(page.getByTestId('hazard-banner'));
      const closeButton = page.getByTestId('hazard-dismiss');
      const closeText = (await closeButton.count()) > 0 ? await textOf(closeButton) : '';
      if ((await closeButton.count()) > 0) await closeButton.click();
      await powerOff();
      return { observed: `帯「${banner.slice(0, 160)}」 閉じる「${closeText}」`, ok: banner.includes('警告') && closeText.includes('閉じる') };
    });
    await claim('02-hold-buttons', '02 押しボタンを同時に押す', '「押し続ける」で保持（「保持中」）。「すべて離す」。「押下中」に実際に押されているボタン', async () => {
      await page.getByTestId('hold-PB1').click();
      const observed = await textOf(page.getByTestId('push-button-controls'));
      await page.getByTestId('release-all-buttons').click();
      const after = await textOf(page.getByTestId('push-button-state'));
      return { observed: `${observed.slice(0, 200)} → 離したあと「${after}」`, ok: includesAll(observed, ['押し続ける', '保持中', 'すべて離す', '押下中']) && after.includes('なし') };
    });
    await powerOn();
    await claim('02-chart-live', '02 タイムチャートの読み方', '右の欄に「タイムチャート（仕様）」。「ライブ記録」は最初は閉じていて見出しで開閉', async () => {
      const spec = await textOf(page.getByTestId('chart-panel'));
      const live = page.getByTestId('live-panel-details');
      const liveOpen = (await live.getAttribute('open')) !== null;
      return { observed: `${spec.slice(0, 80)} ／ ライブ記録 初期=${liveOpen ? '開' : '閉'}`, ok: spec.includes('タイムチャート（仕様）') && !liveOpen };
    });
    await claim('02-chart-enlarge', '02 タイムチャートの読み方', '図をクリックすると大きく開き「拡大表示」。窓の外をクリックすると閉じる（「図の外をクリックすると閉じます」）', async () => {
      await page.getByTestId('chart-enlarge-button').first().click();
      const modal = page.getByTestId('chart-modal');
      await expect(modal).toBeVisible();
      const observed = await textOf(modal);
      await page.keyboard.press('Escape');
      return { observed: observed.slice(0, 160), ok: observed.includes('拡大表示') && observed.includes('図の外をクリックすると閉じます') };
    });
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
    await expectText('02-result-top', '02 結果の画面', '一番上に「合格」。「動作は模範回路と一致しました。」。「まず直すところ」', page.locator('body'), ['合格', '動作は模範回路と一致しました。', 'まず直すところ']);
    await expectText('02-result-sections', '02 結果の画面', '差分一覧・静的チェック・危険操作・所要時間', page.locator('body'), ['差分一覧', '静的チェック', '危険操作', '所要時間']);
    await expectText('02-result-buttons', '02 結果の画面', '「作業へ戻る」「もう一度」「課題一覧へ」「動きを見直す」「模範と見くらべる」「この結果を書き出す」', page.locator('body'), ['作業へ戻る', 'もう一度', '課題一覧へ', '動きを見直す', '模範と見くらべる', 'この結果を書き出す']);
    await claim('02-compare', '02 模範と見くらべる', '上が模範（破線）・下が自分（実線）。「拡大」。「閉じる」または Esc', async () => {
      await page.getByTestId('compare-open').click();
      const dialog = page.getByTestId('compare-dialog');
      await expect(dialog).toBeVisible();
      const observed = await textOf(dialog);
      await page.getByTestId('compare-close').click();
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['模範', '自分', '閉じる']) };
    });
    await claim('02-replay', '02 動きを見直す', '「前へ」「次へ」「最初から」、押ボタンの操作・期待する動き・区間の時刻。「結果へ戻る」', async () => {
      await page.getByTestId('replay-open').click();
      const bar = page.getByTestId('replay-bar');
      await expect(bar).toHaveAttribute('aria-busy', 'false');
      const observed = await textOf(bar);
      await page.getByTestId('replay-stop').click();
      return { observed: observed.slice(0, 220), ok: includesAll(observed, ['前へ', '次へ', '最初から', '結果へ戻る']) };
    });
    await page.getByTestId('result-resume').click();
    await expect(page.getByTestId('session-toolbar')).toBeVisible();
    box = await waitForBoard();
    await claim('07-schematic', '07 回路図を描いて確かめる', 'F2 で「盤」「並べて」「回路図」を切り替え。手順「回路図を描く」「検算する」「盤に配線する」。パレット、「段を追加」「段を削除」「全部消す」「回路図の指摘」', async () => {
      await page.getByTestId('viewport').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
      await page.keyboard.press('F2');
      await page.waitForTimeout(500);
      const view1 = (await page.locator('[data-testid^="assemble-view-"][aria-pressed="true"]').getAttribute('data-testid')) ?? '';
      await page.keyboard.press('F2');
      await page.waitForTimeout(500);
      const view2 = (await page.locator('[data-testid^="assemble-view-"][aria-pressed="true"]').getAttribute('data-testid')) ?? '';
      await page.getByTestId('assemble-view-schematic').click();
      const observed = await textOf(page.getByTestId('editor-pane'));
      const guide = await textOf(page.getByTestId('schematic-step-guide'));
      await page.getByTestId('assemble-view-board').click();
      return { observed: `F2: ${view1} → ${view2} ／ ${guide} ／ ${observed.slice(0, 200)}`, ok: view1 !== view2 && includesAll(guide, ['回路図を描く', '検算', '盤に配線する']) && includesAll(observed, ['段を追加', '段を削除', '全部消す', '回路図の指摘']) };
    });
    await claim('07-clear-confirm', '07 回路図を描く', '「全部消す」→「描いた回路図をすべて消します。よろしいですか？」「はい、全部消す」「やめる」', async () => {
      await page.getByTestId('assemble-view-schematic').click();
      await page.getByTestId('clear-button').click();
      const observed = await textOf(page.getByTestId('clear-confirm'));
      await page.getByTestId('clear-no').click();
      await page.getByTestId('assemble-view-board').click();
      return { observed, ok: includesAll(observed, ['描いた回路図をすべて消します。よろしいですか？', 'はい、全部消す', 'やめる']) };
    });
    await claim('07-verify-note', '07 「検算」で確かめる', '「机上の検算です。盤の配線は「判定」で別に確かめます。」「指摘はありません。検算できます。」', async () => {
      await page.getByTestId('assemble-view-schematic').click();
      await page.getByTestId('palette-pb-b:PB2').click();
      await page.locator('[data-slot="r1#0"]').click();
      await page.getByTestId('palette-pb-a:PB1').click();
      await page.locator('[data-slot="r1#1"]').click();
      await page.getByTestId('palette-coil:CR1').click();
      await page.locator('[data-slot="r1#2"]').click();
      const issues = await textOf(page.getByTestId('schematic-issues'));
      const verify = await textOf(page.getByTestId('verify-panel'));
      await page.getByTestId('assemble-view-board').click();
      return { observed: `${issues.slice(0, 120)} ／ ${verify.slice(0, 160)}`, ok: issues.includes('指摘はありません。検算できます。') && verify.includes('机上の検算です。盤の配線は「判定」で別に確かめます。') };
    });
  });

  test('04 部品点検（C1）', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) throw new Error('C1課題がありません');
    await openProblem('mode-inspect-parts', problem.id);
    await waitForBoard();
    await expectText('04-steps', '04 部品を点検する', '手順: 部品を挿す → 通電 → 測る → マーク → 判定', page.getByTestId('step-guide'), ['部品を挿す', '通電', '測る', 'マーク', '判定']);
    await expectText('04-tray', '04 部品を点検する', '「部品トレイ」から部品を1つ選び「チェック用ソケットに挿す」', page.getByTestId('check-tray'), ['部品トレイ', 'チェック用ソケットに挿す']);
    await claim('04-tester', '04 テスターの使い方', '「測定モード」のつまみ（電圧・抵抗・導通）、「黒プローブ」「赤プローブ」、デジタル／アナログ、「オートレンジ」', async () => {
      const observed = await textOf(page.getByTestId('tester-panel'));
      return { observed: observed.slice(0, 260), ok: includesAll(observed, ['デジタル', 'アナログ', 'DCV', 'Ω', '導通', '黒プローブ', '赤プローブ', 'オートレンジ']) };
    });
    await claim('04-zero-adj', '04 テスターの使い方', '「アナログテスターのΩ／導通レンジのときだけ 0Ω 調整ができます」。調整が終わると「調整済」', async () => {
      const reason = await textOf(page.getByTestId('zero-disabled-reason'));
      await page.getByRole('button', { name: 'アナログ', exact: true }).click();
      await page.getByRole('button', { name: 'Ω', exact: true }).click();
      await page.getByRole('button', { name: '0Ω ADJ', exact: true }).click();
      await page.waitForTimeout(300);
      const after = await textOf(page.getByTestId('tester-panel'));
      return { observed: `理由「${reason}」／調整後に「調整済」=${String(after.includes('調整済'))}`, ok: reason.includes('アナログテスターのΩ／導通レンジのときだけ 0Ω 調整ができます') && after.includes('調整済') };
    });
    await claim('04-probe-keys', '04 テスターの使い方', 'b は次に置く黒い棒、r は赤い棒。「プローブを当てる」「1組 a接点」', async () => {
      await page.getByTestId(`plug-${problem.parts[0]?.id ?? ''}`).click();
      await page.getByTestId('viewport').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
      await page.keyboard.press('r');
      await page.waitForTimeout(200);
      const hintR = await textOf(page.getByTestId('next-probe-hint'));
      await page.keyboard.press('b');
      await page.waitForTimeout(200);
      const hintB = await textOf(page.getByTestId('next-probe-hint'));
      const shortcuts = await textOf(page.getByTestId('probe-shortcuts'));
      const a1 = await textOf(page.getByTestId('probe-target-a1'));
      return { observed: `r→「${hintR}」 b→「${hintB}」／${shortcuts.slice(0, 60)}／${a1}`, ok: hintR.includes('赤') && hintB.includes('黒') && a1.includes('a接点') };
    });
    await claim('04-live-ohm', '04 テスターの使い方', '「通電中はΩ／導通を測れません」', async () => {
      await powerOn();
      await page.getByRole('button', { name: 'Ω', exact: true }).click();
      await page.getByTestId('probe-target-coil').click();
      await page.waitForTimeout(600);
      const observed = await textOf(page.getByTestId('tester-live-note'));
      await powerOff();
      return { observed, ok: observed.includes('通電中はΩ／導通を測れません') };
    });
    await claim('04-buzzer', '04 テスターの使い方', '導通しているときはブザーが鳴り「ブザー鳴動中」', async () => {
      await page.getByRole('button', { name: '導通', exact: true }).click();
      await page.getByTestId('probe-target-b1').click();
      await page.waitForTimeout(800);
      const observed = await textOf(page.getByTestId('tester-buzz'));
      return { observed, ok: observed.includes('ブザー鳴動中') };
    });
    await expectText('04-diagnosis', '04 不良の見分け方', '「判定表（切り分けの手順）」「チェック状況」「備考」', page.getByTestId('diagnosis-help'), ['判定表（切り分けの手順）', 'チェック状況']);
    await expectText('04-marksheet', '04 答えを書き込む', '「マークシート（不良原因を選ぶ）」「不良原因」「正常」「解答済み」', page.getByTestId('mark-sheet'), ['マークシート（不良原因を選ぶ）', '不良原因', '正常', '解答済み']);
    await claim('04-result', '04 「判定」を押す', '結果に「マークシート採点」、「n/m 正解」、「見分け方」、「測定記録」', async () => {
      await page.getByTestId('judge-button').click();
      await expect(page.getByTestId('mark-result-table')).toBeVisible({ timeout: 60_000 });
      const observed = await textOf(page.locator('body'));
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['マークシート採点', '正解', '見分け方']) && /\d+ \/ \d+ 正解/u.test(observed) };
    });
  });

  test('05 回路点検・修復（C2）', async () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    if (problem === undefined) throw new Error('C2課題がありません');
    await openProblem('mode-inspect-repair', problem.id);
    const box = await waitForBoard();
    const roles = toSocketRoles(problem.board.socketRoles);
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('C2の回路が作れません');
    const brokenWire = built.value.applied.sites.find((site) => site.kind === 'wire-open')?.wireId;
    await expectText('05-steps', '05 回路を点検して直す', '手順: 指摘 → 修復 → 判定', page.getByTestId('step-guide'), ['指摘', '修復', '判定']);
    await claim('05-schematic-hint', '05 回路図と盤を行き来する', '「表示・作業ファイル」の「回路図を表示」。開くと「拡大」「縮小」「等倍」「表示倍率」', async () => {
      await page.getByTestId('toolbar-overflow-toggle').click();
      await page.getByTestId('toggle-schematic').click();
      const hint = page.getByTestId('schematic-hint');
      await expect(hint).toBeVisible();
      await page.getByTestId('schematic-enlarge-button').click();
      const modal = page.getByTestId('schematic-modal');
      await expect(modal).toBeVisible();
      const observed = await textOf(modal);
      await page.keyboard.press('Escape');
      return { observed: observed.slice(0, 160), ok: includesAll(observed, ['拡大', '縮小', '等倍', '表示倍率']) };
    });
    await claim('05-report-wire', '05 見つけたところを書き出す', '3Dの電線を押すと「この場所の故障を指摘する」の小窓。2行目に押した物の名前「…の青線」。種類「断線」「誤配線」', async () => {
      if (brokenWire === undefined) throw new Error('断線の故障がありません');
      await page.getByTestId('tool-report').click();
      const wire = built.value.session.wires.find((w) => w.id === brokenWire);
      const route = visibleRoutes(JIPM_BOARD, built.value.session).routes.find((r) => r.wireId === brokenWire);
      if (wire === undefined || route === undefined) throw new Error('電線が無い');
      let observed = '';
      for (let index = 0; index + 1 < route.corners.length && observed === ''; index += 1) {
        const a = route.corners[index]!;
        const b = route.corners[index + 1]!;
        const point = boardPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, box);
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(150);
        const popover = page.getByTestId('report-popover');
        if ((await popover.count()) > 0) {
          const text = await textOf(popover);
          if (text.includes('青線')) observed = text;
          else await page.getByTestId('report-cancel').click();
        }
      }
      const ok = includesAll(observed, ['この場所の故障を指摘する', '青線', '断線', '誤配線']);
      if ((await page.getByTestId('report-popover').count()) > 0) await page.getByTestId('report-kind-wire-open').click();
      return { observed: observed.slice(0, 200), ok };
    });
    await claim('05-report-terminal', '05 見つけたところを書き出す', '端子を押すと「この端子に来るはずの電線が無いときは「未配線」を選びます（断線・誤配線は電線を、部品不良は部品を押してください）」', async () => {
      const point = roleTerminalPoint(roles, 'TB_PL.1+', box);
      await page.mouse.click(point.x, point.y);
      const observed = await textOf(page.getByTestId('report-popover'));
      await page.getByTestId('report-cancel').click();
      return { observed: observed.slice(0, 220), ok: observed.includes('この端子に来るはずの電線が無いときは「未配線」を選びます') };
    });
    await claim('05-report-part', '05 部品の故障の内容を選ぶ', '部品を押すと「コイルの断線（励磁しない）」「接点の溶着（開くはずの接点が開かない）」「部品不良（内容は分からない）」', async () => {
      const point = boardPoint(socketBodyPoint(), box);
      await page.mouse.click(point.x, point.y);
      const observed = await textOf(page.getByTestId('report-popover'));
      await page.getByTestId('report-kind-part-defect').click();
      await page.mouse.click(point.x, point.y);
      const again = await textOf(page.getByTestId('report-popover'));
      const detail = page.locator('[data-testid^="report-detail-"]').first();
      await detail.click();
      const toast = await textOf(page.getByTestId('toast'));
      return { observed: `${observed.slice(0, 200)} ／ 2回目「${again.slice(0, 60)}」／ 知らせ「${toast}」`, ok: includesAll(observed, ['コイルの断線（励磁しない）', '接点の溶着（開くはずの接点が開かない）', '部品不良（内容は分からない）']) && toast.includes('部品不良の内容を選び直しました') };
    });
    await claim('05-report-list', '05 取り消す・確かめる', '「指摘一覧」の「登録した指摘」に場所と種類。「変更」「取消」。同じ指摘は「同じ指摘が既に登録されています」', async () => {
      const list = await textOf(page.getByTestId('report-panel'));
      const point = boardPoint(socketBodyPoint(), box);
      await page.mouse.click(point.x, point.y);
      await page.getByTestId('report-kind-part-defect').click();
      await page.waitForTimeout(300);
      const toast = await textOf(page.getByTestId('toast'));
      return { observed: `${list.slice(0, 200)} ／ 知らせ「${toast}」`, ok: includesAll(list, ['指摘一覧', '登録した指摘', '変更', '取消']) && toast.includes('同じ指摘が既に登録されています') };
    });
    await expectText('05-repair-panel', '05 直す', '「修復」に「装着部品」「交換」「追加した白線」「外した青線」', page.getByTestId('repair-panel'), ['装着部品', '追加した白線', '外した青線']);
    await claim('05-wire-return', '05 外した青線を元に戻す', '「外した青線」の「元に戻す」「…の元の端子」', async () => {
      if (brokenWire === undefined) throw new Error('断線の故障がありません');
      await openPanel('wire-list');
      await page.getByTestId(`wire-row-${brokenWire}`).click();
      await page.getByRole('button', { name: 'この電線を外す（Delete / Backspace）', exact: true }).click();
      const observed = await textOf(page.getByTestId('removed-wires'));
      await page.getByTestId(`restore-wire-${brokenWire}`).click();
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['元に戻す', '元の端子']) };
    });
    await claim('05-measurement', '05 測定値と判断を残す', '「測定記録・診断メモ」「測定の目的・気付いたこと」「今の測定値を記録」「対象の線・端子・部品」「予測」「測定から分かったこと・次に調べること」「選んだ測定記録とメモを保存」', async () => {
      await openPanel('measurement-panel');
      const observed = await textOf(page.getByTestId('measurement-panel'));
      return { observed: observed.slice(0, 300), ok: includesAll(observed, ['測定の目的・気付いたこと', '今の測定値を記録', '対象の線・端子・部品', '予測', '測定から分かったこと・次に調べること', '選んだ測定記録とメモを保存']) };
    });
    await claim('05-result', '05 「判定」を押す', '結果に「言い当てた故障」「見逃し」「過剰指摘」「追加した白線」「改造（故障箇所でない青線の削除）」', async () => {
      await page.getByTestId('judge-button').click();
      await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
      const observed = await textOf(page.locator('body'));
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['言い当てた故障', '見逃し', '過剰指摘', '追加した白線', '改造']) };
    });
  });

  test('06 PLC（三菱）', async () => {
    const problem = BUILTIN_PLC_PROBLEMS[0];
    if (problem === undefined) throw new Error('PLC課題がありません');
    await openProblem('mode-plc', problem.id);
    await expect(page.getByTestId('plc-session')).toBeVisible();
    await expectText('06-steps', '06 PLCの課題を進める', '手順: ①配線（3D盤）いつでも、②ラダー作成、③変換、④モニタ開始・RUN、⑤判定。最初の案内「まずラダーを作ります」', page.getByTestId('plc-guide'), ['配線', 'いつでも', 'ラダー作成', '変換', 'モニタ開始', '判定']);
    await expectText('06-hint', '06 PLCの課題を進める', '案内のすぐ下に「まずラダーを作ります」', page.getByTestId('plc-hint'), ['まずラダーを作ります']);
    await expectText('06-views', '06 PLCの課題を進める', 'ツールバーの「表示」で「ラダー」「分割」「盤」', page.getByTestId('view-switch'), ['ラダー', '分割', '盤']);
    await expectText('06-chart-link', '06 タイムチャートを見る', '手順の帯の「タイムチャートを見る」', page.getByTestId('plc-show-chart'), ['タイムチャートを見る']);
    await page.getByTestId('view-ladder').click();
    await expect(page.getByTestId('ladder-editor')).toBeVisible();
    await claim('06-menus', '06 ラダー図を描く', '上端の「PLCソフトのメニュー」。「編集」に回路や行の追加・削除。「表示」から出力・ウォッチ', async () => {
      await page.getByTestId('native-menu-edit').click();
      const observed = await textOf(page.getByTestId('native-menu-popup'));
      await page.keyboard.press('Escape');
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['行', '回路ブロック']) };
    });
    await claim('06-title-mode', '06 ラダー図を描く', 'タイトル帯に「書込モード」「読出モード」「モニタ」のどれかが出て、札に切り替えるキー', async () => {
      const mode = await textOf(page.getByTestId('skin-title-mode'));
      const title = (await page.getByTestId('skin-title-mode').getAttribute('title')) ?? '';
      return { observed: `${mode} / title=${title}`, ok: mode.includes('書込') && title.includes('F2') };
    });
    await claim('06-device-input', '06 ラダー図を描く', '記号を置くと「デバイスの入力」。「接点の種別」「確定」「取消」。「記号とデバイス」の1行入力', async () => {
      await page.getByTestId('cell-n1:0:0').click();
      await ladderKey('F5');
      const observed = await textOf(page.getByTestId('device-input'));
      await page.getByTestId('device-cancel').click();
      return { observed: observed.slice(0, 220), ok: includesAll(observed, ['接点の種別', '確定', '取消', '記号とデバイス']) };
    });
    await claim('06-device-error', '06 ラダー図を描く', '入力できない名前を打ち込むと欄の下に知らせが出て確定できない', async () => {
      await ladderKey('F5');
      await page.getByTestId('device-text').fill('X9');
      await page.getByTestId('device-commit').click();
      const error = await textOf(page.getByTestId('device-error'));
      const stillOpen = await page.getByTestId('device-input').isVisible();
      await page.getByTestId('device-cancel').click();
      return { observed: `${error} ／ 窓が残る=${String(stillOpen)}`, ok: error !== '' && stillOpen };
    });
    await claim('06-application', '06 ラダー図を描く', '「応用命令」（F8）に扱えない命令を書くと「このアプリでは扱えない命令です（扱えるのは SET / RST / MC / MCR / T / C）」', async () => {
      await ladderKey('F8');
      await page.getByTestId('direct-text').fill('MOV D0 D1');
      await page.getByTestId('device-commit').click();
      const observed = `${await textOf(page.getByTestId('device-error'))} ${await textOf(page.getByTestId('toast'))}`;
      await page.getByTestId('device-cancel').click().catch(() => undefined);
      return { observed: observed.trim(), ok: observed.includes('このアプリでは扱えない命令です（扱えるのは SET / RST / MC / MCR / T / C）') };
    });
    await claim('06-symbol-titles', '06 ラダー図を描く', '記号のボタンにポインタを合わせると名前とキー（「a接点 (F5)」）。右クリックで「記号メニュー」', async () => {
      const title = (await page.getByTestId('symbol-contact-no').getAttribute('title')) ?? '';
      await page.getByTestId('cell-n1:0:1').click({ button: 'right' });
      const menu = await textOf(page.getByTestId('cell-menu'));
      await page.keyboard.press('Escape');
      return { observed: `title「${title}」／右クリック「${menu.slice(0, 80)}」`, ok: title.includes('a接点 (F5)') && menu !== '' };
    });
    await claim('06-monitor-before-convert', '06 変換する', '変換がまだのうちにモニタを押すと「先に変換（F4）してください」', async () => {
      await page.getByTestId('cell-n1:0:0').click();
      await ladderKey('F5');
      await commitDevice('X0');
      await page.getByTestId('toolbar-monitor-start').click();
      const observed = `${await textOf(page.getByTestId('toast'))} ${await textOf(page.getByTestId('monitor-not-converted'))}`;
      return { observed: observed.trim(), ok: observed.includes('先に変換（F4）してください') };
    });
    await claim('06-unconverted', '06 変換する', '三菱では未変換の回路ブロックの地が灰色になり「未変換です（F4 で変換します）」', async () => {
      const observed = await textOf(page.getByTestId('convert-state'));
      return { observed, ok: observed.includes('未変換') && observed.includes('F4') };
    });
    await claim('06-convert', '06 変換する', '変換がうまくいくと「出力ウィンドウ」に「変換に成功しました」。「読み出しているデバイス」「書き込んでいるデバイス」「使われていないデバイス（表示のみ・合否には影響しません）」', async () => {
      await ladderKey('ArrowLeft');
      await moveToCoil('n1', 1);
      await ladderKey('F7');
      await commitDevice('Y0');
      await ladderKey('F4');
      await page.waitForTimeout(500);
      const observed = await textOf(page.getByTestId('output-window'));
      return { observed: observed.slice(0, 220), ok: includesAll(observed, ['変換に成功しました', '読み出しているデバイス', '書き込んでいるデバイス', '使われていないデバイス（表示のみ・合否には影響しません）']) };
    });
    await claim('06-keymap', '06 キーの割り当て', '「キー割当」の欄、「ツール」→「キー操作一覧」、Shift + ? で「キーの早見表」。「Shift + ? でキーの早見表を開きます」「メーカーごとに切り替わります」', async () => {
      const note = await textOf(page.getByTestId('shortcuts-note'));
      await page.getByTestId('native-menu-bar').getByRole('button', { name: 'ツール', exact: true }).click().catch(async () => page.getByRole('button', { name: 'ツール', exact: true }).first().click());
      const menu = await textOf(page.getByTestId('native-menu-popup'));
      await page.keyboard.press('Escape');
      await page.getByTestId('ladder-editor').press('?');
      const overlay = await textOf(page.getByTestId('shortcut-overlay'));
      await page.getByTestId('shortcut-overlay-close').click();
      return { observed: `${note.slice(0, 80)} ／ ツール「${menu.slice(0, 60)}」／ 早見表「${overlay.slice(0, 40)}」`, ok: note.includes('Shift + ? でキーの早見表を開きます') && note.includes('メーカーごとに切り替わります') && menu.includes('キー操作一覧') && overlay.includes('キーの早見表') };
    });
    await claim('06-io-table', '06 入出力の割り付け', '「I/O割付」。「この割付どおりに配線します。」。「PLC電源は壁コンセント（AC100V）から取ります。」「入力コモン」', async () => {
      await openPanel('io-table');
      const observed = await textOf(page.getByTestId('io-table').locator('xpath=..'));
      return { observed: observed.slice(0, 220), ok: includesAll(observed, ['この割付どおりに配線します。', 'PLC電源は壁コンセント（AC100V）から取ります。', '入力コモン']) };
    });
    await claim('06-watch', '06 動きを見る', '三菱では「ウォッチ」。「監視するデバイス」「監視に追加」。「まだ何も登録していません。見たいデバイスを足すと、ここだけに並びます。」', async () => {
      await openPanel('watch-panel');
      const observed = await textOf(page.getByTestId('watch-panel'));
      return { observed: observed.slice(0, 220), ok: includesAll(observed, ['ウォッチ', '監視するデバイス', '監視に追加', 'まだ何も登録していません。見たいデバイスを足すと、ここだけに並びます。']) };
    });
    await claim('06-monitor', '06 動きを見る', '「モニタ開始」。「デバイス初期化」。停止中は「PLCが停止中です。RUN にすると動きます。」。「デバイス一覧」に ■／□', async () => {
      await page.getByTestId('toolbar-monitor-start').click();
      await page.waitForTimeout(500);
      const observed = await textOf(page.getByTestId('monitor-panel'));
      return { observed: observed.slice(0, 220), ok: includesAll(observed, ['デバイス初期化', 'PLCが停止中です。RUN にすると動きます。', 'デバイス一覧']) };
    });
    await claim('06-run', '06 動きを見る', 'RUN を押すと「運転中（RUN）」。「スキャン回数」', async () => {
      await page.getByTestId('toolbar-plc-run').click();
      await page.waitForTimeout(800);
      const observed = await textOf(page.getByTestId('monitor-panel'));
      return { observed: observed.slice(0, 160), ok: observed.includes('運転中') && observed.includes('スキャン') };
    });
    await claim('06-debug', '06 スキャンを止めて原因を追う', '「スキャン診断」に「1スキャン実行（10 ms）」「一時停止」「連続実行へ戻る」「条件が成立したら一時停止」「条件を解除」', async () => {
      await openPanel('plc-debug');
      const observed = await textOf(page.getByTestId('plc-debug'));
      return { observed: observed.slice(0, 240), ok: includesAll(observed, ['1スキャン実行（10 ms）', '一時停止', '連続実行へ戻る', '条件が成立したら一時停止', '条件を解除']) };
    });
    await claim('06-notation-dialog', '06 別のメーカーの書き方に変える', '「表記切替」→「どのメーカーの表記にしますか？」。注意の文「机上のPLC本体も切り替わります。…」。「デバイスの書き方」。「この表記に切り替える」「取消」', async () => {
      await page.getByTestId('toolbar-notation').click();
      const dialog = page.getByTestId('notation-dialog');
      await expect(dialog).toBeVisible();
      await page.getByTestId('notation-to-omron').click();
      const observed = await textOf(dialog);
      await page.getByTestId('notation-cancel').click();
      return { observed: observed.slice(0, 260), ok: includesAll(observed, ['どのメーカーの表記にしますか？', '机上のPLC本体も切り替わります', 'デバイスの書き方', '切り替える', '取消']) };
    });
    await claim('06-switch-vendor', '06 機種を変える', '盤の表示の右の欄に「機種」と「メーカーを切り替える」', async () => {
      await page.getByTestId('view-board').click();
      const model = await textOf(page.getByTestId('plc-model'));
      const button = await textOf(page.getByTestId('switch-vendor'));
      return { observed: `${model} ／ ${button}`, ok: model.includes('FX5U') && button.includes('メーカーを切り替える') };
    });
    await claim('06-supply-status', '06 PLCの電源状態とI/Oを調べる', 'I/O表の「PLC電源」に接続正常または運転不可', async () => {
      const observed = await textOf(page.getByTestId('plc-supply-status'));
      return { observed, ok: observed.includes('運転不可') || observed.includes('接続正常') };
    });
    await claim('06-special-contact', '06 特殊接点を使う', '接点の入力に「特殊接点」の「用途から選ぶ」と「特殊接点の説明」', async () => {
      await page.getByTestId('view-ladder').click();
      await page.getByTestId('toolbar-monitor-stop').click().catch(() => undefined);
      await page.getByTestId('cell-n1:0:2').click();
      await ladderKey('F5');
      const select = page.getByTestId('special-contact-select');
      await select.selectOption({ index: 1 });
      const observed = `${await textOf(page.getByTestId('device-input'))}`;
      await page.getByTestId('device-cancel').click();
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['特殊接点', '用途から選ぶ', '特殊接点の説明']) };
    });
  });

  test('06 PLC（他メーカー）', async () => {
    const problem = BUILTIN_PLC_PROBLEMS[0];
    if (problem === undefined) throw new Error('PLC課題がありません');
    const switchTo = async (vendor: string): Promise<void> => {
      await page.getByTestId('view-ladder').click();
      await page.getByTestId('toolbar-notation').click();
      await page.getByTestId(`notation-to-${vendor}`).click();
      await page.getByTestId('notation-apply').click();
      await expect(page.getByTestId('notation-dialog')).toHaveCount(0);
      await page.getByTestId('view-ladder').click();
      await expect(page.getByTestId('ladder-editor')).toBeVisible();
    };
    await switchTo('omron');
    await claim('06-omron-convert', '06 変換する', 'オムロンには「変換」が無い。下の帯「「変換」の操作はありません（編集すると自動で変換されます）」。見出しに「変換に成功しました（自動で変換されます）」', async () => {
      const hint = await textOf(page.getByTestId('plc-hint'));
      const state = await textOf(page.getByTestId('convert-state'));
      return { observed: `${hint} ／ ${state}`, ok: hint.includes('「変換」の操作はありません') && state.includes('変換に成功しました（自動で変換されます）') };
    });
    await claim('06-omron-comment', '06 ラダー図を描く', 'オムロンではデバイスを決めたあと「コメント」の欄が開き、もう一度 Enter で確定', async () => {
      await page.getByTestId('cell-n1:0:3').click();
      await ladderKey('c');
      await page.getByTestId('device-text').fill('0.03');
      await page.getByTestId('device-text').press('Enter');
      await page.waitForTimeout(300);
      const comment = page.getByTestId('entry-comment');
      const shown = await comment.isVisible();
      if (shown) await comment.press('Enter');
      await page.waitForTimeout(200);
      const closed = (await page.getByTestId('device-input').count()) === 0;
      return { observed: `コメント欄=${String(shown)} ／ Enterで確定=${String(closed)}`, ok: shown && closed };
    });
    await claim('06-omron-no-output', '06 ラダー図を描く', 'オムロン・ジェイテクトでは出力の無い回路ブロックの右端に赤い縦線「出力がありません」', async () => {
      await page.getByTestId('native-menu-edit').click();
      await page.getByTestId('native-item-insert-network').click();
      await ladderKey('c');
      await commitDevice('0.04');
      const marker = page.locator('[data-testid^="no-output-"]').first();
      const observed = (await marker.count()) > 0 ? ((await marker.getAttribute('title')) ?? (await textOf(marker))) : '（赤い縦線が無い）';
      return { observed, ok: (await marker.count()) > 0 };
    });
    await claim('06-omron-watch', '06 動きを見る', 'オムロンでは「ウォッチウィンドウ」', async () => {
      const observed = await textOf(page.getByTestId('watch-panel-summary'));
      return { observed, ok: observed.includes('ウォッチウィンドウ') };
    });
    await claim('06-omron-toolbar', '06 PLCに書き込む', 'オムロンの書き方では「転送［PC → PLC］」', async () => {
      const observed = await textOf(page.getByTestId('ladder-workspace').locator('[class*="toolbar"]').first());
      return { observed: observed.slice(0, 160), ok: observed.includes('転送［PC → PLC］') };
    });
    await switchTo('jtekt');
    await claim('06-jtekt-toolbar', '06 PLCに書き込む', 'ジェイテクトには状態を表す表示（JP1・DGR・MOB・STP・RDY・RUN・RES）と「モニタ開始」「モニタ停止」が並ぶ', async () => {
      const observed = await textOf(page.getByTestId('ladder-workspace').locator('[class*="toolbar"]').first());
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['JP1', 'DGR', 'MOB', 'STP', 'RDY', 'RUN', 'RES', 'モニタ開始', 'モニタ停止']) };
    });
    await claim('06-jtekt-keys', '06 キーの割り当て', 'PCwin には「PCwinの編集キーは資料未確認のため割り当てていません。記号ボタンから入力してください。」', async () => {
      const observed = await textOf(page.getByTestId('shortcuts'));
      return { observed: observed.slice(0, 200), ok: observed.includes('PCwinの編集キーは資料未確認のため割り当てていません。記号ボタンから入力してください。') };
    });
    await claim('06-jtekt-watch', '06 動きを見る', 'ジェイテクトの書き方には監視の欄が無い', async () => {
      const n = await page.getByTestId('watch-panel').count();
      return { observed: `監視の欄 ${String(n)} 個`, ok: n === 0 };
    });
    await claim('06-jtekt-device', '06 机上のPLCへ配線する', 'ジェイテクトは端子X0がデバイス 1X000、端子Y10が 1Y010', async () => {
      await openPanel('io-table');
      const observed = await textOf(page.getByTestId('io-table'));
      return { observed: observed.slice(0, 200), ok: observed.includes('1X000') && observed.includes('1Y010') };
    });
    await switchTo('sharp');
    await claim('06-sharp-symbol-first', '06 ラダー図を描く', 'シャープは記号を置いてから Enter で「デバイスの入力」を開く。S/D/X', async () => {
      await page.getByTestId('cell-n1:0:3').click();
      await ladderKey('s');
      await page.waitForTimeout(200);
      const beforeEnter = (await page.getByTestId('device-input').count()) === 0;
      await ladderKey('Enter');
      const opened = await page.getByTestId('device-input').isVisible();
      await page.getByTestId('device-cancel').click();
      return { observed: `Sだけでは窓が開かない=${String(beforeEnter)} ／ Enterで開く=${String(opened)}`, ok: beforeEnter && opened };
    });
    await claim('06-sharp-watch', '06 動きを見る', 'シャープでは「モニタ登録」', async () => {
      const observed = await textOf(page.getByTestId('watch-panel-summary'));
      return { observed, ok: observed.includes('モニタ登録') };
    });
    await claim('06-sharp-toolbar', '06 PLCに書き込む', 'シャープの書き方では「PLCへの書込み」。検査は「プログラムチェック」', async () => {
      const observed = await textOf(page.getByTestId('ladder-workspace').locator('[class*="toolbar"]').first());
      return { observed: observed.slice(0, 160), ok: observed.includes('PLCへの書込み') && observed.includes('プログラムチェック') };
    });
    await claim('06-sharp-device', '06 机上のPLCへ配線する', 'シャープは端子A0が 000000、端子C0が 000020', async () => {
      await openPanel('io-table');
      const observed = await textOf(page.getByTestId('io-table'));
      return { observed: observed.slice(0, 200), ok: observed.includes('000000') && observed.includes('000020') };
    });
    await claim('06-switch-vendor-toast', '06 機種を変える', '「（メーカー名） に切り替えました。盤内の配線…本と部品…個はそのままです」', async () => {
      await page.getByTestId('view-board').click();
      await page.getByTestId('switch-vendor').click();
      await page.getByTestId('notation-to-mitsubishi').click();
      await page.getByTestId('notation-apply').click();
      await page.waitForTimeout(600);
      const observed = await textOf(page.getByTestId('toast'));
      return { observed, ok: observed.includes('に切り替えました') && observed.includes('そのままです') };
    });
  });

  test('15 回路実験・PLC実験', async () => {
    await goHome();
    await page.getByTestId('mode-plc-lab').click();
    await expect(page.getByTestId('lab-start')).toBeVisible();
    await claim('15-start-dialog', '15 実験を始める', '窓の見出し「PLC実験を始める」。「はじめのタイムチャート」「空のタイムチャート」「押し方も正解も描いていない状態から始めます。」「配線済みの盤」「自分で配線する盤」「始める」', async () => {
      const observed = await textOf(page.getByTestId('lab-start'));
      return { observed: observed.slice(0, 300), ok: includesAll(observed, ['PLC実験を始める', 'はじめのタイムチャート', '空のタイムチャート', '押し方も正解も描いていない状態から始めます。', '配線済みの盤', '自分で配線する盤', '始める']) };
    });
    await page.getByTestId('lab-start-template').selectOption('self-hold');
    await page.getByTestId('lab-start-go').click();
    await confirmChange();
    await expect(page.getByTestId('lab-panel')).toBeVisible({ timeout: 60_000 });
    await expectText('15-wiring-mode', '15 PLC実験の配線', '手順の帯の右に「盤: 配線済み」', page.getByTestId('lab-wiring-mode'), ['盤: 配線済み']);
    await claim('15-fixed-count', '15 PLC実験の配線', '状態の表示に「自分で張った電線 0 本（固定 32 本）」（本数は機種で変わる）', async () => {
      await page.getByTestId('view-board').click();
      const observed = await textOf(page.getByTestId('status-overlay'));
      return { observed, ok: /自分で張った電線 0 本（固定 \d+ 本）/u.test(observed) };
    });
    await claim('15-restart', '15 PLC実験の配線', '「配線をやり直す」→「盤を作り直しますか？」。「配線済みの盤」「自分で配線する盤」「作り直す」', async () => {
      await page.getByTestId('lab-restart-board').click();
      const observed = await textOf(page.getByTestId('lab-restart'));
      await page.getByRole('button', { name: '取消', exact: true }).last().click().catch(() => undefined);
      await page.keyboard.press('Escape');
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['盤を作り直しますか？', '配線済みの盤', '自分で配線する盤', '作り直す']) };
    });
    await claim('15-run-needs-convert', '15 動かして確かめる', 'PLC実験で変換していないと「変換（F4）を通してから動かします」のように知らせる', async () => {
      await page.getByTestId('lab-run').click();
      await page.waitForTimeout(800);
      const observed = `${await textOf(page.getByTestId('lab-status'))} ${await textOf(page.getByTestId('toast'))}`;
      return { observed: observed.trim(), ok: observed.includes('変換') || observed.includes('ラダーがありません') };
    });
    await goHome();
    await page.getByTestId('mode-assemble-lab').click();
    await page.getByTestId('lab-start-template').selectOption('self-hold');
    await page.getByTestId('lab-start-go').click();
    await confirmChange();
    await expect(page.getByTestId('lab-panel')).toBeVisible({ timeout: 60_000 });
    await claim('15-panel', '15 このモードでやること', '右の欄の「タイムチャート実験」。「大きく開いて編集」「動かす」「盤で動きを見る」「配線をやり直す」', async () => {
      const observed = await textOf(page.getByTestId('lab-panel'));
      return { observed: observed.slice(0, 260), ok: includesAll(observed, ['タイムチャート実験', '大きく開いて編集', '動かす', '盤で動きを見る', '配線をやり直す']) };
    });
    await claim('15-status', '15 動かして確かめる', '「まだ動かしていません」→ 動かすと「正解と違う所が◯件あります」', async () => {
      const before = await textOf(page.getByTestId('lab-status'));
      await page.getByTestId('lab-run').click();
      await expect(page.getByTestId('lab-status')).toContainText('正解と違う所', { timeout: 60_000 });
      const after = await textOf(page.getByTestId('lab-status'));
      return { observed: `${before} → ${after}`, ok: before.includes('まだ動かしていません') && /正解と違う所が\d+件あります/u.test(after) };
    });
    await claim('15-editor', '15 押し方を描く', '「タイムチャートを描く」の窓。「長さ」「例題を読み込む…」「押し方を消す」「正解を消す」「区間を足す」「削除」「動かす」「閉じる」。「判定に使う」', async () => {
      await page.getByTestId('lab-open-editor').click();
      const observed = await textOf(page.getByTestId('lab-editor'));
      return { observed: observed.slice(0, 300), ok: includesAll(observed, ['タイムチャートを描く', '長さ', '例題を読み込む', '押し方を消す', '正解を消す', '区間を足す', '削除', '動かす', '閉じる', '判定に使う']) };
    });
    await claim('15-capture', '15 正解を作る', '「この結果を正解にする」→ 確かめの1行 → 「取り込む」', async () => {
      await page.getByTestId('lab-capture').click();
      const observed = await textOf(page.getByTestId('lab-capture-confirm').locator('xpath=..'));
      await page.getByTestId('lab-capture-confirm').click();
      await page.getByTestId('lab-close').click();
      return { observed: observed.slice(0, 160), ok: observed.includes('取り込む') };
    });
    await claim('15-judge-note', '15 判定する', '正解があるとき「正解と比べるときは、上の「判定」を押します」', async () => {
      const observed = await textOf(page.getByTestId('lab-panel'));
      return { observed: observed.slice(0, 200), ok: observed.includes('正解と比べるときは、上の「判定」を押します') };
    });
    await claim('15-result', '15 判定する', '合格なら「描いた正解どおりに動き、配線の検査もすべて通りました。」「チャート重ね表示（薄色＝描いた正解／濃色＝動かした結果）」。「正解と見くらべる」', async () => {
      await page.getByTestId('judge-button').click();
      await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
      const observed = await textOf(page.locator('body'));
      return { observed: observed.slice(0, 200), ok: includesAll(observed, ['描いた正解どおり', 'チャート重ね表示（薄色＝描いた正解／濃色＝動かした結果）', '正解と見くらべる']) };
    });
  });

  test('09 設定・08 作業ファイル', async () => {
    await goHome();
    await page.getByTestId('open-settings').click();
    await claim('09-fields', '09 設定の画面', '「文字と UI の大きさ」「見やすさ」「利用者課題フォルダ」「効果音」「音量」「起動時に前回の作業の復元を確認する」「既定メーカー」「列数はメーカーの既定に従う」「ラダーの表示列数」「通電色はメーカーの既定に従う」「通電色」「既定に戻す」', async () => {
      const observed = await textOf(page.locator('body'));
      return { observed: observed.slice(0, 120), ok: includesAll(observed, ['文字と UI の大きさ', '見やすさ', '利用者課題フォルダ', '効果音', '音量', '起動時に前回の作業の復元を確認する', '既定メーカー', '列数はメーカーの既定に従う', 'ラダーの表示列数', '通電色はメーカーの既定に従う', '通電色', '既定に戻す']) };
    });
    await claim('09-skin-assumed', '09 PLCの既定のメーカー', 'メーカー欄の下の「画面の見た目の前提」に、確認できていない表記・命令名・キー割当', async () => {
      const observed = await textOf(page.getByTestId('skin-assumed'));
      return { observed: observed.slice(0, 160), ok: observed.includes('画面の見た目の前提') };
    });
    await expectText('09-tour', '09 設定の画面', '「案内をもう一度見る」', page.getByTestId('setting-restart-tour'), ['案内をもう一度見る']);
    await expectText('09-authoring', '09 自分で作った課題を読み込む', '「課題の導入・作成」', page.getByTestId('problem-authoring-summary'), ['課題の導入・作成']);
    await claim('09-grid-cols-help', '09 ラダーの見た目', '「ラダー編集画面の接点の列数（8〜15）。メーカーの既定は 11 です。」', async () => {
      const observed = await textOf(page.getByTestId('grid-cols-help'));
      return { observed, ok: observed.includes('8〜15') && observed.includes('11') };
    });
    await claim('08-autosave', '08 自動保存と通常終了', '画面右下の「自動保存済み」と保存時刻', async () => {
      await goHome();
      await openProblem('mode-assemble', 'b-001');
      await waitForBoard();
      await page.waitForTimeout(2500);
      const observed = await textOf(page.getByTestId('autosave-status'));
      return { observed, ok: /自動保存(済み|待ち|中)/u.test(observed) };
    });
    await claim('02-continue-card', '02 ホームの画面', '前に開いた課題があると「最近の課題」としてモード・課題名・かかった時間。「続きから始める」', async () => {
      await goHome();
      const observed = await textOf(page.getByTestId('continue-card'));
      return { observed: observed.slice(0, 200), ok: observed.includes('続きから') && observed.includes('自己保持回路') };
    });
    await claim('08-restore-prompt', '08 前回の作業を復元する', '起動時に「前回の作業を復元しますか？」「復元する」「復元しない」「後で決める」', async () => {
      await app.close();
      ({ app, page } = await launchApp({ contentSize: { width: 1440, height: 900 }, userDataDir, keepRestorePrompt: true, home: 'restore-prompt' }));
      const prompt = page.getByTestId('restore-prompt');
      await expect(prompt).toBeVisible({ timeout: 60_000 });
      const observed = await textOf(prompt);
      await page.getByRole('button', { name: '復元しない', exact: true }).click().catch(() => undefined);
      return { observed: observed.slice(0, 220), ok: includesAll(observed, ['前回の作業を復元しますか？', '復元する', '復元しない', '後で決める']) };
    });
  });
});
