# @ojt/plc-dialects

三菱電機（GX Works3風）・OMRON（CX-Programmer風）・ジェイテクト（PCwin風）・シャープ
（JW-300SP風）の4方言プロファイルを持つパッケージ。設計仕様 §10・§17.1（純正ツール前提方針）
に対応する。

## 主なエントリポイント（`src/index.ts`）

- `mitsubishi.ts` / `omron.ts` / `jtekt.ts` / `sharp.ts` — 各社の `DialectProfile`
  （デバイス表記・命令名・キー割当 `shortcuts` ・パネル構成 `PanelLayout` など）。
- `convert.ts` — 方言ごとの「変換」ステップ（`convertStep` 相当）。
- `device-rules.ts` — デバイス番号の範囲・入出力割付の検査。
- `notation.ts` — デバイス表記（`X0` / `0.00` など）の相互変換。
- `instruction-list.ts` — 命令語リストのテキスト書き出し。

`@ojt/ladder-core` に依存する（IRを方言ごとの表記・命令へ変換するため）。
