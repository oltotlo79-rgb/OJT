import type { Mismatch } from '@ojt/circuit-sim';
import type { StaticCheckResult, WiringSuspect } from '@ojt/content';
import {
  JA,
  outputSignalLabel,
  verdictCheckText,
  verdictFixFirstText,
  verdictMismatchText,
  type VerdictMismatchKind,
} from '../i18n/ja.js';
import { timeReadout } from '../panels/chart-scale.js';

/**
 * 不合格の結果画面に出す「まず何を直すか」の1行。指摘 UX-13 / PR-03（Phase 7 Task 25）。
 *
 * これまでの結果画面は、差分2行・静的チェック6行・疑わしい配線n行を同時に見せたうえで
 * 操作は「もう一度／課題一覧へ」の2択しか無く、**次の一手が決まらなかった**。
 * ここでは合否バッジの隣に出す1行を組み立てる。
 *
 * 組み立て方は「何が起きたか（症状）」＋「まずどこを直すか（次の一手）」の2文:
 *
 * - 症状は **(1) 静的チェックのエラー → (2) 最初の差分** の順に選ぶ。静的チェックが落ちている
 *   ときは配線の決まりそのものが守れていないので、波形の食い違いより先に読ませる。
 * - 次の一手は**疑わしい配線の先頭**（`wiringSuspects()` の1件目）。0件なら
 *   「配線の違いは見つかりませんでした。部品の設定や操作の順序を見直してください」に落とす
 *   （`JA.result.noSuspect`。一覧側と1語1句そろえる）。
 * - 疑いそのものを渡されないモード（C1/C2/D は配線の差分を出さない）では次の一手の文を足さない。
 *
 * `source` は「その1行を決めたもの」で、優先順位 (1) 静的チェック → (2) 疑わしい配線 →
 * (3) 差分 をそのまま表す（画面側の目印と、Task 41 の1枚書き出しが読む）。
 *
 * React も three も使わない純関数なので Vitest だけで全分岐を確かめられる（§14.2）。
 * **署名は変えない**（Task 41 の1枚書き出しが同じ関数を呼ぶ）。
 */

/** その1行を決めたもの。 */
export type VerdictSource = 'passed' | 'static-check' | 'suspect' | 'mismatch' | 'none';

/** 1行要約。 */
export interface VerdictSummary {
  /** その1行を決めたもの（優先順位の結果）。 */
  readonly source: VerdictSource;
  /** 画面にそのまま出せる1行（空文字なら出すものが無い）。 */
  readonly text: string;
  /** 「盤で直す」で開く疑い（疑いが1件も無ければ `undefined`）。 */
  readonly fix: WiringSuspect | undefined;
}

/**
 * 1行要約が読む判定結果の形。`JudgeResult`（モードB）と `JudgePlcResult`（モードD）の
 * **どちらも**そのまま渡せるだけの3項目に絞ってある（判定の型が増えても署名を変えない）。
 */
export interface VerdictInput {
  readonly passed: boolean;
  readonly staticChecks: readonly StaticCheckResult[];
  readonly mismatches: readonly Mismatch[];
}

/** 差分1件の言い回しの種別（期待していた向きで「点かない」「消えない」を分ける）。 */
export function mismatchKind(mismatch: Mismatch): VerdictMismatchKind {
  if (mismatch.reason === 'unknown-signal') return 'unknown';
  if (mismatch.reason === 'extra') return 'extra';
  if (mismatch.reason === 'timing') return 'timing';
  // `missing` / `value` は「期待していた状態」で言い回しを変える（点くはずだった／消えるはずだった）
  const expected = mismatch.expected;
  const on =
    typeof expected === 'boolean' ? expected : typeof expected === 'number' && expected > 0;
  return on ? 'on' : 'off';
}

/**
 * 差分1件の1文（`白ランプ（PL1）が 0.52 s に点きませんでした。`）。
 * `extra` のときの `tMs` は訓練者側の時刻（`Mismatch` の約束）なので、そのまま読んでよい。
 */
export function mismatchLine(mismatch: Mismatch): string {
  return verdictMismatchText(
    outputSignalLabel(mismatch.signal),
    timeReadout(mismatch.tMs),
    mismatchKind(mismatch),
  );
}

/** 落ちた静的チェックの1文（`線色の決まりが守れていません（…）`）。 */
function checkLine(check: StaticCheckResult): string {
  return verdictCheckText(JA.staticCheck[check.id], check.details[0] ?? check.message);
}

/**
 * 不合格の「まず何を直すか」の1行を組み立てる。指摘 UX-13 / PR-03。
 *
 * @param result 判定結果（モードB・モードDのどちらでもよい）
 * @param suspects 疑わしい配線（**モードBだけ**。渡さないモードでは次の一手の文を足さない）
 */
export function verdictSummary(
  result: VerdictInput,
  suspects?: readonly WiringSuspect[],
): VerdictSummary {
  const first = suspects?.[0];
  if (result.passed) {
    return { source: 'passed', text: JA.result.summaryPassed, fix: first };
  }
  const failedCheck = result.staticChecks.find((check) => !check.ok);
  const firstMismatch = result.mismatches[0];
  // 症状（静的チェックのエラーが最優先。無ければ最初の差分）
  const symptom =
    failedCheck !== undefined
      ? checkLine(failedCheck)
      : firstMismatch !== undefined
        ? mismatchLine(firstMismatch)
        : '';
  // 次の一手（疑いの先頭。疑いを渡されたのに0件なら配線以外へ誘導する）
  const next =
    suspects === undefined
      ? ''
      : first === undefined
        ? JA.result.noSuspect
        : verdictFixFirstText(first.message);
  const source: VerdictSource =
    failedCheck !== undefined
      ? 'static-check'
      : first !== undefined
        ? 'suspect'
        : firstMismatch !== undefined
          ? 'mismatch'
          : 'none';
  return {
    source,
    text: [symptom, next].filter((part) => part !== '').join(' '),
    fix: first,
  };
}
