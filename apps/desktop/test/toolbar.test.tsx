import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
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

  it('戻る・線色・元に戻す・「…」トリガーは折り返す枠の中にある（視点・保存読込はUXレビュー #17でその中へ畳む）', () => {
    renderToolbar();
    const scroll = document.querySelector(`.${styles.toolbarScroll}`);
    expect(scroll).not.toBeNull();
    if (scroll === null) return;
    expect(scroll.contains(screen.getByTestId('session-back'))).toBe(true);
    expect(scroll.contains(screen.getByRole('button', { name: '青' }))).toBe(true);
    expect(scroll.contains(screen.getByTestId('toolbar-overflow-toggle'))).toBe(true);
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

describe('押せない理由（UXレビュー #5 / UI監査 I6）', () => {
  /*
   * UI監査 I6: 以前は理由を常時1行で表示しており、幅の1/4を占めて1280pxでは
   * ①ブレーカ②電源スイッチが2行目へ落ちていた。いまは `disabled` ではなく `aria-disabled`
   * （I3 と同じ型）にして、理由は `title` と隠し文字（`aria-describedby`）だけにする。
   * 見た目の幅は押せる／押せないで変わらない。
   */
  it('元に戻す／やり直しが押せないとき、title と読み上げ用の説明を出す（画面には常時表示しない）', () => {
    renderToolbar({ canUndo: false, canRedo: false });
    const undo = screen.getByRole('button', { name: JA.session.undo });
    const redo = screen.getByRole('button', { name: JA.session.redo });
    expect(undo).toHaveAttribute('title', JA.disabledReason.undo);
    expect(redo).toHaveAttribute('title', JA.disabledReason.redo);
    // `disabled` ではない（フォーカス・ツールチップを保つ。I3 と同じ理由）
    expect(undo).not.toBeDisabled();
    expect(redo).not.toBeDisabled();
    expect(undo).toHaveAttribute('aria-disabled', 'true');
    expect(redo).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('undo-reason')).toHaveTextContent(JA.disabledReason.undo);
    expect(screen.getByTestId('redo-reason')).toHaveTextContent(JA.disabledReason.redo);
  });

  it('押せるときは title も隠し文字も出さない', () => {
    renderToolbar({ canUndo: true, canRedo: true });
    const undo = screen.getByRole('button', { name: JA.session.undo });
    const redo = screen.getByRole('button', { name: JA.session.redo });
    expect(undo).not.toHaveAttribute('title');
    expect(redo).not.toHaveAttribute('title');
    expect(undo).toHaveAttribute('aria-disabled', 'false');
    expect(redo).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByTestId('undo-reason')).toBeNull();
    expect(screen.queryByTestId('redo-reason')).toBeNull();
  });

  it('押せないときにクリックしても呼ばれない（aria-disabled はクリックを止めない代わりにガードする）', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <Toolbar
        mode="wire"
        wireColor="青"
        allowedColors={['青', '白', '黄']}
        camera="front"
        canUndo={false}
        canRedo={false}
        judging={false}
        onMode={vi.fn()}
        onWireColor={vi.fn()}
        onCamera={vi.fn()}
        onUndo={onUndo}
        onRedo={onRedo}
        onJudge={vi.fn()}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        schematicVisible={false}
        onToggleSchematic={undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    fireEvent.click(screen.getByRole('button', { name: JA.session.redo }));
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });
});

describe('「…」メニュー（UXレビュー #17: 視点・保存読込を畳んで1280px幅でも判定を1行目に残す）', () => {
  it('既定では畳まれていて、視点・保存読込のボタンは出さない', () => {
    renderToolbar();
    expect(screen.getByTestId('toolbar-overflow-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('toolbar-overflow')).toBeNull();
    expect(screen.queryByRole('button', { name: JA.session.viewFront })).toBeNull();
    expect(screen.queryByRole('button', { name: JA.session.save })).toBeNull();
  });

  it('「…」を押すと視点・保存読込・回路図の開閉が出て、もう一度押すと畳む', () => {
    renderToolbar();
    const toggle = screen.getByTestId('toolbar-overflow-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: JA.session.viewFront })).toBeTruthy();
    expect(screen.getByRole('button', { name: JA.session.save })).toBeTruthy();
    expect(screen.getByRole('button', { name: JA.session.load })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: JA.session.viewFront })).toBeNull();
  });

  it('判定ボタンは折り返す枠の外に留まる（開いていても閉じていても）', () => {
    renderToolbar();
    const scroll = document.querySelector(`.${styles.toolbarScroll}`);
    fireEvent.click(screen.getByTestId('toolbar-overflow-toggle'));
    expect(scroll?.contains(screen.getByTestId('judge-button'))).toBe(false);
  });
});

/*
 * UXレビュー #5 / UI-03・UI-06: `aria-disabled` は `disabled` と違ってクリックを止めない
 * （ハンドラ側でガードする）ので、押しても無反応にはせず理由をトーストでも出す。
 */
describe('押せないボタンのトースト（UXレビュー #5 / UI-03・UI-06）', () => {
  beforeEach(() => {
    useStore.setState({ toasts: [] });
  });

  it('元に戻すが押せないときにクリックすると理由をトーストで1回出す', () => {
    renderToolbar({ canUndo: false, canRedo: false });
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    expect(
      useStore.getState().toasts.filter((t) => t.text === JA.disabledReason.undo),
    ).toHaveLength(1);
  });

  it('やり直しが押せないときにクリックすると理由をトーストで1回出す', () => {
    renderToolbar({ canUndo: false, canRedo: false });
    fireEvent.click(screen.getByRole('button', { name: JA.session.redo }));
    expect(
      useStore.getState().toasts.filter((t) => t.text === JA.disabledReason.redo),
    ).toHaveLength(1);
  });

  it('判定ボタンが押せないときにクリックすると理由をトーストで1回出す', () => {
    render(
      <Toolbar
        mode="wire"
        wireColor="青"
        allowedColors={['青', '白', '黄']}
        camera="front"
        canUndo={false}
        canRedo={false}
        judging={false}
        judgeDisabled
        judgeTitle="いまは判定できません（テスト）"
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
    fireEvent.click(screen.getByTestId('judge-button'));
    expect(
      useStore.getState().toasts.filter((t) => t.text === 'いまは判定できません（テスト）'),
    ).toHaveLength(1);
  });

  it('判定中にクリックすると「判定中…」を理由としてトーストで出す', () => {
    render(
      <Toolbar
        mode="wire"
        wireColor="青"
        allowedColors={['青', '白', '黄']}
        camera="front"
        canUndo={false}
        canRedo={false}
        judging
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
    fireEvent.click(screen.getByTestId('judge-button'));
    expect(useStore.getState().toasts.filter((t) => t.text === JA.session.judging)).toHaveLength(1);
  });
});
