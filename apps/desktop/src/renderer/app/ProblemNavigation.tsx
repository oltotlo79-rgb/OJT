import type { JSX } from 'react';
import { useStore } from './store.js';
import { ConfirmDialog } from './ConfirmDialog.js';
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
  return (
    <ConfirmDialog
      testId="problem-change-confirm"
      titleId="problem-change-title"
      onCancel={() => {
        if (!busy) cancelProblemChange();
      }}
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
        <button type="button" disabled={busy} onClick={cancelProblemChange} data-dialog-autofocus>
          取消
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </ConfirmDialog>
  );
}

export function ProblemChangeDialog(): JSX.Element | null {
  const pending = useProblemNavigation((s) => s.pending);
  return pending === undefined ? null : <ChangeDialog />;
}
