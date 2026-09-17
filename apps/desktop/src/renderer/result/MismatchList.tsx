import type { Mismatch } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { JA, signalLabel } from '../i18n/ja.js';
import { timeReadout } from '../panels/chart-scale.js';
import styles from './result.module.css';

/**
 * 差分一覧（時刻・信号・期待・実際）。設計仕様 §8.3。
 * 許容差を超えた遷移だけが `compareLogs()` から返ってくるので、そのまま並べる。
 */

/** ミリ秒を `1.23 s` の形にする（チャートのカーソル読みと同じ形。§7.7）。 */
export function formatMs(ms: number): string {
  return timeReadout(ms);
}

/** 差分一覧。 */
export function MismatchList({ mismatches }: { mismatches: readonly Mismatch[] }): JSX.Element {
  return (
    <div className={styles.card}>
      <h2>
        {JA.result.mismatches}（{mismatches.length}）
      </h2>
      {mismatches.length === 0 ? (
        <p data-testid="no-mismatch">{JA.result.noMismatch}</p>
      ) : (
        <table className={styles.table} data-testid="mismatch-table">
          <thead>
            <tr>
              <th>{JA.result.time}</th>
              <th>{JA.result.signal}</th>
              <th>{JA.result.expected}</th>
              <th>{JA.result.actual}</th>
              <th>{JA.result.reason}</th>
            </tr>
          </thead>
          <tbody>
            {mismatches.map((mismatch, index) => (
              <tr key={`${mismatch.signal}-${mismatch.tMs}-${index}`}>
                <td>{formatMs(mismatch.tMs)}</td>
                <td>{mismatch.signal}</td>
                <td>{signalLabel(mismatch.expected)}</td>
                <td>
                  {signalLabel(mismatch.actual)}
                  {mismatch.actualTMs === undefined ? '' : `（${formatMs(mismatch.actualTMs)}）`}
                </td>
                <td>{JA.mismatchReason[mismatch.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
