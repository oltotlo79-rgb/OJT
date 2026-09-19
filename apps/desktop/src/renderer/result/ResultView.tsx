import type { AssembleProblem, JudgeResult } from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { elapsedSummaryText, JA } from '../i18n/ja.js';
import { ChartOverlay } from './ChartOverlay.js';
import { MismatchList } from './MismatchList.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * 結果画面。設計仕様 §8.3。
 * 合否／差分一覧／チャート重ね表示／静的チェック／危険操作／所要時間の6点を並べる。
 * チャタリングを検出していたら禁則回路の明示警告を出す。
 */

/** 所要時間と標準・打切り時間の対比文。§8.3（文言そのものは `ja.ts` が持つ。§15） */
export const elapsedSummary = elapsedSummaryText;

/** 結果画面の本体。 */
export function ResultView({
  problem,
  result,
  restoredHazardCount = 0,
  onRetry,
  onBackToList,
}: {
  problem: AssembleProblem;
  result: JudgeResult;
  /**
   * 作業ファイルから復元した危険操作の回数。§12.3 / §5.6
   *
   * 判定は Worker が作り直したネットリストの上で行うので `JudgeResult.hazardCount` は
   * **復元後の分だけ**を数えている。種別ごとの内訳は復元できないため、見出しの合計だけを
   * 「今回の分 ＋ 復元した分」にして、訓練者が実際に踏んだ回数と食い違わないようにする。
   */
  restoredHazardCount?: number;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        {/* 合否は画面を開いた瞬間に読み上げてほしい情報なので、支援技術にも伝える（§8.3） */}
        <span
          className={`${styles.verdict} ${result.passed ? styles.passed : styles.failed}`}
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
          {elapsedSummary(elapsedMs, problem.timeLimit.standardMin, problem.timeLimit.cutoffMin)}）
        </span>
      </div>

      {result.chatter.length === 0 ? null : (
        <p className={styles.forbidden} data-testid="forbidden-warning">
          {JA.result.forbidden}
        </p>
      )}

      <div className={styles.grid}>
        <ChartOverlay
          expected={result.charts.expected}
          actual={result.charts.actual}
          mismatches={result.mismatches}
        />
        <MismatchList mismatches={result.mismatches} />
        <StaticCheckList checks={result.staticChecks} />
        <HazardList
          counts={result.hazardsByKind}
          total={result.hazardCount + restoredHazardCount}
        />
      </div>

      <div className={`${styles.actions} ${styles.stickyActions}`}>
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
