import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  buildHighlightIndex,
  cellIdsAtTerminal,
  cellIdsOfWire,
  highlightFor,
} from '../src/highlight.js';
import { buildReferenceSession } from '../src/reference.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

/** 自己保持回路の模範回路（`buildReferenceSession()` が返す `cells`）から索引を作る。 */
function index() {
  const problem = parseOrThrow(selfHoldProblemJson());
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return buildHighlightIndex(built.value.cells, built.value.session);
}

describe('buildHighlightIndex', () => {
  it('maps a schematic cell onto its board terminals (§9.2)', () => {
    const target = highlightFor(index(), 'c03');
    expect(target?.device).toBe('CR1');
    expect(target?.terminals).toEqual(['CR1.14', 'CR1.13']);
  });

  it('lists the wires attached to those terminals', () => {
    const target = highlightFor(index(), 'c03');
    expect(target?.wireIds).toEqual(['sw-005', 'sw-006', 'sw-007', 'sw-008']);
  });

  it('maps a push button contact onto the terminal block, not the body (§6.4)', () => {
    const target = highlightFor(index(), 'c02');
    expect(target?.device).toBe('PB1');
    expect(target?.terminals).toEqual(['TB_PB.1c', 'TB_PB.1a']);
  });

  it('returns undefined for an unknown cell id', () => {
    expect(highlightFor(index(), 'nope')).toBeUndefined();
  });
});

describe('cellIdsAtTerminal / cellIdsOfWire', () => {
  it('finds the schematic cells that use a board terminal (3D → 回路図)', () => {
    expect(cellIdsAtTerminal(index(), 'CR1.14')).toEqual(['c03']);
    expect(cellIdsAtTerminal(index(), 'CR1.9')).toEqual(['c04']);
    expect(cellIdsAtTerminal(index(), 'PS.+')).toEqual([]);
  });

  it('finds the schematic cells a wire belongs to', () => {
    expect(cellIdsOfWire(index(), 'sw-006')).toEqual(['c03', 'c04']);
    expect(cellIdsOfWire(index(), 'nope')).toEqual([]);
  });
});
