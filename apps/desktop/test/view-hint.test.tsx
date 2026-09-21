import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { ViewHint } from '../src/renderer/panels/ViewHint.js';

/**
 * 視点操作の早見表の折りたたみ（UXレビュー #14）。
 * 常時表示だと盤の手前（下辺）を覆い、3Dの押ボタンを隠していたので、既定は「?」だけにする。
 */
afterEach(() => {
  cleanup();
});

describe('ViewHint', () => {
  it('既定は「?」ボタンだけで、早見表の本文は出さない', () => {
    render(<ViewHint />);
    expect(screen.getByTestId('view-hint-toggle')).toBeTruthy();
    expect(screen.queryByTestId('view-hint')).toBeNull();
  });

  it('押すと早見表が開き、もう一度押すと畳む', () => {
    render(<ViewHint />);
    const toggle = screen.getByTestId('view-hint-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const hint = screen.getByTestId('view-hint');
    expect(hint).toHaveAttribute('aria-label', JA.session.viewHint);
    expect([...hint.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
      JA.viewControls.mouse,
      JA.viewControls.keyboard,
      JA.viewControls.cube,
    ]);
    expect([...hint.querySelectorAll('dd')].map((description) => description.textContent)).toEqual([
      JA.viewControls.mouseHelp,
      JA.viewControls.keyboardHelp,
      JA.viewControls.cubeHelp,
    ]);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('view-hint')).toBeNull();
  });
});
