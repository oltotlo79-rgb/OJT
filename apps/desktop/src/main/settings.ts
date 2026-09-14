import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/ipc.js';

/**
 * 設定の永続化。設計仕様 §12.1 / §4.3。
 * `app.getPath('userData')/settings.json` に1ファイルで持つ。読めなければ既定値で動く。
 */

/** 設定ファイルのパス。 */
export function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** 利用者課題フォルダの既定パス。§7.8 */
export function defaultUserContentDir(): string {
  return join(app.getPath('appData'), 'OJT電気保全トレーナー', 'content');
}

function coerce(raw: unknown): AppSettings {
  const base = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return base;
  const source = raw as Record<string, unknown>;
  if (typeof source['userContentDir'] === 'string') base.userContentDir = source['userContentDir'];
  if (typeof source['soundEnabled'] === 'boolean') base.soundEnabled = source['soundEnabled'];
  if (typeof source['soundVolume'] === 'number') {
    base.soundVolume = Math.min(1, Math.max(0, source['soundVolume']));
  }
  if (typeof source['restorePrompt'] === 'boolean') base.restorePrompt = source['restorePrompt'];
  return base;
}

/** 設定を読む。未設定の利用者フォルダは既定パスに解決して返す。 */
export function readSettings(): AppSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    raw = undefined;
  }
  const settings = coerce(raw);
  if (settings.userContentDir.length === 0) settings.userContentDir = defaultUserContentDir();
  return settings;
}

/** 設定を部分更新して保存し、更新後の全体を返す。 */
export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
