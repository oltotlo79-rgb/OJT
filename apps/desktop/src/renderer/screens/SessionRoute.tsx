import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { InspectPartsSession } from './InspectPartsSession.js';
import { InspectRepairSession } from './InspectRepairSession.js';
import { Session } from './Session.js';
import styles from './screens.module.css';

/**
 * セッション画面の振り分け。設計仕様 §12.1。
 * 課題のモードで画面を選ぶ。モードごとに右パネルの中身も操作の意味（3Dクリック＝配線／
 * プローブ／指摘）も違うので、1画面に条件分岐を積むのではなく画面そのものを分ける。
 *
 * どのモードにも当てはまらない（＝画面を用意していない）課題は行き止まりにしないよう、
 * 課題を捨てて一覧へ戻る導線を出す（`Session` の空表示と同じ作り）。
 */
export function SessionRoute(): JSX.Element {
  const mode = useStore((s) => s.problem?.mode);
  switch (mode) {
    case 'assemble':
      return <Session />;
    case 'inspect-parts':
      return <InspectPartsSession />;
    case 'inspect-repair':
      return <InspectRepairSession />;
    default:
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
}
