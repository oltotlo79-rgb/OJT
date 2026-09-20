import { defineConfig } from '@playwright/test';

/**
 * Playwright（Electron ランナー）。設計仕様 §14.2。
 * `_electron.launch()` で out/ のビルド成果物を起動するため、E2E の前に
 * `pnpm --filter @ojt/desktop build` を済ませておく。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  // `capturePage()` の直後だとコンポジタがまだ準備できておらず `UnknownVizError` に
  // なることがまれにある（既知のflake）。1回だけ自動再試行する。
  retries: 1,
  // `test.only` の置き忘れが CI をすり抜けないようにする（レビュー指摘 QA-04）
  forbidOnly: process.env['CI'] !== undefined,
  // 失敗したときに原因が読めるように残す（QA-04）。`retries: 1` があるので
  // `on-first-retry` の追加コストはほぼゼロ。`test-results/` は `.gitignore` 済み。
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  reporter: process.env['CI'] !== undefined ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './test-results',
  /*
   * **`manual-shots.spec.ts` を既定から外す**（レビュー指摘 QA-02）。
   *
   * この spec は取扱説明書の図を撮り直すので、git 追跡下の `docs/manual/images/`（PNG 52枚・
   * 約3MB）と `docs/manual/shot-geometry.json` を丸ごと書き換える。README が案内する順
   * （`e2e` → `dist`）で流すと、**タグ付けしたツリーではなく撮り直した図で配布物が焼かれる**。
   * 撮影は SwiftShader の実描画なのでバイト列は毎回変わる。
   *
   *   pnpm --filter @ojt/desktop e2e         既定（撮り直しを含まない。`git status` は空のまま）
   *   pnpm --filter @ojt/desktop e2e:shots   図の撮り直し（撮ったら `git status docs/manual` を確認）
   */
  projects: [
    { name: 'default', testIgnore: ['**/manual-shots.spec.ts'] },
    { name: 'manual-shots', testMatch: ['**/manual-shots.spec.ts'] },
  ],
});
