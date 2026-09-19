import { COIL_COL } from '@ojt/ladder-core';
import {
  DIALECT_IDS,
  IMPLEMENTED_DIALECT_IDS,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
} from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc.js';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { Settings } from '../src/renderer/screens/Settings.js';

/**
 * 設定画面のPLC項目（§12.1 / §10.6 / 決定表#13）。Plan 3B Task 16。
 *
 * `window.ojt` は他の設定画面テストと同じく preload の型付きAPIをそのまま差し替える。
 */

const saved: Array<Record<string, unknown>> = [];

beforeEach(() => {
  saved.length = 0;
  useStore.setState({ route: 'settings', toasts: [] });
  Object.defineProperty(window, 'ojt', {
    configurable: true,
    value: {
      getSettings: () => Promise.resolve({ ...DEFAULT_SETTINGS }),
      setSettings: (patch: Record<string, unknown>) => {
        saved.push(patch);
        return Promise.resolve({ ...DEFAULT_SETTINGS, ...patch });
      },
    },
  });
});

afterEach(() => {
  cleanup();
  delete (window as { ojt?: unknown }).ojt;
});

describe('設定画面のPLC項目（§12.1 / §10.6 / 決定表#13）', () => {
  it('lists every vendor but only lets the implemented one be chosen', async () => {
    render(<Settings />);
    const select = await screen.findByTestId('setting-vendor');
    expect(select.querySelectorAll('option')).toHaveLength(DIALECT_IDS.length);
    for (const id of DIALECT_IDS) {
      const option = screen.getByTestId(`vendor-option-${id}`);
      expect(option).toHaveProperty('disabled', !IMPLEMENTED_DIALECT_IDS.includes(id));
    }
    expect(screen.getByTestId('vendor-note')).toHaveTextContent('Phase 4');
  });

  it('repeats the assumption notice next to the vendor choice (§17.1)', async () => {
    render(<Settings />);
    await screen.findByTestId('setting-vendor');
    expect(screen.getByTestId('vendor-assumption')).toHaveTextContent('未確認');
  });

  it('clamps the grid column count to 8..15 (§10.6)', async () => {
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
    expect(useStore.getState().dialectId).toBe('mitsubishi');
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
