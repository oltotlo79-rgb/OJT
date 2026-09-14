import type { HazardCounts, StaticCheckResult } from '@ojt/content';
import type { HazardKind } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './result.module.css';

/**
 * 静的チェック結果と危険操作の回数。設計仕様 §7.4 / §8.3。
 * 合否には静的チェックだけが効き、危険操作回数と所要時間は参考表示に留める（§17.2 #3）。
 */

/** 静的チェック一覧。 */
export function StaticCheckList({ checks }: { checks: readonly StaticCheckResult[] }): JSX.Element {
  return (
    <div className={styles.card}>
      <h2>{JA.result.staticChecks}</h2>
      <div data-testid="static-checks">
        {checks.map((check) => (
          <div key={check.id}>
            <div className={styles.checkRow}>
              <span className={check.ok ? styles.badgeOk : styles.badgeNg}>
                {check.ok ? JA.result.ok : JA.result.ng}
              </span>
              <span>{JA.staticCheck[check.id]}</span>
              <span className={styles.detail}>{check.message}</span>
            </div>
            {check.details.length === 0 ? null : (
              <ul className={styles.detail}>
                {check.details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 危険操作の種別ごとの回数。§5.6 / §8.3 */
export function HazardList({
  counts,
  total,
}: {
  counts: HazardCounts;
  total: number;
}): JSX.Element {
  const rows = (Object.keys(counts) as HazardKind[]).filter((kind) => counts[kind] > 0);
  return (
    <div className={styles.card}>
      <h2>
        {JA.result.hazards}（{total}）
      </h2>
      {rows.length === 0 ? (
        <p>{JA.result.hazardNone}</p>
      ) : (
        <table className={styles.table} data-testid="hazard-table">
          <tbody>
            {rows.map((kind) => (
              <tr key={kind}>
                <td>{JA.hazard[kind]}</td>
                <td>
                  {counts[kind]} {JA.result.times}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
