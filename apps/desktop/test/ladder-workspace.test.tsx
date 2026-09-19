import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { out, Y } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { ShortcutHelp } from '../src/renderer/ladder/ShortcutHelp.js';
import { applyLadderCell } from '../src/renderer/session/ladder.js';

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

  it('jumps the cursor from the project tree', () => {
    workspace();
    fireEvent.click(screen.getByTestId('toolbar-insert-network'));
    fireEvent.click(screen.getByTestId('tree-network-n2'));
    expect(useStore.getState().ladderCursor).toEqual({ networkId: 'n2', row: 0, col: 0 });
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
    expect(screen.getByTestId('shortcut-application')).toHaveTextContent('Phase 4');
  });

  it('says the table is swapped with the vendor (Phase 4)', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcuts-note')).toHaveTextContent('メーカー');
    // 商標の注記も同じ場所に出す（§17.1）
    expect(screen.getByTestId('shortcuts')).toHaveTextContent('商標');
  });
});
