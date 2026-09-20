/**
 * 例外を画面の文言に直す1本道。設計仕様 §8.2 / §13（指摘 UI-05）。
 *
 * 同じ3行が8箇所に写っていたので、ここだけに置く。`Error` でないもの（Worker から来る
 * 文字列や、`reject(undefined)` のような行儀の悪い約束）も必ず1行の日本語として扱えるよう、
 * `String()` へ落とす。内部の識別子や英語の例外名が混じるのは避けられないが、
 * 画面に出すときは呼び出し側で「〜できません: 」のような前置きを添えること。
 */

/** 例外から画面に出す1行を作る。 */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
