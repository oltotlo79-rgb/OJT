import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLC_UNIT_FX5U, trySocketOf } from '@ojt/board-model';
import {
  BUILTIN_PLC_PROBLEMS,
  plcWiringPlan,
  resolvePlcIo,
  toSocketRoles,
  type PlcProblem,
} from '@ojt/content';
import { COIL_COL } from '@ojt/ladder-core';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { PLC_BOARD, plcBoardPoint, plcTerminalPoint, type CanvasBox } from './projection.js';

/**
 * モードDのE2E（§14.2 ③ / §16 Phase 3 受入基準①〜⑤）。
 * `smoke.spec.ts` と同じ流儀で、ビルド済みの Electron を起こして自動操作する。
 * 文言は `src/renderer/i18n/ja.ts` と同じものを書き写している（E2E は成果物を外から触る）。
 *
 * 受入基準（§16 Phase 3）:
 *  ①PLC課題を開き、GX Works3風スキンで F5/F7 を使ってラダーを組み「変換」が通る
 *  ②3D上で PB端子台→X0、Y0→CR1コイル、CR1のa接点→PL1 と配線し、PLC電源を壁コンセントへ配線する
 *  ③判定で合格する
 *  ④Y0→PL1 を直結すると `twoStage` エラーになる
 *  ⑤PLC電源を盤のP/Nから取ると `plcPowerIndependent` エラーになる
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

/** 課題のI/O割付（既定割付の穴埋め済み）。 */
const IO = resolvePlcIo(PROBLEM.io);

/** 模範配線（役割端子IDの組）。**期待値をE2Eで作らず 3A の生成器から引く**。§10.2 */
const REFERENCE_WIRES: ReadonlyArray<readonly [string, string]> = plcWiringPlan(
  IO,
  PLC_UNIT_FX5U,
).map((wire) => [String(wire.from), String(wire.to)] as const);

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
 * WebGL の初期化とシーンの1フレーム目を待つ（`smoke.spec.ts` と同じ）。
 * `waitForTimeout` で決め打ちの秒数を待つと、遅い機械では足りず速い機械では無駄に待つ。
 */
async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
      timeout: 30_000,
    })
    .toBe(1);
}

async function canvasBox(page: Page): Promise<CanvasBox> {
  await waitForBoard(page);
  const canvas = page.locator('[data-testid="viewport"] canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
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
  return canvasBox(page);
}

/** ラダーと盤の分割表示へ戻す。 */
async function showSplit(page: Page): Promise<void> {
  await page.getByTestId('view-split').click();
  await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'split');
  await page.waitForTimeout(600);
}

/** `status-overlay` が出している電線の本数。 */
async function wireCount(page: Page): Promise<number> {
  const text = (await page.getByTestId('status-overlay').textContent()) ?? '';
  const matched = /電線\s+(\d+)\s+本/u.exec(text);
  if (matched?.[1] === undefined) throw new Error(`電線の本数を読めません: ${text}`);
  return Number(matched[1]);
}

/**
 * 課題が使うリレーをソケットへ装着する（模範配線が `CRn.14` などを使う）。
 *
 * **`socket-<id>` という `data-testid` はこのアプリに存在しない**（ソケットは3Dのメッシュで、
 * DOM の要素ではない）。`smoke.spec.ts` と同じく3Dのソケット本体を射影してクリックし、
 * 部品パネルの「装着」ボタンを押す。装着するのは**割付が使うぶんだけ**である（余分に付けると
 * 配線されない部品が残り `unusedParts` で落ちる）。
 */
async function mountRelays(page: Page, box: CanvasBox): Promise<void> {
  for (const output of IO.outputs) {
    const socketId = trySocketOf(ROLES, output.cr);
    if (socketId === undefined) throw new Error(`${output.cr} のソケットがありません`);
    const socket = PLC_BOARD.sockets.find((s) => s.id === socketId);
    if (socket === undefined) throw new Error(`ソケットが定義されていません: ${socketId}`);
    // 本体の中央（差込領域）。ネジ端子のティアから離れているのでソケット本体が拾える
    const point = plcBoardPoint(
      {
        x: socket.origin.x + socket.bodyMm.width / 2,
        y: socket.origin.y + socket.bodyMm.length / 2,
        z: 9,
      },
      box,
    );
    await page.mouse.click(point.x, point.y);
    await page.getByRole('button', { name: '装着' }).first().click();
    await expect(page.getByTestId('operation-log')).toContainText(
      `${socketId} に relay-my4n を装着`,
    );
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

/** カーソルがそのセルにいるか（`aria-selected`）。 */
async function expectCursorAt(page: Page, cell: string): Promise<void> {
  await expect(page.getByTestId(`cell-${cell}`)).toHaveAttribute('aria-selected', 'true');
}

/**
 * →キーでコイル列までカーソルを送る。`fromCol` から右へ。
 *
 * 接点とコイルの間を横線で埋める必要はない。コイルを置いた時点で `applyLadderCell()` が
 * 左の論理とコイルの間を自動で繋ぐ（GX Works3 と同じ）。既定の表示列数（11）では
 * 11〜14 列目は描かれないので、`moveCursor()` が 10 列目から**コイル列へ飛ぶ**。
 */
async function moveToCoil(page: Page, networkId: string, fromCol: number): Promise<void> {
  await expectCursorAt(page, `${networkId}:0:${String(fromCol)}`);
  const coil = page.getByTestId(`cell-${networkId}:0:${String(COIL_COL)}`);
  for (let step = 0; step < COIL_COL; step += 1) {
    if ((await coil.getAttribute('aria-selected')) === 'true') break;
    await key(page, 'ArrowRight');
  }
  await expectCursorAt(page, `${networkId}:0:${String(COIL_COL)}`);
}

/** 回路ブロックを1つ足す（カーソルは新しいブロックの先頭へ移る）。 */
async function insertNetwork(page: Page, expectedId: string): Promise<void> {
  await page.getByTestId('toolbar-insert-network').click();
  await expectCursorAt(page, `${expectedId}:0:0`);
}

/**
 * 受入基準①: F5（a接点）と F7（コイル）でいちばん小さいラダーを組み、F4 で変換する。
 * 配線だけを見る（静的チェックの）テストが使う。
 */
async function buildMinimalLadder(page: Page, coilDevice = 'Y0'): Promise<void> {
  await expectCursorAt(page, 'n1:0:0');
  await key(page, 'F5');
  await commitDevice(page, 'X0');
  await page.getByTestId('cell-n1:0:15').click();
  await key(page, 'F7');
  await commitDevice(page, coilDevice);
  await key(page, 'F4');
  await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
}

/**
 * 受入基準①③: 模範と同じ動きをするラダーをキーボードだけで組む（F5 / F6 / Shift+F5 / F7 / →）。
 *
 *  n1: X0 ∥ Y0 ─ /X1 ─( Y0 )   自己保持
 *  n2: /Y0 ─ X1 ─( Y1 )        停止確認表示
 *  n3: X2 ─( Y2 )              点検灯
 *
 * 表示列数は既定（11）のまま。接点とコイルの間はコイルを置いた時点で自動で繋がる。
 */
async function buildReferenceLadder(page: Page): Promise<void> {
  // n1 1行目: X0（a接点）
  await expectCursorAt(page, 'n1:0:0');
  await key(page, 'F5');
  await commitDevice(page, 'X0');
  // n1 2行目: Y0 の自己保持（OR分岐）。分岐は分岐元のセルで Shift+F5
  await key(page, 'ArrowLeft');
  await key(page, 'Shift+F5');
  await commitDevice(page, 'Y0');
  await expect(page.getByTestId('cell-n1:1:0')).toBeVisible();
  // n1: /X1（b接点）→ 横線 → コイル Y0
  await key(page, 'ArrowRight');
  await key(page, 'F6');
  await commitDevice(page, 'X1');
  await moveToCoil(page, 'n1', 3);
  await key(page, 'F7');
  await commitDevice(page, 'Y0');

  // n2: /Y0 ─ X1 ─( Y1 )
  await insertNetwork(page, 'n2');
  await key(page, 'F6');
  await commitDevice(page, 'Y0');
  await key(page, 'F5');
  await commitDevice(page, 'X1');
  await moveToCoil(page, 'n2', 2);
  await key(page, 'F7');
  await commitDevice(page, 'Y1');

  // n3: X2 ─( Y2 )
  await insertNetwork(page, 'n3');
  await key(page, 'F5');
  await commitDevice(page, 'X2');
  await moveToCoil(page, 'n3', 1);
  await key(page, 'F7');
  await commitDevice(page, 'Y2');

  // 受入基準①: 「変換」が通る
  await key(page, 'F4');
  await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
  await expect(page.getByTestId('output-window')).toContainText('指摘はありません');
}

/** 電線を1本張る（端子 → 端子）。張れたことを本数で確かめる。 */
async function wire(page: Page, box: CanvasBox, from: string, to: string): Promise<void> {
  const before = await wireCount(page);
  const a = plcTerminalPoint(ROLES, from, box);
  const b = plcTerminalPoint(ROLES, to, box);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await expect(
    page.getByTestId('status-overlay'),
    `${from} – ${to} を張れませんでした`,
  ).toContainText(`電線 ${String(before + 1)} 本`);
}

/** 受入基準②: 模範どおりに配線する（`skip` に挙げた端子を使う電線は張らない）。 */
async function wireReference(
  page: Page,
  box: CanvasBox,
  skip: readonly string[] = [],
): Promise<void> {
  for (const [from, to] of REFERENCE_WIRES) {
    if (skip.includes(from) || skip.includes(to)) continue;
    await wire(page, box, from, to);
  }
}

test.describe('モードD（PLC）', () => {
  test('①②③ ラダーを組んで配線すると合格する', async () => {
    const { app, page } = await launch();
    try {
      await openPlcProblem(page);

      // ① GX Works3風スキンで F5/F7 を使って組み、変換が通る
      await buildReferenceLadder(page);
      await shot(app, '30-plc-ladder');

      // ② 3D上で模範どおりに配線する。3Dの準備を待ってから矩形を測り、その矩形で射影する
      const box = await showBoardOnly(page);
      await mountRelays(page, box);
      const initialWires = await wireCount(page);
      await wireReference(page, box);
      await expect(page.getByTestId('status-overlay')).toContainText(
        `電線 ${String(initialWires + REFERENCE_WIRES.length)} 本`,
      );
      await shot(app, '31-plc-wired');

      // モニタ（F3）で通電が見えることも確かめる（§10.7）。RUN は**ツールバー**から入れる
      // （`MonitorPanel` の控えは盤表示中に見えないため。決定表#9b）
      await showSplit(page);
      await page.getByTestId('toolbar-monitor-start').click();
      await expect(page.getByTestId('plc-ladder-mode')).toContainText('モニタ');
      await page.getByTestId('plc-run').click();
      await expect(page.getByTestId('plc-run')).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'ブレーカ', exact: true }).click();
      await page.getByRole('button', { name: '電源スイッチ', exact: true }).click();
      await expect(page.getByTestId('status-overlay')).toContainText('通電中');
      // スキャンが回っていることを「止まっています」の注記が消えたことで確かめる
      await expect(page.getByTestId('monitor-scan')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('monitor-stopped')).toHaveCount(0);
      await shot(app, '32-plc-monitor');

      // ③ 判定で合格する
      await page.getByTestId('judge-button').click();
      await expect(page.getByTestId('verdict')).toHaveText('合格', { timeout: 30_000 });
      // 受入基準③は「モードDの3チェックすべて OK」。1件の文字列が出ているだけでは足りない
      for (const id of ['twoStage', 'plcPowerIndependent', 'ioAssignment']) {
        await expect(page.getByTestId(`static-check-${id}`)).toContainText('OK');
      }
      await expect(page.getByTestId('plc-why-passed')).toBeVisible();
      await shot(app, '33-plc-result');
    } finally {
      await app.close();
    }
  });

  test('④ Y0 をランプへ直結すると twoStage エラーになる', async () => {
    const { app, page } = await launch();
    try {
      await openPlcProblem(page);
      // 判定を出すだけなら変換が通っていればよい（静的チェックは配線だけを見る）
      await buildMinimalLadder(page);
      const box = await showBoardOnly(page);
      await mountRelays(page, box);
      // 2段目（Y0 → CR1.14 と CR1.5 → PL1+）を張らずに、Y0 を PL1+ へ直結する
      await wireReference(page, box, ['CR1.14', 'CR1.5']);
      await wire(page, box, 'PLC.Y0', 'TB_PL.1+');

      await page.getByTestId('judge-button').click();
      await expect(page.getByTestId('verdict')).toHaveText('不合格', { timeout: 30_000 });
      const check = page.getByTestId('static-check-twoStage');
      await expect(check).toContainText('二段構成');
      await expect(check).toContainText('エラー');
      await expect(check).toContainText('PL1 に直結');
      await shot(app, '34-plc-twostage');
    } finally {
      await app.close();
    }
  });

  test('⑤ PLC電源を盤から取ると plcPowerIndependent エラーになる', async () => {
    const { app, page } = await launch();
    try {
      await openPlcProblem(page);
      await buildMinimalLadder(page);
      const box = await showBoardOnly(page);
      await mountRelays(page, box);
      // 壁コンセントへの2本を張らず、盤の電源系から取る。
      // **`P.1` / `N.1` は使えない**: 課題の初期配線（チェック用回路）と母線の鎖で既に埋まって
      // おり、3本目は「1端子2本まで」で UI に断られる。同じ節点の**末端**（P側の鎖の終わり
      // `CR3.9` と N側の鎖の終わり `TB_PL.3-`）から取れば、節点としては盤の `P.1` / `N.1` と
      // 繋がるので `plcPowerIndependent` の「盤から給電」の枝に入る。
      await wireReference(page, box, ['OUTLET.L', 'OUTLET.N']);
      await wire(page, box, 'CR3.9', 'PLC.L');
      await wire(page, box, 'TB_PL.3-', 'PLC.N');

      await page.getByTestId('judge-button').click();
      await expect(page.getByTestId('verdict')).toHaveText('不合格', { timeout: 30_000 });
      const check = page.getByTestId('static-check-plcPowerIndependent');
      await expect(check).toContainText('PLC電源の独立');
      await expect(check).toContainText('エラー');
      // 節点としては盤の P.1 に繋がっている旨の詳細が出る（CR3.9 / TB_PL.3- の鎖の末端。レビュー指摘 #8）
      await expect(check).toContainText('P.');
      // 2つの文言の出し分けと「未配線でも動く」説明が出る（3A H-5）
      const help = page.getByTestId('plc-power-help');
      await expect(help).toContainText('壁コンセント');
      await expect(help).toContainText('未配線でも動作します');
      await shot(app, '35-plc-power');
    } finally {
      await app.close();
    }
  });

  test('変換を通していないラダーでは判定できない（H-1）', async () => {
    const { app, page } = await launch();
    try {
      await openPlcProblem(page);
      const judge = page.getByTestId('judge-button');
      await expect(judge).toBeDisabled();
      await expect(page.getByTestId('plc-hint')).toContainText('判定できません');

      // コイルを接点列（0列目）に置くと `coil-column` で変換に落ちる
      await expectCursorAt(page, 'n1:0:0');
      await key(page, 'F7');
      await commitDevice(page, 'Y0');
      await key(page, 'F4');
      await expect(page.getByTestId('convert-state')).toHaveText('未変換（F4 で変換します）');
      await expect(page.getByTestId('output-row-0')).toContainText('最終列');
      await expect(judge).toBeDisabled();

      // 直せば変換が通り、判定できるようになる
      await page.getByTestId('cell-n1:0:0').click();
      await key(page, 'Delete');
      await buildMinimalLadder(page);
      await expect(judge).toBeEnabled();

      // 1セルでも編集したらまた未変換に戻る（H-1）
      await page.getByTestId('cell-n1:0:1').click();
      await key(page, 'F9');
      await expect(page.getByTestId('convert-state')).toHaveText('未変換（F4 で変換します）');
      await expect(judge).toBeDisabled();
    } finally {
      await app.close();
    }
  });
});
