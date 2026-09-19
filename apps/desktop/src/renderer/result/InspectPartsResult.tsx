import {
  DIAGNOSIS_TABLE,
  PART_TRUTH_LABELS,
  type InspectPartsProblem,
  type JudgeInspectPartsResult,
  type PartTruth,
} from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { correctCountText, elapsedSummaryText, JA, trayPartLabel } from '../i18n/ja.js';
import { HazardList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * 正解（`truth`）1件ぶんの「そう見分けられる理由」（UXレビュー #23）。
 * `DIAGNOSIS_TABLE`（判定表ヘルプ §9.1 と同じ唯一の源）の `situation` をそのまま使うので、
 * 文言はヘルプパネルと常に一致する。
 */
const SITUATION_BY_TRUTH: ReadonlyMap<PartTruth, string> = new Map(
  DIAGNOSIS_TABLE.map((row) => [row.cause, row.situation] as const),
);

/**
 * モードC1の結果画面。設計仕様 §9.1 判定 / §8.3。
 * 合否は「全部品の解答一致」だけで決まる。危険操作の回数と所要時間は**参考表示**であり、
 * 合否には影響しない（§17.2 #3）。
 */
export function InspectPartsResult({
  problem,
  result,
  restoredHazardCount = 0,
  onRetry,
  onBackToList,
}: {
  problem: InspectPartsProblem;
  result: JudgeInspectPartsResult;
  /** 作業ファイルから復元した危険操作の回数（種別の内訳は復元できないので合計だけ足す）。§12.3 */
  restoredHazardCount?: number;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  const kindOf = new Map(problem.parts.map((p) => [p.id, p.kind] as const));
  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <div className={styles.header}>
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
          <span data-testid="correct-count">
            {correctCountText(result.correctCount, result.total)}
          </span>
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

        <div className={styles.grid}>
          <div className={styles.card}>
            <h2>{JA.result.markSheet}</h2>
            <table className={styles.table} data-testid="mark-result-table">
              <thead>
                <tr>
                  <th />
                  <th>{JA.inspectParts.part}</th>
                  <th>{JA.result.yourAnswer}</th>
                  <th>{JA.result.truth}</th>
                  <th>{JA.result.truthReading}</th>
                </tr>
              </thead>
              <tbody>
                {result.scores.map((score) => (
                  <tr key={score.partId}>
                    <td>
                      <span className={score.correct ? styles.badgeOk : styles.badgeNg}>
                        {score.correct ? JA.result.ok : JA.result.ng}
                      </span>
                    </td>
                    <td>
                      {(() => {
                        const kind = kindOf.get(score.partId);
                        // `problem.parts` に無い部品は種別が分からないので、
                        // （リレー）と決め打ちせず素の partId を出す（レビュー指摘 M5）。
                        return kind === undefined
                          ? score.partId
                          : trayPartLabel(score.partId, kind === 'timer-h3y4');
                      })()}
                    </td>
                    <td data-testid={`answer-${score.partId}`}>
                      {score.answer === undefined
                        ? JA.result.unanswered
                        : PART_TRUTH_LABELS[score.answer]}
                    </td>
                    <td>{PART_TRUTH_LABELS[score.truth]}</td>
                    {/*
                      UXレビュー #23: 正解だけでなく「なぜそう見分けられるか」（期待される読み）
                      を1行添える。`DiagnosisHelp` の判定表と同じ `situation` 文言を使う。
                    */}
                    <td className={styles.detail} data-testid={`reading-${score.partId}`}>
                      {SITUATION_BY_TRUTH.get(score.truth) ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <HazardList
            counts={result.hazardsByKind}
            total={result.hazardCount + restoredHazardCount}
          />
        </div>
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
