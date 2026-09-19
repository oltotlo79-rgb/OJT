import type { JSX, ReactNode } from 'react';
import styles from './ladder.module.css';

/**
 * 右の折りたたみ列の1枠。設計仕様 §10.6 / §10.7。
 *
 * 2026-09-19 UXレビュー #27: モニタ・I/O割付・デバイスコメント・キー割当の4枠が
 * それぞれ `max-height: 200px` のスクロールを持っていたため、209px の列に縦スクロールバーが
 * 4本並び、どれも数行ずつしか読めなかった。4枠を `<details>` の開閉に置き換え、
 * スクロールは列に1本（`.workspaceSide`）だけにする。
 */
export function SidePanel({
  title,
  testId,
  label,
  open = false,
  children,
}: {
  /** 見出し（`<summary>` に出す文字）。 */
  title: string;
  /** 枠の `data-testid`。開閉部には `-details` / `-summary` を足した名前が付く。 */
  testId: string;
  /** 読み上げ用の名前。既定は `title`。 */
  label?: string;
  /**
   * 既定で開いておくか。作業中いつでも見たい枠（モニタ・I/O割付）だけ `true` にする。
   * 開閉の状態は利用者が変えられるので、ここは**初期値**でしかない。
   */
  open?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={styles.side} aria-label={label ?? title} data-testid={testId}>
      <details className={styles.sideGroup} open={open} data-testid={`${testId}-details`}>
        <summary className={styles.sideSummary} data-testid={`${testId}-summary`}>
          <h2 className={styles.sideTitle}>{title}</h2>
        </summary>
        <div className={styles.sideBody}>{children}</div>
      </details>
    </section>
  );
}
