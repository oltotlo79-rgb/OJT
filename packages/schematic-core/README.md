# @ojt/schematic-core

有接点シーケンス回路の展開接続図（シーケンス図）エディタの中核ロジック。設計仕様 §11
（図面エディタ）に対応する。描画（React/SVG）は持たず、図面の編集・検算・3D盤への割当変換
のみを扱う。

## 主なエントリポイント（`src/index.ts`）

- `document.ts` — シーケンス図の文書モデル（デバイス・線分・母線）。
- `edit.ts` — 図面の編集操作（素子の配置・結線）。
- `symbols.ts` / `DEVICE_PATTERNS` — 図記号とデバイスの対応。
- `layout.ts` — 自動レイアウト。
- `assign.ts` / `to-session.ts` — 図面から3D盤の配線ガイド（端子割当）への変換。「検算」
  （回路の妥当性確認）もこの割当結果を使う。

`@ojt/board-model`・`@ojt/circuit-sim` に依存する（3D盤への変換と検算のため）。
