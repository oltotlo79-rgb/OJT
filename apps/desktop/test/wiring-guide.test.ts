import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  buildHighlightIndex,
  buildReferenceSession,
} from '@ojt/content';
import type { ReferenceCircuit } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { NO_HIGHLIGHT } from '../src/renderer/app/store-types.js';
import {
  cellsForHover,
  guideIndexFor,
  sameSelection,
  selectionFor,
  selectionForHover,
} from '../src/renderer/session/wiring-guide.js';

/**
 * 配線ガイドの索引と選択（§11.4 受入基準② / 決定表#7・#8）。
 * React も three も使わないので Vitest だけで検証できる（§14.2）。
 */

const found = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (found === undefined) throw new Error('b-001 が見つかりません');
/** 巻き上げられる関数宣言の中でも `undefined` を外した型でいるように、別名にしてから使う。 */
const problem = found;

function reference(): ReferenceCircuit {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路が作れません');
  return built.value;
}

describe('selectionFor', () => {
  it('turns a cell id into terminals and wires', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    const cellId = cells[0]?.cellId ?? '';
    const selection = selectionFor(index, cellId);
    expect(selection.cellIds).toEqual([cellId]);
    expect(selection.terminals).toHaveLength(2);
    expect(selection.wireIds.length).toBeGreaterThan(0);
  });

  it('clears the selection for an unknown or undefined cell', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    expect(selectionFor(index, undefined)).toEqual(NO_HIGHLIGHT);
    expect(selectionFor(index, 'nope')).toEqual(NO_HIGHLIGHT);
    expect(selectionFor(undefined, cells[0]?.cellId)).toEqual(NO_HIGHLIGHT);
  });
});

describe('cellsForHover（3D → 回路図の逆引き。決定表#8）', () => {
  it('finds the cells that use a hovered terminal', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    const terminal = cells[0]?.left ?? '';
    expect(cellsForHover(index, { terminal })).toContain(cells[0]?.cellId);
  });

  it('finds the cells that a hovered wire joins', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    const wireId = session.wires.find((w) => !w.locked)?.id ?? '';
    expect(cellsForHover(index, { wireId }).length).toBeGreaterThan(0);
  });

  it('returns nothing when nothing is hovered', () => {
    const { cells, session } = reference();
    expect(cellsForHover(buildHighlightIndex(cells, session), {})).toEqual([]);
    expect(cellsForHover(undefined, { terminal: 'CR1.14' })).toEqual([]);
  });
});

describe('selectionForHover（盤 → 回路図の選択。決定表#8）', () => {
  it('lights the hovered terminal together with the cells that use it', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    const terminal = cells[0]?.left ?? '';
    const selection = selectionForHover(index, { terminal });
    expect(selection.cellIds).toContain(cells[0]?.cellId);
    expect(selection.terminals).toEqual([terminal]);
    expect(selection.wireIds).toEqual([]);
  });

  it('lights the hovered wire together with the cells it joins', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    const wireId = session.wires.find((w) => !w.locked)?.id ?? '';
    const selection = selectionForHover(index, { wireId });
    expect(selection.wireIds).toEqual([wireId]);
    expect(selection.terminals).toEqual([]);
    expect(selection.cellIds.length).toBeGreaterThan(0);
  });

  it('lights nothing for a terminal no schematic element uses', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    expect(selectionForHover(index, { terminal: 'CB.9' })).toEqual(NO_HIGHLIGHT);
  });
});

describe('guideIndexFor（決定表#7）', () => {
  it('uses the trainee drawing when one is given', () => {
    const { session } = reference();
    const index = guideIndexFor({
      doc: problem.schematic,
      problem,
      board: JIPM_BOARD,
      session,
    });
    expect(index).not.toBeUndefined();
    expect(index?.size).toBe(problem.schematic.rungs.flatMap((r) => r.cells).length);
  });

  it('falls back to the reference circuit when there is no drawing', () => {
    const { session } = reference();
    const index = guideIndexFor({ doc: undefined, problem, board: JIPM_BOARD, session });
    expect(index?.size).toBeGreaterThan(0);
  });

  it('returns undefined for a drawing that cannot be assigned to the board', () => {
    const { session } = reference();
    const broken = { ...problem.schematic, rungs: [] };
    expect(guideIndexFor({ doc: broken, problem, board: JIPM_BOARD, session })).toBeUndefined();
  });
});

describe('sameSelection', () => {
  it('compares by value so hover does not restart the store on every frame', () => {
    expect(sameSelection(NO_HIGHLIGHT, { cellIds: [], terminals: [], wireIds: [] })).toBe(true);
    expect(sameSelection(NO_HIGHLIGHT, { cellIds: ['c1'], terminals: [], wireIds: [] })).toBe(
      false,
    );
    expect(
      sameSelection(
        { cellIds: ['c1'], terminals: ['CR1.13'], wireIds: [] },
        { cellIds: ['c1'], terminals: ['CR1.14'], wireIds: [] },
      ),
    ).toBe(false);
  });
});
