import { describe, expect, it } from 'vitest';
import {
  BUS_N,
  BUS_P,
  coil,
  createDocument,
  DEFAULT_LAYOUT_OPTIONS,
  emptySchematic,
  layout,
  pbA,
  rung,
  slotRects,
} from '../src/index.js';

// r2 は**始点**が r1 の節点1（＝分岐段）。始点が母線だと段の左端は左母線のままで、
// 「分岐段は親の節点から始まる」を確かめられない
const doc = createDocument('d', 't', [
  rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
  rung('r2', { rung: 'r1', node: 1 }, BUS_N, []),
]);

describe('slotRects（§11.4 のエディタの当たり判定）', () => {
  it('returns one rect per cell plus one empty tail slot per rung', () => {
    const rects = slotRects(doc);
    expect(rects.filter((s) => s.rungId === 'r1').map((s) => s.index)).toEqual([0, 1, 2]);
    expect(rects.filter((s) => s.rungId === 'r1').map((s) => s.cellId)).toEqual([
      'c1',
      'c2',
      undefined,
    ]);
    // 要素0個の段でも「置ける場所」が1つある
    expect(rects.filter((s) => s.rungId === 'r2')).toEqual([
      expect.objectContaining({ rungId: 'r2', index: 0, cellId: undefined }),
    ]);
  });

  it('lines the rects up with the shapes that layout() emits', () => {
    const o = DEFAULT_LAYOUT_OPTIONS;
    const rects = slotRects(doc);
    const first = rects[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.w).toBe(o.colWidth);
    expect(first.h).toBe(o.rowHeight);
    // 段1は左母線から始まるので、最初の桁の左端は marginX
    expect(first.x).toBe(o.marginX);
    expect(first.y).toBe(o.marginY - o.rowHeight / 2);
  });

  it('follows the same colWidth override that the renderer uses', () => {
    const rects = slotRects(doc, { colWidth: 40 });
    expect(rects[1]?.x).toBe(DEFAULT_LAYOUT_OPTIONS.marginX + 40);
    expect(rects[1]?.w).toBe(40);
  });

  it('puts the load slot in the rightmost column, level with every other load', () => {
    const o = DEFAULT_LAYOUT_OPTIONS;
    const wide = createDocument('d', 't', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [pbA('c3', 'PB2'), pbA('c4', 'PB3'), coil('c5', 'CR2')]),
    ]);
    const rects = slotRects(wide);
    const at = (cellId: string): number | undefined => rects.find((s) => s.cellId === cellId)?.x;
    // 出力はどちらも「いちばん接点の多い段（2個）」の右隣の列
    expect(at('c2')).toBe(o.marginX + 2 * o.colWidth);
    expect(at('c5')).toBe(o.marginX + 2 * o.colWidth);
    // 接点は左詰めのまま
    expect(at('c1')).toBe(o.marginX);
    expect(at('c3')).toBe(o.marginX);
    expect(at('c4')).toBe(o.marginX + o.colWidth);
    // 末尾の空き桁は出力の右隣
    const tail = rects.find((s) => s.rungId === 'r1' && s.index === 2);
    expect(tail?.x).toBe(o.marginX + 3 * o.colWidth);
  });

  it('starts a branch rung at its parent node', () => {
    const branch = slotRects(doc).find((s) => s.rungId === 'r2');
    expect(branch?.x).toBe(DEFAULT_LAYOUT_OPTIONS.marginX + DEFAULT_LAYOUT_OPTIONS.colWidth);
  });

  it('never runs past the layout width', () => {
    const size = layout(doc);
    for (const rect of slotRects(doc)) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(size.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(size.height);
    }
  });

  it('gives an empty document one slot', () => {
    expect(slotRects(emptySchematic('d', 't'))).toHaveLength(1);
  });
});
