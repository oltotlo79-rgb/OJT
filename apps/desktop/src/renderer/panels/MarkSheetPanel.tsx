import {
  PART_TRUTH_LABELS,
  PART_TRUTHS,
  type InspectPartAnswer,
  type InspectPartsProblem,
  type PartTruth,
} from '@ojt/content';
import { useEffect, useRef, useState, type JSX } from 'react';
import { answeredText, JA, trayPartLabel } from '../i18n/ja.js';
import { answeredCount, markSheetRows } from '../session/inspect-parts.js';
import styles from './tester.module.css';

/**
 * モードC1のマークシート。設計仕様 §9.1 / §17.2 #5。
 * 部品 × ｛正常 ＋ 不良原因6種｝の**排他選択**（radio。同じ部品の選択肢が同じ `name` を持つ）。
 * 未解答のまま判定してもよい（未解答は不正解として数える。Plan 2A `judgeInspectParts`）。
 */
export function MarkSheetPanel({
  problem,
  answers,
  onAnswer,
}: {
  problem: InspectPartsProblem;
  answers: readonly InspectPartAnswer[];
  onAnswer: (partId: string, answer: PartTruth) => void;
}): JSX.Element {
  const rows = markSheetRows(problem, answers);
  const host = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(true);
  useEffect(() => {
    if (host.current === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setCompact(entry.contentRect.width < 680);
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const option = (
    partId: string,
    truth: PartTruth,
    partLabel: string,
    answer: PartTruth | undefined,
  ): JSX.Element => (
    <label key={truth} className={styles.markOption}>
      <input
        type="radio"
        name={`mark-${partId}`}
        data-testid={`answer-${partId}-${truth}`}
        aria-label={`${partLabel} ${PART_TRUTH_LABELS[truth]}`}
        checked={answer === truth}
        onChange={() => onAnswer(partId, truth)}
      />
      {compact ? PART_TRUTH_LABELS[truth] : null}
    </label>
  );
  return (
    <section className={styles.panel} data-testid="mark-sheet" ref={host}>
      <h2 className={styles.title}>{JA.inspectParts.markSheet}</h2>
      <p className={styles.label} data-testid="answered-count">
        {answeredText(answeredCount(problem, answers), problem.parts.length)}
      </p>
      {compact ? (
        <div className={styles.markCards} aria-label={JA.inspectParts.cause}>
          {rows.map((row) => {
            const label = trayPartLabel(row.partId, row.kind === 'timer-h3y4');
            return (
              <details key={row.partId} open>
                <summary>
                  {label}
                  <span>
                    {row.answer === undefined
                      ? JA.inspectParts.unanswered
                      : PART_TRUTH_LABELS[row.answer]}
                  </span>
                </summary>
                <div className={styles.markOptions}>
                  {PART_TRUTHS.map((truth) => option(row.partId, truth, label, row.answer))}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <div className={styles.markScroll}>
          <table className={styles.markTable}>
            <thead>
              <tr>
                <th scope="col">{JA.inspectParts.part}</th>
                {PART_TRUTHS.map((truth) => (
                  <th key={truth} scope="col">
                    {PART_TRUTH_LABELS[truth]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const partLabel = trayPartLabel(row.partId, row.kind === 'timer-h3y4');
                return (
                  <tr key={row.partId}>
                    <th scope="row">{partLabel}</th>
                    {PART_TRUTHS.map((truth) => (
                      <td key={truth}>{option(row.partId, truth, partLabel, row.answer)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
