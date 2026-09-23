import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA, mistakeCountText } from '../i18n/ja.js';
import styles from './warning.module.css';

/**
 * 危険操作の警告バナー。設計仕様 §5.6 / §13 / §16 Phase 2 受入基準④。
 *
 * トースト（§8.2）ではなく画面上部の帯にする。危険操作は「やってしまったこと」であり、
 * 右下に4秒だけ出て消えると気づかないまま回数が積み上がる。回数は**合否に影響しない**
 * （§17.2 #3）が、訓練者がその場で「いま危ないことをした」と分かる必要がある。
 *
 * 表示は6秒で自動的に畳む（`App` の間引きタイマが `dismissHazard(Date.now())` を呼ぶ）。
 * 回数は「今回の分 ＋ 作業ファイルから復元した分」（§12.3 / §5.6）。
 */
export function WarningBanner(): JSX.Element | null {
  const banner = useStore((s) => s.hazardBanner);
  const count = useStore((s) => Math.max(s.sessionHazardCount, s.hazards.length));
  const restored = useStore((s) => s.restoredHazardCount);
  if (banner === undefined) return null;
  return (
    <div className={styles.warnBanner} role="alert" data-testid="hazard-banner">
      <span className={styles.warnKind}>{JA.hazard[banner.kind]}</span>
      <span>{banner.detail}</span>
      <span className={styles.warnSpacer} />
      <span data-testid="mistake-count">{mistakeCountText(count + restored)}</span>
      <button
        type="button"
        data-testid="hazard-dismiss"
        onClick={() => {
          useStore.getState().dismissHazard();
        }}
      >
        {JA.session.warnDismiss}
      </button>
    </div>
  );
}
