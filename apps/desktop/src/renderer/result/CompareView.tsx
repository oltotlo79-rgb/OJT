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

function figureOf(expected: TimeChart, rows: readonly CompareRow[]): ChartFigure {
  return {
    durationMs: expected.durationMs,
    edges: operationEdgeTimes(expected),
    snaps: edgeTimes(expected),
    markers: [],
    rows: rows.flatMap((row) => [
      { key: `${row.signal}-heading`, label: row.label, heading: true, waves: [] },
      {
        key: `${row.signal}-expected`,
        label: JA.compare.expected,
        waves: [{ key: 'expected', className: styles.expected ?? '', segments: row.expected }],
        bands: row.diffWindows,
      },
      {
        key: `${row.signal}-actual`,
        label: JA.compare.actual,
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
  const figure = useMemo(() => figureOf(expected, rows), [expected, rows]);
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
            <h2 id="compare-title">{JA.compare.title}</h2>
            <p>{problem.title}</p>
          </div>
          <button ref={close} type="button" data-testid="compare-close" onClick={onClose}>
            {JA.compare.close}
          </button>
        </header>
        <div className={styles.body}>
          <p className={styles.legend}>{JA.compare.legend}</p>
          <div className={styles.chart}>
            <EnlargeableChart
              title={JA.compare.title}
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
              {JA.compare.noReference}
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
    judge.mode !== problem.mode
  )
    return null;
  const unavailable = judge.mode === 'plc' && judge.ladderErrors.length > 0;
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
        {JA.compare.title}
      </button>
      {open ? (
        <CompareView
          problem={problem}
          session={session}
          expected={judge.charts.expected}
          actual={judge.charts.actual}
          tolerance={problem.judge.tolerance}
          onClose={close}
        />
      ) : null}
    </>
  );
}
