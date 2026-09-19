import type { AssembleProblem, VerifyResult } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { ChartOverlay } from '../result/ChartOverlay.js';
import { MismatchList } from '../result/MismatchList.js';
import { StaticCheckList } from '../result/StaticCheckList.js';
import styles from './schematic.module.css';

/**
 * 検算の結果。設計仕様 §11.4 / Plan 5 決定表#5・#6。
 *
 * 判定の結果画面（`result/ResultView.tsx`）と**同じ部品**を使う（`ChartOverlay` / `MismatchList` /
 * `StaticCheckList`）。基準が同じであることを画面の見た目でも示すためである。
 * 「盤に写す」は置かない（決定表#5: 配線操作そのものが訓練）。
 */
export function VerifyPanel({
  problem,
  result,
  onPickCell,
}: {
  problem: AssembleProblem;
  result: VerifyResult;
  /** 指摘をクリックしたときに回路図の要素を光らせる（Task 8 の配線ガイドと同じ道）。 */
  onPickCell: (cellId: string | undefined) => void;
}): JSX.Element {
  if (!result.ok) {
    /*
     * 判定まで進めなかった場合（作りかけの文書・盤へ落とし込めない回路）。
     * 直すべき場所が分かるよう、要素を指している指摘は押せるようにして図の側を光らせる。
     */
    return (
      <section className={styles.verify} data-testid="verify-panel">
        <span
          className={`${styles.verdict} ${styles.failed}`}
          data-testid="verify-verdict"
          role="status"
          aria-live="polite"
        >
          {JA.schematic.verifyFailed}
        </span>
        <h3 className={styles.issuesTitle}>{JA.schematic.issues}</h3>
        <ul className={styles.issueList} data-testid="verify-issues">
          {result.errors.map((issue) => (
            <li key={`${issue.source}:${issue.path}:${issue.message}`}>
              {issue.cellId === undefined ? (
                issue.message
              ) : (
                <button
                  type="button"
                  className={styles.paletteItem}
                  onClick={() => {
                    onPickCell(issue.cellId);
                  }}
                >
                  {issue.message}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className={styles.verifyNote}>{JA.schematic.verifyNote}</p>
      </section>
    );
  }
  return (
    <section className={styles.verify} data-testid="verify-panel">
      <span
        className={`${styles.verdict} ${result.passed ? styles.passed : styles.failed}`}
        data-testid="verify-verdict"
        role="status"
        aria-live="polite"
      >
        {result.passed ? JA.schematic.verifyPassed : JA.schematic.verifyFailed}
      </span>
      <p className={styles.verifyNote}>{JA.schematic.verifyNote}</p>
      <ChartOverlay
        expected={result.judge.charts.expected}
        actual={result.judge.charts.actual}
        mismatches={result.judge.mismatches}
      />
      <MismatchList mismatches={result.judge.mismatches} />
      <StaticCheckList checks={result.judge.staticChecks} />
      <span className={styles.verifyNote}>{problem.title}</span>
    </section>
  );
}
