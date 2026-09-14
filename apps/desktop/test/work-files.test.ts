import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autosavePath,
  clearAutosave,
  loadWorkFile,
  MAX_WORK_FILE_BYTES,
  MAX_WORK_FILE_WIRES,
  parseWorkFile,
  saveWorkFile,
} from '../src/main/work-files.js';
import { WORK_FILE_FORMAT_VERSION, type WorkFile } from '../src/shared/ipc.js';
import { MSG } from '../src/shared/messages.js';

/**
 * 作業ファイルの保存／読込テスト。設計仕様 §12.3 / §13 #7 / §13 #8。
 *
 * `electron` は Electron ランタイム外（Vitest）では動かないので、`app.getPath()` と
 * `dialog.show*Dialog()` だけを差し替える。`app.getPath('userData')` は実在する一時フォルダを
 * 返すので、保存・読込は本物の `fs` に対して行われる。
 *
 * アトミック書込（一時ファイル→rename）は `node:fs` を差し替えず、本物のファイルシステムに
 * 対する観測可能な違いで確かめる（`vi.spyOn()` は Vitest の ESM でモジュール名前空間が
 * 凍結されていて使えない）。あらかじめ `<target>.tmp` にゴミを置いておき、保存後に
 * それが消えて（rename で本体に化けて）いれば一時ファイル経由の書込を通ったとわかる。
 * 直接 `writeFileSync(target, ...)` するだけの実装なら、このゴミファイルには触れないまま残る。
 */

const electron = vi.hoisted(() => ({
  userDataDir: '',
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData' || name === 'documents') return electron.userDataDir;
      throw new Error(`想定外の getPath(${name})`);
    },
  },
  dialog: {
    showSaveDialog: electron.showSaveDialog,
    showOpenDialog: electron.showOpenDialog,
  },
}));

function sampleFile(overrides: Partial<WorkFile> = {}): WorkFile {
  return {
    formatVersion: WORK_FILE_FORMAT_VERSION,
    problemId: 'b-001',
    session: { wires: [], socketRoles: {} },
    elapsedMs: 1234,
    hazardCount: 2,
    savedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

const created: string[] = [];

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ojt-workfiles-'));
  created.push(dir);
  electron.userDataDir = dir;
  electron.showSaveDialog.mockReset();
  electron.showOpenDialog.mockReset();
});

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('parseWorkFile（§13 #8: 未知のバージョンは読み込まない）', () => {
  it('妥当な作業ファイルを読める', () => {
    const result = parseWorkFile(sampleFile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.problemId).toBe('b-001');
    expect(result.file.hazardCount).toBe(2);
  });

  it('formatVersion が無ければ拒否する', () => {
    const { formatVersion: _drop, ...rest } = sampleFile();
    void _drop;
    expect(parseWorkFile(rest).ok).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])('formatVersion %s（正の整数でない）は拒否する', (bad) => {
    const result = parseWorkFile(sampleFile({ formatVersion: bad }));
    expect(result.ok).toBe(false);
  });

  it('formatVersion が現在より新しければ拒否する', () => {
    const result = parseWorkFile(sampleFile({ formatVersion: WORK_FILE_FORMAT_VERSION + 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('新しいバージョン');
  });

  it('problemId が無ければ拒否する', () => {
    const { problemId: _drop, ...rest } = sampleFile();
    void _drop;
    expect(parseWorkFile(rest).ok).toBe(false);
  });

  it.each([null, 'not-an-object', 42, undefined])('session が %s なら拒否する', (bad) => {
    const result = parseWorkFile({ ...sampleFile(), session: bad });
    expect(result.ok).toBe(false);
  });

  it('raw がオブジェクトでなければ拒否する', () => {
    expect(parseWorkFile('nope').ok).toBe(false);
    expect(parseWorkFile(null).ok).toBe(false);
  });

  it('電線が上限を超える作業ファイルは拒否する（1D2-a: 10万本で画面が固まる）', () => {
    const wires = Array.from({ length: MAX_WORK_FILE_WIRES + 1 }, (_, i) => ({
      id: `w-${i}`,
      from: 'CR1.13',
      to: 'CR1.14',
      color: '青',
      locked: false,
      open: false,
    }));
    const result = parseWorkFile(sampleFile({ session: { wires, socketRoles: {} } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(MSG.workFile.tooManyWires);
  });

  it('上限ちょうどの本数は読める', () => {
    const wires = Array.from({ length: MAX_WORK_FILE_WIRES }, (_, i) => ({ id: `w-${i}` }));
    expect(parseWorkFile(sampleFile({ session: { wires, socketRoles: {} } })).ok).toBe(true);
  });
});

describe('saveWorkFile / loadWorkFile（一時保存。§12.3）', () => {
  it('保存してそのまま読み戻せる', async () => {
    const file = sampleFile();
    const saved = await saveWorkFile(undefined, { kind: 'autosave', file });
    expect(saved).toEqual({ ok: true, path: autosavePath() });

    const loaded = await loadWorkFile(undefined, { kind: 'autosave' });
    expect(loaded).toEqual({ ok: true, file, path: autosavePath() });
  });

  it('保存後に一時ファイルを残さない', async () => {
    await saveWorkFile(undefined, { kind: 'autosave', file: sampleFile() });
    expect(readdirSync(electron.userDataDir)).toEqual(['autosave.json']);
  });

  it('保存は一時ファイル（<target>.tmp）→rename で書く（レビュー指摘: 非アトミック書込の修正）', async () => {
    const tempPath = `${autosavePath()}.tmp`;
    writeFileSync(tempPath, 'まだ書きかけの内容', 'utf8');

    await saveWorkFile(undefined, { kind: 'autosave', file: sampleFile() });

    // 一時ファイル→rename の経路を通っていれば、ゴミの一時ファイルは本体に化けて消える
    expect(existsSync(tempPath)).toBe(false);
    expect(readdirSync(electron.userDataDir)).toEqual(['autosave.json']);
    const onDisk = JSON.parse(readFileSync(autosavePath(), 'utf8')) as WorkFile;
    expect(onDisk.problemId).toBe('b-001');
  });

  it('2回目の保存は前回の内容を完全に置き換える', async () => {
    await saveWorkFile(undefined, { kind: 'autosave', file: sampleFile({ elapsedMs: 1 }) });
    await saveWorkFile(undefined, { kind: 'autosave', file: sampleFile({ elapsedMs: 99_999 }) });
    const onDisk = JSON.parse(readFileSync(autosavePath(), 'utf8')) as WorkFile;
    expect(onDisk.elapsedMs).toBe(99_999);
    expect(readdirSync(electron.userDataDir)).toEqual(['autosave.json']);
  });

  it('discard: true は読まずに一時保存を消す', async () => {
    await saveWorkFile(undefined, { kind: 'autosave', file: sampleFile() });
    expect(existsSync(autosavePath())).toBe(true);

    const result = await loadWorkFile(undefined, { kind: 'autosave', discard: true });
    expect(result).toEqual({ ok: false, canceled: true, message: '一時保存を削除しました' });
    expect(existsSync(autosavePath())).toBe(false);
  });

  it('一時保存が無いときの読込は失敗を返す', async () => {
    const result = await loadWorkFile(undefined, { kind: 'autosave' });
    expect(result.ok).toBe(false);
  });

  it('壊れたJSONの読込は理由付きで失敗する', async () => {
    await saveWorkFile(undefined, { kind: 'autosave', file: sampleFile() });
    writeFileSync(autosavePath(), '{ not json', 'utf8');
    const result = await loadWorkFile(undefined, { kind: 'autosave' });
    expect(result.ok).toBe(false);
  });

  it('formatVersion が新しすぎる一時保存は理由付きで拒否する（§13 #8）', async () => {
    writeFileSync(
      autosavePath(),
      JSON.stringify(sampleFile({ formatVersion: WORK_FILE_FORMAT_VERSION + 1 })),
      'utf8',
    );
    const result = await loadWorkFile(undefined, { kind: 'autosave' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('新しいバージョン');
  });

  it('clearAutosave() はファイルが無くても投げない', () => {
    expect(() => {
      clearAutosave();
    }).not.toThrow();
  });
});

describe('saveWorkFile / loadWorkFile（手動。§13 #7）', () => {
  it('保存ダイアログを取り消したら保存しない', async () => {
    electron.showSaveDialog.mockResolvedValue({ canceled: true });
    const result = await saveWorkFile(undefined, { kind: 'manual', file: sampleFile() });
    expect(result).toEqual({ ok: false, canceled: true, message: '保存を取り消しました' });
  });

  it('選んだパスにアトミックに書いて読み戻せる', async () => {
    const target = join(electron.userDataDir, 'my-work.ojtw');
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const file = sampleFile();
    const saved = await saveWorkFile(undefined, { kind: 'manual', file });
    expect(saved).toEqual({ ok: true, path: target });
    expect(readdirSync(electron.userDataDir).sort()).toEqual(['my-work.ojtw']);

    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] });
    const loaded = await loadWorkFile(undefined, { kind: 'manual' });
    expect(loaded).toEqual({ ok: true, file, path: target });
  });

  it('読込ダイアログを取り消したら失敗を返す', async () => {
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await loadWorkFile(undefined, { kind: 'manual' });
    expect(result).toEqual({ ok: false, canceled: true, message: '読込を取り消しました' });
  });

  it('ウィンドウが無ければダイアログは引数1つの形で呼ぶ（1D2-a: 偽の BrowserWindow を渡さない）', async () => {
    electron.showSaveDialog.mockResolvedValue({ canceled: true });
    await saveWorkFile(undefined, { kind: 'manual', file: sampleFile() });
    const saveArgs = electron.showSaveDialog.mock.calls[0];
    expect(saveArgs).toHaveLength(1);
    expect(saveArgs?.[0]).toMatchObject({ title: MSG.workFile.saveTitle });

    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await loadWorkFile(undefined, { kind: 'manual' });
    const openArgs = electron.showOpenDialog.mock.calls[0];
    expect(openArgs).toHaveLength(1);
    expect(openArgs?.[0]).toMatchObject({ title: MSG.workFile.loadTitle });
  });

  it('ウィンドウがあれば親として渡す', async () => {
    const window = { id: 1 } as unknown as Parameters<typeof saveWorkFile>[0];
    electron.showSaveDialog.mockResolvedValue({ canceled: true });
    await saveWorkFile(window, { kind: 'manual', file: sampleFile() });
    expect(electron.showSaveDialog.mock.calls[0]).toHaveLength(2);
    expect(electron.showSaveDialog.mock.calls[0]?.[0]).toBe(window);
  });
});

describe('大きすぎる作業ファイル（1D2-a: 読む前に断る。§13 #8）', () => {
  it('上限を超えるファイルは JSON を読まずに拒否する', async () => {
    // 中身は妥当な JSON。大きさだけで断ることを確かめる
    const filler = 'あ'.repeat(MAX_WORK_FILE_BYTES);
    writeFileSync(autosavePath(), JSON.stringify(sampleFile({ savedAt: filler })), 'utf8');

    const result = await loadWorkFile(undefined, { kind: 'autosave' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(MSG.workFile.tooLarge);
  });
});
