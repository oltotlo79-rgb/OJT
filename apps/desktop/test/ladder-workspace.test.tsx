import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { out, Y } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
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
  useStore.setState({ toasts: [] });
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

  /**
   * UI監査 2026-09-20 Important #9 / I2: 「変換に成功しました」が出力ウィンドウとトーストの
   * 2か所に同時に出ていた。出力ウィンドウの見出し（`convert-state`）だけに一本化する。
   */
  it('does not toast on a successful convert (the output window already says so)', () => {
    workspace();
    const before = useStore.getState().toasts.length;
    fireEvent.click(screen.getByTestId('toolbar-convert'));
    expect(useStore.getState().converted).toBe(true);
    expect(useStore.getState().toasts).toHaveLength(before);
    expect(screen.getByTestId('convert-state')).toHaveTextContent('変換に成功');
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

  it('explains a row-limit error without exposing the internal network id', () => {
    workspace();
    for (let i = 0; i < 20; i += 1) fireEvent.click(screen.getByTestId('toolbar-insert-row'));
    const text = useStore.getState().toasts.at(-1)?.text ?? '';
    expect(text).toContain('20行');
    expect(text).not.toContain('n1');
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

  it('starts monitoring, then restores write mode on stop (UI batch F: モニタ停止後も編集に戻れる)', () => {
    const onPlc = workspace();
    fireEvent.click(screen.getByTestId('toolbar-monitor-start'));
    expect(useStore.getState().ladderMode).toBe('monitor');
    expect(onPlc).toHaveBeenCalledWith({ kind: 'monitor', on: true });
    fireEvent.click(screen.getByTestId('toolbar-monitor-stop'));
    // 以前は `read` に落ち、write-mode ボタンの無いスキン（PCwin風／JW-300SP風）では
    // 二度と編集へ戻せなかった（UI監査 2026-09-20 `modeD-jtekt/sharp-output-error`）。
    expect(useStore.getState().ladderMode).toBe('write');
    expect(onPlc).toHaveBeenCalledWith({ kind: 'monitor', on: false });
  });
});

/**
 * 指摘 LE-3: END セルは上書き・削除できない。初期カーソルは `n1` の (0,0) で、`↓` を1回押すと
 * END ネットワークの (0,0) に入る（END ネットワークは1行）。そこで `Delete` や記号キーを押すと、
 * 以前は END が消えて `compile()` が missing-end を返し続け、二度と変換できなくなっていた。
 */
describe('END セルの保護（§10.3 / 指摘 LE-3・LC-1）', () => {
  function moveCursorToEnd(): void {
    useStore.getState().setLadderCursor({ networkId: 'end', row: 0, col: 0 });
  }

  it('keeps END alive against Delete', () => {
    workspace();
    moveCursorToEnd();
    fireEvent.keyDown(screen.getByTestId('ladder-editor'), { key: 'Delete' });
    const endNet = useStore.getState().ladder!.networks.find((n) => n.id === 'end')!;
    expect(endNet.cells[0]![0]!.kind).toBe('end');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('END は消せません');
  });

  it('keeps END alive against a direct symbol key (F9: hline) and compile() still finds it', () => {
    workspace();
    moveCursorToEnd();
    fireEvent.keyDown(screen.getByTestId('ladder-editor'), { key: 'F9' });
    const endNet = useStore.getState().ladder!.networks.find((n) => n.id === 'end')!;
    expect(endNet.cells[0]![0]!.kind).toBe('end');
    // 変換してみても missing-end にならない（END は消えていない）
    fireEvent.click(screen.getByTestId('toolbar-convert'));
    expect(useStore.getState().converted).toBe(true);
  });

  it('keeps END alive against a device-input commit (F5: a-contact) landing on it', () => {
    workspace();
    moveCursorToEnd();
    fireEvent.keyDown(screen.getByTestId('ladder-editor'), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const endNet = useStore.getState().ladder!.networks.find((n) => n.id === 'end')!;
    expect(endNet.cells[0]![0]!.kind).toBe('end');
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

  /**
   * Phase 7 Task 20: 三菱の表で △（一次資料未確認）なのは微分接点の2行だけになった。
   * 裏が取れた行には代わりに出典の記号（S1、S3 など）を添える。
   */
  it('marks the assumed bindings with the §12.1 notice and cites a source for the rest', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcut-pulse-rise')).toHaveTextContent('本アプリの表記');
    expect(screen.getByTestId('shortcut-contact-no')).not.toHaveTextContent('本アプリの表記');
    expect(screen.getByTestId('shortcut-contact-no')).toHaveTextContent('出典 S1');
    expect(screen.getByTestId('shortcut-convert')).toHaveTextContent('出典 S3');
  });

  /** 指摘 LE-8: 三菱の表に「押しても効かない行」はもう1つも無い。 */
  it('greys out only the rows that really do nothing', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcut-application')).toHaveAttribute('data-enabled', 'true');
    expect(screen.getByTestId('shortcut-application')).toHaveTextContent('応用命令');
    cleanup();
    // CX-Programmer風のオンライン操作だけが淡色（本アプリは通信しない）
    render(<ShortcutHelp profile={OMRON_CP1E} />);
    expect(screen.getByTestId('shortcut-online-edit')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('shortcut-online-edit')).toHaveTextContent('通信しない');
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

/**
 * Phase 7 Task 21: 入口B（ツールバーの記号ボタン列）。設計 §5.3 / 指摘 UX-02
 * キーと同じ入口（回路入力欄）へ入り、**ボタン名にはキーを併記する**。
 */
describe('記号ボタン列（Phase 7 設計 §5.3 の入口B）', () => {
  it('writes the dialect key next to every symbol button', () => {
    workspace();
    expect(screen.getByTestId('symbol-contact-no')).toHaveTextContent('a接点 (F5)');
    expect(screen.getByTestId('symbol-contact-nc')).toHaveTextContent('b接点 (F6)');
    expect(screen.getByTestId('symbol-coil')).toHaveTextContent('コイル（OUT） (F7)');
    expect(screen.getByTestId('symbol-application')).toHaveTextContent('応用命令 (F8)');
  });

  it('follows the dialect when the maker changes (OMRON は1文字キー)', () => {
    render(
      <LadderWorkspace problem={problem} profile={OMRON_CP1E} gridCols={11} onPlc={vi.fn()} />,
    );
    expect(screen.getByTestId('symbol-contact-no')).toHaveTextContent('a接点 (C)');
    // OMRON の「命令入力」は三菱の応用命令と同じ欄（`instruction` の行）
    expect(screen.getByTestId('symbol-application')).toHaveTextContent('応用命令 (I)');
  });

  it('opens the same entry the key opens, and places through it', () => {
    workspace();
    fireEvent.click(screen.getByTestId('symbol-contact-no'));
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('direct-text'), { target: { value: 'LD X0' } });
    fireEvent.keyDown(screen.getByTestId('direct-text'), { key: 'Enter' });
    const net = useStore.getState().ladder!.networks[0]!;
    expect(net.cells[0]![0]).toMatchObject({ kind: 'contact', type: 'NO' });
  });

  it('places a rule line without opening the entry, and deletes with the 削除 button', () => {
    workspace();
    fireEvent.click(screen.getByTestId('symbol-hline'));
    expect(screen.queryByTestId('device-input')).toBeNull();
    expect(useStore.getState().ladder!.networks[0]!.cells[0]![0]).toMatchObject({ kind: 'hline' });
    fireEvent.click(screen.getByTestId('symbol-delete'));
    expect(useStore.getState().ladder!.networks[0]!.cells[0]![0]).toMatchObject({ kind: 'empty' });
  });

  it('disables the symbol buttons outside the write mode (決定表#11)', () => {
    workspace();
    act(() => {
      useStore.getState().setLadderMode('monitor');
    });
    expect(screen.getByTestId('symbol-contact-no')).toBeDisabled();
  });

  it('lets only the JW-300SP style drag a symbol onto the grid (設計 §5.2 の S8)', () => {
    render(
      <LadderWorkspace problem={problem} profile={SHARP_JW300} gridCols={11} onPlc={vi.fn()} />,
    );
    expect(screen.getByTestId('symbol-contact-no')).toHaveAttribute('draggable', 'true');
    cleanup();
    workspace();
    expect(screen.getByTestId('symbol-contact-no')).toHaveAttribute('draggable', 'false');
  });
});
