import {
  expectedFromChart,
  findLabTemplate,
  isLabProblem,
  LAB_DRAW_STEP_MS,
  LAB_MAX_DURATION_MS,
  LAB_MIN_DURATION_MS,
  labTemplatesFor,
  type LabInterval,
  type LabJudgeResult,
  type LabProblem,
} from '@ojt/content';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import {
  msToX,
  niceTickStep,
  tickLabel,
  tickPositions,
  xToMs,
  type ChartGeometry,
} from '../panels/chart-scale.js';
import { wavePoints } from '../panels/TimeChartView.js';
import { bandsOf } from '../result/ChartOverlay.js';
import { pushModalLayer } from '../session/interaction.js';
import { editLab, requestLabRun } from '../session/lab.js';
import {
  applyRowPaint,
  clearExpected,
  clearInputs,
  labRows,
  paintValueAt,
  parseSeconds,
  secondsText,
  segmentsOf,
  setDuration,
  setRowIntervals,
  snapMs,
  toggleJudged,
  type LabRow,
  type LabSignal,
} from './chart-model.js';
import styles from './lab.module.css';

/**
 * タイムチャートの編集窓（2026-10-08）。設計 §6.3
 *
 * 押ボタン4行・ランプ4行を並べ、行の上をドラッグして区間を塗る（点いている所から始めると消す。
 * 0.1秒刻み）。押ボタンの行は押し方（入力）、ランプの行は正解になる。同じことを行ごとの区間の
 * 一覧からキーボードだけでもできる。「動かす」と、ランプの行に実際の動きを太線で重ね、正解との
 * 違いを赤い帯で示す。描いた内容はその場で課題（ストアの `problem`）へ書き戻すので、閉じても残る。
 */

/** 編集窓のチャートの寸法（viewBox 単位）。 */
const GEOM: ChartGeometry = {
  labelWidth: 176,
  plotWidth: 800,
  rowHeight: 46,
  amplitude: 26,
  labelFont: 15,
  tickFont: 13,
  rightPad: 26,
  topPad: 12,
  axisHeight: 30,
  labelStride: 1,
};
/** 押ボタンの段とランプの段のあいだの隙間。 */
const GROUP_GAP = 12;
const VIEW_WIDTH = GEOM.labelWidth + GEOM.plotWidth + GEOM.rightPad;

function rowTop(index: number): number {
  return GEOM.topPad + index * GEOM.rowHeight + (index >= 4 ? GROUP_GAP : 0);
}

function rowBase(index: number): number {
  return rowTop(index) + GEOM.rowHeight - 10;
}

/** 区間の一覧を文字にする（`500-800,3000-5000`。画面の検査が読む）。 */
function intervalsText(intervals: readonly LabInterval[]): string {
  return intervals.map(([from, to]) => `${from}-${to}`).join(',');
}

/** 塗っている最中の状態。 */
interface Drag {
  signal: LabSignal;
  pointerId: number;
  /** 押した位置の0.1秒のます（動かさずに離したら、このますだけを塗る）。 */
  cellMs: number;
  startMs: number;
  currentMs: number;
  value: boolean;
}

/** ポインタの位置 → 時刻[ms]（描く刻みには吸着させない生の値）。 */
function pointerMs(svg: SVGSVGElement, clientX: number, durationMs: number): number {
  const rect = svg.getBoundingClientRect();
  const scale = rect.width > 0 ? rect.width / VIEW_WIDTH : 1;
  return xToMs((clientX - rect.left) / scale, durationMs, GEOM);
}

/** タイムチャートの編集窓。 */
export function LabChartEditor({ onClose }: { onClose: () => void }): JSX.Element | null {
  const problem = useStore((s) =>
    s.problem !== undefined && isLabProblem(s.problem) ? s.problem : undefined,
  );
  const run = useStore((s) => s.labRun);
  const running = useStore((s) => s.labRunning);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement);

  useEffect(() => {
    const target = dialog.current;
    const previous = opener.current;
    const layer = pushModalLayer();
    target?.showModal();
    target?.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus();
    return () => {
      target?.close();
      layer.release();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  if (problem === undefined) return null;
  return (
    <dialog
      ref={dialog}
      className={styles.editor}
      data-testid="lab-editor"
      aria-modal="true"
      aria-labelledby="lab-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div className={styles.editorHead}>
        <h2 id="lab-editor-title">{JA.lab.editorTitle}</h2>
        <button type="button" data-testid="lab-close" onClick={onClose} data-dialog-autofocus>
          {JA.lab.close}
        </button>
      </div>
      <p className={styles.hint}>{JA.lab.editorHint}</p>
      <EditorToolbar problem={problem} />
      <Legend />
      <ChartCanvas problem={problem} run={run} />
      <EditorFooter problem={problem} run={run} running={running} />
      <IntervalLists problem={problem} />
    </dialog>
  );
}

/** 長さ・例題・消す。 */
function EditorToolbar({ problem }: { problem: LabProblem }): JSX.Element {
  const templates = labTemplatesFor(problem.mode);
  return (
    <div className={styles.toolbar}>
      <label className={styles.field}>
        {JA.lab.duration}
        <SecondsInput
          testId="lab-duration"
          label={JA.lab.durationLabel}
          ms={problem.durationMs}
          onCommit={(ms) => {
            if (
              ms % LAB_DRAW_STEP_MS !== 0 ||
              ms < LAB_MIN_DURATION_MS ||
              ms > LAB_MAX_DURATION_MS
            ) {
              useStore.getState().toast(JA.lab.badDuration, 'error');
              return false;
            }
            return editLab((current) => setDuration(current, ms));
          }}
        />
        {JA.lab.seconds}
      </label>
      <select
        data-testid="lab-template"
        aria-label={JA.lab.templatePick}
        value=""
        onChange={(event) => {
          const template = findLabTemplate(problem.mode, event.target.value);
          if (template === undefined) return;
          editLab((current) => ({
            ...current,
            operations: template.operations,
            durationMs: template.durationMs,
            expected: template.expected,
          }));
          useStore.getState().toast(JA.lab.templateLoaded(template.title), 'info');
        }}
      >
        <option value="">{JA.lab.templatePick}</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="lab-clear-inputs"
        onClick={() => {
          editLab(clearInputs);
        }}
      >
        {JA.lab.clearInputs}
      </button>
      <button
        type="button"
        data-testid="lab-clear-expected"
        aria-disabled={problem.expected === undefined}
        onClick={() => {
          if (problem.expected === undefined) {
            useStore.getState().toast(JA.lab.noExpected, 'info');
            return;
          }
          editLab(clearExpected);
        }}
      >
        {JA.lab.clearExpected}
      </button>
    </div>
  );
}

/** 色の見本。 */
function Legend(): JSX.Element {
  return (
    <p className={styles.legend}>
      <span>
        <span className={`${styles.swatch} ${styles.swatchInput}`} aria-hidden="true" />
        {JA.lab.legendInput}
      </span>
      <span>
        <span className={`${styles.swatch} ${styles.swatchExpected}`} aria-hidden="true" />
        {JA.lab.legendExpected}
      </span>
      <span>
        <span className={`${styles.swatch} ${styles.swatchActual}`} aria-hidden="true" />
        {JA.lab.legendActual}
      </span>
      <span>
        <span className={`${styles.swatch} ${styles.swatchBand}`} aria-hidden="true" />
        {JA.lab.legendBand}
      </span>
    </p>
  );
}

/** 8行のチャート（ドラッグで塗る）。 */
function ChartCanvas({
  problem,
  run,
}: {
  problem: LabProblem;
  run: LabJudgeResult | undefined;
}): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const rows = useMemo(() => labRows(problem), [problem]);
  const durationMs = problem.durationMs;
  const height = rowBase(7) + 10 + GEOM.axisHeight;
  const bottom = rowBase(7) + 4;
  const step = niceTickStep(durationMs);
  const actualByName = useMemo(
    () => new Map(run?.charts.actual.signals.map((signal) => [signal.name, signal])),
    [run],
  );
  const x = (ms: number): number => msToX(ms, durationMs, GEOM);

  const begin = (row: LabRow, event: ReactPointerEvent<SVGRectElement>): void => {
    const svg = svgRef.current;
    if (svg === null || event.button !== 0) return;
    event.preventDefault();
    const raw = pointerMs(svg, event.clientX, durationMs);
    const cellMs = Math.min(
      durationMs - LAB_DRAW_STEP_MS,
      Math.floor(raw / LAB_DRAW_STEP_MS) * LAB_DRAW_STEP_MS,
    );
    const startMs = snapMs(raw, durationMs);
    svg.setPointerCapture?.(event.pointerId);
    setDrag({
      signal: row.signal,
      pointerId: event.pointerId,
      cellMs,
      startMs,
      currentMs: startMs,
      value: paintValueAt(row, cellMs),
    });
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const svg = svgRef.current;
    if (svg === null || drag === undefined || event.pointerId !== drag.pointerId) return;
    const currentMs = snapMs(pointerMs(svg, event.clientX, durationMs), durationMs);
    if (currentMs !== drag.currentMs) setDrag({ ...drag, currentMs });
  };

  const end = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (drag === undefined || event.pointerId !== drag.pointerId) return;
    setDrag(undefined);
    svgRef.current?.releasePointerCapture?.(event.pointerId);
    // 動かさずに離したら、押した0.1秒のますだけを塗る（短い押し方を1回で描ける）
    const [from, to] =
      drag.currentMs === drag.startMs
        ? [drag.cellMs, drag.cellMs + LAB_DRAW_STEP_MS]
        : [drag.startMs, drag.currentMs];
    editLab((current) => applyRowPaint(current, drag.signal, from, to, drag.value));
  };

  return (
    <svg
      ref={svgRef}
      className={styles.canvas}
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      role="img"
      aria-label={JA.lab.editorTitle}
      data-testid="lab-editor-chart"
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => {
        setDrag(undefined);
      }}
    >
      {tickPositions(durationMs).map((tick) => (
        <g key={`tick-${tick}`}>
          <line className={styles.tick} x1={x(tick)} y1={GEOM.topPad} x2={x(tick)} y2={bottom} />
          <text
            className={styles.tickLabel}
            x={x(tick)}
            y={height - 8}
            textAnchor="middle"
            style={{ fontSize: GEOM.tickFont }}
          >
            {tickLabel(tick, step)}
          </text>
        </g>
      ))}
      {rows.map((row, index) => {
        const top = rowTop(index);
        const base = rowBase(index);
        const high = base - GEOM.amplitude;
        const isInput = row.kind === 'input';
        const actual = isInput ? undefined : actualByName.get(row.signal);
        const showExpected = isInput || problem.expected !== undefined;
        const preview =
          drag !== undefined && drag.signal === row.signal && drag.currentMs !== drag.startMs
            ? [Math.min(drag.startMs, drag.currentMs), Math.max(drag.startMs, drag.currentMs)]
            : undefined;
        return (
          <g
            key={row.signal}
            data-testid={`lab-row-${row.signal}`}
            data-intervals={intervalsText(row.intervals)}
          >
            {isInput ? null : (
              <rect
                className={styles.rowOutput}
                x={0}
                y={top}
                width={VIEW_WIDTH}
                height={GEOM.rowHeight}
              />
            )}
            <text
              className={!isInput && !row.judged ? styles.rowLabelMuted : styles.rowLabel}
              x={6}
              y={top + GEOM.rowHeight / 2}
              dominantBaseline="middle"
              style={{ fontSize: GEOM.labelFont }}
            >
              {!isInput && !row.judged ? `${row.label}${JA.lab.notJudged}` : row.label}
            </text>
            <line
              className={styles.axis}
              x1={GEOM.labelWidth}
              y1={base + 2}
              x2={GEOM.labelWidth + GEOM.plotWidth}
              y2={base + 2}
            />
            {(run === undefined ? [] : bandsOf(run.mismatches, row.signal, durationMs)).map(
              (band) => (
                <rect
                  key={`band-${band.fromMs}-${band.toMs}`}
                  className={styles.band}
                  data-role="mismatch"
                  x={x(band.fromMs)}
                  y={high - 4}
                  width={Math.max(x(band.toMs) - x(band.fromMs), 2)}
                  height={GEOM.amplitude + 8}
                />
              ),
            )}
            {showExpected
              ? row.intervals.map(([from, to]) => (
                  <rect
                    key={`fill-${from}-${to}`}
                    className={isInput ? styles.inputFill : styles.expectedFill}
                    x={x(from)}
                    y={high}
                    width={Math.max(x(to) - x(from), 1)}
                    height={GEOM.amplitude}
                  />
                ))
              : null}
            {showExpected ? (
              <polyline
                className={isInput ? styles.inputLine : styles.expectedLine}
                points={wavePoints(segmentsOf(row.intervals, durationMs), durationMs, base, GEOM)}
              />
            ) : null}
            {actual === undefined ? null : (
              <polyline
                className={styles.actualLine}
                data-role="actual"
                points={wavePoints(actual.segments, durationMs, base, GEOM)}
              />
            )}
            {preview === undefined ? null : (
              <rect
                className={drag?.value === false ? styles.previewErase : styles.preview}
                x={x(preview[0]!)}
                y={top + 2}
                width={Math.max(x(preview[1]!) - x(preview[0]!), 1)}
                height={GEOM.rowHeight - 4}
              />
            )}
            <rect
              className={styles.rowHit}
              data-testid={`lab-row-hit-${row.signal}`}
              x={GEOM.labelWidth}
              y={top}
              width={GEOM.plotWidth}
              height={GEOM.rowHeight}
              onPointerDown={(event) => {
                begin(row, event);
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** 動かす・取り込む。 */
function EditorFooter({
  problem,
  run,
  running,
}: {
  problem: LabProblem;
  run: LabJudgeResult | undefined;
  running: boolean;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const capturable = run !== undefined && run.charts.actual.signals.length > 0;
  return (
    <div className={styles.footer}>
      <button
        type="button"
        data-testid="lab-run-in-editor"
        aria-disabled={running}
        aria-busy={running}
        onClick={() => {
          requestLabRun(false);
        }}
      >
        {running ? JA.lab.running : JA.lab.run}
      </button>
      <button
        type="button"
        data-testid="lab-capture"
        aria-disabled={!capturable}
        title={capturable ? undefined : JA.lab.captureNeedsRun}
        onClick={() => {
          if (!capturable) {
            useStore.getState().toast(JA.lab.captureNeedsRun, 'info');
            return;
          }
          setConfirming(true);
        }}
      >
        {JA.lab.capture}
      </button>
      <span data-testid="lab-editor-status" role="status">
        {run === undefined ? JA.lab.notRunYet : labRunText(run)}
      </span>
      {confirming && run !== undefined ? (
        <div className={styles.confirm} role="group" aria-label={JA.lab.capture}>
          <span>{problem.expected === undefined ? JA.lab.captureNew : JA.lab.captureReplace}</span>
          <button
            type="button"
            data-testid="lab-capture-confirm"
            onClick={() => {
              const expected = expectedFromChart(run.charts.actual);
              editLab((current) => ({ ...current, expected }));
              setConfirming(false);
              useStore.getState().toast(JA.lab.captured, 'info');
            }}
          >
            {JA.lab.captureConfirm}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
            }}
          >
            {JA.lab.cancel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 最後に動かした結果の1行（実験の欄と編集窓で同じ言い方にする）。 */
export function labRunText(run: LabJudgeResult): string {
  if ('ladderErrors' in run && run.ladderErrors.length > 0) return JA.lab.runLadderErrors;
  if (!run.judged) return JA.lab.runNoExpected;
  if (run.passed) return JA.lab.runPassed;
  const failedChecks = run.staticChecks.filter((check) => !check.ok).length;
  return JA.lab.runDiffers(run.mismatches.length, failedChecks);
}

/** 行ごとの区間の一覧（キーボードだけで描ける）。 */
function IntervalLists({ problem }: { problem: LabProblem }): JSX.Element {
  const rows = labRows(problem);
  const judgedCount = rows.filter((row) => row.kind === 'output' && row.judged).length;
  return (
    <div className={styles.lists}>
      {rows.map((row) => (
        <section
          key={row.signal}
          className={styles.list}
          data-testid={`lab-intervals-${row.signal}`}
          aria-label={row.label}
        >
          <h3>
            <span>{row.label}</span>
            {row.kind === 'output' ? (
              <label className={styles.judgedToggle}>
                <input
                  type="checkbox"
                  data-testid={`lab-judged-${row.signal}`}
                  checked={row.judged}
                  disabled={row.judged && judgedCount === 1}
                  onChange={() => {
                    editLab((current) => toggleJudged(current, row.signal));
                  }}
                />
                {JA.lab.judged}
              </label>
            ) : null}
          </h3>
          {row.kind === 'output' && problem.expected === undefined ? (
            <p className={styles.empty}>{JA.lab.noExpected}</p>
          ) : row.intervals.length === 0 ? (
            <p className={styles.empty}>{JA.lab.noIntervals}</p>
          ) : null}
          {row.intervals.map(([from, to], index) => (
            <div className={styles.interval} key={`${row.signal}-${index}-${from}-${to}`}>
              <SecondsInput
                testId={`lab-interval-${row.signal}-${index}-from`}
                label={JA.lab.intervalFrom(row.label, index + 1)}
                ms={from}
                onCommit={(ms) => replaceInterval(row, index, [ms, to])}
              />
              〜
              <SecondsInput
                testId={`lab-interval-${row.signal}-${index}-to`}
                label={JA.lab.intervalTo(row.label, index + 1)}
                ms={to}
                onCommit={(ms) => replaceInterval(row, index, [from, ms])}
              />
              {JA.lab.seconds}
              <button
                type="button"
                data-testid={`lab-interval-${row.signal}-${index}-delete`}
                aria-label={JA.lab.deleteIntervalLabel(row.label, index + 1)}
                onClick={() => {
                  editLab((current) =>
                    setRowIntervals(
                      current,
                      row.signal,
                      row.intervals.filter((_, at) => at !== index),
                    ),
                  );
                }}
              >
                {JA.lab.deleteInterval}
              </button>
            </div>
          ))}
          <button
            type="button"
            data-testid={`lab-interval-${row.signal}-add`}
            onClick={() => {
              addInterval(problem, row);
            }}
          >
            {JA.lab.addInterval}
          </button>
        </section>
      ))}
    </div>
  );
}

/** 区間を1つ差し替える（始まりと終わりの前後が逆なら直さずに断る）。 */
function replaceInterval(row: LabRow, index: number, next: LabInterval): boolean {
  if (next[0] >= next[1]) {
    useStore.getState().toast(JA.lab.badInterval, 'error');
    return false;
  }
  return editLab((current) =>
    setRowIntervals(
      current,
      row.signal,
      row.intervals.map((interval, at) => (at === index ? next : interval)),
    ),
  );
}

/** 最後の区間の0.5秒後から1秒の区間を足す（空きが無ければ断る）。 */
function addInterval(problem: LabProblem, row: LabRow): void {
  const last = row.intervals.at(-1);
  const from = last === undefined ? 500 : last[1] + 500;
  if (from + LAB_DRAW_STEP_MS > problem.durationMs) {
    useStore.getState().toast(JA.lab.noRoom, 'error');
    return;
  }
  const to = Math.min(from + 1_000, problem.durationMs);
  editLab((current) => setRowIntervals(current, row.signal, [...row.intervals, [from, to]]));
}

/**
 * 秒の入力欄。Enter か欄を離れたときに読み、読めない値・断られた値は元に戻す。
 * 外から値が変わったら（ドラッグで塗った・例題を読んだ）作り直して新しい値を出す。
 */
function SecondsInput({
  testId,
  label,
  ms,
  onCommit,
}: {
  testId: string;
  label: string;
  ms: number;
  onCommit: (ms: number) => boolean;
}): JSX.Element {
  const [text, setText] = useState(secondsText(ms));
  useEffect(() => {
    setText(secondsText(ms));
  }, [ms]);
  const commit = (): void => {
    if (text === secondsText(ms)) return;
    const parsed = parseSeconds(text);
    if (parsed === undefined) {
      useStore.getState().toast(JA.lab.badSeconds, 'error');
      setText(secondsText(ms));
      return;
    }
    if (!onCommit(parsed)) setText(secondsText(ms));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className={styles.seconds}
      data-testid={testId}
      aria-label={label}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
    />
  );
}
