import {
  layout,
  LAMP_FILL,
  slotRects,
  SYMBOL_METRICS,
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
 * 図形は `Shape`（`line` / `circle` / `rect` / `arc` / `text`）の直和で、`role` から線幅と色を引く。
 * `key` は配列の添字でよい（`layout()` は決定論なので同じ文書からは同じ並びが出る）。
 * `shape.rungId` / `shape.cellId` は §9.2 の連動ハイライトと §11.4 の配線ガイドで使う。
 *
 * **印刷された練習シートに寄せる**ための約束（利用者要求 2026-09-19「回路図のクオリティ」）:
 * - 用紙は必ず白。アプリが暗色テーマでも図の中に白い紙を敷く
 * - 線幅は画面の実px（`vector-effect="non-scaling-stroke"`）。拡大しても線が太らず、
 *   縮めても潰れない。直交する電線は `shape-rendering="crispEdges"` で半端な位置に置かない
 * - 文字は和文の読める書体で、機器の銘板は 1x で 12px 以上。端子番号は等幅で一回り小さく
 * - 図の外（母線の見出し・段番号）まで入るよう viewBox は**図形の外接矩形**から作る
 */

/**
 * 寸法設定（論理単位）。読取専用のヒントも編集エディタもこの1つを共有する
 * （`layout()` と `slotRects()` に同じ設定を渡さないとカーソルが記号からずれる）。
 *
 * 数字は「ヒント欄の紙（約430px）に置いたとき何pxになるか」から決めてある（2026-09-20 の記号見直し）:
 * 銘板 11px 以上・端子番号 9px 以上・接点の幅 25px 以上。`test/schematic-symbols.test.tsx` が
 * 内蔵課題を実際に描いて測る。
 * - `symbolWidth` は `colWidth` の半分。これより小さいと記号が「短い斜線」に見える
 * - `colWidth` は「記号 ＋ 左右の端子番号 ＋ 逃げ」が並ぶ幅
 * - `rowHeight` は「銘板（記号の上 `labelRise`）＋ 端子番号（下 `terminalDrop`）」が
 *   上下の段とぶつからない高さ
 */
export const SCHEMATIC_LAYOUT: LayoutOptions = {
  colWidth: 44,
  rowHeight: 50,
  marginX: 10,
  marginY: 20,
  symbolWidth: 22,
  labelRise: SYMBOL_METRICS.labelRise,
  rungNumbers: true,
  terminalNumbers: true,
};

/** 和文が化けない・字面の揃う書体。Windows と Electron の既定に両方ある順に並べる。 */
const FONT_STACK = '"Noto Sans JP", "Yu Gothic UI", "Meiryo", system-ui, sans-serif';
/** 端子番号は数字が揃う等幅で。 */
const MONO_STACK = '"Consolas", "Roboto Mono", ui-monospace, monospace';

/** 機器の銘板の文字寸法（論理単位）。ヒント欄の幅（約430px）で 11px 以上になる大きさ。 */
const LABEL_FONT_SIZE = 8;
/** 端子番号（一回り小さい等幅）。同じくヒント欄で 9px 以上。 */
const TERMINAL_FONT_SIZE = 6.4;
/** 段番号（左余白）。 */
const RUNG_FONT_SIZE = 6.4;
/** 設定時間（`2.0秒`）。端子番号のあいだに収める添え書きなので一回り小さい。 */
const PRESET_FONT_SIZE = 5.6;

/** 用紙の色と縁（暗色テーマでも図は必ず白地）。 */
const PAPER = '#FFFFFF';
const PAPER_EDGE = '#C8CCD4';
/** 図の本線・器具の色と、添え字（端子番号・設定時間）の色。 */
const INK = '#111418';
const INK_SUB = '#4A525C';

/**
 * 役割ごとの線幅（画面px。`vector-effect="non-scaling-stroke"` なので拡大縮小しても変わらない）と色。
 * 印刷図の階層をそのまま写す: **母線だけが太く**、器具の線と電線は同じ太さ。
 */
const STROKE: Readonly<Record<ShapeRole, { color: string; width: number }>> = {
  bus: { color: '#0B0D10', width: 2.8 },
  // 器具の線は電線と同じ太さ（印刷図では母線だけが太い）
  wire: { color: INK, width: 1.5 },
  symbol: { color: INK, width: 1.5 },
  label: { color: INK, width: 0 },
  preset: { color: INK_SUB, width: 0 },
  junction: { color: INK, width: 0 },
  terminal: { color: INK_SUB, width: 0 },
  rung: { color: '#6B737D', width: 0 },
};

/** 役割ごとの文字寸法と書体。 */
const TEXT_STYLE: Partial<Record<ShapeRole, { size: number; family: string; weight: number }>> = {
  label: { size: LABEL_FONT_SIZE, family: FONT_STACK, weight: 600 },
  preset: { size: PRESET_FONT_SIZE, family: FONT_STACK, weight: 400 },
  terminal: { size: TERMINAL_FONT_SIZE, family: MONO_STACK, weight: 400 },
  rung: { size: RUNG_FONT_SIZE, family: MONO_STACK, weight: 400 },
};

/** 連動ハイライトの色。§9.2 白地の図では琥珀が読めないので濃い橙＋薄い暈し（ハロー）で示す。 */
const HIGHLIGHT_STROKE = '#C2410C';
const HIGHLIGHT_HALO = 'rgba(249, 115, 22, 0.35)';
/** 暈しは元の線幅にこれだけ足す（px）。線そのものは太らせず、まわりを光らせる。 */
const HIGHLIGHT_HALO_ADD = 6;

/** 編集カーソルの枠と薄い塗り（白地の図で目立ち、記号を隠さない濃さ）。§11.4 */
const CURSOR_STROKE = '#1D4ED8';
const CURSOR_FILL = 'rgba(29, 78, 216, 0.10)';
/** 当たり矩形は透明でもクリックを受ける（記号より手前にあるため）。 */
const SLOT_STYLE = { pointerEvents: 'all' } as const;

/** 図の外接矩形にこれだけ余白（紙の白縁）を足す（論理単位）。 */
const VIEW_PAD = 10;

/** 機械的連結（押ボタンの操作子の軸）の破線。IEC 60617 の作法。 */
const DASH_PATTERN = '2.2 1.6';

/** 極座標の角度[度]を SVG の座標に直す（弧の端点計算）。 */
function arcPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** 図形1つの外接矩形（`[x1, y1, x2, y2]`）。文字は字送りから見積もる。 */
function boundsOf(shape: Shape): [number, number, number, number] {
  switch (shape.kind) {
    case 'line':
      return [
        Math.min(shape.x1, shape.x2),
        Math.min(shape.y1, shape.y2),
        Math.max(shape.x1, shape.x2),
        Math.max(shape.y1, shape.y2),
      ];
    case 'circle':
    case 'arc':
      return [shape.cx - shape.r, shape.cy - shape.r, shape.cx + shape.r, shape.cy + shape.r];
    case 'rect':
      return [shape.x, shape.y, shape.x + shape.w, shape.y + shape.h];
    case 'text': {
      const size = TEXT_STYLE[shape.role]?.size ?? LABEL_FONT_SIZE;
      // 全角混じりでも収まるよう1字 0.62em で見積もる（切れるより広いほうがよい）
      const width = shape.text.length * size * 0.62;
      const left =
        shape.anchor === 'middle'
          ? shape.x - width / 2
          : shape.anchor === 'end'
            ? shape.x - width
            : shape.x;
      return [left, shape.y - size / 2, left + width, shape.y + size / 2];
    }
  }
}

/**
 * 図形すべてを含む viewBox。`layout()` は母線の見出しを負のyに、段番号を負のxに置くので、
 * `0 0 width height` のままだとそれらが**切り落とされる**（2026-09-19 の指摘の一因）。
 */
export function viewBoxOf(shapes: readonly Shape[], width: number, height: number): string {
  const first = shapes[0];
  if (first === undefined) return `0 0 ${width} ${height}`;
  let [x1, y1, x2, y2] = boundsOf(first);
  for (const shape of shapes) {
    const b = boundsOf(shape);
    if (b[0] < x1) x1 = b[0];
    if (b[1] < y1) y1 = b[1];
    if (b[2] > x2) x2 = b[2];
    if (b[3] > y2) y2 = b[3];
  }
  // 余白は上下左右そろえる（`layout()` の `marginY` に任せると下だけ間延びする）
  const round = (v: number): number => Math.round(v * 100) / 100;
  return `${round(x1 - VIEW_PAD)} ${round(y1 - VIEW_PAD)} ${round(x2 - x1 + VIEW_PAD * 2)} ${round(y2 - y1 + VIEW_PAD * 2)}`;
}

/** 直交する線・長方形は格子に乗せる（にじまない）。斜めと円は滑らかに。 */
function rendering(shape: Shape): 'crispEdges' | 'geometricPrecision' {
  if (shape.kind === 'rect') return 'crispEdges';
  if (shape.kind === 'line' && (shape.x1 === shape.x2 || shape.y1 === shape.y2)) {
    return 'crispEdges';
  }
  return 'geometricPrecision';
}

/** 図形1つの SVG 属性（塗り・線・にじみ止め）。 */
function paint(
  shape: Shape,
  color: string,
  width: number,
): Record<string, string | number | undefined> {
  return {
    stroke: color,
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
    shapeRendering: rendering(shape),
  };
}

/**
 * 図形プリミティブ1つを SVG 要素にする。
 * `data-cell` は「どの要素の図形か」を DOM に残すもので、クリックの受け口にもテストの
 * 手がかりにもなる（`Shape.cellId`。Plan 1B）。
 */
function drawShape(
  shape: Shape,
  key: string,
  color: string,
  width: number,
  common: Record<string, string>,
): JSX.Element | null {
  const style = paint(shape, color, width);
  switch (shape.kind) {
    case 'line':
      return (
        <line
          key={key}
          {...common}
          {...style}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          {...(shape.dashed === true ? { strokeDasharray: DASH_PATTERN } : {})}
        />
      );
    case 'circle':
      return (
        <circle
          key={key}
          {...common}
          {...style}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill={shape.fill ?? (shape.role === 'junction' ? color : 'none')}
          strokeWidth={shape.role === 'junction' ? 0 : width}
        />
      );
    case 'rect':
      return (
        <rect
          key={key}
          {...common}
          {...style}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          fill={shape.fill ?? 'none'}
        />
      );
    case 'arc': {
      const [x1, y1] = arcPoint(shape.cx, shape.cy, shape.r, shape.startDeg);
      const [x2, y2] = arcPoint(shape.cx, shape.cy, shape.r, shape.endDeg);
      const large = Math.abs(shape.endDeg - shape.startDeg) > 180 ? 1 : 0;
      return (
        <path
          key={key}
          {...common}
          {...style}
          d={`M ${x1} ${y1} A ${shape.r} ${shape.r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
        />
      );
    }
    case 'text': {
      const text = TEXT_STYLE[shape.role] ?? {
        size: LABEL_FONT_SIZE,
        family: FONT_STACK,
        weight: 400,
      };
      return (
        <text
          key={key}
          {...common}
          x={shape.x}
          y={shape.y}
          fill={color}
          fontFamily={text.family}
          fontSize={text.size}
          fontWeight={text.weight}
          textAnchor={shape.anchor}
          dominantBaseline="middle"
          /* 文字は線ではないので暈しも太らせもしない */
          stroke="none"
        >
          {shape.text}
        </text>
      );
    }
  }
}

/**
 * 図形1つ（ハイライト中なら暈しを1枚下に敷いてから）。
 * 色を変えるだけだと白地では見落とすので、**まわりを光らせて**目立たせる。§9.2
 */
function renderShape(shape: Shape, index: number, highlighted: boolean): JSX.Element[] {
  const base = STROKE[shape.role];
  const color = highlighted ? HIGHLIGHT_STROKE : base.color;
  const common = {
    ...(shape.cellId === undefined ? {} : { 'data-cell': shape.cellId }),
    ...(highlighted ? { 'data-highlight': 'true' } : {}),
  };
  const out: JSX.Element[] = [];
  if (highlighted && shape.kind !== 'text') {
    const halo = drawShape(
      shape,
      `halo-${index}`,
      HIGHLIGHT_HALO,
      base.width + HIGHLIGHT_HALO_ADD,
      { ...common, 'data-halo': 'true' },
    );
    if (halo !== null) out.push(halo);
  }
  const main = drawShape(shape, `s-${index}`, color, base.width, common);
  if (main !== null) out.push(main);
  return out;
}

/**
 * 回路図の SVG。§11.2 / §11.4
 * `highlightCellIds` と `onPickCell` はモードC2の連動ハイライト（§9.2）とモードBの配線ガイド
 * （§11.4）で使う。`cursor` / `onPickSlot` を渡すと**編集モード**になり、段 × 桁の当たり矩形
 * （`slotRects()`）を図の上に敷く。どれも省略でき、省略すれば従来どおりの読取専用レンダラとして
 * 動く（モードBの回路図ヒント・C2の提示回路図・結果画面はこの形で呼んでいる）。
 */
export function SchematicSvg({
  document: doc,
  highlightCellIds,
  onPickCell,
  cursor,
  onPickSlot,
  testId = 'schematic-svg',
}: {
  document: SchematicDocument;
  highlightCellIds?: readonly string[];
  onPickCell?: (cellId: string | undefined) => void;
  /** 編集中のカーソル（段ID＋桁）。渡すと当たり矩形を敷く。§11.4 */
  cursor?: { rungId: string; index: number };
  /**
   * 桁をクリックしたときに呼ぶ。`cursor` と対で渡す。§11.4
   * `cellId` はその桁にある要素のID（空き桁なら `undefined`）。**編集モードでは矩形が
   * 記号より手前に来るので、記号のクリックもここに来る**。だから「要素を選んだ」のか
   * 「要素を置く」のかは呼び出し側（`SchematicEditor`）が決める（B2）。
   */
  onPickSlot?: (rungId: string, index: number, cellId?: string) => void;
  /** 同じ図を2枚出す画面（拡大表示）で取り違えないための識別子。 */
  testId?: string;
}): JSX.Element {
  const result = useMemo(() => layout(doc, SCHEMATIC_LAYOUT), [doc]);
  const view = useMemo(
    () => viewBoxOf(result.shapes, result.width, result.height),
    [result.shapes, result.width, result.height],
  );
  const highlighted = useMemo(() => new Set(highlightCellIds ?? []), [highlightCellIds]);
  const slots = useMemo(
    () => (onPickSlot === undefined ? [] : slotRects(doc, SCHEMATIC_LAYOUT)),
    [doc, onPickSlot],
  );
  const [vx, vy, vw, vh] = view.split(' ').map(Number) as [number, number, number, number];
  return (
    <svg
      viewBox={view}
      role="img"
      aria-label={doc.title}
      data-testid={testId}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: 'auto', display: 'block' }}
      onClick={(event) => {
        if (onPickCell === undefined) return;
        // クリックされた図形の `data-cell` を読む。用紙や母線には無いので解除になる
        const target = event.target as { getAttribute?: (name: string) => string | null };
        const cellId = target.getAttribute?.('data-cell') ?? undefined;
        onPickCell(cellId);
      }}
    >
      {/* 用紙。暗色テーマでも図は白地で、縁だけ薄く付ける（印刷されたシートの見え方） */}
      <rect
        data-testid="schematic-paper"
        x={vx}
        y={vy}
        width={vw}
        height={vh}
        fill={PAPER}
        stroke={PAPER_EDGE}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        shapeRendering="crispEdges"
      />
      {result.shapes.flatMap((shape, index) =>
        renderShape(shape, index, shape.cellId !== undefined && highlighted.has(shape.cellId)),
      )}
      {/*
        編集の当たり矩形。**図形より後ろに描く＝画面では記号より手前に来る**。
        本物のブラウザ（Playwright の E2E）は最前面の要素をクリック先に選ぶので、
        記号を押したつもりのクリックも**必ずこの矩形に当たる**。`onPickCell` は
        もう呼ばれない（矩形は `data-cell` を持たない）。
        だから矩形は「どの桁か」に加えて **その桁にある要素ID** も渡し、
        「要素を光らせる」のか「要素を置き換える」のかは `SchematicEditor` が決める（B2）。
        JSDOM/happy-dom の `fireEvent.click(symbol)` は記号に直接イベントを投げるので
        この重なりを再現しない。だから**単体テストは矩形を直接クリックし**、
        「記号を押したら矩形が受ける」ことは E2E（受入基準②）で確かめる。
      */}
      {slots.map((slot) => {
        const isCursor = cursor?.rungId === slot.rungId && cursor.index === slot.index;
        return (
          <rect
            key={`${slot.rungId}#${slot.index}`}
            data-slot={`${slot.rungId}#${slot.index}`}
            {...(isCursor ? { 'data-cursor': 'true' } : {})}
            x={slot.x}
            y={slot.y}
            width={slot.w}
            height={slot.h}
            fill={isCursor ? CURSOR_FILL : 'transparent'}
            stroke={isCursor ? CURSOR_STROKE : 'none'}
            strokeWidth={isCursor ? 1.2 : 0}
            vectorEffect="non-scaling-stroke"
            /* `fill="transparent"` でも当たり判定は残るが、意図を明示しておく */
            style={SLOT_STYLE}
            onClick={(event) => {
              event.stopPropagation();
              onPickSlot?.(slot.rungId, slot.index, slot.cellId);
            }}
          />
        );
      })}
    </svg>
  );
}

/** 表示灯の塗り色（`schematic-core` と同じ値を使っていることの確認用）。§5.3.4 */
export const SCHEMATIC_LAMP_FILL = LAMP_FILL;
