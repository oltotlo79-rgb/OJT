import { JIPM_BOARD, type BoardSession } from '@ojt/board-model';
import type { Tolerance } from '@ojt/circuit-sim';
import { wiringSuspects, type SupportedProblem, type TimeChart } from '@ojt/content';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { trapFocus } from '../app/focus-trap.js';
import { useStore } from '../app/store.js';
import { JA, suspectMoreText } from '../i18n/ja.js';
import { edgeTimes, LARGE_STACKED_GEOMETRY, operationEdgeTimes } from '../panels/chart-scale.js';
import { EnlargeableChart, type ChartFigure } from '../panels/TimeChartView.js';
import { SchematicView } from '../schematic/SchematicView.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import { compareCharts, mayShowReference, type CompareRow } from './compare.js';
import styles from './compare.module.css';

const COMPARE_GEOMETRY = {
  ...LARGE_STACKED_GEOMETRY,
  labelWidth: 220,
  plotWidth: 720,
  rowHeight: 32,
  amplitude: 14,
  labelFont: 16,
};

/**
 * 見くらべる窓の文言。回路実験・PLC実験は模範ではなく描いた正解と比べるので、
 * その言い方にする（2026-10-08）。
 */
function compareTexts(problem: SupportedProblem): {
  title: string;
  expected: string;
  actual: string;
  legend: string;
  noReference: string;
} {
  if (problem.mode === 'assemble-lab' || problem.mode === 'plc-lab') {
    return {
      title: JA.lab.compareTitle,
      expected: JA.lab.compareExpected,
      actual: JA.lab.compareActual,
      legend: JA.lab.compareLegend,
      noReference: JA.lab.compareNoReference,
    };
  }
  return {
    title: JA.compare.title,
    expected: JA.compare.expected,
    actual: JA.compare.actual,
    legend: JA.compare.legend,
    noReference: JA.compare.noReference,
  };
}

function figureOf(
  expected: TimeChart,
  rows: readonly CompareRow[],
  texts: { expected: string; actual: string },
): ChartFigure {
  return {
    durationMs: expected.durationMs,
    edges: operationEdgeTimes(expected),
    snaps: edgeTimes(expected),
    markers: [],
    rows: rows.flatMap((row) => [
      { key: `${row.signal}-heading`, label: row.label, heading: true, waves: [] },
      {
        key: `${row.signal}-expected`,
        label: texts.expected,
        waves: [{ key: 'expected', className: styles.expected ?? '', segments: row.expected }],
        bands: row.diffWindows,
      },
      {
        key: `${row.signal}-actual`,
        label: texts.actual,
        waves: [{ key: 'actual', className: styles.actual ?? '', segments: row.actual }],
        bands: row.diffWindows,
      },
    ]),
  };
}

export function CompareView({
  problem,
  session,
  expected,
  actual,
  tolerance,
  onClose,
}: {
  problem: SupportedProblem;
  session: BoardSession;
  expected: TimeChart;
  actual: TimeChart;
  tolerance: Tolerance;
  onClose: () => void;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const rows = useMemo(
    () => compareCharts(expected, actual, tolerance),
    [expected, actual, tolerance],
  );
  const texts = useMemo(() => compareTexts(problem), [problem]);
  const figure = useMemo(() => figureOf(expected, rows, texts), [expected, rows, texts]);
  const allowed = mayShowReference(problem);
  const report = useMemo(
    () =>
      allowed && (problem.mode === 'assemble' || problem.mode === 'inspect-repair')
        ? wiringSuspects(problem, JIPM_BOARD, session)
        : undefined,
    [allowed, problem, session],
  );
  useEffect(() => {
    const previous = document.activeElement;
    const layer = pushModalLayer();
    close.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (topModalLayer() !== layer.depth) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') trapFocus(panel.current, event);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      layer.release();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose]);
  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-title"
        data-testid="compare-dialog"
      >
        <header className={styles.header}>
          <div>
            <h2 id="compare-title">{texts.title}</h2>
            <p>{problem.title}</p>
          </div>
          <button ref={close} type="button" data-testid="compare-close" onClick={onClose}>
            {JA.compare.close}
          </button>
        </header>
        <div className={styles.body}>
          <p className={styles.legend}>{texts.legend}</p>
          <div className={styles.chart}>
            <EnlargeableChart
              title={texts.title}
              figure={figure}
              smallGeom={COMPARE_GEOMETRY}
              largeGeom={COMPARE_GEOMETRY}
              testId="compare-chart"
            />
          </div>
          <section className={styles.differences} data-testid="compare-differences">
            <h3>{JA.compare.differences}</h3>
            <p>{JA.compare.tolerance(tolerance.edgeMs, tolerance.ratio)}</p>
            {rows.every((row) => row.differences.length === 0) ? (
              <p>{JA.compare.matched}</p>
            ) : (
              <ul>
                {rows.flatMap((row) =>
                  row.differences.map((m, index) => (
                    <li key={`${row.signal}-${index}`}>
                      <strong>
                        ▲ {JA.replay.seconds(m.tMs)} · {row.label}
                      </strong>
                      <span>{JA.mismatchReason[m.reason]}</span>
                      {m.actualTMs === undefined ? null : (
                        <span>{JA.compare.actualTime(m.actualTMs)}</span>
                      )}
                    </li>
                  )),
                )}
              </ul>
            )}
          </section>
          {allowed &&
          report !== undefined &&
          (problem.mode === 'assemble' || problem.mode === 'inspect-repair') ? (
            <details className={styles.reference} data-testid="compare-reference">
              <summary>{JA.compare.connections}</summary>
              <div className={styles.referenceGrid}>
                <section>
                  <h3>{JA.compare.schematic}</h3>
                  <SchematicView document={problem.schematic} title={JA.compare.schematic} />
                </section>
                <section>
                  <h3>{JA.compare.wiring}</h3>
                  <p>{JA.result.suspectNote}</p>
                  {report.total === 0 ? (
                    <p>{JA.result.noSuspect}</p>
                  ) : (
                    <ul>
                      {report.suspects.map((suspect, index) => (
                        <li key={index}>
                          <strong>
                            {suspect.kind === 'missing'
                              ? JA.result.suspectMissing
                              : JA.result.suspectExtra}
                          </strong>{' '}
                          {suspect.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {report.omitted > 0 ? <p>{suspectMoreText(report.omitted)}</p> : null}
                </section>
              </div>
            </details>
          ) : (
            <p data-testid="compare-reference-hidden" className={styles.note}>
              {texts.noReference}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CompareEntry(): JSX.Element | null {
  const problem = useStore((s) => s.problem);
  const session = useStore((s) => s.session);
  const judge = useStore((s) => s.judge);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  if (
    problem === undefined ||
    session === undefined ||
    judge === undefined ||
    problem.mode === 'inspect-parts' ||
    judge.mode === 'inspect-parts' ||
    judge.mode !== problem.mode ||
    // 実験で正解を描いていない（動かしただけの）結果には、見くらべる相手が無い
    judge.charts.expected === undefined
  )
    return null;
  const expected = judge.charts.expected;
  const unavailable =
    (judge.mode === 'plc' || judge.mode === 'plc-lab') && judge.ladderErrors.length > 0;
  return (
    <>
      <button
        type="button"
        data-testid="compare-open"
        aria-disabled={unavailable}
        title={unavailable ? JA.replay.cannotReplay : undefined}
        onClick={() => {
          if (unavailable) useStore.getState().toast(JA.replay.cannotReplay, 'info');
          else setOpen(true);
        }}
      >
        {compareTexts(problem).title}
      </button>
      {open ? (
        <CompareView
          problem={problem}
          session={session}
          expected={expected}
          actual={judge.charts.actual}
          tolerance={problem.judge.tolerance}
          onClose={close}
        />
      ) : null}
    </>
  );
}
