import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
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
  const text = hint ?? JA.hoverHint.idle;
  return (
    <p
      className={styles.hoverHint}
      data-testid="hover-hint"
      data-idle={hint === undefined}
      role="status"
      aria-live="polite"
    >
      {text}
    </p>
  );
}
