import { DIAGNOSIS_TABLE, layerShortThresholdOhms, PART_TRUTH_LABELS } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './tester.module.css';

/**
 * モードC1の判定表ヘルプ。設計仕様 §9.1（ヘルプ）。
 * 表そのものは Plan 2A の `DIAGNOSIS_TABLE`（7行）が唯一の源で、ここは折りたたんで描くだけ。
 * しきい値も `layerShortThresholdOhms()` から引くので、コイル抵抗の前提が変われば表示も動く。
 * 各行の `note`（溶着の優先規則・レアショートの補足）は行があれば併記する。§9.1 なお書き
 */
export function DiagnosisHelp(): JSX.Element {
  return (
    <details className={`${styles.panel} ${styles.help}`} data-testid="diagnosis-help">
      <summary>{JA.inspectParts.help}</summary>
      <table className={styles.helpTable} data-testid="diagnosis-table">
        <thead>
          <tr>
            <th>{JA.inspectParts.situation}</th>
            <th>{JA.inspectParts.cause}</th>
          </tr>
        </thead>
        <tbody>
          {DIAGNOSIS_TABLE.map((row) => (
            <tr key={`${row.cause}-${row.situation}`}>
              <td>
                {row.situation}
                {row.note !== undefined ? <p className={styles.hint}>{row.note}</p> : null}
              </td>
              <td>{PART_TRUTH_LABELS[row.cause]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.hint} data-testid="diagnosis-note">
        {JA.inspectParts.layerShortNote}（{layerShortThresholdOhms().toFixed(1)} Ω）
      </p>
      <p className={styles.hint}>{JA.inspectParts.ohmSafeNote}</p>
    </details>
  );
}
