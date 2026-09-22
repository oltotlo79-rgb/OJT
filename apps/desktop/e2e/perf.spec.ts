import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, SHOT_DIR } from './app.js';
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
 * そのため `test.describe.serial` にしてある（レビュー指摘 QA-03。`.serial` ならグループ全体が
 * 再試行され、`retries: 1` の再試行が「前の test が作った画面」の無い状態で走らずに済む）。
 */

const WINDOW = { width: 1440, height: 900 } as const;
const HARDWARE = process.env['OJT_PERF_TARGET'] === '1';

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
  ({ app, page } = await launchApp({
    window: WINDOW,
    ...(HARDWARE
      ? {
          graphics: 'hardware' as const,
          contentSize: { width: 1920, height: 1080 },
          extraFlags: ['--force-device-scale-factor=1'],
        }
      : {}),
    /*
     * 通信の見張りは**起動直後・最初の遷移より前**に張る（Batch E レビュー I3）。
     * `page.on('request')` は renderer の要求しか見えず、main プロセス（`net` / `session`）の
     * 通信は出ない。`session.defaultSession.webRequest.onBeforeRequest` は両方を通るので、
     * ここで掛けて main 側へ溜め、`readMainRequests()` で読む（`callback({})` で素通し）。
     */
    onLaunched: async (launched) => {
      await launched.evaluate(({ session }) => {
        const store: string[] = [];
        (globalThis as unknown as { __ojtHttpRequests?: string[] }).__ojtHttpRequests = store;
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
          if (/^https?:/u.test(details.url)) store.push(details.url);
          callback({});
        });
      });
      const first = await launched.firstWindow();
      first.on('request', (request) => {
        if (/^https?:/u.test(request.url())) rendererRequests.push(request.url());
      });
    },
  }));
});

test.afterAll(async () => {
  await app.close();
});

test.describe.serial('性能（§16 Phase 5 受入基準④）', () => {
  test('三角形数とドローコールが予算に収まる（正面・俯瞰・ソケット拡大）', async () => {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    // 内部構造を持つリレーとタイマを装着した状態でも描画予算を守る。
    for (const [socket, kind] of [
      ['S1', 'relay-my4n'],
      ['S2', 'relay-my4n'],
      ['S5', 'timer-h3y4'],
      ['S6', 'timer-h3y4'],
    ] as const) {
      await page.getByTestId(`socket-list-${socket}`).click();
      await page.getByTestId(`mount-${kind}`).click();
      await page.getByTestId('socket-list-back').click();
    }
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
    test.skip(!HARDWARE, '内蔵GPU実機でのみ確認する（決定表#17）');
    const renderer = await page.locator('[data-testid="viewport"] canvas').evaluate((canvas) => {
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      if (!gl || !debug) throw new Error('実際の描画装置を取得できません');
      return String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    });
    expect(renderer, '実機指定でソフトウェア描画に戻ってはいけません').not.toMatch(
      /swiftshader|llvmpipe|software|basic render/iu,
    );
    const byView: Record<string, { fps: number; frames: number; elapsedMs: number }> = {};
    for (const view of VIEWS) {
      await selectView(page, view);
      await readSettledPerf(page);
      const box = await page.locator('[data-testid="viewport"] canvas').boundingBox();
      if (!box) throw new Error('盤の表示領域を取得できません');
      // 静止中の古いfpsを読まず、回転している間の累計フレーム数と実時間を測る。
      const samplesPromise = page.evaluate(
        () =>
          new Promise<Array<{ at: number; total: number }>>((done) => {
            const node = document.querySelector('[data-testid="perf-readout"]');
            if (!node) throw new Error('描画枚数を取得できません');
            const samples: Array<{ at: number; total: number }> = [];
            const observer = new MutationObserver(() => {
              samples.push({
                at: performance.now(),
                total: Number(node.getAttribute('data-total-frames')),
              });
            });
            observer.observe(node, { attributes: true, attributeFilter: ['data-total-frames'] });
            setTimeout(() => {
              observer.disconnect();
              done(samples);
            }, 3000);
          }),
      );
      await page.mouse.move(box.x + 30, box.y + box.height * 0.7);
      await page.mouse.down({ button: 'middle' });
      let samples: Awaited<typeof samplesPromise>;
      try {
        for (let step = 0; step < 150; step++) {
          await page.mouse.move(box.x + 30 + Math.sin(step / 12) * 14, box.y + box.height * 0.7);
          await page.waitForTimeout(20);
        }
        samples = await samplesPromise;
      } finally {
        await page.mouse.up({ button: 'middle' });
      }
      expect(samples.length, `${view} の連続描画サンプル数`).toBeGreaterThanOrEqual(8);
      const first = samples[0]!,
        last = samples.at(-1)!;
      const frames = last.total - first.total,
        elapsedMs = last.at - first.at;
      byView[view] = { fps: (frames * 1000) / elapsedMs, frames, elapsedMs };
    }
    mkdirSync(SHOT_DIR, { recursive: true });
    writeFileSync(
      join(SHOT_DIR, 'perf-hardware.json'),
      JSON.stringify({ renderer, size: [1920, 1080], byView }, null, 2),
    );
    for (const [view, value] of Object.entries(byView)) {
      // 60Hz画面の59.94Hzと時刻の量子化を含むため、合否は1fps単位。実測小数は上の記録へ残す。
      expect(Math.round(value.fps), `${view}: ${String(value.fps)} fps`).toBeGreaterThanOrEqual(
        FPS_TARGET,
      );
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
