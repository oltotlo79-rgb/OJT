import type { SupportedProblem } from '@ojt/content';
import type { JSX } from 'react';
import { gradeLabel, JA } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * 課題文パネル。設計仕様 §8.1（右パネル上段）。
 * `description` は Markdown 可だがプレーンテキスト＋改行で表示する（§7.1）。
 */

/** 課題文の表示。 */
export function ProblemPanel({ problem }: { problem: SupportedProblem }): JSX.Element {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.problem}</h2>
      <p className={styles.problemTitle}>
        {problem.title}（{gradeLabel(problem.grade)}）
      </p>
      <p className={styles.problemText}>{problem.description}</p>
    </section>
  );
}
