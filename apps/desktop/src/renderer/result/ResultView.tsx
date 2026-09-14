import type { AssembleProblem, JudgeResult } from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { JA } from '../i18n/ja.js';
import { ChartOverlay } from './ChartOverlay.js';
import { MismatchList } from './MismatchList.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * 結果画面。設計仕様 §8.3。
 * 合否／差分一覧／チャート重ね表示／静的チェック／危険操作／所要時間の6点を並べる。
 * チャタリングを検出していたら禁則回路の明示警告を出す。
 */

/** 所要時間と標準・打切り時間の対比文。§8.3 */
export function elapsedSummary(elapsedMs: number, standardMin: number, cutoffMin: number): string {
  const standardMs = standardMin * 60_000;
  const cutoffMs = cutoffMin * 60_000;
  if (elapsedMs > cutoffMs) return `${JA.result.cutoffMark}（${cutoffMin}分）を超過`;
  if (elapsedMs > standardMs) return `${JA.result.standardMark}（${standardMin}分）を超過`;
  return `${JA.result.standardMark}（${standardMin}分）以内`;
}

/** 結果画面の本体。 */
export function ResultView({
  problem,
  result,
  onRetry,
  onBackToList,
}: {
  problem: AssembleProblem;
  result: JudgeResult;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span
          className={`${styles.verdict} ${result.passed ? styles.passed : styles.failed}`}
          data-testid="verdict"
        >
          {result.passed ? JA.result.passed : JA.result.failed}
        </span>
        <h1 style={{ fontSize: 18, margin: 0 }}>
          {JA.result.title}: {problem.title}
        </h1>
        <span data-testid="result-elapsed">
          {JA.result.elapsed} {formatElapsed(elapsedMs)}（
          {elapsedSummary(elapsedMs, problem.timeLimit.standardMin, problem.timeLimit.cutoffMin)}）
        </span>
      </div>

      {result.chatter.length === 0 ? null : (
        <p className={styles.forbidden} data-testid="forbidden-warning">
          {JA.result.forbidden}
        </p>
      )}

      <div className={styles.grid}>
        <ChartOverlay expected={result.charts.expected} actual={result.charts.actual} />
        <MismatchList mismatches={result.mismatches} />
        <StaticCheckList checks={result.staticChecks} />
        <HazardList counts={result.hazardsByKind} total={result.hazardCount} />
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
