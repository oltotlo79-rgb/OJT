import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OjtApi } from '../src/shared/ipc.js';
import { IPC_CHANNELS } from '../src/shared/ipc.js';

const mock = vi.hoisted(() => ({
  listener: undefined as undefined | ((_event: unknown, token: unknown) => void),
  api: undefined as OjtApi | undefined,
  send: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: OjtApi) => {
      mock.api = api;
    },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    send: mock.send,
    on: (channel: string, listener: typeof mock.listener) => {
      if (channel === IPC_CHANNELS.closeRequest) mock.listener = listener;
    },
  },
}));
beforeEach(async () => {
  vi.resetModules();
  mock.send.mockClear();
  await import('../src/preload/index.js');
});
async function closeRequest(token = 1): Promise<void> {
  mock.listener?.({}, token);
  await vi.waitFor(() => expect(mock.send).toHaveBeenCalled());
}
describe('起動中と編集中の終了', () => {
  it('画面を準備している間は、保存を待たずに閉じられる', async () => {
    await closeRequest();
    expect(mock.send).toHaveBeenCalledWith(IPC_CHANNELS.closeReady, 1, true);
  });
  it('編集開始後は保存完了まで終了を許可しない', async () => {
    let saved: ((ok: boolean) => void) | undefined;
    mock.api?.onCloseRequest?.(
      () =>
        new Promise((resolve) => {
          saved = resolve;
        }),
    );
    mock.listener?.({}, 2);
    await Promise.resolve();
    expect(mock.send).not.toHaveBeenCalled();
    saved?.(true);
    await vi.waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith(IPC_CHANNELS.closeReady, 2, true),
    );
  });
  it.each([
    () => Promise.resolve(false),
    () => Promise.reject(new Error('保存失敗')),
    () => {
      throw new Error('保存失敗');
    },
  ])('保存が失敗したら閉じない', async (handler) => {
    mock.api?.onCloseRequest?.(handler);
    await closeRequest();
    expect(mock.send).toHaveBeenCalledWith(IPC_CHANNELS.closeReady, 1, false);
  });
  it('保存処理の登録解除後も、未保存のまま終了することを防ぐ', async () => {
    const stop = mock.api?.onCloseRequest?.(() => Promise.resolve(true));
    stop?.();
    await closeRequest();
    expect(mock.send).toHaveBeenCalledWith(IPC_CHANNELS.closeReady, 1, false);
  });
});
