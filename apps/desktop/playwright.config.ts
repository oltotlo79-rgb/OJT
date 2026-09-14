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
  reporter: [['list']],
  outputDir: './test-results',
});
