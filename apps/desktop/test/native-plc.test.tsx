import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { compile, COIL_COL, DRAFT_SYMBOLS, endNetwork, network, program } from '@ojt/ladder-core';
import { getDialect } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderEditor } from '../src/renderer/ladder/LadderEditor.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { isModalOpen } from '../src/renderer/session/interaction.js';
import { ladderKeyToAction } from '../src/renderer/session/ladder.js';
import { toLadderProgram } from '../src/renderer/session/work-file.js';

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.getState().openProblem(BUILTIN_PLC_PROBLEMS[0]!);
});
afterEach(cleanup);
const state = { mode: 'write' as const, cursor: { networkId: 'n1', row: 0, col: 0 } };
function sharp(): HTMLElement {
  render(
    <LadderEditor
      profile={getDialect('sharp')}
      gridCols={11}
      errorCells={new Set()}
      onConvert={() => undefined}
      onModeChange={(mode) => useStore.getState().setLadderMode(mode)}
    />,
  );
  return screen.getByTestId('ladder-editor');
}

describe('メーカー公式資料を起点にしたキー割当の再発防止', () => {
  it.each([
    ['contact-no', 'S'],
    ['contact-nc', 'D'],
    ['coil', 'X'],
    ['timer', 'V'],
    ['counter', 'C'],
    ['application', 'B'],
    ['insert-network', 'L'],
  ])('SHARP %s = %s（JW-300SP 2-193 / 3-3）', (action, keys) => {
    expect(getDialect('sharp').shortcuts.find((row) => row.action === action)).toMatchObject({
      keys,
      confirmed: true,
      source: 'S8',
    });
  });
  it('OMRONの並列b接点・左右上下罫線はW446-E1-23 p161に従う', () => {
    const keys = getDialect('omron').shortcuts;
    expect(ladderKeyToAction(keys, { key: 'x' }, state)).toEqual({
      type: 'place',
      kind: 'or-contact-nc',
    });
    expect(ladderKeyToAction(keys, { key: 'ArrowLeft', ctrlKey: true }, state)).toEqual({
      type: 'ruleLine',
      direction: 'left',
    });
    expect(ladderKeyToAction(keys, { key: 'ArrowUp', ctrlKey: true }, state)).toEqual({
      type: 'ruleLine',
      direction: 'up',
    });
  });
  it('OMRONのCtrl+Mは監視を切り替える（同p162）', () => {
    const table = getDialect('omron').shortcuts;
    expect(ladderKeyToAction(table, { key: 'm', ctrlKey: true }, state)).toEqual({
      type: 'setMode',
      mode: 'monitor',
    });
    expect(
      ladderKeyToAction(table, { key: 'm', ctrlKey: true }, { ...state, mode: 'monitor' }),
    ).toEqual({ type: 'setMode', mode: 'write' });
  });
  it('Shiftを必要とするキーボードでも | で縦線を描く', () => {
    expect(
      ladderKeyToAction(getDialect('omron').shortcuts, { key: '|', shiftKey: true }, state),
    ).toEqual({ type: 'place', kind: 'vline' });
  });
  it('JTEKTとSHARPへ三菱のF5/F7/F4を流用しない', () => {
    for (const vendor of ['jtekt', 'sharp'] as const) {
      for (const key of ['F5', 'F7', 'F4'])
        expect(ladderKeyToAction(getDialect(vendor).shortcuts, { key }, state)).toEqual({
          type: 'none',
        });
    }
  });
});

describe('純正資料のメニューと編集領域', () => {
  it.each([
    ['mitsubishi', 'プロジェクト 編集 検索 変換 表示 オンライン 診断 ツール ウィンドウ ヘルプ'],
    ['omron', 'ファイル 編集 表示 挿入 PLC プログラム ツール ウィンドウ ヘルプ'],
    ['jtekt', 'ファイル 編集 表示 検索 CPU モニタ 接続 ウィンドウ ME-NET オプション CAD ヘルプ'],
    ['sharp', 'ファイル 編集 表示 オンライン ブロック ツール ウィンドウ ヘルプ'],
  ] as const)('%s のメニュー順を他社の並びへ戻さない', (vendor, labels) => {
    render(
      <LadderWorkspace
        problem={BUILTIN_PLC_PROBLEMS[0]!}
        profile={getDialect(vendor)}
        gridCols={11}
        onPlc={vi.fn()}
      />,
    );
    expect(
      Array.from(screen.getByRole('menubar').querySelectorAll('button'))
        .map((button) => button.textContent)
        .join(' '),
    ).toBe(labels);
    expect(screen.getByTestId('tree-network-n1')).toHaveTextContent('回路 1');
    expect(screen.getByTestId('tree-network-n1')).not.toHaveTextContent('n1');
  });
  it('キーボードでメニューを移動して閉じ、フォーカスと編集操作を戻す', () => {
    render(
      <LadderWorkspace
        problem={BUILTIN_PLC_PROBLEMS[0]!}
        profile={getDialect('mitsubishi')}
        gridCols={11}
        onPlc={vi.fn()}
      />,
    );
    const project = screen.getByTestId('native-menu-project');
    project.focus();
    fireEvent.keyDown(project, { key: 'ArrowRight' });
    const edit = screen.getByTestId('native-menu-edit');
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: 'ArrowDown' });
    expect(screen.getByTestId('native-item-undo')).toHaveFocus();
    expect(isModalOpen()).toBe(true);
    fireEvent.keyDown(screen.getByTestId('native-menu-popup'), { key: 'Escape' });
    expect(edit).toHaveFocus();
    expect(isModalOpen()).toBe(false);
    expect(screen.queryByTestId('native-menu-popup')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('ladder-editor'), { key: 'F5' });
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
  });
});

describe('SHARPの記号先行入力（公式3-3）', () => {
  it('複数の記号を置いてからEnterで入力し、保存と取消でも未入力記号を保つ', () => {
    const editor = sharp();
    fireEvent.keyDown(editor, { key: 's' });
    expect(screen.queryByTestId('device-input')).toBeNull();
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-incomplete', 'true');
    fireEvent.keyDown(editor, { key: 'ArrowRight' });
    fireEvent.keyDown(editor, { key: 'd' });
    const saved = JSON.parse(JSON.stringify(useStore.getState().ladder)) as unknown;
    expect(toLadderProgram(saved)?.program).toEqual(useStore.getState().ladder);
    act(() => {
      useStore.getState().undoLadderEdit();
    });
    expect(useStore.getState().ladder?.networks[0]?.cells[0]?.[1]?.kind).toBe('empty');
    act(() => {
      useStore.getState().redoLadderEdit();
    });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: '000001' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(useStore.getState().ladder?.networks[0]?.cells[0]?.[1]).toMatchObject({
      kind: 'contact',
      type: 'NC',
      device: { kind: 'input', index: 1 },
    });
    expect(useStore.getState().ladder?.networks[0]?.cells[0]?.[0]).toEqual({
      kind: 'draft',
      symbol: 'NO',
    });
  });
  it('出力記号をコイル列に置き、入力取消後も記号を残す', () => {
    const editor = sharp();
    fireEvent.keyDown(editor, { key: 'v' });
    expect(useStore.getState().ladderCursor.col).toBe(COIL_COL);
    expect(useStore.getState().ladder?.networks[0]?.cells[0]?.[COIL_COL]).toEqual({
      kind: 'draft',
      symbol: 'TON',
    });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('device-text'), { key: 'Escape' });
    expect(screen.queryByTestId('device-input')).toBeNull();
    expect(compile(useStore.getState().ladder!).ok).toBe(false);
  });
  it.each(DRAFT_SYMBOLS)('未入力の%sは実行形式へ変換させず、位置と入力方法を返す', (symbol) => {
    const result = compile(program(network('n1', [[{ kind: 'draft', symbol }]]), endNetwork()));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('未入力記号が実行形式へ変換されました');
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'incomplete-symbol',
        networkId: 'n1',
        row: 0,
        col: 0,
      }),
    );
    expect(result.errors.find((issue) => issue.code === 'incomplete-symbol')?.message).toContain(
      'Enter',
    );
  });
  it('未知の記号を作業ファイルから持ち込めない', () => {
    const source = structuredClone(useStore.getState().ladder!);
    source.networks[0]!.cells[0]![0] = { kind: 'draft', symbol: 'unknown' } as never;
    expect(toLadderProgram(source)).toBeUndefined();
  });
});
