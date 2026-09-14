import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { ResultView } from '../result/ResultView.js';
import styles from './screens.module.css';

/**
 * 結果画面のルート。設計仕様 §8.3 / §12.1。
 * 判定結果が無いのに開かれた場合は課題一覧へ戻す導線だけを出す。
 */

/** 結果画面。 */
export function Result(): JSX.Element {
  const problem = useStore((s) => s.problem);
  const judge = useStore((s) => s.judge);
  const setRoute = useStore((s) => s.setRoute);
  const resetSession = useStore((s) => s.resetSession);

  if (problem === undefined || judge === undefined) {
    return (
      <div className={styles.center}>
        <p>判定結果がありません。</p>
        <button
          type="button"
          onClick={() => {
            setRoute('list');
          }}
        >
          課題一覧へ
        </button>
      </div>
    );
  }

  return (
    <ResultView
      problem={problem}
      result={judge}
      onRetry={() => {
        resetSession();
      }}
      onBackToList={() => {
        setRoute('list');
      }}
    />
  );
}
