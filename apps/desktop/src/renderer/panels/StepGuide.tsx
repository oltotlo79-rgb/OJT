import type { JSX, ReactNode } from 'react';
import { JA } from '../i18n/ja.js';
import type { GuideStep } from '../session/step-guide.js';
import styles from './step-guide.module.css';

/**
 * 手順帯。設計仕様 §8.1（指摘 UI-05 / UI-07）。
 *
 * 「いまどの手順にいるのか」「次に何をすればよいのか」をボタンの見た目に頼らず文字で出す
 * （2026-09-19 の利用者決定）。4つのセッション画面と回路図エディタが同じ24行を写していたので、
 * markup も CSS もここ1本にする。手順の並びと現在地を決めるのは `session/step-guide.ts` の
 * 純関数で、この部品は**受け取ったものを描くだけ**である（決定表#7: 配線の中身＝合否には触れない）。
 */

/**
 * 目印（`data-testid`）の付け方。取扱説明書 設計 §6.3 / 決定表#22。
 *
 * 省くとモードB/C1/C2 の既定（`step-guide` / `step-<手順>` / `step-hint`）になる。
 * 機能一覧表（`docs/manual/coverage.json`）は `data-testid` と `testId` に書いた文字から
 * 作るので、**呼び出し側では必ずテンプレート文字列（バッククォート）で書く**こと。
 */
export interface StepGuideIds {
  /** 帯そのもの。 */
  readonly band: string;
  /** 手順1つぶん（`key` は `session/step-guide.ts` の手順キー）。 */
  readonly step: (key: string) => string;
  /** 案内の1行（省くと目印を付けない）。 */
  readonly hint?: string | undefined;
}

/** 手順の状態ごとの注記（`いつでも` はモードD専用の3つめの状態）。 */
function noteOf(state: GuideStep<string>['state']): string | undefined {
  if (state === 'done') return JA.stepGuide.done;
  if (state === 'current') return JA.stepGuide.current;
  if (state === 'anytime') return JA.plc.stepAnytime;
  return undefined;
}

/** 手順帯。 */
export function StepGuide({
  steps,
  hint,
  label = JA.stepGuide.label,
  testId,
  notes = true,
  actions,
  children,
}: {
  /** 手順の並びと現在地（`session/step-guide.ts` が組み立てる）。 */
  steps: readonly GuideStep<string>[];
  /** いま何をすればよいかの1行（無ければ出さない）。 */
  hint?: string | undefined;
  /** 手順一覧の `aria-label`。 */
  label?: string;
  /** 目印の付け方（省くとモードB/C1/C2 の既定）。 */
  testId?: StepGuideIds;
  /** 「済」「いまここ」の注記を出すか（回路図エディタの細い帯では出さない）。 */
  notes?: boolean;
  /** 移動できる手順だけを実際のボタンとして表示する。 */
  actions?: Readonly<Record<string, (() => void) | undefined>>;
  /** 帯に並べる追加の表示（モードDの状態チップ、回路図の分岐案内）。 */
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className={styles.guide} data-testid={testId?.band ?? `step-guide`}>
      <ol className={styles.list} aria-label={label}>
        {steps.map((step) => {
          const note = notes ? noteOf(step.state) : undefined;
          const action = actions?.[step.key];
          return (
            <li
              key={step.key}
              className={styles.step}
              data-state={step.state}
              data-testid={testId?.step(step.key) ?? `step-${step.key}`}
              {...(step.state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              {action === undefined ? (
                <>
                  <span className={styles.name}>{step.label}</span>
                  {note === undefined ? null : <span className={styles.note}>{note}</span>}
                </>
              ) : (
                <button type="button" className={styles.action} onClick={action}>
                  <span className={styles.name}>{step.label}</span>
                  {note === undefined ? null : <span className={styles.note}>{note}</span>}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {/* 追加の表示は案内の前に置く（案内は残り幅を埋める1行なので必ず最後にする） */}
      {children}
      {hint === undefined ? null : (
        <p className={styles.hint} data-testid={testId === undefined ? `step-hint` : testId.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
