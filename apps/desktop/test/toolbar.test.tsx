import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { Toolbar } from '../src/renderer/panels/Toolbar.js';
import styles from '../src/renderer/panels/panels.module.css';

/**
 * ツールバーの構造（レビュー指摘: モードC2で道具が増え、1280px幅だと `.spacer` ごと
 * 判定ボタンが2行目に落ちていた）。§8.1
 *
 * 判定ボタンは `.toolbarScroll`（折り返す枠）の**外**に置き、`margin-left: auto` で
 * 常に右端に留める。折り返すのはそれ以外の道具だけ。
 */

afterEach(() => {
  cleanup();
});

function renderToolbar(overrides: { canUndo?: boolean; canRedo?: boolean } = {}): void {
  render(
    <Toolbar
      mode="wire"
      wireColor="青"
      allowedColors={['青', '白', '黄']}
      camera="front"
      canUndo={overrides.canUndo ?? false}
      canRedo={overrides.canRedo ?? false}
      judging={false}
      onMode={vi.fn()}
      onWireColor={vi.fn()}
      onCamera={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onJudge={vi.fn()}
      onBack={vi.fn()}
      onSave={vi.fn()}
      onLoad={vi.fn()}
      schematicVisible={false}
      onToggleSchematic={undefined}
    />,
  );
}

describe('ツールバーの構造（§8.1）', () => {
  it('判定ボタンは折り返す枠（toolbarScroll）の外にある', () => {
    renderToolbar();
    const judgeButton = screen.getByTestId('judge-button');
    const scroll = document.querySelector(`.${styles.toolbarScroll}`);
    expect(scroll).not.toBeNull();
    expect(scroll?.contains(judgeButton)).toBe(false);
  });

  it('戻る・線色・元に戻す・視点・保存読込は折り返す枠の中にある', () => {
    renderToolbar();
    const scroll = document.querySelector(`.${styles.toolbarScroll}`);
    expect(scroll).not.toBeNull();
    if (scroll === null) return;
    expect(scroll.contains(screen.getByTestId('session-back'))).toBe(true);
    expect(scroll.contains(screen.getByRole('button', { name: '青' }))).toBe(true);
  });

  it('既存のテストID・ボタン順は変わらない', () => {
    renderToolbar();
    expect(screen.getByTestId('session-back')).toBeTruthy();
    expect(screen.getByTestId('judge-button')).toBeTruthy();
    expect(screen.getByRole('button', { name: '青' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '白' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '黄' })).toBeTruthy();
  });
});

describe('押せない理由（UXレビュー #5）', () => {
  it('元に戻す／やり直しが押せないとき、title と一行の説明を出す', () => {
    renderToolbar({ canUndo: false, canRedo: false });
    const undo = screen.getByRole('button', { name: JA.session.undo });
    const redo = screen.getByRole('button', { name: JA.session.redo });
    expect(undo).toHaveAttribute('title', JA.disabledReason.undo);
    expect(redo).toHaveAttribute('title', JA.disabledReason.redo);
    const reason = screen.getByTestId('undo-redo-reason');
    expect(reason).toHaveTextContent(JA.disabledReason.undo);
    expect(reason).toHaveTextContent(JA.disabledReason.redo);
  });

  it('押せるときは title も一行の説明も出さない', () => {
    renderToolbar({ canUndo: true, canRedo: true });
    const undo = screen.getByRole('button', { name: JA.session.undo });
    const redo = screen.getByRole('button', { name: JA.session.redo });
    expect(undo).not.toHaveAttribute('title');
    expect(redo).not.toHaveAttribute('title');
    expect(screen.queryByTestId('undo-redo-reason')).toBeNull();
  });
});
