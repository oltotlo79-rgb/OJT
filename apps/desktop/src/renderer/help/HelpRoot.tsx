import type { JSX } from 'react';
import { HelpDrawer } from './HelpDrawer.js';
import { useHelpStore } from './help-store.js';
import { useHelpHotkey } from './use-help-hotkey.js';

/**
 * `F1` の窓口と引き出しの出し入れ。取扱説明書 設計 §5.1 / 決定表#16・#17。
 *
 * `App.tsx` に1つだけ置く。`useHelpHotkey()` を呼ぶのも**ここだけ**である（2箇所から
 * 呼ぶと1回の `F1` で開いてすぐ閉じる）。
 *
 * `F1` は `shouldIgnoreShortcut()` を通さない——文字入力に使わないキーなので取り違えが
 * 起きず、「デバイス名を打ち込んでいる最中に書き方が分からない」ときこそ開きたいからである
 * （決定表#17）。
 *
 * モードDのラダー編集も `F1` を持っている（スキンのキー割当表の `help`）。あちらは
 * React の `onKeyDown` で、窓口の listener より**先に**走る。あちらが処理したら
 * `preventDefault()` するので、ここは `defaultPrevented` を見て何もしない（決定表#16）。
 */
export function HelpRoot(): JSX.Element | null {
  const open = useHelpStore((s) => s.open);
  const closeHelp = useHelpStore((s) => s.closeHelp);
  useHelpHotkey();

  if (!open) return null;
  return <HelpDrawer onClose={closeHelp} />;
}
