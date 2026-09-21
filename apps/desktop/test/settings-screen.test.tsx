import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../src/renderer/screens/Settings.js';
import { sounds } from '../src/renderer/audio/sounds.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { useStore } from '../src/renderer/app/store.js';
import { DEFAULT_SETTINGS, type AppSettings, type OjtApi } from '../src/shared/ipc.js';

/**
 * 設定画面のテスト（§12.1 / §15）。
 *
 * 1D2-a のレビュー指摘で入った2点を含む:
 * - 音量つまみは**動かすたびに保存しない**（確定でだけ保存し、トーストも出さない）
 * - 設定ファイルが壊れていたときの警告（`settings:get` の `warning`）を画面に出す
 */

/** preload を差し替える（`delete` で「読み込まれていない」状態に戻せる）。 */
function setApi(api: Partial<OjtApi> | undefined): void {
  if (api === undefined) delete window.ojt;
  else window.ojt = api as OjtApi;
}

/** `setSettings` が呼ばれた回数を数えつつ、重ねた結果を返す。 */
function apiWith(
  initial: AppSettings,
  overrides: Partial<OjtApi> = {},
): { setSettings: ReturnType<typeof vi.fn> } {
  let current = initial;
  const setSettings = vi.fn((patch: Partial<AppSettings>) => {
    current = { ...current, ...patch };
    return Promise.resolve(current);
  });
  setApi({ getSettings: () => Promise.resolve(current), setSettings, ...overrides });
  return { setSettings };
}

/** 設定画面を描いて、`getSettings` の解決を待つ。 */
async function renderSettings(): Promise<void> {
  render(<Settings />);
  await screen.findByTestId('setting-user-dir');
}

beforeEach(() => {
  setApi(undefined);
  useStore.setState({ route: 'settings', toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setApi(undefined);
});

describe('設定の読み込み（§12.1）', () => {
  it('変更していないフォルダ・音量・色を確定しても保存と通知を繰り返さない', async () => {
    const { setSettings } = apiWith({ ...DEFAULT_SETTINGS, monitorColor: '#123456' });
    await renderSettings();
    fireEvent.blur(screen.getByTestId('setting-user-dir'));
    fireEvent.blur(screen.getByTestId('setting-sound-volume'));
    fireEvent.blur(screen.getByTestId('setting-monitor-color'));
    expect(setSettings).not.toHaveBeenCalled();
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('相対パスは保存せず、直し方を伝える', async () => {
    const { setSettings } = apiWith(DEFAULT_SETTINGS);
    await renderSettings();
    fireEvent.change(screen.getByTestId('setting-user-dir'), { target: { value: '../tasks' } });
    fireEvent.blur(screen.getByTestId('setting-user-dir'));
    expect(setSettings).not.toHaveBeenCalled();
    expect(useStore.getState().toasts.at(-1)?.text).toBe(JA.settings.invalidUserDir);
  });

  it('入力欄に getSettings の値がそのまま出る', async () => {
    apiWith({
      ...DEFAULT_SETTINGS,
      userContentDir: 'C:/problems',
      soundEnabled: false,
      soundVolume: 0.25,
      restorePrompt: false,
    });
    await renderSettings();

    expect(screen.getByTestId<HTMLInputElement>('setting-user-dir').value).toBe('C:/problems');
    expect(screen.getByTestId<HTMLInputElement>('setting-sound-enabled').checked).toBe(false);
    expect(screen.getByTestId<HTMLInputElement>('setting-sound-volume').value).toBe('0.25');
    expect(screen.getByTestId<HTMLInputElement>('setting-restore-prompt').checked).toBe(false);
    expect(screen.getByText('25%')).toBeTruthy();
  });

  it('設定を読めなければ理由付きの欄を出す（§13 #5）', async () => {
    setApi({ getSettings: () => Promise.reject(new Error('IPCが死んでいます')) });
    render(<Settings />);

    const box = await screen.findByTestId('settings-error');
    expect(box.textContent).toContain(JA.settings.loadFailed);
    expect(box.textContent).toContain('IPCが死んでいます');
    expect(screen.queryByTestId('setting-user-dir')).toBeNull();
  });

  it('preload が無くても真っ黒にならず理由を出す（§13 #5）', async () => {
    render(<Settings />);
    const box = await screen.findByTestId('settings-error');
    expect(box.textContent).toContain(JA.error.preloadMissing);
  });

  it('設定ファイルが壊れていた警告を出す（1D2-a）', async () => {
    setApi({
      getSettings: () => Promise.resolve({ ...DEFAULT_SETTINGS, warning: '壊れていました' }),
    });
    await renderSettings();
    expect(screen.getByTestId('settings-warning').textContent).toBe('壊れていました');
  });

  it('利用者課題フォルダの使い方を添える（§7.8 / §15）', async () => {
    apiWith(DEFAULT_SETTINGS);
    await renderSettings();
    expect(screen.getByTestId('user-dir-help').textContent).toBe(JA.settings.userContentHelp);
  });
});

describe('チェックボックス（§15）', () => {
  it('1回押すと setSettings は1回、効果音の設定も反映してトーストを出す', async () => {
    const configure = vi.spyOn(sounds, 'configure').mockImplementation(() => undefined);
    const { setSettings } = apiWith(DEFAULT_SETTINGS);
    await renderSettings();

    await act(async () => {
      fireEvent.click(screen.getByTestId('setting-sound-enabled'));
      await Promise.resolve();
    });

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenCalledWith({ soundEnabled: false });
    expect(configure).toHaveBeenCalledWith({
      enabled: false,
      volume: DEFAULT_SETTINGS.soundVolume,
    });
    expect(useStore.getState().toasts.map((t) => t.text)).toContain(JA.settings.saved);
    expect(screen.getByTestId<HTMLInputElement>('setting-sound-enabled').checked).toBe(false);
  });

  it('保存に失敗したら理由をトーストで出す', async () => {
    setApi({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      setSettings: () => Promise.reject(new Error('書き込めません')),
    });
    await renderSettings();

    await act(async () => {
      fireEvent.click(screen.getByTestId('setting-restore-prompt'));
      await Promise.resolve();
    });

    expect(useStore.getState().toasts.map((t) => t.text)).toContain('書き込めません');
  });
});

/**
 * 1D2-a のレビュー指摘: つまみを動かすたびに `settings:set` が飛び、
 * 「設定を保存しました」が5件並んで画面が埋まっていた。
 */
describe('音量つまみ（1D2-a: 確定でだけ保存する）', () => {
  it('8回動かしても保存は確定の1回だけ', async () => {
    vi.spyOn(sounds, 'configure').mockImplementation(() => undefined);
    const { setSettings } = apiWith(DEFAULT_SETTINGS);
    await renderSettings();
    const slider = screen.getByTestId('setting-sound-volume');

    for (let i = 1; i <= 8; i += 1) {
      fireEvent.change(slider, { target: { value: String(i * 0.05) } });
    }
    expect(setSettings).not.toHaveBeenCalled();
    // 動かしている間も表示と音量は追従する（聞き比べられる）
    expect(screen.getByText('40%')).toBeTruthy();

    await act(async () => {
      fireEvent.pointerUp(slider);
      await Promise.resolve();
    });

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenCalledWith({ soundVolume: 0.4 });
  });

  it('確定しても「設定を保存しました」は出さない（トーストで画面を埋めない）', async () => {
    vi.spyOn(sounds, 'configure').mockImplementation(() => undefined);
    apiWith(DEFAULT_SETTINGS);
    await renderSettings();
    const slider = screen.getByTestId('setting-sound-volume');

    await act(async () => {
      fireEvent.change(slider, { target: { value: '0.8' } });
      fireEvent.pointerUp(slider);
      await Promise.resolve();
    });

    expect(useStore.getState().toasts.map((t) => t.text)).not.toContain(JA.settings.saved);
  });

  it.each(['keyUp', 'blur'] as const)(
    '%s でも確定する（キーボード操作・欄から外れたとき）',
    async (event) => {
      vi.spyOn(sounds, 'configure').mockImplementation(() => undefined);
      const { setSettings } = apiWith(DEFAULT_SETTINGS);
      await renderSettings();
      const slider = screen.getByTestId('setting-sound-volume');

      await act(async () => {
        fireEvent.change(slider, { target: { value: '0.15' } });
        if (event === 'keyUp') fireEvent.keyUp(slider, { key: 'ArrowLeft' });
        else fireEvent.blur(slider);
        await Promise.resolve();
      });

      expect(setSettings).toHaveBeenCalledTimes(1);
      expect(setSettings).toHaveBeenCalledWith({ soundVolume: 0.15 });
    },
  );
});

describe('利用者課題フォルダ（§7.8）', () => {
  it('打鍵中は保存せず、欄から外れたときに保存してトーストを出す', async () => {
    vi.spyOn(sounds, 'configure').mockImplementation(() => undefined);
    const { setSettings } = apiWith(DEFAULT_SETTINGS);
    await renderSettings();
    const input = screen.getByTestId('setting-user-dir');

    fireEvent.change(input, { target: { value: 'C:/新しい課題' } });
    expect(setSettings).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.blur(input);
      await Promise.resolve();
    });

    expect(setSettings).toHaveBeenCalledWith({ userContentDir: 'C:/新しい課題' });
    expect(useStore.getState().toasts.map((t) => t.text)).toContain(JA.settings.saved);
  });
});

describe('このアプリについて（UXレビュー #11: 重複した注記を減らす）', () => {
  it('未確認事項の注記はPLC設定のすぐ下にだけ出し、下の商標注記の節では繰り返さない', async () => {
    apiWith(DEFAULT_SETTINGS);
    await renderSettings();
    expect(screen.getByTestId('vendor-assumption')).toHaveTextContent('未確認');
    const about = screen.getByTestId('about');
    expect(about.textContent).not.toContain('未確認');
  });
});
