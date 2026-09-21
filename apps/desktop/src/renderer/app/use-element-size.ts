import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 要素の実測幅・高さを追う。指摘 LE-18 ／ Phase 7 設計 §5.5
 *
 * これまでラダーの編集領域は `window.resize` だけで幅を測り直していたため、**窓の大きさが
 * 変わらない変化**（表示切替の「ラダー／分割／盤」、右の欄の `<details>` の開閉、キー早見表の
 * 開閉）に追従できず、接点の列数が古いままでコイル列が画面の外へ出ていた。`ResizeObserver` は
 * 「その要素が実際に何pxになったか」を見るので、原因が何であれ追いつく。
 *
 * 寸法の要る画面は
 * この1本を呼ぶ。`ResizeObserver` が無い環境（古い jsdom）では `window.resize` に倒す。
 *
 * @returns 実測した幅と高さ[px]。まだ測れていない・幅0のときは `undefined`。
 */
export function useElementSize(
  ref: RefObject<Element | null>,
): { width: number; height: number } | undefined {
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = (): void => {
      const measured = ref.current?.getBoundingClientRect();
      /*
       * 同じ寸法なら前の値を返して再描画を避け、`undefined` と `0` を
       * 混ぜないようにここで畳んでおく（`fitGridCols()` は「測れていない」を `undefined`
       * で受け取る約束になっている）。
       */
      const next =
        measured !== undefined && measured.width > 0
          ? { width: measured.width, height: measured.height }
          : undefined;
      setSize((previous) =>
        previous?.width === next?.width && previous?.height === next?.height ? previous : next,
      );
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
  return size;
}

export function useElementWidth(ref: RefObject<Element | null>): number | undefined {
  return useElementSize(ref)?.width;
}
