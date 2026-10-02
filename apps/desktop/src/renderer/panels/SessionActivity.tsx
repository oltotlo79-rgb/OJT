import type { TimeLimit } from '@ojt/content';
import type { ComponentProps, JSX } from 'react';
import { useStore } from '../app/store.js';
import { formatElapsed } from '../../worker/runtime.js';
import { JA } from '../i18n/ja.js';
import { ElapsedTimer } from './ElapsedTimer.js';
import { LogPanel } from './LogPanel.js';
import styles from './session-activity.module.css';

/** 折りたたんでも経過時間と警告数を残す。時間の購読は3D画面から切り離す。 */
export function SessionActivity({
  limit,
  ...log
}: ComponentProps<typeof LogPanel> & { limit: TimeLimit }): JSX.Element {
  const elapsedMs = useStore((state) => state.elapsedMs);
  const hazardCount = useStore((state) => state.sessionHazardCount);
  const warnings =
    Math.max(hazardCount, log.hazards.length) +
    (log.restoredHazardCount ?? 0) +
    log.chatters.length;
  return (
    <details className={styles.activity} data-testid="session-activity">
      <summary className={styles.summary} data-testid="activity-toggle">
        <span className={styles.label}>
          {JA.session.log}（{log.lines.length}）
        </span>
        <span className={styles.time}>
          {JA.session.elapsed} <span data-testid="elapsed">{formatElapsed(elapsedMs)}</span>
        </span>
        {warnings > 0 && (
          <span className={styles.warning} data-testid="activity-warning-count">
            警告 {warnings}
          </span>
        )}
        <span className={styles.expand} aria-hidden="true">
          開く
        </span>
        <span className={styles.collapse} aria-hidden="true">
          閉じる
        </span>
      </summary>
      <div className={styles.body}>
        <LogPanel {...log} />
        <ElapsedTimer limit={limit} showValue={false} />
      </div>
    </details>
  );
}
