import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/ipc.js';

/**
 * 設定の永続化。設計仕様 §12.1 / §4.3。
 * `app.getPath('userData')/settings.json` に1ファイルで持つ。読めなければ既定値で動く。
 *
 * `settings:set` は renderer からの入力をそのまま書かない（1D2 レビュー指摘）。
 * `sanitizePatch()` が `AppSettings` の4キーだけを型を確かめて取り込み、それ以外の
 * キー・型の違う値は黙って捨てる（renderer は信用しない。§4.3）。保存も `work-files.ts` と
 * 同じ一時ファイル→rename にする（書込の途中でアプリが落ちても本体が壊れた内容で残らない）。
 */

/** 設定ファイルのパス。 */
export function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** 利用者課題フォルダの既定パス。§7.8 */
export function defaultUserContentDir(): string {
  return join(app.getPath('appData'), 'OJT電気保全トレーナー', 'content');
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
  return next;
}

/** 一時ファイル（`<target>.tmp`）→rename でアトミックに書く。`work-files.ts` と同じ理由。 */
function writeFileAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, target);
}

/** 設定を読む。未設定の利用者フォルダは既定パスに解決して返す。 */
export function readSettings(): AppSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    raw = undefined;
  }
  const settings = sanitizePatch(DEFAULT_SETTINGS, raw);
  if (settings.userContentDir.length === 0) settings.userContentDir = defaultUserContentDir();
  return settings;
}

/**
 * 設定を部分更新して保存し、更新後の全体を返す。
 * `patch` は renderer からの生入力（`unknown`）でよい。`sanitizePatch()` が検証する。
 */
export function writeSettings(patch: unknown): AppSettings {
  const next = sanitizePatch(readSettings(), patch);
  writeFileAtomic(settingsPath(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
