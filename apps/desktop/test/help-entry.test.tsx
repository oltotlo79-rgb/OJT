import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { HelpButton } from '../src/renderer/help/HelpButton.js';
import { HelpRoot } from '../src/renderer/help/HelpRoot.js';
import { useHelpStore } from '../src/renderer/help/help-store.js';
import { JA } from '../src/renderer/i18n/ja.js';

/** どの画面からもヘルプへ行けること。取扱説明書 設計 §5.1 / 決定表#16・#17。 */

/** ボタン単体を置くための小さな枠（画面ごとの差し込みは E2E が見る）。 */
function HelpButtonHarness(): JSX.Element {
  return <HelpButton />;
}

afterEach(() => {
  cleanup();
  act(() => {
    useHelpStore.getState().closeHelp();
    useStore.getState().setRoute('home');
  });
});

describe('F1（決定表#17）', () => {
  it('opens the drawer from anywhere', () => {
    render(<HelpRoot />);
    expect(screen.queryByTestId('help-drawer')).toBeNull();
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByTestId('help-drawer')).toBeInTheDocument();
  });

  it('closes it when pressed again', () => {
    render(<HelpRoot />);
    fireEvent.keyDown(window, { key: 'F1' });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.queryByTestId('help-drawer')).toBeNull();
  });

  it('opens even while typing in a text box', () => {
    render(<HelpRoot />);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'F1', bubbles: true });
    expect(screen.getByTestId('help-drawer')).toBeInTheDocument();
    input.remove();
  });

  it('leaves F1 alone when something else already handled it (決定表#16)', () => {
    render(<HelpRoot />);
    const event = new KeyboardEvent('keydown', { key: 'F1', cancelable: true, bubbles: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(screen.queryByTestId('help-drawer')).toBeNull();
  });

  it('opens the section of the screen it was pressed on', () => {
    render(<HelpRoot />);
    act(() => {
      useStore.getState().setRoute('settings');
    });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('設定の画面');
  });

  it('opens the list section from the problem list', () => {
    render(<HelpRoot />);
    act(() => {
      useStore.getState().setRoute('list');
    });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('課題をえらぶ');
  });
});

describe('ヘルプのボタン（設計 §5.1）', () => {
  it('opens the drawer', () => {
    render(<HelpRoot />);
    render(<HelpButtonHarness />);
    fireEvent.click(screen.getByTestId('open-help'));
    expect(screen.getByTestId('help-drawer')).toBeInTheDocument();
  });

  it('is labelled with the word the manual uses', () => {
    render(<HelpButtonHarness />);
    expect(screen.getByTestId('open-help')).toHaveTextContent(JA.help.open);
  });

  it('closes the drawer with Escape', () => {
    render(<HelpRoot />);
    fireEvent.keyDown(window, { key: 'F1' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('help-drawer')).toBeNull();
  });
});
