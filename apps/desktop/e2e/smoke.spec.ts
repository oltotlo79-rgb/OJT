import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './app.js';
import {
  boardPoint,
  SELF_HOLD_WIRES,
  selectView,
  terminalPoint,
  wireCountText,
  type CanvasBox,
} from './projection.js';

/**
 * Electron スモーク（§14.2 の E2E ①）。設計仕様 §16 Phase 1 受入基準①〜③。
 * 「起動 → 課題選択 → 配線 → 通電 → 判定 → 結果」を自動操作し、3D盤のスクリーンショットを残す。
 *
 * WebGL: CI やリモートデスクトップでは GPU が無いことがあるため、Chromium に
 * `--use-gl=swiftshader --use-angle=swiftshader --enable-unsafe-swiftshader` を渡して
 * ソフトウェアラスタライザで描かせる。GPU のある実機でも同じフラグで動く。
 */

/**
 * 内蔵課題 b-001 の固定配線（チェック用回路の既設配線）の本数。§6.3
 * 状態オーバーレイは「自分で張った電線 N 本（固定 M 本）」と出すので、
 * 期待値を作るときに総数と固定本数の両方が要る（UXレビュー #21）。
 */
const FIXED_WIRES = 3;

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
    ({ app, page } = await launchApp());
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
    await expect(page.getByTestId('status-overlay')).toContainText(wireCountText(3, FIXED_WIRES));
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
    await expect(page.getByTestId('operation-log')).toContainText('S1 に リレー MY4N を装着');
    await shot(app, '04-relay-mounted');

    // ⑤ 端子クリックで模範どおりに配線する（§8.2）
    for (const [from, to] of SELF_HOLD_WIRES) {
      await clickTerminal(page, box, from);
      await clickTerminal(page, box, to);
    }
    await expect(page.getByTestId('status-overlay')).toContainText(wireCountText(12, FIXED_WIRES));
    await shot(app, '05-wired');

    // ⑤-1 配線帯で束になって直角に走る様子をソケット拡大で1枚撮る（§6.6）
    await selectView(page, 'ソケット拡大');
    await page.waitForTimeout(900);
    await shot(app, '05a-wire-bundle');
    await selectView(page, '正面');
    await page.waitForTimeout(600);

    // ⑤-2 実物写真と同じ斜め俯瞰で1枚撮る（§12.2 の俯瞰プリセット）
    await selectView(page, '俯瞰');
    await page.waitForTimeout(900);
    await shot(app, '05b-board-birdseye');
    await selectView(page, '正面');
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
    await expect(page.getByTestId('status-overlay')).toContainText(wireCountText(11, FIXED_WIRES));
    await page.getByRole('button', { name: '判定' }).click();
    await expect(page.getByTestId('verdict')).toHaveText('不合格');
    await expect(page.getByTestId('mismatch-table')).toBeVisible();
    await shot(app, '08-result-fail');
  });
});
