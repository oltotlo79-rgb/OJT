import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './app.js';
import { captureReady } from './capture.js';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { powerWellCenterMm } from '../src/renderer/three/AcFixtures.js';
import { findFixtureFootprint, FIXTURE_HEIGHT_MM } from '../src/renderer/three/Fixtures.js';
import {
  boardPoint,
  plcBoardPoint,
  terminalPoint,
  wireCountText,
  type CanvasBox,
} from './projection.js';

/**
 * 3D盤の直接操作（Phase 7 Task 27 / 指摘 UX-08・PR-11 / 利用者要望9）。
 *
 * 利用者の言葉は「3D図をクリックして電源をON/OFFしたり配線したりドラッグして部品を配置したり
 * できない」だった。ここで確かめるのは**その3つがマウスだけでできること**である。
 * ①ブレーカを押すと状態表示が変わる ②パレットからソケットへ運ぶと装着される
 * ③端子から端子へドラッグすると電線が1本増える。
 *
 * **このファイルの test は上から順に流す前提**（`perf.spec.ts` と同じ流儀）。1本目が開いた
 * 課題を2本目以降が引き継ぐ。
 */

/**
 * スクリーンショットの置き場。**既定は一時フォルダ**にする（QA-02: `e2e` が追跡対象の
 * `screenshots/` を書き換えると、その直後の `dist` が別物の PDF を焼いてしまう）。
 */
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(tmpdir(), 'shots-p7-27');

/** 組立課題に点検用の固定配線を追加しない。 */
const FIXED_WIRES = 0;

async function shot(app: ElectronApplication, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const base64 = await captureReady(() =>
    app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      const image = await window.capturePage();
      return image.toPNG().toString('base64');
    }),
  );
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(base64, 'base64'));
}

async function canvasBox(page: Page): Promise<CanvasBox> {
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/** 電源の操作部（ハンドル窓／ロッカー窓）が来るページ座標。寸法の正本は `AcFixtures.tsx`。 */
function powerPoint(
  kind: 'breaker' | 'switch',
  box: CanvasBox,
  plc = false,
): { x: number; y: number } {
  const footprint = findFixtureFootprint(JIPM_BOARD.footprints, kind);
  if (footprint === undefined) throw new Error(`機器の外形がありません: ${kind}`);
  return (plc ? plcBoardPoint : boardPoint)(
    powerWellCenterMm(footprint, kind, FIXTURE_HEIGHT_MM),
    box,
  );
}

/** ソケット本体（差込領域）の中央が来るページ座標。 */
function socketPoint(index: number, box: CanvasBox): { x: number; y: number } {
  const socket = JIPM_BOARD.sockets[index];
  if (socket === undefined) throw new Error(`ソケットがありません: ${String(index)}`);
  return boardPoint(
    {
      x: socket.origin.x + socket.bodyMm.width / 2,
      y: socket.origin.y + socket.bodyMm.length / 2,
      z: 9,
    },
    box,
  );
}

/** つまんで運ぶ（`pointerdown` → 何度かに分けて動かす → `pointerup`）。設計 §7.3.1 の 4px を必ず超える。 */
async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { pauseAt?: number } = {},
): Promise<void> {
  await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
    );
    if (options.pauseAt === step) await page.waitForTimeout(250);
  }
  await page.mouse.up();
  await page.keyboard.up('Alt');
}

test.describe.serial('3D盤の直接操作（利用者要望9）', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp());
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('① 3Dのブレーカと電源スイッチを押すと状態表示が変わる', async () => {
    const box = await canvasBox(page);
    await expect(page.getByTestId('power-breaker')).toHaveAttribute('aria-pressed', 'false');

    const breaker = powerPoint('breaker', box);
    await page.mouse.move(breaker.x, breaker.y);
    // 指しただけで「押すと何が起きるか」が下端に出る（設計 §7.3.4）
    await expect(page.getByTestId('hover-hint')).toContainText('ブレーカ');
    await page.mouse.click(breaker.x, breaker.y);

    await expect(page.getByTestId('power-breaker')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('operation-log')).toContainText('ブレーカ');
    await shot(app, '01-breaker-clicked');

    const switchPoint = powerPoint('switch', box);
    await page.mouse.click(switchPoint.x, switchPoint.y);
    await expect(page.getByTestId('power-switch')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status-overlay')).toContainText('通電中');

    // もう一度押すと切れる（同じところを押せば戻せる）
    await page.mouse.click(switchPoint.x, switchPoint.y);
    await expect(page.getByTestId('power-switch')).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.click(breaker.x, breaker.y);
    await expect(page.getByTestId('power-breaker')).toHaveAttribute('aria-pressed', 'false');
  });

  test('② パレットの部品をソケットへ運ぶと装着される', async () => {
    const box = await canvasBox(page);
    const card = page.getByTestId('palette-relay-my4n');
    await expect(card).toBeVisible();
    const cardBox = await card.boundingBox();
    if (cardBox === null) throw new Error('カードの矩形を取得できませんでした');

    await dragTo(
      page,
      { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
      socketPoint(0, box),
      // 途中で止めてゴーストと光ったソケットを1枚撮る
      { pauseAt: 7 },
    );

    await expect(page.getByTestId('operation-log')).toContainText('S1 に リレー MY4N を装着');
    await expect(page.getByTestId('socket-card-status')).toContainText('S1');
    await shot(app, '02-part-dropped');
  });

  test('② 途中の絵（ゴーストと光るソケット）を1枚残す', async () => {
    const box = await canvasBox(page);
    const card = page.getByTestId('palette-timer-h3y4');
    const cardBox = await card.boundingBox();
    if (cardBox === null) throw new Error('カードの矩形を取得できませんでした');
    const target = socketPoint(4, box);

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(
        cardBox.x + cardBox.width / 2 + ((target.x - cardBox.x - cardBox.width / 2) * step) / 6,
        cardBox.y + cardBox.height / 2 + ((target.y - cardBox.y - cardBox.height / 2) * step) / 6,
      );
    }
    await page.waitForTimeout(400);
    // ゴーストが指に付いてきていて、落とす先のソケットが光っている
    await expect(page.getByTestId('drag-ghost')).toBeVisible();
    await shot(app, '02a-part-dragging');
    await page.mouse.up();
    await page.keyboard.up('Alt');
  });

  test('③ 端子から端子へドラッグすると電線が1本増える', async () => {
    const box = await canvasBox(page);
    const before = page.getByTestId('status-overlay');
    await expect(before).toContainText(wireCountText(FIXED_WIRES, FIXED_WIRES));

    const from = terminalPoint(toTerminalId('P.1'), box);
    const to = terminalPoint(toTerminalId('TB_PB.2c'), box);

    // 途中まで引いて、仮の電線と「つなげる端子（緑）」が出ている1枚を撮る
    await page.keyboard.down('Alt');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / 8,
        from.y + ((to.y - from.y) * step) / 8,
      );
    }
    await page.waitForTimeout(400);
    await expect(page.getByTestId('status-overlay')).toContainText('始点: P.1');
    await shot(app, '03-wire-preview');
    for (let step = 6; step <= 8; step += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / 8,
        from.y + ((to.y - from.y) * step) / 8,
      );
    }
    await page.mouse.up();
    await page.keyboard.up('Alt');

    await expect(page.getByTestId('status-overlay')).toContainText(
      wireCountText(FIXED_WIRES + 1, FIXED_WIRES),
    );
    await expect(page.getByTestId('status-overlay')).toContainText('端子未選択');
  });

  test('③ Alt＋端子ドラッグでは視点を動かさず配線する', async () => {
    const readout = page.getByTestId('camera-readout');
    const before = await readout.textContent();
    const box = await canvasBox(page);
    const from = terminalPoint(toTerminalId('S1.9'), box);
    await dragTo(page, from, { x: from.x + 140, y: from.y + 40 });
    await page.waitForTimeout(500);
    expect(await readout.textContent()).toBe(before);
  });

  test('配線中のポインタ中断とアプリ切替を取り消し、次の視点操作ができる', async () => {
    const box = await canvasBox(page);
    const from = terminalPoint(toTerminalId('P.1'), box);
    for (const event of ['pointercancel', 'blur']) {
      await page.keyboard.down('Alt');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 70, from.y + 35, { steps: 5 });
      await expect(page.getByTestId('status-overlay')).toContainText('始点: P.1');
      await page.evaluate((kind) => {
        window.dispatchEvent(kind === 'pointercancel' ? new PointerEvent(kind) : new Event(kind));
      }, event);
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await expect(page.getByTestId('status-overlay')).toContainText('端子未選択');
      await expect(page.getByTestId('status-overlay')).toContainText(
        wireCountText(FIXED_WIRES + 1, FIXED_WIRES),
      );
    }
    const before = await page.getByTestId('camera-readout').textContent();
    await dragTo(
      page,
      { x: box.x + 20, y: box.y + box.height - 70 },
      { x: box.x + 60, y: box.y + box.height - 40 },
    );
    await expect(page.getByTestId('camera-readout')).not.toHaveText(before ?? '');
  });
});

for (const [mode, id] of [
  ['inspect-parts', 'c1-001'],
  ['inspect-repair', 'c2-001'],
  ['plc', 'd-001'],
] as const) {
  test(`${mode}でも3Dの電源操作がツールバーへ反映される`, async () => {
    const { app, page } = await launchApp();
    try {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900),
      );
      await page.getByTestId(`mode-${mode}`).click();
      await page
        .getByTestId('grade-filter')
        .getByRole('button', { name: 'すべて', exact: true })
        .click();
      await page.getByTestId(`open-${id}`).click();
      if (mode === 'plc') await page.getByTestId('view-board').click();
      await expect(page.getByTestId('camera-readout')).toBeAttached();
      await page.waitForTimeout(800);
      const box = await canvasBox(page);
      for (const fixture of ['breaker', 'switch'] as const) {
        const point = powerPoint(fixture, box, mode === 'plc');
        await page.mouse.click(point.x, point.y);
        await expect(page.getByTestId(`power-${fixture}`)).toHaveAttribute('aria-pressed', 'true');
      }
      for (const fixture of ['switch', 'breaker'] as const) {
        const point = powerPoint(fixture, box, mode === 'plc');
        await page.mouse.click(point.x, point.y);
        await expect(page.getByTestId(`power-${fixture}`)).toHaveAttribute('aria-pressed', 'false');
      }
      if (mode === 'plc') {
        const card = page.getByTestId('palette-relay-my4n');
        await card.scrollIntoViewIfNeeded();
        const cardBox = await card.boundingBox();
        const socket = JIPM_BOARD.sockets[0];
        if (cardBox === null || socket === undefined) throw new Error('部品の置き場所がありません');
        const point = plcBoardPoint(
          {
            x: socket.origin.x + socket.bodyMm.width / 2,
            y: socket.origin.y + socket.bodyMm.length / 2,
            z: 9,
          },
          box,
        );
        await dragTo(
          page,
          { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
          point,
        );
        await expect(page.getByTestId('operation-log')).toContainText('S1 に リレー MY4N を装着');
        await expect(page.getByTestId('socket-card-status')).toContainText('S1');
      }
    } finally {
      await app.close();
    }
  });
}
