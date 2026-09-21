import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dir: '',
  paths: [] as string[],
  options: [] as Record<string, unknown>[],
  dialog: vi.fn(),
  load: vi.fn(),
  print: vi.fn(),
  destroy: vi.fn(),
  requestPermission: vi.fn(),
  checkPermission: vi.fn(),
  request: vi.fn(),
  popup: vi.fn(),
  on: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      expect(name).toBe('documents');
      return state.dir;
    },
  },
  dialog: { showSaveDialog: (...args: unknown[]) => state.dialog(...args) as unknown },
  BrowserWindow: class {
    constructor(options: Record<string, unknown>) {
      state.options.push(options);
    }
    webContents = {
      session: {
        setPermissionRequestHandler: state.requestPermission,
        setPermissionCheckHandler: state.checkPermission,
        webRequest: { onBeforeRequest: state.request },
      },
      printToPDF: state.print,
      setWindowOpenHandler: state.popup,
      on: state.on,
    };
    loadFile(path: string) {
      state.paths.push(path);
      return state.load(path) as Promise<void>;
    }
    destroy = state.destroy;
    isDestroyed() {
      return false;
    }
  },
}));
const { exportResult, MAX_REPORT_BYTES, REPORT_TIMEOUT_MS } =
  await import('../src/main/result-export.js');
const request = {
  html: '<!doctype html><html><body>結果</body></html>',
  suggestedName: 'OJT-result.pdf',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.paths = [];
  state.options = [];
  state.dir = mkdtempSync(join(tmpdir(), 'ojt-result-test-'));
  state.load.mockResolvedValue(undefined);
  state.print.mockResolvedValue(Buffer.from('%PDF-1.7\nresult'));
  state.dialog.mockResolvedValue({ canceled: false, filePath: join(state.dir, 'result.pdf') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(state.dir, { recursive: true, force: true });
});

describe('結果の明示的な書き出し', () => {
  it('キャンセルでは窓もファイルも作らず、毎回OSのドキュメントを使う', async () => {
    state.dialog.mockResolvedValue({ canceled: true });
    expect(await exportResult(undefined, request)).toEqual({ ok: true, canceled: true });
    expect(state.options).toHaveLength(0);
    expect(readdirSync(state.dir)).toEqual([]);
    expect(state.dialog.mock.calls[0]?.[0]).toMatchObject({
      defaultPath: join(state.dir, request.suggestedName),
    });
  });
  it.each([
    null,
    1,
    {},
    { ...request, html: 3 },
    { ...request, suggestedName: '../x.pdf' },
    { ...request, suggestedName: 'C:\\x.pdf' },
    { ...request, suggestedName: 'NUL.pdf' },
    { ...request, suggestedName: '' },
  ])('不正な要求 %j はダイアログより前で拒否', async (raw) => {
    expect(await exportResult(undefined, raw)).toMatchObject({ ok: false });
    expect(state.dialog).not.toHaveBeenCalled();
  });
  it('上限はUTF-8バイト数で検査する', async () => {
    expect(
      await exportResult(undefined, {
        ...request,
        html: 'あ'.repeat(Math.ceil(MAX_REPORT_BYTES / 3)),
      }),
    ).toMatchObject({ ok: false });
    expect(state.dialog).not.toHaveBeenCalled();
  });
  it('HTMLは先頭に制限付きCSPを付け、PDF窓を開かない', async () => {
    const target = join(state.dir, 'report.HTML');
    state.dialog.mockResolvedValue({ canceled: false, filePath: target });
    expect(await exportResult(undefined, request)).toEqual({ ok: true, canceled: false });
    const written = readFileSync(target, 'utf8');
    expect(written.indexOf("script-src 'none'")).toBeLessThan(written.indexOf('<body>'));
    expect(written).toContain('結果');
    expect(state.options).toHaveLength(0);
    expect(readdirSync(state.dir)).toEqual(['report.HTML']);
  });
  it('PDFは隔離した窓で印刷し、窓と一時フォルダを終了時に消す', async () => {
    expect(await exportResult(undefined, request)).toEqual({ ok: true, canceled: false });
    expect(readFileSync(join(state.dir, 'result.pdf'), 'utf8')).toContain('%PDF-');
    expect(readdirSync(state.dir)).toEqual(['result.pdf']);
    expect(state.options[0]).toMatchObject({
      show: false,
      webPreferences: {
        javascript: false,
        nodeIntegration: false,
        sandbox: true,
        contextIsolation: true,
        webSecurity: true,
        webviewTag: false,
      },
    });
    const preferences = state.options[0]?.['webPreferences'] as {
      partition: string;
      preload?: string;
    };
    expect(preferences.partition).not.toContain('persist:');
    expect(preferences.preload).toBeUndefined();
    expect(state.destroy).toHaveBeenCalledOnce();
    expect(existsSync(dirname(state.paths[0]!))).toBe(false);
    const allow = vi.fn();
    const permission = state.requestPermission.mock.calls[0]?.[0] as (
      wc: unknown,
      p: string,
      cb: typeof allow,
    ) => void;
    permission(null, 'media', allow);
    expect(allow).toHaveBeenCalledWith(false);
    const network = state.request.mock.calls[0]?.[0] as (
      detail: { url: string },
      cb: typeof allow,
    ) => void;
    network({ url: pathToFileURL(state.paths[0]!).href }, allow);
    expect(allow).toHaveBeenLastCalledWith({ cancel: false });
    for (const url of [
      'https://example.invalid',
      'file:///C:/secret.txt',
      'data:text/html,unsafe',
    ]) {
      network({ url }, allow);
      expect(allow).toHaveBeenLastCalledWith({ cancel: true });
    }
    const check = state.checkPermission.mock.calls[0]?.[0] as () => boolean;
    expect(check()).toBe(false);
    expect(state.popup).toHaveBeenCalled();
  });
  it.each(['load', 'print'] as const)('%s の失敗でも窓と一時ファイルを消す', async (step) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state[step].mockRejectedValueOnce(
      Object.assign(new Error('C:\\Users\\private\\report'), { code: 'EACCES' }),
    );
    const result = await exportResult(undefined, request);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(state.destroy).toHaveBeenCalledOnce();
    expect(existsSync(dirname(state.paths[0]!))).toBe(false);
    expect(readdirSync(state.dir)).toEqual([]);
  });
  it('無応答の印刷は時間切れで終了し、一時フォルダを消す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();
    let printing!: () => void;
    const began = new Promise<void>((resolve) => {
      printing = resolve;
    });
    state.print.mockImplementation(() => {
      printing();
      return new Promise(() => undefined);
    });
    const pending = exportResult(undefined, request);
    await began;
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false });
    expect(state.destroy).toHaveBeenCalledOnce();
    expect(existsSync(dirname(state.paths[0]!))).toBe(false);
  });
  it('保存中の再要求を拒否し、終了後は再び保存できる', async () => {
    let release!: (picked: { canceled: boolean }) => void;
    state.dialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = exportResult(undefined, request);
    expect(await exportResult(undefined, request)).toMatchObject({ ok: false });
    release({ canceled: true });
    await first;
    state.dialog.mockResolvedValue({ canceled: true });
    expect(await exportResult(undefined, request)).toEqual({ ok: true, canceled: true });
  });
  it('選択先の拡張子を制限し、保存エラーにも絶対パスを出さない', async () => {
    state.dialog.mockResolvedValue({ canceled: false, filePath: join(state.dir, 'result.exe') });
    expect(await exportResult(undefined, request)).toMatchObject({ ok: false });
    state.dialog.mockRejectedValueOnce(
      Object.assign(new Error('private-user/path'), { code: 'ENOSPC' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await exportResult(undefined, request)).toEqual({
      ok: false,
      message: '保存に失敗しました: ディスクの空き容量が不足しています',
    });
    expect(readdirSync(state.dir)).toEqual([]);
  });
});
