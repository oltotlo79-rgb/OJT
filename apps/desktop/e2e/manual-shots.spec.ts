import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JIPM_BOARD,
  PLC_UNIT_FX5U,
  plcUnitFor,
  routeSession,
  trySocketOf,
  type BoardSession,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildInspectRepairCircuit,
  plcWiringPlan,
  resolvePlcIo,
  toSocketRoles,
} from '@ojt/content';
import { COIL_COL } from '@ojt/ladder-core';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { launchApp } from './app.js';
import { powerWellCenterMm } from '../src/renderer/three/AcFixtures.js';
import { findFixtureFootprint, FIXTURE_HEIGHT_MM } from '../src/renderer/three/Fixtures.js';
import { finishedSize, overlayHtml, planCallouts } from '../scripts/annotate-shots.mjs';
import { HELP_IMAGE_WIDTH } from '../scripts/manual-build.mjs';
import { optimizePng } from '../scripts/optimize-png.mjs';
import {
  GIZMO_BUTTON,
  GIZMO_GRID_PX,
  gizmoLayoutForViewport,
} from '../src/renderer/three/ViewGizmo.js';
import {
  boardPoint,
  closeOverflow,
  openOverflow,
  PLC_BOARD,
  plcBoardPoint,
  plcTerminalPoint,
  plcTerminalPointFor,
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
const RAW_DIR = process.env['OJT_MANUAL_RAW_DIR'] ?? join(APP_ROOT, '.manual-raw');
const OUT_DIR = join(MANUAL_DIR, 'images');
const SMALL_DIR = join(OUT_DIR, 'small');
const ANNOTATE_ONLY = process.env['OJT_MANUAL_ANNOTATE_ONLY'] === '1';
const REFRESH_ONLY = process.env['OJT_MANUAL_REFRESH_ONLY'] === '1';

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
  /** そのとき画面に出ていた**アプリの文字**の矩形（吹き出しを置いてはいけないところ）。 */
  avoid: Rect[];
}

const SHOTS = JSON.parse(readFileSync(join(MANUAL_DIR, 'shots.json'), 'utf8')) as Record<
  string,
  Shot
>;

/** 撮る大きさ。枠を除いた**中身**を 1280×800 にする（決定表#24）。 */
const SHOT_SIZE = { width: 1280, height: 800 } as const;

/** 画面の倍率が 100% でないパソコンでも 1280×800 ちょうどで撮れるようにする。 */
const EXTRA_FLAGS = ['--force-device-scale-factor=1'];

/**
 * この spec だけの `userData`（`plc-vendors.spec.ts` と同じ流儀）。既定メーカーや
 * 一時保存・最近の課題をここに閉じ込めるので、**他の spec と利用者の設定を汚さない**。
 * 既定メーカー（三菱）を戻す後始末も、このフォルダを捨てるだけで済む。
 *
 * 置き場所は実行時の一時フォルダ。撮影する設定の表示パスは、実在の個人名を
 * 含まない例へ変更する（この例のフォルダへのファイル作成は行わない）。
 */
let userDataDir: string | undefined;

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
  await expectOnScreen(locator);
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
    if (hit === null) return false;
    if (element.contains(hit) || hit.contains(element)) return true;
    // 固定位置のダイアログは祖先のスクロール枠を抜けるので、実際のヒットを優先する。
    if (getComputedStyle(element).pointerEvents !== 'none') return false;
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (
        /(auto|scroll|hidden|clip)/u.test(style.overflowX) &&
        (x < bounds.left || x > bounds.right)
      )
        return false;
      if (
        /(auto|scroll|hidden|clip)/u.test(style.overflowY) &&
        (y < bounds.top || y > bounds.bottom)
      )
        return false;
    }
    // 3Dの札・早見表は盤の操作を遮らない pointer-events:none の表示要素。
    return true;
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

/**
 * いま画面に出ている**アプリの文字**の矩形をぜんぶ測る（2026-09-20 最終レビュー BL-1）。
 *
 * 吹き出しのラベルや丸数字がボタン名・見出し・説明文の上に乗ると、画面をまだ知らない
 * 新入社員には「そういう名前の物がある」と読めてしまう。置いてはいけないところを
 * **実測して** `shot-geometry.json` の `avoid` に残し、`planCallouts()` がそこを避ける。
 *
 * 測るのは行そのもの（`Range.getClientRects()`）なので、欄の枠ではなく字のある場所が入る。
 * 入力欄と SVG の文字は行を取れないので外形を使う。画面に**本当に写っているか**は
 * `elementFromPoint()` で見て、不透明な物の裏にある文字（窓の下の画面）は落とす。
 * 薄い覆いごしに見えている文字は残す（読めてしまうので、その上にも置かない）。
 */
async function textRects(): Promise<Rect[]> {
  const found = await page.evaluate(() => {
    const out: Array<{ x: number; y: number; w: number; h: number }> = [];
    const range = document.createRange();
    /** 透けて見えるか（薄い覆い・背景の無い入れ物）。 */
    const seeThrough = (node: Element): boolean => {
      const color = getComputedStyle(node).backgroundColor;
      const match = /^rgba?\(([^)]+)\)$/u.exec(color);
      if (match?.[1] === undefined) return false;
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      return (parts.length > 3 ? (parts[3] ?? 1) : 1) < 0.85;
    };
    /** `hit` から上へ、`element` を囲う所まで不透明な面があるか（＝裏に隠れているか）。 */
    const buried = (hit: Element, element: Element): boolean => {
      for (
        let at: Element | null = hit;
        at !== null && !at.contains(element);
        at = at.parentElement
      ) {
        if (!seeThrough(at)) return true;
      }
      return false;
    };
    /** マウスを受け取らない物（札・HUD）は `elementFromPoint()` に出てこない。 */
    const ignoresPointer = (element: Element): boolean => {
      for (let at: Element | null = element; at !== null; at = at.parentElement) {
        if (getComputedStyle(at).pointerEvents === 'none') return true;
      }
      return false;
    };
    const keep = (element: Element, box: DOMRect): void => {
      const x = Math.max(0, box.left);
      const y = Math.max(0, box.top);
      const right = Math.min(window.innerWidth, box.right);
      const bottom = Math.min(window.innerHeight, box.bottom);
      if (right - x < 3 || bottom - y < 5) return;
      const hit = document.elementFromPoint((x + right) / 2, (y + bottom) / 2);
      if (hit === null) return;
      if (!element.contains(hit) && !hit.contains(element)) {
        if (!ignoresPointer(element) && buried(hit, element)) return;
      }
      out.push({
        x: Math.floor(x),
        y: Math.floor(y),
        w: Math.ceil(right - x),
        h: Math.ceil(bottom - y),
      });
    };
    for (const element of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (Number(style.opacity) < 0.15) continue;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        keep(element, element.getBoundingClientRect());
        continue;
      }
      if (element instanceof SVGTextElement || element instanceof SVGTSpanElement) {
        keep(element, element.getBoundingClientRect());
        continue;
      }
      for (const child of element.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE) continue;
        if ((child.nodeValue ?? '').trim() === '') continue;
        range.selectNodeContents(child);
        for (const line of range.getClientRects()) keep(element, line);
      }
    }
    return out;
  });
  // 同じところ・中に入っているだけのものは捨てる（`shot-geometry.json` を小さく保つ）
  const kept: Rect[] = [];
  for (const rect of [...found].sort((a, b) => b.w * b.h - a.w * a.h)) {
    const covered = kept.some(
      (other) =>
        rect.x >= other.x &&
        rect.y >= other.y &&
        rect.x + rect.w <= other.x + other.w &&
        rect.y + rect.h <= other.y + other.h,
    );
    if (!covered) kept.push(rect);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * トーストが消えるまで待つ（2026-09-20 最終レビュー IM-A）。
 * 設定を保存した直後にホームやヘルプへ移ると「設定を保存しました」が右下に写り込み、
 * その画面の説明のはずの図に関係ない文字が乗る（`help-drawer` では本文の行を隠していた）。
 * 期限は4秒（`TOAST_TTL_MS`）で、掃除は 250ms ごとなので、待てば必ず消える。
 */
async function expectNoToast(): Promise<void> {
  await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 20_000 });
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

/**
 * 矩形は**1行**にまとめて書く。`avoid` は1図あたり100件を超えるので、既定の整形では
 * 矩形1つが6行になり、`shot-geometry.json` が1万行を超えて差分が読めなくなる。
 */
function toJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2).replace(
    /\{\s+"x": (-?\d+),\s+"y": (-?\d+),\s+"w": (-?\d+),\s+"h": (-?\d+)\s+\}/gu,
    '{ "x": $1, "y": $2, "w": $3, "h": $4 }',
  );
  return `${text}\n`;
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
  const minHeight = 320;
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
  // 図にトーストを写さない（IM-A）。消えるまで待ってから撮る
  await expectNoToast();
  // 置いてはいけないところ（アプリの文字）を、撮る直前の画面から測る（BL-1）
  const avoid = await textRects();
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
      ? { crop: autoCrop(name, measured), callouts: measured, avoid }
      : { callouts: measured, avoid };
  // 測った矩形は素のPNGの隣にも残す（あとで「どこを指したか」を機械で追える）
  writeFileSync(join(RAW_DIR, `${name}.json`), toJson(geometry), 'utf8');
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

  const full = optimizePng(Buffer.from(shots.full, 'base64'));
  const reduced = optimizePng(Buffer.from(shots.small, 'base64'));
  // 保存前にElectron自身で復号し、全画素が一致することを確かめる。容量のために画質を落とさない。
  const unchanged = await app.evaluate(
    ({ nativeImage }, images) =>
      images.every(([a, b]) => {
        if (a === undefined || b === undefined) return false;
        const source = nativeImage.createFromBuffer(Buffer.from(a, 'base64'));
        const compressed = nativeImage.createFromBuffer(Buffer.from(b, 'base64'));
        return (
          JSON.stringify(source.getSize()) === JSON.stringify(compressed.getSize()) &&
          source.toBitmap().equals(compressed.toBitmap())
        );
      }),
    [
      [shots.full, full.toString('base64')],
      [shots.small, reduced.toString('base64')],
    ],
  );
  expect(unchanged, `${name} の圧縮で画素が変わっています`).toBe(true);
  writeFileSync(join(OUT_DIR, `${name}.png`), full);
  writeFileSync(join(SMALL_DIR, `${name}.png`), reduced);
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
  await page
    .getByTestId('grade-filter')
    .getByRole('button', { name: 'すべて', exact: true })
    .click();
  await page.getByTestId(`open-${problemId}`).click();
  const change = page.getByTestId('problem-change-confirm');
  if (await change.isVisible())
    await change.getByRole('button', { name: '保存せず進む', exact: true }).click();
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
  await page.getByTestId('native-menu-edit').click();
  await page.getByTestId('native-item-insert-network').click();
  await expectCursorAt(`${expectedId}:0:0`);
}

/** 模範と同じ動きをするラダーを組む（`plc.spec.ts` の `buildReferenceLadder()` と同じ手）。 */
async function buildReferenceLadder(): Promise<void> {
  await expectCursorAt('n1:0:0');
  await ladderKey('F5');
  await page.getByTestId('device-text').fill('X0');
  await shoot(
    'plc-contact-input',
    {
      1: await rectOf(page.getByTestId('device-text')),
      2: await rectOf(page.getByTestId('device-commit')),
    },
    'auto',
  );
  await commitDevice('X0');
  await ladderKey('ArrowLeft');
  await ladderKey('Shift+F5');
  await commitDevice('Y0');
  await expect(page.getByTestId('cell-n1:1:0')).toBeVisible();
  await expectCursorAt('n1:0:2');
  await ladderKey('F6');
  await commitDevice('X1');
  await moveToCoil('n1', 3);
  await ladderKey('F7');
  await page.getByTestId('device-text').fill('Y0');
  await shoot(
    'plc-coil-input',
    {
      1: await rectOf(page.getByTestId('output-kind')),
      2: await rectOf(page.getByTestId('device-text')),
    },
    'auto',
  );
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

/** 折りたたみの欄（`<details>`）を開く（閉じていれば見出しを押す）。 */
async function openPanel(testId: string): Promise<void> {
  if ((await page.getByTestId(`${testId}-details`).getAttribute('open')) === null)
    await page.getByTestId(`${testId}-summary`).click();
}

/** 折りたたみの欄を閉じる。 */
async function closePanel(testId: string): Promise<void> {
  if ((await page.getByTestId(`${testId}-details`).getAttribute('open')) !== null)
    await page.getByTestId(`${testId}-summary`).click();
}

/** 盤の電源を切る（電源スイッチ → ブレーカ。§5.3.5）。 */
async function powerOff(): Promise<void> {
  const supply = page.getByTestId('power-switch');
  if ((await supply.getAttribute('aria-pressed')) === 'true') await supply.click();
  const breaker = page.getByTestId('power-breaker');
  if ((await breaker.getAttribute('aria-pressed')) === 'true') await breaker.click();
}

/**
 * モードC2: 3D図で電線を押し、指摘の小窓がその電線を指すまで点を変えて試す
 * （`inspect.spec.ts` の `findWirePoint()` と同じ手）。押せた点を返す。
 */
async function clickWireFor(
  session: BoardSession,
  wireId: string,
  box: CanvasBox,
): Promise<{ x: number; y: number }> {
  const wire = session.wires.find((w) => w.id === wireId);
  const route = routeSession(JIPM_BOARD, session).find((r) => r.wireId === wireId);
  if (wire === undefined || route === undefined) throw new Error(`電線 ${wireId} がありません`);
  const candidates: Array<{ point: { x: number; y: number; z: number }; length: number }> = [];
  for (let index = 0; index + 1 < route.corners.length; index += 1) {
    const a = route.corners[index];
    const b = route.corners[index + 1];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    for (const t of [0.5, 0.35, 0.65]) {
      candidates.push({
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
        length,
      });
    }
  }
  candidates.sort((p, q) => q.length - p.length);
  const label = `${String(wire.from)}–${String(wire.to)} の${wire.color}線`;
  const popover = page.getByTestId('report-popover');
  for (const { point } of candidates) {
    const screen = boardPoint(point, box);
    if (screen.x < box.x || screen.x > box.x + box.width) continue;
    if (screen.y < box.y || screen.y > box.y + box.height) continue;
    await page.mouse.click(screen.x, screen.y);
    await page.waitForTimeout(150);
    if ((await popover.count()) === 0) continue;
    if (((await popover.textContent()) ?? '').includes(label)) return screen;
    await page.getByTestId('report-cancel').click();
  }
  throw new Error(`3D盤で電線 ${wireId} を押せませんでした`);
}

/** モードDの机上のPLC（任意の機種）へ電線を1本張る。 */
async function plcDeskWire(
  unit: PlcUnitDefinition,
  box: CanvasBox,
  from: string,
  to: string,
): Promise<void> {
  const a = plcTerminalPointFor(unit, PLC_ROLES, from, box);
  const b = plcTerminalPointFor(unit, PLC_ROLES, to, box);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(80);
}

/** 机上のPLCへの配線の図（電源・入力のコモン・入力・出力の端子を指す）。 */
async function shootDesk(name: string, unit: PlcUnitDefinition, box: CanvasBox): Promise<void> {
  const plan = plcWiringPlan(PLC_IO, unit).map((w) => [String(w.from), String(w.to)] as const);
  const power = plan.find(([from]) => from === 'OUTLET.L')?.[1];
  const common = plan.find(([from]) => from === 'P.1')?.[1];
  const input = plan.find(([from]) => from === 'TB_PB.1a')?.[1];
  const output = plan.find(([, to]) => to === 'CR1.14')?.[0];
  if (power === undefined || common === undefined || input === undefined || output === undefined)
    throw new Error(`${unit.model} の配線の見本が足りません`);
  const at = (id: string): Rect => rectAt(plcTerminalPointFor(unit, PLC_ROLES, id, box), 30);
  await shoot(name, { 1: at(power), 2: at(common), 3: at(input), 4: at(output) }, 'auto');
}

/* ------------------------------------------------------------------ *
 * 撮影
 * ------------------------------------------------------------------ */

test.describe.serial('取扱説明書の図', () => {
  test.beforeAll(async () => {
    // テストの列挙だけでは一時フォルダを作らない。実行workerが作成・後始末を担当する。
    userDataDir = mkdtempSync(join(tmpdir(), '電気教育ツール-説明書-'));
    if (ANNOTATE_ONLY || REFRESH_ONLY) {
      // 注釈の配置だけを直すときは、同時に撮った原寸PNGと実測矩形を再利用する。
      Object.assign(
        GEOMETRY,
        JSON.parse(readFileSync(join(MANUAL_DIR, 'shot-geometry.json'), 'utf8')),
      );
    } else {
      rmSync(RAW_DIR, { recursive: true, force: true });
    }
    // 枠を除いた**中身**を 1280×800 にする（`setBounds` は枠を含むので使わない）
    ({ app, page } = await launchApp({
      contentSize: SHOT_SIZE,
      userDataDir,
      extraFlags: EXTRA_FLAGS,
    }));
  });

  test.afterAll(async () => {
    try {
      // 仕上げは同じ窓を静的な撮影用HTMLへ遷移させる。終了前保存の応答はアプリに
      // あるため、静的HTMLのまま close せず、通常の画面へ戻して終了を検査する。
      if (page?.url().endsWith('.overlay.html')) {
        await app.evaluate(
          async ({ BrowserWindow }, entry) => {
            await BrowserWindow.getAllWindows()[0]?.loadFile(entry);
          },
          join(APP_ROOT, 'out', 'renderer', 'index.html'),
        );
        await expect(
          page.getByTestId('mode-assemble').or(page.getByTestId('restore-prompt')).first(),
        ).toBeVisible();
      }
      await app?.close();
    } finally {
      if (userDataDir !== undefined) rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('モードB: 練習の画面・ビューキューブ・カード・札・結果・タイムチャート', async () => {
    await openProblem('mode-assemble', 'b-001');
    let box = await waitForBoard();

    // --- session-board: 画面をどう読むか（上の帯・手順・3D・右・下） ---
    await shoot(
      'session-board',
      {
        1: await rectOf(page.getByTestId('session-toolbar'), 0),
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

    // 実際に部品を運んでいる途中を撮る。キャンセル後にカードの操作を続ける。
    const palette = page.getByTestId('palette-relay-my4n');
    const paletteBox = await palette.boundingBox();
    if (paletteBox === null) throw new Error('部品パレットが見つかりません');
    const socketPoint = boardPoint(socketBodyPoint(), box);
    await page.mouse.move(
      paletteBox.x + paletteBox.width / 2,
      paletteBox.y + paletteBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(socketPoint.x, socketPoint.y, { steps: 12 });
    await shoot(
      'parts-palette',
      {
        1: await rectOf(palette),
        2: rectAt(socketPoint, 52),
      },
      'full',
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();

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
    const firstWire = SELF_HOLD_WIRES[0];
    if (firstWire === undefined) throw new Error('配線の見本がありません');
    const start = terminalPoint(toTerminalId(firstWire[0]), box);
    const end = terminalPoint(toTerminalId(firstWire[1]), box);
    await page.keyboard.down('Alt');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await shoot('wire-drag', { 1: rectAt(start, 34), 2: rectAt(end, 34) }, 'auto');
    await page.mouse.up();
    await page.keyboard.up('Alt');
    for (const [from, to] of SELF_HOLD_WIRES.slice(1)) {
      const a = terminalPoint(toTerminalId(from), box);
      const b = terminalPoint(toTerminalId(to), box);
      await page.mouse.click(a.x, a.y);
      await page.mouse.click(b.x, b.y);
    }

    // --- b-first-wire: 1つ目の端子を選ぶと、左上に「始点」、下の1行に次の操作が出る ---
    const overlay = page.getByTestId('status-overlay');
    const freePoint = terminalPoint(toTerminalId('TB_PL.2+'), box);
    await page.mouse.click(freePoint.x, freePoint.y);
    await expect(overlay).toContainText('始点: TB_PL.2+');
    await expect(page.getByTestId('hover-hint')).toContainText('接続先の端子をクリック');
    await shoot(
      'b-first-wire',
      {
        1: await rectOf(overlay),
        2: await rectOf(page.getByTestId('hover-hint')),
        3: rectAt(freePoint, 34),
      },
      'auto',
    );
    await page.keyboard.press('Escape');
    await expect(overlay).toContainText('端子未選択');

    // --- wire-limit-notice: 2本つながった端子へ3本目をつなごうとする ---
    const counts = new Map<string, number>();
    for (const ends of SELF_HOLD_WIRES) {
      for (const id of ends) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const fullTerminal = [...counts].find(([, n]) => n >= 2)?.[0];
    if (fullTerminal === undefined) throw new Error('2本つながった端子がありません');
    const fullPoint = terminalPoint(toTerminalId(fullTerminal), box);
    await page.mouse.click(fullPoint.x, fullPoint.y);
    const notice = page.getByTestId('wire-limit-notice');
    await expect(notice).toBeVisible();
    await shoot('wire-limit-notice', { 1: await rectOf(notice), 2: rectAt(fullPoint, 34) }, 'auto');
    await page.getByTestId('wire-limit-close').click();
    await expect(notice).toHaveCount(0);

    // --- terminal-list: 端子リスト（キーボード配線） ---
    await openPanel('terminal-list');
    await page.getByTestId('terminal-search').fill('CR1');
    const terminalRow = page.locator('[data-testid^="terminal-row-"]').first();
    await expect(terminalRow).toBeVisible();
    await terminalRow.scrollIntoViewIfNeeded();
    await shoot(
      'terminal-list',
      {
        1: await rectOf(page.getByTestId('terminal-search')),
        2: await rectOf(terminalRow),
      },
      'auto',
    );
    await page.getByTestId('terminal-search').fill('');
    await closePanel('terminal-list');

    // --- b-select-wire / wire-list-edit: 電線一覧で1本選ぶ（3Dでも光り、Deleteで外せる） ---
    await openPanel('wire-list');
    const wireRow = page.locator('[data-testid^="wire-row-"]').first();
    await wireRow.click();
    await expect(overlay).toContainText('選択:');
    await wireRow.scrollIntoViewIfNeeded();
    await shoot('b-select-wire', { 1: await rectOf(wireRow), 2: await rectOf(overlay) }, 'auto');
    const wireSearch = page.getByLabel('電線・端子・線番を検索', { exact: true });
    const editButton = page.getByRole('button', { name: '接続先を変更', exact: true });
    // 検索欄を右の欄の上端まで送ると、検索・選んだ行・「接続先を変更」が1画面に収まる
    await wireSearch.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await shoot(
      'wire-list-edit',
      {
        1: await rectOf(wireSearch),
        2: await rectOf(wireRow),
        3: await rectOf(editButton),
      },
      'auto',
    );
    await page.keyboard.press('Escape');
    await closePanel('wire-list');
    // 一覧で選ぶと上に「…を確認します」の帯が出て3Dの位置が下がる。帯を閉じて測り直す
    const clearFocus = page.getByRole('button', { name: '強調表示を解除', exact: true });
    if (await clearFocus.isVisible()) await clearFocus.click();
    box = await waitForBoard();
    const powerRects = (['breaker', 'switch'] as const).map((kind) => {
      const footprint = findFixtureFootprint(JIPM_BOARD.footprints, kind);
      if (footprint === undefined) throw new Error(`電源部品がありません: ${kind}`);
      return rectAt(boardPoint(powerWellCenterMm(footprint, kind, FIXTURE_HEIGHT_MM), box), 46);
    });
    await shoot('power-controls', { 1: powerRects[0]!, 2: powerRects[1]! }, 'auto');
    await powerOn();
    const pb = JIPM_BOARD.pushButtons[0];
    const lamp = JIPM_BOARD.lamps[0];
    if (pb === undefined || lamp === undefined) throw new Error('押しボタン・ランプがありません');
    const pushPoint = boardPoint({ ...pb.pos, z: 4.5 }, box);
    await page.mouse.move(pushPoint.x, pushPoint.y);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();
    await shoot(
      'pushbutton',
      {
        1: rectAt(pushPoint, 40),
        2: rectAt(boardPoint({ ...lamp.pos, z: 4.5 }, box), 40),
      },
      'auto',
    );
    const overflow = page.getByTestId('toolbar-overflow-toggle');
    if (await overflow.isVisible()) await overflow.click();
    await shoot(
      'workfile-menu',
      {
        1: await rectOf(page.getByRole('button', { name: '作業を保存', exact: true })),
        2: await rectOf(page.getByRole('button', { name: '作業を読込', exact: true })),
      },
      'auto',
    );
    await page.keyboard.press('Escape');
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

    await shoot(
      'result-export',
      {
        1: await rectOf(page.getByTestId('result-export')),
        2: await rectOf(page.getByTestId('result-elapsed')),
      },
      'full',
    );
    await page.getByTestId('compare-open').click();
    const compare = page.getByTestId('compare-dialog');
    await expect(compare).toBeVisible();
    const compareLabels = compare.locator('[data-role="row-label"]');
    await shoot(
      'result-compare',
      {
        1: await rectOf(compareLabels.filter({ hasText: '模範' }).first()),
        2: await rectOf(compareLabels.filter({ hasText: '自分' }).first()),
      },
      'full',
    );
    await page.getByTestId('compare-close').click();
    await page.getByTestId('replay-open').click();
    await expect(page.getByTestId('replay-bar')).toHaveAttribute('aria-busy', 'false');
    await shoot(
      'result-replay',
      {
        1: await rectOf(page.getByTestId('replay-bar'), 0),
        2: await rectOf(page.getByTestId('replay-next')),
      },
      'full',
    );
    await page.getByTestId('replay-stop').click();
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
    await shoot(
      'c1-tray',
      {
        1: await rectOf(page.getByTestId('check-tray').locator('h2')),
        2: await rectOf(page.getByTestId(`plug-${first.id}`)),
      },
      'auto',
    );
    await page.getByTestId(`plug-${first.id}`).click();
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

    // --- c1-probe-pens: 3D図に立つテスターの棒と端子名の札 ---
    await expect(page.getByTestId('probe-label-black')).toBeVisible();
    await expect(page.getByTestId('probe-label-red')).toBeVisible();
    await shoot(
      'c1-probe-pens',
      {
        1: await rectOf(page.getByTestId('probe-label-black')),
        2: await rectOf(page.getByTestId('probe-label-red')),
      },
      'auto',
    );

    await page.getByTestId('probe-target-a1').scrollIntoViewIfNeeded();
    await shoot(
      'tester-probes',
      {
        1: await rectOf(page.getByTestId('probe-shortcuts').locator('p').first()),
        2: await rectOf(page.getByTestId('probe-target-a1')),
      },
      'auto',
    );
    // 抵抗測定は無通電で行う。
    await page.getByRole('button', { name: '0Ω ADJ', exact: true }).click();
    await page
      .getByRole('img', { name: 'アナログテスターの目盛', exact: true })
      .scrollIntoViewIfNeeded();
    await shoot(
      'tester-analog',
      {
        1: await rectOf(page.getByRole('img', { name: 'アナログテスターの目盛', exact: true })),
        2: await rectOf(page.getByRole('button', { name: '0Ω ADJ', exact: true })),
      },
      'auto',
    );
    // --- c1-diagnosis: 画面の中の判定表 ---
    const diagnosis = page.getByTestId('diagnosis-help');
    await diagnosis.locator('summary').scrollIntoViewIfNeeded();
    if ((await diagnosis.getAttribute('open')) === null) await diagnosis.locator('summary').click();
    const diagnosisHead = page.getByTestId('diagnosis-table').locator('tr').first();
    await expect(diagnosisHead).toBeVisible();
    await diagnosis.locator('summary').scrollIntoViewIfNeeded();
    await shoot(
      'c1-diagnosis',
      {
        1: await rectOf(diagnosis.locator('summary')),
        2: await rectOf(diagnosisHead),
      },
      'auto',
    );
    await diagnosis.locator('summary').click();

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
    await expectOnScreen(markSheet.locator('details').first().locator('label').first());
    await expectOnScreen(page.getByTestId('answered-count'));
    await shoot(
      'c1-marksheet',
      {
        1: await rectOf(markSheet.locator('h2')),
        2: await rectOf(markSheet.locator('details').first().locator('label').first()),
        3: await rectOf(page.getByTestId('answered-count')),
      },
      'auto',
    );
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('mark-result-table')).toBeVisible();
    await shoot(
      'c1-result',
      {
        1: await rectOf(page.getByTestId('mark-result-table'), 0),
        2: await rectOf(page.getByTestId('result-resume')),
      },
      'full',
    );
  });

  test('モードC2: 指摘の欄', async () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    expect(problem, '内蔵C2課題がありません').toBeDefined();
    if (problem === undefined) return;
    await openProblem('mode-inspect-repair', problem.id);
    await expect(page.getByTestId('report-panel')).toBeVisible();
    let box = await waitForBoard();
    const roles = toSocketRoles(problem.board.socketRoles);
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const brokenWire = built.value.applied.sites.find((site) => site.kind === 'wire-open')?.wireId;
    if (brokenWire === undefined) throw new Error('断線の故障がありません');

    await page.getByRole('button', { name: 'デジタル', exact: true }).click();
    await page.getByRole('button', { name: 'DCV', exact: true }).click();
    await page.getByTestId('probe-red').scrollIntoViewIfNeeded();
    await shoot(
      'c2-tester',
      {
        1: await rectOf(page.getByTestId('tester-modes')),
        2: await rectOf(page.getByTestId('probe-black')),
      },
      'auto',
    );

    // --- c2-probe-pens: 3Dの端子へ棒を当てる（黒 → 赤の順）。棒と端子名の札が立つ ---
    await page.getByTestId('tool-tester').click();
    for (const id of ['N.1', 'CR1.14']) {
      const point = roleTerminalPoint(roles, id, box);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(200);
    }
    await expect(page.getByTestId('probe-label-black')).toBeVisible();
    await expect(page.getByTestId('probe-label-red')).toBeVisible();
    await page.getByTestId('tester-readout').scrollIntoViewIfNeeded();
    await shoot(
      'c2-probe-pens',
      {
        1: await rectOf(page.getByTestId('probe-label-black')),
        2: await rectOf(page.getByTestId('probe-label-red')),
        3: await rectOf(page.getByTestId('tester-readout')),
      },
      'auto',
    );

    // --- c2-measurement: 今の測定値を記録する ---
    await openPanel('measurement-panel');
    const purpose = page.getByTestId('measurement-panel').getByLabel('測定の目的・気付いたこと');
    await purpose.fill('コイル＋までの電圧を確かめる');
    await page.getByTestId('record-measurement').click();
    const record = page.getByTestId('measurement-record').last();
    await expect(record).toContainText('コイル＋までの電圧を確かめる');
    await page.getByTestId('record-measurement').scrollIntoViewIfNeeded();
    await shoot(
      'c2-measurement',
      {
        1: await rectOf(purpose),
        2: await rectOf(page.getByTestId('record-measurement')),
        3: await rectOf(record),
      },
      'auto',
    );
    await closePanel('measurement-panel');

    // --- c2-schematic: 回路図ヒントの記号を押すと、盤の対応する端子が光る ---
    await openOverflow(page);
    await page.getByTestId('toggle-schematic').click();
    await closeOverflow(page);
    const schematic = page.getByTestId('schematic-svg');
    await expect(schematic).toBeVisible();
    // 右の欄を「回路図ヒント」の見出しが上に来るまで送り、CR1のコイルの記号（c03）を押す
    const schematicHeading = page.getByTestId('schematic-hint').getByText('回路図ヒント').first();
    await schematicHeading.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    const coilCell = schematic.locator('[data-cell]').filter({ hasText: 'CR1' }).first();
    await coilCell.click();
    await page.waitForTimeout(500);
    await shoot(
      'c2-schematic',
      {
        1: await rectOf(schematicHeading),
        2: await rectOf(coilCell, 8),
        3: rectAt(roleTerminalPoint(roles, 'CR1.14', box), 40),
      },
      'full',
    );
    await openOverflow(page);
    await page.getByTestId('toggle-schematic').click();
    await closeOverflow(page);
    await expect(schematic).toHaveCount(0);

    await page.getByTestId('tool-report').click();

    // --- c2-report-wire: 3D図で断線した電線を押すと、その横に小窓が出る ---
    const wirePoint = await clickWireFor(built.value.session, brokenWire, box);
    await shoot(
      'c2-report-wire',
      {
        1: await rectOf(page.getByTestId('tool-report')),
        2: rectAt(wirePoint, 30),
        3: await rectOf(page.getByTestId('report-popover'), 0),
      },
      'auto',
    );
    await page.getByTestId('report-kind-wire-open').click();
    await expect(page.getByTestId('report-count')).toHaveText('1');

    // --- c2-report-from-list: 電線一覧からも同じ小窓を開ける ---
    await openPanel('wire-list');
    const brokenRow = page.getByTestId(`wire-row-${brokenWire}`);
    await brokenRow.click();
    const reportFromList = page.getByRole('button', { name: 'この電線の故障を指摘', exact: true });
    // 押すと小窓が開き、電線の選択は小窓へ移る（ボタンは消える）。押す前の一覧を撮る。
    // 行を右の欄の上端まで送ると、その下の「この電線の故障を指摘」まで1画面に収まる
    await brokenRow.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expectOnScreen(reportFromList);
    await shoot(
      'c2-report-from-list',
      { 1: await rectOf(brokenRow), 2: await rectOf(reportFromList) },
      'auto',
    );
    await reportFromList.click();
    await expect(page.getByTestId('report-popover')).toBeVisible();
    await page.getByTestId('report-cancel').click();
    await closePanel('wire-list');
    // 一覧で選ぶと上に「…を確認します」の帯が出て3Dの位置が下がる。帯を閉じて測り直す
    const clearFocus = page.getByRole('button', { name: '強調表示を解除', exact: true });
    if (await clearFocus.isVisible()) await clearFocus.click();
    box = await waitForBoard();

    // --- c2-report-part: 部品を押すと、故障の内容まで選べる ---
    const partPoint = boardPoint(socketBodyPoint(), box);
    await page.mouse.click(partPoint.x, partPoint.y);
    await expect(page.getByTestId('report-kind-part-defect')).toBeVisible();
    const firstDetail = page.locator('[data-testid^="report-detail-"]').first();
    await shoot(
      'c2-report-part',
      {
        1: rectAt(partPoint, 52),
        2: await rectOf(firstDetail.locator('xpath=..'), 0),
        3: await rectOf(page.getByTestId('report-kind-part-defect')),
      },
      'auto',
    );
    await page.getByTestId('report-cancel').click();

    // 端子を1件登録して「指摘一覧」に中身を作る
    const firstTerminal = roleTerminalPoint(roles, 'CR1.9', box);
    await page.mouse.click(firstTerminal.x, firstTerminal.y);
    await expect(page.getByTestId('report-popover')).toBeVisible();
    await page.locator('[data-testid^="report-kind-"]').first().click();
    await expect(page.getByTestId('report-count')).toHaveText('2');

    // 2件目を選びかけた状態（種別の窓が開き、選んだ端子が光っている）で撮る
    const secondTerminal = roleTerminalPoint(roles, 'CR1.13', box);
    await page.mouse.click(secondTerminal.x, secondTerminal.y);
    await expect(page.getByTestId('report-popover')).toBeVisible();
    await page.getByTestId('report-list').scrollIntoViewIfNeeded();

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
    await page.getByRole('button', { name: '白', exact: true }).click();
    const repairFrom = roleTerminalPoint(roles, 'CR1.6', box);
    const repairTo = roleTerminalPoint(roles, 'TB_PL.1+', box);
    await page.mouse.click(repairFrom.x, repairFrom.y);
    await page.mouse.click(repairTo.x, repairTo.y);
    await expect(page.getByTestId('added-wires')).not.toHaveText('なし');
    await page.getByTestId('removed-wires').scrollIntoViewIfNeeded();
    await shoot(
      'c2-repair-complete',
      {
        1: await rectOf(page.getByTestId('added-wires').locator('xpath=preceding-sibling::p[1]')),
        2: await rectOf(page.getByTestId('removed-wires').locator('xpath=preceding-sibling::p[1]')),
      },
      'auto',
    );

    // --- c2-result-detail: 部品不良を内容まで選んで指摘し、判定の講評を撮る ---
    const partCase = BUILTIN_INSPECT_REPAIR_PROBLEMS.flatMap((candidate) => {
      const result = buildInspectRepairCircuit(candidate, JIPM_BOARD);
      if (!result.ok) return [];
      const site = result.value.applied.sites.find(
        (s) => s.report === 'part-defect' && s.partId !== undefined,
      );
      return site === undefined || site.partId === undefined
        ? []
        : [{ problem: candidate, partId: site.partId, detail: site.kind }];
    })[0];
    if (partCase === undefined) throw new Error('部品不良の内蔵C2課題がありません');
    await openProblem('mode-inspect-repair', partCase.problem.id);
    await waitForBoard();
    const partButton = page.getByTestId(`report-part-${partCase.partId}`);
    await partButton.scrollIntoViewIfNeeded();
    await partButton.click();
    await page.getByTestId(`report-detail-${partCase.detail}`).click();
    await expect(page.getByTestId('report-count')).toHaveText('1');
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
    const review = page.getByTestId('detail-review-0');
    await review.scrollIntoViewIfNeeded();
    await expect(review).toBeVisible();
    await shoot(
      'c2-result-detail',
      {
        1: await rectOf(page.getByTestId('matched-list'), 0),
        2: await rectOf(review),
      },
      'auto',
    );
  });

  test('モードD: ラダー・表記の切替・モニタ', async () => {
    await openProblem('mode-plc', PLC_PROBLEM.id);
    await expect(page.getByTestId('plc-session')).toBeVisible();

    // --- plc-show-chart: 手順の帯の「タイムチャートを見る」で仕様のチャートへ移る ---
    await page.getByTestId('plc-show-chart').click();
    await page.waitForTimeout(600);
    const chartTitle = page.getByTestId('chart-panel').getByText('タイムチャート（仕様）').first();
    await expect(chartTitle).toBeVisible();
    await shoot(
      'plc-show-chart',
      {
        1: await rectOf(page.getByTestId('plc-show-chart')),
        2: await rectOf(chartTitle),
      },
      'full',
    );

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

    // 下段の150pxの表示領域に、見出しから電源の案内までを揃えて写す。
    // 案内だけを中央へ送ると、同時に写したい見出しが上へ隠れる。
    await page
      .getByTestId('io-table-summary')
      .evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await shoot(
      'plc-io-wiring',
      {
        1: await rectOf(page.getByTestId('io-table-summary')),
        2: await rectOf(page.getByTestId('io-outlet-note')),
      },
      'auto',
    );
    // --- plc-monitor: 変換 → 配線 → モニタ → RUN → 通電 ---
    await ladderKey('F4');
    await expect(page.getByTestId('convert-state')).toHaveText('変換に成功しました');
    // 回路が4段になり、出力ウィンドウは格子の下へ送られている。見える所まで送って撮る
    await page.getByTestId('convert-state').scrollIntoViewIfNeeded();
    await shoot(
      'plc-convert',
      {
        1: await rectOf(page.getByTestId('toolbar-convert')),
        2: await rectOf(page.getByTestId('convert-state')),
      },
      'auto',
    );

    // --- plc-keymap: キーの早見表（? で開く） ---
    await page.getByTestId('ladder-editor').press('?');
    const keymap = page.getByTestId('shortcut-overlay');
    await expect(keymap).toBeVisible();
    await shoot(
      'plc-keymap',
      {
        1: await rectOf(keymap.getByText('キーの早見表').first()),
        2: await rectOf(page.getByTestId('shortcut-overlay-close')),
      },
      'auto',
    );
    await page.getByTestId('shortcut-overlay-close').click();
    await expect(keymap).toHaveCount(0);

    // --- plc-special-contact: 特殊接点を用途から選ぶ（確定せずに閉じる） ---
    await page.getByTestId('cell-n3:0:1').click();
    await ladderKey('F5');
    await expect(page.getByTestId('device-input')).toBeVisible();
    const special = page.getByTestId('special-contact-select');
    await special.selectOption({ index: 1 });
    await expect(page.getByTestId('special-contact-note')).toBeVisible();
    await shoot(
      'plc-special-contact',
      {
        1: await rectOf(special),
        2: await rectOf(page.getByTestId('special-contact-note')),
      },
      'auto',
    );
    await page.getByTestId('device-cancel').click();
    await expect(page.getByTestId('device-input')).toHaveCount(0);
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
      if (output === PLC_IO.outputs[0]) {
        await expect(page.getByTestId('mount-relay-my4n')).toBeVisible();
        await page.getByTestId('mount-relay-my4n').scrollIntoViewIfNeeded();
        await shoot(
          'plc-mount-relay',
          { 1: rectAt(point, 52), 2: await rectOf(page.getByTestId('mount-relay-my4n')) },
          'auto',
        );
      }
      await page.getByTestId('mount-relay-my4n').click();
      await expect(page.getByTestId('operation-log')).toContainText(
        `${socketId} に リレー MY4N を装着`,
      );
    }
    for (const [from, to] of PLC_REFERENCE_WIRES) {
      await plcWire(box, from, to);
    }
    await shootDesk('plc-desk-mitsubishi', PLC_UNIT_FX5U, box);

    await page.getByTestId('view-split').click();
    await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'split');
    await page.waitForTimeout(600);
    await page.getByTestId('toolbar-monitor-start').click();
    await expect(page.getByTestId('plc-ladder-mode')).toContainText('モニタ');
    await page.getByTestId('toolbar-plc-run').click();
    await expect(page.getByTestId('toolbar-plc-run')).toHaveAttribute('aria-pressed', 'true');
    await powerOn();
    await expect(page.getByTestId('monitor-scan')).toBeVisible({ timeout: 30_000 });

    // --- plc-io-power: I/O割付のPLC電源と入出力の値 ---
    const supplyStatus = page.getByTestId('plc-supply-status');
    await expect(supplyStatus).toContainText('接続正常');
    const lastOutput = page.getByTestId(`io-output-${String(PLC_IO.outputs.length - 1)}`);
    await supplyStatus.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await shoot(
      'plc-io-power',
      { 1: await rectOf(supplyStatus), 2: await rectOf(lastOutput) },
      'auto',
    );

    // --- plc-scan-debug: 一時停止して1スキャンずつ進める ---
    await openPanel('plc-debug');
    await page.getByRole('button', { name: '一時停止', exact: true }).click();
    const stepScan = page.getByRole('button', { name: '1スキャン実行（10 ms）', exact: true });
    const resumeScan = page.getByRole('button', { name: '連続実行へ戻る', exact: true });
    await stepScan.click();
    await resumeScan.scrollIntoViewIfNeeded();
    // 下段の欄は高さが小さく、見出しは上へ隠れる。欄の中の「一時停止中」の表示を指す
    const pausedNote = page
      .getByTestId('plc-debug')
      .getByText('一時停止中', { exact: false })
      .first();
    await shoot(
      'plc-scan-debug',
      {
        1: await rectOf(pausedNote),
        2: await rectOf(stepScan),
        3: await rectOf(resumeScan),
      },
      'auto',
    );
    await resumeScan.click();
    await closePanel('plc-debug');

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
    const whiteLamp = PLC_BOARD.lamps[0];
    if (whiteLamp === undefined) throw new Error('ランプが定義されていません');
    await shoot(
      'plc-run-lamps',
      {
        1: rectAt(plcBoardPoint({ ...whiteLamp.pos, z: 4.5 }, boardBox), 40),
        2: rectAt(pb1, 40),
      },
      'auto',
    );

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

  test('メーカーごとの編集画面と机上の配線', async () => {
    await page.getByTestId('toolbar-monitor-start').click();
    // 机上の電線を張り替えるので、先に盤の電源を切る（通電中に配線しない）
    await powerOff();
    const models = { omron: 'CP1E', jtekt: 'PC10G-1SP', sharp: 'JW-300' } as const;
    for (const vendor of ['omron', 'jtekt', 'sharp'] as const) {
      const unit = plcUnitFor(models[vendor]);
      if (unit === undefined) throw new Error(`${models[vendor]} の定義がありません`);
      if (vendor === 'omron') {
        // --- plc-switch-vendor: 盤を見たまま「メーカーを切り替える」 ---
        await page.getByTestId('view-board').click();
        await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'board');
        // 窓を開くと後ろの欄は操作できなくなる（重なり判定に掛かる）ので、先に測っておく
        await page.getByTestId('switch-vendor').scrollIntoViewIfNeeded();
        const modelRect = await rectOf(page.getByTestId('plc-model'));
        const switchRect = await rectOf(page.getByTestId('switch-vendor'));
        await page.getByTestId('switch-vendor').click();
        await page.getByTestId('notation-to-omron').click();
        const warning = page.getByTestId('notation-warning');
        await expect(warning).toContainText('机上のPLC本体も切り替わります');
        await shoot(
          'plc-switch-vendor',
          {
            1: modelRect,
            2: switchRect,
            3: await rectOf(warning),
          },
          'full',
        );
        await page.getByTestId('notation-apply').click();
        await expect(page.getByTestId('notation-dialog')).toHaveCount(0);
      } else {
        await page.getByTestId('toolbar-notation').click();
        await page.getByTestId(`notation-to-${vendor}`).click();
        await page.getByTestId('notation-apply').click();
        await expect(page.getByTestId('notation-dialog')).toHaveCount(0);
      }
      // 切り替えると課題を開き直すので、表示は既定（分割）へ戻る。ラダーだけの表示にする
      await page.getByTestId('view-ladder').click();
      await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'ladder');
      await page.getByTestId('cell-n1:0:0').click();
      await shoot(
        `plc-vendor-${vendor}`,
        {
          1: await rectOf(page.getByTestId('skin-title').locator('span').first()),
          2: await rectOf(page.getByTestId('ladder-grid'), 0),
        },
        'full',
      );
      if (vendor === 'omron') {
        await expect(page.getByTestId('convert-state')).toHaveText(
          '変換に成功しました（自動で変換されます）',
        );
        await page.getByTestId('convert-state').scrollIntoViewIfNeeded();
        await shoot(
          'plc-convert-auto',
          {
            1: await rectOf(page.getByTestId('convert-state')),
            2: await rectOf(page.getByTestId('output-summary').locator('h2')),
          },
          'auto',
        );
      }
      // --- plc-desk-*: 切り替えると外れる机上の電線だけを、その機種の端子名で張り直す ---
      await page.getByTestId('view-board').click();
      await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'board');
      // 視点を「盤＋PLC」にそろえる（1280px 幅では視点のボタンは「…」の中にある）
      await openOverflow(page);
      await page.getByTestId('view-plc').click();
      await closeOverflow(page);
      const box = await waitForBoard();
      for (const wire of plcWiringPlan(PLC_IO, unit)) {
        const from = String(wire.from);
        const to = String(wire.to);
        const desk = [from, to].some((id) => id.startsWith('PLC.') || id.startsWith('OUTLET.'));
        if (desk) await plcDeskWire(unit, box, from, to);
      }
      await shootDesk(`plc-desk-${vendor}`, unit, box);
      await page.getByTestId('view-ladder').click();
    }
  });

  test('タイマ設定と初回ガイド', async () => {
    await openProblem('mode-assemble', 'b-003');
    await waitForBoard();
    await page.getByTestId('socket-list-S5').click();
    await page.getByTestId('mount-timer-h3y4').click();
    const number = page.getByRole('spinbutton', { name: /T1.*数値/u });
    await number.fill('3');
    await number.blur();
    const dial = number.locator('xpath=..');
    await shoot(
      'timer-preset',
      {
        1: await rectOf(dial.locator('span').first()),
        2: await rectOf(number),
      },
      'auto',
    );
    await goHome();
    await page.getByTestId('open-settings').click();
    await page.getByTestId('setting-restart-tour').click();
    await page.getByTestId('open-b-001').click();
    // 直前に開いていた b-003（タイマを載せた作業）から移るときは確認が出る
    const change = page.getByTestId('problem-change-confirm');
    if (await change.isVisible())
      await change.getByRole('button', { name: '保存せず進む', exact: true }).click();
    await expect(page.getByTestId('tour-guide')).toBeVisible();
    await shoot(
      'tour-first',
      {
        1: await rectOf(page.getByText('3分操作ガイド', { exact: true })),
        2: await rectOf(page.getByTestId('tour-later')),
      },
      'full',
    );
    await page.getByTestId('tour-later').click();
  });

  test('設定・ホーム・課題一覧・ヘルプ', async () => {
    await openProblem('mode-assemble', 'b-001');
    // --- settings ---
    await goHome();
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('setting-user-dir')).toBeVisible();
    /*
     * 「利用者課題フォルダ」の既定は `…¥Users¥〈Windowsのアカウント名〉¥AppData¥Roaming¥…`
     * （`main/settings.ts` の `defaultUserContentDir()`。`--user-data-dir` では変わらない）で、
     * そのまま撮ると配る説明書に撮影した人のアカウント名が載る。共有の場所へ入れ直してから撮る。
     */
    const userDir = join(
      process.env['PUBLIC'] ?? 'C:/Users/Public',
      '電気教育ツール',
      '利用者課題',
    );
    await page.getByTestId('setting-user-dir').fill(userDir);
    await page.getByTestId('setting-user-dir').blur();
    await expect(page.getByTestId('toast')).toContainText('設定を保存しました');
    await expect(page.getByTestId('setting-user-dir')).toHaveValue(userDir);
    await shoot(
      'settings-accessibility',
      {
        1: await rectOf(page.getByTestId('setting-ui-scale')),
        2: await rectOf(page.getByTestId('setting-contrast')),
      },
      'auto',
    );
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
    await expect(page.getByTestId('current-work')).toBeVisible();
    await shoot(
      'home',
      {
        1: await rectOf(page.getByTestId('mode-assemble'), 0),
        2: await rectOf(page.getByTestId('open-settings')),
        3: await rectOf(page.getByTestId('open-help')),
      },
      'full',
    );

    // --- home-tutorials / tutorial-player: PLCの動画はメーカーを切り替えて見られる ---
    const plcTutorial = page.getByTestId('tutorial-plc');
    const plcCard = plcTutorial.locator('xpath=ancestor::article[1]');
    await plcCard.scrollIntoViewIfNeeded();
    await shoot(
      'home-tutorials',
      { 1: await rectOf(plcCard, 0), 2: await rectOf(plcTutorial) },
      'auto',
    );
    await plcTutorial.click();
    const player = page.getByTestId('tutorial-player');
    await expect(player).toBeVisible();
    const video = player.locator('video');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    // 冒頭（課題と説明の吹き出し）の1コマで撮る。途中の細かい盤の絵は PNG が大きくなる
    await video.evaluate((element: HTMLVideoElement) => {
      element.currentTime = 3;
    });
    await page.waitForTimeout(1000);
    // 窓は画面の高さをわずかに超えるので、下端（再生速度）まで送ってから撮る
    await player.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await shoot(
      'tutorial-player',
      {
        1: await rectOf(player.getByRole('group', { name: 'メーカーを選ぶ', exact: true })),
        2: await rectOf(video, 0),
        3: await rectOf(player.getByRole('combobox', { name: '動画の再生速度', exact: true })),
      },
      'auto',
    );
    await page.keyboard.press('Escape');
    await expect(player).toHaveCount(0);

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
    await page
      .getByTestId('grade-filter')
      .getByRole('button', { name: 'すべて', exact: true })
      .click();
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

  test('課題作成の回路図・模範ラダー', async () => {
    await goHome();
    await page.getByTestId('open-settings').click();
    await page.getByTestId('problem-authoring-summary').click();
    const authoring = page.getByTestId('problem-authoring');
    await authoring.getByLabel('複製元の課題').selectOption('b-087');
    await authoring.getByRole('button', { name: '課題を複製', exact: true }).click();
    await authoring.getByTestId('author-reference-open').click();
    const editor = page.getByTestId('author-reference-editor');
    await editor.evaluate((element) => {
      element.scrollTop = 0;
    });
    await shoot(
      'authoring-schematic',
      {
        1: await rectOf(editor.getByTestId('schematic-palette')),
        2: await rectOf(editor.getByTestId('add-rung-button')),
      },
      'full',
    );
    await editor.getByRole('button', { name: '編集を終える', exact: true }).click();
    await authoring.getByLabel('複製元の課題').selectOption('d-061');
    await authoring.getByRole('button', { name: '課題を複製', exact: true }).click();
    await authoring.getByRole('button', { name: '置き換える', exact: true }).click();
    await authoring.getByTestId('author-reference-open').click();
    await editor.evaluate((element) => {
      element.scrollTop = 0;
    });
    await shoot(
      'authoring-ladder',
      {
        1: await rectOf(editor.getByRole('button', { name: '回路ブロックを追加', exact: true })),
        2: await rectOf(editor.getByTestId('cell-term0:0:0')),
      },
      'full',
    );
    await editor.getByRole('button', { name: '編集を終える', exact: true }).click();
  });

  test('吹き出しを描き込んで仕上げる', async () => {
    const names = Object.keys(SHOTS).sort();
    const missing = names.filter((name) => GEOMETRY[name] === undefined);
    expect(missing, '撮れていない図があります').toEqual([]);

    /*
     * 先に全図ぶんの置き方を組んでみる。置けない図があるときは**消す前に**落ちるので、
     * 古い図が消えただけで終わる（`annotate()` の途中で落ちると図が1枚も残らない）。
     */
    for (const name of names) {
      const shot = SHOTS[name];
      const geometry = GEOMETRY[name];
      if (shot === undefined || geometry === undefined) throw new Error(`${name} を撮れていません`);
      planCallouts(shot, geometry, SHOT_SIZE);
    }

    rmSync(OUT_DIR, { recursive: true, force: true });
    for (const name of names) await annotate(name);

    // 測った矩形をまとめて正本にする（設計 §6.4 の「場所」のファイル）
    const ordered: Record<string, Geometry> = {};
    for (const name of names) {
      const geometry = GEOMETRY[name];
      if (geometry !== undefined) ordered[name] = geometry;
    }
    writeFileSync(join(MANUAL_DIR, 'shot-geometry.json'), toJson(ordered), 'utf8');
  });
});
