import {
  PART_TRUTH_LABELS,
  PART_TRUTHS,
  type InspectPartAnswer,
  type InspectPartsProblem,
  type PartTruth,
} from '@ojt/content';
import type { JSX } from 'react';
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
  return (
    <section className={styles.panel} data-testid="mark-sheet">
      <h2 className={styles.title}>{JA.inspectParts.markSheet}</h2>
      <p className={styles.label} data-testid="answered-count">
        {answeredText(answeredCount(problem, answers), problem.parts.length)}
      </p>
      <table className={styles.markTable}>
        <thead>
          <tr>
            <th>{JA.inspectParts.part}</th>
            <th>{JA.inspectParts.cause}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const partLabel = trayPartLabel(row.partId, row.kind === 'timer-h3y4');
            return (
              <tr key={row.partId}>
                <td>{partLabel}</td>
                <td>
                  {/*
                    UI監査 I16: 7択を縦一列の13pxラジオで並べていたため、当たり判定が小さく
                    （small-target）、狭い列幅で「レアショート」が語の途中で折り返していた
                    （wrap）。横並びのチップへ変え、チップ自身の当たり判定を広げ、
                    ラベルは折り返さない1行にする。
                  */}
                  <div className={styles.markOptions}>
                    {PART_TRUTHS.map((truth) => (
                      <label key={truth} className={styles.markOption}>
                        <input
                          type="radio"
                          name={`mark-${row.partId}`}
                          data-testid={`answer-${row.partId}-${truth}`}
                          aria-label={`${partLabel} ${PART_TRUTH_LABELS[truth]}`}
                          checked={row.answer === truth}
                          onChange={() => {
                            onAnswer(row.partId, truth);
                          }}
                        />
                        {PART_TRUTH_LABELS[truth]}
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
