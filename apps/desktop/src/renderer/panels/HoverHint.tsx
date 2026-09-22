import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { dispatchTester, TesterReadout } from './TesterPanel.js';
import styles from './panels.module.css';

/**
 * 3Dペインの下端に出す1行の予告。Phase 7 設計 §7.3.4（発見しやすさ）／利用者要望9。
 *
 * 「操作説明がなくても直感的に」に応えるための中心的な仕掛けで、書くのは
 * **いま指しているものは何で、押すと何が起きるか**だけである（機能の一覧でも手順でもない）。
 * 何も指していないときは最初の一手（`JA.hoverHint.idle`）を出して、無言の画面を作らない。
 *
 * 同じ文を `role="status"` / `aria-live="polite"` にも出す（§7.4）。3Dのホバーはマウス専用
 * だが、断る理由（「この端子はすでに2本です」）はキーボードの端子リストからも出るので、
 * 読み上げに届かないと理由が伝わらない利用者が残ってしまう。
 */
export function HoverHint(): JSX.Element {
  const hint = useStore((s) => s.hoverHint);
  const mode = useStore((s) => s.mode);
  const pending = useStore((s) => s.pendingTerminal);
  const next = useStore((s) => s.nextProbe);
  const text =
    mode === 'tester'
      ? `端子をクリックして${next === 'black' ? '黒' : '赤'}プローブを配置`
      : pending === undefined
        ? (hint ?? JA.hoverHint.idle)
        : `${pending} → 接続先の端子をクリック`;
  return (
    <div className={styles.hoverHint} data-testid="hover-hint" data-idle={hint === undefined}>
      <span role="status" aria-live="polite">
        {text}
      </span>
      {pending === undefined ? null : (
        <button
          type="button"
          data-testid="wire-cancel-inline"
          onClick={() => useStore.getState().setPending(undefined)}
        >
          取消
        </button>
      )}
      {mode !== 'tester' ? null : (
        <>
          <div className={styles.inlineReading}>
            <TesterReadout compact />
          </div>
          {(['black', 'red'] as const).map((side) => (
            <button
              key={side}
              type="button"
              data-testid={`quick-probe-${side}`}
              aria-pressed={next === side}
              onClick={() => useStore.getState().setNextProbe(side)}
            >
              {side === 'black' ? '黒' : '赤'}
            </button>
          ))}
          <button
            type="button"
            data-testid="quick-probe-clear"
            onClick={() => {
              dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
              dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
              useStore.getState().setNextProbe('black');
            }}
          >
            両方外す
          </button>
        </>
      )}
    </div>
  );
}
