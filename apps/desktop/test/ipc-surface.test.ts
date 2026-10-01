import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../src/shared/ipc.js';

/**
 * IPC の公開面（Phase 7 Task 8 / 指摘 DM-7）。設計仕様 §4.3。
 *
 * 呼出10本が `registerIpc()` と一致することを確かめる。終了ハンドシェイク2本と
 * 初期画面の描画完了通知1本は、ウィンドウの生成時に登録する内部イベントである。
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

describe('main の IPC 契約（呼出10本・終了2本・描画完了1本）', () => {
  it('registers exactly the channels in IPC_CHANNELS', () => {
    handled.channels = [];
    registerIpc();
    expect([...handled.channels].sort()).toEqual(
      Object.values(IPC_CHANNELS)
        .filter(
          (channel) =>
            ![
              IPC_CHANNELS.closeRequest,
              IPC_CHANNELS.closeReady,
              IPC_CHANNELS.startupReady,
            ].includes(channel as typeof IPC_CHANNELS.closeRequest),
        )
        .sort(),
    );
  });

  it('registers each channel only once', () => {
    handled.channels = [];
    registerIpc();
    expect(new Set(handled.channels).size).toBe(handled.channels.length);
  });

  it('defines ten invocation channels, two close events and one painted event', () => {
    expect(Object.values(IPC_CHANNELS)).toHaveLength(13);
    expect(IPC_CHANNELS.resultExport).toBe('result:export');
  });
});
