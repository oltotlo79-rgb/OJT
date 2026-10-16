import type { JSX, MouseEvent } from 'react';
import { flushAutosave, useAutosaveStatus } from '../session/autosave.js';
import styles from './autosave-status.module.css';

/**
 * 自動保存の状態（「自動保存済み 12:34:56」など）。v2.1.0 Task 2（点検 U2）。
 *
 * 以前は `App.tsx` が画面の右下に `position: fixed` で重ねていたので、右の欄の一番下にある
 * ボタン（C1 のテスターの「導通」、マークシートの選択肢、C2 の「赤プローブ」など）を覆っていた。
 * いまは**欄の中の要素**として、練習画面の下の帯（`SessionActivity` の「操作ログ・経過時間」）と
 * 結果画面の下の操作ボタンの帯（`ResultShell`）に置く。どちらも帯の高さぶんの場所を自分で持つので、
 * 何にも重ならない。
 */
export function AutosaveStatus(): JSX.Element {
  const autosave = useAutosaveStatus();
  /**
   * 帯は `<details>` の `<summary>` なので、中のボタンを押すと既定では帯が開閉してしまう。
   * 再試行のボタンだけは帯の開閉を起こさない。
   */
  const retry = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    void flushAutosave();
  };
  return (
    <span role="status" data-testid="autosave-status" className={styles.status}>
      {autosave.state === 'saving' ? (
        '自動保存中…'
      ) : autosave.state === 'pending' ? (
        '自動保存待ち'
      ) : autosave.state === 'failed' ? (
        <button type="button" className={styles.retry} title={autosave.message} onClick={retry}>
          自動保存失敗 — 再試行
        </button>
      ) : autosave.state === 'saved' ? (
        `自動保存済み ${new Date(autosave.at!).toLocaleTimeString('ja-JP')}`
      ) : (
        '自動保存を準備しています'
      )}
    </span>
  );
}
