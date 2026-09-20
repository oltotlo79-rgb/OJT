import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import PACKAGE from '../package.json' with { type: 'json' };
import { PRODUCT_NAME } from './manual-build.mjs';

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

/**
 * A4・上 18mm・左右 16mm・下 20mm（`printToPDF` の単位はインチ）。決定表#26 ／ Phase 7 設計 §6.2。
 * 版面は CSS の `@page` を正とする（`preferCSSPageSize`）が、柱とノンブルは Chromium が
 * **この余白の中に**描くので、同じ値をここにも渡して場所を空けておく。
 */
const MARGINS = { marginType: 'custom', top: 0.709, bottom: 0.787, left: 0.63, right: 0.63 };

/** 表紙・柱に出す版（`package.json` と二重管理しない）。 */
const EDITION = `v${PACKAGE.version}`;

/*
 * 柱（ランニングヘッダ）とノンブル。Chromium の既定の差し込みは 8px で読めないので、
 * 書体と大きさ（9pt）と左右の余白（16mm。本文の版面に合わせる）を明示する。
 * 使えるのは Chromium が入れ替える 5 つの印（`date` `title` `url` `pageNumber` `totalPages`）
 * だけで、**ページごとに変わる章題は差し込めない**ので、柱の右には版を出す。
 */
const HEADER_FOOTER_STYLE =
  "font-family:'Yu Gothic UI','Meiryo',sans-serif;font-size:9pt;color:#4a5666;width:100%;margin:0 16mm;";
const HEADER_TEMPLATE =
  `<div style="${HEADER_FOOTER_STYLE}display:flex;justify-content:space-between;">` +
  `<span>${PRODUCT_NAME} 取扱説明書</span><span>${EDITION}</span></div>`;
const FOOTER_TEMPLATE =
  `<div style="${HEADER_FOOTER_STYLE}text-align:center;">` +
  '<span class="pageNumber"></span> / <span class="totalPages"></span></div>';

/*
 * 配布の工程（`dist`）の途中で走るので、GPU は使わない。ビルド機にまともな GPU が
 * 無いとき（CI・リモートデスクトップ）に Chromium の初期化で待たされるのを避ける。
 * 紙面は CPU のラスタライザでまったく同じに焼ける。
 */
app.disableHardwareAcceleration();

/**
 * 印刷用 HTML の表紙から発行日（`YYYYMMDD`）を読む。無ければ `undefined`。
 * @param {string} html
 * @returns {string | undefined}
 */
function dayOf(html) {
  const match = /<p class="cover-meta">(\d{4})-(\d{2})-(\d{2}) 発行<\/p>/u.exec(html);
  return match === null ? undefined : `${match[1]}${match[2]}${match[3]}`;
}

/**
 * PDF の `/CreationDate` と `/ModDate` を「その日の 00:00:00」に丸める。
 *
 * Chromium は焼いた**時刻**を秒まで書き込むので、同じ原稿から作った PDF が走らせるたびに
 * 違うバイト列になり、配布物のチェックサムが毎回変わる（`build-manual.mjs` が生成日を
 * 日付だけにしているのと同じ理由）。差し替えは**同じ桁数**にして、相互参照表（xref）の
 * 位置がずれないようにする。
 * @param {globalThis.Buffer} pdf
 * @param {string | undefined} day
 * @returns {globalThis.Buffer}
 */
function withStableDates(pdf, day) {
  const stamped = pdf
    .toString('latin1')
    .replace(
      /\/(CreationDate|ModDate)\s*\(D:(\d{8})\d{6}([^)]*)\)/gu,
      (_all, key, own, zone) => `/${key} (D:${day ?? own}000000${zone})`,
    );
  return globalThis.Buffer.from(stamped, 'latin1');
}

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
  const printed = await window.webContents.printToPDF({
    pageSize: 'A4',
    landscape: false,
    printBackground: true,
    margins: MARGINS,
    // 版面は CSS の `@page`（18mm 16mm 20mm）を正とする。Phase 7 設計 §6.2
    preferCSSPageSize: true,
    // 柱とノンブル（Phase 7 設計 §6.2）
    displayHeaderFooter: true,
    headerTemplate: HEADER_TEMPLATE,
    footerTemplate: FOOTER_TEMPLATE,
    // 見出しから しおり を作る（長い説明書を紙でも画面でも引けるようにする）
    generateDocumentOutline: true,
    // 読み上げソフトが見出し・表・図を構造として拾えるようにする（Phase 7 設計 §6.2）
    generateTaggedPDF: true,
  });
  const pdf = withStableDates(printed, dayOf(readFileSync(HTML, 'utf8')));
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

/** @param {unknown} error */
function onFailure(error) {
  globalThis.process.stderr.write(`PDFの生成に失敗しました: ${String(error)}\n`);
  // BL-1: 上と同じ理由で `app.exit(1)` を使う（`app.quit()` は終了コードを無視する）。
  app.exit(1);
}
