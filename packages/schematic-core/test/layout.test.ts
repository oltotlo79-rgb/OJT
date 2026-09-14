import { describe, expect, it } from 'vitest';
import {
  at,
  BUS_N,
  BUS_P,
  buzzer,
  coil,
  contactShapes,
  crA,
  createDocument,
  DEFAULT_LAYOUT_OPTIONS,
  LAMP_FILL,
  lamp,
  layout,
  loadShapes,
  pbA,
  rung,
  tA,
  tB,
  type Shape,
} from '../src/index.js';
import { flickerDoc, selfHoldDoc } from './helpers/docs.js';

function roles(shapes: readonly Shape[], role: Shape['role']): Shape[] {
  return shapes.filter((s) => s.role === role);
}

describe('layout: 読取専用レンダラ用の図形データ（§11.2）', () => {
  it('母線は左がP・右がN（§11.1）', () => {
    const result = layout(selfHoldDoc());
    const bus = roles(result.shapes, 'bus');
    expect(bus).toHaveLength(2);
    const [busP, busN] = bus;
    if (busP?.kind !== 'line' || busN?.kind !== 'line') throw new Error('bus');
    expect(busP.x1).toBe(DEFAULT_LAYOUT_OPTIONS.marginX);
    expect(busN.x1).toBeGreaterThan(busP.x1);
    const labels = roles(result.shapes, 'label').filter((s) => s.kind === 'text');
    expect(labels.map((s) => (s.kind === 'text' ? s.text : ''))).toContain('P(+24V)');
    expect(labels.map((s) => (s.kind === 'text' ? s.text : ''))).toContain('N(0V)');
    expect(result.width).toBeGreaterThan(busN.x1);
    expect(result.height).toBeGreaterThan(0);
  });

  it('同じ文書からは必ず同じ図形が出る（決定論）', () => {
    expect(layout(flickerDoc())).toEqual(layout(flickerDoc()));
    expect(layout(selfHoldDoc(), { colWidth: 30 })).not.toEqual(layout(selfHoldDoc()));
  });

  it('要素ごとにラベルと記号が出る', () => {
    const result = layout(selfHoldDoc());
    const texts = roles(result.shapes, 'label')
      .filter((s) => s.kind === 'text')
      .map((s) => (s.kind === 'text' ? s.text : ''));
    expect(texts).toEqual(['P(+24V)', 'N(0V)', 'PB2', 'PB1', 'CR1', 'CR1', 'CR1', 'PL1']);
    expect(roles(result.shapes, 'junction')).toHaveLength(2);
  });

  it('タイマコイルは設定秒を併記する（§11.1）', () => {
    const doc = createDocument('x', 'タイマ', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', 2500)]),
    ]);
    const texts = layout(doc)
      .shapes.filter((s) => s.kind === 'text')
      .map((s) => (s.kind === 'text' ? s.text : ''));
    expect(texts).toContain('T1 (2.5秒)');
  });

  it('接点記号: a接点／b接点／押ボタン操作子／限時記号（調査資料 §3.4）', () => {
    const a = contactShapes('cr-a', 0, 0, 12);
    const b = contactShapes('cr-b', 0, 0, 12);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(4);
    const pb = contactShapes('pb-a', 0, 0, 12);
    expect(pb).toHaveLength(5);
    const timed = contactShapes('t-a', 0, 0, 12);
    expect(timed).toHaveLength(4);
    expect(timed[3]?.kind).toBe('arc');
    expect(contactShapes('t-b', 0, 0, 12)).toHaveLength(5);
  });

  it('負荷記号: コイル＝丸、ランプ＝丸＋×（色つき）、ブザー＝半円（§11.1）', () => {
    const cr = loadShapes(coil('c', 'CR1'), 0, 0, 12);
    expect(cr).toHaveLength(1);
    expect(cr[0]?.kind).toBe('circle');
    expect(cr[0]?.kind === 'circle' ? cr[0].r : 0).toBeCloseTo(4.8, 6);
    const pl = loadShapes(lamp('c', 'PL3'), 0, 0, 12);
    expect(pl).toHaveLength(3);
    expect(pl[0]?.kind === 'circle' ? pl[0].fill : '').toBe(LAMP_FILL.PL3);
    const bz = loadShapes(buzzer('c'), 0, 0, 12);
    expect(bz[0]?.kind).toBe('arc');
    expect(bz).toHaveLength(2);
  });

  it('分岐は縦線と分岐点で描かれる', () => {
    const result = layout(flickerDoc());
    const junctions = roles(result.shapes, 'junction');
    expect(junctions).toHaveLength(6);
    expect(junctions.every((s) => s.kind === 'circle')).toBe(true);
    const rows = new Set(
      roles(result.shapes, 'wire')
        .filter((s) => s.kind === 'line')
        .map((s) => (s.kind === 'line' ? s.y1 : 0)),
    );
    expect(rows.size).toBe(flickerDoc().rungs.length);
  });

  it('要素数の違う分岐は横線でつないでから縦線に落とす', () => {
    const doc = createDocument('x', '長い分岐', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 0), at('r1', 1), [crA('c3', 'CR1'), crA('c4', 'CR1')]),
    ]);
    const result = layout(doc);
    const o = DEFAULT_LAYOUT_OPTIONS;
    const rejoin = result.shapes.filter(
      (s) => s.kind === 'line' && s.role === 'wire' && s.y1 === s.y2 && s.x1 > s.x2,
    );
    expect(rejoin).toHaveLength(1);
    const only = rejoin[0];
    if (only?.kind !== 'line') throw new Error('line');
    expect(only.x1).toBe(o.marginX + 2 * o.colWidth);
    expect(only.x2).toBe(o.marginX + o.colWidth);
  });

  it('壊れた参照があっても図形は返す（レンダラは落ちない。§13 #2）', () => {
    const doc = createDocument('x', '壊れた参照', [
      rung('r1', at('rX', 0), at('rY', 1), [crA('c1', 'CR1')]),
    ]);
    const result = layout(doc);
    expect(result.shapes.length).toBeGreaterThan(0);
    expect(result.shapes.filter((s) => s.role === 'junction')).toHaveLength(0);
  });

  it('限時b接点も描ける', () => {
    const doc = createDocument('x', '限時b', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', 1000)]),
      rung('r2', BUS_P, BUS_N, [tB('c3', 'T1'), lamp('c4', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [tA('c5', 'T1'), lamp('c6', 'PL2')]),
    ]);
    const arcs = layout(doc).shapes.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(2);
  });
});
