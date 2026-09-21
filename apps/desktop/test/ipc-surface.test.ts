import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../src/shared/ipc.js';

/**
 * IPC の公開面（Phase 7 Task 8 / 指摘 DM-7）。設計仕様 §4.3。
 *
 * `registerIpc()` が登録するチャネルの集合が `IPC_CHANNELS` と**完全一致**することを
 * 確かめる。9本以外を1本でも足せば（あるいは `IPC_CHANNELS` にだけ足して登録を忘れれば）
 * ここで落ちる。preload が公開するのはこの表の9本だけなので、これが renderer から
 * 到達できる main の入口のすべてである。
 */

const handled = vi.hoisted(() => ({ channels: [] as string[] }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getAppPath: () => '' },
  dialog: {},
  shell: {},
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: {
    handle: (channel: string) => {
      handled.channels.push(channel);
    },
  },
}));

const { registerIpc } = await import('../src/main/ipc.js');

describe('main が受け付ける IPC は §4.3 の9本だけ（DM-7）', () => {
  it('registers exactly the channels in IPC_CHANNELS', () => {
    handled.channels = [];
    registerIpc();
    expect([...handled.channels].sort()).toEqual([...Object.values(IPC_CHANNELS)].sort());
  });

  it('registers each channel only once', () => {
    handled.channels = [];
    registerIpc();
    expect(new Set(handled.channels).size).toBe(handled.channels.length);
  });

  it('still counts nine channels (足すときは §4.3 と preload も直すこと)', () => {
    expect(Object.values(IPC_CHANNELS)).toHaveLength(9);
    expect(IPC_CHANNELS.resultExport).toBe('result:export');
  });
});
