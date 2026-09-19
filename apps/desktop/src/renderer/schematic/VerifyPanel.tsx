import type { AssembleProblem, VerifyResult } from '@ojt/content';
import type { SchematicDocument } from '@ojt/schematic-core';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { ChartOverlay } from '../result/ChartOverlay.js';
import { MismatchList } from '../result/MismatchList.js';
import { StaticCheckList } from '../result/StaticCheckList.js';
import { issueText } from '../session/schematic-edit.js';
import styles from './schematic.module.css';

/**
 * 検算の結果。設計仕様 §11.4 / Plan 5 決定表#5・#6。
 *
 * 判定の結果画面（`result/ResultView.tsx`）と**同じ部品**を使う（`ChartOverlay` / `MismatchList` /
 * `StaticCheckList`）。基準が同じであることを画面の見た目でも示すためである。
 * 「盤に写す」は置かない（決定表#5: 配線操作そのものが訓練）。
 *
 * 指摘の文面はエディタの指摘欄と**同じ `issueText()`** を通す（レビュー I4）。
 * 検算は `validateDocument()` / `toSession()` の文面をそのまま返すので、通さないと
 * 「`c03` が…」のように内部IDが画面に出てしまう。
 */
export function VerifyPanel({
  problem,
  document: doc,
  result,
  onPickCell,
}: {
  problem: AssembleProblem;
  /** 検算に出した下書き（指摘の中の内部IDを「1段目の2番目」に読み替えるのに使う）。 */
  document: SchematicDocument;
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
                issueText(doc, issue.message)
              ) : (
                <button
                  type="button"
                  className={styles.paletteItem}
                  onClick={() => {
                    onPickCell(issue.cellId);
                  }}
                >
                  {issueText(doc, issue.message)}
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
      {/* 何を検算したのかを見出し付きで示す（題名だけがぶら下がっていると読めない。レビュー Minor） */}
      <h3 className={styles.issuesTitle}>{JA.schematic.verifiedProblem}</h3>
      <p className={styles.verifyNote}>{problem.title}</p>
    </section>
  );
}
