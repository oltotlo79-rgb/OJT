import { COIL_COL } from '@ojt/ladder-core';
import {
  getDialect,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  type DialectId,
} from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc.js';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { Settings } from '../src/renderer/screens/Settings.js';

/**
 * 設定画面のPLC項目（§12.1 / §10.6 / 決定表#13）。Plan 3B Task 16・Plan 4B Task 6。
 *
 * `window.ojt` は他の設定画面テストと同じく preload の型付きAPIをそのまま差し替える。
 */

const saved: Array<Record<string, unknown>> = [];

/** `window.ojt` を差し替える。`initial` は `getSettings()` が返す設定への上書き。 */
function installOjt(initial: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'ojt', {
    configurable: true,
    value: {
      getSettings: () => Promise.resolve({ ...DEFAULT_SETTINGS, ...initial }),
      setSettings: (patch: Record<string, unknown>) => {
        saved.push(patch);
        return Promise.resolve({ ...DEFAULT_SETTINGS, ...initial, ...patch });
      },
    },
  });
}

beforeEach(() => {
  saved.length = 0;
  useStore.setState({
    route: 'settings',
    toasts: [],
    dialectId: 'mitsubishi',
    defaultVendor: 'mitsubishi',
  });
  installOjt();
});

afterEach(() => {
  cleanup();
  delete (window as { ojt?: unknown }).ojt;
});

describe('設定画面のPLC項目（§12.1 / §10.6 / 決定表#13）', () => {
  it('repeats the assumption notice next to the vendor choice (§17.1)', async () => {
    render(<Settings />);
    await screen.findByTestId('setting-vendor');
    expect(screen.getByTestId('vendor-assumption')).toHaveTextContent('未確認');
  });

  it('clamps the grid column count to 8..15 (§10.6)', async () => {
    // 既定は「メーカーの既定に従う」（0）で欄が使えないので、まず上書きへ切り替える
    installOjt({ ladderGridCols: MITSUBISHI_FX5U.gridCols });
    render(<Settings />);
    const input = await screen.findByTestId('setting-grid-cols');
    expect(input).toHaveAttribute('min', String(MIN_GRID_COLS));
    expect(input).toHaveAttribute('max', String(MAX_GRID_COLS));
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ ladderGridCols: MAX_GRID_COLS });
    });
  });

  it('saves the monitor colour', async () => {
    installOjt({ monitorColor: '#1e64ff' });
    render(<Settings />);
    const input = await screen.findByTestId('setting-monitor-color');
    fireEvent.change(input, { target: { value: '#2fa02c' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ monitorColor: '#2fa02c' });
    });
  });

  /** レビュー指摘 #6: 触っただけで値が変わっていない blur では保存もトーストもしない。 */
  it('does not save the grid column count on blur when it did not change', async () => {
    installOjt({ ladderGridCols: MITSUBISHI_FX5U.gridCols });
    render(<Settings />);
    const input = await screen.findByTestId('setting-grid-cols');
    fireEvent.blur(input);
    expect(saved).toHaveLength(0);
  });

  /**
   * レビュー指摘 #4: `patch()` はPLCの3キー（メーカー・表示列数・通電色）のどれかが変わった
   * ときだけラダーへ即時反映する。それ以外の設定（ここでは「起動時に復元確認」）を保存しても、
   * サーバがPLC設定込みの全体を返してくることに引きずられて上書きしてはいけない。
   */
  it('does not re-apply ladder settings when saving a setting outside the PLC group', async () => {
    useStore.setState({ ladderGridCols: 11, monitorColor: '#1E64FF' });
    Object.defineProperty(window, 'ojt', {
      configurable: true,
      value: {
        getSettings: () => Promise.resolve({ ...DEFAULT_SETTINGS }),
        setSettings: (patch: Record<string, unknown>) => {
          saved.push(patch);
          // サーバはPLC設定込みの全体を返す（今回変えていない項目も同じ応答形に乗る）が、
          // 画面はそれに引きずられてラダーへ再適用してはいけない
          return Promise.resolve({
            ...DEFAULT_SETTINGS,
            ...patch,
            ladderGridCols: 9,
            monitorColor: '#2fa02c',
          });
        },
      },
    });
    render(<Settings />);
    const checkbox = await screen.findByTestId('setting-restore-prompt');
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(useStore.getState().ladderGridCols).toBe(11);
    expect(useStore.getState().monitorColor).toBe('#1E64FF');
  });

  /** レビュー指摘 #5: 「既定に戻す」がPLCの3キーを既定値へ戻し、保存済みトーストを出す。 */
  it('resets the PLC group to the defaults and toasts', async () => {
    render(<Settings />);
    const resetButton = await screen.findByTestId('setting-plc-reset');
    fireEvent.click(resetButton);
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({
        defaultVendor: DEFAULT_SETTINGS.defaultVendor,
        ladderGridCols: DEFAULT_SETTINGS.ladderGridCols,
        monitorColor: DEFAULT_SETTINGS.monitorColor,
      });
    });
    expect(useStore.getState().toasts.map((t) => t.text)).toContain(JA.settings.saved);
  });

  it('pushes the values into the store so the ladder follows', () => {
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 9, monitorColor: '#2fa02c', vendor: 'mitsubishi' });
    expect(useStore.getState().ladderGridCols).toBe(9);
    expect(useStore.getState().monitorColor).toBe('#2fa02c');
    // 設定が動かすのは既定メーカーだけ。いまのセッションの方言は動かさない（決定表#24）
    expect(useStore.getState().defaultVendor).toBe('mitsubishi');
  });

  /** レビュー指摘 #7: 表示列数が縮んだら、見えなくなる列を指していたカーソルを詰める。 */
  it('clamps the ladder cursor into the visible columns when the grid shrinks', () => {
    useStore.setState({ ladderCursor: { networkId: 'n1', row: 0, col: 10 } });
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 8, monitorColor: '#2fa02c', vendor: 'mitsubishi' });
    expect(useStore.getState().ladderCursor).toEqual({ networkId: 'n1', row: 0, col: 7 });
  });

  /** レビュー指摘 #7: コイル列はどの表示列数でも見えているので、カーソルは動かさない。 */
  it('keeps the cursor on the coil column when the grid shrinks', () => {
    useStore.setState({ ladderCursor: { networkId: 'n1', row: 0, col: COIL_COL } });
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 8, monitorColor: '#2fa02c', vendor: 'mitsubishi' });
    expect(useStore.getState().ladderCursor).toEqual({ networkId: 'n1', row: 0, col: COIL_COL });
  });
});

describe('4メーカーの選択（§16 Phase 4 受入基準①）', () => {
  it('offers all four vendors, none disabled, named by the profile', async () => {
    render(<Settings />);
    const select = await screen.findByTestId('setting-vendor');
    const options = [...select.querySelectorAll('option')];
    expect(options).toHaveLength(4);
    for (const option of options) {
      expect(option, option.value).not.toBeDisabled();
      expect(option.textContent, option.value).toBe(
        getDialect(option.value as DialectId).displayName,
      );
    }
    expect(screen.queryByText(/Phase 4 で対応/u)).toBeNull();
    // UXレビュー #11 の「準備中」も、4社すべて実装済みになったので画面には出さない
    expect(screen.getByTestId('vendor-note')).not.toHaveTextContent('準備中');
  });

  it('saves the chosen vendor as the default, without touching the open session (決定表#24)', async () => {
    act(() => {
      useStore.setState({ dialectId: 'jtekt' });
    });
    render(<Settings />);
    const select = await screen.findByTestId('setting-vendor');
    fireEvent.change(select, { target: { value: 'omron' } });
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ defaultVendor: 'omron' });
    });
    // 次に課題を開くときの既定だけが変わる。いま開いている方言は動かさない（前提#31b）
    expect(useStore.getState().defaultVendor).toBe('omron');
    expect(useStore.getState().dialectId).toBe('jtekt');
  });

  it('does not reset a restored dialect when an unrelated setting is saved (前提#31b)', async () => {
    act(() => {
      useStore.setState({ dialectId: 'sharp', defaultVendor: 'mitsubishi' });
    });
    render(<Settings />);
    fireEvent.click(await screen.findByTestId('setting-sound-enabled'));
    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(0);
    });
    expect(useStore.getState().dialectId).toBe('sharp');
  });
});

describe('「メーカーの既定に従う」（§10.6 / 決定表#8）', () => {
  it('defaults both the colour and the column count to the vendor default', () => {
    expect(DEFAULT_SETTINGS.monitorColor).toBe('');
    expect(DEFAULT_SETTINGS.ladderGridCols).toBe(0);
  });

  it('starts the colour override from the chosen vendor, not from the Mitsubishi blue', async () => {
    render(<Settings />);
    // 先に OMRON を選ぶ（この画面の色は `defaultVendor` に従う）
    fireEvent.change(await screen.findByTestId('setting-vendor'), { target: { value: 'omron' } });
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ defaultVendor: 'omron' });
    });
    const auto = await screen.findByTestId('setting-monitor-color-auto');
    // 既定は「メーカーの既定に従う」＝チェック済み
    expect(auto).toBeChecked();
    fireEvent.click(auto);
    await waitFor(() => {
      // **いま選んでいるメーカーの色**から上書きが始まる（三菱の青を押しつけない。レビュー B1）
      expect(saved.at(-1)).toEqual({ monitorColor: OMRON_CP1E.monitorColors.powered });
    });
    fireEvent.click(await screen.findByTestId('setting-monitor-color-auto'));
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ monitorColor: '' });
    });
  });

  it('turns the column override off by writing 0', async () => {
    render(<Settings />);
    const auto = await screen.findByTestId('setting-grid-cols-auto');
    expect(auto).toBeChecked();
    fireEvent.click(auto);
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ ladderGridCols: MITSUBISHI_FX5U.gridCols });
    });
    fireEvent.click(await screen.findByTestId('setting-grid-cols-auto'));
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ ladderGridCols: 0 });
    });
  });

  it('keeps 0 and "" through the store (does not clamp 0 up to 8)', () => {
    act(() => {
      useStore.setState({ dialectId: 'jtekt' });
      useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    });
    expect(useStore.getState().ladderGridCols).toBe(0);
    expect(useStore.getState().monitorColor).toBe('');
    // 既定メーカーだけ。いまの方言は動かさない（決定表#24）
    expect(useStore.getState().defaultVendor).toBe('omron');
    expect(useStore.getState().dialectId).toBe('jtekt');
  });

  it('shows the current skin colour in the swatch while the override is off', async () => {
    // 空文字は `<input type="color">` に入れられないので、いまのスキンの色を見せる
    installOjt({ defaultVendor: 'omron' });
    render(<Settings />);
    const swatch = await screen.findByTestId('setting-monitor-color');
    expect(swatch).toHaveValue('#2fa02c');
    expect(swatch).toBeDisabled();
    expect(screen.getByTestId('monitor-color-help')).toHaveTextContent('メーカーの既定');
  });

  it('writes "" and 0 when the group is reset', async () => {
    render(<Settings />);
    fireEvent.click(await screen.findByTestId('setting-plc-reset'));
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({
        defaultVendor: 'mitsubishi',
        ladderGridCols: 0,
        monitorColor: '',
      });
    });
  });

  it('shows the assumption note of the current skin', async () => {
    render(<Settings />);
    expect(await screen.findByTestId('skin-assumed')).toHaveTextContent('画面の配色');
  });
});
