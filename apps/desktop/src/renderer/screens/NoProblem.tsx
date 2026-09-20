import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import styles from './screens.module.css';

/**
 * 課題が選ばれていないときのセッション画面。設計仕様 §12.1（指摘 UI-05）。
 *
 * 4つのセッション画面が同じ12行を写していた。専用画面の絞り込みに漏れた課題
 * （モードBの画面にC1の課題が届いた、など）でも行き止まりにせず、課題を捨てて
 * 一覧へ戻る導線だけを出す（`Result` の「判定結果がありません」と同じ作り）。§13 #5
 */
export function NoProblem(): JSX.Element {
  return (
    <div className={styles.center}>
      <p>{JA.session.noProblem}</p>
      <button
        type="button"
        onClick={() => {
          useStore.getState().abandonSession();
        }}
      >
        {JA.result.toList}
      </button>
    </div>
  );
}
