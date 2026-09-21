import type * as NodeFs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 説明書（PDF）を開く。取扱説明書 設計 §8 / §9。
 * `electron` を差し替えて3つの分かれ道（PDFが無い／開けた／開けなかった）を確かめる。
 */

const state = {
  isPackaged: false,
  appPath: 'C:\\app',
  resourcesPath: 'C:\\app\\resources',
  exists: new Set<string>(),
  openPathResult: '',
  openedPaths: [] as string[],
};

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
    getAppPath: () => state.appPath,
  },
  shell: {
    openPath: (path: string) => {
      state.openedPaths.push(path);
      return Promise.resolve(state.openPathResult);
    },
  },
}));

/*
 * `node:fs` は CJS なので、Vite は `src/main/manual.ts` の `import { existsSync }` を
 * `default` 経由の読み出しに組み直す。差し替えは**名前付きと `default` の両方**に要る
 * （名前付きだけ差し替えると本物の `existsSync` が呼ばれ、この検査が素通りする）。
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof NodeFs>();
  const existsSync = (path: string): boolean => state.exists.has(path);
  return { ...real, existsSync, default: { ...real, existsSync } };
});

const { manualPdfPath, openManual } = await import('../src/main/manual.js');
const { MSG } = await import('../src/shared/messages.js');
const { IPC_CHANNELS } = await import('../src/shared/ipc.js');

afterEach(() => {
  state.isPackaged = false;
  state.exists.clear();
  state.openPathResult = '';
  state.openedPaths = [];
  Object.defineProperty(globalThis.process, 'resourcesPath', {
    value: state.resourcesPath,
    configurable: true,
  });
});

describe('PDF の置き場所（設計 §8）', () => {
  it('reads it from the app folder while developing', () => {
    expect(manualPdfPath()).toBe('C:\\app\\resources\\manual\\manual.pdf');
  });

  it('reads it from the resources folder in a packaged build', () => {
    state.isPackaged = true;
    Object.defineProperty(globalThis.process, 'resourcesPath', {
      value: 'C:\\installed\\resources',
      configurable: true,
    });
    expect(manualPdfPath()).toBe('C:\\installed\\resources\\manual.pdf');
  });
});

describe('PDF を開く（設計 §9）', () => {
  it('says so when the file is not there, and does not call the shell', async () => {
    const result = await openManual();
    expect(result).toEqual({ ok: false, message: MSG.manual.missing });
    expect(state.openedPaths).toEqual([]);
  });

  it('hands the file to the operating system when it is there', async () => {
    state.exists.add(manualPdfPath());
    const result = await openManual();
    expect(result).toEqual({ ok: true, path: manualPdfPath() });
    expect(state.openedPaths).toEqual([manualPdfPath()]);
  });

  it('reports why the operating system refused', async () => {
    state.exists.add(manualPdfPath());
    state.openPathResult = '関連付けられたアプリがありません';
    const result = await openManual();
    expect(result).toEqual({
      ok: false,
      message: MSG.manual.openFailed('関連付けられたアプリがありません'),
    });
  });
});

describe('説明書のチャネルと既存機能の維持（§4.3）', () => {
  // 全体の本数・重複・登録漏れは ipc-surface.test.ts だけで検査する。
  // 各機能のテストに昔の本数を重複して持たせない。
  it('keeps the fixed manual channel', () => {
    expect(IPC_CHANNELS.manualOpen).toBe('manual:open');
  });

  it('keeps the existing content, work, settings and manual channels', () => {
    expect(Object.values(IPC_CHANNELS)).toEqual(
      expect.arrayContaining([
        'content:list',
        'content:read',
        'workfile:save',
        'workfile:load',
        'settings:get',
        'settings:set',
        'file:saveText',
        'manual:open',
      ]),
    );
  });
});
