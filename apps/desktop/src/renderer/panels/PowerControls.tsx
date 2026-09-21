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
  /*
   * 次に押す1つを強調する（UXレビュー #10「①ブレーカ→②電源スイッチ」）。
   * 保護動作中（`tripped`）は復帰の手順が別にあるので、ここでは強調しない。
   */
  const nextStep = tripped ? undefined : !breakerOn ? 'breaker' : !switchOn ? 'switch' : undefined;
  return (
    <div className={`${styles.toolGroup} ${styles.power}`}>
      <span className={`${styles.powerState} ${tripped ? styles.tripState : ''}`} role="status">
        <span aria-hidden="true">{tripped ? '▲' : powered ? '●' : '○'}</span>
        {tripped ? JA.session.tripState : powered ? JA.session.powered : JA.session.unpowered}
      </span>
      <button
        type="button"
        className={nextStep === 'breaker' ? styles.nextStep : undefined}
        aria-pressed={breakerOn}
        data-testid="power-breaker"
        onClick={() => {
          onBreaker(!breakerOn);
        }}
      >
        {JA.powerStep.breaker}
      </button>
      <button
        type="button"
        className={nextStep === 'switch' ? styles.nextStep : undefined}
        aria-pressed={switchOn}
        data-testid="power-switch"
        onClick={() => {
          onSwitch(!switchOn);
        }}
      >
        {JA.powerStep.switch}
      </button>
      {tripped ? (
        <button type="button" onClick={onResetTrip}>
          {JA.session.resetTrip}
        </button>
      ) : null}
    </div>
  );
}
