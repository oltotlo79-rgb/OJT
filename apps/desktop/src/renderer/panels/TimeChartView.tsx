import type { TimeChartMarker, TimeChartSegment } from '@ojt/content';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { trapFocus } from '../app/focus-trap.js';
import { chartEnlargeLabel, chartOpenerLabel, JA } from '../i18n/ja.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import {
  chartHeight,
  chartWidth,
  LARGE_GEOMETRY,
  msToX,
  nearestSnap,
  niceTickStep,
  SMALL_GEOMETRY,
  SNAP_TOLERANCE_PX,
  tickLabel,
  tickPositions,
  timeReadout,
  xToMs,
  type ChartGeometry,
} from './chart-scale.js';
import panels from './panels.module.css';
import styles from './timechart.module.css';

/**
 * タイムチャートの描画本体（Task CHART-UX）。設計仕様 §7.7 / §8.1 / §8.3。
 *
 * ここが持つのは「1枚のチャートをどう描くか」だけで、何を描くか（仕様／ライブ記録／
 * 期待と実際）は呼び手が `ChartFigure` に組み立てて渡す。おかげで
 * `TimeChartPanel` と `ChartOverlay` は同じ補助線・同じ拡大表示を素通しで使える。
 *
 * 見やすさのための3種類の縦線（§7.7）:
 * - 目盛線（`niceTickStep()` で選んだきりの良い刻み。`1.0 s` のラベル付き）
 * - 操作の変化点の破線（押ボタンの押す・離すとタイマ設定の印）
 * - ポインタに追従するカーソル線（近くの変化点に吸い付いて時刻を出す）
 */

/** 強調する区間（結果画面の差分）。 */
export interface ChartBand {
  fromMs: number;
  toMs: number;
}

/** 1行に重ねて描く波形。 */
export interface ChartWave {
  key: string;
  /** 線の見た目を決める CSS クラス（呼び手のモジュールのもの）。 */
  className: string;
  segments: readonly TimeChartSegment[];
}

/** チャートの1行。`waves` が空なら見出し行（期待／実際の区切り）。 */
export interface ChartRow {
  key: string;
  label: string;
  heading?: boolean;
  waves: readonly ChartWave[];
  bands?: readonly ChartBand[];
}

/** チャート1枚ぶんの描画材料。 */
export interface ChartFigure {
  durationMs: number;
  rows: readonly ChartRow[];
  /** 縦の破線を立てる時刻[ms]。 */
  edges: readonly number[];
  /** カーソルが吸い付く候補[ms]。 */
  snaps: readonly number[];
  markers: readonly TimeChartMarker[];
}

/** 区間列を SVG の `points` にする（寸法は呼び手が決める）。§7.7 */
export function wavePoints(
  segments: readonly TimeChartSegment[],
  durationMs: number,
  baseY: number,
  geom: ChartGeometry,
): string {
  if (durationMs <= 0) return '';
  const y = (value: boolean): number => (value ? baseY - geom.amplitude : baseY);
  const out: string[] = [];
  for (const segment of segments) {
    out.push(
      `${msToX(segment.fromMs, durationMs, geom).toFixed(1)},${y(segment.value).toFixed(1)}`,
    );
    out.push(`${msToX(segment.toMs, durationMs, geom).toFixed(1)},${y(segment.value).toFixed(1)}`);
  }
  return out.join(' ');
}

/** 行の波形の基準線（論理0の高さ）。 */
function rowBaseY(index: number, geom: ChartGeometry): number {
  return geom.topPad + (index + 1) * geom.rowHeight;
}

/**
 * ポインタに追従するカーソル線。§7.7
 *
 * **チャート本体とは別のコンポーネントにしてある**。カーソルの時刻を親が持つと
 * マウスを動かすたびに8行ぶんの波形まで作り直すことになるので、状態はここだけに閉じる
 * （`ChartCanvas` は再描画されない）。
 */
function ChartCursor({
  hostRef,
  figure,
  geom,
  topY,
  bottomY,
}: {
  hostRef: RefObject<SVGSVGElement | null>;
  figure: ChartFigure;
  geom: ChartGeometry;
  topY: number;
  bottomY: number;
}): JSX.Element | null {
  const [tMs, setTMs] = useState<number | null>(null);
  const [snapped, setSnapped] = useState(false);
  // `figure` は生ライブ記録だとスナップショットのたびに新しいオブジェクトになる。エフェクトの
  // 依存に入れると listener を毎回張り直すことになるので、最新値は ref に逃がして依存からは外す
  // （`hostRef` と `geom` は安定しているので listener は初回だけ張ればよい）。
  const figureRef = useRef(figure);
  useEffect(() => {
    figureRef.current = figure;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const viewWidth = chartWidth(geom);
    const onMove = (event: { clientX: number }): void => {
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0) return;
      const scale = rect.width / viewWidth;
      const xView = (event.clientX - rect.left) / scale;
      if (xView < geom.labelWidth - 4 || xView > geom.labelWidth + geom.plotWidth + 4) {
        setTMs(null);
        setSnapped(false);
        return;
      }
      const current = figureRef.current;
      const raw = xToMs(xView, current.durationMs, geom);
      // 吸い付きの許容幅は「画面上の6px」。拡大すると時間換算では狭くなる（＝精密になる）。
      // 区間が短い（＝目盛の刻みが細かい）チャートでは画面上6pxが目盛の刻みの数分の1を超えて
      // しまい、隣の目盛へ黙って飛ぶことがあるので、刻みの1/4も上限にして狭いほうを使う。§7.7
      const pxBasedToleranceMs =
        (SNAP_TOLERANCE_PX / Math.max(scale * geom.plotWidth, 1)) * current.durationMs;
      const tickStep = niceTickStep(current.durationMs);
      const toleranceMs = Math.min(pxBasedToleranceMs, tickStep / 4);
      const snap = nearestSnap(raw, current.snaps, toleranceMs);
      setTMs(snap ?? raw);
      setSnapped(snap !== undefined);
    };
    const onLeave = (): void => {
      setTMs(null);
      setSnapped(false);
    };
    /*
     * ポインタ系だけを見る（指摘 UI-10）。以前は `mousemove`／`mouseleave` も一緒に張って
     * いたので、マウスを1回動かすたびに `getBoundingClientRect()`（強制レイアウト）を含む
     * この計算が2回走っていた。ブラウザはポインタ操作に対して `pointermove` を必ず先に出し、
     * マウス・ペン・指のどれでも同じように届く（Electron も同じ）。
     */
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointercancel', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointercancel', onLeave);
    };
  }, [hostRef, geom]);

  if (tMs === null) return null;
  const x = msToX(tMs, figure.durationMs, geom);
  const text = timeReadout(tMs);
  const chipWidth = text.length * geom.tickFont * 0.62 + 8;
  const chipHeight = geom.tickFont * 1.7;
  const flip = x + chipWidth + 4 > geom.labelWidth + geom.plotWidth;
  const chipX = flip ? x - chipWidth - 3 : x + 3;
  return (
    <g data-guide="cursor">
      <line className={styles.cursorLine} x1={x} y1={topY} x2={x} y2={bottomY} />
      <rect
        className={snapped ? styles.cursorChipSnapped : styles.cursorChip}
        data-snapped={snapped ? 'true' : 'false'}
        x={chipX}
        y={topY}
        width={chipWidth}
        height={chipHeight}
        rx={3}
      />
      <text
        className={snapped ? styles.cursorTextSnapped : styles.cursorText}
        x={chipX + 4}
        y={topY + chipHeight * 0.72}
        style={{ fontSize: geom.tickFont }}
      >
        {text}
      </text>
    </g>
  );
}

/** チャート1枚のSVG（補助線つき）。 */
export function ChartCanvas({
  figure,
  geom,
  title,
  testId,
  className,
}: {
  figure: ChartFigure;
  geom: ChartGeometry;
  title: string;
  testId?: string | undefined;
  className?: string | undefined;
}): JSX.Element {
  const hostRef = useRef<SVGSVGElement | null>(null);
  const width = chartWidth(geom);
  const height = chartHeight(figure.rows.length, geom);
  const topY = geom.topPad;
  const bottomY = geom.topPad + figure.rows.length * geom.rowHeight + 4;
  const step = niceTickStep(figure.durationMs);
  const ticks = tickPositions(figure.durationMs);
  return (
    <svg
      ref={hostRef}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      {/* ① 目盛線（薄いグリッド）と秒のラベル */}
      {ticks.map((tick, index) => {
        const x = msToX(tick, figure.durationMs, geom);
        // ラベルは間引く（小さいチャートで数字が潰れないように）。線は全部立てる
        const labelled = index % Math.max(1, geom.labelStride) === 0;
        return (
          <g key={`tick-${tick}`}>
            <line
              className={styles.tickLine}
              data-guide="tick"
              x1={x}
              y1={topY}
              x2={x}
              y2={bottomY}
            />
            {labelled ? (
              <text
                className={styles.tickLabel}
                x={x}
                y={height - 4}
                textAnchor="middle"
                style={{ fontSize: geom.tickFont }}
              >
                {tickLabel(tick, step)}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* ② 操作の変化点（押す・離す・タイマ設定）の破線。
          小さいチャートは幅が狭く、破線が多い課題（b-007 など）だと読めなくなるので、
          `geom.maxEdgeLines` を超えるときは間引かずに丸ごと省く（拡大表示は常に全部出す）。§7.7 */}
      {(geom.maxEdgeLines !== undefined && figure.edges.length > geom.maxEdgeLines
        ? []
        : figure.edges
      ).map((edge) => {
        const x = msToX(edge, figure.durationMs, geom);
        return (
          <line
            key={`edge-${edge}`}
            className={styles.edgeLine}
            data-guide="edge"
            x1={x}
            y1={topY}
            x2={x}
            y2={bottomY}
          />
        );
      })}

      {/* ③ 信号の行（見出し行・波形・差分の強調） */}
      {figure.rows.map((row, index) => {
        const baseY = rowBaseY(index, geom);
        if (row.heading === true) {
          return (
            <g key={row.key}>
              <text
                className={styles.groupLabel}
                data-role="row-label"
                x={0}
                y={baseY}
                dominantBaseline="middle"
                style={{ fontSize: geom.labelFont }}
              >
                {row.label}
              </text>
              <line
                className={styles.groupRule}
                x1={0}
                y1={baseY + geom.rowHeight * 0.4}
                x2={width}
                y2={baseY + geom.rowHeight * 0.4}
              />
            </g>
          );
        }
        return (
          <g key={row.key}>
            {(row.bands ?? []).map((band) => (
              <rect
                key={`band-${band.fromMs}-${band.toMs}`}
                className={styles.mismatchBand}
                data-role="mismatch"
                x={msToX(band.fromMs, figure.durationMs, geom)}
                y={baseY - geom.amplitude - 2}
                width={Math.max(
                  msToX(band.toMs, figure.durationMs, geom) -
                    msToX(band.fromMs, figure.durationMs, geom),
                  2,
                )}
                height={geom.amplitude + 6}
              />
            ))}
            <text
              className={panels.chartRowLabel}
              data-role="row-label"
              x={0}
              y={baseY}
              dominantBaseline="middle"
              style={{ fontSize: geom.labelFont }}
            >
              {row.label}
            </text>
            <line
              className={panels.chartAxis}
              x1={geom.labelWidth}
              y1={baseY + 2}
              x2={geom.labelWidth + geom.plotWidth}
              y2={baseY + 2}
            />
            {row.waves.map((wave) => (
              <polyline
                key={wave.key}
                className={wave.className}
                points={wavePoints(wave.segments, figure.durationMs, baseY, geom)}
              />
            ))}
          </g>
        );
      })}

      {/* ④ 印（タイマ設定秒など）のラベル。線は②の破線と同じ位置なので重ねない */}
      {figure.markers.map((marker) => (
        <text
          key={`marker-${marker.label}-${marker.tMs}`}
          className={styles.markerLabel}
          x={msToX(marker.tMs, figure.durationMs, geom) + 2}
          y={topY + geom.tickFont}
          style={{ fontSize: geom.tickFont }}
        >
          {marker.label}
        </text>
      ))}

      {/* ⑤ カーソル線（この子だけが再描画される） */}
      <ChartCursor hostRef={hostRef} figure={figure} geom={geom} topY={topY} bottomY={bottomY} />
    </svg>
  );
}

/**
 * 開いているモーダルの本文スクロール止めの重なり数。§8.1
 * モーダルが2枚重なったとき、内側が先に閉じても外側がまだ `overflow: hidden` を要る。
 * 個々のモーダルが「自分が開く前の値」を覚えて戻す方式だと、2枚目が先に片付くと
 * 1枚目の分もろとも戻ってしまうので、開いている枚数で持って0枚になったときだけ戻す。
 */
let overflowLockCount = 0;

/**
 * 拡大表示のモーダル。§8.1
 * ポータルで `document.body` に出すので、右パネルの `overflow` に切り取られない。
 * 開いているあいだは `pushModalLayer()` で盤のショートカット（Esc／Delete／視点の数字キー）を
 * 止め、本文のスクロールも止める。
 *
 * モーダルが2枚重なることがある（例: 結果画面のチャートを拡大したまま別のチャートも拡大）。
 * Esc は一番上の1枚だけを閉じたいので、自分の重なり順（`depth`）が最上段と一致するときだけ
 * 反応する（`pushModalLayer()` が返す `depth` と `topModalLayer()` を比べる）。
 */
function ChartModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const { depth, release } = pushModalLayer();
    overflowLockCount += 1;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (depth !== topModalLayer()) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') trapFocus(panelRef.current, event);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      overflowLockCount = Math.max(0, overflowLockCount - 1);
      if (overflowLockCount === 0) document.body.style.overflow = '';
      release();
    };
  }, [onClose]);

  return createPortal(
    <div
      className={styles.backdrop}
      data-testid="chart-backdrop"
      role="presentation"
      onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.modal}
        data-testid="chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeButton}
            aria-label={JA.timeChart.close}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * クリック（または Enter／Space）で拡大できるチャート。§8.1
 * 小さい図と拡大した図で別の材料を渡せる（結果画面は重ね表示 → 期待・実際の積み上げ）。
 */
export function EnlargeableChart({
  title,
  figure,
  largeFigure,
  largeGeom = LARGE_GEOMETRY,
  testId,
  smallClassName,
  legend,
}: {
  title: string;
  figure: ChartFigure;
  largeFigure?: ChartFigure | undefined;
  largeGeom?: ChartGeometry | undefined;
  testId?: string | undefined;
  smallClassName?: string | undefined;
  /**
   * 色見本の凡例（UXレビュー #7）。小さい図の上と、拡大したモーダルの両方に同じものを出す
   * （`ChartOverlay.tsx` の模範／訓練者／差分の3件など）。無ければ何も出さない。
   */
  legend?: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus();
  }, []);
  const show = useCallback(() => {
    setOpen(true);
  }, []);
  return (
    <div className={styles.frame}>
      {legend === undefined ? null : legend}
      <button
        type="button"
        className={styles.enlargeButton}
        data-testid="chart-enlarge-button"
        aria-label={chartEnlargeLabel(title)}
        onClick={show}
      >
        <span aria-hidden="true">⤢ </span>
        {JA.timeChart.enlarge}
      </button>
      <div
        ref={openerRef}
        className={styles.opener}
        role="button"
        tabIndex={0}
        aria-label={chartOpenerLabel(title)}
        onClick={show}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          show();
        }}
      >
        <ChartCanvas
          figure={figure}
          geom={SMALL_GEOMETRY}
          title={title}
          testId={testId}
          className={smallClassName}
        />
      </div>
      {open ? (
        <ChartModal title={title} onClose={close}>
          {legend === undefined ? null : legend}
          <ChartCanvas
            figure={largeFigure ?? figure}
            geom={largeGeom}
            title={title}
            testId={testId === undefined ? undefined : `${testId}-large`}
            className={styles.modalChart}
          />
        </ChartModal>
      ) : null}
    </div>
  );
}
