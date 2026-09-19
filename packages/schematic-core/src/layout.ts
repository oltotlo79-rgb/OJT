import type { CellKind, Rung, RungEnd, SchematicCell, SchematicDocument } from './document.js';
import {
  contactShapes,
  loadShapes,
  SYMBOL_METRICS,
  terminalMarks,
  type Shape,
  type ShapeRole,
} from './symbols.js';

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
  /**
   * 銘板（`CR1` など）を記号の中心から上へ離す量（記号幅に対する倍率）。
   * 既定は `SYMBOL_METRICS.labelRise`。段を高く取る描画（端子番号まで刷る図）では
   * 文字を大きくするので、描画側がこの値も広げて渡す。
   */
  labelRise?: number;
  /**
   * 左余白に段番号（1, 2, 3…）を刷るか。印刷された展開接続図に倣う表示専用の飾りで、
   * 既定は `false`（`layout()` の出力を今までどおりに保つため）。§11.1
   */
  rungNumbers?: boolean;
  /**
   * 記号の下に端子番号（コイルの⑭⑬、接点のCOM/a/b、ランプの＋−）を刷るか。§11.3
   * 既定は `false`。番号は `terminalMarks()` が `assignToBoard()` と同じ規則で決める。
   */
  terminalNumbers?: boolean;
}

/**
 * 既定の寸法設定。
 *
 * `colWidth` 24 は文字寸法6のラベルで7文字ぶん（`3.4 × 7 ≒ 24`）まで。`T1 (3.0秒)` のような
 * 長いラベルを重ねずに描くには、描画側が `colWidth` を広げて渡す。
 * `rowHeight` 24 は、行の記号（`y ± symbolWidth × 0.3`、押ボタンの操作子は
 * `y − symbolWidth × SYMBOL_METRICS.actuatorTop`）と次の行の銘板
 * （`y − symbolWidth × SYMBOL_METRICS.labelRise`、高さ6）が重ならない最小の目安。
 * 端子番号（`terminalNumbers`）まで刷るときは描画側が `rowHeight` を広げて渡す。
 */
export const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  colWidth: 24,
  rowHeight: 24,
  marginX: 12,
  marginY: 16,
  symbolWidth: 12,
  labelRise: SYMBOL_METRICS.labelRise,
  rungNumbers: false,
  terminalNumbers: false,
};

export {
  contactShapes,
  LAMP_FILL,
  loadShapes,
  SYMBOL_METRICS,
  terminalMarks,
  type Shape,
  type ShapeRole,
  type ShapeSource,
  type TerminalMark,
} from './symbols.js';

/** レイアウト結果。 */
export interface SchematicLayout {
  width: number;
  height: number;
  shapes: Shape[];
}

function line(role: ShapeRole, x1: number, y1: number, x2: number, y2: number): Shape {
  return { kind: 'line', role, x1, y1, x2, y2 };
}

function text(
  role: ShapeRole,
  x: number,
  y: number,
  value: string,
  anchor: 'start' | 'middle' | 'end',
): Shape {
  return { kind: 'text', role, x, y, text: value, anchor };
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

/** 参照先の節点番号を親の節点範囲（0〜要素数）に丸める。壊れた参照で図が横に飛ばないように。§13 #2 */
function clampNode(node: number, cellCount: number): number {
  if (!Number.isFinite(node)) return 0;
  return Math.min(Math.max(Math.round(node), 0), cellCount);
}

/** 図形に出どころを付ける。 */
function tag(shapes: readonly Shape[], rungId: string, cellId?: string): Shape[] {
  return shapes.map((s) => ({ ...s, rungId, ...(cellId === undefined ? {} : { cellId }) }));
}

/**
 * 文書を図形プリミティブの列にする。同じ文書からは必ず同じ結果が出る（決定論）。§11.2
 */
export function layout(doc: SchematicDocument, options: LayoutOptions = {}): SchematicLayout {
  const o = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const shapes: Shape[] = [];
  const busPX = o.marginX;

  const rungById = new Map(doc.rungs.map((r) => [r.id, r]));
  const rowY = new Map<string, number>();
  doc.rungs.forEach((r, i) => rowY.set(r.id, o.marginY + i * o.rowHeight));
  const rowOf = (rungId: string): number => rowY.get(rungId) ?? o.marginY;

  // 段の左端xは `rungStartX()` が決める（編集UIの当たり判定 `slotRects()` と同じ値を使うため）
  const startX = rungStartX(doc, options);
  const startOf = (r: Rung): number => startX.get(r.id) ?? busPX;
  /** 分岐参照の指す点のx。参照先の段が無ければ左母線に寄せる。 */
  const branchX = (end: Extract<RungEnd, { rung: string }>): number =>
    (startX.get(end.rung) ?? busPX) +
    clampNode(end.node, rungById.get(end.rung)?.cells.length ?? 0) * o.colWidth;

  let maxRight = busPX;
  for (const r of doc.rungs) {
    const end = startOf(r) + r.cells.length * o.colWidth;
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
  shapes.push(text('label', busPX, topY - o.rowHeight * 0.4, 'P(+24V)', 'middle'));
  shapes.push(text('label', busNX, topY - o.rowHeight * 0.4, 'N(0V)', 'middle'));

  const junction = (cx: number, cy: number): Shape => ({
    kind: 'circle',
    role: 'junction',
    cx,
    cy,
    r: o.symbolWidth * SYMBOL_METRICS.junctionRadius,
  });

  const marks = o.terminalNumbers ? terminalMarks(doc) : undefined;

  doc.rungs.forEach((r, rowIndex) => {
    const y = rowOf(r.id);
    const x0 = startOf(r);

    // 段番号は左余白（母線の外）に置く。図の外なので描画側が viewBox を広げて拾う
    if (o.rungNumbers) {
      shapes.push({
        ...text('rung', busPX - o.symbolWidth * 0.5, y, `${rowIndex + 1}`, 'end'),
        rungId: r.id,
      });
    }

    // 始点（母線から始まる段は x0 が左母線そのもの。分岐段は親の段から縦線を下ろす）
    if (!('bus' in r.from) && rungById.has(r.from.rung)) {
      const parentY = rowOf(r.from.rung);
      shapes.push(...tag([line('wire', x0, parentY, x0, y), junction(x0, parentY)], r.id));
    }

    // 要素
    r.cells.forEach((cell, index) => {
      const cellLeft = x0 + index * o.colWidth;
      const cellRight = cellLeft + o.colWidth;
      const cx = (cellLeft + cellRight) / 2;
      const symbol = isLoad(cell.kind)
        ? loadShapes(cell, cx, y, o.symbolWidth)
        : contactShapes(cell.kind, cx, y, o.symbolWidth);
      shapes.push(
        ...tag(
          [
            line('wire', cellLeft, y, cx - o.symbolWidth / 2, y),
            line('wire', cx + o.symbolWidth / 2, y, cellRight, y),
          ],
          r.id,
        ),
      );
      const mark = marks?.get(cell.id);
      shapes.push(
        ...tag(
          [
            ...symbol,
            text('label', cx, y - o.symbolWidth * o.labelRise, cellLabel(cell), 'middle'),
            // 端子番号は記号の下、電線の外側に振り分ける（線にも銘板にも重ならない）
            ...(mark === undefined
              ? []
              : [
                  text(
                    'terminal',
                    cx - o.symbolWidth * 0.5,
                    y + o.symbolWidth * SYMBOL_METRICS.terminalDrop,
                    mark.left,
                    'end',
                  ),
                  text(
                    'terminal',
                    cx + o.symbolWidth * 0.5,
                    y + o.symbolWidth * SYMBOL_METRICS.terminalDrop,
                    mark.right,
                    'start',
                  ),
                ]),
          ],
          r.id,
          cell.id,
        ),
      );
    });

    // 終点（右母線、または他の段への合流）
    const endX = x0 + r.cells.length * o.colWidth;
    if ('bus' in r.to) {
      if (endX !== busNX) shapes.push(...tag([line('wire', endX, y, busNX, y)], r.id));
    } else if (rungById.has(r.to.rung)) {
      const targetX = branchX(r.to);
      const targetY = rowOf(r.to.rung);
      const rejoin = endX === targetX ? [] : [line('wire', endX, y, targetX, y)];
      shapes.push(
        ...tag(
          [...rejoin, line('wire', targetX, y, targetX, targetY), junction(targetX, targetY)],
          r.id,
        ),
      );
    }
  });

  return { width: busNX + o.marginX, height: bottomY + o.marginY, shapes };
}

/** 段の左端x（`layout()` と `slotRects()` が同じ値を使う）。分岐段は親の節点に合わせる。 */
export function rungStartX(
  doc: SchematicDocument,
  options: LayoutOptions = {},
): Map<string, number> {
  const o = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const busPX = o.marginX;
  const rungById = new Map(doc.rungs.map((r) => [r.id, r]));
  const startX = new Map<string, number>();
  const resolving = new Set<string>();
  /**
   * 段の左端x。親を**再帰で**先に解く（文書順に足していくと、親が後ろに書かれた分岐段だけ
   * 親のxが未知になり、左母線に描かれてしまう）。壊れた文書でも止まるよう解決中の段を覚えておく。
   */
  function startOf(r: Rung): number {
    const memo = startX.get(r.id);
    if (memo !== undefined) return memo;
    if (resolving.has(r.id)) return busPX; // 循環参照（validateDocument が別に弾く）
    resolving.add(r.id);
    const x = 'bus' in r.from ? busPX : branchX(r.from);
    resolving.delete(r.id);
    startX.set(r.id, x);
    return x;
  }
  /** 分岐参照の指す点のx。参照先の段が無ければ左母線に寄せる。 */
  function branchX(end: Extract<RungEnd, { rung: string }>): number {
    const parent = rungById.get(end.rung);
    if (parent === undefined) return busPX;
    return startOf(parent) + clampNode(end.node, parent.cells.length) * o.colWidth;
  }
  for (const r of doc.rungs) startOf(r);
  return startX;
}

/** 編集UIの当たり判定1つぶん（論理単位。`layout()` と同じ座標系）。§11.4 */
export interface SlotRect {
  rungId: string;
  /** 段の中の桁（0〜要素数）。要素数と同じ値は「末尾の空き桁」。 */
  index: number;
  /** その桁に要素があればそのID。空き桁は undefined。 */
  cellId: string | undefined;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 段 × 桁の当たり矩形。`layout()` と同じ寸法設定を渡すこと。§11.4
 * 各段について「要素の数 ＋ 1」個（末尾に空き桁を1つ）返す。
 */
export function slotRects(doc: SchematicDocument, options: LayoutOptions = {}): SlotRect[] {
  const o = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const startX = rungStartX(doc, options);
  const out: SlotRect[] = [];
  doc.rungs.forEach((r, rowIndex) => {
    const x0 = startX.get(r.id) ?? o.marginX;
    const y = o.marginY + rowIndex * o.rowHeight - o.rowHeight / 2;
    for (let index = 0; index <= r.cells.length; index += 1) {
      out.push({
        rungId: r.id,
        index,
        cellId: r.cells[index]?.id,
        x: x0 + index * o.colWidth,
        y,
        w: o.colWidth,
        h: o.rowHeight,
      });
    }
  });
  return out;
}
