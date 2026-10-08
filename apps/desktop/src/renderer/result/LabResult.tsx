import type { LabJudgeResult, LabProblem } from '@ojt/content';
import type { JSX } from 'react';
import { comparedSignalsText, JA } from '../i18n/ja.js';
import { TimeChartSvg } from '../panels/TimeChartPanel.js';
import { failureReasons } from '../session/plc-explain.js';
import { ChartOverlay, type ChartOverlayLabels } from './ChartOverlay.js';
import { LadderIssueList } from './LadderIssueList.js';
import { MismatchList } from './MismatchList.js';
import { ResultShell } from './ResultShell.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import { verdictSummary } from './verdict-summary.js';
import styles from './result.module.css';

/** 波形の見比べの言い方（模範ではなく、描いた正解と動かした結果）。 */
const LAB_LABELS: ChartOverlayLabels = {
  title: JA.lab.overlayTitle,
  expectedHeading: JA.lab.overlayExpected,
  actualHeading: JA.lab.overlayActual,
  legendExpected: JA.lab.overlayLegendExpected,
  legendActual: JA.lab.overlayLegendActual,
};

/**
 * 回路実験・PLC実験の結果画面（2026-10-08）。設計 §6.4
 *
 * 見比べる相手は模範回路ではなく**描いた正解**なので、波形の重ね表示は「正解（描いた動き）」と
 * 「動かした結果」になる。並びは PLC の結果画面と同じ（①合否 ②理由 ③波形 ④差分・静的チェック）。
 * PLC実験ではラダーの変換の指摘も出す。
 */
export function LabResult({
  problem,
  result,
  restoredHazardCount = 0,
  onRetry,
  onBackToList,
}: {
  problem: LabProblem;
  result: LabJudgeResult;
  restoredHazardCount?: number;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const ladderErrors = result.mode === 'plc-lab' ? result.ladderErrors : [];
  const reasons = failureReasons({
    ladderErrors,
    staticChecks: result.staticChecks,
    mismatches: result.mismatches,
  });
  const summary = verdictSummary(result);
  const expected = result.charts.expected;
  return (
    <ResultShell
      title={problem.title}
      passed={result.passed}
      elapsedMs={result.elapsedMs ?? 0}
      timeLimit={problem.timeLimit}
      verdictBig
      forbidden={result.chatter.length > 0}
      summary={summary.text}
      onRetry={onRetry}
      onBackToList={onBackToList}
      backLabel={JA.problemList.back}
    >
      <div className={styles.why} data-testid="lab-why">
        <h2>{JA.plc.why}</h2>
        {reasons.length === 0 ? (
          <p data-testid="lab-why-passed">{JA.lab.whyPassed}</p>
        ) : (
          <ol className={styles.reasons}>
            {reasons.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        )}
        <p className={styles.detail} data-testid="compare-signals">
          {comparedSignalsText(result.compareSignals)}
        </p>
        <p className={styles.detail}>{JA.lab.resultNote}</p>
      </div>
      <div className={styles.grid}>
        {result.mode === 'plc-lab' ? (
          <LadderIssueList errors={result.ladderErrors} warnings={result.ladderWarnings} />
        ) : null}
        {expected === undefined ? (
          <div className={styles.card}>
            <h2>{JA.lab.actualChart}</h2>
            <TimeChartSvg chart={result.charts.actual} title={JA.lab.actualChart} />
          </div>
        ) : (
          <ChartOverlay
            expected={expected}
            actual={result.charts.actual}
            mismatches={result.mismatches}
            labels={LAB_LABELS}
          />
        )}
        <MismatchList mismatches={result.mismatches} />
        <StaticCheckList checks={result.staticChecks} />
        <HazardList
          counts={result.hazardsByKind}
          total={result.hazardCount + restoredHazardCount}
        />
      </div>
    </ResultShell>
  );
}
