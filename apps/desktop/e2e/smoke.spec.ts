import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { boardPoint, SELF_HOLD_WIRES, terminalPoint, type CanvasBox } from './projection.js';

/**
 * Electron スモーク（§14.2 の E2E ①）。設計仕様 §16 Phase 1 受入基準①〜③。
 * 「起動 → 課題選択 → 配線 → 通電 → 判定 → 結果」を自動操作し、3D盤のスクリーンショットを残す。
 *
 * WebGL: CI やリモートデスクトップでは GPU が無いことがあるため、Chromium に
 * `--use-gl=swiftshader --use-angle=swiftshader --enable-unsafe-swiftshader` を渡して
 * ソフトウェアラスタライザで描かせる。GPU のある実機でも同じフラグで動く。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

/**
 * スクリーンショットは `BrowserWindow.capturePage()` で撮る。
 * Playwright の `page.screenshot()` は Electron のウィンドウが他ウィンドウに隠れていると
 * `Unable to capture screenshot` で失敗することがあるが、`capturePage()` は
 * コンポジタから直接取るので隠れていても撮れる（WebGL の描画内容も入る）。
 */
async function shot(app: ElectronApplication, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(base64, 'base64'));
}

async function canvasBox(page: Page): Promise<CanvasBox> {
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/**
 * ソケット S1 の台座の左端（端子より外側の余白）。盤ローカル mm。
 * `JIPM_BOARD` のソケット原点とピッチから求めるので、配置が変わっても追随する。
 */
function socketEdgePoint(): { x: number; y: number; z: number } {
  const socket = JIPM_BOARD.sockets[0];
  if (socket === undefined) throw new Error('ソケットが定義されていません');
  // 本体の中央（差込領域）。ネジ端子のティアから離れているのでソケット本体が拾える
  return {
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: 9,
  };
}

/** 端子を1つクリックする（正面視プリセット前提の射影）。矩形は1度だけ測って使い回す。 */
async function clickTerminal(page: Page, box: CanvasBox, terminal: string): Promise<void> {
  const point = terminalPoint(toTerminalId(terminal), box);
  await page.mouse.click(point.x, point.y);
}

test.describe('モードB スモーク', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // ウィンドウは `ready-to-show` まで非表示なので、スクリーンショットが撮れるよう
    // 明示的に表示して大きさを固定する（Electron のページに setViewportSize は効かない）。
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      window.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
      window.show();
      window.focus();
    });
    // 表示直後はコンポジタがまだフレームを出しておらず `capturePage()` が
    // `UnknownVizError` になることがあるので、最初の1フレームを待つ。
    await page.waitForTimeout(1500);
    // 前回の実行が残した一時保存があると復元プロンプトが出るので、先に片付ける（§12.3）
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('ホーム → 課題一覧 → 課題を開く → 配線 → 判定 → 結果画面', async () => {
    // ① ホーム（§12.1）
    await expect(page.getByTestId('mode-assemble')).toBeVisible();
    await shot(app, '01-home');

    // ② 課題一覧（§12.1）
    await page.getByTestId('mode-assemble').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await expect(page.getByTestId('open-b-001')).toBeVisible();
    await shot(app, '02-problem-list');

    // ③ 課題を開く → 3D盤（§8.1）
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expect(page.getByTestId('status-overlay')).toContainText('電線 3 本');
    // WebGL の初期化とシーンの1フレーム目を待つ
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);
    await shot(app, '03-board-3d');

    // ④ ソケット S1 にリレーを装着する（3Dでソケット台座をクリック → 部品パネル）（§8.2）
    const box = await canvasBox(page);
    // S1 台座の左端（端子より外側の余白。盤ローカル mm で指定する）をクリックする
    const socketEdge = boardPoint(socketEdgePoint(), box);
    await page.mouse.click(socketEdge.x, socketEdge.y);
    await expect(page.getByText('S1（CR1）を選択中')).toBeVisible();
    await page.getByRole('button', { name: '装着' }).first().click();
    await expect(page.getByTestId('operation-log')).toContainText('S1 に relay-my4n を装着');
    await shot(app, '04-relay-mounted');

    // ⑤ 端子クリックで模範どおりに配線する（§8.2）
    for (const [from, to] of SELF_HOLD_WIRES) {
      await clickTerminal(page, box, from);
      await clickTerminal(page, box, to);
    }
    await expect(page.getByTestId('status-overlay')).toContainText('電線 12 本');
    await shot(app, '05-wired');

    // ⑤-1 配線帯で束になって直角に走る様子をソケット拡大で1枚撮る（§6.6）
    await page.getByRole('button', { name: 'ソケット拡大' }).click();
    await page.waitForTimeout(900);
    await shot(app, '05a-wire-bundle');
    await page.getByRole('button', { name: '正面' }).click();
    await page.waitForTimeout(600);

    // ⑤-2 実物写真と同じ斜め俯瞰で1枚撮る（§12.2 の俯瞰プリセット）
    await page.getByRole('button', { name: '俯瞰' }).click();
    await page.waitForTimeout(900);
    await shot(app, '05b-board-birdseye');
    await page.getByRole('button', { name: '正面' }).click();
    await page.waitForTimeout(600);

    // ⑥ ブレーカ → 電源スイッチ の順に通電（§5.3.5）
    await page.getByRole('button', { name: 'ブレーカ' }).click();
    await page.getByRole('button', { name: '電源スイッチ' }).click();
    await expect(page.getByTestId('status-overlay')).toContainText('通電中');
    await shot(app, '06-powered');

    // ⑦ 判定 → 結果画面（§8.3 / §16 Phase 1 受入基準②）
    await page.getByRole('button', { name: '判定' }).click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('chart-overlay')).toBeVisible();
    await expect(page.getByTestId('no-mismatch')).toBeVisible();
    await shot(app, '07-result-pass');

    // ⑧ 1本外して判定すると不合格になる（§16 Phase 1 受入基準③）
    await page.getByRole('button', { name: 'もう一度' }).click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.waitForTimeout(500);
    const retryBox = await canvasBox(page);
    const edge = boardPoint(socketEdgePoint(), retryBox);
    await page.mouse.click(edge.x, edge.y);
    await page.getByRole('button', { name: '装着' }).first().click();
    for (const [from, to] of SELF_HOLD_WIRES.slice(0, -1)) {
      await clickTerminal(page, retryBox, from);
      await clickTerminal(page, retryBox, to);
    }
    await expect(page.getByTestId('status-overlay')).toContainText('電線 11 本');
    await page.getByRole('button', { name: '判定' }).click();
    await expect(page.getByTestId('verdict')).toHaveText('不合格');
    await expect(page.getByTestId('mismatch-table')).toBeVisible();
    await shot(app, '08-result-fail');
  });
});
