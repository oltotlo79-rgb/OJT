import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * E2E の起動の定型（レビュー指摘 QA-12 / QA-13）。
 *
 * 12 本の spec が `CHROMIUM_FLAGS`・窓の大きさの固定・復元プロンプトの片付け・`shot()` を
 * それぞれ複写していた（しかも `shot()` は2通りの引数の並びがあった）。ここに1か所だけ置く。
 *
 * **`--user-data-dir` を必ず渡す**のが QA-12 の対策である。渡さないと Electron は利用者本人の
 * `%APPDATA%/電気教育ツール` を使うので、E2E が設定・最近の課題・一時保存を書き換え、
 * spec どうしも状態を漏らし合う（復元プロンプトの片付けが 12 か所に複写されていたのがその証拠）。
 * 既定では `mkdtempSync()` の使い捨てフォルダを作り、ワーカーの終了時にまとめて捨てる。
 *
 * `projection.ts` は Vitest からも読まれるので `@playwright/test` を実行時に読み込まない。
 * このモジュールは spec からしか読まれないので、その制約は無い。
 */

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** スクリーンショットの置き場（`OJT_SHOT_DIR` で差し替えられる）。 */
export const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');

/**
 * CI やリモートデスクトップには GPU が無いことがあるため、ソフトウェアラスタライザで描かせる
 * （`smoke.spec.ts` の注記）。GPU のある実機でも同じフラグで動く。
 */
export const CHROMIUM_FLAGS: readonly string[] = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

export interface WindowSize {
  width: number;
  height: number;
}

/** 既定の窓の大きさ（スクリーンショットを揃える）。 */
export const DEFAULT_WINDOW: WindowSize = { width: 1440, height: 900 };

export interface LaunchOptions {
  /** 実機の性能測定だけはソフトウェア描画を強制しない。 */
  graphics?: 'software' | 'hardware';
  /** 窓の大きさ（枠を含む `setBounds`）。既定は `DEFAULT_WINDOW`。 */
  window?: WindowSize;
  /** 枠を**除いた**中身の大きさで合わせる（取扱説明書の図。`window` より優先）。 */
  contentSize?: WindowSize;
  /**
   * 使う `userData` フォルダ。既定は使い捨ての一時フォルダ（QA-12）。
   * 「前回の一時保存が残っている状態」を作りたいときだけ、同じ値を2回の起動へ渡す。
   */
  userDataDir?: string;
  /** `CHROMIUM_FLAGS` に足すフラグ。 */
  extraFlags?: readonly string[];
  /** `firstWindow()` の**前**に main 側へ仕掛ける（通信の見張りなど）。 */
  onLaunched?: (app: ElectronApplication) => Promise<void>;
  /** 立ち上がりを確かめるホーム画面の `data-testid`。既定は `mode-assemble`。 */
  home?: string;
  /** 復元プロンプトを片付けない（復元カードそのものを見るとき）。 */
  keepRestorePrompt?: boolean;
  /** 初回ガイドそのものを検査するときだけ有効にする。通常は保存済み状態から始める。 */
  firstRunGuide?: boolean;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
  /** この起動が使った `userData`。同じ状態で起動し直したいときに渡す。 */
  userDataDir: string;
}

/**
 * 自分で作った一時 `userData` の置き場。spec 側は今までどおり `app.close()` を呼ぶだけでよく、
 * 後始末はワーカーの終了時にまとめて済ませる（`rmSync` は同期なので `exit` で動く）。
 */
const ownedUserDataDirs: string[] = [];
process.on('exit', () => {
  for (const dir of ownedUserDataDirs) removeDir(dir);
});

/** ビルド済みの Electron を起こし、復元プロンプトを片付けてホームに立たせる。 */
export async function launchApp(options: LaunchOptions = {}): Promise<Launched> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'ojt-e2e-'));
  if (options.userDataDir === undefined) ownedUserDataDirs.push(userDataDir);
  const settings = join(userDataDir, 'settings.json');
  if (options.firstRunGuide !== true && !existsSync(settings)) {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(settings, JSON.stringify({ tourDone: true }), 'utf8');
  }
  const app = await electron.launch({
    args: [
      join(APP_ROOT, 'out', 'main', 'index.js'),
      ...(options.graphics === 'hardware' ? [] : CHROMIUM_FLAGS),
      ...(options.extraFlags ?? []),
      `--user-data-dir=${userDataDir}`,
    ],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (options.onLaunched !== undefined) await options.onLaunched(app);
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // ウィンドウは `ready-to-show` まで非表示なので、明示的に出して大きさを固定する
  const size = options.contentSize ?? options.window ?? DEFAULT_WINDOW;
  await app.evaluate(
    ({ BrowserWindow }, bounds) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      if (bounds.content) window.setContentSize(bounds.width, bounds.height);
      else window.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
      window.show();
      window.focus();
    },
    { width: size.width, height: size.height, content: options.contentSize !== undefined },
  );
  // 表示直後はコンポジタがまだフレームを出しておらず `capturePage()` が失敗することがある
  await page.waitForTimeout(1500);
  if (options.keepRestorePrompt !== true) {
    await dismissRestorePrompt(page, options.home ?? 'mode-assemble');
  }
  return { app, page, userDataDir };
}

/**
 * 前回の一時保存が残っていると出る復元プロンプトを片付ける（§12.3）。
 * 出るかどうかは前回の終わり方次第なので、**どちらかが出るまで**待つ（固定sleepにしない）。
 */
export async function dismissRestorePrompt(
  page: Page,
  homeTestId = 'mode-assemble',
): Promise<void> {
  const restore = page.getByTestId('restore-prompt');
  const home = page.getByTestId(homeTestId);
  await expect(restore.or(home).first()).toBeVisible({ timeout: 30_000 });
  if ((await restore.count()) > 0) {
    await page.getByRole('button', { name: '復元しない' }).click();
  }
  await expect(home).toBeVisible({ timeout: 30_000 });
}

/**
 * 画面を撮る。`BrowserWindow.capturePage()` で撮るので、他のウィンドウに隠れていても撮れる
 * （Playwright の `page.screenshot()` は `Unable to capture screenshot` で失敗することがある）。
 */
export async function shot(app: ElectronApplication, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(base64, 'base64'));
}

/**
 * 画面が落ち着くのを待ってから撮る。切り替えた直後はコンポジタに**前の画面のフレーム**しか
 * 届いておらず、`capturePage()` がそれを返す。3Dは `frameloop="demand"` なので初回の描画も
 * ひと呼吸遅れて届く（盤が真っ黒のまま写る）。
 */
export async function settledShot(
  app: ElectronApplication,
  page: Page,
  name: string,
): Promise<void> {
  await settleFrames(page);
  await shot(app, name);
}

/** 2フレーム描かせてから待つ（3Dを出している画面ではさらに待つ）。 */
export async function settleFrames(page: Page): Promise<void> {
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

/** 一時フォルダを捨てる（Windows では直後だと掴まれていることがあるので数回粘る）。 */
function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 消せなくてもテストの結果には関わらない（%TEMP% はいずれ掃除される）
  }
}
