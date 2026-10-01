import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../src/shared/ipc.js';
const send = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), send, on: vi.fn() },
}));
let frames: FrameRequestCallback[];
beforeEach(async () => {
  vi.resetModules();
  send.mockClear();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  document.body.innerHTML = '<div id="startup">準備中</div><div id="root"></div>';
  await import('../src/preload/index.js');
});
afterEach(() => vi.unstubAllGlobals());
function documentReady(): void {
  window.dispatchEvent(new Event('DOMContentLoaded'));
}
async function expectPaintedNotification(): Promise<void> {
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(send).not.toHaveBeenCalled();
  frames.shift()!(0);
  expect(send).not.toHaveBeenCalled();
  frames.shift()!(16);
  expect(send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.startupReady);
}
describe('本体の画面が描画されるまで起動画面を保持する', () => {
  it('ローディング中の更新では通知せず、ホーム表示後の描画を待つ', async () => {
    documentReady();
    document.querySelector('#root')!.append(document.createElement('p'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    document.getElementById('startup')!.remove();
    await expectPaintedNotification();
  });
  it('読込エラー画面も、文字の描画を待ってから通知する', async () => {
    documentReady();
    document.getElementById('startup')!.setAttribute('data-state', 'error');
    await expectPaintedNotification();
  });
  it('DOMContentLoadedより先に準備が済んでも通知を取りこぼさない', async () => {
    document.getElementById('startup')!.remove();
    documentReady();
    await expectPaintedNotification();
  });
});
