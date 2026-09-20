import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 要素の実測幅を追う。指摘 LE-18 ／ Phase 7 設計 §5.5
 *
 * これまでラダーの編集領域は `window.resize` だけで幅を測り直していたため、**窓の大きさが
 * 変わらない変化**（表示切替の「ラダー／分割／盤」、右の欄の `<details>` の開閉、キー早見表の
 * 開閉）に追従できず、接点の列数が古いままでコイル列が画面の外へ出ていた。`ResizeObserver` は
 * 「その要素が実際に何pxになったか」を見るので、原因が何であれ追いつく。
 *
 * リポジトリ全体で `ResizeObserver` を使うのはここだけにして（当時0件）、幅の要る画面は
 * この1本を呼ぶ。`ResizeObserver` が無い環境（古い jsdom）では `window.resize` に倒す。
 *
 * @returns 実測幅[px]。まだ測れていない・幅0のときは `undefined`。
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = (): void => {
      const measured = ref.current?.getBoundingClientRect().width;
      /*
       * 同じ値で `setWidth` を呼んでも React は再描画しないが、`undefined` と `0` を
       * 混ぜないようにここで畳んでおく（`fitGridCols()` は「測れていない」を `undefined`
       * で受け取る約束になっている）。
       */
      setWidth(measured !== undefined && measured > 0 ? measured : undefined);
    };
    measure();
    /*
     * 窓の大きさが変わったときの測り直しは**残す**。`ResizeObserver` が無い環境（古い jsdom）
     * への控えであると同時に、観測器が用意されていても実寸を返さない試験環境で「窓が変わったら
     * 測り直す」という従来の筋道を保つため。同じ値なら `setWidth` は再描画を起こさないので、
     * 二重に測っても害はない。
     */
    window.addEventListener('resize', measure);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            measure();
          });
    const element = ref.current;
    if (observer !== undefined && element !== null) observer.observe(element);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [ref]);
  return width;
}
