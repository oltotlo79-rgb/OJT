/**
 * ツールモード。設計仕様 §12.2。
 *
 * このファイルは Task 5（ストアと Worker ブリッジ）が `ToolMode` を必要とするために
 * 最小限だけ先出ししたもの。ピック結果 → 操作の判断（`InteractionState` / `PickAction` /
 * 純粋関数 `decide`）は Task 7（ピック結果 → 操作の純粋関数）でこのファイルに追加する。
 */
export type ToolMode = 'wire' | 'delete';
