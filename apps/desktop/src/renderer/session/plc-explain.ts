import type { Mismatch } from '@ojt/circuit-sim';
import {
  BOARD_POWER_PREFIXES,
  type JudgePlcResult,
  type StaticCheckId,
  type StaticCheckResult,
} from '@ojt/content';
import {
  checkReasonText,
  JA,
  ladderErrorSummary,
  mismatchSentence,
  moreMismatchesText,
  signalLabel,
} from '../i18n/ja.js';
import { timeReadout } from '../panels/chart-scale.js';

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
 * 落ち方は2種類ある: ①PLCの電源を**盤から**取っている（§10.1 の違反）②壁コンセントへ
 * **配線していない**（手順の欠落）。どちらなのかは `details` に出てくる**端子IDの形**で見分ける。
 * 文言そのもので判定すると `@ojt/content` 側の言い回しが変わった瞬間に静かに壊れる。
 *
 * さらに、どちらの場合も「本アプリのPLCは `PLC.L` / `PLC.N` が未配線でも動く」ことを必ず添える。
 * 添えないと「回路は正しく動いているのにチェックだけ赤い」と見え、理由が分からないまま終わる。
 */
export function explainPowerCheck(check: StaticCheckResult): string[] {
  if (check.id !== 'plcPowerIndependent' || check.ok) return [];
  const lines: string[] = [];
  if (check.details.some((detail) => isBoardFedDetail(detail))) lines.push(JA.plc.powerFromBoard);
  if (check.details.some((detail) => !isBoardFedDetail(detail))) lines.push(JA.plc.powerUnwired);
  // 指摘の中身が読めなくても、少なくとも1行は出す
  if (lines.length === 0) lines.push(JA.plc.powerUnwired);
  lines.push(JA.plc.powerSimNote);
  return lines;
}

/**
 * 落ちた静的チェックの直し方（用意していないチェックは `undefined`）。
 * `plcPowerIndependent` は落ち方で言うことが変わるので `explainPowerCheck()` が受け持つ。
 */
const ADVICE: Partial<Record<StaticCheckId, string>> = {
  twoStage: JA.plc.adviceTwoStage,
  ioAssignment: JA.plc.adviceIoAssignment,
};

/** そのチェックの直し方。2026-09-19 の利用者決定「何をすればよいかまで書く」。 */
export function checkAdvice(id: StaticCheckId): string | undefined {
  return ADVICE[id];
}

/** 差分1件を1文にする（`PL1 が 1.20 s で ON のはずが OFF でした（値違い）`）。 */
export function mismatchReason(mismatch: Mismatch): string {
  return mismatchSentence(
    mismatch.signal,
    timeReadout(mismatch.tMs),
    signalLabel(mismatch.expected),
    signalLabel(mismatch.actual),
    JA.mismatchReason[mismatch.reason],
  );
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
    const advice =
      check.id === 'plcPowerIndependent' ? explainPowerCheck(check)[0] : checkAdvice(check.id);
    lines.push(
      checkReasonText(JA.staticCheck[check.id], check.details[0] ?? check.message, advice),
    );
  }
  for (const mismatch of result.mismatches.slice(0, MAX_REASON_MISMATCHES)) {
    lines.push(mismatchReason(mismatch));
  }
  const rest = result.mismatches.length - MAX_REASON_MISMATCHES;
  if (rest > 0) lines.push(moreMismatchesText(rest));
  return lines;
}
