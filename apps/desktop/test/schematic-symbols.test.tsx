import { BUILTIN_ASSEMBLE_PROBLEMS, BUILTIN_INSPECT_REPAIR_PROBLEMS } from '@ojt/content';
import { SYMBOL_METRICS, type SchematicDocument } from '@ojt/schematic-core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMATIC_LAYOUT, SchematicSvg } from '../src/renderer/schematic/SchematicSvg.js';

/**
 * 回路図ヒントの**刷り上がり**を見る（利用者要求 2026-09-20「表示シンボルのデザインがおかしい」）。
 *
 * `@ojt/schematic-core` の `test/symbols.test.ts` は記号1つの作りを比で見る。ここは反対に、
 * 内蔵課題を実際に SVG にしてから「ヒント欄の幅（約430px）に置いたとき何pxになるか」を測る。
 * 記号の比が正しくても、寸法設定（`SCHEMATIC_LAYOUT`）が釣り合っていなければ画面では読めない。
 *
 * 見るのは4つだけ:
 * - 文字が読める大きさか（銘板 11px 以上・端子番号 9px 以上）
 * - 文字が他の文字にも線にもかぶらないか（2px 以上あける）
 * - 記号が「小さな斜線」に見えない大きさか
 * - **出力がすべて丸か**（長方形は1つも使わない。利用者の決め事 2026-09-20）
 */

/** 右パネルの回路図ヒントの紙の幅（`screens.module.css` の `.schematicBox` の実寸）。 */
const HINT_WIDTH_PX = 430;
/** 文字と文字・文字と線のあいだに最低限あける距離（画面px）。 */
const MIN_CLEARANCE_PX = 2;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Named {
  box: Box;
  what: string;
}

function num(element: Element, name: string): number {
  return Number(element.getAttribute(name) ?? '0');
}

/**
 * 文字の外形。ブラウザ無しでは字幅を測れないので、描画側（`SchematicSvg.boundsOf`）と
 * **同じ見積もり**（全角混じりで1字 0.62em）を使う。実機より広めに見るので安全側。
 */
function textBox(element: Element): Box {
  const size = num(element, 'font-size');
  const text = element.textContent ?? '';
  const width = text.length * size * 0.62;
  const x = num(element, 'x');
  const anchor = element.getAttribute('text-anchor');
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const y = num(element, 'y');
  return { x1: left, y1: y - size / 2, x2: left + width, y2: y + size / 2 };
}

/** 線・長方形・丸の外形（線幅の半分だけ太らせる）。 */
function strokeBoxes(svg: Element, scale: number): Named[] {
  const out: Named[] = [];
  for (const l of svg.querySelectorAll('line')) {
    const pad = num(l, 'stroke-width') / scale / 2;
    out.push({
      what: `line ${String(num(l, 'x1'))},${String(num(l, 'y1'))}`,
      box: {
        x1: Math.min(num(l, 'x1'), num(l, 'x2')) - pad,
        y1: Math.min(num(l, 'y1'), num(l, 'y2')) - pad,
        x2: Math.max(num(l, 'x1'), num(l, 'x2')) + pad,
        y2: Math.max(num(l, 'y1'), num(l, 'y2')) + pad,
      },
    });
  }
  for (const r of svg.querySelectorAll('rect')) {
    // 用紙（`schematic-paper`）と編集の当たり矩形は図形ではない
    if (r.getAttribute('data-testid') === 'schematic-paper') continue;
    out.push({
      what: 'rect',
      box: {
        x1: num(r, 'x'),
        y1: num(r, 'y'),
        x2: num(r, 'x') + num(r, 'width'),
        y2: num(r, 'y') + num(r, 'height'),
      },
    });
  }
  for (const c of svg.querySelectorAll('circle')) {
    const r = num(c, 'r');
    out.push({
      what: 'circle',
      box: {
        x1: num(c, 'cx') - r,
        y1: num(c, 'cy') - r,
        x2: num(c, 'cx') + r,
        y2: num(c, 'cy') + r,
      },
    });
  }
  return out;
}

/** 2つの外形が `gap` だけ離れているか（どちらかの軸で離れていればよい）。 */
function apart(a: Box, b: Box, gap: number): boolean {
  return a.x2 + gap <= b.x1 || b.x2 + gap <= a.x1 || a.y2 + gap <= b.y1 || b.y2 + gap <= a.y1;
}

const PROBLEMS = ['b-001', 'b-006', 'c2-001'] as const;

function docOf(id: string): SchematicDocument {
  const found = [...BUILTIN_ASSEMBLE_PROBLEMS, ...BUILTIN_INSPECT_REPAIR_PROBLEMS].find(
    (p) => p.id === id,
  );
  if (found === undefined) throw new Error(`内蔵課題がありません: ${id}`);
  return found.schematic;
}

/** 図を1枚描いて、ヒント欄に置いたときの縮尺と図形をまとめて返す。 */
function sheetOf(id: string): { svg: Element; scale: number; texts: Element[] } {
  const { container } = render(<SchematicSvg document={docOf(id)} />);
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('svg');
  const view = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
  const width = view[2] ?? 1;
  return { svg, scale: HINT_WIDTH_PX / width, texts: [...svg.querySelectorAll('text')] };
}

afterEach(() => {
  cleanup();
});

describe('ヒント欄の幅で文字が読める（2026-09-20 の記号見直し）', () => {
  it.each(PROBLEMS)('%s: 銘板は11px以上・端子番号は9px以上になる', (id) => {
    const { scale, texts } = sheetOf(id);
    const px = (element: Element): number => num(element, 'font-size') * scale;
    const labels = texts.filter((t) => Number(t.getAttribute('font-weight')) === 600);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels)
      expect(px(label), label.textContent ?? '').toBeGreaterThanOrEqual(11);
    const numbers = texts.filter((t) => (t.getAttribute('font-family') ?? '').includes('mono'));
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) expect(px(n), n.textContent ?? '').toBeGreaterThanOrEqual(9);
  });
});

describe('文字はぶつからない（銘板・端子番号・設定時間）', () => {
  it.each(PROBLEMS)('%s: 文字どうしが2px以上あく', (id) => {
    const { scale, texts } = sheetOf(id);
    const gap = MIN_CLEARANCE_PX / scale;
    const hits: string[] = [];
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i];
        const b = texts[j];
        if (a === undefined || b === undefined) continue;
        if (!apart(textBox(a), textBox(b), gap)) {
          hits.push(`${a.textContent ?? ''} と ${b.textContent ?? ''}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it.each(PROBLEMS)('%s: 文字が電線・記号に乗らない', (id) => {
    const { svg, scale, texts } = sheetOf(id);
    const gap = MIN_CLEARANCE_PX / scale;
    const marks = strokeBoxes(svg, scale);
    const hits: string[] = [];
    for (const t of texts) {
      const box = textBox(t);
      for (const mark of marks) {
        if (!apart(box, mark.box, gap)) hits.push(`${t.textContent ?? ''} が ${mark.what} に乗る`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('出力は右端の1列（展開接続図の決まり。利用者要求 2026-09-20）', () => {
  it.each(PROBLEMS)('%s: コイル・ランプが縦にそろい、右母線に付く', (id) => {
    const { svg } = sheetOf(id);
    const doc = docOf(id);
    const loadIds = doc.rungs.flatMap((r) =>
      r.cells.filter((c) => c.kind === 'coil' || c.kind === 'lamp' || c.kind === 'buzzer'),
    );
    expect(loadIds.length).toBeGreaterThan(1);
    /** その要素の記号の左端x（線・長方形・丸のどれでも）。 */
    const leftOf = (cellId: string): number => {
      const own = [...svg.querySelectorAll(`[data-cell="${cellId}"]`)];
      const xs = own.flatMap((el) => {
        if (el.tagName === 'rect') return [num(el, 'x')];
        if (el.tagName === 'circle') return [num(el, 'cx') - num(el, 'r')];
        if (el.tagName === 'line') return [Math.min(num(el, 'x1'), num(el, 'x2'))];
        return [];
      });
      return Math.min(...xs);
    };
    // どの出力もぴったり同じ列に立つ
    const columns = new Set(loadIds.map((c) => leftOf(c.id).toFixed(3)));
    expect([...columns]).toHaveLength(1);
    const loadLeft = leftOf(loadIds[0]?.id ?? '');
    // 接点はすべてその列より左（出力より右に接点は無い＝出力は右母線に付く）
    for (const rung of doc.rungs) {
      for (const cell of rung.cells) {
        if (cell.kind === 'coil' || cell.kind === 'lamp' || cell.kind === 'buzzer') continue;
        expect(leftOf(cell.id), cell.id).toBeLessThan(loadLeft);
      }
    }
    // 右母線は出力のすぐ右（1桁ぶんも離れていない）。母線は最初の2本の線
    const [busP, busN] = [...svg.querySelectorAll('line')];
    if (busP === undefined || busN === undefined) throw new Error('bus');
    const busNX = num(busN, 'x1');
    expect(busNX).toBeGreaterThan(num(busP, 'x1'));
    expect(busNX).toBeGreaterThan(loadLeft);
    expect(busNX - loadLeft).toBeLessThan((SCHEMATIC_LAYOUT.colWidth ?? 0) * 2);
  });
});

describe('記号が「小さな斜線」に見えない大きさになる', () => {
  it.each(PROBLEMS)('%s: 接点は25px以上の幅、開きは6px以上になる', (id) => {
    const { scale } = sheetOf(id);
    const s = SCHEMATIC_LAYOUT.symbolWidth ?? 0;
    expect(s * scale).toBeGreaterThanOrEqual(25);
    // a接点の開き（ブレードの先から右の引出線の始まりまで）
    expect(s * SYMBOL_METRICS.bladeGap * scale).toBeGreaterThanOrEqual(6);
    // ブレードの長さと、b接点の縦棒の高さ
    expect(s * SYMBOL_METRICS.bladeLength * scale).toBeGreaterThanOrEqual(22);
    expect(s * SYMBOL_METRICS.stubHeight * scale).toBeGreaterThanOrEqual(12);
    // 記号は列の幅の半分以上（引出線ばかりが長い、記号の痩せた図にしない）
    expect(s).toBeGreaterThanOrEqual((SCHEMATIC_LAYOUT.colWidth ?? 0) * 0.5);
    // コイルの丸は「丸」と分かる大きさ、タイマの限時記号もその中で読める大きさ
    expect(s * SYMBOL_METRICS.coilRadius * 2 * scale).toBeGreaterThanOrEqual(17);
    expect(s * SYMBOL_METRICS.coilDelayRadius * 2 * scale).toBeGreaterThanOrEqual(8);
  });
});

describe('出力はすべて丸（四角は使わない。利用者の決め事 2026-09-20）', () => {
  it.each(PROBLEMS)('%s: コイルは丸で、ランプの丸よりひと回り大きい', (id) => {
    const { svg, scale } = sheetOf(id);
    const doc = docOf(id);
    const loads = doc.rungs.flatMap((r) =>
      r.cells.filter((c) => c.kind === 'coil' || c.kind === 'lamp' || c.kind === 'buzzer'),
    );
    const coils = loads.filter((c) => c.kind === 'coil');
    expect(coils.length).toBeGreaterThan(0);
    // どの出力の図形にも長方形は出ない（用紙と編集の当たり矩形は `data-cell` を持たない）
    for (const load of loads) {
      const own = [...svg.querySelectorAll(`[data-cell="${load.id}"]`)].map((el) => el.tagName);
      expect(own, load.id).not.toContain('rect');
    }
    /** その出力の丸の直径（ヒント欄に置いたときの画面px）。 */
    const diameterPx = (cellId: string): number => {
      const circle = svg.querySelector(`circle[data-cell="${cellId}"]`);
      if (circle === null) throw new Error(`丸がありません: ${cellId}`);
      return num(circle, 'r') * 2 * scale;
    };
    for (const c of coils) expect(diameterPx(c.id), c.id).toBeGreaterThanOrEqual(17);
    const lamp = loads.find((c) => c.kind === 'lamp');
    const firstCoil = coils[0];
    if (lamp !== undefined && firstCoil !== undefined) {
      // コイル＝ただの丸、ランプ＝ひと回り小さい丸＋×。大きさと×の両方で読み分ける
      expect(diameterPx(firstCoil.id)).toBeGreaterThan(diameterPx(lamp.id));
    }
  });
});
