import type { JSX } from 'react';

/**
 * セッション画面（配線・装着・通電・判定の起点）。設計仕様 §12.1。
 *
 * このファイルは Task 6（文言・色・外枠と画面遷移）が `routes.tsx` の全ルートを配線するために
 * 最小限だけ先出ししたもの。3D盤・右パネル・下部パネル・ツールバーは
 * Task 14（セッション画面）でこのファイルに実装する。
 */
export function Session(): JSX.Element {
  return <div />;
}
