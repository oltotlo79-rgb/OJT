import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { COIL_COL } from '@ojt/ladder-core';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  boardPoint,
  closeOverflow,
  openOverflow,
  SELF_HOLD_WIRES,
  terminalPoint,
  type CanvasBox,
} from './projection.js';

/**
 * 画面品質の機械点検（2026-09-20 の利用者要求）。
 *
 *   「ツール全体で文字や図形の重なりや変な場所で改行するなどが全ての場合でないか確認し、
 *     文字や各要素の配置や大きさなど見にくかったり使いにくいものはないか。
 *     説明を見なくても直感的に使用できるような分かりやすいUI,UXになっているか確認して」
 *
 * 全画面・全状態を 3 つの窓の大きさ（1280×800 / 1440×900 / 1920×1080）で歩き、各停留点で
 *
 *   ① はみ出し（`documentElement` に横スクロールが出る）
 *   ② 文字の切れ（`scrollWidth > clientWidth` かつ `overflow: hidden` ／ 三点リーダ）
 *   ③ 重なり（見える葉要素どうしの矩形の交差。意図した重ね（ダイアログ・トースト・
 *      3D の HUD・絶対配置）は除く）
 *   ④ 変な改行（1行のはずの要素が 1.8 行以上／12文字以下の語の途中で折り返す）
 *   ⑤ 小さすぎ（文字 11px 未満／クリック対象 24×24px 未満）
 *   ⑥ フォーカスリングの欠落（Tab で回して outline も box-shadow も付かない）
 *   ⑦ 3D キャンバスが単色のまま（描けていない）
 *
 * を DOM から数え、`%TEMP%\ui-audit\findings.json` に書き出しつつ、1画面×1サイズにつき
 * PNG を 1 枚 `OJT_SHOT_DIR` へ残す（`ui-<画面>-<状態>-<幅>x<高さ>.png`）。
 *
 * **判定の方針**
 *
 * - `severity: 'blocking'`（はみ出し・ツールバー／状態／ボタンの文字切れ・操作要素どうしの
 *   重なり）は **0 件であること**を assert する。既知の未修正分だけを `KNOWN_BLOCKING` に
 *   書き出して除外しているので、修正が載るたびにその行を消す。
 * - それ以外は件数を `BASELINE` 以下であることだけ見る（新規の悪化を止める網）。
 *   **直したら必ず BASELINE を下げる**こと。下げ方は下記 `BASELINE` のコメント参照。
 *
 * 文言は `src/renderer/i18n/ja.ts` と同じものをここに書き写している（E2E は成果物を外から
 * 触るので `ja.ts` を読み込まない。`inspect.spec.ts` 冒頭の注記と同じ方針）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');
/** 点検結果の置き場（`%TEMP%\ui-audit`）。 */
const AUDIT_DIR = join(process.env['TEMP'] ?? process.env['TMP'] ?? tmpdir(), 'ui-audit');
const FINDINGS_PATH = join(AUDIT_DIR, 'findings.json');
const SUMMARY_PATH = join(AUDIT_DIR, 'summary.json');

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

/** 歩く窓の大きさ（利用者要求: 3種）。 */
const SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** 内蔵課題（`packages/content/src/builtin/`）。 */
const B_PROBLEM = 'b-001';
/** 2級のモードB課題（回路図ヒントを開閉できる）。 */
const B_PROBLEM_GRADE2 = 'b-004';
const C1_PROBLEM = 'c1-001';
/** 2級のモードC2課題（回路図ヒントを開閉できる）。 */
const C2_PROBLEM = 'c2-001';
const D_PROBLEM = 'd-001';

/** 内蔵課題 b-001 の固定配線（チェック用回路）の本数。§6.3 */
const FIXED_WIRES = 3;

/* ------------------------------------------------------------------------- *
 * しきい値と基準値
 * ------------------------------------------------------------------------- */

/** 読めないと判断する文字の大きさ[px]。 */
const MIN_FONT_PX = 11;
/** 押しにくいと判断するクリック対象の一辺[px]。 */
const MIN_TARGET_PX = 24;

/**
 * 件数の上限（いまの実測値）。**修正が載ったら必ずこの数を実測値まで下げる**。
 *
 * 下げ方: `OJT_SHOT_DIR=... pnpm --filter @ojt/desktop exec playwright test e2e/ui-quality.spec.ts`
 * を通し、最後の「集計」テストが標準出力へ出す表（`check=... total=...`）か
 * `%TEMP%\ui-audit\summary.json` の `byCheck` をそのままここへ書き写す。
 * 下げ忘れを防ぐため、**実測が基準より 20% 以上少なければ集計テストが警告を出す**。
 */
const BASELINE: Readonly<Record<string, number>> = {
  'page-overflow': 0,
  // 日本語が切れていないことは Plan 5 の完了条件そのものなので **0 のまま**（1件でも落とす）
  clip: 0,
  overlap: 132,
  'hud-overlap': 94,
  duplicate: 0,
  wrap: 30,
  'small-text': 24,
  'small-target': 126,
  focus: 0,
  canvas: 0,
};

/**
 * 致命（`blocking`）の件数の上限。**本来は 0 でなければならない**。
 *
 * UI監査バッチ A〜D と Batch E の直しを載せたあとの実測（2026-09-20）。残っているのは
 * 次の2種で、どちらも**3D盤の上の表示**と**モードDの1920×1080**に限られる。
 * 直すたびに実測まで下げ、最後は 0 にすること。
 *
 * - 3D盤の名札どうし／名札と状態オーバーレイの重なり（`hud-overlap`。モードB「並べて」と
 *   モードDの盤。`span.block-label ∩ span.block-label`）
 * - モードD 1920×1080 でデバイスコメント欄がキー割当表の見出しと重なる
 *   （`overlap`。`comment-input-X0 ∩ shortcuts-summary`）
 */
const BLOCKING_BASELINE = 120;

/** 歩けなかった状態のメモ。多すぎると網として意味が無いので上限を置く。 */
const MAX_NOTES = 6;

/* ------------------------------------------------------------------------- *
 * 指摘の型と溜め場
 * ------------------------------------------------------------------------- */

type CheckName =
  | 'page-overflow'
  | 'clip'
  | 'overlap'
  | 'hud-overlap'
  | 'duplicate'
  | 'wrap'
  | 'small-text'
  | 'small-target'
  | 'focus'
  | 'canvas';

type Severity = 'blocking' | 'important' | 'minor';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 画面側（ブラウザ内）が返す生の指摘。 */
interface RawFinding {
  check: CheckName;
  selector: string;
  text: string;
  rect: Rect;
  severity: Severity;
  detail: string;
}

/** 記録する指摘。 */
interface Finding extends RawFinding {
  screen: string;
  size: string;
}

/** 全テストで溜める（`workers: 1` なので同じプロセスに残る）。再試行の重複はキーで潰す。 */
const findings = new Map<string, Finding>();
/** 歩けなかった状態のメモ。 */
const notes: string[] = [];

function keyOf(finding: Finding): string {
  return [finding.screen, finding.size, finding.check, finding.selector, finding.detail].join('|');
}

/** 指摘を溜めて、そのつど findings.json へ書き出す（途中で落ちても結果が残るように）。 */
function record(list: readonly Finding[]): void {
  for (const finding of list) findings.set(keyOf(finding), finding);
  mkdirSync(AUDIT_DIR, { recursive: true });
  writeFileSync(FINDINGS_PATH, JSON.stringify([...findings.values()], null, 2), 'utf8');
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 1 つの状態へ辿り着く操作。途中で失敗しても**歩き続ける**ためにここで受け止める
 * （点検は「全部を見る」ことが目的で、1 箇所の取りこぼしで残りを捨てたくない）。
 * 取りこぼしはメモに残し、集計テストで件数を見る。
 */
async function step(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    notes.push(`${name}: ${reasonOf(error)}`);
  }
}

/* ------------------------------------------------------------------------- *
 * アプリの起動と撮影
 * ------------------------------------------------------------------------- */

interface Launched {
  app: ElectronApplication;
  page: Page;
}

async function launch(): Promise<Launched> {
  const app = await electron.launch({
    args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await setBounds(app, SIZES[1] ?? { width: 1440, height: 900 });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    window.show();
    window.focus();
  });
  await page.waitForTimeout(1500);
  const restore = page.getByTestId('restore-prompt');
  const home = page.getByTestId('mode-assemble');
  await expect(restore.or(home).first()).toBeVisible({ timeout: 30_000 });
  if ((await restore.count()) > 0) {
    await page.getByRole('button', { name: '復元しない' }).click();
    await expect(home).toBeVisible();
  }
  return { app, page };
}

async function setBounds(
  app: ElectronApplication,
  size: { width: number; height: number },
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    window.setBounds({ x: 0, y: 0, ...bounds });
  }, size);
}

function sizeKey(size: { width: number; height: number }): string {
  return `${String(size.width)}x${String(size.height)}`;
}

/**
 * 撮影（`BrowserWindow.capturePage()`）と 3D キャンバスの単色判定を **main で 1 回**にまとめる。
 * `page.screenshot()` は窓が隠れていると失敗するが `capturePage()` はコンポジタから取れる。
 */
async function capture(
  app: ElectronApplication,
  name: string,
  canvas: { rect: Rect; cssWidth: number } | null,
): Promise<{ distinct: number; spread: number } | null> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const shot = await app.evaluate(async ({ BrowserWindow }, arg) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    const png = image.toPNG().toString('base64');
    if (arg === null) return { png, stats: null };
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const scale = arg.cssWidth > 0 ? size.width / arg.cssWidth : 1;
    const seen = new Set<number>();
    let min = 255;
    let max = 0;
    const steps = 32;
    for (let iy = 0; iy < steps; iy += 1) {
      for (let ix = 0; ix < steps; ix += 1) {
        const px = Math.round((arg.rect.x + ((ix + 0.5) / steps) * arg.rect.w) * scale);
        const py = Math.round((arg.rect.y + ((iy + 0.5) / steps) * arg.rect.h) * scale);
        if (px < 0 || py < 0 || px >= size.width || py >= size.height) continue;
        const offset = (py * size.width + px) * 4;
        // Electron の `toBitmap()` は BGRA 並び
        const b = bitmap[offset] ?? 0;
        const g = bitmap[offset + 1] ?? 0;
        const r = bitmap[offset + 2] ?? 0;
        seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
      }
    }
    return { png, stats: { distinct: seen.size, spread: Math.round(max - min) } };
  }, canvas);
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(shot.png, 'base64'));
  return shot.stats;
}

/* ------------------------------------------------------------------------- *
 * DOM の機械点検（ブラウザ内で走る）
 * ------------------------------------------------------------------------- */

/**
 * 意図した重ね。ここに入る要素は**重なり検査から外す**。
 * ダイアログ・トースト・ポップオーバーは「上に乗せる」ことが設計なので、
 * 下の画面と重なっていて当たり前である。
 *
 * **3Dビューポートの上の表示（名札・状態オーバーレイ・操作ヒント）は外さない。**
 * 利用者要求 2026-09-20「重なってるし」のとおり、名札どうし・名札と状態表示の重なりは
 * まさに直すべきものなので、`hudOverlap()` で別立てに見る。
 */
const OVERLAY_SELECTORS: readonly string[] = [
  'dialog',
  '[role="dialog"]',
  '[role="tooltip"]',
  '[data-testid="toast"]',
  '[data-testid="toolbar-overflow"]',
  '[data-testid="report-popover"]',
  '[data-testid="notation-dialog"]',
  '[data-testid="device-input"]',
  '[data-testid="chart-modal"]',
  '[data-testid="chart-backdrop"]',
  '[data-testid="schematic-modal"]',
  '[data-testid="schematic-backdrop"]',
  '[data-testid="restore-prompt"]',
  '[data-testid="discard-confirm"]',
  '[data-testid="hazard-banner"]',
  '[data-testid="perf-readout"]',
  '[data-testid="camera-readout"]',
  '[data-testid="viewport"]',
];

/**
 * 3Dビューポートの上に載る文字（drei の `<Html>` 名札・状態オーバーレイ・操作ヒント）。
 * ここに入るものどうしの重なりは `hud-overlap`（blocking）として出す。
 */
const HUD_SELECTOR =
  '[data-testid="viewport"] .block-label, [data-testid="viewport"] .terminal-tooltip, [data-testid="status-overlay"], [data-testid="view-hint"]';

/** 押せるもの（重なり・当たり判定の大きさで見る対象）。 */
const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a[href], summary, [role="button"], [role="tab"]';

/**
 * 1 行で収まるべき要素。ボタン・表見出し・チップ／バッジ・手順帯・ツールバーの項目など。
 * CSS Modules は `_plcChip_1a2b3` のような名前になるので、部分一致（大小無視）で拾う。
 */
const ONE_LINE_SELECTOR = [
  'button',
  'th',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[data-testid^="toolbar-"]',
  '[data-testid^="plc-step-"]',
  '[data-testid^="step-"]',
  '[class*="chip" i]',
  '[class*="badge" i]',
  '[class*="tag" i]',
  '[class*="stepName" i]',
  '[class*="stepNote" i]',
  '[class*="toolLabel" i]',
  '[class*="statusBar" i]',
  '[class*="panelTitle" i]',
  '[class*="verdict" i]',
].join(',');

/** ツールバー・状態表示・ボタンの文字（切れたら致命的）。 */
const HARD_TEXT_SELECTOR =
  'button, [role="button"], th, [data-testid^="toolbar-"], [data-testid="status-overlay"], [data-testid^="plc-step-"], [data-testid^="step-"], [class*="statusBar" i], [class*="verdict" i]';

interface AuditConfig {
  overlay: string;
  hud: string;
  interactive: string;
  oneLine: string;
  hardText: string;
  minFontPx: number;
  minTargetPx: number;
  maxOverlap: number;
  maxWrap: number;
}

const AUDIT_CONFIG: AuditConfig = {
  overlay: OVERLAY_SELECTORS.join(','),
  hud: HUD_SELECTOR,
  interactive: INTERACTIVE_SELECTOR,
  oneLine: ONE_LINE_SELECTOR,
  hardText: HARD_TEXT_SELECTOR,
  minFontPx: MIN_FONT_PX,
  minTargetPx: MIN_TARGET_PX,
  maxOverlap: 60,
  maxWrap: 40,
};

/** DOM を点検して生の指摘を返す（最初の1件で止めず全部集める）。 */
async function auditDom(page: Page): Promise<RawFinding[]> {
  return page.evaluate((cfg: AuditConfig): RawFinding[] => {
    const out: RawFinding[] = [];

    const describe = (el: Element): string => {
      const testId = el.getAttribute('data-testid');
      if (testId !== null && testId.length > 0) return `[data-testid="${testId}"]`;
      const id = el.getAttribute('id');
      if (id !== null && id.length > 0) return `#${id}`;
      const className = el.getAttribute('class');
      const first = className === null ? '' : (className.split(/\s+/)[0] ?? '');
      const role = el.getAttribute('role');
      return [
        el.tagName.toLowerCase(),
        first.length > 0 ? `.${first}` : '',
        role === null ? '' : `[role=${role}]`,
      ].join('');
    };

    const shorten = (value: string): string =>
      value.length > 44 ? `${value.slice(0, 44)}…` : value;

    const ownText = (el: Element): string => {
      let text = '';
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? '';
      }
      return text.replace(/\s+/g, ' ').trim();
    };

    const boxOf = (rect: DOMRect): Rect => ({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    });

    /** 画面（と祖先の切り抜き）に実際に出ている範囲。 */
    interface Clip {
      l: number;
      t: number;
      r: number;
      b: number;
    }

    /**
     * 画面に出ている実際の文字の大きさ[px]。
     *
     * SVG の `<text>` は `viewBox` で拡大縮小されるので、`font-size` の数字は画面上の
     * 大きさと一致しない（回路図は 1/2 に縮み、ラダーは 1.5 倍に伸びる）。
     * 画面変換行列（`getScreenCTM()`）の倍率を掛けて、目に見える大きさに直す。
     */
    const effectiveFontPx = (el: Element, style: CSSStyleDeclaration): number => {
      const fontSize = Number.parseFloat(style.fontSize);
      if (!Number.isFinite(fontSize)) return Number.NaN;
      if (!(el instanceof SVGGraphicsElement)) return fontSize;
      const ctm = el.getScreenCTM();
      if (ctm === null) return fontSize;
      const scale = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c));
      return Number.isFinite(scale) && scale > 0 ? fontSize * scale : fontSize;
    };

    interface Info {
      el: Element;
      text: string;
      /** 要素そのものの矩形（大きさの検査に使う）。 */
      rect: DOMRect;
      /** 祖先の切り抜きまで入れた「実際に見えている」矩形（重なりの検査に使う）。 */
      shown: Clip;
      style: CSSStyleDeclaration;
      fontPx: number;
      overlay: boolean;
      inViewport: boolean;
      positioned: boolean;
    }

    /*
     * `querySelectorAll` は文書順（親が先）に返すので、「重ね用（絶対・固定・粘着）の中に
     * いるか」も「祖先にどこまで切り抜かれているか」も、親の答えを引き継ぐだけで決まる。
     * 祖先を毎回たどると `getComputedStyle` が要素数×深さ回になって、密な画面では
     * 点検だけで数秒かかる。
     *
     * 切り抜きを見るのは必須である。**右パネルや編集ペインはスクロールする**ので、
     * 上へ送り出された見出しの `getBoundingClientRect()` は画面の上端（ツールバーの位置）を
     * 返す。切り抜きを見ないと「ツールバーのボタンと右パネルの見出しが重なっている」という
     * 偽の指摘が大量に出る。
     */
    const positionedMap = new Map<Element, boolean>();
    const clipMap = new Map<Element, Clip>();
    const screenClip: Clip = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight };
    const infos: Info[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const style = window.getComputedStyle(el);
      const position = style.position;
      const parent = el.parentElement;
      const positioned =
        position === 'absolute' ||
        position === 'fixed' ||
        position === 'sticky' ||
        (parent !== null && (positionedMap.get(parent) ?? false));
      positionedMap.set(el, positioned);

      const tag = el.tagName.toLowerCase();
      const skipped =
        tag === 'script' ||
        tag === 'style' ||
        tag === 'template' ||
        style.display === 'none' ||
        style.visibility === 'hidden';
      // 位置が固定のものは祖先のスクロールに付いていかないので、切り抜きは画面だけ
      const parentClip: Clip =
        position === 'fixed' ? screenClip : (clipMap.get(parent ?? el) ?? screenClip);
      const rect = el.getBoundingClientRect();
      const clipsX = style.overflowX !== 'visible';
      const clipsY = style.overflowY !== 'visible';
      clipMap.set(
        el,
        clipsX || clipsY
          ? {
              l: clipsX ? Math.max(parentClip.l, rect.left) : parentClip.l,
              t: clipsY ? Math.max(parentClip.t, rect.top) : parentClip.t,
              r: clipsX ? Math.min(parentClip.r, rect.right) : parentClip.r,
              b: clipsY ? Math.min(parentClip.b, rect.bottom) : parentClip.b,
            }
          : parentClip,
      );
      if (skipped) continue;
      if (tag === 'canvas') continue;
      // 回路図・ラダーの SVG は図形が何百個もあるので、文字だけを見る
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && tag !== 'text' && tag !== 'svg') {
        continue;
      }
      if (Number(style.opacity) === 0) continue;
      if (rect.width <= 0 || rect.height <= 0) continue;
      /*
       * 読み上げ専用の文字（`panels.module.css` の `.srOnly`: 1×1px ＋ `clip-path: inset(50%)`）は
       * **目に見えない**ので、どの検査の対象にもしない（Batch E レビュー B3 の再測定で
       * `undo-reason` / `redo-reason` が「文字が切れている」として 276 件数えられていた。
       * 目に見えない文字を「切れている」と数えると、本物の文字切れが埋もれて網の意味が無くなる）。
       */
      if (style.clipPath !== 'none' && rect.width <= 2 && rect.height <= 2) continue;
      const shown: Clip = {
        l: Math.max(rect.left, parentClip.l),
        t: Math.max(rect.top, parentClip.t),
        r: Math.min(rect.right, parentClip.r),
        b: Math.min(rect.bottom, parentClip.b),
      };
      // 1px も見えていない（スクロールで送り出された・親にはみ出して切られた）ものは数えない
      if (shown.r - shown.l < 1 || shown.b - shown.t < 1) continue;
      infos.push({
        el,
        text: ownText(el),
        rect,
        shown,
        style,
        fontPx: effectiveFontPx(el, style),
        overlay: el.closest(cfg.overlay) !== null,
        inViewport: el.closest('[data-testid="viewport"]') !== null,
        positioned,
      });
    }

    /* ---- ① ページのはみ出し（横スクロールバー） ---- */
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      out.push({
        check: 'page-overflow',
        selector: 'html',
        text: '',
        rect: { x: 0, y: 0, w: root.clientWidth, h: root.clientHeight },
        severity: 'blocking',
        detail: `scrollWidth ${String(root.scrollWidth)} > clientWidth ${String(root.clientWidth)}`,
      });
    }

    /* ---- ② 文字の切れ ---- */
    for (const info of infos) {
      if (info.text.length === 0) continue;
      const display = info.style.display;
      // インライン要素は clientWidth/scrollWidth を持たない（0 のまま）ので測れない
      if (display === 'inline' || display === 'contents') continue;
      const hideX = info.style.overflowX === 'hidden' || info.style.overflowX === 'clip';
      const hideY = info.style.overflowY === 'hidden' || info.style.overflowY === 'clip';
      const ellipsis = info.style.textOverflow === 'ellipsis';
      const overX = info.el.scrollWidth > info.el.clientWidth + 1;
      const overY = info.el.scrollHeight > info.el.clientHeight + 1;
      if (!((overX && (hideX || ellipsis)) || (overY && hideY))) continue;
      out.push({
        check: 'clip',
        selector: describe(info.el),
        text: shorten(info.text),
        rect: boxOf(info.rect),
        severity: info.el.closest(cfg.hardText) !== null ? 'blocking' : 'important',
        detail:
          `scroll ${String(info.el.scrollWidth)}x${String(info.el.scrollHeight)} / ` +
          `client ${String(info.el.clientWidth)}x${String(info.el.clientHeight)}`,
      });
    }

    /* ---- ③ 重なり ---- */
    const candidates = infos.filter((info) => {
      // 絶対配置・固定・粘着（とその中身）は「重ねる」ための道具なので対象外
      if (info.overlay || info.inViewport || info.positioned) return false;
      return info.text.length > 0 || info.el.matches(cfg.interactive);
    });
    let overlaps = 0;
    for (let i = 0; i < candidates.length && overlaps < cfg.maxOverlap; i += 1) {
      const a = candidates[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < candidates.length && overlaps < cfg.maxOverlap; j += 1) {
        const b = candidates[j];
        if (b === undefined) continue;
        // 入れ子（ボタンの中のラベルなど）は設計どおりの「重なり」
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // 実際に見えている範囲どうしで見る（スクロールで送り出された分は重なりではない）
        const ox = Math.min(a.shown.r, b.shown.r) - Math.max(a.shown.l, b.shown.l);
        const oy = Math.min(a.shown.b, b.shown.b) - Math.max(a.shown.t, b.shown.t);
        // 1px の枠線どうしが触れただけのものは数えない
        if (ox < 2 || oy < 2) continue;
        const bothInteractive = a.el.matches(cfg.interactive) && b.el.matches(cfg.interactive);
        overlaps += 1;
        out.push({
          check: 'overlap',
          selector: `${describe(a.el)} ∩ ${describe(b.el)}`,
          text: shorten(`${a.text} / ${b.text}`),
          rect: {
            x: Math.round(Math.max(a.shown.l, b.shown.l)),
            y: Math.round(Math.max(a.shown.t, b.shown.t)),
            w: Math.round(ox),
            h: Math.round(oy),
          },
          severity: bothInteractive ? 'blocking' : 'important',
          detail: bothInteractive ? '操作要素どうし' : '文字と要素',
        });
      }
    }

    /* ---- ③-b 3Dの上の表示どうしの重なり（利用者要求 2026-09-20「重なってるし」） ---- */
    const hud = infos.filter((info) => info.el.matches(cfg.hud) && info.text.length > 0);
    for (let i = 0; i < hud.length; i += 1) {
      const a = hud[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < hud.length; j += 1) {
        const b = hud[j];
        if (b === undefined) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.shown.r, b.shown.r) - Math.max(a.shown.l, b.shown.l);
        const oy = Math.min(a.shown.b, b.shown.b) - Math.max(a.shown.t, b.shown.t);
        if (ox < 2 || oy < 2) continue;
        out.push({
          check: 'hud-overlap',
          selector: `${describe(a.el)} ∩ ${describe(b.el)}`,
          text: shorten(`${a.text} / ${b.text}`),
          rect: {
            x: Math.round(Math.max(a.shown.l, b.shown.l)),
            y: Math.round(Math.max(a.shown.t, b.shown.t)),
            w: Math.round(ox),
            h: Math.round(oy),
          },
          severity: 'blocking',
          detail: '3D盤の上の名札・状態表示どうしが重なっている',
        });
      }
    }

    /*
     * ---- ③-c 意味の重複（同じことをする操作が2つ出ている） ----
     * 利用者要求 2026-09-20「同じようなものが2つある意味がない」。
     * 見えている押しボタンのうち、**名前が同じで見た目（タグと最初のクラス）が違う**
     * ものの組を出す。表の行に並ぶ「開く」「選択」のような**同じ部品の繰り返し**は
     * タグもクラスも同じなので落ちる。
     */
    const named = new Map<string, Info[]>();
    for (const info of infos) {
      if (info.overlay) continue;
      if (!info.el.matches(cfg.interactive)) continue;
      const name = (info.el.getAttribute('aria-label') ?? info.el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (name.length === 0 || name.length > 24) continue;
      const list = named.get(name) ?? [];
      list.push(info);
      named.set(name, list);
    }
    const shapeOf = (el: Element): string =>
      `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(/\s+/)[0] ?? ''}`;
    for (const [name, list] of named) {
      if (list.length < 2) continue;
      const shapes = new Set(list.map((info) => shapeOf(info.el)));
      if (shapes.size < 2) continue;
      const first = list[0];
      if (first === undefined) continue;
      out.push({
        check: 'duplicate',
        selector: list.map((info) => describe(info.el)).join(' / '),
        text: shorten(name),
        rect: boxOf(first.rect),
        severity: 'important',
        detail: `同じ名前の操作が ${String(list.length)} か所にある`,
      });
    }

    /* ---- ④ 変な改行（1行のはずの要素が 2 行以上） ---- */
    let wraps = 0;
    for (const info of infos) {
      if (wraps >= cfg.maxWrap) break;
      if (info.overlay || info.inViewport) continue;
      if (info.text.length === 0) continue;
      // SVG の `<text>` は折り返さない（改行は作図側が入れる）ので対象外
      if (info.el.namespaceURI === 'http://www.w3.org/2000/svg') continue;
      if (!info.el.matches(cfg.oneLine)) continue;
      // 縦に積むことが設計の入れ物（モードカードなど）は対象外
      if (
        (info.style.display === 'flex' || info.style.display === 'inline-flex') &&
        info.style.flexDirection.startsWith('column')
      ) {
        continue;
      }
      const blockChild = Array.from(info.el.children).some((child) => {
        const display = window.getComputedStyle(child).display;
        return display === 'block' || display === 'flex' || display === 'grid';
      });
      if (blockChild) continue;
      const fontSize = Number.parseFloat(info.style.fontSize);
      const lineHeight =
        info.style.lineHeight === 'normal'
          ? fontSize * 1.2
          : Number.parseFloat(info.style.lineHeight);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) continue;
      const frame =
        Number.parseFloat(info.style.paddingTop) +
        Number.parseFloat(info.style.paddingBottom) +
        Number.parseFloat(info.style.borderTopWidth) +
        Number.parseFloat(info.style.borderBottomWidth);
      const content = info.rect.height - (Number.isFinite(frame) ? frame : 0);
      if (content < lineHeight * 1.8) continue;
      wraps += 1;
      out.push({
        check: 'wrap',
        selector: describe(info.el),
        text: shorten(info.text),
        rect: boxOf(info.rect),
        severity: 'important',
        detail: `高さ ${String(Math.round(content))}px / 行送り ${String(Math.round(lineHeight))}px`,
      });
    }

    /* ---- ④-b 語の途中での折り返し（日本語は空白が無いのでどこでも切れてしまう） ---- */
    const visibleEls = new Set(infos.filter((info) => !info.inViewport).map((info) => info.el));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null && wraps < cfg.maxWrap) {
      const value = (node.nodeValue ?? '').trim();
      const parent = node.parentElement;
      if (
        parent !== null &&
        value.length > 0 &&
        value.length <= 12 &&
        !/\s/.test(value) &&
        visibleEls.has(parent)
      ) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        if (rects.length > 1) {
          const first = rects[0];
          wraps += 1;
          out.push({
            check: 'wrap',
            selector: describe(parent),
            text: shorten(value),
            rect: first === undefined ? { x: 0, y: 0, w: 0, h: 0 } : boxOf(first),
            severity: 'important',
            detail: `語の途中で ${String(rects.length)} 行に割れている`,
          });
        }
        range.detach();
      }
      node = walker.nextNode();
    }

    /* ---- ⑤ 小さすぎる文字 ---- */
    for (const info of infos) {
      if (info.text.length === 0 || info.inViewport) continue;
      if (!Number.isFinite(info.fontPx) || info.fontPx >= cfg.minFontPx) continue;
      out.push({
        check: 'small-text',
        selector: describe(info.el),
        text: shorten(info.text),
        rect: boxOf(info.rect),
        severity: 'minor',
        detail: `画面上の文字の大きさ ${info.fontPx.toFixed(1)}px`,
      });
    }

    /* ---- ⑤-b 小さすぎるクリック対象 ---- */
    for (const info of infos) {
      if (info.inViewport) continue;
      if (!info.el.matches(cfg.interactive)) continue;
      if (info.rect.width >= cfg.minTargetPx && info.rect.height >= cfg.minTargetPx) continue;
      out.push({
        check: 'small-target',
        selector: describe(info.el),
        text: shorten(info.text),
        rect: boxOf(info.rect),
        severity: 'minor',
        detail: `${String(Math.round(info.rect.width))}x${String(Math.round(info.rect.height))}px`,
      });
    }

    return out;
  }, AUDIT_CONFIG);
}

/**
 * Tab でフォーカスを回して、押せるものにフォーカスリング（outline か box-shadow）が
 * 付くことを見る。`:focus-visible` はキーボード操作でしか立たないので、本物の Tab を送る。
 */
async function auditFocus(page: Page, screen: string, size: string): Promise<Finding[]> {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body || el === document.documentElement) return null;
      const style = window.getComputedStyle(el);
      const outlined = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      const shadowed = style.boxShadow !== 'none' && style.boxShadow.length > 0;
      const testId = el.getAttribute('data-testid');
      const rect = el.getBoundingClientRect();
      return {
        ok: outlined || shadowed,
        selector:
          testId !== null && testId.length > 0
            ? `[data-testid="${testId}"]`
            : el.tagName.toLowerCase(),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 44),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      };
    });
    if (info === null) break;
    if (info.ok || seen.has(info.selector)) continue;
    seen.add(info.selector);
    out.push({
      screen,
      size,
      check: 'focus',
      selector: info.selector,
      text: info.text,
      rect: info.rect,
      severity: 'minor',
      detail: 'Tab で選んでも outline も box-shadow も付かない',
    });
  }
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  return out;
}

/* ------------------------------------------------------------------------- *
 * 1 つの停留点を 3 サイズで見る
 * ------------------------------------------------------------------------- */

interface StopOptions {
  /** 3D キャンバスを含む画面か（描画の1フレーム目を待ち、単色でないことも見る）。 */
  three?: boolean;
  /** Tab でフォーカスリングも見るか（Tab が画面の状態を変えない画面だけ true にする）。 */
  focus?: boolean;
}

/**
 * `screen` は `<画面>-<状態>`（例 `modeB-board`）。PNG は
 * `ui-<画面>-<状態>-<幅>x<高さ>.png` で `OJT_SHOT_DIR` に残る。
 */
async function stop(
  app: ElectronApplication,
  page: Page,
  screen: string,
  options: StopOptions = {},
): Promise<void> {
  const three = options.three === true;
  for (const size of SIZES) {
    const key = sizeKey(size);
    await setBounds(app, size);
    // レイアウトが落ち着くのを待つ（3D は `frameloop="demand"` なので 1 フレーム目が遅れて届く）
    await page.waitForTimeout(400);
    if (three) {
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
      await page.waitForTimeout(2200);
    }

    let canvasArg: { rect: Rect; cssWidth: number } | null = null;
    if (three) {
      const measured = await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="viewport"] canvas');
        if (canvas === null) return null;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
          cssWidth: window.innerWidth,
        };
      });
      canvasArg = measured;
    }

    const stats = await capture(app, `ui-${screen}-${key}`, canvasArg);
    const raw = await auditDom(page);
    const list: Finding[] = raw.map((item) => ({ ...item, screen, size: key }));
    if (stats !== null && stats.distinct <= 2 && stats.spread < 3 && canvasArg !== null) {
      list.push({
        screen,
        size: key,
        check: 'canvas',
        selector: '[data-testid="viewport"] canvas',
        text: '',
        rect: canvasArg.rect,
        severity: 'important',
        detail: `3D が単色のまま（色 ${String(stats.distinct)} 種 / 明暗差 ${String(stats.spread)}）`,
      });
    }
    record(list);
  }
  if (options.focus === true) {
    record(await auditFocus(page, screen, sizeKey(SIZES[1] ?? { width: 1440, height: 900 })));
  }
}

/* ------------------------------------------------------------------------- *
 * 画面遷移の下請け
 * ------------------------------------------------------------------------- */

async function goHome(page: Page): Promise<void> {
  if ((await page.getByTestId('mode-assemble').count()) > 0) return;
  const sessionBack = page.getByTestId('session-back');
  if ((await sessionBack.count()) > 0) {
    await sessionBack.click();
  } else {
    const toList = page.getByRole('button', { name: '課題一覧へ', exact: true });
    if ((await toList.count()) > 0) await toList.first().click();
  }
  const listBack = page.getByRole('button', { name: 'ホームへ戻る', exact: true });
  await expect(listBack).toBeVisible();
  await listBack.click();
  await expect(page.getByTestId('mode-assemble')).toBeVisible();
}

async function openProblem(page: Page, modeTestId: string, problemId: string): Promise<void> {
  await goHome(page);
  await page.getByTestId(modeTestId).click();
  await expect(page.getByTestId('problem-table')).toBeVisible();
  await expect(page.getByTestId(`open-${problemId}`)).toBeVisible();
  await page.getByTestId(`open-${problemId}`).click();
}

async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), { timeout: 30_000 })
    .toBe(1);
  await page.waitForTimeout(1500);
}

async function canvasBox(page: Page): Promise<CanvasBox> {
  const box = await page.locator('[data-testid="viewport"] canvas').boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/** ソケット S1 の本体中央（3Dで押すと部品カードが開く）。`smoke.spec.ts` と同じ点。 */
function socketEdgePoint(): { x: number; y: number; z: number } {
  const socket = JIPM_BOARD.sockets[0];
  if (socket === undefined) throw new Error('ソケットが定義されていません');
  return {
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: 9,
  };
}

async function clickTerminal(page: Page, box: CanvasBox, terminal: string): Promise<void> {
  const point = terminalPoint(toTerminalId(terminal), box);
  await page.mouse.click(point.x, point.y);
}

/** ブレーカ → 電源スイッチ の順に入れる（§5.3.5）。入っていれば押さない。 */
async function powerOn(page: Page): Promise<void> {
  const breaker = page.getByTestId('power-breaker');
  if ((await breaker.getAttribute('aria-pressed')) !== 'true') await breaker.click();
  const supply = page.getByTestId('power-switch');
  if ((await supply.getAttribute('aria-pressed')) !== 'true') await supply.click();
  await expect(page.getByTestId('status-overlay')).toContainText('通電中');
}

/** 保存ダイアログを固定パスへ差し替える（`inspect.spec.ts` と同じ手法）。 */
async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, filePath);
}

/* ------------------------------------------------------------------------- *
 * ① ホーム・課題一覧・設定
 * ------------------------------------------------------------------------- */

test.describe.serial('画面品質の機械点検', () => {
  test('ホーム・課題一覧・設定', async () => {
    const { app, page } = await launch();
    try {
      await stop(app, page, 'home-default', { focus: true });

      await step('課題一覧（モードB）', async () => {
        await page.getByTestId('mode-assemble').click();
        await expect(page.getByTestId('problem-table')).toBeVisible();
        await stop(app, page, 'list-assemble', { focus: true });
      });

      for (const [label, id] of [
        ['部品点検', 'list-inspect-parts'],
        ['回路点検・修復', 'list-inspect-repair'],
        ['PLC', 'list-plc'],
      ] as ReadonlyArray<readonly [string, string]>) {
        await step(`課題一覧（${label}）`, async () => {
          await page
            .getByTestId('mode-filter')
            .getByRole('button', { name: label, exact: true })
            .click();
          await page.waitForTimeout(200);
          await stop(app, page, id);
        });
      }

      await step('課題一覧（すべて・2級）', async () => {
        await page
          .getByTestId('mode-filter')
          .getByRole('button', { name: 'すべて', exact: true })
          .click();
        await page
          .getByTestId('grade-filter')
          .getByRole('button', { name: '2級', exact: true })
          .click();
        await page.waitForTimeout(200);
        await stop(app, page, 'list-all-grade2');
      });

      await step('課題一覧（絞り込みで0件）', async () => {
        await page
          .getByTestId('mode-filter')
          .getByRole('button', { name: 'PLC', exact: true })
          .click();
        await page
          .getByTestId('grade-filter')
          .getByRole('button', { name: '1級', exact: true })
          .click();
        await page.waitForTimeout(200);
        await stop(app, page, 'list-filter-empty');
      });

      await step('設定', async () => {
        await goHome(page);
        await page.getByTestId('open-settings').click();
        await expect(page.getByTestId('about')).toBeVisible();
        await stop(app, page, 'settings-default', { focus: true });
      });

      await step('設定（通電色の上書きを有効に）', async () => {
        const auto = page.getByTestId('setting-monitor-color-auto');
        if (await auto.isChecked()) await auto.click();
        await expect(page.getByTestId('setting-monitor-color')).toBeEnabled();
        const gridAuto = page.getByTestId('setting-grid-cols-auto');
        if (await gridAuto.isChecked()) await gridAuto.click();
        await page.waitForTimeout(400);
        await stop(app, page, 'settings-override');
        // 既定へ戻す（次のテストが素の設定で走るように）
        await page.getByTestId('setting-plc-reset').click();
        await page.waitForTimeout(400);
      });
    } finally {
      await app.close();
    }
  });

  /* ----------------------------------------------------------------------- *
   * ② モードB セッション
   * ----------------------------------------------------------------------- */

  test('モードB セッション（盤・並べて・回路図・部品カード・配線中）', async () => {
    const { app, page } = await launch();
    try {
      await openProblem(page, 'mode-assemble', B_PROBLEM);
      await waitForBoard(page);
      await stop(app, page, 'modeB-board-initial', { three: true, focus: true });

      let box = await canvasBox(page);

      await step('部品カード（空）', async () => {
        const edge = boardPoint(socketEdgePoint(), box);
        await page.mouse.click(edge.x, edge.y);
        await expect(page.getByTestId('socket-card')).toBeVisible();
        await stop(app, page, 'modeB-parts-empty', { three: true });
      });

      await step('部品カード（装着済み）', async () => {
        await page.getByRole('button', { name: '装着', exact: true }).first().click();
        await expect(page.getByTestId('card-swap')).toBeVisible();
        await stop(app, page, 'modeB-parts-mounted', { three: true });
      });

      await step('部品カード（交換の一覧）', async () => {
        await page.getByTestId('card-swap').click();
        await expect(page.getByTestId('swap-cancel')).toBeVisible();
        await stop(app, page, 'modeB-parts-swap', { three: true });
        await page.getByTestId('swap-cancel').click();
      });

      await step('配線の途中（1本目の端子を選んだ状態）', async () => {
        box = await canvasBox(page);
        await clickTerminal(page, box, 'P.1');
        await expect(page.getByTestId('status-overlay')).toContainText('1本目');
        await stop(app, page, 'modeB-wire-pending', { three: true });
        await page.keyboard.press('Escape');
      });

      await step('端子リスト（キーボード配線）', async () => {
        const panel = page.getByTestId('terminal-list');
        if ((await panel.count()) === 0) {
          notes.push('terminal-list: この版には端子リストパネルが無い');
          return;
        }
        await panel.scrollIntoViewIfNeeded();
        // 役割ID（`CR1`）で絞ると一覧が出る
        await page.getByTestId('terminal-search').fill('CR1');
        await page.waitForTimeout(300);
        await stop(app, page, 'modeB-terminal-list', { three: true });
        /*
         * 盤に印字されているのは物理ID（`S1`）なので、そちらで絞ると 0 件になる。
         * 「見つかりませんでした」の1行が出るかどうかを見たいので、この状態も撮る。
         */
        await page.getByTestId('terminal-search').fill('S1');
        await page.waitForTimeout(300);
        await stop(app, page, 'modeB-terminal-list-empty', { three: true });
        await page.getByTestId('terminal-search').fill('');
      });

      await step('ツールバーの「…」', async () => {
        await openOverflow(page);
        await stop(app, page, 'modeB-overflow-open', { three: true });
        await closeOverflow(page);
      });

      await step('並べて表示', async () => {
        await page.getByTestId('assemble-view-split').click();
        await expect(page.getByTestId('editor-pane')).toBeVisible();
        await stop(app, page, 'modeB-view-split', { three: true });
      });

      await step('回路図表示', async () => {
        await page.getByTestId('assemble-view-schematic').click();
        await expect(page.getByTestId('editor-pane')).toBeVisible();
        await expect(page.getByTestId('viewport')).toHaveCount(0);
        await stop(app, page, 'modeB-view-schematic', { focus: true });
        await page.getByTestId('assemble-view-board').click();
        await waitForBoard(page);
      });

      await step('通電中の盤', async () => {
        await powerOn(page);
        await stop(app, page, 'modeB-powered', { three: true });
      });

      await step('2級課題の回路図ヒント', async () => {
        await openProblem(page, 'mode-assemble', B_PROBLEM_GRADE2);
        await waitForBoard(page);
        await openOverflow(page);
        await page.getByTestId('toggle-schematic').click();
        await closeOverflow(page);
        await expect(page.getByTestId('schematic-hint')).toBeVisible();
        await stop(app, page, 'modeB-schematic-hint', { three: true });
      });
    } finally {
      await app.close();
    }
  });

  /* ----------------------------------------------------------------------- *
   * ③ モードB 結果（不合格・疑わしい配線・盤で見る・合格）
   * ----------------------------------------------------------------------- */

  test('モードB 結果（不合格・疑わしい配線・合格）', async () => {
    const { app, page } = await launch();
    try {
      await openProblem(page, 'mode-assemble', B_PROBLEM);
      await waitForBoard(page);
      const box = await canvasBox(page);

      // 途中までしか配線しないで判定 → 不合格＋疑わしい配線
      const edge = boardPoint(socketEdgePoint(), box);
      await page.mouse.click(edge.x, edge.y);
      await page.getByRole('button', { name: '装着', exact: true }).first().click();
      for (const [from, to] of SELF_HOLD_WIRES.slice(0, 5)) {
        await clickTerminal(page, box, from);
        await clickTerminal(page, box, to);
      }
      await page.getByTestId('judge-button').click();
      await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('verdict')).toHaveText('不合格');
      await stop(app, page, 'modeB-result-fail', { focus: true });

      await step('疑わしい配線 →「盤で見る」', async () => {
        const show = page
          .getByTestId('suspect-list')
          .getByRole('button', { name: '盤で見る', exact: true })
          .first();
        if ((await show.count()) === 0) {
          notes.push('suspect-list: 「盤で見る」が出ていない');
          return;
        }
        await show.click();
        await expect(page.getByTestId('board-focus')).toBeVisible();
        await waitForBoard(page);
        await stop(app, page, 'modeB-board-focus', { three: true });
        await page.getByTestId('back-to-result').click();
        await expect(page.getByTestId('verdict')).toBeVisible();
      });

      await step('もう一度 → 模範どおり配線 → 合格', async () => {
        await page.getByRole('button', { name: 'もう一度', exact: true }).click();
        await waitForBoard(page);
        const retryBox = await canvasBox(page);
        const socket = boardPoint(socketEdgePoint(), retryBox);
        await page.mouse.click(socket.x, socket.y);
        await page.getByRole('button', { name: '装着', exact: true }).first().click();
        for (const [from, to] of SELF_HOLD_WIRES) {
          await clickTerminal(page, retryBox, from);
          await clickTerminal(page, retryBox, to);
        }
        await expect(page.getByTestId('status-overlay')).toContainText(
          `自分で張った電線 ${String(SELF_HOLD_WIRES.length)} 本（固定 ${String(FIXED_WIRES)} 本）`,
        );
        await powerOn(page);
        await page.getByTestId('judge-button').click();
        await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
        await stop(app, page, 'modeB-result-pass');
      });

      await step('チャートの拡大', async () => {
        const enlarge = page.getByTestId('chart-enlarge-button');
        if ((await enlarge.count()) === 0) return;
        await enlarge.first().click();
        await expect(page.getByTestId('chart-modal')).toBeVisible();
        await stop(app, page, 'modeB-chart-modal');
        await page.keyboard.press('Escape');
      });
    } finally {
      await app.close();
    }
  });

  /* ----------------------------------------------------------------------- *
   * ④ モードC1 部品点検
   * ----------------------------------------------------------------------- */

  test('モードC1 部品点検（テスター・判定表・マークシート・危険操作・結果）', async () => {
    const { app, page } = await launch();
    try {
      await openProblem(page, 'mode-inspect-parts', C1_PROBLEM);
      await expect(page.getByTestId('check-tray')).toBeVisible();
      await waitForBoard(page);
      await stop(app, page, 'modeC1-initial', { three: true, focus: true });

      await step('部品を挿してテスターで測る', async () => {
        const plug = page.locator('[data-testid^="plug-"]').first();
        await plug.click();
        await expect(page.getByTestId('status-overlay')).toContainText('点検中');
        await page.getByRole('button', { name: 'Ω', exact: true }).click();
        await page.getByTestId('probe-target-coil').click();
        await page.waitForTimeout(900);
        await stop(app, page, 'modeC1-tester', { three: true });
      });

      await step('判定表ヘルプを開く', async () => {
        const help = page.getByTestId('diagnosis-help');
        await help.scrollIntoViewIfNeeded();
        await help.getByRole('group').or(help.locator('summary')).first().click();
        await expect(page.getByTestId('diagnosis-table')).toBeVisible();
        await stop(app, page, 'modeC1-diagnosis-help');
      });

      await step('マークシート', async () => {
        const sheet = page.getByTestId('mark-sheet');
        await sheet.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await stop(app, page, 'modeC1-mark-sheet');
      });

      await step('通電中のΩレンジ（危険操作の帯）', async () => {
        await powerOn(page);
        // すでにΩを選んでいると押し直しても変化イベントが出ないので、いったん OFF へ落とす
        await page.getByRole('button', { name: 'OFF', exact: true }).click();
        await page.getByRole('button', { name: 'Ω', exact: true }).click();
        await page.getByTestId('probe-target-coil').click();
        // 帯は6秒で自動的に畳むので、出なくても撮るところまでは進む
        await page
          .getByTestId('hazard-banner')
          .waitFor({ state: 'visible', timeout: 8000 })
          .catch(() => notes.push('modeC1-hazard: 危険操作の帯が出なかった'));
        await stop(app, page, 'modeC1-hazard', { three: true });
      });

      await step('判定 → 結果', async () => {
        await page.getByTestId('judge-button').click();
        await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
        await stop(app, page, 'modeC1-result', { focus: true });
      });
    } finally {
      await app.close();
    }
  });

  /* ----------------------------------------------------------------------- *
   * ⑤ モードC2 回路点検・修復
   * ----------------------------------------------------------------------- */

  test('モードC2 回路点検・修復（指摘・ポップオーバー・修復・回路図・結果）', async () => {
    const { app, page } = await launch();
    try {
      await openProblem(page, 'mode-inspect-repair', C2_PROBLEM);
      await expect(page.getByTestId('report-panel')).toBeVisible();
      await waitForBoard(page);
      await stop(app, page, 'modeC2-initial', { three: true, focus: true });

      const box = await canvasBox(page);

      await step('指摘モードのポップオーバー', async () => {
        await page.getByTestId('tool-report').click();
        await clickTerminal(page, box, 'S1.9');
        await expect(page.getByTestId('report-popover')).toBeVisible();
        await stop(app, page, 'modeC2-report-popover', { three: true });
      });

      await step('指摘を1件積む', async () => {
        const kind = page.locator('[data-testid^="report-kind-"]').first();
        if ((await kind.count()) === 0) {
          await page.getByTestId('report-cancel').click();
          return;
        }
        await kind.click();
        await expect(page.getByTestId('report-count')).toHaveText('1');
        await stop(app, page, 'modeC2-report-list', { three: true });
      });

      await step('白線で修復（修復パネル）', async () => {
        await page.getByRole('button', { name: '白', exact: true }).click();
        await clickTerminal(page, box, 'S1.9');
        await clickTerminal(page, box, 'S1.5');
        await page.getByTestId('repair-panel').scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await stop(app, page, 'modeC2-repair-panel', { three: true });
      });

      await step('回路図ヒント（2級は開閉できる）', async () => {
        await openOverflow(page);
        const toggle = page.getByTestId('toggle-schematic');
        if ((await toggle.count()) === 0) {
          await closeOverflow(page);
          notes.push('modeC2-schematic: この課題には回路図の開閉ボタンが無い');
          return;
        }
        await toggle.click();
        await closeOverflow(page);
        await expect(page.getByTestId('schematic-svg')).toBeVisible();
        await stop(app, page, 'modeC2-schematic', { three: true });
      });

      await step('判定 → 結果', async () => {
        await page.getByTestId('judge-button').click();
        await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
        await stop(app, page, 'modeC2-result', { focus: true });
      });
    } finally {
      await app.close();
    }
  });

  /* ----------------------------------------------------------------------- *
   * ⑥ モードD（4メーカー）
   * ----------------------------------------------------------------------- */

  /** 設定画面で既定メーカーを選ぶ（`plc-vendors.spec.ts` と同じ道筋。決定表#21）。 */
  async function setVendor(page: Page, vendor: string): Promise<void> {
    await goHome(page);
    await page.getByTestId('open-settings').click();
    const select = page.getByTestId('setting-vendor');
    await expect(select).toBeVisible();
    if ((await select.inputValue()) !== vendor) {
      const saved = page.getByTestId('toast').filter({ hasText: '設定を保存しました' });
      await expect(saved).toHaveCount(0);
      await select.selectOption(vendor);
      await expect(saved).toHaveCount(1);
    }
    await expect(select).toHaveValue(vendor);
    await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
    await expect(page.getByTestId('mode-plc')).toBeVisible();
  }

  /** ラダーエディタにキーを送る。 */
  async function ladderKey(page: Page, name: string): Promise<void> {
    await page.getByTestId('ladder-editor').press(name);
  }

  /**
   * その方言の「a接点」「コイル」のキーを**キー割当表から読む**。
   * CX-Programmer風は `C` / `O`、GX Works3風は `F5` / `F7` と割当が違うので、
   * 書き下すとメーカーを足すたびに落ちる（`plc-dialects` の `SHORTCUTS`）。
   */
  async function ladderKeys(page: Page): Promise<readonly [string, string]> {
    const contact = await page
      .getByTestId('shortcut-contact-no')
      .locator('td')
      .first()
      .textContent();
    const coil = await page.getByTestId('shortcut-coil').locator('td').first().textContent();
    if (contact === null || coil === null) throw new Error('キー割当表を読めません');
    return [contact.trim(), coil.trim()];
  }

  async function commitDevice(page: Page, text: string): Promise<void> {
    await expect(page.getByTestId('device-input')).toBeVisible();
    await page.getByTestId('device-text').fill(text);
    await page.getByTestId('device-commit').click();
    await expect(page.getByTestId('device-input')).toHaveCount(0);
  }

  /**
   * いちばん小さいラダーに使うデバイス名を **I/O割付表から読む**。
   * 綴りはメーカーごとに違う（`X10` / `0.08` / `1X010` / `000000`）ので、書き下すと
   * 機種を足すたびに落ちる。割付表の1行目は `profile.formatDevice()` が出した
   * 「そのメーカーの綴り」そのものなので、ここから引けば4社とも同じ手順で組める。
   */
  async function ioDevices(page: Page): Promise<readonly [string, string]> {
    const contact = await page.getByTestId('io-input-0').locator('td').first().textContent();
    const coil = await page.getByTestId('io-output-0').locator('td').first().textContent();
    if (contact === null || coil === null) throw new Error('I/O割付表からデバイス名を読めません');
    return [contact.trim(), coil.trim()];
  }

  for (const vendor of ['mitsubishi', 'omron', 'jtekt', 'sharp'] as const) {
    test(`モードD（${vendor}）`, async () => {
      const { app, page } = await launch();
      const ilPath = join(AUDIT_DIR, `il-${vendor}.txt`);
      try {
        await setVendor(page, vendor);
        await page.getByTestId('mode-plc').click();
        await expect(page.getByTestId('problem-table')).toBeVisible();
        await page.getByTestId(`open-${D_PROBLEM}`).click();
        await expect(page.getByTestId('plc-session')).toBeVisible();
        await page.waitForTimeout(800);
        await stop(app, page, `modeD-${vendor}-ladder`, { focus: true });

        await step(`modeD-${vendor}-notation`, async () => {
          await page.getByTestId('toolbar-notation').click();
          await expect(page.getByTestId('notation-dialog')).toBeVisible();
          await stop(app, page, `modeD-${vendor}-notation`);
          const close = page.getByTestId('notation-cancel').or(page.getByTestId('notation-close'));
          await close.first().click();
          await expect(page.getByTestId('notation-dialog')).toHaveCount(0);
        });

        let devices: readonly [string, string] = ['X10', 'Y0'];
        let keys: readonly [string, string] = ['F5', 'F7'];
        await step(`modeD-${vendor}-ladder-written`, async () => {
          devices = await ioDevices(page);
          keys = await ladderKeys(page);
          await page.getByTestId('cell-n1:0:0').click();
          await ladderKey(page, keys[0]);
          await commitDevice(page, devices[0]);
          await page.getByTestId(`cell-n1:0:${String(COIL_COL)}`).click();
          await ladderKey(page, keys[1]);
          await commitDevice(page, devices[1]);
          const convert = page.getByTestId('toolbar-convert');
          if ((await convert.count()) > 0) await convert.first().click();
          await page.waitForTimeout(800);
          await stop(app, page, `modeD-${vendor}-output`);
        });

        await step(`modeD-${vendor}-monitor`, async () => {
          // UI監査バッチD（`340b2d9`）で RUN はツールバーの1つだけになった
          await page.getByTestId('toolbar-plc-run').first().click();
          await page.getByTestId('toolbar-monitor-start').first().click();
          await expect(page.getByTestId('monitor-scan')).toBeVisible({ timeout: 40_000 });
          await stop(app, page, `modeD-${vendor}-monitor-run`);
          const stopMonitor = page.getByTestId('toolbar-monitor-stop');
          if ((await stopMonitor.count()) > 0) await stopMonitor.first().click();
          // 書込みモードへ戻す（キーは方言で違うのでツールバーのボタンで押す）
          const writeMode = page.getByTestId('toolbar-write-mode');
          if ((await writeMode.count()) > 0) {
            await writeMode.first().click();
            await expect(page.getByTestId('plc-ladder-mode')).toContainText('書込');
          }
        });

        await step(`modeD-${vendor}-il-toast`, async () => {
          await stubSaveDialog(app, ilPath);
          await page.getByTestId('export-il').click();
          await expect(
            page.getByTestId('toast').filter({ hasText: '命令語リストを保存しました' }),
          ).toBeVisible({ timeout: 20_000 });
          await stop(app, page, `modeD-${vendor}-il-toast`);
        });

        await step(`modeD-${vendor}-split`, async () => {
          await page.getByTestId('view-split').click();
          await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'split');
          await waitForBoard(page);
          await stop(app, page, `modeD-${vendor}-split`, { three: true });
        });

        await step(`modeD-${vendor}-board`, async () => {
          await page.getByTestId('view-board').click();
          await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'board');
          await waitForBoard(page);
          await stop(app, page, `modeD-${vendor}-board`, { three: true });
          await page.getByTestId('view-ladder').click();
          await page.waitForTimeout(600);
        });

        // 判定は**ラダーを壊す前**に通す（壊すと「変換」が通らず判定できない）
        if (vendor === 'mitsubishi') {
          await step('modeD-result', async () => {
            await page.getByTestId('judge-button').click();
            await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 120_000 });
            await stop(app, page, 'modeD-result', { focus: true });
            await page.getByRole('button', { name: 'もう一度', exact: true }).click();
            await expect(page.getByTestId('plc-session')).toBeVisible();
            await page.waitForTimeout(800);
            // 「もう一度」でラダーも初期状態へ戻るので、壊す前に組み直す
            await page.getByTestId('cell-n1:0:0').click();
            await ladderKey(page, keys[0]);
            await commitDevice(page, devices[0]);
          });
        }

        await step(`modeD-${vendor}-output-error`, async () => {
          await page.getByTestId('cell-n1:0:0').click();
          await ladderKey(page, 'Delete');
          await page.getByTestId('export-il').click();
          await expect(page.getByTestId('il-issues')).toBeVisible({ timeout: 20_000 });
          await stop(app, page, `modeD-${vendor}-output-error`);
        });
      } finally {
        try {
          if (!page.isClosed() && vendor !== 'mitsubishi') await setVendor(page, 'mitsubishi');
        } finally {
          await app.close();
        }
      }
    });
  }

  /* ----------------------------------------------------------------------- *
   * ⑦ 復元カード（前回の作業が残っているときだけ出る）
   * ----------------------------------------------------------------------- */

  test('起動時の復元カード', async () => {
    // 一時保存は 30 秒ごとなので、いったん課題を開いて待ち、閉じてから開き直す
    const first = await launch();
    try {
      await openProblem(first.page, 'mode-assemble', B_PROBLEM);
      await waitForBoard(first.page);
      const box = await canvasBox(first.page);
      const edge = boardPoint(socketEdgePoint(), box);
      await first.page.mouse.click(edge.x, edge.y);
      await first.page.getByRole('button', { name: '装着', exact: true }).first().click();
      // 自動保存（30秒間隔）を1回またぐ
      await first.page.waitForTimeout(33_000);
    } finally {
      await first.app.close();
    }

    const app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    const page = await app.firstWindow();
    try {
      await page.waitForLoadState('domcontentloaded');
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window === undefined) throw new Error('ウィンドウがありません');
        window.show();
        window.focus();
      });
      await page.waitForTimeout(2000);
      const restore = page.getByTestId('restore-prompt');
      if ((await restore.count()) === 0) {
        notes.push('restore-prompt: 復元カードが出なかった（一時保存が無い）');
        return;
      }
      await stop(app, page, 'restore-card', { focus: true });
      await page.getByRole('button', { name: '復元しない' }).click();
    } finally {
      await app.close();
    }
  });

  /* ----------------------------------------------------------------------- *
   * ⑧ 集計と判定
   * ----------------------------------------------------------------------- */

  test('集計', () => {
    /*
     * 溜めた指摘を集計する。`-g 集計` だけを流し直したときは `findings.json` から読む
     * （基準値を書き換えたあと、全画面を歩き直さずに判定だけを確かめられるようにする）。
     */
    if (findings.size === 0 && existsSync(FINDINGS_PATH)) {
      const saved: unknown = JSON.parse(readFileSync(FINDINGS_PATH, 'utf8'));
      if (Array.isArray(saved)) {
        for (const item of saved as Finding[]) findings.set(keyOf(item), item);
      }
    }
    const all = [...findings.values()];
    const byCheck: Record<string, number> = {};
    const bySize: Record<string, Record<string, number>> = {};
    for (const finding of all) {
      byCheck[finding.check] = (byCheck[finding.check] ?? 0) + 1;
      const row = bySize[finding.size] ?? {};
      row[finding.check] = (row[finding.check] ?? 0) + 1;
      bySize[finding.size] = row;
    }
    const blocking = all
      .filter((finding) => finding.severity === 'blocking')
      .map(
        (finding) =>
          `${finding.screen} ${finding.size} ${finding.check} ${finding.selector} ${finding.detail}`,
      );

    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(
      SUMMARY_PATH,
      JSON.stringify(
        { total: all.length, byCheck, bySize, blocking, notes, screens: screenList(all) },
        null,
        2,
      ),
      'utf8',
    );
    for (const [check, count] of Object.entries(byCheck)) {
      // 基準値を下げるときはこの行をそのまま `BASELINE` へ書き写す
      console.log(`check=${check} total=${String(count)}`);
    }
    for (const note of notes) console.log(`note: ${note}`);

    console.log(`check=blocking total=${String(blocking.length)}`);
    for (const line of blocking.slice(0, 20)) console.log(`  blocking: ${line}`);
    // ① はみ出し・文字切れ・操作要素どうしの重なり・3D上の重なりは 0 件が目標
    expect
      .soft(blocking.length, `致命的な画面崩れが増えた:\n${blocking.slice(0, 20).join('\n')}`)
      .toBeLessThanOrEqual(BLOCKING_BASELINE);
    // ② そのほかは基準値以下（悪化させない）
    for (const [check, limit] of Object.entries(BASELINE)) {
      expect.soft(byCheck[check] ?? 0, `${check} の件数が基準を超えた`).toBeLessThanOrEqual(limit);
    }
    // ③ 歩けなかった状態が増えていないこと（増えると網に穴が開く）
    expect
      .soft(notes.length, `歩けなかった状態: ${notes.join(' / ')}`)
      .toBeLessThanOrEqual(MAX_NOTES);
  });
});

/** 集計に「どの画面を何サイズ見たか」を残す。 */
function screenList(all: readonly Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const finding of all) out[finding.screen] = (out[finding.screen] ?? 0) + 1;
  return out;
}
