# @ojt/content

内蔵課題（モードB/C1/C2/D 計72題）のデータ形式・スキーマ・判定ロジックを持つパッケージ。
設計仕様 §7（課題データ形式）に対応する。

## 主なエントリポイント

- `src/index.ts` — `BUILTIN_ALL_PROBLEMS` などの内蔵課題一覧、`judge.ts` / `judge-inspect.ts` /
  `judge-plc.ts` の各モード判定関数、zod スキーマ群（`schema/`）。
- `src/loader.ts`（`./loader` エクスポート） — 課題JSONの読込・検証。
- `src/builtin/{assemble,inspect-parts,inspect-repair,plc}/*.json` — 内蔵課題本体
  （B 20 / C1 12 / C2 20 / D 20）。
- `scripts/validate.ts`（`pnpm --filter @ojt/content validate src/builtin`） — 課題JSONの
  自己整合検証CLI。新しい課題を追加したら必ず実行する。

`@ojt/board-model`・`@ojt/circuit-sim`・`@ojt/ladder-core`・`@ojt/schematic-core` に依存する
（判定に必要な全エンジンをまとめる層）。
