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
  // 撮影準備の待機はcaptureReadyに限定。操作・判定の失敗を再実行で隠さない。
  retries: 0,
  // `test.only` の置き忘れが CI をすり抜けないようにする（レビュー指摘 QA-04）
  forbidOnly: process.env['CI'] !== undefined,
  // 初回の失敗から操作履歴を残す。`test-results/` は `.gitignore` 済み。
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: process.env['CI'] !== undefined ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './test-results',
  /*
   * **`manual-shots.spec.ts` を既定から外す**（レビュー指摘 QA-02）。
   *
   * この spec は取扱説明書の図を撮り直すので、git 追跡下の `docs/manual/images/`（原寸と縮小版）
   * と `docs/manual/shot-geometry.json` を丸ごと書き換える。README が案内する順
   * （`e2e` → `dist`）で流すと、**タグ付けしたツリーではなく撮り直した図で配布物が焼かれる**。
   * 撮影は SwiftShader の実描画なのでバイト列は毎回変わる。
   *
   *   pnpm --filter @ojt/desktop e2e         既定（撮り直しを含まない。`git status` は空のまま）
   *   pnpm --filter @ojt/desktop e2e:shots   図の撮り直し（撮ったら `git status docs/manual` を確認）
   */
  projects: [
    { name: 'default', testIgnore: ['**/manual-shots.spec.ts', '**/portable.spec.ts'] },
    { name: 'manual-shots', testMatch: ['**/manual-shots.spec.ts'] },
    { name: 'packaged', testMatch: ['**/portable.spec.ts'] },
  ],
});
