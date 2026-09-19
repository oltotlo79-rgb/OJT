import type { JudgePlcResult, PlcProblem } from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { comparedSignalsText, elapsedSummaryText, JA } from '../i18n/ja.js';
import { explainPowerCheck, failureReasons } from '../session/plc-explain.js';
import { ChartOverlay } from './ChartOverlay.js';
import { LadderIssueList } from './LadderIssueList.js';
import { MismatchList } from './MismatchList.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * モードDの結果画面。設計仕様 §10.8 / §8.3。
 *
 * 2026-09-19 の利用者決定「分かりやすく直感的に」に沿って、上から
 * ①合否（大きく・色つき）②なぜそうなったか（訓練者の言葉と直し方）③波形の見比べ
 * ④差分・静的チェック・危険操作、の順に並べる。内部の識別子は画面に出さず、
 * 用語は GX Works3 / 技能検定の言い方（`ja.ts`）に揃える。
 */
export function PlcResult({
  problem,
  result,
  restoredHazardCount = 0,
  onRetry,
  onBackToList,
}: {
  problem: PlcProblem;
  result: JudgePlcResult;
  /** 作業ファイルから復元した危険操作の回数（`ResultView` と同じ扱い）。§12.3 / §5.6 */
  restoredHazardCount?: number;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  const powerHelp = result.staticChecks.flatMap((check) => explainPowerCheck(check));
  const reasons = failureReasons(result);
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        {/* 合否は画面を開いた瞬間に読み上げてほしい情報なので、支援技術にも伝える（§8.3） */}
        <span
          className={`${styles.verdict} ${styles.verdictBig} ${
            result.passed ? styles.passed : styles.failed
          }`}
          data-testid="verdict"
          role="status"
          aria-live="polite"
        >
          {result.passed ? JA.result.passed : JA.result.failed}
        </span>
        <h1 className={styles.title}>
          {JA.result.title}: {problem.title}
        </h1>
        <span data-testid="result-elapsed">
          {JA.result.elapsed} {formatElapsed(elapsedMs)}（
          {elapsedSummaryText(
            elapsedMs,
            problem.timeLimit.standardMin,
            problem.timeLimit.cutoffMin,
          )}
          ）
        </span>
      </div>

      {result.chatter.length === 0 ? null : (
        <p className={styles.forbidden} data-testid="forbidden-warning">
          {JA.result.forbidden}
        </p>
      )}

      {/* 合否のすぐ下に「なぜ」を置く。波形を読む前に、何を直せばよいかが分かるように */}
      <div className={styles.why} data-testid="plc-why">
        <h2>{JA.plc.why}</h2>
        {reasons.length === 0 ? (
          <p data-testid="plc-why-passed">{JA.plc.whyPassed}</p>
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
      </div>

      <div className={styles.grid}>
        <LadderIssueList errors={result.ladderErrors} warnings={result.ladderWarnings} />
        <ChartOverlay
          expected={result.charts.expected}
          actual={result.charts.actual}
          mismatches={result.mismatches}
        />
        <MismatchList mismatches={result.mismatches} />
        <StaticCheckList checks={result.staticChecks} />
        {powerHelp.length === 0 ? null : (
          <div className={styles.card} data-testid="plc-power-help">
            <h2>{JA.staticCheck.plcPowerIndependent}</h2>
            <ul>
              {powerHelp.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        <HazardList
          counts={result.hazardsByKind}
          total={result.hazardCount + restoredHazardCount}
        />
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={onRetry}>
          {JA.result.retry}
        </button>
        <button type="button" onClick={onBackToList}>
          {JA.result.toList}
        </button>
      </div>
    </div>
  );
}
