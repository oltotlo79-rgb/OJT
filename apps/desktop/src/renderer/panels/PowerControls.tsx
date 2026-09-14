import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * 電源操作（ブレーカ → 電源スイッチ）。設計仕様 §5.3.5 / §8.2。
 * 逆手順でも操作は通る（練習は中断しない）。手順違反はエンジンが危険操作として記録する。
 */

/** ブレーカ・電源スイッチ・保護復帰のボタン。 */
export function PowerControls({
  breakerOn,
  switchOn,
  powered,
  tripped,
  onBreaker,
  onSwitch,
  onResetTrip,
}: {
  breakerOn: boolean;
  switchOn: boolean;
  powered: boolean;
  tripped: boolean;
  onBreaker: (on: boolean) => void;
  onSwitch: (on: boolean) => void;
  onResetTrip: () => void;
}): JSX.Element {
  return (
    <div className={`${styles.toolGroup} ${styles.power}`}>
      <span
        className={`${styles.led} ${tripped ? styles.ledTrip : powered ? styles.ledOn : ''}`}
        aria-label={powered ? JA.session.powered : JA.session.unpowered}
      />
      <button
        type="button"
        aria-pressed={breakerOn}
        onClick={() => {
          onBreaker(!breakerOn);
        }}
      >
        {JA.session.breaker}
      </button>
      <button
        type="button"
        aria-pressed={switchOn}
        onClick={() => {
          onSwitch(!switchOn);
        }}
      >
        {JA.session.switch}
      </button>
      {tripped ? (
        <button type="button" onClick={onResetTrip}>
          {JA.session.resetTrip}
        </button>
      ) : null}
    </div>
  );
}
