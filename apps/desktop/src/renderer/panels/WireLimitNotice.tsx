import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import styles from './warning.module.css';

/**
 * 3本目の配線を止めたときの注意文。2026-09-26 利用者指示
 * 「3D図で同一の端子からは2本までの配線しかできないようにして。3本目を配線しようとしたら注意文を出して」。
 *
 * 危険操作の帯（`WarningBanner`）と同じく3Dの上に重ねるが、こちらは**やってしまったこと**では
 * なく**止めたこと**なので回数は数えない。4秒で消えるトーストでは読み切れない長さ（理由と
 * 代わりの方法）なので、閉じるか次の電線を張るまで残す。
 */
export function WireLimitNotice(): JSX.Element | null {
  const label = useStore((s) => s.wireLimitNotice);
  if (label === undefined) return null;
  return (
    <div className={styles.limitNotice} role="alert" data-testid="wire-limit-notice">
      <p className={styles.limitTitle}>{JA.wireLimitNotice.title}</p>
      <p>{JA.wireLimitNotice.body(label)}</p>
      <p className={styles.limitAdvice}>{JA.wireLimitNotice.advice}</p>
      <button
        type="button"
        data-testid="wire-limit-close"
        onClick={() => {
          useStore.getState().setWireLimitNotice(undefined);
        }}
      >
        {JA.wireLimitNotice.close}
      </button>
    </div>
  );
}
