import { isLabProblem, type LabProblem } from '@ojt/content';
import { useMemo, useState, type JSX } from 'react';
import { ConfirmDialog } from '../app/ConfirmDialog.js';
import navigation from '../app/problem-navigation.module.css';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { CollapsiblePanel } from '../panels/CollapsiblePanel.js';
import panels from '../panels/panels.module.css';
import { EnlargeableChart } from '../panels/TimeChartView.js';
import result from '../result/result.module.css';
import { requestLabRun, restartLabBoard } from '../session/lab.js';
import { startReplay } from '../session/replay.js';
import { chartCounts } from './chart-model.js';
import { labFigure } from './figure.js';
import { LabChartEditor, labRunText } from './LabChartEditor.js';
import styles from './lab.module.css';

/**
 * 右パネルの「タイムチャート実験」（2026-10-08）。設計 §6.2
 *
 * 描いた押し方と正解・最後に動かした結果を小さいチャートで見せ、「大きく開いて編集」「動かす」
 * 「判定」「盤で動きを見る」「配線をやり直す」を並べる。回路実験とPLC実験の画面で同じ部品を使う。
 */
export function LabChartPanel(): JSX.Element | null {
  const problem = useStore((s) =>
    s.problem !== undefined && isLabProblem(s.problem) ? s.problem : undefined,
  );
  const run = useStore((s) => s.labRun);
  const running = useStore((s) => s.labRunning);
  const judging = useStore((s) => s.judging);
  const [editorOpen, setEditorOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const figure = useMemo(
    () =>
      problem === undefined
        ? undefined
        : labFigure(
            problem,
            run,
            {
              input: panels.chartLine ?? '',
              expected: result.overlayExpected ?? '',
              actual: result.overlayActual ?? '',
            },
            JA.lab.notJudged,
          ),
    [problem, run],
  );
  if (problem === undefined || figure === undefined) return null;
  const counts = chartCounts(problem);
  const replayable = run !== undefined && !('ladderErrors' in run && run.ladderErrors.length > 0);
  const busy = running || judging;
  return (
    <>
      <CollapsiblePanel
        title={JA.lab.panelTitle}
        testId="lab-panel"
        open
        summary={JA.lab.countsText(counts.inputs, counts.expectedRows)}
      >
        <p
          className={`${styles.status} ${
            run === undefined || !run.judged
              ? ''
              : run.passed
                ? styles.statusPassed
                : styles.statusFailed
          }`}
          data-testid="lab-status"
          role="status"
        >
          {JA.lab.countsText(counts.inputs, counts.expectedRows)} ／{' '}
          {run === undefined ? JA.lab.notRunYet : labRunText(run)}
        </p>
        <EnlargeableChart
          title={JA.lab.panelTitle}
          figure={figure}
          testId="lab-mini-chart"
          smallClassName={panels.chart}
        />
        <div className={styles.actions}>
          <button
            type="button"
            data-testid="lab-open-editor"
            onClick={() => {
              setEditorOpen(true);
            }}
          >
            {JA.lab.openEditor}
          </button>
          <button
            type="button"
            data-testid="lab-run"
            disabled={busy}
            aria-busy={running}
            onClick={() => {
              requestLabRun(false);
            }}
          >
            {running ? JA.lab.running : JA.lab.run}
          </button>
          <button
            type="button"
            data-testid="lab-judge"
            disabled={busy || problem.expected === undefined}
            title={problem.expected === undefined ? JA.lab.judgeNeedsExpected : undefined}
            onClick={() => {
              requestLabRun(true);
            }}
          >
            {JA.lab.judge}
          </button>
          <button
            type="button"
            data-testid="lab-replay"
            disabled={!replayable}
            title={replayable ? undefined : JA.lab.replayNeedsRun}
            onClick={() => {
              if (!startReplay('lab')) useStore.getState().toast(JA.replay.cannotReplay, 'info');
            }}
          >
            {JA.lab.replay}
          </button>
          <button
            type="button"
            data-testid="lab-restart-board"
            onClick={() => {
              setRestartOpen(true);
            }}
          >
            {JA.lab.restartBoard}
          </button>
        </div>
        {problem.expected === undefined ? (
          <p className={styles.reason} data-testid="lab-judge-reason">
            {JA.lab.judgeNeedsExpected}
          </p>
        ) : null}
      </CollapsiblePanel>
      {/* 開閉できる欄の外に置く（欄を畳んでも窓は消えない） */}
      {editorOpen ? (
        <LabChartEditor
          onClose={() => {
            setEditorOpen(false);
          }}
        />
      ) : null}
      {restartOpen ? (
        <LabRestartDialog
          problem={problem}
          onClose={() => {
            setRestartOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * 「配線をやり直す」の確認。PLC実験は配線済みの盤と自分で配線する盤を選び直せる
 * （利用者の決定 D3: 開始時と課題ごとに選べる）。タイムチャートとラダーは残る。
 */
export function LabRestartDialog({
  problem,
  onClose,
}: {
  problem: LabProblem;
  onClose: () => void;
}): JSX.Element {
  const [prewired, setPrewired] = useState(problem.mode === 'plc-lab' ? problem.prewired : true);
  return (
    <ConfirmDialog testId="lab-restart" titleId="lab-restart-title" onCancel={onClose}>
      <h2 id="lab-restart-title">{JA.lab.restartTitle}</h2>
      <p>{JA.lab.restartBody}</p>
      {problem.mode === 'plc-lab' ? (
        <fieldset className={styles.choices}>
          <legend>{JA.lab.wiringLegend}</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="lab-restart-wiring"
              data-testid="lab-restart-prewired"
              checked={prewired}
              onChange={() => {
                setPrewired(true);
              }}
            />
            <span>
              {JA.lab.prewired}
              <span className={styles.choiceNote}>{JA.lab.prewiredNote}</span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="lab-restart-wiring"
              data-testid="lab-restart-self-wire"
              checked={!prewired}
              onChange={() => {
                setPrewired(false);
              }}
            />
            <span>
              {JA.lab.selfWire}
              <span className={styles.choiceNote}>{JA.lab.selfWireNote}</span>
            </span>
          </label>
        </fieldset>
      ) : null}
      <div className={navigation.actions}>
        <button
          type="button"
          data-testid="lab-restart-go"
          onClick={() => {
            restartLabBoard(problem.mode === 'plc-lab' ? prewired : undefined);
            onClose();
          }}
        >
          {JA.lab.restartGo}
        </button>
        <button type="button" onClick={onClose} data-dialog-autofocus>
          {JA.lab.cancel}
        </button>
      </div>
    </ConfirmDialog>
  );
}
