import {
  layout,
  LAMP_FILL,
  type LayoutOptions,
  type SchematicDocument,
  type Shape,
  type ShapeRole,
} from '@ojt/schematic-core';
import { useMemo, type JSX } from 'react';

/**
 * 回路図（展開接続図）の読取専用レンダラ。設計仕様 §11.2。
 * 座標計算は `@ojt/schematic-core` の `layout()`（純粋関数）が行い、ここは SVG 化だけを担う。
 * ヒントの出し方は級で決まる（§8.4: 1級は非表示、2級は開閉可、3級は常時表示）。
 *
 * 図形は `Shape`（`line` / `circle` / `arc` / `text`）の直和で、`role` から線幅と色を引く。
 * `key` は配列の添字でよい（`layout()` は決定論なので同じ文書からは同じ並びが出る）。
 * `shape.rungId` / `shape.cellId`（Plan 1B Task 13d）は、Phase 2 で
 * 「盤の端子にホバーすると回路図の該当要素が光る」を作るときに使う。
 */

/** 役割ごとの線幅と色。 */
const STROKE: Readonly<Record<ShapeRole, { color: string; width: number }>> = {
  bus: { color: '#111418', width: 2.2 },
  wire: { color: '#111418', width: 1.2 },
  symbol: { color: '#111418', width: 1.4 },
  label: { color: '#111418', width: 0 },
  junction: { color: '#111418', width: 0 },
};

/** 銘板の文字の大きさ（論理単位）。 */
const LABEL_FONT_SIZE = 6;

/** 連動ハイライトの線色と線幅の倍率。§9.2 */
const HIGHLIGHT_STROKE = '#C2410C';
const HIGHLIGHT_WIDTH_SCALE = 1.8;

/**
 * 寸法設定。`DEFAULT_LAYOUT_OPTIONS` の `colWidth: 24` だと、タイマコイルの銘板
 * （`layout()` が `T1 (3.0秒)` の形で作る）が隣の要素の銘板と重なる。
 * 文字は最大10字ぶん（全角混じりで約 6 × 5.5 ≒ 33）を見込んで1列を 40 にする。
 * 段の高さは `@ojt/schematic-core` の既定（24）に任せる。
 */
const LAYOUT: LayoutOptions = { colWidth: 40 };

/** 極座標の角度[度]を SVG の座標に直す（弧の端点計算）。 */
function arcPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/**
 * 図形プリミティブ1つを SVG 要素にする。
 * `highlighted` は §9.2 の連動ハイライト。白地の回路図では琥珀が読めないので、
 * 3D側（`HIGHLIGHT_COLOR`）とは別に濃い橙を使い、線幅も太らせて見分けられるようにする。
 * `data-cell` は「どの要素の図形か」を DOM に残すもので、クリックの受け口にもテストの
 * 手がかりにもなる（`Shape.cellId`。Plan 1B）。
 */
function renderShape(shape: Shape, index: number, highlighted: boolean): JSX.Element | null {
  const base = STROKE[shape.role];
  const style = highlighted
    ? { color: HIGHLIGHT_STROKE, width: base.width * HIGHLIGHT_WIDTH_SCALE }
    : base;
  const common = {
    ...(shape.cellId === undefined ? {} : { 'data-cell': shape.cellId }),
    ...(highlighted ? { 'data-highlight': 'true' } : {}),
  };
  switch (shape.kind) {
    case 'line':
      return (
        <line
          key={index}
          {...common}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={style.color}
          strokeWidth={style.width}
          strokeLinecap="round"
        />
      );
    case 'circle':
      return (
        <circle
          key={index}
          {...common}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill={shape.fill ?? (shape.role === 'junction' ? style.color : 'none')}
          stroke={style.color}
          strokeWidth={shape.role === 'junction' ? 0 : style.width}
        />
      );
    case 'arc': {
      const [x1, y1] = arcPoint(shape.cx, shape.cy, shape.r, shape.startDeg);
      const [x2, y2] = arcPoint(shape.cx, shape.cy, shape.r, shape.endDeg);
      const large = Math.abs(shape.endDeg - shape.startDeg) > 180 ? 1 : 0;
      return (
        <path
          key={index}
          {...common}
          d={`M ${x1} ${y1} A ${shape.r} ${shape.r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke={style.color}
          strokeWidth={style.width}
        />
      );
    }
    case 'text':
      return (
        <text
          key={index}
          {...common}
          x={shape.x}
          y={shape.y}
          fill={style.color}
          fontSize={LABEL_FONT_SIZE}
          textAnchor={shape.anchor}
          dominantBaseline="middle"
        >
          {shape.text}
        </text>
      );
  }
}

/**
 * 回路図の SVG。§11.2
 * `highlightCellIds` と `onPickCell` はモードC2の連動ハイライト（§9.2）で使う。省略すると
 * 従来どおりの読取専用レンダラとして動く（モードBの回路図ヒント）。
 */
export function SchematicSvg({
  document: doc,
  highlightCellIds,
  onPickCell,
}: {
  document: SchematicDocument;
  highlightCellIds?: readonly string[];
  onPickCell?: (cellId: string | undefined) => void;
}): JSX.Element {
  const result = useMemo(() => layout(doc, LAYOUT), [doc]);
  const highlighted = useMemo(() => new Set(highlightCellIds ?? []), [highlightCellIds]);
  return (
    <svg
      viewBox={`0 0 ${result.width} ${result.height}`}
      role="img"
      aria-label={doc.title}
      data-testid="schematic-svg"
      style={{ width: '100%', background: '#F7F7F4', borderRadius: 4 }}
      onClick={(event) => {
        if (onPickCell === undefined) return;
        // クリックされた図形の `data-cell` を読む。母線やラベルには無いので解除になる
        const target = event.target as { getAttribute?: (name: string) => string | null };
        const cellId = target.getAttribute?.('data-cell') ?? undefined;
        onPickCell(cellId);
      }}
    >
      {result.shapes.map((shape, index) =>
        renderShape(shape, index, shape.cellId !== undefined && highlighted.has(shape.cellId)),
      )}
    </svg>
  );
}

/** 表示灯の塗り色（`schematic-core` と同じ値を使っていることの確認用）。§5.3.4 */
export const SCHEMATIC_LAMP_FILL = LAMP_FILL;
