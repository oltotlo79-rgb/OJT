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

  it('pushes the values into the store so the ladder follows', () => {
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 9, monitorColor: '#2fa02c', vendor: 'mitsubishi' });
    expect(useStore.getState().ladderGridCols).toBe(9);
    expect(useStore.getState().monitorColor).toBe('#2fa02c');
    expect(useStore.getState().dialectId).toBe('mitsubishi');
  });
});
