import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { selectView } from './projection.js';

/**
 * 性能とオフライン（§16 Phase 5 受入基準③の通信部分・④）。§15 / Plan 5 決定表#16・#17。
 *
 * E2E は `--use-gl=swiftshader` で動く（CI・リモートデスクトップにGPUが無い。`smoke.spec.ts`
 * の注記）ので、**GPUに依らない予算だけ**を自動で縛る。60fps そのものは実機（内蔵GPU・FHD）で
 * `OJT_PERF_TARGET=1` を立てて同じ E2E を走らせ、リリース手順チェックリストに記録する。
 *
 * **このファイルの test は上から順に流す前提**（`polish.spec.ts` と同じ流儀。Batch E レビュー
 * Minor 5）。1本目が課題を開いた状態を2本目以降が引き継ぐので、`-g` で1本だけ流すと落ちる。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');
const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
const WINDOW = { width: 1440, height: 900 } as const;

/**
 * 性能の予算（§15 / Plan 5 決定表#17）。GPU に依らない値だけを自動で縛る。
 *
 * **2026-09-20 Phase 7 Task 16（3D-01）で盤を含む実測値に取り直した。** それまでの
 * `120` は、ビューキューブ（drei の `Hud`）が1フレームに2回呼ぶ `gl.render()` の2回目で
 * `gl.info` が上書きされていたため、**ギズモ単体の 280/30 に対して置かれた値**だった
 * （3視点とも 280/30 で同値だったのがその証拠）。`BoardScene` の `onCreated` で
 * `gl.info.autoReset` を切り、`PerfProbe` が毎フレーム自分で戻すようにしたので、
 * ここで読む値は**盤＋ギズモの合計**になっている。
 *
 * 測り方: origin/main をビルドした worktree（`OJT-wt-e2e`、`--use-gl=swiftshader`、1440×900、
 * `pnpm --filter @ojt/desktop build` のあと `playwright test e2e/perf.spec.ts` を foreground で）。
 * 2回続けて同じ値が出た実測（モードB b-001）:
 *
 * | 視点 | triangles | calls |
 * |---|---:|---:|
 * | 正面 | 50,364 | 309 |
 * | 俯瞰 | 50,364 | 309 |
 * | ソケット拡大 | 45,898 | 253 |
 *
 * `TRIANGLE_BUDGET` は §15 の受入基準そのものの数（20万）を残す（実測 50,364 で4倍の余裕がある）。
 * `DRAW_CALL_BUDGET` は §15 に数字が無く Plan 5 決定表#17 が独自に置いたものなので、
 * 実測 309 に約1割の余裕を足した値へ取り直す。Task 17（3D 資源解放とドローコールの畳み込み）は
 * この実測値より**下がる**ことを目標にする。
 */
const TRIANGLE_BUDGET = 200_000;
const DRAW_CALL_BUDGET = 340;
/** 実機確認のときだけ 60fps を要求する（`OJT_PERF_TARGET=1`）。 */
const FPS_TARGET = 60;
/**
 * 予算を測る視点（Plan 5 完了条件「正面・俯瞰・ソケット拡大のどの視点でも」。Batch E レビュー B1）。
 * ソケット拡大は端子が画面いっぱいに出る＝いちばんドローコールが増える視点なので必ず含める。
 */
const VIEWS = ['正面', '俯瞰', 'ソケット拡大'] as const;

let app: ElectronApplication;
let page: Page;
/** renderer 側の外向き要求（起動直後から溜める。Batch E レビュー I3）。 */
const rendererRequests: string[] = [];

async function readPerf(target: Page): Promise<Record<string, number> & { total: number }> {
  const node = target.getByTestId('perf-readout');
  // `PerfProbe` は**描いたフレーム**のときだけ書くので、1枚目が焼き上がるまで待つ
  await expect(node).not.toBeEmpty({ timeout: 30_000 });
  const text = await node.textContent();
  const total = await node.getAttribute('data-total-frames');
  if (text === null || text.length === 0) throw new Error('perf-readout が空です');
  return { ...(JSON.parse(text) as Record<string, number>), total: Number(total ?? '0') };
}

/**
 * 視点を切り替えたあと、**新しく描いたフレームが止まる**まで待ってから読む。
 * `frameloop="demand"` なので「総フレーム数が2回続けて同じ」＝描き終わり（Batch E レビュー
 * Minor 4。固定待ちを条件待ちに置き換える）。
 */
async function readSettledPerf(target: Page): Promise<Record<string, number> & { total: number }> {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const { total } = await readPerf(target);
        const stable = total > 0 && total === previous;
        previous = total;
        return stable;
      },
      { timeout: 30_000, intervals: [300] },
    )
    .toBe(true);
  return readPerf(target);
}

/** main プロセス（`net` / `session`）が出した外向き要求を読み出す。 */
async function readMainRequests(target: ElectronApplication): Promise<string[]> {
  return target.evaluate(() => {
    const store = (globalThis as unknown as { __ojtHttpRequests?: string[] }).__ojtHttpRequests;
    return store === undefined ? [] : [...store];
  });
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  /*
   * 通信の見張りは**起動直後・最初の遷移より前**に張る（Batch E レビュー I3）。
   * `page.on('request')` は renderer の要求しか見えず、main プロセス（`net` / `session`）の
   * 通信は出ない。`session.defaultSession.webRequest.onBeforeRequest` は両方を通るので、
   * ここで掛けて main 側へ溜め、`readMainRequests()` で読む（`callback({})` で素通し）。
   */
  await app.evaluate(({ session }) => {
    const store: string[] = [];
    (globalThis as unknown as { __ojtHttpRequests?: string[] }).__ojtHttpRequests = store;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (/^https?:/u.test(details.url)) store.push(details.url);
      callback({});
    });
  });
  page = await app.firstWindow();
  page.on('request', (request) => {
    if (/^https?:/u.test(request.url())) rendererRequests.push(request.url());
  });
  await page.waitForLoadState('domcontentloaded');
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
  await expect(page.getByTestId('mode-assemble')).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app.close();
});

test.describe('性能（§16 Phase 5 受入基準④）', () => {
  test('三角形数とドローコールが予算に収まる（正面・俯瞰・ソケット拡大）', async () => {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    // 視点プリセットは「…」の中（UXレビュー #17。`projection.ts` の `selectView()`）
    const byView: Record<string, Record<string, number>> = {};
    for (const view of VIEWS) {
      await selectView(page, view);
      const perf = await readSettledPerf(page);
      byView[view] = perf;
      expect(perf['triangles'], `${view} の三角形数`).toBeLessThanOrEqual(TRIANGLE_BUDGET);
      expect(perf['calls'], `${view} のドローコール`).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    }
    /*
     * **この門が盤を測っていることの自己検査**（3D-01 / Phase 7 Task 16）。
     * ビューキューブは視点を変えても常に同じ形・同じ大きさで描かれるので、`gl.info` が
     * ギズモ単体の残骸に戻ってしまうと3視点とも同じ値（280/30）になる。逆に盤を測れていれば、
     * 盤全体が視野に入る `正面` と、1個のソケットへ寄って他が視錐台から外れる `ソケット拡大` で
     * `calls` は必ず違う（実測 309 と 253）。HUD だけを測る退行が起きた瞬間にここが落ちる。
     */
    const frontCalls = byView['正面']?.['calls'];
    const zoomCalls = byView['ソケット拡大']?.['calls'];
    expect(typeof frontCalls, '正面 のドローコールが読めている').toBe('number');
    expect(typeof zoomCalls, 'ソケット拡大 のドローコールが読めている').toBe('number');
    expect(
      frontCalls,
      '正面 と ソケット拡大 のドローコールが同値＝盤ではなくビューキューブを測っている（3D-01）',
    ).not.toBe(zoomCalls);
    const worst = {
      triangles: Math.max(...VIEWS.map((view) => byView[view]?.['triangles'] ?? 0)),
      calls: Math.max(...VIEWS.map((view) => byView[view]?.['calls'] ?? 0)),
    };
    mkdirSync(SHOT_DIR, { recursive: true });
    writeFileSync(
      join(SHOT_DIR, 'perf-report.json'),
      JSON.stringify({ byView, worst }, null, 2),
      'utf8',
    );
  });

  test('無操作では1枚も描かない（frameloop="demand" の監査）', async () => {
    await page.mouse.move(4, 4);
    await page.waitForTimeout(1500);
    const before = (await readPerf(page)).total;
    await page.waitForTimeout(3000);
    const after = (await readPerf(page)).total;
    // 慣性の減衰が残ることがあるので 1 枚だけ許す
    expect(after - before).toBeLessThanOrEqual(1);
  });

  test('実機では60fpsを保つ（OJT_PERF_TARGET=1 のときだけ）', async () => {
    test.skip(process.env['OJT_PERF_TARGET'] !== '1', '内蔵GPU実機でのみ確認する（決定表#17）');
    for (const view of VIEWS) {
      await selectView(page, view);
      await page.waitForTimeout(1200);
      expect((await readPerf(page))['fps']).toBeGreaterThanOrEqual(FPS_TARGET);
    }
  });

  test('外部へ1件も通信しない（§15 のオフライン）', async () => {
    /*
     * ここで「検算」は押さない（B7）。この spec は課題を開いたばかりで下書きが空なので、
     * 「検算」ボタンは `disabled`（指摘が残っている）である。Playwright の `click()` は
     * 要素が操作可能になるまで待つので、押そうとすると時間切れで落ちるだけで、
     * しかも**通信の件数を数えるのに検算は1件も寄与しない**（検算は Worker の中で完結する）。
     * 画面を一通り動かして、その間に外向きの要求が1件も出ないことだけを見る。
     */
    await page.getByTestId('assemble-view-schematic').click();
    await expect(page.getByTestId('schematic-editor')).toBeVisible();
    await page.getByTestId('assemble-view-split').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.getByTestId('assemble-view-board').click();
    await page.waitForTimeout(3000);
    await page.getByTestId('session-back').click();
    /*
     * renderer（起動直後から溜めている）と main（`session.defaultSession.webRequest`）の
     * 両方を見る。起動時の通信もここに含まれる（Batch E レビュー I3）。
     * 実機オフライン確認（リリース手順チェックリスト 7）は引き続き一次証拠として残す。
     */
    expect({ renderer: rendererRequests, main: await readMainRequests(app) }).toEqual({
      renderer: [],
      main: [],
    });
  });
});
