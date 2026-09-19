import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import {
  applyEdit,
  emptySchematic,
  type CellDraft,
  type SchematicDocument,
} from '@ojt/schematic-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { SchematicEditor } from '../src/renderer/schematic/SchematicEditor.js';
import { SchematicSvg } from '../src/renderer/schematic/SchematicSvg.js';
import type { EditorCursor } from '../src/renderer/session/schematic-edit.js';

const found = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (found === undefined) throw new Error('b-001 が見つかりません');
/** 巻き上げられる関数宣言の中でも `undefined` を外した型でいるように、別名にしてから使う。 */
const problem = found;

afterEach(() => {
  cleanup();
});

describe('SchematicSvg: 読取専用のふるまいは変わらない', () => {
  it('draws no slot rects without the editing props', () => {
    render(<SchematicSvg document={problem.schematic} />);
    expect(screen.getByTestId('schematic-svg').querySelectorAll('[data-slot]')).toHaveLength(0);
  });

  it('still reports the clicked cell through onPickCell', () => {
    const onPickCell = vi.fn();
    render(<SchematicSvg document={problem.schematic} onPickCell={onPickCell} />);
    const symbol = screen.getByTestId('schematic-svg').querySelector('[data-cell]');
    expect(symbol).not.toBeNull();
    if (symbol === null) return;
    fireEvent.click(symbol);
    expect(onPickCell).toHaveBeenCalledWith(symbol.getAttribute('data-cell'));
  });
});

describe('SchematicSvg: 編集モード', () => {
  it('draws one rect per slot and reports the rung, the column and the cell that is there', () => {
    const onPickSlot = vi.fn();
    render(
      <SchematicSvg
        document={problem.schematic}
        cursor={{ rungId: 'r1', index: 0 }}
        onPickSlot={onPickSlot}
      />,
    );
    const slots = screen.getByTestId('schematic-svg').querySelectorAll('[data-slot]');
    // 段ごとに「要素数 ＋ 1」個（b-001 は 4 ＋ 2 ＋ 3 ＝ 9）
    expect(slots).toHaveLength(problem.schematic.rungs.reduce((n, r) => n + r.cells.length + 1, 0));
    const first = slots[0];
    if (first === undefined) return;
    fireEvent.click(first);
    // b-001 の段 r1 の桁0 は PB2 の b接点（要素ID `c01`）
    expect(onPickSlot).toHaveBeenCalledWith('r1', 0, 'c01');
  });

  it('reports undefined for the empty tail slot', () => {
    const onPickSlot = vi.fn();
    render(
      <SchematicSvg
        document={problem.schematic}
        cursor={{ rungId: 'r1', index: 0 }}
        onPickSlot={onPickSlot}
      />,
    );
    const tail = screen.getByTestId('schematic-svg').querySelector('[data-slot="r1#3"]');
    expect(tail).not.toBeNull();
    if (tail === null) return;
    fireEvent.click(tail);
    expect(onPickSlot).toHaveBeenCalledWith('r1', 3, undefined);
  });

  it('marks the cursor slot so the trainee can see where the next element goes', () => {
    render(
      <SchematicSvg
        document={problem.schematic}
        cursor={{ rungId: 'r1', index: 1 }}
        onPickSlot={vi.fn()}
      />,
    );
    const marked = screen.getByTestId('schematic-svg').querySelectorAll('[data-cursor="true"]');
    expect(marked).toHaveLength(1);
  });
});

describe('SchematicEditor', () => {
  function renderEditor(overrides: Partial<Parameters<typeof SchematicEditor>[0]> = {}) {
    const props = {
      problem,
      board: JIPM_BOARD,
      document: emptySchematic('draft-b-001', '下書き'),
      cursor: { rungId: 'r1', index: 0 },
      history: { done: [], undone: [] },
      verifying: false,
      onEdit: vi.fn(() => true),
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
      ...overrides,
    };
    render(<SchematicEditor {...props} />);
    return props;
  }

  it('lists the palette grouped by device kind', () => {
    renderEditor();
    expect(screen.getByTestId('schematic-palette')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /押ボタン a接点 PB1/u })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /コイル CR1/u })).toBeInTheDocument();
  });

  it('places the selected palette item when a slot is clicked', () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /押ボタン a接点 PB1/u }));
    const slot = screen.getByTestId('schematic-svg').querySelector('[data-slot]');
    if (slot === null) return;
    fireEvent.click(slot);
    expect(props.onEdit).toHaveBeenCalledWith({
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
  });

  it('shows the structural issues of a half-finished drawing (決定表#3)', () => {
    renderEditor();
    expect(screen.getByTestId('schematic-issues')).toHaveTextContent('段に要素がありません');
  });

  it('disables 検算 while the drawing is not valid and while verifying', () => {
    renderEditor();
    expect(screen.getByTestId('verify-button')).toBeDisabled();
    cleanup();
    renderEditor({ document: problem.schematic });
    expect(screen.getByTestId('verify-button')).toBeEnabled();
    cleanup();
    renderEditor({ document: problem.schematic, verifying: true });
    expect(screen.getByTestId('verify-button')).toBeDisabled();
  });

  it('shows the step guide with 描く as the current step', () => {
    renderEditor();
    expect(screen.getByTestId('schematic-step-guide')).toHaveTextContent('回路図を描く');
  });

  it('moves the cursor with the arrow keys and places with Enter', () => {
    const props = renderEditor({
      document: problem.schematic,
      cursor: { rungId: problem.schematic.rungs[0]?.id ?? 'r1', index: 0 },
    });
    const grid = screen.getByTestId('schematic-grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(props.onCursor).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /表示灯 PL1/u }));
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'insertCell' }));
  });

  it('never leaks the reference circuit into the draft (決定表#2)', () => {
    renderEditor();
    // 空の下書きしか描いていない。模範回路の要素IDは1つも出ない
    const ids = [...screen.getByTestId('schematic-svg').querySelectorAll('[data-cell]')];
    expect(ids).toHaveLength(0);
  });

  it('lights the element instead of editing when no palette item is selected (B2)', () => {
    const props = renderEditor({ document: problem.schematic });
    const slot = screen.getByTestId('schematic-svg').querySelector('[data-slot="r1#0"]');
    if (slot === null) return;
    fireEvent.click(slot);
    expect(props.onPickCell).toHaveBeenCalledWith('c01');
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it('replaces the element under an occupied slot when a palette item is selected (B2)', () => {
    const props = renderEditor({ document: problem.schematic });
    fireEvent.click(screen.getByRole('button', { name: /表示灯 PL1/u }));
    const slot = screen.getByTestId('schematic-svg').querySelector('[data-slot="r1#0"]');
    if (slot === null) return;
    fireEvent.click(slot);
    expect(props.onEdit).toHaveBeenCalledWith({
      kind: 'replaceCell',
      cellId: 'c01',
      draft: { kind: 'lamp', device: 'PL1' },
    });
  });
});

describe('SchematicEditor: 分岐（受入基準①）', () => {
  /** 段1 ＝ PB2 b接点 → PB1 a接点 → CR1 コイル、段2 ＝ CR1 a接点（まだ P→N）。 */
  function twoRungs(): SchematicDocument {
    let doc = emptySchematic('draft-b-001', '下書き');
    const place = (rungId: string, draft: CellDraft): void => {
      const target = doc.rungs.find((r) => r.id === rungId);
      const step = applyEdit(doc, {
        kind: 'insertCell',
        rungId,
        index: target?.cells.length ?? 0,
        draft,
      });
      if (step.ok) doc = step.doc;
    };
    place('r1', { kind: 'pb-b', device: 'PB2' });
    place('r1', { kind: 'pb-a', device: 'PB1' });
    place('r1', { kind: 'coil', device: 'CR1' });
    const added = applyEdit(doc, { kind: 'addRung' });
    if (added.ok) doc = added.doc;
    place('r2', { kind: 'cr-a', device: 'CR1' });
    return doc;
  }

  function renderBranchEditor(cursor = { rungId: 'r2', index: 0 }) {
    const props = {
      problem,
      board: JIPM_BOARD,
      document: twoRungs(),
      cursor,
      history: { done: [], undone: [] },
      verifying: false,
      onEdit: vi.fn(() => true),
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
      onNotice: vi.fn(),
    };
    render(<SchematicEditor {...props} />);
    return props;
  }

  it('says why 分岐 is not available on a rung that carries a load', () => {
    renderBranchEditor({ rungId: 'r1', index: 0 });
    const button = screen.getByTestId('branch-button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('分岐にできません'));
  });

  it('guides the trainee through the two picks and emits one setEnds edit', () => {
    const props = renderBranchEditor();
    fireEvent.click(screen.getByTestId('branch-button'));
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の始点');
    const svg = screen.getByTestId('schematic-svg');
    const from = svg.querySelector('[data-slot="r1#1"]');
    const to = svg.querySelector('[data-slot="r1#2"]');
    if (from === null || to === null) return;
    fireEvent.click(from);
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の終点');
    expect(props.onEdit).not.toHaveBeenCalled();
    fireEvent.click(to);
    expect(props.onEdit).toHaveBeenCalledWith({
      kind: 'setEnds',
      rungId: 'r2',
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
    // 分岐が終わったら案内は手順帯に戻る
    expect(screen.queryByTestId('branch-hint')).toBeNull();
  });

  it('refuses a node of the rung being branched and stays in branch mode', () => {
    const props = renderBranchEditor();
    fireEvent.click(screen.getByTestId('branch-button'));
    const own = screen.getByTestId('schematic-svg').querySelector('[data-slot="r2#0"]');
    if (own === null) return;
    fireEvent.click(own);
    expect(props.onRefuse).toHaveBeenCalledWith(expect.stringContaining('ほかの段の節点'));
    expect(props.onEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の始点');
  });

  it('cancels the branch with Escape and with the button', () => {
    renderBranchEditor();
    fireEvent.click(screen.getByTestId('branch-button'));
    fireEvent.keyDown(screen.getByTestId('schematic-grid'), { key: 'Escape' });
    expect(screen.queryByTestId('branch-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('branch-button'));
    fireEvent.click(screen.getByTestId('branch-button'));
    expect(screen.queryByTestId('branch-hint')).toBeNull();
  });

  it('finishes the branch from the keyboard alone (§15 のアクセシビリティ)', () => {
    const onEdit = vi.fn(() => true);
    const base = {
      problem,
      board: JIPM_BOARD,
      document: twoRungs(),
      history: { done: [], undone: [] },
      verifying: false,
      onEdit,
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
    };
    const { rerender } = render(<SchematicEditor {...base} cursor={{ rungId: 'r2', index: 0 }} />);
    // 分岐にする段は、ボタンを押したときにカーソルがある段（r2）
    fireEvent.click(screen.getByTestId('branch-button'));
    // 親が矢印キーでカーソルを段1の節点1へ動かす（カーソルはストアが持つ）
    rerender(<SchematicEditor {...base} cursor={{ rungId: 'r1', index: 1 }} />);
    fireEvent.keyDown(screen.getByTestId('schematic-grid'), { key: 'Enter' });
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の終点');
    expect(onEdit).not.toHaveBeenCalled();
    rerender(<SchematicEditor {...base} cursor={{ rungId: 'r1', index: 2 }} />);
    fireEvent.keyDown(screen.getByTestId('schematic-grid'), { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith({
      kind: 'setEnds',
      rungId: 'r2',
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
  });
});

describe('SchematicEditor: 設定時間（レビュー B1）', () => {
  const flicker = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-006');
  if (flicker === undefined) throw new Error('b-006 が見つかりません');
  const timerProblem = flicker;

  /** タイマコイル1個だけの下書き（桁0がコイル、桁1が末尾の空き）。 */
  function timerDoc(presetMs?: number): SchematicDocument {
    const step = applyEdit(emptySchematic('draft-b-006', '下書き'), {
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: {
        kind: 'coil',
        device: 'T1',
        ...(presetMs === undefined ? {} : { presetMs }),
      },
    });
    if (!step.ok) throw new Error(step.message);
    return step.doc;
  }

  function renderTimer(overrides: { document?: SchematicDocument; cursor?: EditorCursor } = {}) {
    const props = {
      problem: timerProblem,
      board: JIPM_BOARD,
      document: overrides.document ?? timerDoc(),
      cursor: overrides.cursor ?? { rungId: 'r1', index: 0 },
      history: { done: [], undone: [] },
      verifying: false,
      onEdit: vi.fn(() => true),
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
    };
    render(<SchematicEditor {...props} />);
    return props;
  }

  /** その下書きの最初の要素のID。 */
  function firstCellId(doc: SchematicDocument): string {
    const id = doc.rungs[0]?.cells[0]?.id;
    if (id === undefined) throw new Error('要素がありません');
    return id;
  }

  it('offers the field only while the cursor is on a timer coil', () => {
    renderTimer();
    expect(screen.getByTestId('schematic-preset')).toBeInTheDocument();
    // 置いた直後は既定の 3.0 秒。これを変えられないと b-006（0.8秒）は描けない
    expect(screen.getByTestId('preset-value')).toHaveTextContent('3.0 秒');
    cleanup();
    // 末尾の空き桁にはタイマコイルが無いので欄も出ない
    renderTimer({ cursor: { rungId: 'r1', index: 1 } });
    expect(screen.queryByTestId('schematic-preset')).toBeNull();
  });

  it('sends setPreset when the seconds are typed in', () => {
    const doc = timerDoc();
    const props = renderTimer({ document: doc });
    fireEvent.change(screen.getByTestId('preset-input'), { target: { value: '0.8' } });
    expect(props.onEdit).toHaveBeenCalledWith({
      kind: 'setPreset',
      cellId: firstCellId(doc),
      presetMs: 800,
    });
  });

  it('sends nothing while the number is half typed', () => {
    const props = renderTimer();
    fireEvent.change(screen.getByTestId('preset-input'), { target: { value: '0.' } });
    fireEvent.change(screen.getByTestId('preset-input'), { target: { value: '' } });
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it('steps by 0.1 s and says why it cannot go further', () => {
    const doc = timerDoc();
    const props = renderTimer({ document: doc });
    fireEvent.click(screen.getByTestId('preset-up'));
    expect(props.onEdit).toHaveBeenCalledWith({
      kind: 'setPreset',
      cellId: firstCellId(doc),
      presetMs: 3100,
    });
    cleanup();
    renderTimer({ document: timerDoc(10_000) });
    const up = screen.getByTestId('preset-up');
    expect(up).toBeDisabled();
    expect(up).toHaveAttribute('title', JA.schematic.presetAtMax);
    cleanup();
    renderTimer({ document: timerDoc(100) });
    const down = screen.getByTestId('preset-down');
    expect(down).toBeDisabled();
    expect(down).toHaveAttribute('title', JA.schematic.presetAtMin);
  });

  it('never lets a key typed in the field edit the drawing (決定表#25)', () => {
    const doc = timerDoc();
    const props = renderTimer({ document: doc });
    const field = screen.getByTestId('preset-input');
    for (const key of ['Delete', 'Backspace', 'Insert', 'ArrowRight', 'Enter']) {
      fireEvent.keyDown(field, { key });
    }
    expect(props.onEdit).not.toHaveBeenCalled();
    expect(props.onCursor).not.toHaveBeenCalled();
    // 止めているのは入力欄からのぶんだけ（図の上では今までどおり効く）
    fireEvent.keyDown(screen.getByTestId('schematic-grid'), { key: 'Delete' });
    expect(props.onEdit).toHaveBeenCalledWith({ kind: 'removeCell', cellId: firstCellId(doc) });
  });
});

describe('SchematicEditor: 押せない理由と「全部消す」（レビュー Minor）', () => {
  function renderEditor(overrides: Partial<Parameters<typeof SchematicEditor>[0]> = {}) {
    const props = {
      problem,
      board: JIPM_BOARD,
      document: emptySchematic('draft-b-001', '下書き'),
      cursor: { rungId: 'r1', index: 0 },
      history: { done: [], undone: [] },
      verifying: false,
      onEdit: vi.fn(() => true),
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
      ...overrides,
    };
    render(<SchematicEditor {...props} />);
    return props;
  }

  it('says in Japanese why 段を削除 cannot be pressed on the last rung', () => {
    renderEditor();
    const remove = screen.getByTestId('remove-rung-button');
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', JA.schematic.removeRungLast);
    const add = screen.getByTestId('add-rung-button');
    expect(add).toBeEnabled();
    expect(add).toHaveAttribute('title', JA.schematic.addRungHint);
  });

  it('asks before it throws the whole drawing away', () => {
    const onClear = vi.fn();
    renderEditor({ document: problem.schematic, onClear });
    fireEvent.click(screen.getByTestId('clear-button'));
    expect(screen.getByTestId('clear-confirm')).toHaveTextContent(JA.schematic.clearConfirm);
    fireEvent.click(screen.getByTestId('clear-no'));
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.queryByTestId('clear-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('clear-button'));
    fireEvent.click(screen.getByTestId('clear-yes'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('cannot clear a drawing that is still empty', () => {
    renderEditor({ onClear: vi.fn() });
    const clear = screen.getByTestId('clear-button');
    expect(clear).toBeDisabled();
    expect(clear).toHaveAttribute('title', JA.schematic.clearNothing);
  });

  it('names the cursor position without internal ids', () => {
    const second = problem.schematic.rungs[1];
    if (second === undefined) throw new Error('2段目がありません');
    renderEditor({ document: problem.schematic, cursor: { rungId: second.id, index: 0 } });
    const line = screen.getByTestId('schematic-cursor');
    expect(line).toHaveTextContent(`${JA.schematic.cursor}: 2段目の1番目`);
    expect(line.textContent ?? '').not.toMatch(/\b[rc]\d/u);
  });
});

describe('SchematicEditor: 分岐の分岐と循環（レビュー Minor）', () => {
  /** 段1 ＝ PB2b → PB1a → CR1コイル、段2・段3 ＝ 接点1個ずつ（まだ P→N）。 */
  function threeRungs(): SchematicDocument {
    let doc = emptySchematic('draft-b-001', '下書き');
    const step = (edit: Parameters<typeof applyEdit>[1]): void => {
      const out = applyEdit(doc, edit);
      if (!out.ok) throw new Error(out.message);
      doc = out.doc;
    };
    for (const draft of [
      { kind: 'pb-b', device: 'PB2' },
      { kind: 'pb-a', device: 'PB1' },
      { kind: 'coil', device: 'CR1' },
    ] as CellDraft[]) {
      step({ kind: 'insertCell', rungId: 'r1', index: doc.rungs[0]?.cells.length ?? 0, draft });
    }
    step({ kind: 'addRung' });
    step({ kind: 'insertCell', rungId: 'r2', index: 0, draft: { kind: 'cr-a', device: 'CR1' } });
    step({ kind: 'addRung' });
    step({ kind: 'insertCell', rungId: 'r3', index: 0, draft: { kind: 'cr-b', device: 'CR1' } });
    return doc;
  }

  function clickSlot(slot: string): void {
    const target = screen.getByTestId('schematic-svg').querySelector(`[data-slot="${slot}"]`);
    if (target === null) throw new Error(`桁がありません: ${slot}`);
    fireEvent.click(target);
  }

  it('draws a branch of a branch and refuses the loop that would close the circle', () => {
    let doc = threeRungs();
    // 本物の編集規則で受け答えする（断りは `applyEdit()` が出す）
    const onEdit = vi.fn((edit: Parameters<typeof applyEdit>[1]) => {
      const out = applyEdit(doc, edit);
      if (out.ok) doc = out.doc;
      return out.ok;
    });
    const onNotice = vi.fn();
    const base = {
      problem,
      board: JIPM_BOARD,
      history: { done: [], undone: [] },
      verifying: false,
      onEdit,
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
      onNotice,
    };
    const { rerender } = render(
      <SchematicEditor {...base} document={doc} cursor={{ rungId: 'r2', index: 0 }} />,
    );
    // ①段2を段1の分岐にする
    fireEvent.click(screen.getByTestId('branch-button'));
    clickSlot('r1#1');
    clickSlot('r1#2');
    expect(onNotice).toHaveBeenCalledWith(JA.schematic.branchDone);
    expect(screen.queryByTestId('branch-hint')).toBeNull();

    // ②段3を「分岐である段2」の分岐にする（分岐の分岐は描ける）
    rerender(<SchematicEditor {...base} document={doc} cursor={{ rungId: 'r3', index: 0 }} />);
    fireEvent.click(screen.getByTestId('branch-button'));
    clickSlot('r2#0');
    clickSlot('r2#1');
    expect(onNotice).toHaveBeenCalledTimes(2);
    expect(doc.rungs[2]?.from).toEqual({ rung: 'r2', node: 0 });

    // ③段2を段3の分岐にすると輪になる。断られ、分岐の指定は始点から続く
    rerender(<SchematicEditor {...base} document={doc} cursor={{ rungId: 'r2', index: 0 }} />);
    fireEvent.click(screen.getByTestId('branch-button'));
    clickSlot('r3#0');
    clickSlot('r3#1');
    expect(onNotice).toHaveBeenCalledTimes(2);
    expect(doc.rungs[1]?.from).toEqual({ rung: 'r1', node: 1 });
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の始点');
  });

  it('says the branch was dropped when the editor goes away (F2)', () => {
    const onNotice = vi.fn();
    render(
      <SchematicEditor
        problem={problem}
        board={JIPM_BOARD}
        document={threeRungs()}
        cursor={{ rungId: 'r2', index: 0 }}
        history={{ done: [], undone: [] }}
        verifying={false}
        onEdit={vi.fn(() => true)}
        onCursor={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onVerify={vi.fn()}
        onPickCell={vi.fn()}
        onRefuse={vi.fn()}
        onNotice={onNotice}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-button'));
    expect(screen.getByTestId('branch-hint')).toBeInTheDocument();
    // 画面を切り替える（F2）とこの部品は消える。指定しかけの分岐は黙って消さない
    cleanup();
    expect(onNotice).toHaveBeenCalledWith(JA.schematic.branchAborted);
  });
});
