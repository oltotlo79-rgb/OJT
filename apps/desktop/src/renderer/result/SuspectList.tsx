import type { WiringSuspect } from '@ojt/content';
import type { JSX } from 'react';
import { JA, suspectMoreText } from '../i18n/ja.js';
import styles from './result.module.css';

/**
 * 疑わしい配線の一覧。UXレビュー #28（2026-09-19）。§8.3
 *
 * 判定は波形の食い違いしか返さないので、訓練者は「どこを直せばよいか」が分からない。
 * `wiringSuspects()`（模範回路との節点分割の差）を並べ、「盤で見る」でその端子と電線を
 * 3Dで光らせる（決定表#11）。
 */
export function SuspectList({
  suspects,
  truncated = 0,
  onShowOnBoard,
}: {
  suspects: readonly WiringSuspect[];
  /** 表示上限で切り捨てた件数（0 なら切り捨て無し）。決定表#27 */
  truncated?: number;
  onShowOnBoard: (suspect: WiringSuspect) => void;
}): JSX.Element {
  return (
    <div className={styles.card} data-testid="suspect-list">
      <h2>
        {JA.result.suspects}（{suspects.length}）
      </h2>
      {suspects.length === 0 ? (
        <p data-testid="no-suspect">{JA.result.noSuspect}</p>
      ) : (
        <ul className={styles.suspectList}>
          {suspects.map((suspect) => (
            <li key={`${suspect.kind}:${suspect.terminals.join('-')}`} className={styles.suspect}>
              <span
                className={suspect.kind === 'missing' ? styles.suspectMissing : styles.suspectExtra}
              >
                {suspect.kind === 'missing' ? JA.result.suspectMissing : JA.result.suspectExtra}
              </span>
              <span className={styles.suspectText}>{suspect.message}</span>
              <button
                type="button"
                className={styles.suspectButton}
                onClick={() => {
                  onShowOnBoard(suspect);
                }}
              >
                {JA.result.showOnBoard}
              </button>
            </li>
          ))}
        </ul>
      )}
      {truncated > 0 ? (
        <p className={styles.suspectMore} data-testid="suspect-more">
          {suspectMoreText(truncated)}
        </p>
      ) : null}
      {/*
        接点の組の違いも「不足」「余分」として出る（決定表#9b）。正規化しないと決めたので、
        **一覧が出ているあいだは必ず**この1行を添えて、訓練者が誤りだと思い込まないようにする。
      */}
      {suspects.length === 0 ? null : (
        <p className={styles.suspectNote} data-testid="suspect-note">
          {JA.result.suspectNote}
        </p>
      )}
    </div>
  );
}
