import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import {
  IMPLEMENTED_DIALECT_IDS,
  isDialectId,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
} from '@ojt/plc-dialects';
import {
  DEFAULT_SETTINGS,
  LEGACY_MONITOR_COLOR,
  type AppSettings,
  type AppSettingsResponse,
} from '../shared/ipc.js';
import { MSG } from '../shared/messages.js';

/**
 * 設定の永続化。設計仕様 §12.1 / §4.3。
 * `app.getPath('userData')/settings.json` に1ファイルで持つ。読めなければ既定値で動く。
 *
 * `settings:set` は renderer からの入力をそのまま書かない（1D2 レビュー指摘）。
 * `sanitizePatch()` が `AppSettings` の4キーだけを型を確かめて取り込み、それ以外の
 * キー・型の違う値は黙って捨てる（renderer は信用しない。§4.3）。保存も `work-files.ts` と
 * 同じ一時ファイル→rename にする（書込の途中でアプリが落ちても本体が壊れた内容で残らない）。
 *
 * 壊れた設定ファイルは**黙って踏み潰さない**（1D2-a のレビュー指摘）。読めなかったことを
 * `settings:get` の戻りに `warning` として載せ、上書きする前に `settings.corrupt-<時刻>.json`
 * として控えを残す（手で直したい人が中身を取り戻せるように）。
 */

/** UTF-8 の BOM。メモ帳で設定を直すと付く。`JSON.parse()` は受け付けない（`loader.ts` と同じ扱い）。 */
const BOM = '\uFEFF';

/** 設定ファイルのパス。 */
export function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** 壊れた設定ファイルの控え先。時刻を入れて上書きを避ける（`:` は Windows のファイル名に使えない）。 */
export function corruptSettingsPath(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(app.getPath('userData'), `settings.corrupt-${stamp}.json`);
}

/** 利用者課題フォルダの既定パス。§7.8 */
export function defaultUserContentDir(): string {
  return join(app.getPath('appData'), '電気教育ツール', 'content');
}

/**
 * `patch` のうち `AppSettings` の4キーだけを型を確かめて `base` に重ねる（ホワイトリスト）。
 * 未知のキー・型の違う値は無視する。`base` 自体は書き換えない。
 */
function sanitizePatch(base: AppSettings, patch: unknown): AppSettings {
  const next = { ...base };
  if (typeof patch !== 'object' || patch === null) return next;
  const source = patch as Record<string, unknown>;
  if (typeof source['userContentDir'] === 'string') next.userContentDir = source['userContentDir'];
  if (typeof source['soundEnabled'] === 'boolean') next.soundEnabled = source['soundEnabled'];
  const volume = source['soundVolume'];
  if (typeof volume === 'number' && Number.isFinite(volume)) {
    next.soundVolume = Math.min(1, Math.max(0, volume));
  }
  if (typeof source['restorePrompt'] === 'boolean') next.restorePrompt = source['restorePrompt'];
  const vendor = source['defaultVendor'];
  if (
    typeof vendor === 'string' &&
    isDialectId(vendor) &&
    IMPLEMENTED_DIALECT_IDS.includes(vendor)
  ) {
    next.defaultVendor = vendor;
  }
  const gridCols = source['ladderGridCols'];
  if (typeof gridCols === 'number' && Number.isFinite(gridCols)) {
    // 0 は「メーカーの既定に従う」（Plan 4B 決定表#8）。それ以外は 8〜15 に丸める
    next.ladderGridCols =
      gridCols === 0 ? 0 : Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(gridCols)));
  }
  const monitorColor = source['monitorColor'];
  // 空文字は「スキンの既定色」（決定表#8）。**ここでは移行しない**（下の `loadSettings()` が持つ）
  if (typeof monitorColor === 'string' && /^(#[0-9a-fA-F]{6})?$/.test(monitorColor)) {
    next.monitorColor = monitorColor;
  }
  // 移行の印（renderer からも来るが、`true` を消せるだけなので害はない）
  if (typeof source['monitorColorMigrated'] === 'boolean') {
    next.monitorColorMigrated = source['monitorColorMigrated'];
  }
  return next;
}

/**
 * 旧既定（三菱の青）の通電色を「スキンの既定色」へ**一度だけ**移行する。
 * Plan 4B 決定表#8 / レビュー B1
 *
 * `sanitizePatch()` に置いてはいけない。あの関数は `settings:set` の**保存でも通る**ので、
 * 移行のあとで利用者が設定画面から改めて選び直した `#1E64FF` まで毎回消してしまう。
 * 印（`monitorColorMigrated`）を設定ファイルに残し、二度と走らせない。
 *
 * 印の有無は**設定ファイルの生の中身**で見る。`DEFAULT_SETTINGS` は印を立てた状態（新規
 * インストールには移行すべき値が無い）なので、重ねたあとの `settings` で見ると印を持たない
 * 旧いファイルまで「移行済み」に見えてしまう。
 *
 * @param settings 読み込んだ設定（移行するときはこの場で書き換える）
 * @param raw 設定ファイルの生の中身（`undefined` ならファイルが無い＝移行するものが無い）
 * @returns 印を新しく立てたら `true`（＝ファイルへ書き戻す価値がある）
 */
function migrateMonitorColor(settings: AppSettings, raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  if ((raw as Record<string, unknown>)['monitorColorMigrated'] === true) return false;
  settings.monitorColorMigrated = true;
  if (settings.monitorColor.toUpperCase() !== LEGACY_MONITOR_COLOR) return true;
  /*
   * 移行しないと、Phase 4 で OMRON・JTEKT・シャープを選んでも通電色が青のままになる
   * （`LadderGrid` の「空ならプロファイルの色」という分岐が一度も通らない。前提#24）。
   * 三菱の青を意図して選んでいた利用者も1度だけ既定へ戻るが、設定画面で選び直せる。
   */
  settings.monitorColor = '';
  return true;
}

/** 一時ファイル（`<target>.tmp`）→rename でアトミックに書く。`work-files.ts` と同じ理由。 */
function writeFileAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, target);
}

/**
 * 設定を読む。未設定の利用者フォルダは既定パスに解決して返す。
 * `corrupt` は「ファイルはあるのに読めなかった」ことを表す（ファイルが無いだけなら偽）。
 */
function loadSettings(): { settings: AppSettings; corrupt: boolean } {
  let raw: unknown;
  let corrupt = false;
  try {
    let text = readFileSync(settingsPath(), 'utf8');
    // メモ帳などが付ける BOM は落とす。残したままだと `JSON.parse()` が構文エラーにする（§7.8 と同じ）
    if (text.startsWith(BOM)) text = text.slice(BOM.length);
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
    corrupt = existsSync(settingsPath());
  }
  const settings = sanitizePatch(DEFAULT_SETTINGS, raw);
  if (settings.userContentDir.length === 0) settings.userContentDir = defaultUserContentDir();
  // 壊れたファイルには書き戻さない（`writeSettings()` が控えを取る前に踏み潰さないため）
  if (!corrupt && migrateMonitorColor(settings, raw)) {
    try {
      writeFileAtomic(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
    } catch {
      // 印を残せなくても読込は続ける（次の `writeSettings()` で残る）
    }
  }
  return { settings, corrupt };
}

/** 設定を読む。未設定の利用者フォルダは既定パスに解決して返す。 */
export function readSettings(): AppSettings {
  return loadSettings().settings;
}

/** 設定と警告（`settings:get` が返す形）。§12.1 */
export function readSettingsResponse(): AppSettingsResponse {
  const { settings, corrupt } = loadSettings();
  return corrupt ? { ...settings, warning: MSG.settings.corrupt } : settings;
}

/**
 * 設定を部分更新して保存し、更新後の全体を返す。
 * `patch` は renderer からの生入力（`unknown`）でよい。`sanitizePatch()` が検証する。
 * 元のファイルが読めなかったときは、上書きする前に控えを取る（訓練者が手で直せるように）。
 */
export function writeSettings(patch: unknown): AppSettings {
  const { settings, corrupt } = loadSettings();
  if (corrupt) {
    try {
      copyFileSync(settingsPath(), corruptSettingsPath());
    } catch {
      // 控えを取れなくても保存自体は続ける（既定値で動けることのほうが大事）
    }
  }
  const next = sanitizePatch(settings, patch);
  writeFileAtomic(settingsPath(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
