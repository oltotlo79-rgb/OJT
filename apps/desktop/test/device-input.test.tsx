import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceInput } from '../src/renderer/ladder/DeviceInput.js';
import { emptyCellForm } from '../src/renderer/session/ladder-cell.js';

// このリポジトリの UI テストの流儀（`globals: false` なので自動クリーンアップは効かない）。
afterEach(() => {
  cleanup();
});

const profile = MITSUBISHI_FX5U;

/**
 * §10.5 の丸め確認（レビュー Minor）。
 * 三菱の T0 帯（`SPECIAL_INDEXES` に無い通常番号）は100ms刻みなので、3050ms は置けない。
 */
function renderTonAt3050(): void {
  render(
    <DeviceInput
      initial={{ ...emptyCellForm('output'), output: 'TON', deviceText: 'T0', presetText: '3050' }}
      profile={profile}
      onCommit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTestId('device-commit'));
}

describe('DeviceInput の丸め確認（§10.5 Minor）', () => {
  it('shows the rounding sentence only once, not also as a plain error', () => {
    renderTonAt3050();
    expect(screen.getByTestId('round-prompt')).toHaveTextContent('100ms 刻みに丸めますか');
    // 以前は `device-error` にも同じ文が出ていた（レビュー指摘）
    expect(screen.queryByTestId('device-error')).toBeNull();
  });

  it('clears both the prompt and any leftover error when answering no', () => {
    renderTonAt3050();
    expect(screen.getByTestId('round-prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('round-no'));
    expect(screen.queryByTestId('round-prompt')).toBeNull();
    // 以前は「いいえ」が `round` しか消さず、`device-error` に文言が残っていた
    expect(screen.queryByTestId('device-error')).toBeNull();
  });

  it('commits the rounded value when answering yes', () => {
    const onCommit = vi.fn();
    render(
      <DeviceInput
        initial={{
          ...emptyCellForm('output'),
          output: 'TON',
          deviceText: 'T0',
          presetText: '3050',
        }}
        profile={profile}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('device-commit'));
    fireEvent.click(screen.getByTestId('round-yes'));
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timer', presetMs: 3100 }),
    );
    expect(screen.queryByTestId('round-prompt')).toBeNull();
  });
});
