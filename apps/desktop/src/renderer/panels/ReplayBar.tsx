import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { ReplayStep } from '../session/replay.js';
import styles from './replay-bar.module.css';

export function ReplayBar({
  step,
  busy,
  onStep,
  onStop,
}: {
  step: ReplayStep;
  busy: boolean;
  onStep: (index: number) => void;
  onStop: () => void;
}): JSX.Element {
  const move = (index: number): void => {
    if (!busy && index >= 0 && index < step.total) onStep(index);
  };
  return (
    <section
      className={styles.bar}
      data-testid="replay-bar"
      aria-label={JA.replay.title}
      aria-busy={busy}
    >
      <div className={styles.controls}>
        <strong>{JA.replay.title}</strong>
        <span className={styles.count}>{JA.replay.count(step.index, step.total)}</span>
        <button
          type="button"
          data-testid="replay-prev"
          aria-disabled={busy || step.index === 1}
          title={step.index === 1 ? JA.replay.first : undefined}
          onClick={() => {
            move(step.index - 2);
          }}
        >
          ← {JA.replay.previous}
        </button>
        <button
          type="button"
          data-testid="replay-next"
          aria-disabled={busy || step.index === step.total}
          title={step.index === step.total ? JA.replay.last : undefined}
          onClick={() => {
            move(step.index);
          }}
        >
          {JA.replay.next} →
        </button>
        <button
          type="button"
          data-testid="replay-restart"
          aria-disabled={busy}
          onClick={() => {
            move(0);
          }}
        >
          {JA.replay.restart}
        </button>
        <button type="button" data-testid="replay-stop" className={styles.stop} onClick={onStop}>
          {JA.replay.stop}
        </button>
      </div>
      <div className={styles.step} aria-live="polite" role="status">
        <span className={styles.time}>
          {JA.replay.seconds(step.atMs)}–{JA.replay.seconds(step.toMs)}
        </span>
        <strong>{busy ? JA.replay.loading : step.action}</strong>
        <p>
          <span>{JA.replay.expected}：</span>
          {step.expect}
        </p>
        {step.mismatched ? (
          <p className={styles.mismatch} data-testid="replay-mismatch">
            {step.mismatchNote}
          </p>
        ) : null}
      </div>
      <p className={styles.note}>
        {JA.replay.frame} {JA.replay.readonly}
      </p>
    </section>
  );
}
