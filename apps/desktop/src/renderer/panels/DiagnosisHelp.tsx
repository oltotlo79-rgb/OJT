import { DIAGNOSIS_TABLE, PART_TRUTH_LABELS } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './tester.module.css';

/**
 * モードC1の判定表ヘルプ。設計仕様 §9.1（ヘルプ）。
 * 表そのものは Plan 2A の `DIAGNOSIS_TABLE`（7行）が唯一の源で、ここは折りたたんで描くだけ。
 * 各行の `note`（溶着の優先規則・レアショートの補足としきい値）は行があれば併記する。§9.1 なお書き
 * しきい値（コイル抵抗552.5Ω＝正常値650Ωの85%）は `coil-layer-short` 行の `note` だけに書く
 * （UI監査 I4: パネル下に同じ説明を重ねて出すと逐語で2回になるので出さない）。
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
        {JA.inspectParts.ohmSafeNote}
      </p>
    </details>
  );
}
