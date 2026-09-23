import { useEffect, useRef, type JSX } from 'react';
import { useStore } from './store.js';
import { pushModalLayer } from '../session/interaction.js';
import {
  cancelProblemChange,
  confirmProblemChange,
  requestRestartProblem,
  resumeCurrentProblem,
  useProblemNavigation,
} from '../session/problem-navigation.js';
import styles from './problem-navigation.module.css';

export function ResumeWorkCard(): JSX.Element | null {
  const problem = useStore((s) => s.problem);
  const session = useStore((s) => s.session);
  if (problem === undefined || session === undefined) return null;
  return (
    <section className={styles.card} aria-label="作業中の課題" data-testid="current-work">
      <div>
        <strong>作業中：{problem.title}</strong>
        <p>配線・解答・測定記録を残したまま再開できます。</p>
      </div>
      <button type="button" data-testid="resume-current-work" onClick={resumeCurrentProblem}>
        続きから再開
      </button>
      <button type="button" onClick={requestRestartProblem}>
        最初からやり直す…
      </button>
    </section>
  );
}

function ChangeDialog(): JSX.Element {
  const { pending, busy, message } = useProblemNavigation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const target = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const layer = pushModalLayer();
    target?.showModal();
    return () => {
      target?.close();
      layer.release();
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-testid="problem-change-confirm"
      aria-labelledby="problem-change-title"
      onCancel={(event) => {
        event.preventDefault();
        cancelProblemChange();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id="problem-change-title">
        {pending?.restart ? 'この課題を最初からやり直しますか？' : '別の課題へ移りますか？'}
      </h2>
      <p>現在の作業：{pending?.from.title}</p>
      {!pending?.restart && <p>次の課題：{pending?.problem.title}</p>}
      <p>
        現在の配線・解答・測定記録と自動保存は置き換わります。残す場合は作業ファイルを保存してください。
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void confirmProblemChange(true);
          }}
        >
          {busy ? '保存中…' : '保存して進む'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void confirmProblemChange(false);
          }}
        >
          保存せず進む
        </button>
        <button type="button" disabled={busy} onClick={cancelProblemChange} autoFocus>
          取消
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </dialog>
  );
}

export function ProblemChangeDialog(): JSX.Element | null {
  const pending = useProblemNavigation((s) => s.pending);
  return pending === undefined ? null : <ChangeDialog />;
}
