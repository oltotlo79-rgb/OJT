import type { TimeLimit } from '@ojt/content';
import type { ComponentProps, JSX } from 'react';
import { useStore } from '../app/store.js';
import { formatElapsed } from '../../worker/runtime.js';
import { JA } from '../i18n/ja.js';
import { AutosaveStatus } from './AutosaveStatus.js';
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
    /*
     * 自動保存の状態は帯の右に並べる（v2.1.0 Task 2）。以前は画面の右下に固定して重ねていたので、
     * 右の欄のボタンを覆っていた。`<summary>` の中に置くと、ボタン（失敗時の「再試行」）が
     * 帯のボタンの子になって読み上げから外れる（ARIA の button は子を表示用に扱う）ので、外に置く。
     */
    <div className={styles.row} data-testid="session-activity-row">
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
      <div className={styles.saveState}>
        <AutosaveStatus />
      </div>
    </div>
  );
}
