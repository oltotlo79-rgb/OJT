import type { JSX, ReactNode } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { useStore } from '../app/store.js';
import { elapsedSummaryText, hintCountText, JA } from '../i18n/ja.js';
import styles from './result.module.css';

/**
 * 4つの結果画面の外殻。設計仕様 §8.3（指摘 UI-13）。
 *
 * 合否の見出しと下端の操作バーは4画面とも同じなので、ここ1本にする。モードDだけ
 * `.stickyActions` を付け忘れて下端バーの境目が消えていた（UI-13）——外殻を共通にすれば、
 * 付け忘れはもう起こらない。中身（波形・差分・マークシートなど）は `children` に来る。
 *
 * Phase 7 Task 25（指摘 UX-13 / PR-02 / PR-03）で2つ増えた:
 * **合否バッジの隣の1行要約**（`summary`）と、**下端バーの「盤で直す」**（`extraAction`）。
 * 「ヒントを使った回数」は4画面とも同じ出し方なので、外殻がストアから直に読む
 * （4つの結果画面が同じ3行を写さないため。回路図ヒントの開閉回数と同じ扱い。指摘 PR-02）。
 */
export function ResultShell({
  title,
  passed,
  elapsedMs,
  timeLimit,
  verdictBig = false,
  forbidden = false,
  headerExtra,
  summary,
  extraAction,
  onRetry,
  onBackToList,
  children,
}: {
  /** 課題の題名（見出しに「判定結果: 〜」の形で出る）。 */
  title: string;
  passed: boolean;
  /** 所要時間[ms]。 */
  elapsedMs: number;
  /** 標準時間・打切り時間[分]（対比の1行を組み立てる）。§8.3 */
  timeLimit: { standardMin: number; cutoffMin: number };
  /** 合否を特大にする（モードD。2026-09-19 の利用者決定）。 */
  verdictBig?: boolean;
  /** 禁則回路（チャタリング）の警告を出すか。§8.3 */
  forbidden?: boolean;
  /** 見出しに足す表示（C1の正解数・C2の回路図ヒント開閉回数）。 */
  headerExtra?: ReactNode;
  /**
   * 合否バッジの隣に出す1行要約（指摘 UX-13 / PR-03）。
   * 中身は `result/verdict-summary.ts` が組み立てる。空なら出さない。
   */
  summary?: string | undefined;
  /** 下端バーの左端に足す操作（モードBの「盤で直す」）。指摘 PR-03 */
  extraAction?: ReactNode;
  onRetry: () => void;
  onBackToList: () => void;
  children: ReactNode;
}): JSX.Element {
  // 開いたヒントの段数（4画面とも同じ出し方なので外殻が読む）。指摘 PR-02
  const hintStage = useStore((state) => state.hintStage);
  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <div className={styles.header}>
          {/* 合否は画面を開いた瞬間に読み上げてほしい情報なので、支援技術にも伝える（§8.3） */}
          <span
            className={`${styles.verdict} ${verdictBig ? `${styles.verdictBig} ` : ''}${
              passed ? styles.passed : styles.failed
            }`}
            data-testid="verdict"
            role="status"
            aria-live="polite"
          >
            {passed ? JA.result.passed : JA.result.failed}
          </span>
          <h1 className={styles.title}>
            {JA.result.title}: {title}
          </h1>
          {headerExtra}
          {/* ヒントを何段まで開いたか（指摘 PR-02）。開いていなければ出さない。 */}
          {hintStage > 0 ? (
            <span data-testid="result-hints">{hintCountText(hintStage)}</span>
          ) : null}
          <span data-testid="result-elapsed">
            {JA.result.elapsed} {formatElapsed(elapsedMs)}（
            {elapsedSummaryText(elapsedMs, timeLimit.standardMin, timeLimit.cutoffMin)}）
          </span>
        </div>

        {/*
          「まず何を直すか」の1行（指摘 UX-13 / PR-03）。合否のすぐ下に置き、
          差分一覧・静的チェック・疑わしい配線のどれを先に読めばよいかを決めてやる。
        */}
        {summary === undefined || summary === '' ? null : (
          <p className={styles.summary} data-testid="verdict-summary" role="status">
            <span className={styles.summaryLabel}>{JA.result.summary}</span>
            {summary}
          </p>
        )}

        {forbidden ? (
          <p className={styles.forbidden} data-testid="forbidden-warning">
            {JA.result.forbidden}
          </p>
        ) : null}

        {children}
      </div>

      {/* 下端の操作バー（4画面とも同じ。`.stickyActions` の付け忘れをここで断つ）。UI-13 */}
      <div className={`${styles.actions} ${styles.stickyActions}`}>
        {extraAction}
        <button type="button" onClick={onRetry}>
          {JA.result.retry}
        </button>
        <button type="button" onClick={onBackToList}>
          {JA.result.toList}
        </button>
      </div>
    </div>
  );
}
