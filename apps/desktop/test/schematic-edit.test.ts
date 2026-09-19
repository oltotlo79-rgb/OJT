import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import {
  applyEdit,
  emptySchematic,
  type CellDraft,
  type SchematicDocument,
} from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import {
  branchDisabledReason,
  branchStepHint,
  clampCursor,
  emptySchematicHistory,
  keyToEdit,
  moveCursor,
  paletteFor,
  pickBranchNode,
  pushSchematic,
  redoSchematic,
  SCHEMATIC_HISTORY_LIMIT,
  undoSchematic,
  type BranchDraft,
  type EditorCursor,
} from '../src/renderer/session/schematic-edit.js';
import { schematicStepHint, schematicSteps } from '../src/renderer/session/step-guide.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

/** PB1 a接点 → CR1 コイル の1段だけ置いた文書。 */
function oneRung(): SchematicDocument {
  let doc = emptySchematic('draft', '下書き');
  for (const draft of [
    { kind: 'pb-a' as const, device: 'PB1' },
    { kind: 'coil' as const, device: 'CR1' },
  ]) {
    const step = applyEdit(doc, {
      kind: 'insertCell',
      rungId: 'r1',
      index: doc.rungs[0]?.cells.length ?? 0,
      draft,
    });
    if (step.ok) doc = step.doc;
  }
  return doc;
}

describe('paletteFor（決定表#26）', () => {
  it('offers only the devices that the board of this problem has', () => {
    const items = paletteFor(problem, JIPM_BOARD);
    const devices = [...new Set(items.map((i) => i.device))];
    expect(devices).toContain('PB1');
    expect(devices).toContain('CR1');
    expect(devices).toContain('PL1');
    // BZ は課題が extraParts で足したときだけ
    expect(devices).not.toContain('BZ');
  });

  it('offers BZ when the problem adds it', () => {
    const withBuzzer = { ...problem, board: { ...problem.board, extraParts: ['BZ' as const] } };
    expect(paletteFor(withBuzzer, JIPM_BOARD).some((i) => i.device === 'BZ')).toBe(true);
  });

  it('offers only the socket roles that the problem assigns', () => {
    const twoSockets = {
      ...problem,
      board: { ...problem.board, socketRoles: { S1: 'CR1' as const, S2: 'T1' as const } },
    };
    const devices = [...new Set(paletteFor(twoSockets, JIPM_BOARD).map((i) => i.device))];
    expect(devices).toContain('CR1');
    expect(devices).toContain('T1');
    expect(devices).not.toContain('CR2');
  });

  it('labels every item in Japanese and keeps a stable order', () => {
    const items = paletteFor(problem, JIPM_BOARD);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.id).toBe(`${item.kind}:${item.device}`);
    }
    expect(paletteFor(problem, JIPM_BOARD).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
});

describe('moveCursor / clampCursor', () => {
  const doc = oneRung();
  const start: EditorCursor = { rungId: 'r1', index: 0 };

  it('moves right up to the empty tail slot', () => {
    expect(moveCursor(doc, start, 'ArrowRight')).toEqual({ rungId: 'r1', index: 1 });
    expect(moveCursor(doc, { rungId: 'r1', index: 2 }, 'ArrowRight')).toEqual({
      rungId: 'r1',
      index: 2,
    });
  });

  it('moves left down to zero', () => {
    expect(moveCursor(doc, start, 'ArrowLeft')).toEqual(start);
    expect(moveCursor(doc, { rungId: 'r1', index: 2 }, 'ArrowLeft')).toEqual({
      rungId: 'r1',
      index: 1,
    });
  });

  it('moves between rungs and clamps the column', () => {
    const two = applyEdit(doc, { kind: 'addRung' });
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(moveCursor(two.doc, { rungId: 'r1', index: 2 }, 'ArrowDown')).toEqual({
      rungId: 'r2',
      index: 0,
    });
    expect(moveCursor(two.doc, { rungId: 'r2', index: 0 }, 'ArrowUp')).toEqual({
      rungId: 'r1',
      index: 0,
    });
  });

  it('clamps a cursor that points outside the document', () => {
    expect(clampCursor(doc, { rungId: 'r9', index: 7 })).toEqual({ rungId: 'r1', index: 0 });
    expect(clampCursor(doc, { rungId: 'r1', index: 9 })).toEqual({ rungId: 'r1', index: 2 });
  });
});

describe('keyToEdit（決定表#25）', () => {
  const doc = oneRung();
  const palette = paletteFor(problem, JIPM_BOARD);
  const selected = palette.find((i) => i.kind === 'lamp');
  if (selected === undefined) throw new Error('パレットに表示灯がありません');

  it('places the selected palette item on Enter', () => {
    const edit = keyToEdit(doc, { rungId: 'r1', index: 2 }, 'Enter', selected);
    expect(edit).toEqual({
      kind: 'insertCell',
      rungId: 'r1',
      index: 2,
      draft: { kind: 'lamp', device: selected.device },
    });
  });

  it('does nothing on Enter when no palette item is selected', () => {
    expect(keyToEdit(doc, { rungId: 'r1', index: 2 }, 'Enter', undefined)).toBeUndefined();
  });

  it('removes the cell under the cursor on Delete and Backspace', () => {
    for (const key of ['Delete', 'Backspace']) {
      expect(keyToEdit(doc, { rungId: 'r1', index: 0 }, key, selected)).toEqual({
        kind: 'removeCell',
        cellId: 'c1',
      });
    }
  });

  it('does nothing on Delete over the empty tail slot', () => {
    expect(keyToEdit(doc, { rungId: 'r1', index: 2 }, 'Delete', selected)).toBeUndefined();
  });

  it('adds a rung on Insert and removes it on Ctrl+Delete', () => {
    expect(keyToEdit(doc, { rungId: 'r1', index: 0 }, 'Insert', selected)).toEqual({
      kind: 'addRung',
      after: 'r1',
    });
    expect(keyToEdit(doc, { rungId: 'r1', index: 0 }, 'Delete', selected, { ctrl: true })).toEqual({
      kind: 'removeRung',
      rungId: 'r1',
    });
  });

  it('ignores keys that are not bound', () => {
    expect(keyToEdit(doc, { rungId: 'r1', index: 0 }, 'F5', selected)).toBeUndefined();
  });
});

describe('分岐（受入基準① の自己保持段）', () => {
  /** 段1 ＝ PB2 b接点 → PB1 a接点 → CR1 コイル、段2 ＝ CR1 a接点（まだ P→N の普通の段）。 */
  function twoRungs(): SchematicDocument {
    let doc = emptySchematic('draft', '下書き');
    const place = (rungId: string, draft: CellDraft): void => {
      const target = doc.rungs.find((r) => r.id === rungId);
      const step = applyEdit(doc, {
        kind: 'insertCell',
        rungId,
        index: target?.cells.length ?? 0,
        draft,
      });
      expect(step.ok).toBe(true);
      if (step.ok) doc = step.doc;
    };
    place('r1', { kind: 'pb-b', device: 'PB2' });
    place('r1', { kind: 'pb-a', device: 'PB1' });
    place('r1', { kind: 'coil', device: 'CR1' });
    const added = applyEdit(doc, { kind: 'addRung' });
    expect(added.ok).toBe(true);
    if (added.ok) doc = added.doc;
    place('r2', { kind: 'cr-a', device: 'CR1' });
    return doc;
  }

  it('offers 分岐 only for a rung that can become one, and says why when it cannot', () => {
    const doc = twoRungs();
    expect(branchDisabledReason(doc, 'r2')).toBeUndefined();
    // 負荷（コイル）のある段は分岐にできない（分岐段に負荷は置けない）
    expect(branchDisabledReason(doc, 'r1')).toBe(JA.schematic.branchHasLoad);
    // 段が1本しか無ければ分岐先の節点が無い
    expect(branchDisabledReason(emptySchematic('d', 't'), 'r1')).toBe(
      JA.schematic.branchNeedsAnotherRung,
    );
  });

  it('takes the start node first and turns the second pick into a setEnds edit', () => {
    const doc = twoRungs();
    const first = pickBranchNode(doc, { rungId: 'r2' }, { rungId: 'r1', node: 1 });
    expect(first).toEqual({
      kind: 'draft',
      branch: { rungId: 'r2', from: { rung: 'r1', node: 1 } },
    });
    if (first.kind !== 'draft') return;
    const second = pickBranchNode(doc, first.branch, { rungId: 'r1', node: 2 });
    expect(second).toEqual({
      kind: 'edit',
      edit: {
        kind: 'setEnds',
        rungId: 'r2',
        from: { rung: 'r1', node: 1 },
        to: { rung: 'r1', node: 2 },
      },
    });
    if (second.kind !== 'edit') return;
    // この編集を当てると b-001 と同じ自己保持段になる（受入基準①）
    const out = applyEdit(doc, second.edit);
    expect(out.ok && out.doc.rungs[1]).toMatchObject({
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
  });

  it('refuses a node of the rung that is being branched', () => {
    expect(pickBranchNode(twoRungs(), { rungId: 'r2' }, { rungId: 'r2', node: 0 })).toEqual({
      kind: 'refused',
      message: JA.schematic.branchSelfRefused,
    });
  });

  it('refuses a node that the target rung does not have', () => {
    expect(pickBranchNode(twoRungs(), { rungId: 'r2' }, { rungId: 'r1', node: 9 })).toEqual({
      kind: 'refused',
      message: JA.schematic.branchNoNode,
    });
  });

  it('refuses the same node for both ends', () => {
    const branch: BranchDraft = { rungId: 'r2', from: { rung: 'r1', node: 1 } };
    expect(pickBranchNode(twoRungs(), branch, { rungId: 'r1', node: 1 })).toEqual({
      kind: 'refused',
      message: JA.schematic.branchSameNode,
    });
  });

  it('guides the trainee one line at a time and says which rung is being branched', () => {
    const doc = twoRungs();
    expect(branchStepHint(doc, undefined)).toBeUndefined();
    // どの段を分岐にしているかを先に言う（内部IDは出さない。レビュー Minor）
    expect(branchStepHint(doc, { rungId: 'r2' })).toBe(
      `2段目${JA.schematic.branchOf}${JA.schematic.branchPickFrom}`,
    );
    expect(branchStepHint(doc, { rungId: 'r2', from: { rung: 'r1', node: 1 } })).toBe(
      `2段目${JA.schematic.branchOf}${JA.schematic.branchPickTo}`,
    );
    expect(branchStepHint(doc, { rungId: 'r2' })).not.toMatch(/r\d/u);
  });

  it('lets keyToEdit finish the branch on Enter and swallows every other key', () => {
    const doc = twoRungs();
    const branch: BranchDraft = { rungId: 'r2', from: { rung: 'r1', node: 1 } };
    expect(keyToEdit(doc, { rungId: 'r1', index: 2 }, 'Enter', undefined, {}, branch)).toEqual({
      kind: 'setEnds',
      rungId: 'r2',
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
    // 分岐の節点を選んでいる最中に Delete / Insert で文書が変わらない（決定表#25）
    expect(
      keyToEdit(doc, { rungId: 'r1', index: 0 }, 'Delete', undefined, {}, branch),
    ).toBeUndefined();
    expect(
      keyToEdit(doc, { rungId: 'r1', index: 0 }, 'Insert', undefined, {}, branch),
    ).toBeUndefined();
  });
});

describe('SchematicHistory', () => {
  it('pushes, undoes and redoes like the ladder history', () => {
    const before = emptySchematic('draft', '下書き');
    const after = oneRung();
    const history = pushSchematic(emptySchematicHistory(), before);
    const back = undoSchematic(history, after);
    expect(back?.doc).toBe(before);
    expect(back?.history.undone).toEqual([after]);
    const forward = back === undefined ? undefined : redoSchematic(back.history, back.doc);
    expect(forward?.doc).toBe(after);
  });

  it('drops the oldest step past the limit', () => {
    let history = emptySchematicHistory();
    for (let i = 0; i <= SCHEMATIC_HISTORY_LIMIT + 3; i += 1) {
      history = pushSchematic(history, emptySchematic(`d${String(i)}`, '下書き'));
    }
    expect(history.done).toHaveLength(SCHEMATIC_HISTORY_LIMIT);
    expect(history.done[0]?.id).toBe('d4');
  });

  it('returns undefined when there is nothing to undo or redo', () => {
    expect(undoSchematic(emptySchematicHistory(), oneRung())).toBeUndefined();
    expect(redoSchematic(emptySchematicHistory(), oneRung())).toBeUndefined();
  });
});

describe('schematicSteps（決定表#24）', () => {
  it('walks 描く → 検算 → 盤に配線', () => {
    const empty = schematicSteps({ cellCount: 0, verified: false, boardWired: false });
    expect(empty.map((s) => s.state)).toEqual(['current', 'todo', 'todo']);
    const drawn = schematicSteps({ cellCount: 3, verified: false, boardWired: false });
    expect(drawn[0]?.state).toBe('done');
    expect(drawn[1]?.state).toBe('current');
    const verified = schematicSteps({ cellCount: 3, verified: true, boardWired: false });
    expect(verified[2]?.state).toBe('current');
  });

  it('gives a one-line hint for every step', () => {
    for (const key of ['draw', 'verify', 'wire'] as const) {
      expect(schematicStepHint(key)?.length ?? 0).toBeGreaterThan(0);
    }
    expect(schematicStepHint(undefined)).toBeUndefined();
  });
});
