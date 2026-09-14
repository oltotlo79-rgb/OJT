import type { BoardSession } from '@ojt/board-model';

/**
 * 盤操作のコマンド履歴（元に戻す／やり直し）。設計仕様 §8.2。
 *
 * このファイルは Task 5（ストアと Worker ブリッジ）が `SessionCommand` / `CommandHistory` /
 * `emptyHistory` を必要とするために最小限だけ先出ししたもの。`cloneSession` と元に戻す／
 * やり直しの操作関数は Task 8（コマンド履歴）でこのファイルに追加する。
 */

/** 盤操作1回ぶんの記録（元に戻す／やり直しの単位）。 */
export interface SessionCommand {
  /** 操作の種別（ログ表示用）。 */
  kind: 'addWire' | 'removeWire' | 'plug' | 'unplug' | 'setPreset';
  /** 操作の説明（操作ログに出す文）。§8.1 */
  label: string;
  before: BoardSession;
  after: BoardSession;
}

/** 元に戻す／やり直しの履歴。 */
export interface CommandHistory {
  done: SessionCommand[];
  undone: SessionCommand[];
}

/** 空の履歴。 */
export function emptyHistory(): CommandHistory {
  return { done: [], undone: [] };
}
