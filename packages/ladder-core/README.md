# @ojt/ladder-core

PLCラダープログラムの中間表現（IR）とランタイムを持つパッケージ。設計仕様 §10
（モードD PLC）に対応する。メーカー方言（`@ojt/plc-dialects`）から独立した、方言に依存しない
ラダーの内部モデルを提供する。

## 主なエントリポイント（`src/index.ts`）

- `ir.ts` — ラダーIR（回路網・セル・デバイス参照）の型と構築関数。
- `edit.ts` — セル単位の編集操作（接点・コイル・命令の挿入／削除）。
- `compile.ts` — IRから実行可能な命令列への変換（`convertStep` 相当）。
- `runtime.ts` — スキャン実行（RUN/STOP、デバイスメモリ、CTU等の命令）。

他の `@ojt/*` パッケージに依存しない。`@ojt/plc-dialects` と `@ojt/content` から利用される。
