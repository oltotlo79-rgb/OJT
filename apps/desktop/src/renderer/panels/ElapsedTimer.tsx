import type { TimeLimit } from '@ojt/content';
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { formatElapsed } from '../../worker/runtime.js';
import { JA, minutesLabel } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * 経過時間と時間制限の目印。設計仕様 §8.1 / §12。
 * 標準時間・打切り時間は**目盛の印として見せるだけ**で、到達しても強制終了はしない
 * （練習を中断しない方針。決定事項#12 と同じ考え方）。
 */

/** 目盛の全長（打切り時間の 1.2 倍まで描く）。 */
export const SCALE_FACTOR = 1.2;

/** 経過時間[ms]と時間制限から、バーの塗り率と目印位置（0〜1）を求める純粋関数。 */
export function elapsedScale(
  elapsedMs: number,
  limit: TimeLimit,
): { fill: number; standard: number; cutoff: number } {
  const fullMs = limit.cutoffMin * 60_000 * SCALE_FACTOR;
  return {
    fill: Math.min(1, Math.max(0, elapsedMs / fullMs)),
    standard: (limit.standardMin * 60_000) / fullMs,
    cutoff: (limit.cutoffMin * 60_000) / fullMs,
  };
}

/**
 * 経過時間の表示。
 *
 * 経過時間は**この部品が自分でストアから受け取る**。0.2秒ごとに進む値をセッション画面が
 * 受けると、3Dビューポートを含む画面全体が毎秒5回再描画されてしまうため（§15）。
 */
export function ElapsedTimer({ limit }: { limit: TimeLimit }): JSX.Element {
  const elapsedMs = useStore((s) => s.elapsedMs);
  const scale = elapsedScale(elapsedMs, limit);
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.elapsed}</h2>
      <p className={styles.timeRemaining} role="status" aria-live="off">
        {elapsedMs >= limit.cutoffMin * 60_000
          ? JA.session.cutoffNotice
          : `${JA.session.remainingTime} ${formatElapsed(limit.cutoffMin * 60_000 - elapsedMs)}`}
      </p>
      <div className={styles.elapsed}>
        <span className={styles.elapsedValue} data-testid="elapsed">
          {formatElapsed(elapsedMs)}
        </span>
        <div className={styles.elapsedBar}>
          <div className={styles.elapsedFill} style={{ width: `${scale.fill * 100}%` }} />
          <div
            className={`${styles.elapsedMark} ${styles.markStandard}`}
            style={{ left: `${scale.standard * 100}%` }}
            title={`${JA.result.standardMark} ${minutesLabel(limit.standardMin)}`}
          />
          <div
            className={`${styles.elapsedMark} ${styles.markCutoff}`}
            style={{ left: `${scale.cutoff * 100}%` }}
            title={`${JA.result.cutoffMark} ${minutesLabel(limit.cutoffMin)}`}
          />
        </div>
        {/*
          UXレビュー #25: 目盛の色（緑＝標準時間／赤＝打切り）が何を表すか、色だけに頼らず
          文字でも示す凡例。
        */}
        <span className={styles.elapsedLegend} data-testid="elapsed-legend">
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.markStandard}`} aria-hidden="true" />
            {JA.result.standardMark} {minutesLabel(limit.standardMin)}
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.markCutoff}`} aria-hidden="true" />
            {JA.result.cutoffMark} {minutesLabel(limit.cutoffMin)}
          </span>
        </span>
      </div>
    </section>
  );
}
