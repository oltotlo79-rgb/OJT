/**
 * モーダル・引き出しの中で `Tab` を回す1本道。設計仕様 §8.1（指摘 UI-06）。
 *
 * 以前は `TimeChartView` / `HelpDrawer` / `SchematicView` に3実装あり、3つとも仕様が違った。
 * ここは**3つの上位互換**である。
 *
 * - 外へ逃げたフォーカスを引き戻す（`inside` 判定。`SchematicView` 版に無く、
 *   `aria-modal="true"` を宣言しているのに `Tab` で背後の画面へ抜けられた）
 * - 押せない要素（`disabled`）と隠れている要素（`[hidden]`）は飛び先にしない
 *   （`HelpDrawer` 版だけが `disabled` を除いていた。押せないボタンで巡回が止まって見える）
 */

/** `Tab` の飛び先になりうる要素（ネイティブのフォーカス順と同じ並びで拾う）。 */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * パネルの中でフォーカスを受け取れる要素を並び順に返す。
 * 押せない（`disabled`）要素と隠れている（`[hidden]`）要素は除く。
 */
export function focusablesIn(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hasAttribute('disabled') && !element.hasAttribute('hidden'),
  );
}

/**
 * `Tab` をパネルの中だけで回す（`keydown` の `Tab` で呼ぶ）。
 *
 * パネルの外にフォーカスがあるときも中へ引き戻すので、開いた直後に何も
 * フォーカスしていない場合でも1回の `Tab` で中に入る。飛び先が1つも無ければ何もしない。
 */
export function trapFocus(
  panel: HTMLElement | null,
  event: KeyboardEvent,
  allowedRoots: readonly HTMLElement[] = [],
): void {
  if (panel === null) return;
  // 操作ガイドでは、案内カードと現在の練習対象の間を巡回できるようにする。
  if (allowedRoots.length > 0) {
    const elements = [
      ...new Set(
        [panel, ...allowedRoots].flatMap((root) => [
          ...(root.matches(FOCUSABLE_SELECTOR) ? [root] : []),
          ...focusablesIn(root),
        ]),
      ),
    ].filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
    if (elements.length === 0) return;
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const next =
      index < 0
        ? event.shiftKey
          ? elements.length - 1
          : 0
        : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
    event.preventDefault();
    elements[next]?.focus();
    return;
  }
  const focusables = focusablesIn(panel);
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  const inside = active !== null && panel.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}
