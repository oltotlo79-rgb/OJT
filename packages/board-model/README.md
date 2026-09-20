# @ojt/board-model

JIPM標準の練習盤（ソケット・端子台・PB/PL・PLC本体を載せる盤）の定義と、盤上の配線経路を
扱うパッケージ。設計仕様 §6（盤モデル仕様）に対応する。

## 主なエントリポイント（`src/index.ts`）

- `JIPM_BOARD` — 盤の定義（ソケット配列・端子位置・固定配線）。
- `routeSession()` / `RoutingResult` — 端子間の自動配線経路（3Dの電線ジオメトリ用）。
- `board-jipm.ts` — 盤面の部品カタログと寸法。
- `catalog.ts` — 部品（CR・T・PB・PL・PLC本体など）の型式相当カタログ。
- `to-netlist.ts` — 盤上の配線・装着状態から `@ojt/circuit-sim` 用ネットリストへの変換。

`@ojt/circuit-sim` に依存する（ネットリスト変換のため）。
