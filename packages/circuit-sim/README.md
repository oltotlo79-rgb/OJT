# @ojt/circuit-sim

有接点シーケンス回路の電気シミュレーションエンジン。設計仕様 §5（回路エンジン仕様）に対応
する。UIを持たない純粋なロジック層で、`apps/desktop` の Web Worker から呼び出される。

## 主なエントリポイント（`src/index.ts`）

- `elements.ts` — 部品（リレー・タイマ・PB・PL・BZなど）の電気モデル。
- `Simulation` / `addWire` / `tick`（`index.ts` 経由） — ネットリストを与えて時間発展させる
  シミュレーション本体。
- `faults.ts` — 故障注入API（コイル断線・レアショートなど）。
- `meter.ts` / `meter-state.ts` — テスター（デジタル／アナログ）の測定モデル。
- `compare.ts` — 期待波形と実測波形の突き合わせ（判定用）。

他の `@ojt/*` パッケージに依存しない（末端のエンジン）。
