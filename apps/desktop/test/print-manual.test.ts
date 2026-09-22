import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { describe, expect, it } from 'vitest';

/*
 * `electron` パッケージの型定義は Electron の API（`app` や `BrowserWindow`）を指すが、
 * ここは Electron の**外**（プレーンな Node/Vitest）から `require('electron')` しているので、
 * 実体は Electron の実行ファイルへのパス（文字列）である（`electron-builder` 等でも同じ書き方）。
 */
const electronPath = electron as unknown as string;

/**
 * PDF 印刷スクリプトの終了コード。BL-1（Phase 6 A/B レビュー）。
 *
 * `app.quit()` は Electron 44.3.0 で `process.exitCode` を無視して 0 で終わる
 * （レビューでの実測）。`dist` は `&&` 連結なので、それでは印刷の失敗が
 * 気づかれないまま次工程（`electron-builder`）へ進み、PDF の入らない配布物が出うる。
 * `app.exit(1)` に直してからも同じ穴が空かないよう、**実際に Electron を起動して**
 * 終了コードを確かめる（`OJT_PRINT_MANUAL_HTML` で対象 HTML だけを一時フォルダへ差し替え、
 * 本物の `resources/manual/manual.html` には触れない）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(APP_ROOT, 'scripts', 'print-manual.mjs');

describe('print-manual.mjs の終了コード（BL-1）', () => {
  it('exits non-zero when the print HTML is missing, so `dist` fails too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ojt-print-manual-'));
    try {
      const missingHtml = join(dir, 'manual.html');
      const result = spawnSync(electronPath, [SCRIPT, `--user-data-dir=${join(dir, 'profile')}`], {
        cwd: APP_ROOT,
        env: {
          ...globalThis.process.env,
          OJT_PRINT_MANUAL_HTML: missingHtml,
          OJT_PRINT_MANUAL_PDF: join(dir, 'manual.pdf'),
        },
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`印刷用HTMLがありません: ${missingHtml}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
