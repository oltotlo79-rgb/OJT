import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

/**
 * 印刷用 HTML を PDF にする。取扱説明書 設計 §7.1 / 決定表#4・#26。
 *
 *   electron scripts/print-manual.mjs
 *
 * puppeteer も wkhtmltopdf も使わない。配布に使うのと**同じ Chromium**（Electron 本体）で
 * 組むので、画面で見たとおりの体裁になり、Chromium をもう1つ取りに行かない（§15 のオフライン方針）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');
/*
 * テスト専用の差し替え口（既定は本番と同じ場所）。BL-1 の回帰検査は、実在の
 * `resources/manual/manual.html` を壊さずに「HTML が無い」経路を再現するため、
 * ここだけを一時フォルダに向ける（`print-manual.test.ts`）。
 */
const HTML =
  globalThis.process.env['OJT_PRINT_MANUAL_HTML'] ??
  join(APP_ROOT, 'resources', 'manual', 'manual.html');
const PDF =
  globalThis.process.env['OJT_PRINT_MANUAL_PDF'] ??
  join(APP_ROOT, 'resources', 'manual', 'manual.pdf');

/** A4・上下18mm・左右16mm（`printToPDF` の単位はインチ）。決定表#26 */
const MARGINS = { marginType: 'custom', top: 0.71, bottom: 0.71, left: 0.63, right: 0.63 };

/*
 * 配布の工程（`dist`）の途中で走るので、GPU は使わない。ビルド機にまともな GPU が
 * 無いとき（CI・リモートデスクトップ）に Chromium の初期化で待たされるのを避ける。
 * 紙面は CPU のラスタライザでまったく同じに焼ける。
 */
app.disableHardwareAcceleration();

async function main() {
  if (!existsSync(HTML)) {
    globalThis.process.stderr.write(
      `印刷用HTMLがありません: ${HTML}（先に node scripts/build-manual.mjs を走らせてください）\n`,
    );
    /*
     * BL-1: `app.quit()` は Electron 44.3.0 で `process.exitCode` を無視する（実測: 0 で
     * 終わる）。`dist` は `&&` 連結（`package.json`）なので、これでは印刷の失敗が次工程へ
     * そのまま通ってしまう。`app.exit(1)` は指定した終了コードで**確実に**プロセスを終える。
     */
    app.exit(1);
    return;
  }
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // 原稿には動く仕掛けが1つも無いので、実行を止めておく（読み込むのは自分で書いた HTML だけ）
      javascript: false,
    },
  });
  await window.loadFile(HTML);
  const pdf = await window.webContents.printToPDF({
    pageSize: 'A4',
    landscape: false,
    printBackground: true,
    margins: MARGINS,
    // 見出しから しおり を作る（長い説明書を紙でも画面でも引けるようにする）
    generateDocumentOutline: true,
  });
  writeFileSync(PDF, pdf);
  globalThis.process.stdout.write(
    `取扱説明書を書き出しました: ${PDF}（${String(Math.round(pdf.length / 1024))} KB）\n`,
  );
  window.destroy();
  app.quit();
}

/*
 * `then(main, onError)` にすると `main()` 自身が投げた例外を拾えず、`dist` が
 * 終わらないプロセスの前で止まる。`catch` を後ろに置いて両方を1箇所で受ける。
 */
app.whenReady().then(main).catch(onFailure);

function onFailure(error) {
  globalThis.process.stderr.write(`PDFの生成に失敗しました: ${String(error)}\n`);
  // BL-1: 上と同じ理由で `app.exit(1)` を使う（`app.quit()` は終了コードを無視する）。
  app.exit(1);
}
