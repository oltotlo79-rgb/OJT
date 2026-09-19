import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD, PLC_UNIT_FX5U, trySocketOf } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  plcWiringPlan,
  resolvePlcIo,
  toSocketRoles,
} from '@ojt/content';
import { COIL_COL } from '@ojt/ladder-core';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { finishedSize, overlayHtml } from '../scripts/annotate-shots.mjs';
import { HELP_IMAGE_WIDTH } from '../scripts/manual-build.mjs';
import {
  GIZMO_BUTTON,
  GIZMO_GRID_PX,
  gizmoLayoutForViewport,
} from '../src/renderer/three/ViewGizmo.js';
import {
  boardPoint,
  PLC_BOARD,
  plcBoardPoint,
  plcTerminalPoint,
  roleTerminalPoint,
  SELF_HOLD_WIRES,
  terminalPoint,
  type CanvasBox,
} from './projection.js';

/**
 * 取扱説明書の図を撮る。取扱説明書 設計 §6.4 / 決定表#24・#24b・#24c、Plan 6 Task 12。
 *
 *   pnpm --filter @ojt/desktop build
 *   pnpm --filter @ojt/desktop e2e manual-shots
 *
 * ①アプリをその画面まで動かし、`capturePage()` で素のPNGを `.manual-raw/` へ
 * ②**そのとき画面にあった部品の矩形を測って** `docs/manual/shot-geometry.json` を書く
 * ③`overlayHtml()` が組んだ HTML をアプリのウィンドウで開き直して撮り、`docs/manual/images/` へ
 *
 * 吹き出しの位置は**必ず実測**する（`boundingBox()`／3Dは `projection.ts` の射影／
 * ビューキューブは `ViewGizmo.tsx` が実際に使う `gizmoLayoutForViewport()`）。画素を手で
 * 書くと、画面を直したときに図だけが黙って古くなる。
 *
 * **画面を直したら撮り直す**（`docs/releases/v1.0.0.md` のチェックリスト 8a）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const RAW_DIR = join(APP_ROOT, '.manual-raw');
const OUT_DIR = join(MANUAL_DIR, 'images');
const SMALL_DIR = join(OUT_DIR, 'small');

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Shot {
  caption: string;
  callouts: Array<{ n: number; label: string }>;
}

interface Geometry {
  crop?: Rect;
  callouts: Record<string, Rect>;
}

const SHOTS = JSON.parse(readFileSync(join(MANUAL_DIR, 'shots.json'), 'utf8')) as Record<
  string,
  Shot
>;

/** 撮る大きさ。枠を除いた**中身**を 1280×800 にする（決定表#24）。 */
const SHOT_SIZE = { width: 1280, height: 800 } as const;

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  // 画面の倍率が 100% でないパソコンでも 1280×800 ちょうどで撮れるようにする
  '--force-device-scale-factor=1',
];

/**
 * この spec だけの `userData`（`plc-vendors.spec.ts` と同じ流儀）。既定メーカーや
 * 一時保存・最近の課題をここに閉じ込めるので、**他の spec と利用者の設定を汚さない**。
 * 既定メーカー（三菱）を戻す後始末も、このフォルダを捨てるだけで済む。
 *
 * 置き場所は**共有（`%PUBLIC%`）**にする。設定画面と課題一覧は「利用者課題フォルダ」の
 * 実際のパスを画面に出すので、既定の `…¥Users¥〈Windowsのアカウント名〉¥AppData¥…` で
 * 撮ると、配る取扱説明書に撮影した人のアカウント名が載ってしまう。
 */
const USER_DATA_DIR = join(
  process.env['PUBLIC'] ?? mkdtempSync(join(tmpdir(), 'ojt-')),
  '電気教育ツール',
);

/** 測った矩形の置き場（撮り終わったあとで `shot-geometry.json` にまとめる）。 */
const GEOMETRY: Record<string, Geometry> = {};

let app: ElectronApplication;
let page: Page;

/* ------------------------------------------------------------------ *
 * 測る
 * ------------------------------------------------------------------ */

/** 画面の中に収める。 */
function clampRect(rect: Rect): Rect {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  return {
    x,
    y,
    w: Math.max(8, Math.min(SHOT_SIZE.width - x, Math.round(rect.w))),
    h: Math.max(8, Math.min(SHOT_SIZE.height - y, Math.round(rect.h))),
  };
}

/** 要素の矩形を測る（`pad` だけ外へ広げる）。 */
async function rectOf(locator: Locator, pad = 4): Promise<Rect> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('矩形を取得できませんでした');
  return clampRect({
    x: box.x - pad,
    y: box.y - pad,
    w: box.width + pad * 2,
    h: box.height + pad * 2,
  });
}

/**
 * 幅の無い要素（SVG の `<line>` など）の矩形を測る。
 * Playwright は面積0の要素を「見えていない」と見なすので `toBeVisible()` は使えない。
 */
async function rectOfThinLine(locator: Locator): Promise<Rect> {
  await locator.waitFor({ state: 'attached' });
  const box = await locator.boundingBox();
  if (box === null) throw new Error('線の矩形を取得できませんでした');
  return clampRect({ x: box.x, y: box.y, w: Math.max(1, box.width), h: box.height });
}

/**
 * その要素が**本当に画面に写っている**ことを確かめる。
 * `toBeVisible()` は「DOM にあって大きさがある」までしか見ないので、親の `overflow` で
 * 隠れている要素（`.editorPane` の下へ流れた検算パネルなど）も通ってしまい、
 * 図にすると「何も無いところを指した吹き出し」になる。
 */
async function expectOnScreen(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const shown = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return hit !== null && (element.contains(hit) || hit.contains(element));
  });
  expect(shown, '画面に写っていません（親の overflow で隠れています）').toBe(true);
}

/** 点のまわりの矩形（3Dの端子など、DOM に無いものを指すときに使う）。 */
function rectAt(point: { x: number; y: number }, size: number): Rect {
  return clampRect({ x: point.x - size / 2, y: point.y - size / 2, w: size, h: size });
}

/** 細い線（チャートの合わせ線など）を、枠として見える太さまで広げる。 */
function widenRect(rect: Rect, minWidth: number): Rect {
  if (rect.w >= minWidth) return rect;
  return clampRect({ x: rect.x - (minWidth - rect.w) / 2, y: rect.y, w: minWidth, h: rect.h });
}

/* ------------------------------------------------------------------ *
 * 撮る
 * ------------------------------------------------------------------ */

/**
 * 画面が落ち着くまで待つ（`plc-vendors.spec.ts` / `schematic.spec.ts` と同じ）。
 * 切り替えた直後はコンポジタに前の画面のフレームしか届いていない。
 */
async function settle(): Promise<void> {
  await page.evaluate(
    async () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );
  await page.waitForTimeout(900);
  if ((await page.locator('[data-testid="viewport"] canvas').count()) > 0) {
    await page.waitForTimeout(2500);
  }
}

/** いまのウィンドウの中身をPNGで取る。 */
async function capturePage(): Promise<Buffer> {
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    return image.toPNG().toString('base64');
  });
  return Buffer.from(base64, 'base64');
}

/** PNG のヘッダ（IHDR）から寸法を読む。 */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** 丸数字とラベルを並べた札のおおよその幅[px]（`annotate-shots.mjs` と同じ見積り）。 */
function markWidth(label: string): number {
  return 28 + 24 + [...label].length * 14;
}

/**
 * 吹き出しが全部入る切り出し。**測った矩形からだけ**決めるので、画面を直しても
 * 手で数字を書き直す作業が出ない。小さすぎる図は周りの文脈が読めないので下限を置く。
 */
function autoCrop(name: string, callouts: Record<string, Rect>): Rect {
  const shot = SHOTS[name];
  if (shot === undefined) throw new Error(`${name} が shots.json にありません`);
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const callout of shot.callouts) {
    const rect = callouts[String(callout.n)];
    if (rect === undefined) throw new Error(`${name} の吹き出し ${String(callout.n)} が測れません`);
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w, rect.x + markWidth(callout.label));
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  // 札は枠の左上から 14px はみ出すので、そのぶんと読みやすさの余白を足す
  const pad = 44;
  const minWidth = 620;
  const minHeight = 400;
  let width = Math.min(SHOT_SIZE.width, Math.max(minWidth, right - left + pad * 2));
  let height = Math.min(SHOT_SIZE.height, Math.max(minHeight, bottom - top + pad * 2));
  width = Math.round(width);
  height = Math.round(height);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const x = Math.round(Math.min(Math.max(0, centerX - width / 2), SHOT_SIZE.width - width));
  const y = Math.round(Math.min(Math.max(0, centerY - height / 2), SHOT_SIZE.height - height));
  return { x, y, w: width, h: height };
}

/**
 * 1枚撮る。`callouts` は**吹き出しの番号 → 実測した矩形**。
 * `crop` が `'auto'` なら吹き出しが入る範囲だけを切り出す（300KB に収めるため。決定表#25）。
 */
async function shoot(
  name: string,
  callouts: Record<number, Rect>,
  crop: 'full' | 'auto',
): Promise<void> {
  const shot = SHOTS[name];
  expect(shot, `${name} が shots.json にありません`).toBeDefined();
  if (shot === undefined) return;
  const measured: Record<string, Rect> = {};
  for (const callout of shot.callouts) {
    const rect = callouts[callout.n];
    expect(
      rect,
      `${name} の吹き出し ${String(callout.n)}（${callout.label}）を測れていません`,
    ).toBeDefined();
    if (rect === undefined) return;
    measured[String(callout.n)] = rect;
  }
  expect(Object.keys(measured).length, `${name} に shots.json に無い吹き出しがあります`).toBe(
    Object.keys(callouts).length,
  );

  await settle();
  const png = await capturePage();
  const size = pngSize(png);
  expect(
    `${String(size.width)}x${String(size.height)}`,
    `${name} を 1280x800 で撮れませんでした`,
  ).toBe('1280x800');
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(join(RAW_DIR, `${name}.png`), png);

  const geometry: Geometry =
    crop === 'auto'
      ? { crop: autoCrop(name, measured), callouts: measured }
      : { callouts: measured };
  // 測った矩形は素のPNGの隣にも残す（あとで「どこを指したか」を機械で追える）
  writeFileSync(join(RAW_DIR, `${name}.json`), `${JSON.stringify(geometry, null, 2)}\n`, 'utf8');
  GEOMETRY[name] = geometry;
}

/* ------------------------------------------------------------------ *
 * 仕上げる（吹き出しを描き込む）
 * ------------------------------------------------------------------ */

/**
 * 吹き出しを重ねた HTML をアプリのウィンドウで開き直して撮る。
 *
 * Playwright の Electron ランナーからは別のページを開けないので、**素のPNGを撮り終えた
 * あとの**ウィンドウをそのまま使う（決定表 P15 の「Chromium に描かせる」は満たす）。
 * 素のPNGは `data:` で埋め込むので、`file://` 同士の読み取り許可に依存しない。
 * 窓の最小寸法（`minWidth: 1100`）より小さい図があるため、切り出しは撮ったあとの
 * `nativeImage.crop()` で行う（窓を縮めるのではなく、1280×800 の左上に描いて切る）。
 */
async function annotate(name: string): Promise<void> {
  const shot = SHOTS[name];
  const geometry = GEOMETRY[name];
  if (shot === undefined || geometry === undefined) {
    throw new Error(`${name} を撮れていません`);
  }
  const raw = readFileSync(join(RAW_DIR, `${name}.png`));
  const html = overlayHtml(
    `data:image/png;base64,${raw.toString('base64')}`,
    shot,
    geometry,
    SHOT_SIZE,
  );
  const htmlPath = join(RAW_DIR, `${name}.overlay.html`);
  writeFileSync(htmlPath, html, 'utf8');

  const size = finishedSize(geometry, SHOT_SIZE);
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SMALL_DIR, { recursive: true });

  const small = {
    width: HELP_IMAGE_WIDTH,
    height: Math.ceil((size.height * HELP_IMAGE_WIDTH) / size.width),
  };
  const shots = await app.evaluate(
    async ({ BrowserWindow }, job) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      await window.loadFile(job.htmlPath);
      // 図が焼き上がるまで待つ（`data:` なので読み込みは同期に近いが、描画は次のフレーム）
      await window.webContents.executeJavaScript(
        'new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(() => { done(true); })); })',
      );
      const full = (await window.capturePage()).crop({
        x: 0,
        y: 0,
        width: job.size.width,
        height: job.size.height,
      });
      // 縮小版は同じ覆いを `transform: scale()` で縮めて撮り直す（別の道具は要らない）
      await window.webContents.executeJavaScript(
        `(() => { const frame = document.querySelector('.frame');
          frame.style.transformOrigin = 'top left';
          frame.style.transform = 'scale(${String(job.scale)})';
          return new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(() => { done(true); })); }); })()`,
      );
      const reduced = (await window.capturePage()).crop({
        x: 0,
        y: 0,
        width: job.small.width,
        height: job.small.height,
      });
      return {
        full: full.toPNG().toString('base64'),
        small: reduced.toPNG().toString('base64'),
      };
    },
    { htmlPath, size, small, scale: HELP_IMAGE_WIDTH / size.width },
  );

  writeFileSync(join(OUT_DIR, `${name}.png`), Buffer.from(shots.full, 'base64'));
  writeFileSync(join(SMALL_DIR, `${name}.png`), Buffer.from(shots.small, 'base64'));
}

/* ------------------------------------------------------------------ *
 * 画面まで動かす（既存6本の E2E と同じ操作）
 * ------------------------------------------------------------------ */

/** どの画面からでもホームへ戻る（`inspect.spec.ts` の `goHome()` と同じ流儀）。 */
async function goHome(): Promise<void> {
  const home = page.getByTestId('mode-assemble');
  if ((await home.count()) > 0) {
    await expect(home).toBeVisible();
    return;
  }
  const settingsBack = page.getByRole('button', { name: 'ホームへ戻る', exact: true });
  if ((await settingsBack.count()) > 0) {
    await settingsBack.first().click();
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
  await listBack.first().click();
  await expect(home).toBeVisible();
}

/** ホーム → モード → 課題を開く。 */
async function openProblem(modeTestId: string, problemId: string): Promise<void> {
  await goHome();
  await page.getByTestId(modeTestId).click();
  await expect(page.getByTestId('problem-table')).toBeVisible();
  await page.getByTestId(`open-${problemId}`).click();
}

/** WebGL の初期化とシーンの1フレーム目を待つ。 */
async function waitForBoard(): Promise<CanvasBox> {
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), { timeout: 30_000 })
    .toBe(1);
  await page.waitForTimeout(1500);
  const box = await page.locator('[data-testid="viewport"] canvas').boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/** 通電する（ブレーカ → 電源スイッチ。§5.3.5）。 */
async function powerOn(): Promise<void> {
  const breaker = page.getByTestId('power-breaker');
  if ((await breaker.getAttribute('aria-pressed')) !== 'true') await breaker.click();
  const supply = page.getByTestId('power-switch');
  if ((await supply.getAttribute('aria-pressed')) !== 'true') await supply.click();
  await expect(page.getByTestId('status-overlay')).toContainText('通電中');
}

/** ソケット S1 の台座の中央（盤ローカル mm）。 */
function socketBodyPoint(): { x: number; y: number; z: number } {
  const socket = JIPM_BOARD.sockets[0];
  if (socket === undefined) throw new Error('ソケットが定義されていません');
  return {
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: 9,
  };
}

/* ------------------------------------------------------------------ *
 * モードDの材料（`plc.spec.ts` からの写し）
 * ------------------------------------------------------------------ */

const PLC_PROBLEM = (() => {
  const found = BUILTIN_PLC_PROBLEMS[0];
  if (found === undefined) throw new Error('内蔵モードD課題がありません');
  return found;
})();
const PLC_ROLES = toSocketRoles(PLC_PROBLEM.board.socketRoles);
const PLC_IO = resolvePlcIo(PLC_PROBLEM.io);
const PLC_REFERENCE_WIRES: ReadonlyArray<readonly [string, string]> = plcWiringPlan(
  PLC_IO,
  PLC_UNIT_FX5U,
).map((wire) => [String(wire.from), String(wire.to)] as const);

/** ラダーエディタにキーを送る。 */
async function ladderKey(name: string): Promise<void> {
  await page.getByTestId('ladder-editor').press(name);
}

/** デバイス入力欄に入れて確定する。 */
async function commitDevice(text: string): Promise<void> {
  await expect(page.getByTestId('device-input')).toBeVisible();
  await page.getByTestId('device-text').fill(text);
  await page.getByTestId('device-commit').click();
  await expect(page.getByTestId('device-input')).toHaveCount(0);
}

async function expectCursorAt(cell: string): Promise<void> {
  await expect(page.getByTestId(`cell-${cell}`)).toHaveAttribute('aria-selected', 'true');
}

/** →キーでコイル列までカーソルを送る。 */
async function moveToCoil(networkId: string, fromCol: number): Promise<void> {
  await expectCursorAt(`${networkId}:0:${String(fromCol)}`);
  const coil = page.getByTestId(`cell-${networkId}:0:${String(COIL_COL)}`);
  for (let step = 0; step < COIL_COL; step += 1) {
    if ((await coil.getAttribute('aria-selected')) === 'true') break;
    await ladderKey('ArrowRight');
  }
  await expectCursorAt(`${networkId}:0:${String(COIL_COL)}`);
}

async function insertNetwork(expectedId: string): Promise<void> {
  await page.getByTestId('toolbar-insert-network').click();
  await expectCursorAt(`${expectedId}:0:0`);
}

/** 模範と同じ動きをするラダーを組む（`plc.spec.ts` の `buildReferenceLadder()` と同じ手）。 */
async function buildReferenceLadder(): Promise<void> {
  await expectCursorAt('n1:0:0');
  await ladderKey('F5');
  await commitDevice('X0');
  await ladderKey('ArrowLeft');
  await ladderKey('Shift+F5');
  await commitDevice('Y0');
  await expect(page.getByTestId('cell-n1:1:0')).toBeVisible();
  await ladderKey('ArrowRight');
  await ladderKey('F6');
  await commitDevice('X1');
  await moveToCoil('n1', 3);
  await ladderKey('F7');
  await commitDevice('Y0');

  await insertNetwork('n2');
  await ladderKey('F6');
  await commitDevice('Y0');
  await ladderKey('F5');
  await commitDevice('X1');
  await moveToCoil('n2', 2);
  await ladderKey('F7');
  await commitDevice('Y1');

  await insertNetwork('n3');
  await ladderKey('F5');
  await commitDevice('X2');
  await moveToCoil('n3', 1);
  await ladderKey('F7');
  await commitDevice('Y2');
}

/** モードDの盤に電線を1本張る。 */
async function plcWire(box: CanvasBox, from: string, to: string): Promise<void> {
  const a = plcTerminalPoint(PLC_ROLES, from, box);
  const b = plcTerminalPoint(PLC_ROLES, to, box);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(80);
}

/** モードDの押ボタンの頭が来るページ座標（`plc` 視点）。 */
function plcPushButtonPoint(pbId: string, box: CanvasBox): { x: number; y: number } {
  const definition = PLC_BOARD.pushButtons.find((pb) => pb.id === pbId);
  if (definition === undefined) throw new Error(`押ボタン ${pbId} が見つかりません`);
  return plcBoardPoint({ x: definition.pos.x, y: definition.pos.y, z: 4.5 }, box);
}

/* ------------------------------------------------------------------ *
 * 撮影
 * ------------------------------------------------------------------ */

test.describe.serial('取扱説明書の図', () => {
  test.beforeAll(async () => {
    rmSync(RAW_DIR, { recursive: true, force: true });
    app = await electron.launch({
      args: [
        join(APP_ROOT, 'out', 'main', 'index.js'),
        ...CHROMIUM_FLAGS,
        `--user-data-dir=${USER_DATA_DIR}`,
      ],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      // 枠を除いた中身を 1280×800 にする（`setBounds` は枠を含むので使わない）
      window.setContentSize(1280, 800);
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1500);
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }
    await expect(page.getByTestId('mode-assemble')).toBeVisible({ timeout: 30_000 });
  });

  test.afterAll(async () => {
    await app.close();
    rmSync(USER_DATA_DIR, { recursive: true, force: true });
  });

  test('モードB: 練習の画面・ビューキューブ・カード・札・結果・タイムチャート', async () => {
    await openProblem('mode-assemble', 'b-001');
    const box = await waitForBoard();

    // --- session-board: 画面をどう読むか（上の帯・手順・3D・右・下） ---
    await shoot(
      'session-board',
      {
        1: await rectOf(page.locator('div[role="toolbar"]').first(), 0),
        2: await rectOf(page.getByTestId('step-guide'), 0),
        3: await rectOf(page.getByTestId('viewport'), 0),
        4: await rectOf(page.locator('[class*="rightPanel"]').first(), 0),
        5: await rectOf(page.locator('[class*="bottomPanel"]').first(), 0),
      },
      'full',
    );

    // --- view-cube: ビューキューブと2つの丸ボタン（HUD は3Dなので配置器から求める） ---
    await page.getByTestId('view-hint-toggle').click();
    await expect(page.getByTestId('view-hint')).toBeVisible();
    const layout = gizmoLayoutForViewport(box.width, box.height);
    expect(layout, 'この大きさではビューキューブが出ません').not.toBeNull();
    if (layout === null) return;
    // ⌂/⟳ はキューブの外形のすぐ下（`gizmoButtonYPx()`）なので、そこから外形の半径を戻す
    const cubeRadius = -layout.buttonY - (GIZMO_GRID_PX + GIZMO_BUTTON.size / 2);
    const center = { x: box.x + layout.margin[0], y: box.y + layout.margin[1] };
    const buttonY = center.y - layout.buttonY;
    await shoot(
      'view-cube',
      {
        1: clampRect({
          x: center.x - cubeRadius,
          y: center.y - cubeRadius,
          w: cubeRadius * 2,
          h: cubeRadius * 2,
        }),
        2: rectAt({ x: center.x - GIZMO_BUTTON.x, y: buttonY }, GIZMO_BUTTON.size + 8),
        3: rectAt({ x: center.x + GIZMO_BUTTON.x, y: buttonY }, GIZMO_BUTTON.size + 8),
        4: await rectOf(page.getByTestId('view-hint')),
      },
      'auto',
    );
    await page.getByTestId('view-hint-toggle').click();
    await expect(page.getByTestId('view-hint')).toHaveCount(0);

    // --- socket-card: ソケットのカード（部品が乗っている状態） ---
    await page.mouse.click(
      boardPoint(socketBodyPoint(), box).x,
      boardPoint(socketBodyPoint(), box).y,
    );
    await expect(page.getByTestId('socket-card')).toBeVisible();
    await page.getByTestId('mount-relay-my4n').click();
    await expect(page.getByTestId('operation-log')).toContainText('S1 に リレー MY4N を装着');
    await expect(page.getByTestId('card-unmount')).toBeVisible();
    await shoot(
      'socket-card',
      {
        1: await rectOf(page.getByTestId('socket-card-status')),
        2: await rectOf(page.getByTestId('card-unmount')),
        3: await rectOf(page.getByTestId('card-swap')),
      },
      'auto',
    );

    // --- session-terminal: 端子にマウスを乗せたときの札 ---
    const terminal = terminalPoint(toTerminalId('S1.9'), box);
    await page.mouse.move(terminal.x, terminal.y);
    const tooltip = page.locator('.terminal-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 15_000 });
    await shoot(
      'session-terminal',
      { 1: await rectOf(tooltip, 6), 2: rectAt(terminal, 34) },
      'auto',
    );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);

    // --- judge-result / timechart: 配線して通電して判定する ---
    for (const [from, to] of SELF_HOLD_WIRES) {
      const a = terminalPoint(toTerminalId(from), box);
      const b = terminalPoint(toTerminalId(to), box);
      await page.mouse.click(a.x, a.y);
      await page.mouse.click(b.x, b.y);
    }
    await powerOn();
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('verdict')).toHaveText('合格');

    await shoot(
      'judge-result',
      {
        1: await rectOf(page.getByRole('heading', { name: /^差分一覧/u }).locator('xpath=..'), 0),
        2: await rectOf(
          page.getByRole('heading', { name: /^静的チェック/u }).locator('xpath=..'),
          0,
        ),
        3: await rectOf(page.getByRole('heading', { name: /^危険操作/u }).locator('xpath=..'), 0),
        4: await rectOf(page.getByTestId('result-elapsed')),
        5: await rectOf(page.getByTestId('verdict')),
      },
      'full',
    );

    await page.getByTestId('chart-enlarge-button').first().click();
    await expect(page.getByTestId('chart-modal')).toBeVisible();
    const large = page.getByTestId('chart-overlay-large');
    await expect(large).toBeVisible();
    await page.waitForTimeout(500);
    await shoot(
      'timechart',
      {
        1: await rectOf(large.locator('[data-role="row-label"]').nth(3), 4),
        2: widenRect(await rectOfThinLine(large.locator('[data-guide="edge"]').first()), 26),
        3: await rectOf(large.locator('[data-role="row-label"]').first(), 4),
      },
      'full',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chart-modal')).toHaveCount(0);
  });

  test('回路図エディタ（検算まで）', async () => {
    await openProblem('mode-assemble', 'b-001');
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.getByTestId('assemble-view-schematic').click();
    await expect(page.getByTestId('schematic-editor')).toBeVisible();

    // 段1だけ描く（ランプの段が無いので、検算は「足りないところ」を挙げる）
    await page.getByTestId('palette-pb-b:PB2').click();
    await page.locator('[data-slot="r1#0"]').click();
    await page.getByTestId('palette-pb-a:PB1').click();
    await page.locator('[data-slot="r1#1"]').click();
    await page.getByTestId('palette-coil:CR1').click();
    await page.locator('[data-slot="r1#2"]').click();

    /*
     * 2段目を足して空のままにすると「回路図の指摘」に足りないところが出る（§11.4）。
     * **検算の結果は撮らない**: エディタの箱（`.editorPane`）は 1280×800 では縦が
     * 505px しかなく、ツールバー（②③④）と検算パネルは同時に画面へ入らない
     * （検算パネルは箱の下へ 80px ほど流れる）。図は上の4つと「回路図の指摘」までにし、
     * 検算の結果のことは本文で説明する（`docs/manual/07-schematic.md`）。
     */
    await page.getByTestId('add-rung-button').click();
    await expect(page.getByTestId('schematic-issues')).toBeVisible();
    await page.waitForTimeout(400);
    await expectOnScreen(page.getByTestId('schematic-issues'));
    await expectOnScreen(page.getByTestId('add-rung-button'));

    await shoot(
      'schematic-editor',
      {
        1: await rectOf(page.getByTestId('schematic-palette'), 0),
        2: await rectOf(page.getByTestId('add-rung-button')),
        3: await rectOf(page.getByTestId('remove-rung-button')),
        4: await rectOf(page.getByTestId('clear-button')),
        5: await rectOf(page.getByTestId('schematic-issues'), 0),
      },
      'full',
    );
  });

  test('モードC1: テスターとマークシート', async () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    expect(problem, '内蔵C1課題がありません').toBeDefined();
    if (problem === undefined) return;
    await openProblem('mode-inspect-parts', problem.id);
    await expect(page.getByTestId('check-tray')).toBeVisible();
    await waitForBoard();

    const first = problem.parts[0];
    expect(first, 'C1課題に部品がありません').toBeDefined();
    if (first === undefined) return;
    await page.getByTestId(`plug-${first.id}`).click();
    await powerOn();
    /*
     * アナログに切り替える。デジタルはオートレンジで**レンジのつまみを持たない**
     * （`panels/TesterPanel.tsx` の `kind === 'digital'` の枝）ので、`shots.json` の
     * ②「レンジ」が写らない（§9.3）。
     */
    await page.getByRole('button', { name: 'アナログ', exact: true }).click();
    await page.getByRole('button', { name: 'Ω', exact: true }).click();
    await expect(page.getByTestId('tester-ranges')).toBeVisible();
    await page.getByTestId('probe-target-coil').click();
    await page.waitForTimeout(1200);

    await shoot(
      'c1-tester',
      {
        1: await rectOf(page.getByTestId('tester-modes')),
        2: await rectOf(page.getByTestId('tester-ranges')),
        3: await rectOf(page.getByTestId('probe-black')),
        4: await rectOf(page.getByTestId('probe-red')),
      },
      'auto',
    );

    for (const part of problem.parts) {
      await page.getByTestId(`answer-${part.id}-${part.truth}`).click();
    }
    await expect(page.getByTestId('answered-count')).toContainText(
      `${String(problem.parts.length)} / ${String(problem.parts.length)}`,
    );
    /*
     * 右の欄をマークシートの見出しが出るところまで送る。`scrollIntoViewIfNeeded()` だと
     * 見出しが欄の上端で切れることがあるので、**上に少し余白を残して**自分で送る。
     */
    await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="mark-sheet"]');
      const panel = sheet?.closest('[class*="rightPanel"]');
      if (!(panel instanceof HTMLElement) || sheet === null) return;
      panel.scrollTop += sheet.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
    });
    await page.waitForTimeout(400);

    const markSheet = page.getByTestId('mark-sheet');
    await expectOnScreen(markSheet.locator('h2'));
    await expectOnScreen(markSheet.locator('th').nth(1));
    await expectOnScreen(page.getByTestId('answered-count'));
    await shoot(
      'c1-marksheet',
      {
        1: await rectOf(markSheet.locator('h2')),
        2: await rectOf(markSheet.locator('th').nth(1)),
        3: await rectOf(page.getByTestId('answered-count')),
      },
      'auto',
    );
  });

  test('モードC2: 指摘の欄', async () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    expect(problem, '内蔵C2課題がありません').toBeDefined();
    if (problem === undefined) return;
    await openProblem('mode-inspect-repair', problem.id);
    await expect(page.getByTestId('report-panel')).toBeVisible();
    const box = await waitForBoard();
    const roles = toSocketRoles(problem.board.socketRoles);

    await page.getByTestId('tool-report').click();

    // 1件だけ登録して「指摘一覧」に中身を作る
    const firstTerminal = roleTerminalPoint(roles, 'CR1.9', box);
    await page.mouse.click(firstTerminal.x, firstTerminal.y);
    await expect(page.getByTestId('report-popover')).toBeVisible();
    await page.locator('[data-testid^="report-kind-"]').first().click();
    await expect(page.getByTestId('report-count')).toHaveText('1');

    // 2件目を選びかけた状態（種別の窓が開き、選んだ端子が光っている）で撮る
    const secondTerminal = roleTerminalPoint(roles, 'CR1.13', box);
    await page.mouse.click(secondTerminal.x, secondTerminal.y);
    await expect(page.getByTestId('report-popover')).toBeVisible();

    await shoot(
      'c2-repair',
      {
        1: await rectOf(page.getByTestId('tool-report')),
        2: await rectOf(page.getByTestId('report-popover'), 0),
        3: await rectOf(page.getByTestId('report-list'), 0),
        4: rectAt(secondTerminal, 36),
      },
      'auto',
    );
    await page.getByTestId('report-cancel').click();
  });

  test('モードD: ラダー・表記の切替・モニタ', async () => {
    await openProblem('mode-plc', PLC_PROBLEM.id);
    await expect(page.getByTestId('plc-session')).toBeVisible();
    await page.getByTestId('view-ladder').click();
    await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'ladder');
    await expect(page.getByTestId('ladder-editor')).toBeVisible();

    await buildReferenceLadder();
    await expect(page.getByTestId('convert-state')).toHaveText('未変換（F4 で変換します）');
    // 組み終わりはカーソルが n3 にあり、ラダーが下まで送られている。先頭から見せる
    await page.getByTestId('cell-n1:0:0').click();
    await page.waitForTimeout(300);

    await shoot(
      'plc-ladder',
      {
        1: await rectOf(page.getByTestId('plc-guide'), 0),
        2: await rectOf(page.getByTestId('toolbar-convert')),
        3: await rectOf(page.getByTestId('toolbar-download')),
        4: await rectOf(page.getByTestId('toolbar-monitor-start')),
        5: await rectOf(page.getByTestId('judge-button')),
      },
      'full',
    );

    // --- plc-notation: 表記の切替 ---
    await page.getByTestId('toolbar-notation').click();
    const dialog = page.getByTestId('notation-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('notation-to-omron').click();
    await expect(page.getByTestId('notation-change-0')).toBeVisible();
    await shoot(
      'plc-notation',
      {
        1: await rectOf(dialog.locator('h2').first()),
        2: await rectOf(
          page.getByTestId('notation-change-0').locator('xpath=ancestor::table[1]'),
          0,
        ),
        3: await rectOf(page.getByTestId('notation-apply')),
      },
      'auto',
    );
    await page.getByTestId('notation-cancel').click();
    await expect(dialog).toHaveCount(0);

    // --- plc-monitor: 変換 → 配線 → モニタ → RUN → 通電 ---
    await ladderKey('F4');
    await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');

    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'board');
    const box = await waitForBoard();
    for (const output of PLC_IO.outputs) {
      const socketId = trySocketOf(PLC_ROLES, output.cr);
      if (socketId === undefined) throw new Error(`${output.cr} のソケットがありません`);
      const socket = PLC_BOARD.sockets.find((s) => s.id === socketId);
      if (socket === undefined) throw new Error(`ソケットが定義されていません: ${socketId}`);
      const point = plcBoardPoint(
        {
          x: socket.origin.x + socket.bodyMm.width / 2,
          y: socket.origin.y + socket.bodyMm.length / 2,
          z: 9,
        },
        box,
      );
      await page.mouse.click(point.x, point.y);
      await page.getByRole('button', { name: '装着' }).first().click();
      await expect(page.getByTestId('operation-log')).toContainText(
        `${socketId} に リレー MY4N を装着`,
      );
    }
    for (const [from, to] of PLC_REFERENCE_WIRES) {
      await plcWire(box, from, to);
    }

    await page.getByTestId('view-split').click();
    await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'split');
    await page.waitForTimeout(600);
    await page.getByTestId('toolbar-monitor-start').click();
    await expect(page.getByTestId('plc-ladder-mode')).toContainText('モニタ');
    await page.getByTestId('toolbar-plc-run').click();
    await expect(page.getByTestId('toolbar-plc-run')).toHaveAttribute('aria-pressed', 'true');
    await powerOn();
    await expect(page.getByTestId('monitor-scan')).toBeVisible({ timeout: 30_000 });

    // 黒ボタン（X0）を1回押すと自己保持が入り、ラダーに通電の色が出る（d-001 の n1）
    await page.getByTestId('view-board').click();
    await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'board');
    const boardBox = await waitForBoard();
    const pb1 = plcPushButtonPoint('PB1', boardBox);
    /*
     * **押しっぱなしにする**。`click()` は押して離すまでが一瞬なので、PLCのスキャンが
     * X0 を1回も見ないまま終わり、自己保持が入らない（ラダーに通電の色が出ない）。
     */
    await page.mouse.move(pb1.x, pb1.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(600);

    await page.getByTestId('view-ladder').click();
    await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'ladder');
    await page.waitForTimeout(800);
    // 自己保持が入っていること（Y0 が ON）。入っていないと通電の色がほとんど出ない
    await expect(page.getByTestId('monitor-output-0')).toContainText('ON');
    const powered = page.getByTestId('powered-block').first();
    await expect(powered, 'モニタで通電の色が出ていません').toBeVisible({ timeout: 30_000 });

    await shoot(
      'plc-monitor',
      {
        1: await rectOf(page.getByTestId('toolbar-monitor-start')),
        2: await rectOf(page.getByTestId('toolbar-plc-run')),
        3: await rectOf(page.getByTestId('plc-reset')),
        4: await rectOf(page.getByTestId('monitor-scan')),
        5: await rectOf(powered, 3),
      },
      'full',
    );
  });

  test('設定・ホーム・課題一覧・ヘルプ', async () => {
    // --- settings ---
    await goHome();
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('setting-user-dir')).toBeVisible();
    /*
     * 「利用者課題フォルダ」の既定は `…¥Users¥〈Windowsのアカウント名〉¥AppData¥Roaming¥…`
     * （`main/settings.ts` の `defaultUserContentDir()`。`--user-data-dir` では変わらない）で、
     * そのまま撮ると配る説明書に撮影した人のアカウント名が載る。共有の場所へ入れ直してから撮る。
     */
    const userDir = join(USER_DATA_DIR, '課題');
    mkdirSync(userDir, { recursive: true });
    await page.getByTestId('setting-user-dir').fill(userDir);
    await page.getByTestId('setting-user-dir').blur();
    await expect(page.getByTestId('toast')).toContainText('設定を保存しました');
    await expect(page.getByTestId('setting-user-dir')).toHaveValue(userDir);
    await page.getByTestId('setting-vendor').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shoot(
      'settings',
      {
        1: await rectOf(page.getByTestId('setting-user-dir')),
        2: await rectOf(page.getByTestId('setting-sound-enabled'), 8),
        3: await rectOf(page.getByTestId('setting-vendor')),
      },
      'full',
    );

    // --- home（「最近の課題」が入った状態） ---
    await goHome();
    await expect(page.getByTestId('recent-problem')).toBeVisible();
    await shoot(
      'home',
      {
        1: await rectOf(page.getByTestId('mode-assemble'), 0),
        2: await rectOf(page.getByTestId('open-settings')),
        3: await rectOf(page.getByTestId('open-help')),
      },
      'full',
    );

    // --- help-drawer ---
    await page.getByTestId('open-help').click();
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    await shoot(
      'help-drawer',
      {
        1: await rectOf(page.getByTestId('help-search'), 6),
        2: await rectOf(page.getByTestId('help-contents'), 0),
        3: await rectOf(page.getByTestId('help-open-pdf')),
        4: await rectOf(page.getByTestId('help-close')),
      },
      'full',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-drawer')).toBeHidden();

    // --- list ---
    await page.getByTestId('mode-assemble').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await shoot(
      'list',
      {
        1: await rectOf(
          page.getByTestId('mode-filter').getByRole('button', { name: 'すべて', exact: true }),
        ),
        2: await rectOf(page.getByTestId('open-b-001').locator('xpath=ancestor::tr[1]'), 0),
        3: await rectOf(page.getByRole('button', { name: 'ホームへ戻る', exact: true }).first()),
      },
      'full',
    );
    await goHome();
  });

  test('吹き出しを描き込んで仕上げる', async () => {
    const names = Object.keys(SHOTS).sort();
    const missing = names.filter((name) => GEOMETRY[name] === undefined);
    expect(missing, '撮れていない図があります').toEqual([]);

    rmSync(OUT_DIR, { recursive: true, force: true });
    for (const name of names) await annotate(name);

    // 測った矩形をまとめて正本にする（設計 §6.4 の「場所」のファイル）
    const ordered: Record<string, Geometry> = {};
    for (const name of names) {
      const geometry = GEOMETRY[name];
      if (geometry !== undefined) ordered[name] = geometry;
    }
    writeFileSync(
      join(MANUAL_DIR, 'shot-geometry.json'),
      `${JSON.stringify(ordered, null, 2)}\n`,
      'utf8',
    );
  });
});
