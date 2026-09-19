import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ElapsedTimer } from '../src/renderer/panels/ElapsedTimer.js';
import { useStore } from '../src/renderer/app/store.js';

/**
 * 経過時間バーの色の凡例（UXレビュー #25）。緑＝標準時間・赤＝打切りを色だけに
 * 頼らず文字でも示す。
 */
afterEach(() => {
  cleanup();
  useStore.setState({ elapsedMs: 0 });
});

describe('ElapsedTimer の凡例', () => {
  it('標準時間・打切り時間をどちらも分単位で示す', () => {
    render(<ElapsedTimer limit={{ standardMin: 30, cutoffMin: 50 }} />);
    const legend = screen.getByTestId('elapsed-legend');
    expect(legend.textContent).toContain('標準時間 30分');
    expect(legend.textContent).toContain('打切り時間 50分');
  });
});
