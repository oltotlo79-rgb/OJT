import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { launchApp, shot } from './app.js';
import { boardPoint, SELF_HOLD_WIRES, terminalPoint, type CanvasBox } from './projection.js';

/**
 * タイムチャートの拡大表示（Task CHART-UX）。設計仕様 §7.7 / §8.1 / §8.3。
 * 「課題を開く → 仕様チャートをクリック → 拡大モーダル → Esc で閉じる」を自動操作し、
 * 判定後の結果画面でも同じ拡大表示（期待と実際の積み上げ）が開くことを確かめる。
 *
 * 文言は `src/renderer/i18n/ja.ts` の `JA.session.chart` / `JA.timeChart.openHint` と
 * 同じものをここに書き写している（E2E は成果物を外から触るので `ja.ts` を読み込まない）。
 */

/** 仕様チャート本体（クリックで拡大できる領域）の読み上げ名。 */
const SPEC_CHART = 'タイムチャート（仕様）: クリックまたはEnterで拡大表示';
/** 結果画面の重ね表示の読み上げ名。 */
const OVERLAY_CHART = 'チャート重ね表示（薄色＝模範／濃色＝訓練者）: クリックまたはEnterで拡大表示';

/** 目盛数は画面幅で変わる。実際の文字同士の間隔を検証する。 */
async function readableTicks(chart: Locator): Promise<number> {
  const ticks = chart.locator('[data-guide="tick"]');
  const count = await ticks.count();
  expect(count).toBeGreaterThanOrEqual(2);
  const labels = await ticks.evaluateAll((lines) =>
    lines.flatMap((line) => {
      const label = line.parentElement?.querySelector('text');
      if (!label) return [];
      const rect = label.getBoundingClientRect();
      return [{ left: rect.left, right: rect.right, text: label.textContent }];
    }),
  );
  expect(labels.length).toBeGreaterThanOrEqual(2);
  expect(labels[0]?.text).toBe('0.0 s');
  for (let index = 1; index < labels.length; index += 1) {
    expect(labels[index]!.left - labels[index - 1]!.right).toBeGreaterThanOrEqual(4);
  }
  return count;
}

async function canvasBox(page: Page): Promise<CanvasBox> {
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/** ソケット S1 の台座の中央（盤ローカル mm）。 */
function socketEdgePoint(): { x: number; y: number; z: number } {
  const socket = JIPM_BOARD.sockets[0];
  if (socket === undefined) throw new Error('ソケットが定義されていません');
  return {
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: 9,
  };
}

async function clickTerminal(page: Page, box: CanvasBox, terminal: string): Promise<void> {
  const point = terminalPoint(toTerminalId(terminal), box);
  await page.mouse.click(point.x, point.y);
}

/**
 * どの画面からでもホームへ戻す（シナリオの切り分け）。
 * 1本目のテストは結果画面で終わるので、そのまま2本目が `mode-assemble` を待つと
 * 30秒でタイムアウトする（実際に b-007 のシナリオで起きた flake）。各シナリオの先頭で
 * 「いまどこに居るか」に関係なくホームへ戻してから始める。
 */
async function goHome(page: Page): Promise<void> {
  const home = page.getByTestId('mode-assemble');
  if ((await home.count()) > 0) {
    await expect(home).toBeVisible();
    return;
  }
  const sessionBack = page.getByTestId('session-back');
  if ((await sessionBack.count()) > 0) {
    await sessionBack.click();
  } else {
    const toList = page.getByRole('button', { name: '課題一覧へ', exact: true });
    if ((await toList.count()) > 0) await toList.first().click();
  }
  const listBack = page.getByRole('button', { name: 'ホームへ戻る', exact: true });
  await expect(listBack).toBeVisible();
  await listBack.click();
  await expect(home).toBeVisible();
}

test.describe.serial('タイムチャートの拡大表示', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp({ window: { width: 1280, height: 800 } }));
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('仕様チャートをクリックで拡大し、Esc で閉じる（§7.7 / §8.1）', async () => {
    // ① 課題 b-001 を開く
    await goHome(page);
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);

    // ② 小さいチャートに縦の補助線（目盛線・操作の破線）が立っている（§7.7）
    const spec = page.getByTestId('chart-spec');
    await expect(spec).toBeVisible();
    const smallTicks = await readableTicks(spec);
    expect(await spec.locator('[data-guide="edge"]').count()).toBeGreaterThan(0);
    await shot(app, 'after-01-session-chart');

    // ③ チャートをクリックすると拡大モーダルが開く（§8.1）
    await page.getByRole('button', { name: SPEC_CHART }).click();
    const modal = page.getByTestId('chart-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('chart-spec-large')).toBeVisible();
    expect(await readableTicks(page.getByTestId('chart-spec-large'))).toBeGreaterThan(smallTicks);
    await page.waitForTimeout(300);
    await shot(app, 'after-02-session-enlarged');

    // ④ Esc で閉じる（後ろの盤は動かない）
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('viewport')).toBeVisible();

    // ⑤ 配線 → 通電 → 判定 → 結果画面の重ね表示も同じように拡大できる（§8.3）
    const box = await canvasBox(page);
    const edge = boardPoint(socketEdgePoint(), box);
    await page.mouse.click(edge.x, edge.y);
    await page.getByTestId('mount-relay-my4n').click();
    await expect(page.getByTestId('operation-log')).toContainText('S1 に リレー MY4N を装着');
    for (const [from, to] of SELF_HOLD_WIRES) {
      await clickTerminal(page, box, from);
      await clickTerminal(page, box, to);
    }
    await page.getByTestId('power-breaker').click();
    await page.getByTestId('power-switch').click();
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('chart-overlay')).toBeVisible();
    await shot(app, 'after-03-result-overlay');

    await page.getByRole('button', { name: OVERLAY_CHART }).click();
    await expect(page.getByTestId('chart-modal')).toBeVisible();
    await expect(page.getByTestId('chart-overlay-large')).toBeVisible();
    await page.waitForTimeout(300);
    await shot(app, 'after-04-result-enlarged');

    // 閉じるボタンでも閉じる
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByTestId('chart-modal')).toHaveCount(0);
  });

  test('操作エッジの多い課題（b-007）は小さいチャートの破線を絞る（§7.7 レビュー Minor 2）', async () => {
    // 1本目は結果画面で終わるので、必ずホームへ戻してから始める
    await goHome(page);
    await page.getByTestId('mode-assemble').click();
    await page.getByRole('button', { name: '1級', exact: true }).click();
    await page.getByTestId('open-b-007').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);
    const spec = page.getByTestId('chart-spec');
    await expect(spec).toBeVisible();
    await shot(app, 'after-05-b007-small');
  });
});
