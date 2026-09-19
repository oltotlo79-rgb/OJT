import { useEffect } from 'react';
import { useStore } from '../app/store.js';
import { currentHelpScreen } from './help-model.js';
import { useHelpStore } from './help-store.js';

/**
 * `F1` でヘルプを開け閉めする窓口。取扱説明書 設計 §5.1 / 決定表#16・#17。
 *
 * 画面ごとに張らず、`App.tsx` から1回だけ呼ぶ（Plan 6 Task 9 の `HelpRoot` が呼ぶ）。
 * 2箇所から呼ぶと1回の `F1` で開いてすぐ閉じるので、**必ず1つだけ**にする。
 *
 * - `shouldIgnoreShortcut()` は**通さない**。`F1` は文字入力に使わないキーなので
 *   取り違えが起きず、「デバイス名を打ち込んでいる最中に書き方が分からない」ときこそ
 *   開きたい（決定表#17）。
 * - モードDのラダー編集も `F1` を持っている（スキンのキー割当表の `help`）。あちらは
 *   React の `onKeyDown` で、この listener より**先に**走って `preventDefault()` するので、
 *   ここは `defaultPrevented` を見て何もしない（決定表#16）。
 * - どの節を開くかは押した画面から決める（決定表#18）ので、呼ぶ側は何も渡さない。
 */
export function useHelpHotkey(): void {
  const route = useStore((s) => s.route);
  const mode = useStore((s) => s.problem?.mode);
  const assembleView = useStore((s) => s.assembleView);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F1') return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      useHelpStore.getState().toggleHelp(currentHelpScreen(route, mode, assembleView));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [route, mode, assembleView]);
}
