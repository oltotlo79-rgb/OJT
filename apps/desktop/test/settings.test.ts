import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc.js';

/**
 * 設定の永続化テスト。設計仕様 §12.1 / §4.3。
 *
 * レビュー指摘: `writeSettings()` が `{ ...readSettings(), ...patch }` で renderer からの
 * `patch` をそのまま重ねていたため、`AppSettings` に無いキーや型の違う値もそのまま
 * `settings.json` へ書かれてしまっていた（renderer からの入力は信用しない、という §4.3 の
 * 原則に反する）。ここでは「4キーだけがホワイトリストで通り、それ以外・型違いは無視される」
 * ことと、保存が `work-files.ts` と同じ一時ファイル→rename（アトミック）であることを確かめる。
 */

const electron = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData' || name === 'appData') return electron.dir;
      throw new Error(`想定外の getPath(${name})`);
    },
  },
}));

const { settingsPath, defaultUserContentDir, readSettings, writeSettings } =
  await import('../src/main/settings.js');

const created: string[] = [];

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ojt-settings-'));
  created.push(dir);
  electron.dir = dir;
});

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function onDisk(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>;
}

describe('readSettings（未設定は既定値）', () => {
  it('ファイルが無ければ既定値を返し、利用者フォルダは既定パスに解決する', () => {
    const settings = readSettings();
    expect(settings.soundEnabled).toBe(DEFAULT_SETTINGS.soundEnabled);
    expect(settings.soundVolume).toBe(DEFAULT_SETTINGS.soundVolume);
    expect(settings.restorePrompt).toBe(DEFAULT_SETTINGS.restorePrompt);
    expect(settings.userContentDir).toBe(defaultUserContentDir());
  });

  it('壊れたJSONでも既定値で動く', () => {
    writeFileSync(settingsPath(), '{ not json', 'utf8');
    expect(() => readSettings()).not.toThrow();
    expect(readSettings().soundEnabled).toBe(DEFAULT_SETTINGS.soundEnabled);
  });

  it('保存済みファイルの未知のキーは無視する（既存ファイルへの防御）', () => {
    writeFileSync(settingsPath(), JSON.stringify({ ...DEFAULT_SETTINGS, evil: 'payload' }), 'utf8');
    const settings = readSettings();
    expect((settings as unknown as Record<string, unknown>)['evil']).toBeUndefined();
  });
});

describe('writeSettings（レビュー指摘: renderer からの入力を信用しない）', () => {
  it('許可された4キーは保存され、読み戻せる', () => {
    const saved = writeSettings({
      userContentDir: 'C:/problems',
      soundEnabled: false,
      soundVolume: 0.25,
      restorePrompt: false,
    });
    expect(saved).toEqual({
      userContentDir: 'C:/problems',
      soundEnabled: false,
      soundVolume: 0.25,
      restorePrompt: false,
    });
    expect(readSettings()).toEqual(saved);
  });

  it('未知のキーはホワイトリストで落とし、ファイルにも書かれない', () => {
    const saved = writeSettings({ soundEnabled: false, evilKey: 'payload' });
    expect((saved as unknown as Record<string, unknown>)['evilKey']).toBeUndefined();
    const raw = onDisk();
    expect(raw['evilKey']).toBeUndefined();
    expect(Object.keys(raw).sort()).toEqual(
      ['restorePrompt', 'soundEnabled', 'soundVolume', 'userContentDir'].sort(),
    );
  });

  it('型の違う値は無視して元の値を保つ', () => {
    writeSettings({ soundEnabled: true, soundVolume: 0.4 });
    const saved = writeSettings({
      soundEnabled: 'yes',
      soundVolume: 'loud',
      userContentDir: 42,
      restorePrompt: 1,
    });
    expect(saved.soundEnabled).toBe(true);
    expect(saved.soundVolume).toBe(0.4);
    expect(saved.restorePrompt).toBe(DEFAULT_SETTINGS.restorePrompt);
  });

  it('音量は0〜1に丸める（範囲外の値も）', () => {
    expect(writeSettings({ soundVolume: 5 }).soundVolume).toBe(1);
    expect(writeSettings({ soundVolume: -3 }).soundVolume).toBe(0);
  });

  it('NaN の音量は無視する', () => {
    writeSettings({ soundVolume: 0.6 });
    const saved = writeSettings({ soundVolume: Number.NaN });
    expect(saved.soundVolume).toBe(0.6);
  });

  it('patch が配列やnull・プリミティブでも投げず、既存の値をそのまま返す', () => {
    writeSettings({ soundEnabled: false });
    expect(writeSettings(null).soundEnabled).toBe(false);
    expect(writeSettings([1, 2, 3]).soundEnabled).toBe(false);
    expect(writeSettings('not-an-object').soundEnabled).toBe(false);
  });

  it('保存は一時ファイル（<target>.tmp）→rename で書く（work-files.ts と同じアトミック書込）', () => {
    const tempPath = `${settingsPath()}.tmp`;
    writeFileSync(tempPath, 'まだ書きかけの内容', 'utf8');

    writeSettings({ soundEnabled: false });

    expect(existsSync(tempPath)).toBe(false);
    expect(onDisk()['soundEnabled']).toBe(false);
  });

  it('部分更新は他のキーを保ったまま重ねる', () => {
    writeSettings({ userContentDir: 'C:/a', soundEnabled: true, soundVolume: 0.7 });
    const saved = writeSettings({ soundEnabled: false });
    expect(saved.userContentDir).toBe('C:/a');
    expect(saved.soundVolume).toBe(0.7);
    expect(saved.soundEnabled).toBe(false);
  });
});
