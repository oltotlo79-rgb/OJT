import { describe, expect, it } from 'vitest';
import {
  assignToBoard,
  buzzer,
  BUS_N,
  BUS_P,
  coil,
  contactShapes,
  createDocument,
  crA,
  crB,
  lamp,
  layout,
  loadShapes,
  pbA,
  pbB,
  rung,
  SYMBOL_METRICS,
  tA,
  tB,
  terminalMarks,
  type CellKind,
  type LayoutOptions,
  type Shape,
} from '../src/index.js';
import { flickerDoc, interlockDoc, onDelayDoc, selfHoldDoc } from './helpers/docs.js';

/**
 * 図記号の作り（`symbols.ts`）と、図として破綻していないことの構造検査。
 * 「見た目」を絵で比べる代わりに、**印刷された展開接続図が満たす決まりごと**を式で確かめる:
 * 記号は電線と突き合わさる／a接点は開きb接点は閉じる／文字は線に乗らない／
 * 分岐点には黒丸がある／母線は左右にある。§11.1 / §11.2
 */

/** 描画側（`SchematicSvg`）が渡す寸法設定。端子番号と段番号まで刷る。 */
const PRINT: LayoutOptions = {
  colWidth: 44,
  rowHeight: 34,
  marginX: 16,
  marginY: 22,
  symbolWidth: 13,
  labelRise: 1.45,
  rungNumbers: true,
  terminalNumbers: true,
};

/** 描画側の文字寸法（論理単位）。`SchematicSvg` の `LABEL_FONT_SIZE` と揃える。 */
const LABEL_FONT = 8;
const TERMINAL_FONT = 5.2;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 文字の外形（描画側の字送りに合わせた見積もり。全角混じりで1字 ≒ 0.58em）。 */
function textBox(s: Shape, fontSize: number): Box | undefined {
  if (s.kind !== 'text') return undefined;
  const width = s.text.length * fontSize * 0.58;
  const left = s.anchor === 'middle' ? s.x - width / 2 : s.anchor === 'end' ? s.x - width : s.x;
  return { x1: left, x2: left + width, y1: s.y - fontSize / 2, y2: s.y + fontSize / 2 };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/** 線分の外形（太さ1本ぶんの余裕を足す）。 */
function segmentBox(s: Extract<Shape, { kind: 'line' }>, pad: number): Box {
  return {
    x1: Math.min(s.x1, s.x2) - pad,
    x2: Math.max(s.x1, s.x2) + pad,
    y1: Math.min(s.y1, s.y2) - pad,
    y2: Math.max(s.y1, s.y2) + pad,
  };
}

const ALL_DOCS = [selfHoldDoc(), interlockDoc(), onDelayDoc(), flickerDoc()];

const CONTACT_KINDS: readonly CellKind[] = ['pb-a', 'pb-b', 'cr-a', 'cr-b', 't-a', 't-b'];

describe('接点記号（JIS C 0617 の刃形）', () => {
  it('どの種別も左右の固定接点が電線の端（中心 ± 記号幅/2）にぴったり来る', () => {
    for (const kind of CONTACT_KINDS) {
      const shapes = contactShapes(kind, 100, 50, 12);
      const bars = shapes.filter(
        (s): s is Extract<Shape, { kind: 'line' }> => s.kind === 'line' && s.x1 === s.x2,
      );
      const xs = bars.map((s) => s.x1);
      expect(xs, kind).toContain(94);
      expect(xs, kind).toContain(106);
    }
  });

  it('a接点は開き（ブレードが右の固定接点に届かない）、b接点は閉じる（届く）', () => {
    const s = 12;
    for (const [open, closed] of [
      ['cr-a', 'cr-b'],
      ['t-a', 't-b'],
      ['pb-a', 'pb-b'],
    ] as const) {
      const a = contactShapes(open, 0, 0, s)[2];
      const b = contactShapes(closed, 0, 0, s)[2];
      if (a?.kind !== 'line' || b?.kind !== 'line') throw new Error('blade');
      // b接点のブレードの先は右の固定接点（x = +s/2）の上
      expect(b.x2, closed).toBeCloseTo(s / 2, 6);
      // a接点は記号幅の 0.2 倍ぶん手前で止まる（＝目で見える開き）
      expect(a.x2, open).toBeCloseTo(s / 2 - s * SYMBOL_METRICS.bladeGap, 6);
      expect(s / 2 - a.x2).toBeGreaterThanOrEqual(s * 0.2);
    }
  });

  it('b接点の右の固定接点はブレードの先より上まで伸びる（触れている）', () => {
    const shapes = contactShapes('cr-b', 0, 0, 12);
    const [, rightBar, blade] = shapes;
    if (rightBar?.kind !== 'line' || blade?.kind !== 'line') throw new Error('shape');
    expect(rightBar.y1).toBeLessThan(blade.y2);
    // a接点の右棒はブレードの先よりずっと下（開いて見える）
    const openBar = contactShapes('cr-a', 0, 0, 12)[1];
    if (openBar?.kind !== 'line') throw new Error('shape');
    expect(openBar.y1).toBeGreaterThan(blade.y2);
  });

  it('押ボタンは操作子（縦棒＋キャップ）を持ち、限時接点は限時記号（円弧）を持つ', () => {
    expect(contactShapes('pb-a', 0, 0, 12).filter((s) => s.kind === 'line')).toHaveLength(5);
    expect(contactShapes('cr-a', 0, 0, 12).filter((s) => s.kind === 'arc')).toHaveLength(0);
    for (const kind of ['t-a', 't-b'] as const) {
      const arcs = contactShapes(kind, 0, 0, 12).filter((s) => s.kind === 'arc');
      expect(arcs, kind).toHaveLength(1);
    }
  });

  it('操作子はブレードの上に立ち、銘板の高さまでは上がらない', () => {
    const s = 12;
    const shapes = contactShapes('pb-a', 0, 0, s);
    const stem = shapes[3];
    const cap = shapes[4];
    if (stem?.kind !== 'line' || cap?.kind !== 'line') throw new Error('actuator');
    expect(stem.x1).toBeCloseTo(stem.x2, 6); // 縦
    expect(cap.y1).toBeCloseTo(cap.y2, 6); // 横
    expect(cap.y1).toBeCloseTo(stem.y2, 6); // キャップは縦棒の先
    // 銘板（y = −labelRise × s、高さ6）の下端よりは下に収まる
    expect(cap.y1).toBeGreaterThan(-SYMBOL_METRICS.labelRise * s + 3);
    // ブレードの上にある
    expect(cap.y1).toBeLessThan(stem.y1);
  });
});

describe('負荷記号', () => {
  it('コイルは端子と突き合う長方形（JIS C 0617）', () => {
    const shapes = loadShapes(coil('c', 'CR1'), 100, 50, 12);
    const rect = shapes[0];
    if (rect?.kind !== 'rect') throw new Error('rect');
    expect(rect.x).toBe(94);
    expect(rect.x + rect.w).toBe(106);
    expect(rect.h).toBeCloseTo(12 * SYMBOL_METRICS.coilHalfHeight * 2, 6);
  });

  it('ランプは色つきの丸＋×で、×は円周に触れる', () => {
    const shapes = loadShapes(lamp('c', 'PL2'), 0, 0, 12);
    const circle = shapes[0];
    if (circle?.kind !== 'circle') throw new Error('circle');
    expect(circle.r).toBeCloseTo(6, 6);
    expect(circle.fill).toBe('#F2C230');
    const arm = shapes[1];
    if (arm?.kind !== 'line') throw new Error('line');
    expect(Math.hypot(arm.x2, arm.y2)).toBeCloseTo(circle.r, 2);
  });

  it('ブザーは半円と弦', () => {
    const shapes = loadShapes(buzzer('c'), 0, 0, 12);
    expect(shapes[0]?.kind).toBe('arc');
    expect(shapes[1]?.kind).toBe('line');
  });
});

describe('図としての体裁（印刷された練習シートの決まりごと）', () => {
  it('母線は左右に1本ずつあり、P と N の見出しが付く', () => {
    for (const doc of ALL_DOCS) {
      const shapes = layout(doc, PRINT).shapes;
      const bus = shapes.filter(
        (s): s is Extract<Shape, { kind: 'line' }> => s.role === 'bus' && s.kind === 'line',
      );
      expect(bus).toHaveLength(2);
      expect(bus[0]?.x1).toBeLessThan(bus[1]?.x1 ?? 0);
      const labels = shapes
        .filter((s) => s.role === 'label' && s.rungId === undefined && s.kind === 'text')
        .map((s) => (s.kind === 'text' ? s.text : ''));
      expect(labels).toEqual(['P(+24V)', 'N(0V)']);
    }
  });

  it('銘板も端子番号も電線には乗らない', () => {
    for (const doc of ALL_DOCS) {
      const shapes = layout(doc, PRINT).shapes;
      const wires = shapes.filter(
        (s): s is Extract<Shape, { kind: 'line' }> =>
          s.kind === 'line' && (s.role === 'wire' || s.role === 'bus'),
      );
      const hits: string[] = [];
      for (const s of shapes) {
        if (s.kind !== 'text') continue;
        const box = textBox(s, s.role === 'terminal' ? TERMINAL_FONT : LABEL_FONT);
        if (box === undefined) continue;
        for (const wire of wires) {
          // 縦線と横線は太さぶんだけ余裕を見る
          if (overlaps(box, segmentBox(wire, 0.6))) hits.push(`${s.text} が電線に乗る`);
        }
      }
      expect(hits, doc.id).toEqual([]);
    }
  });

  it('銘板どうし・銘板と端子番号は重ならない', () => {
    for (const doc of ALL_DOCS) {
      const texts = layout(doc, PRINT).shapes.filter((s) => s.kind === 'text');
      const hits: string[] = [];
      for (let i = 0; i < texts.length; i += 1) {
        for (let j = i + 1; j < texts.length; j += 1) {
          const a = texts[i];
          const b = texts[j];
          if (a === undefined || b === undefined) continue;
          const boxA = textBox(a, a.role === 'terminal' ? TERMINAL_FONT : LABEL_FONT);
          const boxB = textBox(b, b.role === 'terminal' ? TERMINAL_FONT : LABEL_FONT);
          if (boxA === undefined || boxB === undefined) continue;
          if (overlaps(boxA, boxB)) {
            hits.push(`${a.kind === 'text' ? a.text : ''} と ${b.kind === 'text' ? b.text : ''}`);
          }
        }
      }
      expect(hits, doc.id).toEqual([]);
    }
  });

  it('分岐の合流点（T字）には必ず黒丸が乗る', () => {
    for (const doc of ALL_DOCS) {
      const shapes = layout(doc, PRINT).shapes;
      const dots = shapes.filter((s) => s.role === 'junction' && s.kind === 'circle');
      const branched = doc.rungs.some((r) => !('bus' in r.from) || !('bus' in r.to));
      expect(dots.length > 0, doc.id).toBe(branched);
      const verticals = shapes.filter(
        (s): s is Extract<Shape, { kind: 'line' }> =>
          s.kind === 'line' && s.role === 'wire' && s.x1 === s.x2 && s.y1 !== s.y2,
      );
      // 縦線の端はどちらかが黒丸の上に来る（＝分岐も合流も点で示す）
      for (const v of verticals) {
        const marked = dots.some(
          (d) =>
            d.kind === 'circle' &&
            Math.abs(d.cx - v.x1) < 1e-6 &&
            (Math.abs(d.cy - v.y1) < 1e-6 || Math.abs(d.cy - v.y2) < 1e-6),
        );
        expect(marked, `${doc.id} の縦線 ${v.x1},${v.y1}-${v.y2}`).toBe(true);
      }
      // 黒丸は見える大きさ（記号幅の 0.12 倍以上）
      for (const d of dots) {
        if (d.kind !== 'circle') continue;
        expect(d.r).toBeGreaterThanOrEqual((PRINT.symbolWidth ?? 12) * 0.12);
      }
    }
  });

  it('段番号は左余白（左母線の外）に1段1つ出る', () => {
    const doc = selfHoldDoc();
    const numbers = layout(doc, PRINT).shapes.filter((s) => s.role === 'rung');
    expect(numbers).toHaveLength(doc.rungs.length);
    expect(numbers.map((s) => (s.kind === 'text' ? s.text : ''))).toEqual(['1', '2', '3']);
    for (const n of numbers) {
      if (n.kind !== 'text') continue;
      expect(n.x).toBeLessThan(PRINT.marginX ?? 12);
      expect(n.rungId).toBeDefined();
    }
    // 既定（読取専用の最小構成）では出さない
    expect(layout(doc).shapes.filter((s) => s.role === 'rung')).toHaveLength(0);
  });
});

describe('端子番号（§11.3）', () => {
  it('コイルは⑭⑬、ランプは＋−、押ボタンは c と a／b', () => {
    const doc = createDocument('x', '端子', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), pbB('c2', 'PB2'), coil('c3', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crB('c6', 'CR1'), buzzer('c7')]),
    ]);
    const marks = terminalMarks(doc);
    expect(marks.get('c1')).toEqual({ left: '1c', right: '1a' });
    expect(marks.get('c2')).toEqual({ left: '2c', right: '2b' });
    expect(marks.get('c3')).toEqual({ left: '14', right: '13' });
    expect(marks.get('c4')).toEqual({ left: '9', right: '5' });
    expect(marks.get('c5')).toEqual({ left: '1+', right: '1−' });
    expect(marks.get('c6')).toEqual({ left: '10', right: '2' });
    expect(marks.get('c7')).toEqual({ left: '+', right: '−' });
  });

  it('組の採番は assignToBoard() と必ず一致する（図と盤が食い違わない）', () => {
    for (const doc of ALL_DOCS) {
      const assigned = assignToBoard(doc);
      expect(assigned.ok, doc.id).toBe(true);
      if (!assigned.ok) continue;
      const marks = terminalMarks(doc);
      for (const cell of assigned.cells) {
        const mark = marks.get(cell.cellId);
        expect(mark, `${doc.id}/${cell.cellId}`).toBeDefined();
        if (mark === undefined) continue;
        // 割当された端子IDの末尾（`CR1.9` の `9` や `TB_PB.1c` の `1c`）と一致する
        expect(String(cell.left).split('.')[1], cell.cellId).toBe(mark.left.replace('−', '-'));
        expect(String(cell.right).split('.')[1], cell.cellId).toBe(mark.right.replace('−', '-'));
      }
    }
  });

  it('接点を5個使う機器の5個目には番号を出さない（嘘の番号を刷らない）', () => {
    const doc = createDocument('x', '5個目', [
      rung('r1', BUS_P, BUS_N, [
        crA('c1', 'CR1'),
        crA('c2', 'CR1'),
        crA('c3', 'CR1'),
        crA('c4', 'CR1'),
        crA('c5', 'CR1'),
        coil('c6', 'CR2'),
      ]),
    ]);
    const marks = terminalMarks(doc);
    expect(marks.get('c4')).toEqual({ left: '12', right: '8' });
    expect(marks.has('c5')).toBe(false);
    // 図にも出ない（`layout()` が落ちないことも合わせて確かめる）
    const texts = layout(doc, PRINT)
      .shapes.filter((s) => s.cellId === 'c5' && s.kind === 'text')
      .map((s) => (s.kind === 'text' ? s.text : ''));
    expect(texts).toEqual(['CR1']);
  });

  it('タイマ接点も限時記号と一緒に番号が付く', () => {
    const doc = createDocument('x', 'タイマ', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', 3000)]),
      rung('r2', BUS_P, BUS_N, [tA('c3', 'T1'), lamp('c4', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [tB('c5', 'T1'), lamp('c6', 'PL2')]),
    ]);
    const marks = terminalMarks(doc);
    expect(marks.get('c3')).toEqual({ left: '9', right: '5' });
    expect(marks.get('c5')).toEqual({ left: '10', right: '2' });
    const terminals = layout(doc, PRINT).shapes.filter((s) => s.role === 'terminal');
    expect(terminals).toHaveLength(doc.rungs.flatMap((r) => r.cells).length * 2);
    // 既定では出さない（`layout()` の出力を今までどおりに保つ）
    expect(layout(doc).shapes.filter((s) => s.role === 'terminal')).toHaveLength(0);
  });
});
