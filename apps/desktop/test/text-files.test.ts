import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const showSaveDialog = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) as unknown },
}));

let dir = '';
const { MAX_TEXT_BYTES, saveTextFile } = await import('../src/main/text-files.js');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ojt-text-'));
  showSaveDialog.mockReset();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('saveTextFile（§10.7 / §13 #7）', () => {
  it('writes the text as UTF-8 exactly as given (CRLF は 4A が付けている)', async () => {
    const target = join(dir, 'il.txt');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const result = await saveTextFile(undefined, {
      defaultFileName: 'd-001_命令語リスト.txt',
      text: '0000  LD        X0\r\n0001  OUT       Y0\r\n',
    });
    expect(result).toEqual({ ok: true, path: target });
    expect(readFileSync(target, 'utf8')).toBe('0000  LD        X0\r\n0001  OUT       Y0\r\n');
    // BOM は付けない（§10.7 は UTF-8 とだけ定める）
    expect(readFileSync(target)[0]).not.toBe(0xef);
  });

  it('reports a cancel without writing anything', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    const result = await saveTextFile(undefined, { defaultFileName: 'a.txt', text: 'x' });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ canceled: true });
  });

  it('refuses a text that is too large (§13 #7 / 本プランの決定)', async () => {
    const result = await saveTextFile(undefined, {
      defaultFileName: 'a.txt',
      text: 'x'.repeat(MAX_TEXT_BYTES + 1),
    });
    expect(result.ok).toBe(false);
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('strips path separators from the suggested file name', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    await saveTextFile(undefined, { defaultFileName: '../../evil/name.txt', text: 'x' });
    const options = showSaveDialog.mock.calls[0]?.[0] as { defaultPath?: string } | undefined;
    expect(options?.defaultPath).not.toContain('..');
    expect(options?.defaultPath).toContain('name.txt');
  });
});
