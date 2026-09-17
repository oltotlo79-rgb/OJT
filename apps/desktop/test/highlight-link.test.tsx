import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildHighlightIndex,
  buildInspectRepairCircuit,
  cellIdsAtTerminal,
  highlightFor,
} from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchematicSvg } from '../src/renderer/schematic/SchematicSvg.js';

/**
 * 回路図 ⇄ 3D盤の連動ハイライト（Plan 2B Task 15）。設計仕様 §9.2 / §11.4。
 */

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);

afterEach(() => {
  cleanup();
});

describe('索引（Plan 2A の buildHighlightIndex）', () => {
  it('回路図の要素から盤の端子と電線を引ける', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const index = buildHighlightIndex(built.value.cells, built.value.session);
    const first = built.value.cells[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const target = highlightFor(index, first.cellId);
    expect(target?.terminals).toHaveLength(2);
    // 逆引きも通る
    const back = cellIdsAtTerminal(index, String(target?.terminals[0]));
    expect(back).toContain(first.cellId);
  });
});

describe('SchematicSvg のハイライト（§9.2）', () => {
  it('指定した要素の図形に data-highlight が付く', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const cellId = built.value.cells[0]?.cellId;
    expect(cellId).toBeDefined();
    if (cellId === undefined) return;
    render(<SchematicSvg document={C2.schematic} highlightCellIds={[cellId]} />);
    const svg = screen.getByTestId('schematic-svg');
    expect(svg.querySelectorAll('[data-highlight="true"]').length).toBeGreaterThan(0);
  });

  it('要素をクリックすると cellId が返る', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const cellId = built.value.cells[0]?.cellId;
    if (cellId === undefined) return;
    const onPickCell = vi.fn();
    render(<SchematicSvg document={C2.schematic} highlightCellIds={[]} onPickCell={onPickCell} />);
    const shape = screen.getByTestId('schematic-svg').querySelector(`[data-cell="${cellId}"]`);
    expect(shape).toBeTruthy();
    if (shape === null) return;
    fireEvent.click(shape);
    expect(onPickCell).toHaveBeenCalledWith(cellId);
  });

  it('母線など cellId を持たない図形をクリックすると undefined が返る（解除）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const onPickCell = vi.fn();
    render(<SchematicSvg document={C2.schematic} highlightCellIds={[]} onPickCell={onPickCell} />);
    fireEvent.click(screen.getByTestId('schematic-svg'));
    expect(onPickCell).toHaveBeenCalledWith(undefined);
  });

  it('ハイライトを渡さなくても従来どおり描ける（モードBの回路図ヒント）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(<SchematicSvg document={C2.schematic} />);
    expect(screen.getByTestId('schematic-svg')).toBeTruthy();
  });
});
