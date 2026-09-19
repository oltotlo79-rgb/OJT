import type { CompileError, CompileWarning } from '@ojt/ladder-core';
import type { JSX } from 'react';
import { JA, ladderIssuePlace } from '../i18n/ja.js';
import styles from './result.module.css';

/**
 * 変換エラーと警告の一覧（結果画面）。設計仕様 §10.6 / §10.8。
 * エラーがあるということは**シミュレートされずに不合格になった**ということなので、その旨を添える。
 */
export function LadderIssueList({
  errors,
  warnings,
}: {
  errors: readonly CompileError[];
  warnings: readonly CompileWarning[];
}): JSX.Element | null {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <>
      {errors.length === 0 ? null : (
        <div className={styles.card} data-testid="ladder-errors">
          <h2>{JA.plc.ladderErrors}</h2>
          <p className={styles.detail}>{JA.plc.ladderNotSimulated}</p>
          <ul>
            {errors.map((error, index) => (
              <li key={`e-${String(index)}`}>
                {ladderIssuePlace(error.networkId, error.row, error.col)} {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length === 0 ? null : (
        <div className={styles.card} data-testid="ladder-warnings">
          <h2>{JA.plc.ladderWarnings}</h2>
          <ul>
            {warnings.map((warning, index) => (
              <li key={`w-${String(index)}`}>
                {JA.ladder.doubleCoil}:{' '}
                {ladderIssuePlace(warning.networkId, warning.row, warning.col)} {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
