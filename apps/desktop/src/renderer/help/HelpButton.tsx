import { TutorialVideoButton } from './TutorialVideo.js';
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { currentHelpScreen } from './help-model.js';
import { useHelpStore } from './help-store.js';

/**
 * どの画面にも置く「ヘルプ」ボタン。取扱説明書 設計 §5.1。
 * どの節を開くかはボタンが決めず、**いまの画面**から決める（決定表#18）ので、
 * 置く側は `<HelpButton />` と書くだけでよい。
 *
 * 見た目は素のボタンのまま（`global.css` の `button` が最小の高さ32pxと
 * `:focus-visible` の輪郭を持つ）。画面ごとに色や大きさを変えない——9画面すべてで
 * 同じ言葉・同じ見た目に見えることが利用者要求（2026-09-19）だからである。
 */
export function HelpButton({ className }: { className?: string }): JSX.Element {
  const openHelp = useHelpStore((s) => s.openHelp);
  const route = useStore((s) => s.route);
  const mode = useStore((s) => s.problem?.mode);
  const assembleView = useStore((s) => s.assembleView);
  return (
    <>
      {route === 'session' && mode && <TutorialVideoButton mode={mode} />}
      <button
        type="button"
        className={className}
        data-testid="open-help"
        title={JA.help.shortcutHint}
        onClick={() => {
          openHelp(currentHelpScreen(route, mode, assembleView));
        }}
      >
        {JA.help.open}
      </button>
    </>
  );
}
