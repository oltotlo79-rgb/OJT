import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD, routeSession, type BoardSession, type Vec3 } from '@ojt/board-model';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildInspectRepairCircuit,
  buildReferenceSession,
  toSocketRoles,
  type FaultSite,
  type InspectPartsProblem,
  type InspectRepairProblem,
} from '@ojt/content';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { boardPoint, roleTerminalPoint, type CanvasBox } from './projection.js';

/**
 * モードC1/C2 のE2E（§14.2 / §16 Phase 2 受入基準①〜⑤）。
 * `smoke.spec.ts` と同じ流儀で、ビルド済みの Electron を起こして自動操作する。
 * 期待する読値は Plan 2A の実測表（正常 650.0 / レアショート 422.5 / コイル断線 OL）から引く。
 *
 * 文言は `src/renderer/i18n/ja.ts` と同じものをここに書き写している
 * （E2E は成果物を外から触るので `ja.ts` を読み込まない）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

/** スクリーンショットの大きさ（`chart.spec.ts` と揃える）。 */
const WINDOW = { width: 1280, height: 800 } as const;

/** リレーの励磁が落ち着くまでの待ち[ms]（§9.1 手順①）。 */
const SETTLE_MS = 600;

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

/** ビルド済みの Electron を起こし、復元プロンプトを片付けてホームに立たせる。 */
async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // ウィンドウは `ready-to-show` まで非表示なので、明示的に出して大きさを固定する
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    window.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
    window.show();
    window.focus();
  }, WINDOW);
  await page.waitForTimeout(1500);
  const restore = page.getByTestId('restore-prompt');
  if ((await restore.count()) > 0) {
    await page.getByRole('button', { name: '復元しない' }).click();
  }
  return { app, page };
}

/**
 * どの画面からでもホームへ戻す。
 * 同じアプリで複数のシナリオを続けるとき、前のシナリオが結果画面やセッション画面で
 * 終わっていると次のシナリオの `mode-*` が見つからずタイムアウトする
 * （`chart.spec.ts` の b-007 シナリオで実際に起きた flake）。
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

/** ホーム → モード → 課題一覧 → 課題を開く。 */
async function openProblem(page: Page, modeTestId: string, problemId: string): Promise<void> {
  await goHome(page);
  await page.getByTestId(modeTestId).click();
  await expect(page.getByTestId('problem-table')).toBeVisible();
  await expect(page.getByTestId(`open-${problemId}`)).toBeVisible();
  await page.getByTestId(`open-${problemId}`).click();
}

/** WebGL の初期化とシーンの1フレーム目を待つ。 */
async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
      timeout: 30_000,
    })
    .toBe(1);
  await page.waitForTimeout(1500);
}

/**
 * 通電する（ブレーカ → 電源スイッチ。§5.3.5）。
 * どちらもトグルなので、既に入っているときは押さない。**部品を挿し替えた直後は必ず呼ぶこと**:
 * C1は挿し替えのたびに `load` を送り直し、Worker は新しい `Simulation` を作るので電源が落ちる。
 */
async function powerOn(page: Page): Promise<void> {
  const breaker = page.getByRole('button', { name: 'ブレーカ', exact: true });
  if ((await breaker.getAttribute('aria-pressed')) !== 'true') await breaker.click();
  const supply = page.getByRole('button', { name: '電源スイッチ', exact: true });
  if ((await supply.getAttribute('aria-pressed')) !== 'true') await supply.click();
  await expect(page.getByTestId('status-overlay')).toContainText('通電中');
}

/** 内蔵C1課題から、その `truth` を持つ部品を1つ選ぶ。 */
function partWith(problem: InspectPartsProblem, truth: string): string | undefined {
  return problem.parts.find((p) => p.truth === truth)?.id;
}

/** 内蔵課題を1件取り出す（無ければテストを落とす）。 */
function requireProblem<T>(list: readonly T[], index: number, what: string): T {
  const found = list[index];
  if (found === undefined) throw new Error(`内蔵${what}課題がありません`);
  return found;
}

/**
 * `dialog.showSaveDialog` / `showOpenDialog` を固定パスへ差し替える（§16 Phase 2 受入基準⑤）。
 * 手動保存・読込は実物のOSダイアログを開くので、E2Eでは自動化できない。同じファイルパスを
 * 常に返すよう Electron 側を書き換え、ダイアログを介さず保存・読込のIPC往復だけを確かめる。
 */
async function stubFileDialogs(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, filePath);
}

/**
 * 電線の経路上のクリック候補（盤ローカル mm）。長い区間の中点から順に返す。
 *
 * 電線は直角に折れて配線帯を通る（§6.6）ので、両端を結んだ直線の中点は経路の上に無い。
 * アプリと**同じ経路器**（`routeSession()`）で折れ点を求め、その区間上の点を狙う。
 */
function wireRoutePoints(session: BoardSession, wireId: string): Vec3[] {
  const route = routeSession(JIPM_BOARD, session).find((r) => r.wireId === wireId);
  if (route === undefined) return [];
  const candidates: Array<{ point: Vec3; length: number }> = [];
  for (let index = 0; index + 1 < route.corners.length; index += 1) {
    const from = route.corners[index];
    const to = route.corners[index + 1];
    if (from === undefined || to === undefined) continue;
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    // 端の圧着端子や交差する電線に当たりにくいよう、区間を分けた3点を候補にする
    for (const t of [0.5, 0.35, 0.65]) {
      candidates.push({
        point: {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          z: from.z + (to.z - from.z) * t,
        },
        length,
      });
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates.map((c) => c.point);
}

/**
 * 指摘モードで目的の電線を掴めるページ座標を探す。
 * 当たった対象は種別ポップオーバーの見出し（`電線 sw-005`）で確かめられるので、
 * 別の電線や端子を掴んでしまったら取り消して次の候補へ進む。
 *
 * 候補はまず両端の中点（短い電線ならここが経路の上に来る）、次に経路器が返す折れ線の上の点。
 */
async function findWirePoint(
  page: Page,
  box: CanvasBox,
  session: BoardSession,
  wireId: string,
): Promise<{ x: number; y: number }> {
  const wire = session.wires.find((w) => w.id === wireId);
  const candidates: Array<{ x: number; y: number }> = [];
  if (wire !== undefined) {
    const from = roleTerminalPoint(session.socketRoles, String(wire.from), box);
    const to = roleTerminalPoint(session.socketRoles, String(wire.to), box);
    candidates.push({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  }
  for (const local of wireRoutePoints(session, wireId).slice(0, 24)) {
    candidates.push(boardPoint(local, box));
  }
  const popover = page.getByTestId('report-popover');
  for (const point of candidates) {
    if (point.x < box.x || point.x > box.x + box.width) continue;
    if (point.y < box.y || point.y > box.y + box.height) continue;
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(120);
    if ((await popover.count()) === 0) continue;
    const text = (await popover.textContent()) ?? '';
    if (text.includes(`電線 ${wireId}`)) return point;
    await page.getByTestId('report-cancel').click();
  }
  throw new Error(`3D盤で電線 ${wireId} を掴めませんでした`);
}

test.describe.serial('モードC1 部品点検（§16 Phase 2 受入基準①②④）', () => {
  let app: ElectronApplication;
  let page: Page;

  /** 内蔵C1①（正常・コイル断線・a接点断線）。 */
  const basic = requireProblem(BUILTIN_INSPECT_PARTS_PROBLEMS, 0, 'C1');
  /** 内蔵C1②（レアショートを含む）。§16 Phase 2 受入基準② */
  const layer = requireProblem(BUILTIN_INSPECT_PARTS_PROBLEMS, 1, 'C1');

  /** チェック用ソケットのコイル端子をΩレンジで測る（`probe-target-coil` で2本まとめて置く）。 */
  async function measureCoil(): Promise<string> {
    await page.getByRole('button', { name: 'Ω', exact: true }).click();
    await page.getByTestId('probe-target-coil').click();
    await page.waitForTimeout(SETTLE_MS);
    return (await page.getByTestId('tester-readout').textContent()) ?? '';
  }

  /** トレイの部品を挿し、通電して、コイル抵抗を読む。 */
  async function readCoilOf(partId: string): Promise<string> {
    await page.getByTestId(`plug-${partId}`).click();
    await expect(page.getByTestId('status-overlay')).toContainText(`点検中: ${partId}`);
    // 挿し替えは `load` の送り直し＝新しい Simulation なので、電源は入れ直す（§5.4 / §9.1 ⓪）
    await powerOn(page);
    return measureCoil();
  }

  /** マークシートに全問正解を入れて判定する（`shotName` を渡すと解答後に1枚撮る）。 */
  async function answerAllAndJudge(problem: InspectPartsProblem, shotName?: string): Promise<void> {
    for (const part of problem.parts) {
      await page.getByTestId(`answer-${part.id}-${part.truth}`).click();
    }
    await expect(page.getByTestId('answered-count')).toContainText(
      `${String(problem.parts.length)} / ${String(problem.parts.length)}`,
    );
    if (shotName !== undefined) {
      // マークシートは右パネルの一番下にあるので、撮る前に見えるところまで送る
      await page.getByTestId('mark-sheet').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(app, shotName);
    }
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('correct-count')).toContainText(
      `${String(problem.parts.length)} / ${String(problem.parts.length)}`,
    );
  }

  test.beforeAll(async () => {
    const started = await launch();
    app = started.app;
    page = started.page;
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('正常品は 650.0Ω・コイル断線は OL と読め、マークシート全問正解で合格する（受入基準①）', async () => {
    // ① ホーム → 部品点検 → 課題一覧（モードで絞られている。§12.1）
    await goHome(page);
    await page.getByTestId('mode-inspect-parts').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await expect(page.getByTestId(`open-${basic.id}`)).toBeVisible();
    await expect(page.getByTestId('open-b-001')).toHaveCount(0);
    await shot(app, '10-c1-problem-list');

    // ② 課題を開く → チェック用ソケットの盤（§9.1）
    await page.getByTestId(`open-${basic.id}`).click();
    await expect(page.getByTestId('check-tray')).toBeVisible();
    await waitForBoard(page);
    await powerOn(page);
    await shot(app, '11-c1-board');

    // ③ 正常品は 650.0 Ω（Plan 2A 実測表）。単位は別の要素に添えて出る
    const normalId = partWith(basic, 'normal');
    expect(normalId).toBeDefined();
    if (normalId !== undefined) {
      expect(await readCoilOf(normalId)).toContain('650.0');
      await expect(page.getByTestId('tester-unit')).toHaveText('Ω');
      await page.getByTestId(`eject-${normalId}`).click();
    }

    // ④ コイル断線は OL（測れない＝単位も出ない）
    const openId = partWith(basic, 'coil-open');
    expect(openId).toBeDefined();
    if (openId !== undefined) {
      expect(await readCoilOf(openId)).toContain('OL');
      await expect(page.getByTestId('tester-unit')).toHaveCount(0);
      await shot(app, '12-c1-coil-open');
      await page.getByTestId(`eject-${openId}`).click();
    }

    // ⑤ マークシートに正解を入れて判定 → 合格（§9.1 判定）
    await answerAllAndJudge(basic, '14-c1-mark-sheet');
    await shot(app, '15-c1-result-pass');
  });

  test('レアショートは 422.5Ω と読め、「レアショート」を選ぶと正解になる（受入基準②）', async () => {
    await openProblem(page, 'mode-inspect-parts', layer.id);
    await expect(page.getByTestId('check-tray')).toBeVisible();
    await waitForBoard(page);

    const shortId = partWith(layer, 'coil-layer-short');
    expect(shortId).toBeDefined();
    if (shortId !== undefined) {
      // 正常値 650Ω の85%（552.5Ω）を下回るので、動作が正常でもレアショートと分かる（§9.1 補足）
      expect(await readCoilOf(shortId)).toContain('422.5');
      await shot(app, '13-c1-layer-short');
      await page.getByTestId(`eject-${shortId}`).click();
    }

    await answerAllAndJudge(layer);
    await expect(page.getByTestId('mark-result-table')).toContainText('レアショート');
  });

  test('通電中にΩレンジを当てると警告が出て、結果に回数が記録される（受入基準④）', async () => {
    await openProblem(page, 'mode-inspect-parts', basic.id);
    await expect(page.getByTestId('check-tray')).toBeVisible();
    await waitForBoard(page);

    const first = basic.parts[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    // 挿してから通電する（挿し替えは Worker の `load` ＝ 電源も t=0 に戻る）
    await page.getByTestId(`plug-${first.id}`).click();
    await powerOn(page);

    /*
     * 通電したまま**母線間**（`P.1`–`N.1`）にΩレンジを当てる（§16 Phase 2 受入基準④）。
     * プローブ間に24Vが出るので `measureResistance()` が測定を断り、`ohm-on-live` が1件出る
     * （§5.5 / §5.6 #1）。コイル端子（`CHK.13`–`CHK.14`）は赤PBを離していれば 0.00V で
     * 危険操作にならない（§9.1 測定1）ので、ここでは母線を使う。
     */
    const box = await canvasBox(page);
    const socketRoles = toSocketRoles(basic.board.socketRoles);
    await page.getByRole('button', { name: 'Ω', exact: true }).click();
    for (const terminal of ['N.1', 'P.1']) {
      const point = roleTerminalPoint(socketRoles, terminal, box);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(200);
    }

    await expect(page.getByTestId('hazard-banner')).toBeVisible();
    await expect(page.getByTestId('mistake-count')).toContainText('ミス 1 回');
    // 表示は測れないことを示す `----`（§5.6 #1。前提Cの訂正）
    await expect(page.getByTestId('tester-readout')).toHaveText('----');
    await shot(app, '16-c1-hazard-banner');

    // 判定へ進むと結果画面の危険操作に回数が載る（§5.6 / §8.3）。合否には影響しない（§17.2 #3）
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    await expect(page.getByTestId('hazard-table')).toContainText('通電中のΩ／導通測定');
    await expect(page.getByTestId('hazard-table')).toContainText('1 回');
    await shot(app, '17-c1-result-hazard');
  });
});

test.describe.serial('モードC2 回路点検・修復（§16 Phase 2 受入基準③⑤）', () => {
  let app: ElectronApplication;
  let page: Page;

  const problem: InspectRepairProblem = requireProblem(BUILTIN_INSPECT_REPAIR_PROBLEMS, 0, 'C2');

  /**
   * 「どこが故障か」と「正しい配線は何か」は、アプリと同じライブラリ（Plan 2A）で
   * テストプロセス側でも組み立てて求める。UIを通して読み取るのではなく、**同じ入力から
   * 同じ答えが出る**ことを利用する（内蔵C2 8題は明示 `faults` 配列なので決定論。§5.2）。
   */
  function build(): {
    faulted: BoardSession;
    correct: BoardSession;
    sites: readonly FaultSite[];
  } {
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const reference = buildReferenceSession(problem, JIPM_BOARD);
    if (!reference.ok) throw new Error(JSON.stringify(reference.errors));
    return {
      faulted: built.value.session,
      correct: reference.value.session,
      sites: built.value.applied.sites,
    };
  }

  test.beforeAll(async () => {
    const started = await launch();
    app = started.app;
    page = started.page;
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('故障2箇所を指摘し白線で修復すると合格する（受入基準③）', async () => {
    const { faulted, correct, sites } = build();
    expect(sites).toHaveLength(2);
    const socketRoles = faulted.socketRoles;
    const initialWires = faulted.wires.length;

    await openProblem(page, 'mode-inspect-repair', problem.id);
    await expect(page.getByTestId('report-panel')).toBeVisible();
    await waitForBoard(page);
    await expect(page.getByTestId('status-overlay')).toContainText(`電線 ${initialWires} 本`);
    await shot(app, '20-c2-board');

    const box = await canvasBox(page);
    /** 役割端子IDをクリックする。 */
    const clickTerminal = async (terminal: string): Promise<void> => {
      const point = roleTerminalPoint(socketRoles, terminal, box);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(120);
    };

    // ① 指摘を2件登録する（§9.2）。断線は電線を、未配線は端子を指す（`matchesSite`）
    await page.getByTestId('tool-report').click();
    /** 電線の断線・誤配線を指したときのクリック点（あとで削除モードでも使う）。 */
    const wirePoints = new Map<string, { x: number; y: number }>();
    for (const site of sites) {
      if (site.kind === 'wire-missing') {
        const terminal = site.terminals[0];
        expect(terminal).toBeDefined();
        if (terminal === undefined) continue;
        await clickTerminal(String(terminal));
        await expect(page.getByTestId('report-popover')).toContainText(`端子 ${String(terminal)}`);
        await page.getByTestId('report-kind-wire-missing').click();
        continue;
      }
      const wireId = site.wireId;
      expect(wireId).toBeDefined();
      if (wireId === undefined) continue;
      wirePoints.set(wireId, await findWirePoint(page, box, faulted, wireId));
      const kind = site.kind === 'wire-misrouted' ? 'wire-misrouted' : 'wire-open';
      await page.getByTestId(`report-kind-${kind}`).click();
    }
    await expect(page.getByTestId('report-count')).toHaveText('2');
    await expect(page.getByTestId('status-overlay')).toContainText('指摘 2');
    await shot(app, '21-c2-reports');

    // ② 白線で修復する（§9.2）。故障した電線を外し、正しい両端へ白線を張り直す
    let expectedWires = initialWires;
    for (const site of sites) {
      const original = correct.wires.find((w) => w.id === site.wireId);
      expect(original).toBeDefined();
      if (original === undefined) continue;
      if (site.kind !== 'wire-missing') {
        // 削除モードで、指摘のときに当たった同じ点を押して Delete（§8.2）
        const point = site.wireId === undefined ? undefined : wirePoints.get(site.wireId);
        expect(point).toBeDefined();
        if (point === undefined) continue;
        await page.getByRole('button', { name: '削除モード', exact: true }).click();
        await page.mouse.click(point.x, point.y);
        await page.keyboard.press('Delete');
        expectedWires -= 1;
        await expect(page.getByTestId('status-overlay')).toContainText(`電線 ${expectedWires} 本`);
        /*
         * `removed-wires`（修復パネルの「外した青線」）は**外した事実**を並べるだけで、
         * それが改造かどうかは出さない（§9.2。判定時に初めて計上する）。ここでは中身を
         * 当てにせず、改造が0であることは結果画面の `modification-list` で確かめる。
         */
        await expect(page.getByTestId('repair-panel')).toBeVisible();
      }
      // 白線を張る（パレットは白だけ。§8.1）
      await page.getByRole('button', { name: '白', exact: true }).click();
      await clickTerminal(String(original.from));
      await clickTerminal(String(original.to));
      expectedWires += 1;
      await expect(page.getByTestId('status-overlay')).toContainText(`電線 ${expectedWires} 本`);
    }
    await expect(page.getByTestId('added-wires')).not.toHaveText('なし');
    await shot(app, '22-c2-repaired');

    // ③ 判定 → 合格（§16 Phase 2 受入基準③）
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('missed-list')).toHaveText('なし');
    await expect(page.getByTestId('extra-list')).toHaveText('なし');
    await expect(page.getByTestId('modification-list')).toContainText('改造はありません');
    await shot(app, '23-c2-result-pass');
  });

  test('白線を張って保存し、閉じて開き直して読込むと本数が復元される（受入基準⑤）', async () => {
    const { faulted } = build();
    const socketRoles = faulted.socketRoles;
    const before = faulted.wires.length;
    const workFilePath = join(APP_ROOT, 'test-results', 'c2-worksave.json');
    mkdirSync(dirname(workFilePath), { recursive: true });

    // ① C2を開き、白線を1本張って盤の電線を1本増やす（§9.2）
    await openProblem(page, 'mode-inspect-repair', problem.id);
    await expect(page.getByTestId('report-panel')).toBeVisible();
    await waitForBoard(page);
    await expect(page.getByTestId('status-overlay')).toContainText(`電線 ${before} 本`);

    const box = await canvasBox(page);
    await page.getByRole('button', { name: '白', exact: true }).click();
    /*
     * 空いている接点ピン同士を1本つなぐ。`CR1.13` / `CR1.9` は模範配線で既に2本ずつ使って
     * いる端子で、3本目は盤が断る（§5.6 #5）ので使えない。ここは「保存して読み直すと同じ
     * 本数に戻る」ことだけを確かめるので、回路の意味は問わない。
     */
    for (const terminal of ['CR1.11', 'CR1.12']) {
      const point = roleTerminalPoint(socketRoles, terminal, box);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(120);
    }
    await expect(page.getByTestId('status-overlay')).toContainText(`電線 ${before + 1} 本`);

    // ② 保存する（ダイアログは固定パスへスタブする）
    await stubFileDialogs(app, workFilePath);
    await page.getByRole('button', { name: '作業を保存', exact: true }).click();
    await expect(page.getByTestId('toast').filter({ hasText: '保存しました' })).toBeVisible();

    // ③ 閉じて開き直す（作業ファイルはプロセスを跨いで残る）
    await app.close();
    const restarted = await launch();
    app = restarted.app;
    page = restarted.page;

    // ④ C2を（故障入りの初期状態で）開き直してから、保存した作業ファイルを読み込む
    await openProblem(page, 'mode-inspect-repair', problem.id);
    await expect(page.getByTestId('report-panel')).toBeVisible();
    await waitForBoard(page);
    await expect(page.getByTestId('status-overlay')).toContainText(`電線 ${before} 本`);
    await stubFileDialogs(app, workFilePath);
    await page.getByRole('button', { name: '作業を読込', exact: true }).click();
    await expect(page.getByTestId('status-overlay')).toContainText(`電線 ${before + 1} 本`);
  });
});
