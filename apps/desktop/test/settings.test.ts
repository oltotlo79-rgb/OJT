import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const { settingsPath, defaultUserContentDir, readSettings, readSettingsResponse, writeSettings } =
  await import('../src/main/settings.js');
const { MSG } = await import('../src/shared/messages.js');

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

describe('BOM と壊れたファイル（1D2-a のレビュー指摘）', () => {
  it('メモ帳が付ける UTF-8 BOM があっても設定を読める', () => {
    const body = JSON.stringify({ ...DEFAULT_SETTINGS, soundVolume: 0.25, soundEnabled: false });
    const withBom = String.fromCharCode(0xfeff) + body;
    writeFileSync(settingsPath(), withBom, 'utf8');

    const settings = readSettings();
    expect(settings.soundVolume).toBe(0.25);
    expect(settings.soundEnabled).toBe(false);
    // BOM 付きは「壊れている」ではないので警告も出さない
    expect(readSettingsResponse().warning).toBeUndefined();
  });

  it('壊れたファイルは既定値で動き、settings:get に警告を添える', () => {
    writeFileSync(settingsPath(), '{ not json', 'utf8');
    const response = readSettingsResponse();
    expect(response.soundEnabled).toBe(DEFAULT_SETTINGS.soundEnabled);
    expect(response.warning).toBe(MSG.settings.corrupt);
  });

  it('ファイルが無いだけなら警告は出さない', () => {
    expect(readSettingsResponse().warning).toBeUndefined();
  });

  it('壊れたファイルを上書きする前に控えを残す', () => {
    writeFileSync(settingsPath(), '{ 壊れた設定', 'utf8');

    writeSettings({ soundEnabled: false });

    const left = readdirSync(electron.dir);
    const backup = left.find((name) => name.startsWith('settings.corrupt-'));
    expect(backup).toBeDefined();
    if (backup === undefined) return;
    expect(readFileSync(join(electron.dir, backup), 'utf8')).toBe('{ 壊れた設定');
    // 本体は正しい設定になり、以後は警告も出ない
    expect(onDisk()['soundEnabled']).toBe(false);
    expect(readSettingsResponse().warning).toBeUndefined();
  });

  it('壊れていないファイルの保存では控えを作らない', () => {
    writeSettings({ soundEnabled: false });
    writeSettings({ soundVolume: 0.2 });
    expect(readdirSync(electron.dir)).toEqual(['settings.json']);
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
      uiScale: 1,
      contrast: 'normal',
      userContentDir: 'C:/problems',
      soundEnabled: false,
      soundVolume: 0.25,
      restorePrompt: false,
      defaultVendor: DEFAULT_SETTINGS.defaultVendor,
      ladderGridCols: DEFAULT_SETTINGS.ladderGridCols,
      monitorColor: DEFAULT_SETTINGS.monitorColor,
      monitorColorMigrated: true,
    });
    expect(readSettings()).toEqual(saved);
  });

  it('未知のキーはホワイトリストで落とし、ファイルにも書かれない', () => {
    const saved = writeSettings({ soundEnabled: false, evilKey: 'payload' });
    expect((saved as unknown as Record<string, unknown>)['evilKey']).toBeUndefined();
    const raw = onDisk();
    expect(raw['evilKey']).toBeUndefined();
    expect(Object.keys(raw).sort()).toEqual(
      [
        'uiScale',
        'contrast',
        'defaultVendor',
        'ladderGridCols',
        'monitorColor',
        'monitorColorMigrated',
        'restorePrompt',
        'soundEnabled',
        'soundVolume',
        'userContentDir',
      ].sort(),
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

  it('userContentDir に相対パス／10万文字を渡すと拒否され既定が保たれること（DM-3）', () => {
    const before = writeSettings({}).userContentDir;
    expect(writeSettings({ userContentDir: 'relative/path' }).userContentDir).toBe(before);
    expect(writeSettings({ userContentDir: 'あ'.repeat(100_000) }).userContentDir).toBe(before);
    // 絶対パスかつ MAX_PATH（260）以内なら通る
    const ok = join(electron.dir, 'problems');
    expect(writeSettings({ userContentDir: ok }).userContentDir).toBe(ok);
    // 絶対パスでも長すぎれば拒否する
    const tooLong = join(electron.dir, 'x'.repeat(300));
    expect(writeSettings({ userContentDir: tooLong }).userContentDir).toBe(ok);
    // 空文字は「既定に戻す」なので通る
    expect(writeSettings({ userContentDir: '' }).userContentDir).toBe('');
  });

  it('defaults and clamps the PLC settings (§10.6 / Plan 4B 決定表#8)', () => {
    expect(DEFAULT_SETTINGS.defaultVendor).toBe('mitsubishi');
    // 0 と '' は「メーカーの既定に従う」（Plan 4B 決定表#8）
    expect(DEFAULT_SETTINGS.ladderGridCols).toBe(0);
    expect(DEFAULT_SETTINGS.monitorColor).toBe('');
    // `main/settings.ts` は正規化を単体の `normalizeSettings()` としては公開していない
    // （`sanitizePatch(base, patch)` が非公開のまま既定値とマージする）。ここでは公開APIの
    // `writeSettings()` 経由で同じ正規化（クランプ・ホワイトリスト）を確かめる。
    expect(writeSettings({ ladderGridCols: 2 }).ladderGridCols).toBe(8);
    expect(writeSettings({ ladderGridCols: 99 }).ladderGridCols).toBe(15);
    expect(writeSettings({ ladderGridCols: 0 }).ladderGridCols).toBe(0);
    expect(writeSettings({ monitorColor: 'red' }).monitorColor).toBe('');
    expect(writeSettings({ monitorColor: '' }).monitorColor).toBe('');
    // Plan 4A Task 5（81c701a）で4方言すべてが登録され、`omron` も実装済みメーカーとして通る
    // （以前は三菱以外は弾かれ、既定値の `mitsubishi` に戻っていた。決定表#13 の前提が更新された）
    expect(writeSettings({ defaultVendor: 'omron' }).defaultVendor).toBe('omron');
    // 方言IDの形をしていない値は引き続き無視して、直前に保存された値を保つ
    expect(writeSettings({ defaultVendor: 'not-a-real-dialect' }).defaultVendor).toBe('omron');
  });
});

describe('旧い設定ファイルの移行（Plan 4B 決定表#8 / レビュー B1）', () => {
  it('turns the old Mitsubishi-blue default into "follow the skin", once', () => {
    // 旧既定（`#1E64FF`）のまま保存されていた設定ファイル（移行の印はまだ無い）
    writeFileSync(settingsPath(), JSON.stringify({ monitorColor: '#1E64FF' }), 'utf8');
    // 読み込む（＝main 側の読み手を実際に通す）と「スキンの既定色」になる
    expect(readSettings().monitorColor).toBe('');
    // 印がファイルに残るので、次からは走らない
    expect(onDisk()['monitorColorMigrated']).toBe(true);
    // 移行のあとで利用者が**改めて三菱の青を選んだ**ら、それは消さない
    expect(writeSettings({ monitorColor: '#1E64FF' }).monitorColor).toBe('#1E64FF');
    expect(readSettings().monitorColor).toBe('#1E64FF');
  });

  it('leaves a colour the trainee chose alone', () => {
    expect(writeSettings({ monitorColor: '#FF00AA' }).monitorColor).toBe('#FF00AA');
    expect(readSettings().monitorColor).toBe('#FF00AA');
  });

  /** 移行は設定ファイルがあるときだけ（新規インストールには移行すべき値が無い）。 */
  it('does not write a settings file just because it was read', () => {
    expect(readSettings().monitorColor).toBe('');
    expect(existsSync(settingsPath())).toBe(false);
  });

  /** 大文字小文字を無視して旧既定を見分ける（`toUpperCase()` で比べているので通る）。 */
  it('migrates a lowercase "#1e64ff" the same as the uppercase default', () => {
    writeFileSync(settingsPath(), JSON.stringify({ monitorColor: '#1e64ff' }), 'utf8');
    expect(readSettings().monitorColor).toBe('');
    expect(onDisk()['monitorColorMigrated']).toBe(true);
  });

  /** レビュー指摘 #11: 印の型が違う・`false` のときは移行済みと見なさず、走り直す。 */
  it('re-runs the migration when the on-disk marker is not exactly true (wrong type)', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ monitorColor: '#1E64FF', monitorColorMigrated: 'yes' }),
      'utf8',
    );
    expect(readSettings().monitorColor).toBe('');
    expect(onDisk()['monitorColorMigrated']).toBe(true);
  });

  it('re-runs the migration when the on-disk marker is false', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ monitorColor: '#1E64FF', monitorColorMigrated: false }),
      'utf8',
    );
    expect(readSettings().monitorColor).toBe('');
    expect(onDisk()['monitorColorMigrated']).toBe(true);
  });

  /** レビュー指摘 #11: 壊れたファイルは移行もせず、控えを取る前に書き戻しもしない。 */
  it('does not migrate or rewrite a corrupt settings file', () => {
    const broken = '{ 壊れた設定, "monitorColor": "#1E64FF"';
    writeFileSync(settingsPath(), broken, 'utf8');
    expect(readSettings().monitorColor).toBe(DEFAULT_SETTINGS.monitorColor);
    // 読んだだけでは書き戻さない（控えを取るのは `writeSettings()` の役目）
    expect(readFileSync(settingsPath(), 'utf8')).toBe(broken);
  });

  /**
   * レビュー指摘 #5: 移行の書き戻しは `raw` に2キーだけ重ねる。丸ごと書き直すと、
   * まだファイルに無かった `userContentDir`（既定パスに解決済み）が焼き付き、
   * `raw` にあった見覚えの無いキー（利用者が手で足した項目など）も消えてしまっていた。
   */
  it('keeps an unknown hand-added key through the migration write-back, and does not bake userContentDir', () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ monitorColor: '#1E64FF', someHandAddedKey: 'keep-me' }),
      'utf8',
    );
    readSettings();
    const raw = onDisk();
    expect(raw['someHandAddedKey']).toBe('keep-me');
    expect(raw['monitorColor']).toBe('');
    expect(raw['monitorColorMigrated']).toBe(true);
    // 元のファイルに無かったキーは書き戻しでも増やさない
    expect(raw['userContentDir']).toBeUndefined();
  });

  /**
   * レビュー指摘 #4: `sanitizePatch()` が `monitorColorMigrated: false` をそのまま通すと、
   * renderer からの保存のたびに一度きりの移行が再武装され、利用者が改めて選び直した
   * `#1E64FF` が次の読込で黙って消える。`writeSettings()`（= `sanitizePatch()` 経由）では
   * `true` しか取り込まないことを確かめる。
   */
  it('ignores monitorColorMigrated:false from a patch instead of re-arming the one-shot migration', () => {
    // 移行を一度走らせておく
    writeFileSync(settingsPath(), JSON.stringify({ monitorColor: '#1E64FF' }), 'utf8');
    expect(readSettings().monitorColor).toBe('');
    expect(onDisk()['monitorColorMigrated']).toBe(true);
    // 利用者が改めて三菱の青を選ぶ
    writeSettings({ monitorColor: '#1E64FF' });
    expect(onDisk()['monitorColor']).toBe('#1E64FF');
    // renderer から（バグ・改ざんのいずれでも）false が来ても、印は消えない
    const saved = writeSettings({ monitorColorMigrated: false });
    expect(saved.monitorColorMigrated).toBe(true);
    expect(onDisk()['monitorColorMigrated']).toBe(true);
    // 次回の読込でも青のまま。移行が再武装されて勝手に消されることはない
    expect(readSettings().monitorColor).toBe('#1E64FF');
  });
});

describe('表示設定の保存境界', () => {
  it.each([0.9, 1, 1.15, 1.3] as const)('倍率%sは保存して再読込できる', (uiScale) => {
    writeSettings({ uiScale, contrast: 'high' });
    expect(readSettings().uiScale).toBe(uiScale);
    expect(onDisk()['contrast']).toBe('high');
  });
  it('未知の倍率・型・見やすさは直前の値を保つ', () => {
    writeSettings({ uiScale: 1.15, contrast: 'high' });
    for (const uiScale of [0, -1, 10, 1.14, '1.3', null]) {
      writeSettings({ uiScale, contrast: 'custom' });
      expect(readSettings().uiScale).toBe(1.15);
      expect(readSettings().contrast).toBe('high');
    }
  });
});
