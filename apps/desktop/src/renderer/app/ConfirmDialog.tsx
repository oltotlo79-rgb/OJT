import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { pushModalLayer } from '../session/interaction.js';
import styles from './problem-navigation.module.css';

/** 確認操作の間は背景の操作を止め、閉じたら呼び出した場所へ戻す。 */
export function ConfirmDialog({
  titleId,
  testId,
  onCancel,
  children,
}: {
  titleId: string;
  testId: string;
  onCancel: () => void;
  children: ReactNode;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement);
  useEffect(() => {
    const target = dialog.current;
    const previous = opener.current;
    const layer = pushModalLayer();
    target?.showModal();
    // ReactのautoFocusは、まだ閉じているdialogのマウント時には効かない。
    target?.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus();
    return () => {
      target?.close();
      layer.release();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-testid={testId}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </dialog>
  );
}
