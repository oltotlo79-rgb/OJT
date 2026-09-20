/**
 * 見出しの断片識別子（`#sec-…` / `#ch-…`）を作る純関数。取扱説明書 設計 §6.3。
 *
 * **ここが唯一の正本である。** PDF（`scripts/manual-build.mjs`。素の Node から走る）と
 * アプリ内ヘルプ（`help-model.ts`。TypeScript）が同じ `id` を出さないと、
 * 本文中の相互参照リンクが PDF では飛べてアプリでは何も起きない、という食い違いが起きる。
 * どちらからも読めるように素の JavaScript で書き、型は `anchor-id.d.mts` に添える
 * （`scripts/*.mjs` ＋ `*.d.mts` と同じ作法）。
 */

/**
 * 節ID（`"mode-b/電線をつなぐ・外す"`）を断片識別子へ写す。
 * 例: `"sec-mode-b--電線をつなぐ外す"`。
 *
 * 記号を落として文字と数字だけを残す。日本語はそのまま残すが、`encodeURIComponent()`
 * できる形なので PDF のリンク注釈にも `href="#…"` にも安全に置ける。
 */
export function anchorIdOf(sectionId) {
  const separator = sectionId.indexOf('/');
  const chapterId = separator < 0 ? sectionId : sectionId.slice(0, separator);
  const title = separator < 0 ? '' : sectionId.slice(separator + 1);
  const safeTitle = title.replace(/[^\p{L}\p{N}]+/gu, '');
  return `sec-${chapterId}--${safeTitle}`;
}

/** 章ID（`"mode-b"`）を断片識別子へ写す。例: `"ch-mode-b"`。 */
export function chapterAnchorIdOf(chapterId) {
  return `ch-${chapterId.replace(/[^\p{L}\p{N}-]+/gu, '')}`;
}
