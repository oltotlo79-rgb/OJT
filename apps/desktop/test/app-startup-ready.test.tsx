import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/app/App.js';
import {
  DEFAULT_SETTINGS,
  type AppSettingsResponse,
  type WorkFileLoadResult,
} from '../src/shared/ipc.js';
vi.mock('../src/renderer/app/routes.js', () => ({ renderRoute: () => <div>ホーム</div> }));
vi.mock('../src/renderer/help/HelpRoot.js', () => ({ HelpRoot: () => null }));
vi.mock('../src/renderer/tour/TourOverlay.js', () => ({ TourOverlay: () => null }));
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'ojt');
});
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe('設定と前回作業の確認が終わるまで起動中の表示を残す', () => {
  it('設定の反映と一時保存の照合が終わるまで準備完了を通知しない', async () => {
    const settings = deferred<AppSettingsResponse>(),
      restored = deferred<WorkFileLoadResult>();
    const api = {
      getSettings: () => settings.promise,
      loadWorkFile: vi.fn(() => restored.promise),
      onCloseRequest: () => () => {},
    };
    Object.defineProperty(window, 'ojt', { value: api, configurable: true });
    const ready = vi.fn();
    render(<App onReady={ready} />);
    expect(ready).not.toHaveBeenCalled();
    await act(async () => {
      settings.resolve({ ...DEFAULT_SETTINGS, tourDone: true, uiScale: 1.3 });
      await settings.promise;
    });
    expect(api.loadWorkFile).toHaveBeenCalledWith({ kind: 'autosave' });
    expect(ready).not.toHaveBeenCalled();
    await act(async () => {
      restored.resolve({ ok: false, canceled: true, message: '一時保存なし' });
      await restored.promise;
    });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.3');
  });
  it('復元確認を無効にした起動では一時保存を読まずに完了する', async () => {
    const load = vi.fn();
    Object.defineProperty(window, 'ojt', {
      value: {
        getSettings: () =>
          Promise.resolve({ ...DEFAULT_SETTINGS, tourDone: true, restorePrompt: false }),
        loadWorkFile: load,
        onCloseRequest: () => () => {},
      },
      configurable: true,
    });
    const ready = vi.fn();
    render(<App onReady={ready} />);
    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(load).not.toHaveBeenCalled();
  });
  it.each(['settings', 'autosave'] as const)(
    '%sの読込が失敗しても起動を完了できる',
    async (failure) => {
      Object.defineProperty(window, 'ojt', {
        value: {
          getSettings: () =>
            failure === 'settings'
              ? Promise.reject(new Error('設定読込失敗'))
              : Promise.resolve({ ...DEFAULT_SETTINGS, tourDone: true }),
          loadWorkFile: () => Promise.reject(new Error('一時保存読込失敗')),
          onCloseRequest: () => () => {},
        },
        configurable: true,
      });
      const ready = vi.fn();
      render(<App onReady={ready} />);
      await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    },
  );
});
