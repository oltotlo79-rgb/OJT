import { JTEKT_PC10G, MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
import type { DialectProfile } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('方言ごとの入力例とエラー（§10.5 / §16 Phase 4 受入基準④）', () => {
  function hintOf(profile: DialectProfile): string {
    cleanup();
    render(
      <DeviceInput
        initial={emptyCellForm('contact')}
        profile={profile}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    return screen.getByTestId('device-text').getAttribute('placeholder') ?? '';
  }

  it('shows the first input point in the dialect spelling, not a bare prefix', () => {
    expect(hintOf(MITSUBISHI_FX5U)).toBe('X0');
    expect(hintOf(OMRON_CP1E)).toBe('0.00');
    expect(hintOf(JTEKT_PC10G)).toBe('1X000');
    expect(hintOf(SHARP_JW300)).toBe('000000');
  });

  it('shows the counter preset in the dialect spelling', () => {
    cleanup();
    render(
      <DeviceInput
        initial={{ ...emptyCellForm('output'), output: 'CTU' }}
        profile={OMRON_CP1E}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // OMRON のカウンタ設定値は `#0005`（4A Task 7 / d721b23。申し送り F-2）
    expect(screen.getByTestId('preset-text')).toHaveAttribute('placeholder', '#0005');
  });

  it('shows the octal error of the JW-300SP skin (受入基準④)', () => {
    const onCommit = vi.fn();
    render(
      <DeviceInput
        initial={emptyCellForm('contact')}
        profile={SHARP_JW300}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    act(() => {
      fireEvent.change(screen.getByTestId('device-text'), { target: { value: '000008' } });
      fireEvent.click(screen.getByTestId('device-commit'));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('device-error')).toHaveTextContent('8進');
  });

  it('accepts the OMRON ch.bit spelling', () => {
    const onCommit = vi.fn();
    render(
      <DeviceInput
        initial={emptyCellForm('contact')}
        profile={OMRON_CP1E}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    act(() => {
      fireEvent.change(screen.getByTestId('device-text'), { target: { value: '0.08' } });
      fireEvent.click(screen.getByTestId('device-commit'));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
