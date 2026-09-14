import type { CellKind, SchematicCell, SchematicDocument } from './document.js';

/**
 * 読取専用レンダラ用の純粋レイアウト。設計仕様 §11.2。
 * 文書モデルから図形プリミティブ（線分・円・円弧・テキスト）の列を返すだけで、
 * SVG化は `apps/desktop`（Phase 1D）の責務。座標は mm/px 非依存の論理単位。
 */

/** レイアウトの寸法設定（論理単位）。 */
export interface LayoutOptions {
  /** 1列（要素1つ分）の幅。 */
  colWidth?: number;
  /** 1行（段1つ分）の高さ。 */
  rowHeight?: number;
  /** 左右の余白。 */
  marginX?: number;
  /** 上下の余白。 */
  marginY?: number;
  /** 記号そのものの幅。 */
  symbolWidth?: number;
}

/** 既定の寸法設定。 */
export const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  colWidth: 24,
  rowHeight: 16,
  marginX: 12,
  marginY: 16,
  symbolWidth: 12,
};

/** 図形の役割（描画側が線幅・色を決めるための分類）。 */
export type ShapeRole = 'bus' | 'wire' | 'symbol' | 'label' | 'junction';

/** 図形プリミティブ。 */
export type Shape =
  | { kind: 'line'; role: ShapeRole; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; role: ShapeRole; cx: number; cy: number; r: number; fill?: string }
  | {
      kind: 'arc';
      role: ShapeRole;
      cx: number;
      cy: number;
      r: number;
      startDeg: number;
      endDeg: number;
    }
  | {
      kind: 'text';
      role: ShapeRole;
      x: number;
      y: number;
      text: string;
      anchor: 'start' | 'middle' | 'end';
    };

/** レイアウト結果。 */
export interface SchematicLayout {
  width: number;
  height: number;
  shapes: Shape[];
}

/** 表示灯の色 → 塗り色。§5.3.4 */
export const LAMP_FILL: Readonly<Record<string, string>> = {
  PL1: '#FFFFFF',
  PL2: '#F2C230',
  PL3: '#3FA34D',
  PL4: '#D64545',
};

/** 押ボタンの操作子を描く種別。 */
const PUSH_BUTTON_KINDS: readonly CellKind[] = ['pb-a', 'pb-b'];
/** 限時記号（パラシュート）を描く種別。調査資料 §3.4 */
const TIMED_KINDS: readonly CellKind[] = ['t-a', 't-b'];
/** b接点（閉じている接点）の種別。 */
const BREAK_KINDS: readonly CellKind[] = ['pb-b', 'cr-b', 't-b'];

function line(role: ShapeRole, x1: number, y1: number, x2: number, y2: number): Shape {
  return { kind: 'line', role, x1, y1, x2, y2 };
}

/** 1つの接点記号の図形。JIS風（縦棒2本＋ブレード、b接点は閉じ棒、タイマは限時記号）。§11.1 */
export function contactShapes(
  kind: CellKind,
  cx: number,
  cy: number,
  symbolWidth: number,
): Shape[] {
  const s = symbolWidth;
  const left = cx - s * 0.25;
  const right = cx + s * 0.25;
  const shapes: Shape[] = [
    line('symbol', left, cy - s * 0.3, left, cy + s * 0.3),
    line('symbol', right, cy - s * 0.3, right, cy + s * 0.3),
    line('symbol', left, cy, right, cy - s * 0.45),
  ];
  if (BREAK_KINDS.includes(kind)) {
    shapes.push(line('symbol', right, cy - s * 0.45, right, cy + s * 0.15));
  }
  if (PUSH_BUTTON_KINDS.includes(kind)) {
    shapes.push(line('symbol', cx, cy - s * 0.22, cx, cy - s * 0.8));
    shapes.push(line('symbol', cx - s * 0.25, cy - s * 0.8, cx + s * 0.25, cy - s * 0.8));
  }
  if (TIMED_KINDS.includes(kind)) {
    shapes.push({
      kind: 'arc',
      role: 'symbol',
      cx,
      cy: cy - s * 0.5,
      r: s * 0.3,
      startDeg: 180,
      endDeg: 360,
    });
  }
  return shapes;
}

/** 1つの負荷記号の図形（コイル＝丸、ランプ＝丸＋×、ブザー＝半円）。§11.1 */
export function loadShapes(
  cell: SchematicCell,
  cx: number,
  cy: number,
  symbolWidth: number,
): Shape[] {
  const s = symbolWidth;
  const r = s * 0.4;
  if (cell.kind === 'coil') {
    return [{ kind: 'circle', role: 'symbol', cx, cy, r }];
  }
  if (cell.kind === 'lamp') {
    const d = r * 0.7;
    return [
      { kind: 'circle', role: 'symbol', cx, cy, r, fill: LAMP_FILL[cell.device] ?? '#FFFFFF' },
      line('symbol', cx - d, cy - d, cx + d, cy + d),
      line('symbol', cx - d, cy + d, cx + d, cy - d),
    ];
  }
  return [
    { kind: 'arc', role: 'symbol', cx, cy, r, startDeg: 180, endDeg: 360 },
    line('symbol', cx - r, cy, cx + r, cy),
  ];
}

function cellLabel(cell: SchematicCell): string {
  if (cell.kind === 'coil' && cell.presetMs !== undefined) {
    return `${cell.device} (${(cell.presetMs / 1000).toFixed(1)}秒)`;
  }
  return cell.device;
}

function isLoad(kind: CellKind): boolean {
  return kind === 'coil' || kind === 'lamp' || kind === 'buzzer';
}

/**
 * 文書を図形プリミティブの列にする。同じ文書からは必ず同じ結果が出る（決定論）。§11.2
 */
export function layout(doc: SchematicDocument, options: LayoutOptions = {}): SchematicLayout {
  const o = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const shapes: Shape[] = [];
  const busPX = o.marginX;

  const rowY = new Map<string, number>();
  doc.rungs.forEach((r, i) => rowY.set(r.id, o.marginY + i * o.rowHeight));

  const startX = new Map<string, number>();
  for (const r of doc.rungs) {
    if ('bus' in r.from) {
      startX.set(r.id, busPX);
      continue;
    }
    const parent = startX.get(r.from.rung);
    startX.set(r.id, (parent ?? busPX) + r.from.node * o.colWidth);
  }

  let maxRight = busPX;
  for (const r of doc.rungs) {
    const end = (startX.get(r.id) ?? busPX) + r.cells.length * o.colWidth;
    if (end > maxRight) maxRight = end;
  }
  const busNX = maxRight + o.colWidth;
  const topY = o.marginY - o.rowHeight * 0.6;
  const bottomY =
    doc.rungs.length === 0
      ? topY
      : o.marginY + (doc.rungs.length - 1) * o.rowHeight + o.rowHeight * 0.6;

  shapes.push(line('bus', busPX, topY, busPX, bottomY));
  shapes.push(line('bus', busNX, topY, busNX, bottomY));
  shapes.push({
    kind: 'text',
    role: 'label',
    x: busPX,
    y: topY - o.rowHeight * 0.4,
    text: 'P(+24V)',
    anchor: 'middle',
  });
  shapes.push({
    kind: 'text',
    role: 'label',
    x: busNX,
    y: topY - o.rowHeight * 0.4,
    text: 'N(0V)',
    anchor: 'middle',
  });

  for (const r of doc.rungs) {
    const y = rowY.get(r.id) ?? o.marginY;
    const x0 = startX.get(r.id) ?? busPX;

    // 始点（母線から始まる段は x0 が左母線そのもの。分岐段は親の段から縦線を下ろす）
    if (!('bus' in r.from)) {
      const parentY = rowY.get(r.from.rung);
      if (parentY !== undefined) {
        shapes.push(line('wire', x0, parentY, x0, y));
        shapes.push({
          kind: 'circle',
          role: 'junction',
          cx: x0,
          cy: parentY,
          r: o.symbolWidth * 0.1,
        });
      }
    }

    // 要素
    r.cells.forEach((cell, index) => {
      const cellLeft = x0 + index * o.colWidth;
      const cellRight = cellLeft + o.colWidth;
      const cx = (cellLeft + cellRight) / 2;
      shapes.push(line('wire', cellLeft, y, cx - o.symbolWidth / 2, y));
      shapes.push(line('wire', cx + o.symbolWidth / 2, y, cellRight, y));
      if (isLoad(cell.kind)) {
        shapes.push(...loadShapes(cell, cx, y, o.symbolWidth));
      } else {
        shapes.push(...contactShapes(cell.kind, cx, y, o.symbolWidth));
      }
      shapes.push({
        kind: 'text',
        role: 'label',
        x: cx,
        y: y - o.symbolWidth * 0.95,
        text: cellLabel(cell),
        anchor: 'middle',
      });
    });

    // 終点（右母線、または他の段への合流）
    const endX = x0 + r.cells.length * o.colWidth;
    if ('bus' in r.to) {
      if (endX !== busNX) shapes.push(line('wire', endX, y, busNX, y));
    } else {
      const targetX = (startX.get(r.to.rung) ?? busPX) + r.to.node * o.colWidth;
      const targetY = rowY.get(r.to.rung);
      if (endX !== targetX) shapes.push(line('wire', endX, y, targetX, y));
      if (targetY !== undefined) {
        shapes.push(line('wire', targetX, y, targetX, targetY));
        shapes.push({
          kind: 'circle',
          role: 'junction',
          cx: targetX,
          cy: targetY,
          r: o.symbolWidth * 0.1,
        });
      }
    }
  }

  return { width: busNX + o.marginX, height: bottomY + o.marginY, shapes };
}
