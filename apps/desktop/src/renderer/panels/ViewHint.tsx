import { useState, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './view-hint.module.css';

/**
 * 視点操作の早見表（Blender 風の割り当て）。§12.2
 *
 * UXレビュー #14: 常時表示だと盤の手前（下辺）を覆い、3Dの押ボタンを隠していた
 * （`Session.tsx` / `InspectPartsSession.tsx` / `InspectRepairSession.tsx` / `PlcSession.tsx`
 * の4画面が同じものを使う）。既定は「?」ボタンだけにして、押したときだけ早見表を出す。
 */
export function ViewHint(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        data-testid="view-hint-toggle"
        aria-expanded={open}
        aria-label={JA.viewHintToggle}
        onClick={() => {
          setOpen((next) => !next);
        }}
      >
        ?
      </button>
      {open ? (
        <div className={styles.hint} data-testid="view-hint">
          {JA.session.viewHint}
        </div>
      ) : null}
    </div>
  );
}
