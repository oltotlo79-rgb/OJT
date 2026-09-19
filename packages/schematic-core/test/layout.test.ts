import { describe, expect, it } from 'vitest';
import {
  at,
  BUS_N,
  BUS_P,
  buzzer,
  coil,
  contactShapes,
  crA,
  crB,
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
  type SchematicDocument,
  type Shape,
} from '../src/index.js';
import { flickerDoc, selfHoldDoc } from './helpers/docs.js';

function roles(shapes: readonly Shape[], role: Shape['role']): Shape[] {
  return shapes.filter((s) => s.role === role);
}

/** ラベルの文字寸法（描画側の既定。fontSize 6 の全角混じり1文字ぶん）。 */
const TEXT_HEIGHT = 6;
const CHAR_WIDTH = 3.4;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function textBox(s: Shape): Box | undefined {
  if (s.kind !== 'text') return undefined;
  const width = s.text.length * CHAR_WIDTH;
  const left = s.anchor === 'middle' ? s.x - width / 2 : s.anchor === 'end' ? s.x - width : s.x;
  return { x1: left, x2: left + width, y1: s.y - TEXT_HEIGHT / 2, y2: s.y + TEXT_HEIGHT / 2 };
}

function markBox(s: Shape): Box | undefined {
  if (s.kind === 'line') {
    return {
      x1: Math.min(s.x1, s.x2),
      x2: Math.max(s.x1, s.x2),
      y1: Math.min(s.y1, s.y2),
      y2: Math.max(s.y1, s.y2),
    };
  }
  if (s.kind === 'text') return undefined;
  if (s.kind === 'rect') return { x1: s.x, x2: s.x + s.w, y1: s.y, y2: s.y + s.h };
  return { x1: s.cx - s.r, x2: s.cx + s.r, y1: s.cy - s.r, y2: s.cy + s.r };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/** 段の並び順に依らない図形の表現（y座標を「どの段の行か＋ずれ」に読み替える）。 */
function shapesByRow(doc: SchematicDocument): string[] {
  const o = DEFAULT_LAYOUT_OPTIONS;
  /**
   * 線や円は「いちばん近い行」を基準にする（親の段へ渡る縦線は他の行にも触れるので、
   * 自分の段を基準にすると段の並び順で表現が変わってしまう）。
   * 文字だけは**自分の段**を基準にする（銘板は段の中心より1行ぶん近く上に出るため、
   * いちばん近い行に丸めると隣の行の持ち物に見えてしまう）。
   */
  const row = (y: number, rungId: string | undefined): string => {
    const index =
      rungId === undefined
        ? Math.round((y - o.marginY) / o.rowHeight)
        : doc.rungs.findIndex((r) => r.id === rungId);
    const owner = doc.rungs[index];
    const base = owner === undefined ? 0 : o.marginY + index * o.rowHeight;
    return `@${owner?.id ?? '-'}${(y - base).toFixed(3)}`;
  };
  return layout(doc)
    .shapes.map((s) => {
      const source = `${s.rungId ?? '-'}/${s.cellId ?? '-'} ${s.role}`;
      if (s.kind === 'line') {
        // 段に属さない線（母線）は行に丸めない。丸め先の段は文書順で変わってしまう
        const at = (y: number): string =>
          s.rungId === undefined ? `@${y.toFixed(3)}` : row(y, undefined);
        return `${source} line ${s.x1},${at(s.y1)} ${s.x2},${at(s.y2)}`;
      }
      if (s.kind === 'text')
        return `${source} text ${s.x},${row(s.y, s.rungId)} ${s.text} ${s.anchor}`;
      if (s.kind === 'circle')
        return `${source} circle ${s.cx},${row(s.cy, undefined)} ${s.r} ${s.fill ?? ''}`;
      if (s.kind === 'rect')
        return `${source} rect ${s.x},${row(s.y, undefined)} ${s.w}x${s.h} ${s.fill ?? ''}`;
      return `${source} arc ${s.cx},${row(s.cy, undefined)} ${s.r} ${s.startDeg}-${s.endDeg}`;
    })
    .sort();
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
    // 銘板は機器名だけ。設定時間は記号の下の別の文字（2026-09-20 の記号見直し）
    expect(texts).toContain('T1');
    expect(texts).toContain('2.5秒');
  });

  it('接点記号: a接点／b接点／押ボタン操作子／限時記号（調査資料 §3.4）', () => {
    // 刃形は「左の固定接点・右の固定接点・ブレード」の3本が土台。§11.1
    const a = contactShapes('cr-a', 0, 0, 12);
    const b = contactShapes('cr-b', 0, 0, 12);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    // a接点はブレードの先が右の固定接点に届かない（開）。b接点は届く（閉）
    const bladeOf = (shapes: readonly Shape[]): Shape | undefined => shapes[2];
    const aBlade = bladeOf(a);
    const bBlade = bladeOf(b);
    if (aBlade?.kind !== 'line' || bBlade?.kind !== 'line') throw new Error('blade');
    expect(aBlade.x2).toBeLessThan(bBlade.x2);
    // b接点は右の固定接点（x = 6）を横切って外へ出る
    expect(bBlade.x2).toBeGreaterThan(6);
    const pb = contactShapes('pb-a', 0, 0, 12);
    expect(pb).toHaveLength(5);
    const timed = contactShapes('t-a', 0, 0, 12);
    expect(timed).toHaveLength(4);
    expect(timed[3]?.kind).toBe('arc');
    expect(contactShapes('t-b', 0, 0, 12)).toHaveLength(4);
  });

  it('負荷記号: コイル＝長方形、ランプ＝丸＋×（色つき）、ブザー＝半円（§11.1）', () => {
    const cr = loadShapes(coil('c', 'CR1'), 0, 0, 12);
    expect(cr).toHaveLength(1);
    expect(cr[0]?.kind).toBe('rect');
    expect(cr[0]?.kind === 'rect' ? cr[0].w : 0).toBeCloseTo(12, 6);
    // ⌀は記号幅より小さいので、電線との突き合わせに引出線が2本付く（丸＋×2本＋引出線2本）
    const pl = loadShapes(lamp('c', 'PL3'), 0, 0, 12);
    expect(pl).toHaveLength(5);
    expect(pl[0]?.kind === 'circle' ? pl[0].fill : '').toBe(LAMP_FILL.PL3);
    const bz = loadShapes(buzzer('c'), 0, 0, 12);
    expect(bz[0]?.kind).toBe('arc');
    expect(bz).toHaveLength(4);
    // タイマのコイルは長方形の中に限時記号（パラシュート）を持つ
    expect(
      loadShapes(coil('c', 'T1', 2000), 0, 0, 12).filter((s) => s.kind === 'arc'),
    ).toHaveLength(1);
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

    // 循環参照でも止まる（親の解決は解決中の段を覚えておく）
    const cyclic = createDocument('x', '循環参照', [
      rung('r1', at('r2', 1), BUS_N, [crA('c1', 'CR1'), coil('c2', 'CR2')]),
      rung('r2', at('r1', 1), BUS_N, [crA('c3', 'CR2'), coil('c4', 'CR1')]),
    ]);
    expect(layout(cyclic).shapes.length).toBeGreaterThan(0);

    // 数値でない節点番号も左母線に寄せるだけ
    const notANumber = createDocument('x', '節点番号がNaN', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', Number.NaN), BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
    ]);
    const zero = createDocument('x', '節点0', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 0), BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
    ]);
    expect(layout(notANumber)).toEqual(layout(zero));
  });

  it('分岐の親が後ろに書かれていても同じ図になる（§11.2 決定論）', () => {
    const o = DEFAULT_LAYOUT_OPTIONS;
    const r1 = rung('r1', BUS_P, BUS_N, [
      pbA('c1', 'PB1'),
      crA('c2', 'CR1'),
      crB('c3', 'CR2'),
      coil('c4', 'CR1'),
    ]);
    const r2 = rung('r2', at('r1', 2), at('r1', 3), [crA('c5', 'CR1')]);
    const r3 = rung('r3', at('r2', 0), at('r1', 3), [crA('c6', 'CR2')]);
    const parentFirst = createDocument('x', '親が先', [r1, r2, r3]);
    const childFirst = createDocument('x', '子が先', [r3, r1, r2]);

    expect(shapesByRow(childFirst)).toEqual(shapesByRow(parentFirst));
    expect(layout(childFirst).width).toBe(layout(parentFirst).width);

    // 孫の段（r3）は親の親（r1）の節点2から下りる。左母線に描いてはいけない
    const r3X = layout(childFirst)
      .shapes.filter((s) => s.rungId === 'r3')
      .flatMap((s) => (s.kind === 'line' ? [s.x1, s.x2] : []));
    expect(Math.min(...r3X)).toBe(o.marginX + 2 * o.colWidth);
  });

  it('壊れた節点番号は親の節点範囲に丸める（図の幅が飛ばない。§13 #2）', () => {
    const doc = (node: number): SchematicDocument =>
      createDocument('x', '参照', [
        rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
        rung('r2', at('r1', node), BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
      ]);
    expect(layout(doc(99))).toEqual(layout(doc(2)));
    expect(layout(doc(-5))).toEqual(layout(doc(0)));
    expect(layout(doc(99)).width).toBe(layout(doc(2)).width);
  });

  it('ラベルは隣の行の記号にかぶらない（既定の rowHeight）', () => {
    const shapes = layout(selfHoldDoc()).shapes;
    const collisions: string[] = [];
    for (const label of shapes) {
      const box = textBox(label);
      if (box === undefined || label.rungId === undefined) continue;
      for (const mark of shapes) {
        if (mark.rungId === undefined || mark.rungId === label.rungId) continue;
        const other = markBox(mark);
        if (other !== undefined && overlaps(box, other)) {
          collisions.push(`${label.cellId ?? '?'} のラベルが ${mark.rungId} の図形にかぶる`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('図形は出どころ（段ID・要素ID）を持ち、母線は持たない（§11.2）', () => {
    const doc = flickerDoc();
    const shapes = layout(doc).shapes;

    // 母線の線とラベルだけが段にも要素にも属さない
    const busShapes = shapes.filter((s) => s.rungId === undefined);
    expect(busShapes).toHaveLength(4);
    expect(busShapes.filter((s) => s.role === 'bus')).toHaveLength(2);
    expect(busShapes.every((s) => s.cellId === undefined)).toBe(true);

    const rungIds = new Set(doc.rungs.map((r) => r.id));
    for (const s of shapes.filter((s) => s.rungId !== undefined)) {
      expect(rungIds.has(s.rungId ?? '')).toBe(true);
      // 記号とラベルは要素の物、電線と分岐点は段の物
      if (s.role === 'symbol' || s.role === 'label' || s.role === 'preset') {
        expect(s.cellId).toBeDefined();
      } else expect(s.cellId).toBeUndefined();
    }

    for (const r of doc.rungs) {
      for (const cell of r.cells) {
        const own = shapes.filter((s) => s.cellId === cell.id);
        expect(own.every((s) => s.rungId === r.id)).toBe(true);
        expect(own.filter((s) => s.role === 'symbol').length).toBeGreaterThan(0);
        const label = own.filter((s) => s.role === 'label');
        expect(label).toHaveLength(1);
        expect(label[0]?.kind === 'text' ? label[0].text : '').toBe(cell.device);
      }
    }
  });

  it('限時b接点も描ける', () => {
    const doc = createDocument('x', '限時b', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', 1000)]),
      rung('r2', BUS_P, BUS_N, [tB('c3', 'T1'), lamp('c4', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [tA('c5', 'T1'), lamp('c6', 'PL2')]),
    ]);
    // 限時接点2つ＋タイマコイルの中の限時記号
    const arcs = layout(doc).shapes.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(3);
  });
});
