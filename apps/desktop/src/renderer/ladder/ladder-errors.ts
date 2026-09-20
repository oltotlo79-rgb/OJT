import type { CompileErrorCode } from '@ojt/ladder-core';

/**
 * 変換・編集エラーの生の文言から、内部識別子を追い出す。設計仕様 §10.6。指摘 LE-9
 *
 * `packages/ladder-core` が返す `message` は、開発時の手がかりとして仕様の節番号や内部識別子
 * （ネットワークID・セル座標）を含むことがある。訓練者には意味を持たない文字列なので、
 * 画面（出力ウィンドウ・トースト）へ出す直前にこの写像へ通す。`LadderWorkspace.tsx` の
 * `ilIssueAdvice`（命令語リストの書き出し失敗）が同じ形で既に使っている手法を、
 * 変換エラー・セル編集エラーの経路にも広げる。
 */

/**
 * 構造検査（`compile()`）の `code` → 平易な日本語。
 *
 * ここに載せるのは、実際に内部識別子（仕様の節番号など）を含む `code` だけである
 * （`missing-end` の生の文言は「END がありません（§10.3）」）。他の `code` のメッセージは
 * 既に内部識別子を含まない（数値の範囲やデバイス名だけを含む）ので、ライブラリの `message`
 * をそのまま使うほうが具体的で有用（`ilIssueAdvice` と同じ選び方。不要な `code` まで
 * 載せると、呼び出し側が独自に渡した文言まで無言で上書きしてしまう）。
 */
export const COMPILE_ERROR_MESSAGES: Readonly<Partial<Record<CompileErrorCode, string>>> = {
  // 元の文言は「END がありません（§10.3）」。仕様の節番号は訓練者に意味を持たない
  'missing-end': 'END がありません。',
};

/** 変換エラー1件の表示文言。`code` に載っていなければ元の `message` をそのまま使う。 */
export function friendlyCompileMessage(code: string, message: string): string {
  return COMPILE_ERROR_MESSAGES[code as CompileErrorCode] ?? message;
}

/**
 * `packages/ladder-core` の `edit.ts` が投げる `LadderError.message` は、ネットワークIDと
 * セル座標を埋め込むことがある（例:「罫線は空セル・横線・縦線の上にだけ引けます: n1 (0, 1) は
 * contact」）。`edit.ts` は構造化した `code` を持たないので、既知の漏洩パターンを文字列で
 * 見分けて画面向けの文言に差し替える。`session/ladder.ts` の `guard()` から呼ぶ。
 */
export function friendlyLadderErrorMessage(message: string): string {
  if (message.includes('罫線は空セル・横線・縦線の上にだけ引けます')) {
    return '罫線は空セル・横線・縦線の上にだけ引けます（接点やコイルの上には引けません）。';
  }
  return message;
}
