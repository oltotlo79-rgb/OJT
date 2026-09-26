import {
  addWire,
  createSession,
  deskRoutes,
  JIPM_BOARD,
  plcUnitFor,
  withPlcUnit,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, toSocketRoles } from '@ojt/content';
import type { TerminalId } from '@ojt/circuit-sim';
import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './app.js';
import { boardPoint, plcBoardPointFor, plcTerminalPointFor, type CanvasBox } from './projection.js';

/**
 * 操作の総点検（2026-09-26 利用者指示「実際に選択しても配線されない、削除できない、動作しない部分
 * などないように徹底して調査し不具合あれば修正すること」）。
 *
 * 総点検で見つけて直した不具合がもう一度起きないことを、実際のクリック・キー操作で確かめる。
 * - PLC本体の全端子（4メーカー）が3Dで押して配線の始点になる
 * - PLC本体へつないだ机上の電線を3Dで押して選び、Delete で外せる（以前は選べなかった）
 * - 2本つながった端子へ3本目をつなごうとすると注意文が出て、電線は増えない
 * - 盤だけの表示からメーカーを切り替えられ、盤内の電線は残る
 * - 点検修復で部品を押すと、押した場所の横に故障の内容まで選べる小窓が出る
 */

const WINDOW = { width: 1440, height: 900 } as const;
const PROBLEM = BUILTIN_PLC_PROBLEMS[0]!;
const ROLES = toSocketRoles(PROBLEM.board.socketRoles);
const VENDORS = [
  ['mitsubishi', 'FX5U'],
  ['jtekt', 'PC10G-1SP'],
  ['omron', 'CP1E'],
  ['sharp', 'JW-300'],
] as const;

async function canvasBox(page: Page): Promise<CanvasBox> {
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/** 既定メーカーを設定した状態で PLC の課題を開き、盤だけの表示にする。 */
async function openPlcBoard(vendor: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const { app, page } = await launchApp({ window: WINDOW, home: 'mode-plc' });
  await page.getByTestId('open-settings').click();
  const select = page.getByTestId('setting-vendor');
  if ((await select.inputValue()) !== vendor) {
    await select.selectOption(vendor);
    await expect(page.getByTestId('toast').filter({ hasText: '設定を保存しました' })).toHaveCount(
      1,
    );
  }
  await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
  await page.getByTestId('mode-plc').click();
  await page.getByTestId(`open-${PROBLEM.id}`).click();
  await page.getByTestId('view-board').click();
  await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'board');
  await page.waitForTimeout(2500);
  return { page, close: () => app.close() };
}

for (const [vendor, model] of VENDORS) {
  test(`${vendor}: PLC本体の全端子が3Dで押せて、机上の電線を3Dで選んで外せる`, async () => {
    const unit = plcUnitFor(model) as PlcUnitDefinition;
    const { page, close } = await openPlcBoard(vendor);
    try {
      const box = await canvasBox(page);
      const overlay = page.getByTestId('status-overlay');
      for (const terminal of unit.terminals) {
        const p = plcTerminalPointFor(unit, ROLES, String(terminal.id), box);
        await page.mouse.click(p.x, p.y);
        await expect(overlay, String(terminal.id)).toContainText(`始点: ${String(terminal.id)}`);
        await page.keyboard.press('Escape');
        await expect(overlay).toContainText('端子未選択');
      }

      // 盤の押ボタン端子台から入力 X0（相当）へ1本
      const input = unit.terminals.find(
        (t) => String(t.id) === `PLC.${unit.spec.inputs[0]!.name}`,
      )!;
      for (const id of ['TB_PB.1a', String(input.id)]) {
        const p = plcTerminalPointFor(unit, ROLES, id, box);
        await page.mouse.click(p.x, p.y);
      }
      await expect(overlay).toContainText('自分で張った電線 1 本');

      // 机上の電線（幹線の長い区間の中ほど）を押して選び、Delete で外す
      const board = withPlcUnit(JIPM_BOARD, unit);
      const session = createSession(board, { roles: ROLES, includeCheckWires: false });
      addWire(session, board, 'TB_PB.1a' as TerminalId, input.id);
      const corners = deskRoutes(board, session)[0]!.corners;
      let selected = false;
      for (let i = 1; i < corners.length && !selected; i += 1) {
        const a = corners[i - 1]!;
        const b = corners[i]!;
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 20) continue;
        const mid = plcBoardPointFor(
          unit,
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 },
          box,
        );
        await page.mouse.click(mid.x, mid.y);
        await page.waitForTimeout(150);
        selected = ((await overlay.textContent()) ?? '').includes('選択:');
        if (!selected) await page.keyboard.press('Escape');
      }
      expect(selected, '机上の電線を3Dで選べませんでした').toBe(true);
      await page.keyboard.press('Delete');
      await expect(overlay).toContainText('自分で張った電線 0 本');
    } finally {
      await close();
    }
  });
}

test('3本目の配線は注意文で止まり、盤内の電線はメーカーを切り替えても残る', async () => {
  const unit = plcUnitFor('FX5U') as PlcUnitDefinition;
  const { page, close } = await openPlcBoard('mitsubishi');
  try {
    const box = await canvasBox(page);
    const overlay = page.getByTestId('status-overlay');
    const click = async (id: string): Promise<void> => {
      const p = plcTerminalPointFor(unit, ROLES, id, box);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(120);
    };
    // P.1 に2本（盤内）
    await click('P.1');
    await click('TB_PB.1c');
    await click('P.1');
    await click('TB_PB.2c');
    await expect(overlay).toContainText('自分で張った電線 2 本');
    // 3本目: 始点に選ぶと注意文が出て、配線は始まらない
    await click('P.1');
    const notice = page.getByTestId('wire-limit-notice');
    await expect(notice).toContainText('2本まで');
    await expect(notice).toContainText('P.1');
    await expect(overlay).toContainText('端子未選択');
    await expect(overlay).toContainText('自分で張った電線 2 本');
    await page.getByTestId('wire-limit-close').click();
    await expect(notice).toHaveCount(0);

    // PLC本体へも1本張ってから、盤だけの表示のままメーカーを切り替える
    await click('TB_PB.3a');
    await click('PLC.X0');
    await expect(overlay).toContainText('自分で張った電線 3 本');
    await page.getByTestId('switch-vendor').click();
    await page.getByTestId('notation-to-omron').click();
    await expect(page.getByTestId('notation-warning')).toContainText('配線1本は外れます');
    await expect(page.getByTestId('notation-warning')).toContainText('盤内の配線2本');
    await page.getByTestId('notation-apply').click();
    await expect(page.getByTestId('plc-model')).toContainText('CP1E');
    await expect(overlay).toContainText('自分で張った電線 2 本');
  } finally {
    await close();
  }
});

test('点検修復: 部品を押すと、押した場所の横に故障の内容まで選べる小窓が出る', async () => {
  const { app, page } = await launchApp({ window: WINDOW });
  try {
    await page.getByTestId('mode-inspect-repair').click();
    await page
      .getByTestId('grade-filter')
      .getByRole('button', { name: 'すべて', exact: true })
      .click();
    await page.getByTestId('open-c2-001').click();
    await page.getByTestId('tool-report').click();
    // 開いた直後は視点の補間中なので、盤が止まるのを待ってから部品の位置を押す
    await page.waitForTimeout(2500);
    const box = await canvasBox(page);
    const socket = JIPM_BOARD.sockets[0]!;
    const p = boardPoint(
      {
        x: socket.origin.x + socket.bodyMm.width / 2,
        y: socket.origin.y + socket.bodyMm.length / 2,
        z: 9,
      },
      box,
    );
    await page.mouse.click(p.x, p.y);
    const popover = page.getByTestId('report-popover');
    await expect(popover).toBeVisible();
    // 小窓は3Dの中（ビューポート）に出る
    const inViewport = await popover.evaluate((el) =>
      Boolean(el.closest('[data-testid="viewport"]')),
    );
    expect(inViewport).toBe(true);
    await expect(page.getByTestId('report-detail-coil-open')).toBeVisible();
    await page.getByTestId('report-detail-coil-open').click();
    await expect(page.getByTestId('report-kind-text-0')).toHaveText('部品不良（コイル断線）');
  } finally {
    await app.close();
  }
});
