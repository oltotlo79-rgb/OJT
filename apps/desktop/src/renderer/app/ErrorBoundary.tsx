import { Component, type ReactNode } from 'react';

/**
 * 画面の描画中に投げられた例外を受け止める境界。設計仕様 §13 #5。
 *
 * `window` の `error` / `unhandledrejection` は**非同期の例外**しか拾えない。
 * React の描画中に投げられた例外はそれより先に React が捕まえ、境界が無ければ
 * ルートごとアンマウントしてしまう（例外バナー自体も消えて真っ黒になる）。
 * そこでルート要素だけをこの境界で包み、外枠（バナーとトースト）は境界の外に置く。
 *
 * 復帰は `key` の付け替えで行う（`App` が `sessionEpoch` を渡す）。
 * 境界自身が状態を戻すのではなく作り直すことで、壊れた部分木が確実に初期状態から描き直される。
 */

/** 境界の入力。 */
interface ErrorBoundaryProps {
  children: ReactNode;
  /** 捕まえた例外のメッセージ（バナーに出す文字列）。 */
  onError: (message: string) => void;
}

/** 境界の状態。 */
interface ErrorBoundaryState {
  failed: boolean;
}

/** 描画中の例外を受け止める境界。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  /** 例外が出たら子を描くのをやめる（バナーは外枠が出す）。 */
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  /** 例外の内容をストアへ渡す（描画中に `set` しないよう commit 後のここで呼ぶ）。 */
  override componentDidCatch(error: unknown): void {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
