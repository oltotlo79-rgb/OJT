import type { ChatterEvent, HazardEvent } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { JA, restoredHazardsText } from '../i18n/ja.js';
import type { LogLine } from '../app/store.js';
import styles from './panels.module.css';

/**
 * 操作ログと警告一覧。設計仕様 §8.1（下部）。
 * 危険操作は §5.6 の種別名を日本語で出し、チャタリングは禁則回路の警告文を添える（§8.3）。
 */

/** 操作ログ・警告の表示。 */
export function LogPanel({
  lines,
  hazards,
  chatters,
  restoredHazardCount = 0,
}: {
  lines: readonly LogLine[];
  hazards: readonly HazardEvent[];
  chatters: readonly ChatterEvent[];
  /**
   * 作業ファイルから復元した危険操作の回数。§12.3 / §5.6
   * Worker は復元でネットリストを作り直すので、保存前の分は種別まで残らない。回数だけを添える。
   */
  restoredHazardCount?: number;
}): JSX.Element {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>
        {JA.session.log}（{lines.length}）
      </h2>
      <ul className={styles.logList} data-testid="operation-log">
        {lines.slice(-30).map((line) => (
          <li key={line.id}>{line.text}</li>
        ))}
      </ul>
      {hazards.length === 0 && chatters.length === 0 && restoredHazardCount === 0 ? null : (
        <ul className={styles.warnList} data-testid="warning-list">
          {restoredHazardCount === 0 ? null : (
            <li data-testid="restored-hazards">{restoredHazardsText(restoredHazardCount)}</li>
          )}
          {hazards.map((hazard, index) => (
            <li key={`h-${index}`}>
              {JA.hazard[hazard.kind]}（{hazard.detail}）
            </li>
          ))}
          {chatters.length === 0 ? null : <li>{JA.result.forbidden}</li>}
        </ul>
      )}
    </section>
  );
}
