import type { Mismatch } from '@ojt/circuit-sim';
import {
  BOARD_POWER_PREFIXES,
  type JudgePlcResult,
  type StaticCheckId,
  type StaticCheckResult,
} from '@ojt/content';
import { checkReasonText, JA, ladderErrorSummary, moreMismatchesText } from '../i18n/ja.js';
import { mismatchLine } from '../result/verdict-summary.js';

/**
 * モードDの判定結果を訓練者の言葉にする。設計仕様 §10.8 / 3A ハンドオフ注記 H-5 / 決定表#15c。
 *
 * 結果画面は「合否 → なぜそうなったか → 波形」の順で読ませる（2026-09-19 の利用者決定）。
 * その「なぜ」を組み立てるのがこのモジュールで、画面側（`PlcResult.tsx`）は並べるだけにする。
 */

/** 理由欄に並べる差分の上限（これを超えた分は件数でまとめ、差分一覧へ誘導する）。 */
const MAX_REASON_MISMATCHES = 3;

/** その指摘が「盤から取っている」ものか。接頭辞の表は `@ojt/content` の判定側と同じものを使う。 */
export function isBoardFedDetail(detail: string): boolean {
  return BOARD_POWER_PREFIXES.some((prefix) => detail.includes(prefix));
}

/**
 * `plcPowerIndependent` が落ちた理由を訓練者の言葉にする。3A H-5 / 決定表#15c。
 *
 * 構造化した原因コードで盤電源・未配線・短絡・接続先違いを区別する。
 * 旧形式の結果だけは `details` に出てくる端子IDの形で見分ける。
 * 正しい電源接続がライブ実行にも必要なことを添える。
 */
export function explainPowerCheck(check: StaticCheckResult): string[] {
  if (check.id !== 'plcPowerIndependent' || check.ok) return [];
  const lines: string[] = [];
  if (check.issues !== undefined && check.issues.length > 0) {
    const codes = new Set(check.issues.map((issue) => issue.code));
    if (codes.has('plc-power-board-power')) lines.push(JA.plc.powerFromBoard);
    if (codes.has('plc-power-missing')) lines.push(JA.plc.powerUnwired);
    if (codes.has('plc-power-same-net')) lines.push(JA.plc.powerShorted);
    if (codes.has('plc-power-wrong-source')) lines.push(JA.plc.powerWrongSource);
  } else {
    if (check.details.some((detail) => isBoardFedDetail(detail))) lines.push(JA.plc.powerFromBoard);
    if (check.details.some((detail) => !isBoardFedDetail(detail))) lines.push(JA.plc.powerUnwired);
  }
  // 指摘の中身が読めなくても、少なくとも1行は出す
  if (lines.length === 0) lines.push(JA.plc.advicePlcPowerIndependent);
  lines.push(JA.plc.powerSimNote);
  return lines;
}

/**
 * 落ちた静的チェックの直し方。9件すべてに用意する（Batch 4+5 レビュー M11）。
 * `plcPowerIndependent` はここでは短い助言だけを持つ（詳しい説明は `explainPowerCheck()` が
 * `plc-power-help` カードへ別に出すので、`failureReasons()` の1行に同じ文を重ねない）。
 */
const ADVICE: Record<StaticCheckId, string> = {
  wireColorRule: JA.plc.adviceWireColorRule,
  terminalLimit: JA.plc.adviceTerminalLimit,
  unusedParts: JA.plc.adviceUnusedParts,
  forbiddenCircuit: JA.plc.adviceForbiddenCircuit,
  coilPolarity: JA.plc.adviceCoilPolarity,
  powerSequence: JA.plc.advicePowerSequence,
  twoStage: JA.plc.adviceTwoStage,
  plcPowerIndependent: JA.plc.advicePlcPowerIndependent,
  ioAssignment: JA.plc.adviceIoAssignment,
};

/**
 * そのチェックの直し方。2026-09-19 の利用者決定「何をすればよいかまで書く」。
 * `@ojt/content` に見覚えのない `id` が来ても（型は締まっているが判定側の変更に画面が
 * 追従し損ねた場合に備え）汎用の1行へ落とす。
 */
export function checkAdvice(id: StaticCheckId): string {
  return ADVICE[id] ?? JA.plc.adviceGeneric;
}

/**
 * 差分1件を1文にする（`白ランプ（PL1）が 1.20 s に点きませんでした。`）。
 *
 * Phase 7 Task 25（指摘 UX-11 / UX-12 / PR-03）: 判定器の語（`ON のはずが OFF`・`値違い`）と
 * 内部の信号名（`PL1`）をやめ、**4モード共通の1行要約と同じ書式**（`result/verdict-summary.ts`）に
 * 揃える。モードDの結果画面は合否の隣の要約とこの理由欄の両方でこの文を使う。
 */
export function mismatchReason(mismatch: Mismatch): string {
  return mismatchLine(mismatch);
}

/**
 * 不合格の理由を、読ませたい順に並べる。§10.8
 *
 * ①変換エラー（シミュレートすらされていない）②落ちた静的チェック（配線の誤り）
 * ③動作の差分（時刻と信号）。合格なら空配列を返す。
 */
export function failureReasons(result: JudgePlcResult): string[] {
  const lines: string[] = [];
  if (result.ladderErrors.length > 0) lines.push(ladderErrorSummary(result.ladderErrors.length));
  for (const check of result.staticChecks) {
    if (check.ok) continue;
    lines.push(
      checkReasonText(
        JA.staticCheck[check.id],
        check.details[0] ?? check.message,
        checkAdvice(check.id),
      ),
    );
  }
  for (const mismatch of result.mismatches.slice(0, MAX_REASON_MISMATCHES)) {
    lines.push(mismatchReason(mismatch));
  }
  const rest = result.mismatches.length - MAX_REASON_MISMATCHES;
  if (rest > 0) lines.push(moreMismatchesText(rest));
  return lines;
}
