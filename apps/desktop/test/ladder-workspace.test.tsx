import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { out, Y } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { ShortcutHelp } from '../src/renderer/ladder/ShortcutHelp.js';
import { applyLadderCell } from '../src/renderer/session/ladder.js';
import { toolbarItems } from '../src/renderer/session/plc-skin.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

// このリポジトリの UI テストの流儀（`globals: false` なので自動クリーンアップは効かない）。
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.getState().openProblem(problem);
});

function workspace(onPlc = vi.fn()): typeof onPlc {
  render(
    <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={onPlc} />,
  );
  return onPlc;
}

describe('GX Works3風の枠（§10.6 / §17）', () => {
  it('names the three panels from the profile', () => {
    workspace();
    expect(screen.getByTestId('project-tree')).toHaveAccessibleName(MITSUBISHI_FX5U.panels.tree);
    expect(screen.getByTestId('ladder-editor')).toHaveAccessibleName(MITSUBISHI_FX5U.panels.editor);
    expect(screen.getByTestId('output-window')).toHaveAccessibleName(MITSUBISHI_FX5U.panels.output);
  });

  it('lists the toolbar items the skin names', () => {
    workspace();
    for (const label of MITSUBISHI_FX5U.panels.toolbar) {
      // `name` に文字列を渡すと完全一致なので「変換」と「全変換」を取り違えない
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('has one action per toolbar label, so the position mapping never falls through (Batch 3 レビュー M2)', () => {
    // 項目と意味の対応表（Plan 4B 決定表#2）は長さが合わないと黙って項目を落とすので、
    // 三菱の8件がそのまま出ていることをテストで縛る
    expect(toolbarItems(MITSUBISHI_FX5U).map((item) => item.label)).toEqual([
      ...MITSUBISHI_FX5U.panels.toolbar,
    ]);
  });

  it('converts and sends the ladder to the worker when it succeeds (H-1)', () => {
    const onPlc = workspace();
    fireEvent.click(screen.getByTestId('toolbar-convert'));
    expect(useStore.getState().converted).toBe(true);
    expect(onPlc).toHaveBeenCalledWith({ kind: 'load', program: useStore.getState().ladder });
  });

  it('keeps the ladder unconverted and lists the reason when it fails', () => {
    const onPlc = workspace();
    // コイルを接点列に置くと `coil-column` で落ちる（空のラダーそのものは変換を通る）
    const placed = applyLadderCell(
      useStore.getState().ladder!,
      { networkId: 'n1', row: 0, col: 0 },
      out(Y(0)),
    );
    if (!placed.ok) throw new Error(placed.message);
    useStore.getState().setLadder(placed.program);
    fireEvent.click(screen.getByTestId('toolbar-convert'));
    expect(useStore.getState().converted).toBe(false);
    expect(onPlc).not.toHaveBeenCalled();
    expect(screen.getByTestId('output-row-0')).toHaveTextContent('最終列');
  });

  it('adds and removes networks with buttons, not invented keys (決定表#12)', () => {
    workspace();
    fireEvent.click(screen.getByTestId('toolbar-insert-network'));
    expect(useStore.getState().ladder?.networks.map((n) => n.id)).toEqual(['n1', 'n2', 'end']);
    useStore.getState().setLadderCursor({ networkId: 'n2', row: 0, col: 0 });
    fireEvent.click(screen.getByTestId('toolbar-delete-network'));
    expect(useStore.getState().ladder?.networks.map((n) => n.id)).toEqual(['n1', 'end']);
  });

  it('inserts and deletes rows inside a network', () => {
    workspace();
    fireEvent.click(screen.getByTestId('toolbar-insert-row'));
    expect(useStore.getState().ladder?.networks[0]?.rows).toBe(2);
    fireEvent.click(screen.getByTestId('toolbar-delete-row'));
    expect(useStore.getState().ladder?.networks[0]?.rows).toBe(1);
  });

  it('disables the block/row toolbar buttons outside write mode (Batch 3 レビュー I1)', () => {
    useStore.getState().setLadderMode('monitor');
    workspace();
    for (const testId of [
      'toolbar-insert-network',
      'toolbar-delete-network',
      'toolbar-insert-row',
      'toolbar-delete-row',
    ]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
  });

  it('bails and toasts when the toolbar edit runs outside write mode, exactly as the keyboard readOnly gate does (I1)', () => {
    workspace();
    const button = screen.getByTestId('toolbar-delete-row');
    expect(button).not.toBeDisabled();
    const before = useStore.getState().ladder;
    const count = useStore.getState().toasts.length;
    /*
     * ボタンが `disabled` だと React はクリックのハンドラそのものを呼ばない（disabled は
     * `fiber` に保持された直前レンダーの props を見るので、DOM を直接書き換えても効かない）。
     * それでも `edit()` 自身がモードを見て断ることを確かめるため、モード変更とクリックを
     * 同じ `act()` の中で行い、まだ再描画（disabled の反映）が終わっていない state を使って
     * クリックを通す。`edit()` はクリックの瞬間の最新ストアを読むので、モードは正しく
     * `monitor` として断られる。
     */
    act(() => {
      useStore.getState().setLadderMode('monitor');
      fireEvent.click(button);
    });
    expect(useStore.getState().ladder).toBe(before);
    expect(useStore.getState().toasts.length).toBeGreaterThan(count);
    expect(useStore.getState().toasts.at(-1)?.text).toContain('書込みモード');
  });

  it('jumps the cursor from the project tree', () => {
    workspace();
    fireEvent.click(screen.getByTestId('toolbar-insert-network'));
    fireEvent.click(screen.getByTestId('tree-network-n2'));
    expect(useStore.getState().ladderCursor).toEqual({ networkId: 'n2', row: 0, col: 0 });
  });

  it('reads as a tree, not a bare list (Batch 3 レビュー M8)', () => {
    workspace();
    expect(screen.getByTestId('project-tree').querySelector('ul[role="tree"]')).not.toBeNull();
    expect(
      screen.getByTestId('project-tree').querySelectorAll('[role="treeitem"]').length,
    ).toBeGreaterThan(0);
  });

  it('groups the toolbar without claiming roving focus (Batch 3 レビュー M8)', () => {
    workspace();
    const toolbar = screen.getByRole('group', { name: MITSUBISHI_FX5U.panels.editor });
    expect(toolbar).toBeInTheDocument();
  });

  it('starts and stops monitoring through the worker', () => {
    const onPlc = workspace();
    fireEvent.click(screen.getByTestId('toolbar-monitor-start'));
    expect(useStore.getState().ladderMode).toBe('monitor');
    expect(onPlc).toHaveBeenCalledWith({ kind: 'monitor', on: true });
    fireEvent.click(screen.getByTestId('toolbar-monitor-stop'));
    expect(useStore.getState().ladderMode).toBe('read');
    expect(onPlc).toHaveBeenCalledWith({ kind: 'monitor', on: false });
  });
});

describe('キー割当表（§12.1 / §17.1）', () => {
  it('shows every shortcut the profile declares', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    // 行だけが `shortcut-<action>`。入れ物は `shortcuts` / `shortcuts-note` で、この正規表現に
    // 引っかからない（`shortcut-help` / `shortcut-note` だと件数が2件増える）
    expect(screen.getAllByTestId(/^shortcut-/u)).toHaveLength(MITSUBISHI_FX5U.shortcuts.length);
    expect(screen.getByTestId('shortcut-contact-no')).toHaveTextContent('F5');
  });

  it('marks the assumed bindings with the §12.1 notice', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcut-convert')).toHaveTextContent('本アプリの表記');
    expect(screen.getByTestId('shortcut-contact-no')).not.toHaveTextContent('本アプリの表記');
  });

  it('greys out and explains the entry Phase 3 cannot place', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcut-application')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('shortcut-application')).toHaveTextContent('応用命令');
  });

  it('says the table is swapped with the vendor (Phase 4)', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcuts-note')).toHaveTextContent('メーカー');
    // 商標の注記も同じ場所に出す（§17.1）
    expect(screen.getByTestId('shortcuts')).toHaveTextContent('商標');
  });

  it('names its columns with a <thead> and scope="col" (Batch 3 レビュー M8)', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    const headers = screen.getByTestId('shortcuts').querySelectorAll('thead th[scope="col"]');
    expect(headers.length).toBe(3);
  });
});
