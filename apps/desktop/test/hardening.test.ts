import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Electron ハードニングの固定（Phase 7 Task 8 / 指摘 DM-7・DM-4・DM-5 ≡ QA-05・DM-9）。
 *
 * ハードニングは **起動時にしか効かない設定**なので、単体テストからは「その設定で動いた」
 * ことを確かめようがない（`BrowserWindow` を実際に作らないと `webPreferences` は読めず、
 * CSP は renderer が読み込まれて初めて効く）。そこで**ソースの文字列**を検査する。
 * 見た目は素朴だが、`contextIsolation` が `false` に変わっても CSP の1行が消えても
 * 誰も気づかない、という DM-7 の穴はこれで塞がる。
 *
 * 配布物で実際に動くことの確認は `pnpm --filter @ojt/desktop dist` → `release/win-unpacked`
 * の起動（Playwright / CDP）で別途行う。sandbox の効き方は開発ビルドと配布物で違う。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mainSource = readFileSync(join(APP_ROOT, 'src', 'main', 'index.ts'), 'utf8');
const indexHtml = readFileSync(join(APP_ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const viteConfig = readFileSync(join(APP_ROOT, 'electron.vite.config.ts'), 'utf8');

describe('main の webPreferences とウィンドウの締め（DM-4 / DM-5 ≡ QA-05）', () => {
  it.each([
    ['contextIsolation: true'],
    ['nodeIntegration: false'],
    ['sandbox: true'],
    ['webviewTag: false'],
    ['allowRunningInsecureContent: false'],
    ['webSecurity: true'],
  ])('keeps %s in src/main/index.ts', (needle) => {
    expect(mainSource).toContain(needle);
  });

  it.each([
    ['setWindowOpenHandler'],
    ['will-navigate'],
    ['Menu.setApplicationMenu(null)'],
    ['setPermissionRequestHandler'],
  ])('still installs %s', (needle) => {
    expect(mainSource).toContain(needle);
  });

  it('denies every permission request (引数を受けて false を返す)', () => {
    expect(mainSource).toMatch(/setPermissionRequestHandler\(\s*\(_?\w+,\s*_?\w+,\s*\w+\)\s*=>/);
    expect(mainSource).toContain('session.defaultSession');
  });

  it('never re-enables the old sandbox: false', () => {
    expect(mainSource).not.toMatch(/^\s*sandbox:\s*false/m);
  });
});

describe('サンドボックス化した preload は CommonJS でしか読めない（DM-4）', () => {
  /*
   * `sandbox: true` の renderer は preload を **CommonJS** として読み込む。ESM の `.js` を
   * 指したままだと preload が丸ごと読み込まれず `window.ojt` が生えない（＝アプリが
   * 何もできなくなる）。main の読み込み先とビルド設定は必ず対で変える。
   */
  it('outputs the preload as index.cjs', () => {
    expect(viteConfig).toContain("format: 'cjs'");
    expect(viteConfig).toContain("entryFileNames: 'index.cjs'");
  });

  it('points webPreferences.preload at that .cjs', () => {
    expect(mainSource).toContain("'../preload/index.cjs'");
    expect(mainSource).not.toContain("'../preload/index.js'");
  });
});

describe('renderer の CSP（DM-9）', () => {
  const csp = /content="([^"]*)"/.exec(indexHtml)?.[1] ?? '';

  it('has a Content-Security-Policy meta tag', () => {
    expect(indexHtml).toContain('http-equiv="Content-Security-Policy"');
    expect(csp.length).toBeGreaterThan(0);
  });

  it.each([
    ['default-src'],
    ['script-src'],
    ['style-src'],
    ['img-src'],
    ['connect-src'],
    ['worker-src'],
    ['base-uri'],
    ['form-action'],
    ['frame-src'],
    ['frame-ancestors'],
  ])('declares %s explicitly (default-src へ落とさない)', (directive) => {
    expect(csp).toContain(`${directive} `);
  });

  it("forbids frames and form posts outright ('none')", () => {
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('never allows unsafe-eval or remote script origins', () => {
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('http://');
    expect(csp).not.toContain('https://');
  });
});
