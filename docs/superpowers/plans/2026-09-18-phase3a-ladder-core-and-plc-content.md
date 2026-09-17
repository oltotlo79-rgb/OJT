# Plan 3A: ラダーコア・三菱方言・PLC課題（packages のみ）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3（モードD＝PLC課題）の**ライブラリ側**を、React・Electron・Three.js に一切依存しない純TypeScriptとして完成させる。すなわち新パッケージ `@ojt/ladder-core`（ラダーIR・変換・PLCランタイム）と `@ojt/plc-dialects`（三菱 FX5U 方言プロファイルとスキン定義）を作り、`@ojt/circuit-sim` に PLC本体の部品（X入力の負荷要素・Y出力の接点要素）とスキャン結合のためのAPIを足し、`@ojt/board-model` に FX5U 本体と壁コンセントを持つ盤の派生定義を足し、`@ojt/content` にモードD課題スキーマ・模範配線の生成・PLC静的チェック（`twoStage` / `plcPowerIndependent` / `ioAssignment`）・モードD判定・内蔵課題8題を足す。GX Works3風スキンの画面、F5/F7 のキー操作、「変換」ボタン、FX5U の3Dモデル、モードDのセッション画面とE2Eは、すべて **Plan 3B** の担当である。

**Architecture:** 4層に切る。①**IRとランタイム**（`@ojt/ladder-core`）＝ラダーのデータモデル（§10.3）と、それを10msスキャンで実行する状態機械（§10.4）。回路エンジンを知らず、外界とは `PlcIoPort`（`readInputs()` / `writeOutputs()`）だけで繋がる（§4.2）。②**方言**（`@ojt/plc-dialects`）＝デバイス表記（X/Yは8進、M/T/Cは10進）・タイマ単位・命令語・バリデータ・スキン定義（§10.5 / §10.6）。`ladder-core` に依存し、逆は無い。③**電気的実体**（`@ojt/circuit-sim` の `plc.ts` ＋ `@ojt/board-model` の `plc-unit.ts`）＝PLC本体をネットリスト上の1部品として表す（§4.4）。入力 Xn は `PLC.SS`–`PLC.Xn` 間の抵抗負荷、出力 Yn は `PLC.Yn`–`PLC.COMg` 間の接点、電源 L/N は壁コンセント `OUTLET` への配線の有無だけを見る非電気的端子である。④**課題と判定**（`@ojt/content`）＝モードD課題スキーマ、既定I/O割付から模範配線を生成する器、PLC静的チェック、模範ラダー＋模範配線と訓練者ラダー＋訓練者配線を同じ操作列で並走させる判定（決定事項#8）。

**スキャンと tick の結合（依頼の DECIDE に対する回答）:** **1 tick ＝ 1 スキャン**とし、結合は `@ojt/content` の `runner.ts` に足す `beforeTick` フックで行う（§10.4「スキャン周期 10ms。回路エンジンと同期する」）。1 tick の順序は「①`runtime.scan()` が `sim.plcInputs()` で入力を読む（＝**直前の tick の解**で確定した X の ON/OFF）→②ネットワークを上から順に実行→③`sim.setPlcOutputs()` で Y 接点の開閉をネットリストへ書く」→そのうえで `sim.step()` が今 tick の回路を解く。実機のスキャンと同じく入力は1スキャンぶん遅れ、Y が閉じてから盤のリレーが動くまでさらに1 tick かかる（合計 20〜30ms）。判定の許容差は既定 200ms（`DEFAULT_TOLERANCE`）なので、この遅れが合否を左右することはない。`circuit-sim` に PLC ランタイムを持ち込まない（`ladder-core` への依存が生まれる）、`ladder-core` に `Simulation` を持ち込まない（§4.2 違反）ため、両方を知っている `@ojt/content` が唯一の結合点になる。

**Tech Stack:** TypeScript（`strict` ＋ `noUncheckedIndexedAccess` ＋ `exactOptionalPropertyTypes` ＋ `verbatimModuleSyntax`、`.js` 拡張子つき相対 import）、zod 4.6.0（`z.strictObject` / `z.literal([...])`、ja locale は `@ojt/content` の `schema/index.ts` で設定済み）、Vitest 5（カバレッジ v8・閾値90%）、pnpm workspace、Prettier（printWidth 100）。**新しい外部依存は追加しない**（`@ojt/ladder-core` は依存ゼロ、`@ojt/plc-dialects` は `@ojt/ladder-core` のみ、`@ojt/content` は `@ojt/ladder-core` が増える）。

---

## 前提（このプランを始める前に満たしていること）

| # | 前提 | 確認方法 |
|---|---|---|
| 1 | Plan 1A〜1D・2A が完了し `main` に入っている。`packages/circuit-sim` / `board-model` / `schematic-core` / `content` の4パッケージと `apps/desktop` が揃い、`pnpm -r test` が通る | `pnpm -r test` |
| 2 | Plan 2B（`apps/desktop` のモードC1/C2画面）が**並行して進んでいる**。本プランが `apps/desktop` に触れるのは **Task 13 の `apps/desktop/test/content-loader.test.ts` 1ファイルだけ**である。着手前に必ず `git pull --rebase origin main` し、コミットは `git commit --only -- <パス>` で対象ファイルだけを送る（Phase 2 で共有インデックスの巻き込みが2回起きている。handoff §3） | `git log --oneline -5` |
| 3 | `@ojt/circuit-sim` が `TICK_MS`(10) / `SOURCE_VOLTS`(24) / `SOURCE_INTERNAL_OHMS`(0.1) / `CLOSED_CONTACT_OHMS`(0.001) / `COIL_OHMS`(650) / `LAMP_OHMS`(2400) / `PICKUP_VOLTS`(19.2) / `DROPOUT_VOLTS`(2.4) / `LAMP_LIT_VOLTS`(14.4) / `PLC_INPUT_OHMS`(4700) / `MAX_WIRES_PER_TERMINAL`(2) / `MAX_NODES`(400) / `DEFAULT_TOLERANCE`(`{edgeMs:200, ratio:0.1}`) / `HAZARD_KINDS`（6種）を公開している | `packages/circuit-sim/src/index.ts` |
| 4 | `Element` は `source` / `contact` / `load` / `link` の4種で、`ContactDriver` に **`'external'`** が、`LoadKind` に **`'plcInput'`** が既にある（Plan 1A で PLC のために空けてある枠。本プランが初めて使う） | `packages/circuit-sim/src/elements.ts` L42・L49 |
| 5 | `Simulation.step()` の 1 tick は「`syncSources` → `buildNets` → `solve` → `updateLoads` → `updateRelays` → `updateTimers` → `applyContacts` → `updateProtection` → `snapshot`／`log.record` → `detectChatter`」の順である。`applyContacts()` は `driver === 'relay'` と `'timer'` の接点しか触らない（`'external'` の接点は誰も書き換えないので、外から `energized` を立てればそのまま効く） | `packages/circuit-sim/src/simulation.ts` L395-411・L584-601 |
| 6 | `solve()` の戻り値 `SolveResult` は `elementVolts`（要素電圧）と **`elementAmps`（要素電流、from→to を正）** の両方を持つ。PLC入力の ON/OFF 判定（3mA以上／1.5mA以下）はこの電流で行う | `packages/circuit-sim/src/solver.ts` L31-42・L205-226 |
| 7 | `buildNets()` が返す `Nets` は `nodeOf(terminal)` / `hasTerminal()` / `terminals` / **`terminalsOf(node)`** を持つ。`twoStage` / `plcPowerIndependent` / `ioAssignment` の3チェックは、この「同じ節点に居る端子の一覧」だけで判定する（通電しなくてよい＝静的チェック） | `packages/circuit-sim/src/netlist.ts` L233-241 |
| 8 | `TerminalId` は `<部品ID>.<端子名>` で、**端子名側に `.` を含んでよい**（`parseTerminalId` は最初の `.` で割る。型コメントに `PLC.0.00` の例がある）。Phase 4 の OMRON `PLC.100.00` もそのまま載る | `packages/circuit-sim/src/ids.ts` L11・L44-48 |
| 9 | `@ojt/board-model` が `JIPM_BOARD`（`id: 'board-jipm-std'`）/ `BoardDefinition` / `BoardTerminal` / `validateBoard` / `createSession` / `addWire` / `checkWirableTerminal` / `toNetlist` / `routeSession` / `P_RAIL_ID`(`'P'`) / `N_RAIL_ID`(`'N'`) / `PB_BLOCK_ID`(`'TB_PB'`) / `PL_BLOCK_ID`(`'TB_PL'`) / `TASK1_SOCKET_ROLES` を公開している。`SUPPLY_TERMINAL_COUNT` は **1**（`P.1` / `N.1` の各1点）で、そのうち各1本はチェック用回路の既設配線（`P.1→TB_PB.4c` / `CHK.13→N.1`）が使っている | `packages/board-model/src/board-jipm.ts`・`to-netlist.ts` |
| 10 | `validateBoard()` は全端子に対して `rectContains(boardRect, term.pos)`（盤の外に端子があるとエラー）と、配線可能端子どうしの当たり判定の重なりを検査する。**机上に置く PLC・壁コンセントの端子はこの検査から外す必要がある**（Task 7） | `packages/board-model/src/board-jipm.ts` L935-970 |
| 11 | `@ojt/content` が `parseProblem` / `ProblemSchema` / `UNSUPPORTED_MODES`（現在 `['plc']`）/ `ProblemHeaderShape` / `JudgeSettingsSchema` / `STATIC_CHECK_IDS`（現在6種）/ `OperationListSchema` / `DurationMsSchema` / `runOperations` / `runStaticChecks` / `buildTimeChart` / `defaultChartSignals` / `countHazards` / `judgeAssemble` / `BUILTIN_ALL_PROBLEMS`（20題）を公開している | `packages/content/src/index.ts` |
| 12 | 内蔵課題JSONの import は必ず **import attributes**（`with { type: 'json' }`）を付ける（素の Node ESM が `ERR_IMPORT_ATTRIBUTE_MISSING` で落ちるため。`test/builtin-node-esm.test.ts` が見張っている） | `packages/content/src/builtin/index.ts` L38-41 |
| 13 | 新パッケージは `pnpm-workspace.yaml` の `packages/*` と `vitest.workspace.ts` の `['packages/*','apps/*']` に**自動で載る**。ルートの `tsconfig.json` はパッケージを参照していない（`pnpm -r typecheck` が各パッケージの `tsconfig.json` を使う）。ESLint の解決器も `packages/*/tsconfig.json` を見ている。したがって新パッケージに要るのは `package.json` / `tsconfig.json` / `vitest.config.ts` の3つだけである | `pnpm-workspace.yaml` / `vitest.workspace.ts` / `eslint.config.js` |
| 14 | テスト件数のベースライン（handoff 2026-09-18 時点）: `circuit-sim` 215・`board-model` 158・`content` 32ファイル442・`desktop` 541・E2E 11。本プランの完了条件では**着手時に測り直した値**を基準にすること | `pnpm -r test` |

**この計画が前提として置いた設計値（仕様に無い、または本プランで確定させた値）:**

| 値 | 採用値 | 根拠 |
|---|---|---|
| IRの列数 | **16固定**（`IR_COLS`）、最終列（index 15、`COIL_COL`）がコイル列 | §10.3 |
| IRの `Device.index` | **0起点の通し番号**（8進・16進はすべて方言の表示上の話）。`X(8)` は三菱表記で `X10` | §10.5（`formatDevice` が方言の責務）。本プランの決定 |
| FX5U の入力仕様 | 4.5kΩ／ON 3.5mA以上／OFF 1.5mA以下。24V 印加時の入力電流は `24 ÷ (4500 + 0.1 + 0.001) ≈ 5.333mA` で ON しきい値の 1.5 倍 | §5.1.3（機種別の値）、PLC調査資料 §1-A |
| FX5U の出力COM分け | `COM0`→`Y0`〜`Y3`、`COM1`→`Y4`〜`Y7`、`COM2`→`Y10`〜`Y13`、`COM3`→`Y14`〜`Y17`（4点1コモン） | §10.1 は「`COM0, COM1, …` を仕切り線で区切る」としか書いていない。§17.1 の前提方針で本アプリ既定とする（修正箇所は盤モデルのみ） |
| 内蔵モードD課題が使う点数 | 2級形式 = X0〜X2 / Y0〜Y2（PL1〜PL3）、1級形式 = X0〜X2 / Y0〜Y3（PL1〜PL4） | §7.6・調査資料 §1.1 |
| 模範配線の母線分配 | `P.1` / `N.1` の空き1本から**渡り配線**（鎖状）でPLC・リレー・ランプへ配る（1端子2本の範囲内） | §6.3・§6.6・§11.3・§17.2 #33 |
| 入力コモンの結線 | 既定は**シンク**（`P.1`→`PLC.SS`、`TB_PB.na`→`PLC.Xn`、`TB_PB.nc`→`N`）。課題は `io.wiring` で `source` も選べる | §10.2 |
| 二重コイル | 変換は**警告**（エラーにしない）、実行は後勝ち | §10.4 |
| MC/MCR | 区間が非成立のとき OUT コイルと TON を落とし、SET/RST とカウンタは保持する | §10.3・§10.4（保持の規定から） |

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `packages/ladder-core/package.json` / `tsconfig.json` / `vitest.config.ts` | 新パッケージの雛形（`@ojt/circuit-sim` と同じ形。依存ゼロ） |
| `packages/ladder-core/src/ir.ts` | ラダーIR（`LadderProgram` / `Network` / `Cell` / `Device`）と組み立てヘルパ。§10.3 |
| `packages/ladder-core/src/edit.ts` | IRの編集API（`setCell` / `clearCell` / `insertRow` / `deleteRow` / `insertNetwork` / `deleteNetwork` / `setVerticalLink`）。すべて純粋関数。§10.3 / §10.7（3Bのエディタが使う） |
| `packages/ladder-core/src/compile.ts` | `compile()`＝構造検査と実行形式への変換。変換エラー／警告。§10.3 / §10.4 |
| `packages/ladder-core/src/runtime.ts` | `createPlcRuntime()`＝1スキャンの実行（接点・コイル・SET/RST・TON・CTU・MC/MCR・特殊デバイス）。`PlcIoPort`。§10.4 |
| `packages/ladder-core/src/index.ts` | バレル |
| `packages/plc-dialects/package.json` / `tsconfig.json` / `vitest.config.ts` | 新パッケージの雛形（依存は `@ojt/ladder-core` のみ） |
| `packages/plc-dialects/src/profile.ts` | `DialectProfile` インターフェースとスキン定義の型（`ShortcutTable` / `SymbolDrawing` / `MonitorColors` / `PanelLayout` / `DialectError`）。§10.5 / §10.6 |
| `packages/plc-dialects/src/mitsubishi.ts` | 三菱 FX5U プロファイル（デバイス表記・タイマ単位・命令語・バリデータ・GX Works3風スキン）。§10.5 / §10.6 |
| `packages/plc-dialects/src/convert.ts` | `convert()`＝「変換」操作（`compile()` ＋ 方言バリデータ）。§10.6 |
| `packages/plc-dialects/src/index.ts` | `getDialect()` / `DIALECT_IDS` とバレル |
| `packages/circuit-sim/src/plc.ts` | `createPlcUnit()`＝PLC本体の部品（X入力の負荷・Y出力の接点・電源端子）。§4.4 / §5.1.3 |
| `packages/circuit-sim/src/parts.ts` | `PartKind` に `'plc'`、`PartMeta` に PLC 用の枝を足す（変更） |
| `packages/circuit-sim/src/simulation.ts` | PLC入力の ON/OFF 判定（ヒステリシス）と Y 出力の駆動、`plcInputs()` / `setPlcOutputs()`、信号ログ（変更） |
| `packages/circuit-sim/src/index.ts` | 再エクスポート（変更） |
| `packages/board-model/src/plc-unit.ts` | FX5U 本体（端子・寸法・LED）と壁コンセント、`withPlcUnit()` / `isOffBoardTerminal()`。§10.1 |
| `packages/board-model/src/board-jipm.ts` | `BoardDefinition.plcUnit?` と `PlcUnitDefinition` 型、`validateBoard()` の机上端子の除外（変更） |
| `packages/board-model/src/to-netlist.ts` | PLC本体と壁コンセントをネットリストに載せる（変更） |
| `packages/board-model/src/routing.ts` | 机上配線（PLC・コンセントに繋がる電線）を盤の経路生成から外し `deskWires()` で返す（変更） |
| `packages/board-model/src/index.ts` | 再エクスポート（変更） |
| `packages/content/src/schema/ladder.ts` | ラダーIRの zod（課題JSONに模範ラダーを書くため）。§7.6 / §10.3 |
| `packages/content/src/schema/plc.ts` | モードD課題の本体スキーマ（`plc` / `io` / `referenceLadder` / `wiringRequired`）。§7.6 |
| `packages/content/src/schema/judge.ts` | 静的チェックIDに `twoStage` / `plcPowerIndependent` / `ioAssignment` を足す（変更）。§7.4 |
| `packages/content/src/schema/index.ts` | 判別共用体にモードDを足し `UNSUPPORTED_MODES` を空にする、JSON Schema 再生成（変更） |
| `packages/content/src/plc-reference.ts` | 既定I/O割付、模範配線の生成（渡り配線）、模範セッションの構築。§7.6 / §10.2 / §11.3 |
| `packages/content/src/plc-io.ts` | `Simulation` を `PlcIoPort` として見せる橋渡しと、1 tick ＝ 1 スキャンの結合。§10.4 |
| `packages/content/src/runner.ts` | `RunOptions.beforeTick` を足す（変更）。§10.4 |
| `packages/content/src/static-check-types.ts` | `StaticCheckInput` / `StaticCheckResult` / `PlcCheckContext`（`static-checks.ts` と `plc-static-checks.ts` の循環を断つための型置き場） |
| `packages/content/src/plc-static-checks.ts` | `twoStage` / `plcPowerIndependent` / `ioAssignment` と結線方式の判定。§7.4 / §10.2 / §10.8 |
| `packages/content/src/static-checks.ts` | 上記3件を `runStaticChecks` に組み込む（変更） |
| `packages/content/src/judge-plc.ts` | `judgePlc()` / `judgePlcReference()` と結果型。§10.8 |
| `packages/content/src/builtin/plc/d-001〜d-008.json` | 内蔵モードD課題8題（2級形式4・1級形式4）。§7.9 |
| `packages/content/src/builtin/index.ts` | モードDの登録（変更） |
| `packages/content/src/index.ts` | 公開APIの確定（変更） |
| `packages/content/test/helpers/plc.ts` | モードD課題JSONの骨組みとラダーの組み立てヘルパ |
| `apps/desktop/test/content-loader.test.ts` | 「まだ開始できないモード」テストの追随（**このファイルのみ**。UI は Plan 3B） |

---

## 実装バッチ（推奨）

依存関係にもとづくバッチ分けである。バッチ内は上から順、バッチ間は矢印の順で進める。**A と B は互いに独立なので並行してよい**。モデルは「そのタスクが判断を要するか（設計の分岐・数値の整合・回路の意味）」で選ぶ。

| バッチ | タスク | 対象 | モデル | 依存 |
|---|---|---|---|---|
| A | 1 → 1b → 2 → 3 → 4 | `@ojt/ladder-core` | 1=Sonnet（そのまま写す） / 1b=Sonnet（そのまま写す） / 2=Sonnet（そのまま写す） / 3=**Opus** / 4=Sonnet（そのまま写す） | なし（最初に着手する） |
| B | 5 → 6 | `@ojt/circuit-sim`（PLC部品とスキャン結合点） | 5=Sonnet（そのまま写す） / 6=**Opus** | なし（Aと並行可） |
| C | 7 | `@ojt/board-model`（FX5U・コンセント・盤の派生） | Sonnet（そのまま写す。B8 の `String()` 比較を適用済みのため） | B |
| D | 8 → 9 → 10 | `@ojt/plc-dialects` | 8=Sonnet / 9=Sonnet / 10=**Opus** | A |
| E | 11 → 12 → 13 | `@ojt/content`（スキーマ） | 11=Sonnet / 12=**Opus** / 13=Sonnet | A |
| F | 14 → 15 → 16 → 17 | `@ojt/content`（模範配線・スキャン結合・静的チェック・判定） | すべて **Opus** | B・C・E |
| G | 18 → 19 | `@ojt/content`（内蔵課題8題） | どちらも **Opus** | F |
| H | 20 | 全体（公開APIと検証） | Sonnet | A〜G すべて |

進め方: **A ∥ B** → **C** → **D ∥ E** → **F** → **G** → **H**。並行の上限は「A＋B」「D＋E」の2組までにする（C は B の、F は C・E の成果物を import するため）。

「そのまま写す（Sonnet-verbatim）」と書いたタスクは、プランのコードとテストをそのまま書き写せば通る。判断（数値の整合・回路の意味・設計の分岐）が要るのは Opus と書いたタスクだけである。**どのタスクも、後のタスクが作るファイルを import しない**ことを各タスクの Files 欄で確認すること（Plan 2B で一度この順序を誤っている）。

---

## 設計判断（レビューで確認する決定表）

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| 1 | PLC入力 Xn の電気モデル | `PLC.SS`–`PLC.Xn` 間の `load`（`LoadKind: 'plcInput'`、FX5U は 4.5kΩ）。**電流の絶対値**が `onAmps`(3.5mA) 以上で ON、`offAmps`(1.5mA) 以下で OFF、その間は直前を保持 | §4.4 / §5.1.3 のとおり。絶対値を見るのでシンク結線（`P`→`SS`）とソース結線（`N`→`SS`）が同じコードで成立する（§10.2 は両方を許す）。電流の向きで分岐すると、どちらの結線でも動くという仕様の要求を満たすために二重の実装が要る |
| 2 | PLC出力 Yn の電気モデル | `PLC.Yn`–`PLC.COMg` 間の `contact`（`driver: 'external'`、a接点）。`Simulation.setPlcOutputs()` が `energized` を書く | `applyContacts()` はリレー／タイマ駆動の接点しか触らないので（前提#5）、`'external'` の接点は外から書いた値がそのまま次の `solve()` に効く。エンジンの tick 処理に PLC 専用の分岐を足さずに済む |
| 3 | PLC電源 L/N | 電気的に解かない端子（要素を持たない）。`OUTLET.L` / `OUTLET.N` への配線の有無だけを静的チェックで見る | §4.4「AC非対応のため電気的には解かない」。AC電源要素を足すと `circuit-sim` に交流の概念が入り、§5.2「交流は扱わない」に反する |
| 4 | スキャンと tick の結合点 | `@ojt/content` の `runner.ts` に `beforeTick` フックを足し、`plc-io.ts` の `createPlcCoupling()` が「読む→実行→書く」を1 tick に1回行う | §4.2 の依存方向（`ladder-core` は `circuit-sim` と独立、`circuit-sim` は `board-model` を知らない）を守れる唯一の位置。`Simulation` にランタイムを持たせる案は依存が逆流する |
| 5 | `Device.index` の意味 | 0起点の通し番号。8進・10進・16進は `DialectProfile.formatDevice()` / `parseDevice()` の担当 | §10.5 が「方言＝デバイス表記の差分」と定義している。IRに8進の桁を入れると、Phase 4 で16進の TOYOPUC（`1X000`）を足すときにIRを触ることになり §17.1 の「修正箇所は方言プロファイルのみ」が崩れる |
| 6 | 「変換」（`convert`）の置き場所 | 構造検査（コイル列・END・グリッド形状・二重コイル）は `ladder-core` の `compile()`、デバイス範囲・8進表記・タイマ単位の検査は `DialectProfile.validate()`、両者を束ねた「変換」は `plc-dialects` の `convert()` | 構造の正しさは方言によらない。方言に依る検査だけをプロファイルに置けば、Phase 4 は1ファイル追加で済む |
| 7 | 判定は方言に依存させない | `judgePlc()` は `compile()` だけを使い、`plc-dialects` を import しない | §4.2 の依存グラフに `content → plc-dialects` の辺は無い。同じIRはどの方言で書いても同じ動作をする（決定事項#15 の「共通エンジン＋スキン」）ので、判定に方言は不要。方言バリデータは Plan 3B が「変換」ボタンで走らせる |
| 8 | PLC本体を盤モデルにどう載せるか | `withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U)` が `plcUnit` と `PLC.*` / `OUTLET.*` の端子を足した**同じ `id` の派生 `BoardDefinition`** を返す | セッションは `boardId` で盤と照合するので `id` は変えられない。`extraParts` 方式（BZと同じ）は機種ごとに端子集合が変わる Phase 4 で破綻する。派生関数なら機種ぶんの定義を並べるだけで済む |
| 9 | 机上配線（盤 ⇄ PLC）の3D経路 | `routeSession()` からは**除外**し、`deskWires()` で別に返す（3Dは Plan 3B が直線ケーブルとして描く） | 盤の配線帯（§6.6）は盤面上の座標系で定義されており、机上の本体まで伸ばすと帯・レーン・占有矩形の不変条件（Plan 1B のテスト）が壊れる。除外すれば既存の経路テストは一切変わらない |
| 10 | モードDの模範回路 | 回路図（`SchematicDoc`）ではなく、**I/O割付から模範配線を生成する**（`plc-reference.ts`） | PLC端子は展開接続図の語彙（§11.1 の要素一覧）に無い。§7.6 もモードDには `referenceLadder` しか要求していない。割付から生成すれば `io.mode: 'free'` の課題でも模範側は常に既定割付で組める |
| 11 | 母線の分配 | `P.1` / `N.1` の空き1本から鎖状に渡す（`chainWires()`）。順序は「PLCのコモン → リレー → ランプ」で決定論的 | §6.3 のとおり `P.1` / `N.1` は既設配線で各1本埋まっている。§11.3・§17.2 #33 の渡り配線をそのまま実装する |
| 12 | 内蔵課題の題材 | 2級形式（入力3・出力3）: 自己保持／インターロック／ONディレー／ワンショット、1級形式（入力3・出力4）: 順次点灯／フリッカ／カウンタ／停止優先 | §7.9（D=1級形式4＋2級形式4）と §17.2 #8（1級の1題はカウンタで押した回数による順次動作）。有接点のモードB 8題（§7.9）と同じ題材を PLC で組み直す構成にして、教材としての対応が取れるようにする |
| 13 | `UNSUPPORTED_MODES` | 空タプル `[]` にし、`UnsupportedProblemSchema` と `reason: 'unsupported-mode'` の分岐を**削除**する | 4モードすべてが開始できるようになる（§16 Phase 3）。空の `z.enum([])` は zod で意味を持たないため、スキーマごと外すのが正しい。`ProblemFailureReason` から `'unsupported-mode'` を落とすと 2B の型が壊れるので、**列挙型には残す**（もう発行されない旨をコメントに書く） |

---
## Task 1: `@ojt/ladder-core` の雛形とラダーIR

**Files:**
- Create: `packages/ladder-core/package.json`
- Create: `packages/ladder-core/tsconfig.json`
- Create: `packages/ladder-core/vitest.config.ts`
- Create: `packages/ladder-core/src/ir.ts`
- Create: `packages/ladder-core/src/index.ts`
- Test: `packages/ladder-core/test/ir.test.ts`

§10.3 のラダーIRを、ベンダー中立のデータモデルとして定義する。方言（8進表記・命令語）も実行（スキャン）もこのファイルには入らない。`Cell` の種別と `Device` の形は §10.3 のコード片をそのまま写し、課題JSON（Task 11）と `compile()`（Task 2）が同じ型を見る。

| 決めること | 本タスクの実装 |
|---|---|
| 列数 | `IR_COLS = 16` 固定、`COIL_COL = 15`（最終列＝コイル列）。表示列数はスキンの責務で、IRは常に16列（§10.3） |
| 行数 | `MAX_ROWS = 12`（本アプリ既定。1ネットワークに12段より深い分岐は書かない） |
| デバイス番号 | `Device.index` は0起点の通し番号（決定表#5）。`deviceLabel()` はベンダー中立表記（`X0` / `Y1` / `M10` / `T0` / `C0` / `SP0`）を返す |
| 縦線の意味 | `vline` は **セルの左辺にある縦の渡り**で、`(row, col)` と `(row+1, col)` の左辺どうしを繋ぐ。**セル自身は横線としても導通する**（実機のラダーでも縦線は「横に走る母線の途中から下へ渡る」形で描かれる）。したがって分岐は「上の行の分岐点に `vline`、下の行は分岐接点だけ」と書く |
| 組み立て | `network(id, rows)` が各行を `empty()` で16列に詰める。課題JSONもテストも同じヘルパで書けるようにする |

- [ ] **Step 1: 失敗するテストを書く**

`packages/ladder-core/package.json`:

```json
{
  "name": "@ojt/ladder-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`packages/ladder-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

`packages/ladder-core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
```

`packages/ladder-core/test/ir.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  C,
  COIL_COL,
  cellAt,
  ctu,
  device,
  deviceKey,
  deviceLabel,
  empty,
  end,
  endNetwork,
  fall,
  hline,
  IR_COLS,
  LadderError,
  M,
  MAX_ROWS,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  rise,
  rst,
  sameDevice,
  set,
  SP,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  T,
  ton,
  vline,
  X,
  Y,
} from '../src/index.js';

describe('device', () => {
  it('builds the six device kinds with a zero-based index (§10.3)', () => {
    expect(X(0)).toEqual({ kind: 'input', index: 0 });
    expect(Y(3)).toEqual({ kind: 'output', index: 3 });
    expect(M(100)).toEqual({ kind: 'internal', index: 100 });
    expect(T(1)).toEqual({ kind: 'timer', index: 1 });
    expect(C(2)).toEqual({ kind: 'counter', index: 2 });
    expect(SP(SPECIAL_ALWAYS_ON)).toEqual({ kind: 'special', index: 0 });
  });

  it('numbers the three special devices (§10.3)', () => {
    expect([SPECIAL_ALWAYS_ON, SPECIAL_FIRST_SCAN, SPECIAL_CLOCK_1S]).toEqual([0, 1, 2]);
  });

  it('rejects a negative or fractional index', () => {
    expect(() => device('input', -1)).toThrow(LadderError);
    expect(() => device('internal', 1.5)).toThrow(LadderError);
  });

  it('formats a vendor-neutral label and a comparable key', () => {
    expect(deviceLabel(X(8))).toBe('X8');
    expect(deviceLabel(SP(2))).toBe('SP2');
    expect(deviceKey(T(0))).toBe('timer:0');
    expect(sameDevice(M(1), M(1))).toBe(true);
    expect(sameDevice(M(1), Y(1))).toBe(false);
  });
});

describe('cell builders', () => {
  it('builds contacts, coils, a timer and a counter (§10.3)', () => {
    expect(no(X(0))).toEqual({ kind: 'contact', type: 'NO', device: X(0) });
    expect(nc(X(1))).toEqual({ kind: 'contact', type: 'NC', device: X(1) });
    expect(rise(X(2))).toEqual({ kind: 'contact', type: 'P', device: X(2) });
    expect(fall(X(2))).toEqual({ kind: 'contact', type: 'F', device: X(2) });
    expect(out(Y(0))).toEqual({ kind: 'coil', type: 'OUT', device: Y(0) });
    expect(set(M(0))).toEqual({ kind: 'coil', type: 'SET', device: M(0) });
    expect(rst(M(0))).toEqual({ kind: 'coil', type: 'RST', device: M(0) });
    expect(ton(T(0), 3000)).toEqual({ kind: 'timer', type: 'TON', device: T(0), presetMs: 3000 });
    expect(ctu(C(0), 3, X(1))).toEqual({
      kind: 'counter',
      type: 'CTU',
      device: C(0),
      preset: 3,
      resetDevice: X(1),
    });
    expect(mc(M(9))).toEqual({ kind: 'mc', device: M(9) });
    expect(mcr(M(9))).toEqual({ kind: 'mcr', device: M(9) });
    expect(end()).toEqual({ kind: 'end' });
    expect(hline()).toEqual({ kind: 'hline' });
    expect(vline()).toEqual({ kind: 'vline' });
  });

  it('returns a fresh object every time so cells are never shared', () => {
    expect(empty()).not.toBe(empty());
    expect(hline()).not.toBe(hline());
  });
});

describe('network', () => {
  it('pads every row to IR_COLS with empty cells (§10.3)', () => {
    const net = network('n1', [[no(X(0)), hline(), out(Y(0))]]);
    expect(net.rows).toBe(1);
    expect(net.cols).toBe(IR_COLS);
    expect(net.cells[0]).toHaveLength(IR_COLS);
    expect(cellAt(net, 0, 0)).toEqual(no(X(0)));
    expect(cellAt(net, 0, 15)).toEqual(empty());
    expect(COIL_COL).toBe(15);
  });

  it('keeps a comment when one is given', () => {
    const net = network('n1', [[out(Y(0))]], { comment: '自己保持' });
    expect(net.comment).toBe('自己保持');
    expect(network('n2', [[out(Y(0))]]).comment).toBeUndefined();
  });

  it('rejects an empty grid, too many rows and a row wider than IR_COLS', () => {
    expect(() => network('n1', [])).toThrow(LadderError);
    expect(() => network('n1', Array.from({ length: MAX_ROWS + 1 }, () => [hline()]))).toThrow(
      LadderError,
    );
    expect(() => network('n1', [Array.from({ length: IR_COLS + 1 }, () => hline())])).toThrow(
      LadderError,
    );
  });

  it('rejects a cell read outside the grid', () => {
    const net = network('n1', [[out(Y(0))]]);
    expect(() => cellAt(net, 1, 0)).toThrow(LadderError);
    expect(() => cellAt(net, 0, IR_COLS)).toThrow(LadderError);
  });

  it('builds the END network as a single cell (§10.3)', () => {
    const net = endNetwork();
    expect(net.id).toBe('end');
    expect(cellAt(net, 0, 0)).toEqual(end());
    expect(cellAt(net, 0, 1)).toEqual(empty());
  });
});

describe('program', () => {
  it('collects networks in order', () => {
    const p = program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
    expect(p.networks).toHaveLength(2);
    expect(p.networks[0]?.id).toBe('n1');
    expect(p.networks[1]?.id).toBe('end');
  });

  it('rejects duplicated network ids', () => {
    expect(() => program(network('n1', [[out(Y(0))]]), network('n1', [[out(Y(1))]]))).toThrow(
      LadderError,
    );
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm install
pnpm --filter @ojt/ladder-core exec vitest run test/ir.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/index.js`（`src/index.ts` も `src/ir.ts` もまだ無いため `Test Files  1 failed (1)`）。`pnpm install` は新しいワークスペースパッケージをリンクするために必要で、これを忘れると `--filter @ojt/ladder-core` が `No projects matched the filters` で終わる。

- [ ] **Step 3: `src/ir.ts` を書く**

`packages/ladder-core/src/ir.ts`:

```ts
/**
 * ラダーIR（中間表現）。設計仕様 §10.3。
 *
 * ベンダー中立のデータモデルであり、8進・16進といったデバイス表記も、命令語も、
 * 表示上の列数も持たない（それらは `@ojt/plc-dialects` の責務。§10.5）。
 * IRは常に `IR_COLS`（16列）で、最終列 `COIL_COL` がコイル列である。スキンが表示列数を
 * 狭めてもIRは16列のまま保持されるのでプログラムは失われない（§10.3）。
 */

/** IRの列数（最終列がコイル列）。§10.3 */
export const IR_COLS = 16;

/** コイル列の列番号（0起点）。§10.3 */
export const COIL_COL = IR_COLS - 1;

/** 1ネットワークの最大行数（本アプリ既定）。 */
export const MAX_ROWS = 12;

/** 常時ONの特殊デバイス番号（三菱の M8000 相当）。§10.3 */
export const SPECIAL_ALWAYS_ON = 0;
/** 初期パルスの特殊デバイス番号（M8002 相当）。§10.3 */
export const SPECIAL_FIRST_SCAN = 1;
/** 1秒クロックの特殊デバイス番号（M8013 相当）。§10.3 */
export const SPECIAL_CLOCK_1S = 2;

/** 特殊デバイス番号の一覧（この3つ以外は使わない）。§10.3 */
export const SPECIAL_INDEXES: readonly number[] = [
  SPECIAL_ALWAYS_ON,
  SPECIAL_FIRST_SCAN,
  SPECIAL_CLOCK_1S,
];

/** IRの組み立てに失敗したときに投げる。 */
export class LadderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LadderError';
  }
}

/** デバイス種別。§10.3 */
export type DeviceKind = 'input' | 'output' | 'internal' | 'timer' | 'counter' | 'special';

/** デバイス（種別＋0起点の通し番号）。§10.3 */
export interface Device {
  kind: DeviceKind;
  index: number;
}

/** 接点種別。NO=a接点、NC=b接点、P=立上り、F=立下り。§10.3 */
export type ContactType = 'NO' | 'NC' | 'P' | 'F';

/** コイル種別。§10.3 */
export type CoilType = 'OUT' | 'SET' | 'RST';

/** セル。§10.3 */
export type Cell =
  | { kind: 'contact'; type: ContactType; device: Device }
  | { kind: 'coil'; type: CoilType; device: Device }
  | { kind: 'timer'; type: 'TON'; device: Device; presetMs: number }
  | { kind: 'counter'; type: 'CTU'; device: Device; preset: number; resetDevice: Device }
  | { kind: 'mc'; device: Device }
  | { kind: 'mcr'; device: Device }
  | { kind: 'end' }
  | { kind: 'hline' }
  | { kind: 'vline' }
  | { kind: 'empty' };

/** 出力位置に置くセル（コイル列に置く）。 */
export type OutputCell = Extract<Cell, { kind: 'coil' | 'timer' | 'counter' | 'mc' | 'mcr' }>;

/** ネットワーク（セルグリッド）。§10.3 */
export interface Network {
  id: string;
  comment?: string;
  rows: number;
  cols: number;
  cells: Cell[][];
}

/** ラダープログラム（ネットワークの列）。§10.3 */
export interface LadderProgram {
  networks: Network[];
}

/** デバイス種別 → ベンダー中立の接頭辞。 */
export const DEVICE_PREFIX: Readonly<Record<DeviceKind, string>> = {
  input: 'X',
  output: 'Y',
  internal: 'M',
  timer: 'T',
  counter: 'C',
  special: 'SP',
};

/** デバイスを作る。番号は0以上の整数、特殊デバイスは `SPECIAL_INDEXES` の3つだけ。 */
export function device(kind: DeviceKind, index: number): Device {
  if (!Number.isInteger(index) || index < 0) {
    throw new LadderError(`デバイス番号は0以上の整数です: ${DEVICE_PREFIX[kind]}${index}`);
  }
  if (kind === 'special' && !SPECIAL_INDEXES.includes(index)) {
    throw new LadderError(`特殊デバイスは SP0／SP1／SP2 のみです: SP${index}`);
  }
  return { kind, index };
}

/** 入力デバイス（Xn 相当）。 */
export function X(index: number): Device {
  return device('input', index);
}
/** 出力デバイス（Yn 相当）。 */
export function Y(index: number): Device {
  return device('output', index);
}
/** 内部リレー（Mn 相当）。 */
export function M(index: number): Device {
  return device('internal', index);
}
/** タイマ（Tn 相当）。 */
export function T(index: number): Device {
  return device('timer', index);
}
/** カウンタ（Cn 相当）。 */
export function C(index: number): Device {
  return device('counter', index);
}
/** 特殊デバイス（常時ON／初期パルス／1秒クロック）。 */
export function SP(index: number): Device {
  return device('special', index);
}

/** ベンダー中立のデバイス表記（`X0` / `T1` / `SP2`）。方言表記は `DialectProfile.formatDevice()`。 */
export function deviceLabel(d: Device): string {
  return `${DEVICE_PREFIX[d.kind]}${d.index}`;
}

/** Map のキーに使えるデバイス識別子。 */
export function deviceKey(d: Device): string {
  return `${d.kind}:${d.index}`;
}

/** 同じデバイスか。 */
export function sameDevice(a: Device, b: Device): boolean {
  return a.kind === b.kind && a.index === b.index;
}

/** a接点。 */
export function no(d: Device): Cell {
  return { kind: 'contact', type: 'NO', device: d };
}
/** b接点。 */
export function nc(d: Device): Cell {
  return { kind: 'contact', type: 'NC', device: d };
}
/** 立上り微分接点。 */
export function rise(d: Device): Cell {
  return { kind: 'contact', type: 'P', device: d };
}
/** 立下り微分接点。 */
export function fall(d: Device): Cell {
  return { kind: 'contact', type: 'F', device: d };
}
/** OUTコイル。 */
export function out(d: Device): Cell {
  return { kind: 'coil', type: 'OUT', device: d };
}
/** SETコイル（保持）。 */
export function set(d: Device): Cell {
  return { kind: 'coil', type: 'SET', device: d };
}
/** RSTコイル（保持の解除）。 */
export function rst(d: Device): Cell {
  return { kind: 'coil', type: 'RST', device: d };
}
/** オンディレータイマ。設定値はmsで持つ（方言表記への変換は `timerPreset()`）。§10.3 */
export function ton(d: Device, presetMs: number): Cell {
  return { kind: 'timer', type: 'TON', device: d, presetMs };
}
/** 加算カウンタ。 */
export function ctu(d: Device, preset: number, resetDevice: Device): Cell {
  return { kind: 'counter', type: 'CTU', device: d, preset, resetDevice };
}
/** マスターコントロール開始。 */
export function mc(d: Device): Cell {
  return { kind: 'mc', device: d };
}
/** マスターコントロール終了。 */
export function mcr(d: Device): Cell {
  return { kind: 'mcr', device: d };
}
/** プログラム終端。 */
export function end(): Cell {
  return { kind: 'end' };
}
/** 横線（無条件に導通する）。 */
export function hline(): Cell {
  return { kind: 'hline' };
}
/**
 * 縦線（セルの左辺で下の行と繋ぐ渡り）。**セル自身は横線としても導通する**ので、
 * 分岐は「上の行の分岐点に `vline`、下の行は分岐接点だけ」と書く。§10.3
 */
export function vline(): Cell {
  return { kind: 'vline' };
}
/** 空セル。 */
export function empty(): Cell {
  return { kind: 'empty' };
}

/** セルが出力位置（コイル列）に置くものか。 */
export function isOutputCell(cell: Cell): cell is OutputCell {
  return (
    cell.kind === 'coil' ||
    cell.kind === 'timer' ||
    cell.kind === 'counter' ||
    cell.kind === 'mc' ||
    cell.kind === 'mcr'
  );
}

/** ネットワーク生成オプション。 */
export interface NetworkOptions {
  comment?: string;
}

/**
 * ネットワークを作る。各行は `IR_COLS` まで空セルで詰める。§10.3
 * 行数は1以上 `MAX_ROWS` 以下、1行の長さは `IR_COLS` 以下でなければならない。
 */
export function network(
  id: string,
  rows: readonly (readonly Cell[])[],
  options: NetworkOptions = {},
): Network {
  if (id.length === 0) throw new LadderError('ネットワークIDが空です');
  if (rows.length === 0) throw new LadderError(`ネットワーク ${id} に行がありません`);
  if (rows.length > MAX_ROWS) {
    throw new LadderError(`ネットワーク ${id} の行数が上限（${MAX_ROWS}）を超えています`);
  }
  const cells: Cell[][] = rows.map((row) => {
    if (row.length > IR_COLS) {
      throw new LadderError(`ネットワーク ${id} の列数が上限（${IR_COLS}）を超えています`);
    }
    const padded: Cell[] = [...row];
    while (padded.length < IR_COLS) padded.push(empty());
    return padded;
  });
  return {
    id,
    ...(options.comment === undefined ? {} : { comment: options.comment }),
    rows: cells.length,
    cols: IR_COLS,
    cells,
  };
}

/** END だけのネットワークを作る。§10.3 */
export function endNetwork(id = 'end'): Network {
  return network(id, [[end()]]);
}

/** セルを読む。グリッドの外はエラー（`noUncheckedIndexedAccess` の undefined をここで潰す）。 */
export function cellAt(net: Network, row: number, col: number): Cell {
  const cell = net.cells[row]?.[col];
  if (cell === undefined) {
    throw new LadderError(`ネットワーク ${net.id} の範囲外です: (${row}, ${col})`);
  }
  return cell;
}

/** プログラムを作る。ネットワークIDは重複してはならない。 */
export function program(...networks: Network[]): LadderProgram {
  const seen = new Set<string>();
  for (const net of networks) {
    if (seen.has(net.id)) throw new LadderError(`ネットワークIDが重複しています: ${net.id}`);
    seen.add(net.id);
  }
  return { networks: [...networks] };
}
```

`packages/ladder-core/src/index.ts`:

```ts
export {
  C,
  cellAt,
  COIL_COL,
  ctu,
  device,
  DEVICE_PREFIX,
  deviceKey,
  deviceLabel,
  empty,
  end,
  endNetwork,
  fall,
  hline,
  IR_COLS,
  isOutputCell,
  LadderError,
  M,
  MAX_ROWS,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  rise,
  rst,
  sameDevice,
  set,
  SP,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  SPECIAL_INDEXES,
  T,
  ton,
  vline,
  X,
  Y,
  type Cell,
  type ContactType,
  type CoilType,
  type Device,
  type DeviceKind,
  type LadderProgram,
  type Network,
  type NetworkOptions,
  type OutputCell,
} from './ir.js';
```

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/ir.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  13 passed (13)`。

- [ ] **Step 5: 型と書式を確認する**

```powershell
pnpm --filter @ojt/ladder-core typecheck
npx prettier --check "packages/ladder-core/**/*.{ts,json}"
```

Expected: いずれも無警告（`All matched files use Prettier code style!`）。

- [ ] **Step 6: コミットする**

```powershell
git add packages/ladder-core
git commit -m "feat(ladder-core): add the ladder IR types and builders"
```

---

## Task 1b: `edit.ts` — ラダーIRの編集API

**Files:**
- Create: `packages/ladder-core/src/edit.ts`
- Modify: `packages/ladder-core/src/index.ts`
- Test: `packages/ladder-core/test/edit.test.ts`

Plan 3B のラダーエディタ（§10.7）が要る「セルを置く・消す・行を足す・行を消す・ネットワークを足す・消す・罫線を引く」を、**純粋関数**として `ladder-core` 側に置く。UIがIRを直接書き換えると取り消し／やり直しが作れないので、**渡されたプログラムは一切書き換えず新しいプログラムを返す**のが唯一の約束である。

| 決めること | 本タスクの実装 |
|---|---|
| 不変性 | 変更しなかったネットワークと行は**同じ参照のまま**新しい配列に入れる（浅いコピー）。3Bは戻り値をそのままスナップショットとして積める |
| 範囲外 | 行・列・ネットワークIDが無ければ `LadderError` を投げる（黙って無視しない。§13 #1 と同じ方針） |
| 罫線 | `setVerticalLink()` は**空セル・横線・縦線の上にだけ**引ける。接点やコイルを罫線で潰せないようにする。最終行の下には引けない |
| 行数・列数 | 行の挿入は `MAX_ROWS` まで。列は `IR_COLS` 固定なので増減させる操作は作らない（§10.3） |
| 空プログラム | 最後のネットワークも削除できる。空のままでは `compile()` が `empty-program` を返すので、UIはその結果を出力ウィンドウに出せばよい |

- [ ] **Step 1: 失敗するテストを書く**

`packages/ladder-core/test/edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cellAt,
  clearCell,
  deleteNetwork,
  deleteRow,
  empty,
  endNetwork,
  hline,
  insertNetwork,
  insertRow,
  IR_COLS,
  LadderError,
  MAX_ROWS,
  network,
  no,
  out,
  program,
  setCell,
  setVerticalLink,
  X,
  Y,
  type LadderProgram,
  type Network,
} from '../src/index.js';

/** ネットワークを取り出す（`noUncheckedIndexedAccess` の undefined をここで潰す）。 */
function netAt(source: LadderProgram, index: number): Network {
  const found = source.networks[index];
  if (found === undefined) throw new Error(`ネットワーク ${index} がありません`);
  return found;
}

/** 2行のネットワーク1つと END。 */
function base(): LadderProgram {
  return program(
    network('n1', [
      [no(X(0)), hline(), out(Y(0))],
      [no(X(1))],
    ]),
    endNetwork(),
  );
}

describe('setCell / clearCell', () => {
  it('replaces one cell and leaves the source program untouched', () => {
    const before = base();
    const after = setCell(before, 'n1', 0, 1, no(X(2)));
    expect(cellAt(netAt(after, 0), 0, 1)).toEqual(no(X(2)));
    // 元のプログラムは書き換わらない
    expect(cellAt(netAt(before, 0), 0, 1)).toEqual(hline());
    expect(after).not.toBe(before);
  });

  it('keeps the untouched networks and rows by reference', () => {
    const before = base();
    const after = setCell(before, 'n1', 0, 1, no(X(2)));
    expect(after.networks[1]).toBe(before.networks[1]);
    expect(after.networks[0]?.cells[1]).toBe(before.networks[0]?.cells[1]);
  });

  it('clears a cell back to empty', () => {
    const after = clearCell(base(), 'n1', 0, 0);
    expect(cellAt(netAt(after, 0), 0, 0)).toEqual(empty());
  });

  it('throws for an unknown network id', () => {
    expect(() => setCell(base(), 'nope', 0, 0, hline())).toThrow(LadderError);
  });

  it('throws for a row or column outside the grid', () => {
    expect(() => setCell(base(), 'n1', 2, 0, hline())).toThrow(LadderError);
    expect(() => setCell(base(), 'n1', 0, IR_COLS, hline())).toThrow(LadderError);
  });
});

describe('setVerticalLink（罫線）', () => {
  it('draws a vertical link and removes it again', () => {
    const drawn = setVerticalLink(base(), 'n1', 0, 1, true);
    expect(cellAt(netAt(drawn, 0), 0, 1).kind).toBe('vline');
    const erased = setVerticalLink(drawn, 'n1', 0, 1, false);
    expect(cellAt(netAt(erased, 0), 0, 1)).toEqual(empty());
  });

  it('refuses to draw over a contact or a coil', () => {
    expect(() => setVerticalLink(base(), 'n1', 0, 0, true)).toThrow(LadderError);
    expect(() => setVerticalLink(base(), 'n1', 0, 2, true)).toThrow(LadderError);
  });

  it('refuses to draw below the last row', () => {
    expect(() => setVerticalLink(base(), 'n1', 1, 1, true)).toThrow(LadderError);
  });
});

describe('insertRow / deleteRow', () => {
  it('inserts an empty row at the given index', () => {
    const after = insertRow(base(), 'n1', 1);
    expect(after.networks[0]?.rows).toBe(3);
    expect(after.networks[0]?.cells[1]).toHaveLength(IR_COLS);
    expect(cellAt(netAt(after, 0), 1, 0)).toEqual(empty());
    // 元の2行目は3行目にずれる
    expect(cellAt(netAt(after, 0), 2, 0)).toEqual(no(X(1)));
  });

  it('refuses to grow a network past MAX_ROWS', () => {
    let grown = base();
    while ((grown.networks[0]?.rows ?? 0) < MAX_ROWS) grown = insertRow(grown, 'n1', 1);
    expect(grown.networks[0]?.rows).toBe(MAX_ROWS);
    expect(() => insertRow(grown, 'n1', 1)).toThrow(LadderError);
  });

  it('deletes a row but never the last one', () => {
    const after = deleteRow(base(), 'n1', 1);
    expect(after.networks[0]?.rows).toBe(1);
    expect(() => deleteRow(after, 'n1', 0)).toThrow(LadderError);
  });
});

describe('insertNetwork / deleteNetwork', () => {
  it('inserts a network at the given position', () => {
    const added = insertNetwork(base(), 1, network('n2', [[no(X(3)), out(Y(1))]]));
    expect(added.networks.map((net) => net.id)).toEqual(['n1', 'n2', 'end']);
  });

  it('refuses a duplicated network id and an impossible position', () => {
    expect(() => insertNetwork(base(), 0, network('n1', [[hline()]]))).toThrow(LadderError);
    expect(() => insertNetwork(base(), 9, network('n2', [[hline()]]))).toThrow(LadderError);
  });

  it('deletes a network and throws for an unknown id', () => {
    const after = deleteNetwork(base(), 'n1');
    expect(after.networks.map((net) => net.id)).toEqual(['end']);
    expect(() => deleteNetwork(after, 'n1')).toThrow(LadderError);
  });
});

describe('連続した編集', () => {
  it('keeps every row rectangular（`rows` × `IR_COLS`）after a series of edits', () => {
    let edited = insertRow(base(), 'n1', 1);
    edited = setCell(edited, 'n1', 1, 0, no(Y(0)));
    edited = setVerticalLink(edited, 'n1', 0, 1, true);
    edited = deleteRow(edited, 'n1', 2);
    for (const net of edited.networks) {
      expect(net.cells).toHaveLength(net.rows);
      for (const line of net.cells) expect(line).toHaveLength(IR_COLS);
      expect(net.cols).toBe(IR_COLS);
    }
    expect(cellAt(netAt(edited, 0), 1, 0)).toEqual(no(Y(0)));
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/edit.test.ts
```

Expected: 失敗。`SyntaxError: The requested module '../src/index.js' does not provide an export named 'setCell'`。

- [ ] **Step 3: `src/edit.ts` を書く**

```ts
import {
  cellAt,
  empty,
  IR_COLS,
  LadderError,
  MAX_ROWS,
  vline,
  type Cell,
  type LadderProgram,
  type Network,
} from './ir.js';

/**
 * ラダーIRの編集API。設計仕様 §10.3 / §10.7。
 *
 * すべて純粋関数である。渡されたプログラムは書き換えず、新しいプログラムを返す。
 * 変更しなかったネットワークと行は同じ参照のまま新しい配列に入れるので、
 * Plan 3B は戻り値をそのまま取り消し／やり直しのスナップショットに積める。
 */

/** ネットワークとその位置を探す（無ければ `LadderError`）。 */
function locate(program: LadderProgram, networkId: string): { index: number; net: Network } {
  const index = program.networks.findIndex((candidate) => candidate.id === networkId);
  const net = program.networks[index];
  if (index < 0 || net === undefined) {
    throw new LadderError(`ネットワークがありません: ${networkId}`);
  }
  return { index, net };
}

/** ネットワークを差し替えた新しいプログラムを返す。 */
function replaceNetwork(program: LadderProgram, index: number, next: Network): LadderProgram {
  const networks = [...program.networks];
  networks[index] = next;
  return { networks };
}

/** 行・列が範囲内か。 */
function assertCellAt(net: Network, row: number, col: number): void {
  if (!Number.isInteger(row) || row < 0 || row >= net.rows) {
    throw new LadderError(`ネットワーク ${net.id} に行 ${row} はありません`);
  }
  if (!Number.isInteger(col) || col < 0 || col >= net.cols) {
    throw new LadderError(`ネットワーク ${net.id} に列 ${col} はありません`);
  }
}

/** 空の1行。 */
function emptyRow(): Cell[] {
  return Array.from({ length: IR_COLS }, () => empty());
}

/** セルを置き換える。§10.3 */
export function setCell(
  program: LadderProgram,
  networkId: string,
  row: number,
  col: number,
  cell: Cell,
): LadderProgram {
  const { index, net } = locate(program, networkId);
  assertCellAt(net, row, col);
  const cells = net.cells.map((line, r) =>
    r === row ? line.map((current, c) => (c === col ? cell : current)) : line,
  );
  return replaceNetwork(program, index, { ...net, cells });
}

/** セルを空にする。 */
export function clearCell(
  program: LadderProgram,
  networkId: string,
  row: number,
  col: number,
): LadderProgram {
  return setCell(program, networkId, row, col, empty());
}

/**
 * 罫線（縦線）を引く／消す。§10.3
 * 縦線はセルそのものなので、接点やコイルの上には引けない（消すと回路が壊れるため）。
 */
export function setVerticalLink(
  program: LadderProgram,
  networkId: string,
  row: number,
  col: number,
  on: boolean,
): LadderProgram {
  const { net } = locate(program, networkId);
  assertCellAt(net, row, col);
  const current = cellAt(net, row, col);
  if (current.kind !== 'empty' && current.kind !== 'hline' && current.kind !== 'vline') {
    throw new LadderError(
      `罫線は空セル・横線・縦線の上にだけ引けます: ${net.id} (${row}, ${col}) は ${current.kind}`,
    );
  }
  if (on && row + 1 >= net.rows) {
    throw new LadderError(`ネットワーク ${net.id} の最終行（${row}）の下には罫線を引けません`);
  }
  return setCell(program, networkId, row, col, on ? vline() : empty());
}

/** 空の行を挿入する。 */
export function insertRow(program: LadderProgram, networkId: string, atRow: number): LadderProgram {
  const { index, net } = locate(program, networkId);
  if (!Number.isInteger(atRow) || atRow < 0 || atRow > net.rows) {
    throw new LadderError(`ネットワーク ${net.id} の行 ${atRow} には挿入できません`);
  }
  if (net.rows + 1 > MAX_ROWS) {
    throw new LadderError(`ネットワーク ${net.id} の行数が上限（${MAX_ROWS}）を超えます`);
  }
  const cells = [...net.cells.slice(0, atRow), emptyRow(), ...net.cells.slice(atRow)];
  return replaceNetwork(program, index, { ...net, rows: cells.length, cells });
}

/** 行を削除する（最後の1行は残す）。 */
export function deleteRow(program: LadderProgram, networkId: string, atRow: number): LadderProgram {
  const { index, net } = locate(program, networkId);
  assertCellAt(net, atRow, 0);
  if (net.rows <= 1) {
    throw new LadderError(`ネットワーク ${net.id} の最後の行は削除できません`);
  }
  const cells = net.cells.filter((_line, r) => r !== atRow);
  return replaceNetwork(program, index, { ...net, rows: cells.length, cells });
}

/** ネットワークを挿入する（IDの重複は不可）。 */
export function insertNetwork(
  program: LadderProgram,
  atIndex: number,
  net: Network,
): LadderProgram {
  if (!Number.isInteger(atIndex) || atIndex < 0 || atIndex > program.networks.length) {
    throw new LadderError(`ネットワークを位置 ${atIndex} には挿入できません`);
  }
  if (program.networks.some((existing) => existing.id === net.id)) {
    throw new LadderError(`ネットワークIDが重複しています: ${net.id}`);
  }
  return {
    networks: [...program.networks.slice(0, atIndex), net, ...program.networks.slice(atIndex)],
  };
}

/** ネットワークを削除する。 */
export function deleteNetwork(program: LadderProgram, networkId: string): LadderProgram {
  const { index } = locate(program, networkId);
  return { networks: program.networks.filter((_net, i) => i !== index) };
}
```

`packages/ladder-core/src/index.ts` に足す:

```ts
export {
  clearCell,
  deleteNetwork,
  deleteRow,
  insertNetwork,
  insertRow,
  setCell,
  setVerticalLink,
} from './edit.js';
```

- [ ] **Step 4: GREEN・型・書式を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/edit.test.ts
pnpm --filter @ojt/ladder-core typecheck
pnpm exec prettier --write packages/ladder-core/src/edit.ts packages/ladder-core/test/edit.test.ts
npx prettier --check "packages/ladder-core/**/*.{ts,json}"
```

Expected: `Test Files  1 passed (1)` / `Tests  14 passed (14)`、型と書式は無警告。

- [ ] **Step 5: コミットする**

```powershell
git add packages/ladder-core
git commit -m "feat(ladder-core): add the pure ladder IR editing API for the 3B editor"
```

---

## Task 2: `compile()` — 構造検査と実行形式への変換

**Files:**
- Create: `packages/ladder-core/src/compile.ts`
- Modify: `packages/ladder-core/src/index.ts`
- Test: `packages/ladder-core/test/compile.test.ts`

「変換」（§10.6）の**方言に依らない半分**である。グリッドの形・コイル列・END・MC/MCR の対応・タイマ設定値を検査し、実行時に使う索引（出力セルの位置、デバイス使用表）を作る。デバイス範囲や8進表記の検査は方言の担当なので、ここでは一切見ない（決定表#6）。

| 検査 | コード | 判定 |
|---|---|---|
| ネットワークが1つも無い | `empty-program` | エラー |
| `cells` の形が `rows × cols` と食い違う／`cols !== IR_COLS` | `grid-shape` | エラー |
| `end` セルが無い | `missing-end` | エラー |
| `end` より後ろに空でないセルがある | `after-end` | エラー |
| 出力セル（コイル／タイマ／カウンタ／MC／MCR）がコイル列以外にある | `coil-column` | エラー |
| コイル列に接点・横線・縦線がある | `contact-in-coil-column` | エラー |
| END以外のネットワークに出力セルが1つも無い | `no-output` | エラー |
| 最終行に縦線がある（繋ぐ相手が無い） | `dangling-vline` | エラー |
| タイマ設定値が10msの正の倍数でない／1時間を超える | `timer-preset` | エラー |
| カウンタ設定値が1以上の整数でない | `counter-preset` | エラー |
| MC と MCR が対応していない | `mc-unmatched` | エラー |
| 同じデバイスへの OUT コイル／タイマ／カウンタが2回以上 | `double-coil` | **警告**（実行は後勝ち。§10.4） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/ladder-core/test/compile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  C,
  compile,
  ctu,
  end,
  endNetwork,
  hline,
  IR_COLS,
  M,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  rst,
  set,
  T,
  ton,
  vline,
  X,
  Y,
  type Cell,
  type CompileError,
  type LadderProgram,
} from '../src/index.js';

/** 最後のセルをコイル列（15列目）に置き、手前を横線で埋めた1行を作る。 */
function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const coil = row.pop();
  if (coil === undefined) throw new Error('コイルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(coil);
  return row;
}

/**
 * 自己保持（X0で入り、X1で切れ、Y0が自分を保持する）。
 * 0列目の分岐点に縦線を置き、下の行に自己保持接点 Y0 を並べる（縦線は横にも導通する）。
 * ```
 * row0: [X0(NO)][│＋横線][X1(NC)][横線 ×12][Y0(OUT)]
 * row1: [Y0(NO)]
 * ```
 */
function selfHold(): LadderProgram {
  return program(
    network('n1', [
      [
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: IR_COLS - 4 }, () => hline()),
        out(Y(0)),
      ],
      [no(Y(0))],
    ]),
    endNetwork(),
  );
}

function codes(errors: readonly CompileError[]): string[] {
  return errors.map((e) => e.code);
}

describe('compile', () => {
  it('accepts a self-hold program and indexes its output cells', () => {
    const result = compile(selfHold());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.program.networks).toHaveLength(2);
    expect(result.program.networks[0]?.outputs).toEqual([
      { row: 0, col: 15, cell: out(Y(0)) },
    ]);
    // END のネットワークは出力を持たない
    expect(result.program.networks[1]?.outputs).toEqual([]);
    expect(result.program.endNetworkIndex).toBe(1);
  });

  it('collects the devices the program reads and writes (§10.8 の未使用デバイス検出に使う)', () => {
    const result = compile(selfHold());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.usage.reads).toEqual([X(0), X(1), Y(0)]);
    expect(result.program.usage.writes).toEqual([Y(0)]);
    expect(result.program.inputCount).toBe(2);
    expect(result.program.outputCount).toBe(1);
  });

  it('rejects a program without END and one with cells after END (§10.3)', () => {
    const missing = compile(program(network('n1', [rung(no(X(0)), out(Y(0)))])));
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(codes(missing.errors)).toEqual(['missing-end']);

    const afterEnd = program(endNetwork(), network('n2', [rung(no(X(0)), out(Y(0)))]));
    const result = compile(afterEnd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.errors)).toContain('after-end');
  });

  it('requires output cells in the coil column and forbids contacts there', () => {
    const wrongColumn = program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
    const a = compile(wrongColumn);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toContain('coil-column');

    const contactInCoilColumn = program(
      network('n1', [[...Array.from({ length: IR_COLS }, () => no(X(0)))]]),
      endNetwork(),
    );
    const b = compile(contactInCoilColumn);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toContain('contact-in-coil-column');
  });

  it('rejects a network with no output and a vertical line on the last row', () => {
    const noOutput = program(network('n1', [[no(X(0)), hline()]]), endNetwork());
    const a = compile(noOutput);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toContain('no-output');

    // 最終行の縦線は繋ぐ相手が無い（下の行が存在しない）
    const b = compile(program(network('n1', [rung(no(X(0)), vline(), out(Y(0)))]), endNetwork()));
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toContain('dangling-vline');
    // 下に行があれば正しい分岐として通る
    expect(compile(selfHold()).ok).toBe(true);
  });

  it('rejects timer and counter presets that the runtime cannot honour (§10.4)', () => {
    const badTimer = program(network('n1', [rung(no(X(0)), ton(T(0), 15))]), endNetwork());
    const a = compile(badTimer);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toEqual(['timer-preset']);
    expect(a.errors[0]?.message).toContain('10ms');

    const badCounter = program(
      network('n1', [rung(no(X(0)), ctu(C(0), 0, X(1)))]),
      endNetwork(),
    );
    const b = compile(badCounter);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toEqual(['counter-preset']);
  });

  it('rejects MC without MCR and MCR without MC (§10.3)', () => {
    const open = program(network('n1', [rung(no(X(0)), mc(M(0)))]), endNetwork());
    const a = compile(open);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toEqual(['mc-unmatched']);

    const stray = program(network('n1', [rung(no(X(0)), mcr(M(0)))]), endNetwork());
    const b = compile(stray);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toEqual(['mc-unmatched']);
  });

  it('accepts a matched MC/MCR pair', () => {
    const p = program(
      network('n1', [rung(no(X(0)), mc(M(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      network('n3', [rung(no(X(0)), mcr(M(0)))]),
      endNetwork(),
    );
    expect(compile(p).ok).toBe(true);
  });

  it('warns about a double coil instead of failing (§10.4 は後勝ちで実行する)', () => {
    const p = program(
      network('n1', [rung(no(X(0)), out(Y(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      endNetwork(),
    );
    const result = compile(p);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('double-coil');
    expect(result.warnings[0]?.device).toEqual(Y(0));
    expect(result.warnings[0]?.networkId).toBe('n2');
  });

  it('does not warn when SET and RST share a device (保持命令は二重コイルではない)', () => {
    const result = compile(
      program(
        network('n1', [rung(no(X(0)), set(M(0)))]),
        network('n2', [rung(no(X(1)), rst(M(0)))]),
        network('n3', [rung(no(M(0)), out(Y(0)))]),
        endNetwork(),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it('rejects an empty program and a broken grid', () => {
    const emptyProgram = compile({ networks: [] });
    expect(emptyProgram.ok).toBe(false);
    if (emptyProgram.ok) return;
    expect(codes(emptyProgram.errors)).toEqual(['empty-program']);

    const broken = compile({
      networks: [{ id: 'n1', rows: 2, cols: IR_COLS, cells: [[end()]] }],
    });
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(codes(broken.errors)).toContain('grid-shape');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/compile.test.ts
```

Expected: 失敗。`SyntaxError: The requested module '../src/index.js' does not provide an export named 'compile'`。

- [ ] **Step 3: `src/compile.ts` を書く**

`packages/ladder-core/src/compile.ts`:

```ts
import {
  cellAt,
  COIL_COL,
  deviceKey,
  deviceLabel,
  IR_COLS,
  isOutputCell,
  type Cell,
  type Device,
  type LadderProgram,
  type Network,
  type OutputCell,
} from './ir.js';

/**
 * ラダーIRの構造検査と実行形式への変換。設計仕様 §10.3 / §10.4 / §10.6（「変換」の方言非依存部分）。
 *
 * デバイス番号の範囲・8進表記・タイマ単位といった**方言に依る検査はここでは行わない**
 * （`@ojt/plc-dialects` の `DialectProfile.validate()` の責務。§10.5）。
 */

/** タイマ設定値の刻み[ms]（＝スキャン周期）。§10.4 */
export const TIMER_STEP_MS = 10;
/** タイマ設定値の上限[ms]（1時間）。 */
export const MAX_TIMER_PRESET_MS = 3_600_000;
/** カウンタ設定値の上限。 */
export const MAX_COUNTER_PRESET = 32_767;

/** 変換エラーの種別。 */
export type CompileErrorCode =
  | 'empty-program'
  | 'grid-shape'
  | 'missing-end'
  | 'after-end'
  | 'coil-column'
  | 'contact-in-coil-column'
  | 'no-output'
  | 'dangling-vline'
  | 'timer-preset'
  | 'counter-preset'
  | 'mc-unmatched';

/** 変換エラー1件。UIは「出力ウィンドウ」に並べる（§10.6）。 */
export interface CompileError {
  code: CompileErrorCode;
  /** 該当ネットワークID（プログラム全体の誤りでは空文字）。 */
  networkId: string;
  row?: number;
  col?: number;
  message: string;
}

/** 変換警告1件（実行はできるが実機なら注意が要る）。§10.4 */
export interface CompileWarning {
  code: 'double-coil';
  networkId: string;
  row: number;
  col: number;
  device: Device;
  message: string;
}

/** 実行時に使う出力セルの索引。 */
export interface CompiledOutput {
  row: number;
  col: number;
  cell: OutputCell;
}

/** 実行形式のネットワーク。 */
export interface CompiledNetwork {
  id: string;
  rows: number;
  cols: number;
  cells: readonly (readonly Cell[])[];
  outputs: readonly CompiledOutput[];
  /** END だけのネットワークか。 */
  isEnd: boolean;
}

/** プログラムが読む／書くデバイス。§10.8 の未使用デバイス検出に使う。 */
export interface DeviceUsage {
  reads: readonly Device[];
  writes: readonly Device[];
}

/** 実行形式のプログラム。 */
export interface CompiledProgram {
  networks: readonly CompiledNetwork[];
  /** END を持つネットワークの位置（ここより後ろは実行しない）。 */
  endNetworkIndex: number;
  usage: DeviceUsage;
  /** 使っている入力点数（最大番号＋1）。 */
  inputCount: number;
  /** 使っている出力点数（最大番号＋1）。 */
  outputCount: number;
  source: LadderProgram;
}

/** 変換結果。 */
export type CompileResult =
  | { ok: true; program: CompiledProgram; warnings: CompileWarning[] }
  | { ok: false; errors: CompileError[]; warnings: CompileWarning[] };

/** 重複を落としつつ順序を保ってデバイスを集める器。 */
class DeviceSet {
  private readonly seen = new Set<string>();
  private readonly list: Device[] = [];

  add(d: Device): void {
    const key = deviceKey(d);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(d);
  }

  values(): Device[] {
    return [...this.list];
  }

  maxIndexOf(kind: Device['kind']): number {
    let max = -1;
    for (const d of this.list) if (d.kind === kind) max = Math.max(max, d.index);
    return max;
  }
}

/** グリッドの形（`rows` / `cols` と `cells` の食い違い）を検査する。 */
function checkShape(net: Network, errors: CompileError[]): boolean {
  if (net.cols !== IR_COLS) {
    errors.push({
      code: 'grid-shape',
      networkId: net.id,
      message: `列数は ${IR_COLS} 固定です: ${net.cols}`,
    });
    return false;
  }
  if (net.cells.length !== net.rows) {
    errors.push({
      code: 'grid-shape',
      networkId: net.id,
      message: `行数（${net.rows}）とセルの行数（${net.cells.length}）が違います`,
    });
    return false;
  }
  for (let row = 0; row < net.rows; row += 1) {
    if ((net.cells[row]?.length ?? -1) !== net.cols) {
      errors.push({
        code: 'grid-shape',
        networkId: net.id,
        row,
        message: `${row} 行目の列数が ${net.cols} ではありません`,
      });
      return false;
    }
  }
  return true;
}

/** セルが読むデバイスを usage に足す。 */
function collectReads(cell: Cell, reads: DeviceSet): void {
  if (cell.kind === 'contact') reads.add(cell.device);
  else if (cell.kind === 'counter') reads.add(cell.resetDevice);
  else if (cell.kind === 'mc' || cell.kind === 'mcr') reads.add(cell.device);
}

/** 出力セルの設定値を検査する。 */
function checkOutputCell(net: Network, row: number, cell: OutputCell, errors: CompileError[]): void {
  if (cell.kind === 'timer') {
    const bad =
      !Number.isInteger(cell.presetMs) ||
      cell.presetMs < TIMER_STEP_MS ||
      cell.presetMs % TIMER_STEP_MS !== 0 ||
      cell.presetMs > MAX_TIMER_PRESET_MS;
    if (bad) {
      errors.push({
        code: 'timer-preset',
        networkId: net.id,
        row,
        col: COIL_COL,
        message: `${deviceLabel(cell.device)} の設定値は 10ms の倍数（${TIMER_STEP_MS}〜${MAX_TIMER_PRESET_MS}ms）にします: ${cell.presetMs}ms`,
      });
    }
  } else if (cell.kind === 'counter') {
    const bad =
      !Number.isInteger(cell.preset) || cell.preset < 1 || cell.preset > MAX_COUNTER_PRESET;
    if (bad) {
      errors.push({
        code: 'counter-preset',
        networkId: net.id,
        row,
        col: COIL_COL,
        message: `${deviceLabel(cell.device)} の設定値は 1〜${MAX_COUNTER_PRESET} の整数にします: ${cell.preset}`,
      });
    }
  }
}

/** 二重コイル（同じデバイスへの OUT／タイマ／カウンタ）を警告する。§10.4 */
function checkDoubleCoil(
  net: Network,
  row: number,
  cell: OutputCell,
  written: Set<string>,
  warnings: CompileWarning[],
): void {
  if (cell.kind === 'mc' || cell.kind === 'mcr') return;
  if (cell.kind === 'coil' && cell.type !== 'OUT') return; // SET/RST は対で使うので対象外
  const key = deviceKey(cell.device);
  if (written.has(key)) {
    warnings.push({
      code: 'double-coil',
      networkId: net.id,
      row,
      col: COIL_COL,
      device: cell.device,
      message: `${deviceLabel(cell.device)} のコイルが2回以上あります（実行は後のものが優先されます）`,
    });
    return;
  }
  written.add(key);
}

/**
 * ラダーIRを実行形式に変換する。§10.3 / §10.4
 * エラーが1件でもあれば `ok: false` を返す。警告（二重コイル）は成功・失敗のどちらでも返す。
 */
export function compile(source: LadderProgram): CompileResult {
  const errors: CompileError[] = [];
  const warnings: CompileWarning[] = [];
  const reads = new DeviceSet();
  const writes = new DeviceSet();
  const written = new Set<string>();
  const mcStack: Device[] = [];
  const networks: CompiledNetwork[] = [];
  let endNetworkIndex = -1;

  if (source.networks.length === 0) {
    return {
      ok: false,
      errors: [{ code: 'empty-program', networkId: '', message: 'ネットワークがありません' }],
      warnings,
    };
  }

  source.networks.forEach((net, netIndex) => {
    if (!checkShape(net, errors)) {
      networks.push({
        id: net.id,
        rows: net.rows,
        cols: net.cols,
        cells: net.cells,
        outputs: [],
        isEnd: false,
      });
      return;
    }
    const outputs: CompiledOutput[] = [];
    let hasEnd = false;
    let hasContent = false;

    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < net.cols; col += 1) {
        const cell = cellAt(net, row, col);
        if (cell.kind === 'empty') continue;
        hasContent = true;
        if (cell.kind === 'end') {
          hasEnd = true;
          if (endNetworkIndex < 0) endNetworkIndex = netIndex;
          continue;
        }
        if (endNetworkIndex >= 0 && !hasEnd) {
          errors.push({
            code: 'after-end',
            networkId: net.id,
            row,
            col,
            message: 'END より後ろにはプログラムを書けません',
          });
          continue;
        }
        if (isOutputCell(cell)) {
          if (col !== COIL_COL) {
            errors.push({
              code: 'coil-column',
              networkId: net.id,
              row,
              col,
              message: `コイル・タイマ・カウンタ・MC/MCR は最終列（${COIL_COL}）に置きます`,
            });
            continue;
          }
          outputs.push({ row, col, cell });
          collectReads(cell, reads);
          checkOutputCell(net, row, cell, errors);
          checkDoubleCoil(net, row, cell, written, warnings);
          if (cell.kind === 'mc') mcStack.push(cell.device);
          else if (cell.kind === 'mcr') {
            if (mcStack.pop() === undefined) {
              errors.push({
                code: 'mc-unmatched',
                networkId: net.id,
                row,
                col,
                message: `対応する MC がありません: ${deviceLabel(cell.device)}`,
              });
            }
          } else writes.add(cell.device);
          continue;
        }
        if (col === COIL_COL) {
          errors.push({
            code: 'contact-in-coil-column',
            networkId: net.id,
            row,
            col,
            message: `最終列（${COIL_COL}）にはコイルだけを置きます`,
          });
          continue;
        }
        if (cell.kind === 'vline' && row + 1 >= net.rows) {
          errors.push({
            code: 'dangling-vline',
            networkId: net.id,
            row,
            col,
            message: '最終行の縦線は繋ぐ相手がありません',
          });
          continue;
        }
        collectReads(cell, reads);
      }
    }

    if (!hasEnd && hasContent && outputs.length === 0) {
      errors.push({
        code: 'no-output',
        networkId: net.id,
        message: 'コイル・タイマ・カウンタのいずれも置かれていません',
      });
    }
    networks.push({
      id: net.id,
      rows: net.rows,
      cols: net.cols,
      cells: net.cells,
      outputs,
      isEnd: hasEnd,
    });
  });

  if (endNetworkIndex < 0) {
    errors.push({ code: 'missing-end', networkId: '', message: 'END がありません（§10.3）' });
  }
  for (const device of mcStack) {
    errors.push({
      code: 'mc-unmatched',
      networkId: '',
      message: `対応する MCR がありません: ${deviceLabel(device)}`,
    });
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    warnings,
    program: {
      networks,
      endNetworkIndex,
      usage: { reads: reads.values(), writes: writes.values() },
      inputCount: reads.maxIndexOf('input') + 1,
      outputCount: writes.maxIndexOf('output') + 1,
      source,
    },
  };
}
```

`packages/ladder-core/src/index.ts` に追記する（`./ir.js` の再エクスポートの後ろ）:

```ts
export {
  compile,
  MAX_COUNTER_PRESET,
  MAX_TIMER_PRESET_MS,
  TIMER_STEP_MS,
  type CompiledNetwork,
  type CompiledOutput,
  type CompiledProgram,
  type CompileError,
  type CompileErrorCode,
  type CompileResult,
  type CompileWarning,
  type DeviceUsage,
} from './compile.js';
```

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/compile.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  11 passed (11)`。

- [ ] **Step 5: コミットする**

```powershell
pnpm --filter @ojt/ladder-core typecheck
npx prettier --check "packages/ladder-core/**/*.ts"
git add packages/ladder-core
git commit -m "feat(ladder-core): compile the IR and report conversion errors"
```

---
## Task 3: `createPlcRuntime()` — 1スキャンの実行

**Files:**
- Create: `packages/ladder-core/src/runtime.ts`
- Modify: `packages/ladder-core/src/index.ts`
- Test: `packages/ladder-core/test/runtime.test.ts`

§10.4 のランタイムである。1スキャンは「①入力読込（`PlcIoPort.readInputs()`）②ネットワークを上から順に実行 ③出力書込（`writeOutputs()`）」の3段で、乱数を使わないので同じ入力列から必ず同じ出力列が出る（決定論）。回路エンジン（`Simulation`）はここからは見えない（§4.2）。

| 決めること | 本タスクの実装 |
|---|---|
| 導通の解き方 | 1ネットワークごとに union-find で「左母線（0列目の左辺）から到達できる節点」を求め、コイル列の左辺が母線と同じ集合なら成立とする。横線・導通している接点・縦線が節点を併合する |
| 接点 | NO=デバイス値、NC=その否定、P=前スキャンからの立上り、F=立下り。微分は**セル位置ごと**に前回値を持つ（同じデバイスを別の場所で使っても互いに干渉しない） |
| コイル | OUT は毎スキャン上書き（後勝ち＝二重コイルの実行規則。§10.4）、SET/RST は保持 |
| タイマ | 成立中は `scanMs` ずつ加算、設定値到達で接点ON。断で0にリセット（有接点タイマと違い復帰時間を持たない。§10.4） |
| カウンタ | 条件の立上りで加算、設定値以上で接点ON、リセットデバイスONで0に戻す（リセットが優先）。値は保持 |
| MC/MCR | 区間が非成立のとき、その区間の OUT コイルは OFF、TON は0にリセット、SET/RST とカウンタは保持する |
| 特殊デバイス | `SP0`=常時ON、`SP1`=初期パルス（`reset()` 後の最初の1スキャンのみ）、`SP2`=1秒クロック（0.5s ON / 0.5s OFF。スキャン開始時刻で決める） |
| 入力・特殊への書込 | 無視する（Xや特殊デバイスにコイルは置けない。実機同様の扱いで、書いても状態は変わらない） |
| セル単位の通電 | union-find の結果をそのまま `PlcSnapshot.poweredCells`（キー `${networkId}:${row}:${col}`、値は**そのセルの左端**が左母線と繋がっているか）に毎スキャン書き出す。Plan 3B のラダーモニタが桟を色分けするのに使う（§10.7）。END ネットワークは実行しないので記録されない |
| `reset()` | デバイス・時刻・通電状況を消したうえで `io.writeOutputs()` を**呼ぶ**。呼ばないと `Simulation` 側のY接点が閉じたまま残り、RUN停止でランプが消えない |

- [ ] **Step 1: 失敗するテストを書く**

`packages/ladder-core/test/helpers/programs.ts`:

```ts
import {
  C,
  ctu,
  endNetwork,
  fall,
  hline,
  IR_COLS,
  M,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  rise,
  rst,
  set,
  SP,
  SPECIAL_ALWAYS_ON,
  T,
  ton,
  vline,
  X,
  Y,
  type Cell,
  type LadderProgram,
  type PlcIoPort,
} from '../../src/index.js';

/** 最後のセルをコイル列に置き、手前を横線で埋めた1行を作る。 */
export function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** 入力を差し替えられ、出力を覚えておく `PlcIoPort`。 */
export class TestIo implements PlcIoPort {
  inputs: boolean[];
  outputs: boolean[] = [];
  readonly history: boolean[][] = [];

  constructor(inputCount = 4) {
    this.inputs = Array.from({ length: inputCount }, () => false);
  }

  readInputs(): readonly boolean[] {
    return this.inputs;
  }

  writeOutputs(values: readonly boolean[]): void {
    this.outputs = [...values];
    this.history.push([...values]);
  }

  press(index: number): void {
    this.inputs[index] = true;
  }

  release(index: number): void {
    this.inputs[index] = false;
  }
}

/** 自己保持: X0で起動、X1で停止、Y0が自分を保持する。 */
export function selfHoldProgram(): LadderProgram {
  return program(
    network('n1', [
      [
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: IR_COLS - 4 }, () => hline()),
        out(Y(0)),
      ],
      [no(Y(0))],
    ]),
    endNetwork(),
  );
}

/** インターロック: X0でY0、X1でY1、互いのコイルのb接点で排他、X2で両方停止。 */
export function interlockProgram(): LadderProgram {
  const branch = (start: number, other: number, coil: number): Cell[][] => [
    [
      no(X(start)),
      vline(),
      nc(X(2)),
      nc(Y(other)),
      ...Array.from({ length: IR_COLS - 5 }, () => hline()),
      out(Y(coil)),
    ],
    [no(Y(coil))],
  ];
  return program(
    network('n1', branch(0, 1, 0)),
    network('n2', branch(1, 0, 1)),
    endNetwork(),
  );
}

/** ONディレー: X0を押している間 T0 が計時し、3秒でY0が点く。X1で停止。 */
export function onDelayProgram(presetMs = 3000): LadderProgram {
  return program(
    network('n1', [
      [
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: IR_COLS - 4 }, () => hline()),
        out(M(0)),
      ],
      [no(M(0))],
    ]),
    network('n2', [rung(no(M(0)), ton(T(0), presetMs))]),
    network('n3', [rung(no(T(0)), out(Y(0)))]),
    endNetwork(),
  );
}

/** ワンショット: X0の立上りでM0をSETし、T0（1秒）でRSTする。Y0はM0に従う。 */
export function oneShotProgram(presetMs = 1000): LadderProgram {
  return program(
    network('n1', [rung(rise(X(0)), set(M(0)))]),
    network('n2', [rung(no(M(0)), ton(T(0), presetMs))]),
    network('n3', [rung(no(T(0)), rst(M(0)))]),
    network('n4', [rung(no(M(0)), out(Y(0)))]),
    endNetwork(),
  );
}

/** フリッカ: X0の間、T0/T1が交互に計時してY0が0.5秒周期で点滅する。 */
export function flickerProgram(halfMs = 500): LadderProgram {
  return program(
    network('n1', [rung(no(X(0)), nc(T(1)), ton(T(0), halfMs))]),
    network('n2', [rung(no(T(0)), ton(T(1), halfMs))]),
    network('n3', [rung(no(X(0)), no(T(0)), out(Y(0)))]),
    endNetwork(),
  );
}

/** カウンタ: X0を押した回数で Y0→Y1→Y2 が順に点く。X1でリセット。 */
export function counterProgram(): LadderProgram {
  return program(
    network('n1', [rung(no(X(0)), ctu(C(0), 1, X(1)))]),
    network('n2', [rung(no(X(0)), ctu(C(1), 2, X(1)))]),
    network('n3', [rung(no(X(0)), ctu(C(2), 3, X(1)))]),
    network('n4', [rung(no(C(0)), out(Y(0)))]),
    network('n5', [rung(no(C(1)), out(Y(1)))]),
    network('n6', [rung(no(C(2)), out(Y(2)))]),
    endNetwork(),
  );
}

/** 停止優先: X0で起動、X1で停止（停止が直列で後ろにあるので同時押しでは停止が勝つ）。 */
export function stopPriorityProgram(): LadderProgram {
  return program(
    network('n1', [
      [
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: IR_COLS - 4 }, () => hline()),
        out(Y(0)),
      ],
      [no(Y(0))],
    ]),
    network('n2', [rung(no(X(2)), out(Y(3)))]),
    endNetwork(),
  );
}

/** 常時ONとMC/MCRの確認用。X0が区間の条件。 */
export function masterControlProgram(): LadderProgram {
  return program(
    network('n1', [rung(no(X(0)), mc(M(9)))]),
    network('n2', [rung(no(SP(SPECIAL_ALWAYS_ON)), out(Y(0)))]),
    network('n3', [rung(no(X(1)), set(M(1)))]),
    network('n4', [rung(no(SP(SPECIAL_ALWAYS_ON)), mcr(M(9)))]),
    network('n5', [rung(no(M(1)), out(Y(1)))]),
    endNetwork(),
  );
}

/** 立下り微分の確認用。 */
export function fallProgram(): LadderProgram {
  return program(network('n1', [rung(fall(X(0)), out(Y(0)))]), endNetwork());
}
```

`packages/ladder-core/test/runtime.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  C,
  COIL_COL,
  compile,
  createPlcRuntime,
  endNetwork,
  M,
  network,
  no,
  out,
  program,
  rise,
  SCAN_MS,
  SP,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  T,
  X,
  Y,
  type LadderProgram,
  type PlcRuntime,
} from '../src/index.js';
import {
  counterProgram,
  fallProgram,
  flickerProgram,
  interlockProgram,
  masterControlProgram,
  oneShotProgram,
  onDelayProgram,
  rung,
  selfHoldProgram,
  stopPriorityProgram,
  TestIo,
} from './helpers/programs.js';

/** プログラムを変換してランタイムを作る（変換に失敗したらテストを落とす）。 */
function boot(source: LadderProgram, io: TestIo): PlcRuntime {
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(`変換に失敗しました: ${compiled.errors[0]?.message ?? ''}`);
  return createPlcRuntime(compiled.program, { io });
}

/** n スキャン進める。 */
function scans(runtime: PlcRuntime, count: number): void {
  for (let i = 0; i < count; i += 1) runtime.scan();
}

describe('createPlcRuntime（自己保持・インターロック・停止優先）', () => {
  it('holds Y0 after X0 is released and drops it on X1 (§14.1 #5 相当)', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
    io.press(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.release(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.press(1);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
    io.release(1);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });

  it('never lets both outputs run at once (§14.1 #6 相当)', () => {
    const io = new TestIo();
    const runtime = boot(interlockProgram(), io);
    io.press(0);
    scans(runtime, 2);
    expect([io.outputs[0], io.outputs[1]]).toEqual([true, false]);
    io.release(0);
    io.press(1);
    scans(runtime, 2);
    expect([io.outputs[0], io.outputs[1]]).toEqual([true, false]);
    io.release(1);
    io.press(2);
    scans(runtime, 2);
    io.release(2);
    io.press(1);
    scans(runtime, 2);
    expect([io.outputs[0], io.outputs[1]]).toEqual([false, true]);
  });

  it('gives the stop button priority when both are pressed', () => {
    const io = new TestIo();
    const runtime = boot(stopPriorityProgram(), io);
    io.press(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.press(1);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });
});

describe('createPlcRuntime（タイマ・カウンタ）', () => {
  it('turns the timer contact on exactly at the preset (§10.4)', () => {
    const io = new TestIo();
    const runtime = boot(onDelayProgram(3000), io);
    io.press(0);
    // n1 で M0 を書き、同じスキャンの n2 のタイマがそれを読む。よって 300スキャン目で 3000ms に届く
    scans(runtime, 299);
    expect(io.outputs[0]).toBe(false);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    expect(runtime.state().timers[0]?.elapsedMs).toBe(3000);
  });

  it('resets the timer the moment its condition drops (PLCタイマに復帰時間は無い)', () => {
    const io = new TestIo();
    const runtime = boot(onDelayProgram(3000), io);
    io.press(0);
    scans(runtime, 100);
    expect(runtime.state().timers[0]?.elapsedMs).toBe(1000);
    io.press(1);
    runtime.scan();
    io.release(1);
    expect(runtime.state().timers[0]?.elapsedMs).toBe(0);
    expect(runtime.bit(T(0))).toBe(false);
  });

  it('flickers with a 0.5 s half period while X0 is held', () => {
    const io = new TestIo();
    const runtime = boot(flickerProgram(500), io);
    io.press(0);
    const seen: boolean[] = [];
    for (let i = 0; i < 200; i += 1) {
      runtime.scan();
      seen.push(io.outputs[0] ?? false);
    }
    const transitions = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
    // 2秒間（200スキャン）で 0.5秒ごとに反転するので3回前後
    expect(transitions).toBeGreaterThanOrEqual(3);
    expect(transitions).toBeLessThanOrEqual(4);
    io.release(0);
    scans(runtime, 60);
    expect(io.outputs[0]).toBe(false);
  });

  it('counts the rising edges of X0 and resets on X1 (§17.2 #8)', () => {
    const io = new TestIo();
    const runtime = boot(counterProgram(), io);
    const press = (): void => {
      io.press(0);
      runtime.scan();
      io.release(0);
      runtime.scan();
    };
    press();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, false, false]);
    press();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, true, false]);
    press();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, true, true]);
    expect(runtime.state().counters[0]?.value).toBe(3);
    io.press(1);
    runtime.scan();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([false, false, false]);
    expect(runtime.state().counters[2]?.value).toBe(0);
  });
});

describe('createPlcRuntime（微分・SET/RST・特殊デバイス・MC）', () => {
  it('conducts a rising-edge contact for exactly one scan', () => {
    const io = new TestIo();
    const runtime = boot(program(network('n1', [rung(rise(X(0)), out(Y(0)))]), endNetwork()), io);
    io.press(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
    io.release(0);
    io.press(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });

  it('conducts a falling-edge contact for exactly one scan', () => {
    const io = new TestIo();
    const runtime = boot(fallProgram(), io);
    io.press(0);
    scans(runtime, 2);
    expect(io.outputs[0]).toBe(false);
    io.release(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });

  it('holds SET until RST fires (§10.4)', () => {
    const io = new TestIo();
    const runtime = boot(oneShotProgram(1000), io);
    io.press(0);
    runtime.scan();
    io.release(0);
    expect(io.outputs[0]).toBe(true);
    // 1スキャン目で M0 が入り経過10ms。98スキャン追加で経過990ms（まだタイムアップしない）
    scans(runtime, 98);
    expect(io.outputs[0]).toBe(true);
    // 100スキャン目で経過1000ms → 同じスキャンの n3 が RST するので Y0 は落ちる
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });

  it('drives the three special devices (§10.3 / §14.1 #27)', () => {
    const io = new TestIo();
    const source = program(
      network('n1', [rung(no(SP(0)), out(Y(0)))]),
      network('n2', [rung(no(SP(SPECIAL_FIRST_SCAN)), out(Y(1)))]),
      network('n3', [rung(no(SP(SPECIAL_CLOCK_1S)), out(Y(2)))]),
      endNetwork(),
    );
    const runtime = boot(source, io);
    runtime.scan();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, true, true]);
    runtime.scan();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, false, true]);
    // bit() はスキャン開始時点の elapsedMs を読むので、500ms に達した次のスキャンで反転する
    scans(runtime, 49); // 合計51スキャン（開始時 500ms）
    expect(io.outputs[2]).toBe(false);
    scans(runtime, 50); // 合計101スキャン（開始時 1000ms）
    expect(io.outputs[2]).toBe(true);
  });

  it('turns the MC region off but keeps SET outside it (§10.3)', () => {
    const io = new TestIo();
    const runtime = boot(masterControlProgram(), io);
    io.press(0);
    io.press(1);
    runtime.scan();
    expect([io.outputs[0], io.outputs[1]]).toEqual([true, true]);
    io.release(0);
    runtime.scan();
    // 区間が非成立になると OUT は落ちるが、SET で保持した M1 は残る
    expect([io.outputs[0], io.outputs[1]]).toEqual([false, true]);
  });
});

describe('createPlcRuntime（状態・決定論）', () => {
  it('reports the scan count and the elapsed time', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io);
    scans(runtime, 3);
    expect(runtime.scanCount).toBe(3);
    expect(runtime.tMs).toBe(3 * SCAN_MS);
    expect(runtime.state().scanCount).toBe(3);
  });

  it('clears every device on reset and writes the cleared outputs out (§10.4 の RUN停止・リセット)', () => {
    const io = new TestIo();
    const runtime = boot(oneShotProgram(1000), io);
    io.press(0);
    scans(runtime, 5);
    expect(runtime.bit(M(0))).toBe(true);
    expect(io.outputs[0]).toBe(true);
    runtime.reset();
    expect(runtime.bit(M(0))).toBe(false);
    expect(runtime.tMs).toBe(0);
    expect(runtime.scanCount).toBe(0);
    expect(runtime.state().timers[0]?.elapsedMs ?? 0).toBe(0);
    expect(runtime.state().poweredCells).toEqual({});
    // reset() は `writeOutputs()` も呼ぶので、外側（`Simulation`）のY接点も開く
    expect(io.outputs[0]).toBe(false);
  });

  it('records which cells are energized so the 3B monitor can colour them (§10.7)', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io);
    runtime.scan();
    // X0 を押していないので、通電しているのは 0列目（X0のa接点）の左だけ
    expect(runtime.state().poweredCells['n1:0:0']).toBe(true);
    expect(runtime.state().poweredCells['n1:0:1']).toBe(false);
    io.press(0);
    runtime.scan();
    const cells = runtime.state().poweredCells;
    // 導通したので X0 の右（縦線）から右のコイル列まで通電する
    expect(cells['n1:0:1']).toBe(true);
    expect(cells[`n1:0:${COIL_COL}`]).toBe(true);
    // 自己保持の分岐（2行目）も縦線でつながる
    expect(cells['n1:1:1']).toBe(true);
  });

  it('drops the cells behind an open contact and never records the END network', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io);
    io.press(0);
    io.press(1); // 停止（b接点が開く）
    runtime.scan();
    const cells = runtime.state().poweredCells;
    expect(cells['n1:0:1']).toBe(true); // X0 は導通している
    expect(cells['n1:0:3']).toBe(false); // X1 の b接点で切れる
    expect(cells[`n1:0:${COIL_COL}`]).toBe(false);
    expect(Object.keys(cells).some((key) => key.startsWith('end:'))).toBe(false);
  });

  it('produces the same output series twice for the same input series (§5.2 の決定論)', () => {
    const run = (): boolean[][] => {
      const io = new TestIo();
      const runtime = boot(counterProgram(), io);
      for (let i = 0; i < 40; i += 1) {
        if (i % 7 === 0) io.press(0);
        if (i % 7 === 3) io.release(0);
        if (i === 30) io.press(1);
        if (i === 32) io.release(1);
        runtime.scan();
      }
      return io.history;
    };
    expect(run()).toEqual(run());
  });

  it('ignores a write to an input device', () => {
    const io = new TestIo();
    const runtime = boot(
      program(network('n1', [rung(no(SP(0)), out(X(0)))]), endNetwork()),
      io,
    );
    runtime.scan();
    expect(runtime.bit(X(0))).toBe(false);
    expect(runtime.bit(C(0))).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/runtime.test.ts
```

Expected: 失敗。`SyntaxError: The requested module '../src/index.js' does not provide an export named 'createPlcRuntime'`。

- [ ] **Step 3: `src/runtime.ts` を書く**

`packages/ladder-core/src/runtime.ts`:

```ts
import type { CompiledNetwork, CompiledProgram } from './compile.js';
import {
  cellAt,
  COIL_COL,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  type Cell,
  type Device,
  type Network,
  type OutputCell,
} from './ir.js';

/**
 * PLCランタイム。設計仕様 §10.4。
 *
 * 1スキャンは「①入力読込 ②ネットワークを上から順に実行 ③出力書込」の3段。回路エンジンは
 * 知らず、外界とは {@link PlcIoPort} だけで繋がる（§4.2）。乱数を使わないので、同じ入力列からは
 * 必ず同じ出力列が出る（§5.2 の決定論）。
 */

/** スキャン周期[ms]。回路エンジンの tick と同じ。§10.4 */
export const SCAN_MS = 10;

/** 1秒クロック（`SP2`）の周期[ms]。§10.3 */
export const CLOCK_PERIOD_MS = 1000;

/** PLCの入出力ポート。§4.2 */
export interface PlcIoPort {
  /** 入力点の現在値（添字＝入力デバイス番号）。 */
  readInputs(): readonly boolean[];
  /** 出力点の新しい値（添字＝出力デバイス番号）。 */
  writeOutputs(values: readonly boolean[]): void;
}

/** タイマの状態。 */
export interface PlcTimerState {
  elapsedMs: number;
  on: boolean;
}

/** カウンタの状態。 */
export interface PlcCounterState {
  value: number;
  on: boolean;
}

/** ランタイムの状態スナップショット（モニタ表示・テスト用）。 */
export interface PlcSnapshot {
  scanCount: number;
  tMs: number;
  inputs: boolean[];
  outputs: boolean[];
  internals: Record<number, boolean>;
  timers: Record<number, PlcTimerState>;
  counters: Record<number, PlcCounterState>;
  /**
   * 直前のスキャンで**そのセルの左端の節点が左母線と繋がっていたか**。
   * キーは `${networkId}:${row}:${col}`（`col` は 0 起点。コイル列は `COIL_COL`）。
   * Plan 3B のラダーモニタが「通電している桟」を色分けするために使う（§10.7）。
   * END ネットワークは実行しないので記録されない。
   */
  poweredCells: Record<string, boolean>;
}

/** ランタイム生成オプション。 */
export interface PlcRuntimeOptions {
  io: PlcIoPort;
  /** スキャン周期[ms]。既定は `SCAN_MS`（10）。 */
  scanMs?: number;
  /** 出力配列の長さ（PLC本体の出力点数）。既定はプログラムが使う最大番号＋1。 */
  outputCount?: number;
}

/** PLCランタイム。 */
export interface PlcRuntime {
  readonly program: CompiledProgram;
  /** 経過時間[ms]（スキャン数 × スキャン周期）。 */
  readonly tMs: number;
  /** 実行したスキャン数。 */
  readonly scanCount: number;
  /** 1スキャン実行する。 */
  scan(): void;
  /**
   * 全デバイスと時刻を初期化する（RUN停止・リセット相当）。§10.4
   * 落とした出力は `io.writeOutputs()` で外側にも書き出すので、`Simulation` のY接点も開く。
   */
  reset(): void;
  /** デバイスの現在値。 */
  bit(device: Device): boolean;
  /** 状態のスナップショット（内部状態とは切り離したコピー）。 */
  state(): PlcSnapshot;
}

/** 1ネットワークぶんの導通を解く器（union-find）。 */
class Rails {
  private readonly parent: number[];

  constructor(private readonly rows: number, private readonly cols: number) {
    this.parent = Array.from({ length: rows * (cols + 1) }, (_unused, i) => i);
    // 0列目の左辺はすべて左母線（同じ節点）。§10.3
    for (let row = 1; row < rows; row += 1) this.union(this.node(row, 0), this.node(0, 0));
  }

  node(row: number, col: number): number {
    return row * (this.cols + 1) + col;
  }

  find(start: number): number {
    let root = start;
    while ((this.parent[root] ?? root) !== root) root = this.parent[root] ?? root;
    let cursor = start;
    while ((this.parent[cursor] ?? cursor) !== cursor) {
      const next = this.parent[cursor] ?? cursor;
      this.parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }

  /** その節点が左母線と繋がっているか。 */
  poweredAt(row: number, col: number): boolean {
    return this.find(this.node(row, col)) === this.find(this.node(0, 0));
  }
}

class Runtime implements PlcRuntime {
  private readonly scanMs: number;
  private readonly outputs: boolean[];
  private inputs: boolean[] = [];
  private readonly internals = new Map<number, boolean>();
  private readonly timers = new Map<number, PlcTimerState>();
  private readonly counters = new Map<number, PlcCounterState>();
  /** 微分接点の前回値（キーは `<ネットワークID>:<行>:<列>`）。 */
  private readonly edges = new Map<string, boolean>();
  /** カウンタ入力の前回値（キーはカウンタ番号）。 */
  private readonly countEdges = new Map<number, boolean>();
  /** 直前のスキャンの通電状況（キーは `<ネットワークID>:<行>:<列>`）。Plan 3B のモニタ表示用。 */
  private readonly poweredCells = new Map<string, boolean>();
  /** MC/MCR の入れ子（成立していれば true）。 */
  private mcStack: boolean[] = [];
  private firstScan = true;
  private elapsedMs = 0;
  private scans = 0;

  constructor(
    readonly program: CompiledProgram,
    private readonly io: PlcIoPort,
    options: PlcRuntimeOptions,
  ) {
    this.scanMs = options.scanMs ?? SCAN_MS;
    const count = Math.max(options.outputCount ?? 0, program.outputCount);
    this.outputs = Array.from({ length: count }, () => false);
  }

  get tMs(): number {
    return this.elapsedMs;
  }

  get scanCount(): number {
    return this.scans;
  }

  reset(): void {
    this.inputs = [];
    this.outputs.fill(false);
    this.internals.clear();
    this.timers.clear();
    this.counters.clear();
    this.edges.clear();
    this.countEdges.clear();
    this.poweredCells.clear();
    this.mcStack = [];
    this.firstScan = true;
    this.elapsedMs = 0;
    this.scans = 0;
    // 出力を落としたことを外側（`Simulation`）にも伝える。§10.4
    this.io.writeOutputs([...this.outputs]);
  }

  bit(device: Device): boolean {
    switch (device.kind) {
      case 'input':
        return this.inputs[device.index] ?? false;
      case 'output':
        return this.outputs[device.index] ?? false;
      case 'internal':
        return this.internals.get(device.index) ?? false;
      case 'timer':
        return this.timers.get(device.index)?.on ?? false;
      case 'counter':
        return this.counters.get(device.index)?.on ?? false;
      case 'special':
        if (device.index === SPECIAL_ALWAYS_ON) return true;
        if (device.index === SPECIAL_FIRST_SCAN) return this.firstScan;
        if (device.index === SPECIAL_CLOCK_1S) {
          return Math.floor(this.elapsedMs / (CLOCK_PERIOD_MS / 2)) % 2 === 0;
        }
        return false;
    }
  }

  state(): PlcSnapshot {
    const internals: Record<number, boolean> = {};
    for (const [index, value] of this.internals) internals[index] = value;
    const timers: Record<number, PlcTimerState> = {};
    for (const [index, value] of this.timers) timers[index] = { ...value };
    const counters: Record<number, PlcCounterState> = {};
    for (const [index, value] of this.counters) counters[index] = { ...value };
    const poweredCells: Record<string, boolean> = {};
    for (const [key, value] of this.poweredCells) poweredCells[key] = value;
    return {
      scanCount: this.scans,
      tMs: this.elapsedMs,
      inputs: [...this.inputs],
      outputs: [...this.outputs],
      internals,
      timers,
      counters,
      poweredCells,
    };
  }

  scan(): void {
    // ① 入力読込
    this.inputs = [...this.io.readInputs()];
    this.mcStack = [];
    this.poweredCells.clear();
    // ② ネットワークを上から順に実行
    for (const net of this.program.networks) {
      if (net.isEnd) break;
      this.runNetwork(net);
    }
    // ③ 出力書込
    this.io.writeOutputs([...this.outputs]);
    this.scans += 1;
    this.elapsedMs += this.scanMs;
    this.firstScan = false;
  }

  /** MC区間が成立しているか（入れ子はすべて成立していなければならない）。 */
  private get mcActive(): boolean {
    return this.mcStack.every((on) => on);
  }

  private runNetwork(net: CompiledNetwork): void {
    const rails = this.solve(net);
    this.recordPoweredCells(net, rails);
    for (const output of net.outputs) {
      const powered = rails.poweredAt(output.row, COIL_COL);
      this.applyOutput(output.cell, powered);
    }
  }

  /**
   * 各セルの左端が左母線と繋がっているかを記録する（Plan 3B のモニタ表示用）。
   * `poweredAt(row, col)` はセル `(row, col)` の**左側**の節点なので、コイル列
   * （`COIL_COL`）の値がそのままコイルの通電状態になる。
   */
  private recordPoweredCells(net: CompiledNetwork, rails: Rails): void {
    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < net.cols; col += 1) {
        this.poweredCells.set(`${net.id}:${row}:${col}`, rails.poweredAt(row, col));
      }
    }
  }

  /** グリッドの導通を解く。 */
  private solve(net: CompiledNetwork): Rails {
    const rails = new Rails(net.rows, net.cols);
    const grid: Network = { id: net.id, rows: net.rows, cols: net.cols, cells: net.cells as Cell[][] };
    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < net.cols; col += 1) {
        const cell = cellAt(grid, row, col);
        if (cell.kind === 'contact') {
          if (this.conducts(net.id, row, col, cell.type, cell.device)) {
            rails.union(rails.node(row, col), rails.node(row, col + 1));
          }
        } else if (cell.kind === 'hline') {
          rails.union(rails.node(row, col), rails.node(row, col + 1));
        } else if (cell.kind === 'vline') {
          rails.union(rails.node(row, col), rails.node(row, col + 1));
          if (row + 1 < net.rows) rails.union(rails.node(row, col), rails.node(row + 1, col));
        }
      }
    }
    return rails;
  }

  /** 接点が導通しているか。微分接点はセル位置ごとに前回値を持つ。 */
  private conducts(
    networkId: string,
    row: number,
    col: number,
    type: 'NO' | 'NC' | 'P' | 'F',
    device: Device,
  ): boolean {
    const now = this.bit(device);
    if (type === 'NO') return now;
    if (type === 'NC') return !now;
    const key = `${networkId}:${row}:${col}`;
    const prev = this.edges.get(key) ?? false;
    this.edges.set(key, now);
    return type === 'P' ? now && !prev : !now && prev;
  }

  private applyOutput(cell: OutputCell, powered: boolean): void {
    if (cell.kind === 'mc') {
      // 入れ子のMCは外側が非成立ならまとめて非成立にする
      this.mcStack.push(this.mcActive && powered);
      return;
    }
    if (cell.kind === 'mcr') {
      this.mcStack.pop();
      return;
    }
    const active = this.mcActive;
    if (cell.kind === 'coil') {
      if (cell.type === 'OUT') this.writeBit(cell.device, active && powered);
      else if (active && powered) this.setOrReset(cell.device, cell.type === 'SET');
      return;
    }
    if (cell.kind === 'timer') {
      const state = this.timerState(cell.device.index);
      if (!active || !powered) {
        state.elapsedMs = 0;
        state.on = false;
        return;
      }
      state.elapsedMs += this.scanMs;
      if (state.elapsedMs >= cell.presetMs) state.on = true;
      return;
    }
    // カウンタ: リセットが優先、条件の立上りで加算。§10.4
    const state = this.counterState(cell.device.index);
    if (this.bit(cell.resetDevice)) {
      state.value = 0;
      state.on = false;
      this.countEdges.set(cell.device.index, powered);
      return;
    }
    if (!active) return;
    const prev = this.countEdges.get(cell.device.index) ?? false;
    this.countEdges.set(cell.device.index, powered);
    if (powered && !prev) {
      state.value += 1;
      if (state.value >= cell.preset) state.on = true;
    }
  }

  /** OUTコイルの書込（入力・特殊デバイスへの書込は無視する）。 */
  private writeBit(device: Device, value: boolean): void {
    if (device.kind === 'output') this.outputs[device.index] = value;
    else if (device.kind === 'internal') this.internals.set(device.index, value);
  }

  /** SET/RST（タイマ・カウンタへの RST は経過・計数も戻す）。 */
  private setOrReset(device: Device, on: boolean): void {
    if (device.kind === 'timer') {
      const state = this.timerState(device.index);
      state.on = on;
      if (!on) state.elapsedMs = 0;
      return;
    }
    if (device.kind === 'counter') {
      const state = this.counterState(device.index);
      state.on = on;
      if (!on) state.value = 0;
      return;
    }
    this.writeBit(device, on);
  }

  private timerState(index: number): PlcTimerState {
    const found = this.timers.get(index);
    if (found !== undefined) return found;
    const created: PlcTimerState = { elapsedMs: 0, on: false };
    this.timers.set(index, created);
    return created;
  }

  private counterState(index: number): PlcCounterState {
    const found = this.counters.get(index);
    if (found !== undefined) return found;
    const created: PlcCounterState = { value: 0, on: false };
    this.counters.set(index, created);
    return created;
  }
}

/** PLCランタイムを作る。§10.4 */
export function createPlcRuntime(
  program: CompiledProgram,
  options: PlcRuntimeOptions,
): PlcRuntime {
  return new Runtime(program, options.io, options);
}
```

`packages/ladder-core/src/index.ts` に追記する:

```ts
export {
  CLOCK_PERIOD_MS,
  createPlcRuntime,
  SCAN_MS,
  type PlcCounterState,
  type PlcIoPort,
  type PlcRuntime,
  type PlcRuntimeOptions,
  type PlcSnapshot,
  type PlcTimerState,
} from './runtime.js';
```

**注意（実装者向け）:** `solve()` の中で `net.cells as Cell[][]` とキャストしているのは、`CompiledNetwork.cells` が `readonly` で `cellAt()` が `Network` を取るためである。`Cell` 型を `./ir.js` から **type import** し、`cellAt()` に渡す一時オブジェクトを作る（読むだけで書き換えない）。ESLint の `@typescript-eslint/consistent-type-imports` に合わせて `import type { Cell, ... }` に含めること。

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/runtime.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  18 passed (18)`。

- [ ] **Step 5: コミットする**

```powershell
pnpm --filter @ojt/ladder-core typecheck
npx prettier --check "packages/ladder-core/**/*.ts"
git add packages/ladder-core
git commit -m "feat(ladder-core): execute one scan per tick with timers, counters and MC"
```

---

## Task 4: ゴールデンケースとカバレッジ（`ladder-core` の完成）

**Files:**
- Create: `packages/ladder-core/test/golden-ladder.test.ts`
- Test: 既存の3ファイルと合わせてカバレッジ90%

§14.1 の PLC 系ゴールデンケースのうち、`ladder-core` だけで固定できるもの（**#26 二重コイル**・**#27 特殊デバイス**）と、内蔵モードD課題8題（Task 18・19）が使うラダーの挙動を、回帰テストとして固定する。**#25（タイマ単位変換）は方言の話なので Task 9**、**#28（方言バリデータ）は Task 10（三菱の8進検査）と Phase 4（TOYOPUC の重複禁止）**である。

- [ ] **Step 1: 失敗するテストを書く**

`packages/ladder-core/test/golden-ladder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  C,
  compile,
  createPlcRuntime,
  ctu,
  endNetwork,
  network,
  no,
  out,
  program,
  rst,
  set,
  SP,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  T,
  ton,
  X,
  Y,
  type LadderProgram,
  type PlcRuntime,
} from '../src/index.js';
import {
  counterProgram,
  flickerProgram,
  oneShotProgram,
  onDelayProgram,
  rung,
  selfHoldProgram,
  TestIo,
} from './helpers/programs.js';

/** 入力操作列（スキャン番号 → 入力の変化）を与えて出力の履歴を取る。 */
function runSeries(
  source: LadderProgram,
  scanCount: number,
  operate: (io: TestIo, scanIndex: number) => void,
): boolean[][] {
  const io = new TestIo();
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(compiled.errors[0]?.message ?? '変換に失敗しました');
  const runtime = createPlcRuntime(compiled.program, { io, outputCount: 4 });
  for (let i = 0; i < scanCount; i += 1) {
    operate(io, i);
    runtime.scan();
  }
  return io.history;
}

/** 出力 n の ON 区間を [開始スキャン, 終了スキャン) の列にする。 */
function spans(history: readonly boolean[][], index: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  history.forEach((frame, i) => {
    const on = frame[index] ?? false;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, history.length]);
  return out;
}

describe('ゴールデン: 二重コイル（§14.1 #26 / §10.4）', () => {
  it('warns on conversion and lets the later network win', () => {
    const source = program(
      network('n1', [rung(no(X(0)), out(Y(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      endNetwork(),
    );
    const compiled = compile(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.warnings.map((w) => w.code)).toEqual(['double-coil']);

    const io = new TestIo();
    const runtime = createPlcRuntime(compiled.program, { io });
    io.press(0);
    runtime.scan();
    // 後のネットワーク（X1 が OFF）が上書きするので Y0 は OFF のまま
    expect(io.outputs[0]).toBe(false);
    io.press(1);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.release(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
  });
});

describe('ゴールデン: 特殊デバイス（§14.1 #27 / §10.3）', () => {
  it('keeps SP0 on, pulses SP1 once and toggles SP2 every 500 ms', () => {
    const history = runSeries(
      program(
        network('n1', [rung(no(SP(SPECIAL_ALWAYS_ON)), out(Y(0)))]),
        network('n2', [rung(no(SP(SPECIAL_FIRST_SCAN)), out(Y(1)))]),
        network('n3', [rung(no(SP(SPECIAL_CLOCK_1S)), out(Y(2)))]),
        endNetwork(),
      ),
      200,
      () => undefined,
    );
    expect(spans(history, 0)).toEqual([[0, 200]]);
    expect(spans(history, 1)).toEqual([[0, 1]]);
    expect(spans(history, 2)).toEqual([
      [0, 50],
      [100, 150],
    ]);
  });
});

describe('ゴールデン: 内蔵モードD課題が使うラダー', () => {
  it('self-hold: X0 で入り X1 で切れる', () => {
    const history = runSeries(selfHoldProgram(), 40, (io, i) => {
      if (i === 5) io.press(0);
      if (i === 8) io.release(0);
      if (i === 20) io.press(1);
      if (i === 23) io.release(1);
    });
    expect(spans(history, 0)).toEqual([[5, 20]]);
  });

  it('on-delay: X0 を押し続けると 3 秒（300スキャン）後に点く', () => {
    const history = runSeries(onDelayProgram(3000), 400, (io, i) => {
      if (i === 10) io.press(0);
      if (i === 13) io.release(0);
      if (i === 380) io.press(1);
    });
    // 添字10のスキャンで M0 が入り同じスキャンで計時開始（経過10ms）。300スキャン目＝添字309でタイムアップ
    expect(spans(history, 0)).toEqual([[309, 380]]);
  });

  it('one-shot: X0 の立上りで 1 秒だけ出力する', () => {
    const history = runSeries(oneShotProgram(1000), 200, (io, i) => {
      if (i === 10) io.press(0);
      if (i === 60) io.release(0);
    });
    // 添字10で SET、100スキャン目（添字109）に T0 がタイムアップし同じスキャンの n3 が RST する
    expect(spans(history, 0)).toEqual([[10, 109]]);
  });

  it('flicker: X0 の間だけ 0.5 秒周期で点滅する', () => {
    const history = runSeries(flickerProgram(500), 300, (io, i) => {
      if (i === 0) io.press(0);
      if (i === 220) io.release(0);
    });
    const onSpans = spans(history, 0);
    expect(onSpans.length).toBeGreaterThanOrEqual(2);
    for (const [from, to] of onSpans.slice(0, 2)) expect(to - from).toBe(50);
  });

  it('counter: 押した回数で Y0 → Y1 → Y2 の順に増える', () => {
    const history = runSeries(counterProgram(), 100, (io, i) => {
      if (i % 10 === 0) io.press(0);
      if (i % 10 === 2) io.release(0);
      if (i === 70) io.press(1);
      if (i === 72) io.release(1);
    });
    expect(history[9]?.slice(0, 3)).toEqual([true, false, false]);
    expect(history[19]?.slice(0, 3)).toEqual([true, true, false]);
    expect(history[29]?.slice(0, 3)).toEqual([true, true, true]);
    expect(history[75]?.slice(0, 3)).toEqual([false, false, false]);
  });

  it('timer contact is exactly one scan late, never early (§10.4)', () => {
    const history = runSeries(
      program(
        network('n1', [rung(no(X(0)), ton(T(0), 100))]),
        network('n2', [rung(no(T(0)), out(Y(0)))]),
        endNetwork(),
      ),
      40,
      (io, i) => {
        if (i === 0) io.press(0);
      },
    );
    // 1スキャン目に10ms加算され、10スキャン目で100msに達する。Y0はその同じスキャンで点く
    expect(spans(history, 0)).toEqual([[9, 40]]);
  });
});

describe('ゴールデン: タイマ・カウンタへの SET / RST（`setOrReset` の分岐）', () => {
  /** 操作列を与えず1スキャンずつ手で回すランタイム。 */
  function boot(source: LadderProgram): { io: TestIo; runtime: PlcRuntime } {
    const io = new TestIo();
    const compiled = compile(source);
    if (!compiled.ok) throw new Error(compiled.errors[0]?.message ?? '変換に失敗しました');
    return { io, runtime: createPlcRuntime(compiled.program, { io, outputCount: 4 }) };
  }

  it('SET T0 turns the timer contact on at once and holds it until RST (§10.4)', () => {
    // n1: X0 で T0 を SET、n2: X1 で T0 を RST、n3: T0 で Y0
    const { io, runtime } = boot(
      program(
        network('n1', [rung(no(X(0)), set(T(0)))]),
        network('n2', [rung(no(X(1)), rst(T(0)))]),
        network('n3', [rung(no(T(0)), out(Y(0)))]),
        endNetwork(),
      ),
    );
    io.press(0);
    runtime.scan();
    io.release(0);
    // SET は接点だけを入れる（計時はしない）。同じスキャンの n3 が読むので Y0 も点く
    expect(runtime.bit(T(0))).toBe(true);
    expect(io.outputs[0]).toBe(true);
    expect(runtime.state().timers[0]?.elapsedMs).toBe(0);
    // 条件が落ちても SET なので保持される
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.press(1);
    runtime.scan();
    io.release(1);
    expect(runtime.bit(T(0))).toBe(false);
    expect(io.outputs[0]).toBe(false);
  });

  it('RST T0 also clears the time the timer has already counted', () => {
    // n1: X0 の間 T0 が計時（設定値1秒）、n2: X1 で T0 を RST
    const { io, runtime } = boot(
      program(
        network('n1', [rung(no(X(0)), ton(T(0), 1000))]),
        network('n2', [rung(no(X(1)), rst(T(0)))]),
        network('n3', [rung(no(T(0)), out(Y(0)))]),
        endNetwork(),
      ),
    );
    io.press(0);
    for (let i = 0; i < 20; i += 1) runtime.scan();
    expect(runtime.state().timers[0]?.elapsedMs).toBe(200);
    // X0 を押したまま X1 を押す。n1 が 10ms 足した後に n2 の RST が 0 に戻す
    io.press(1);
    runtime.scan();
    expect(runtime.state().timers[0]?.elapsedMs).toBe(0);
    expect(runtime.bit(T(0))).toBe(false);
  });

  it('RST C0 clears both the counted value and the contact', () => {
    // n1: X0 の立上りで C0 を計数（設定値2・リセット入力は X2）、n2: X1 で C0 を RST、n3: C0 で Y0
    const { io, runtime } = boot(
      program(
        network('n1', [rung(no(X(0)), ctu(C(0), 2, X(2)))]),
        network('n2', [rung(no(X(1)), rst(C(0)))]),
        network('n3', [rung(no(C(0)), out(Y(0)))]),
        endNetwork(),
      ),
    );
    const pulse = (): void => {
      io.press(0);
      runtime.scan();
      io.release(0);
      runtime.scan();
    };
    pulse();
    expect(runtime.state().counters[0]?.value).toBe(1);
    expect(io.outputs[0]).toBe(false);
    pulse();
    expect(runtime.state().counters[0]?.value).toBe(2);
    expect(io.outputs[0]).toBe(true);
    // RST は計数値も 0 に戻す（同じスキャンの n3 が読むので Y0 も落ちる）
    io.press(1);
    runtime.scan();
    io.release(1);
    expect(runtime.state().counters[0]?.value).toBe(0);
    expect(runtime.bit(C(0))).toBe(false);
    expect(io.outputs[0]).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/golden-ladder.test.ts
```

Expected: 実装は揃っているので、**期待値の食い違いだけが出る**（`spans()` の境界が1スキャンずれる等）。ずれた場合は **実装ではなく期待値を直す**のではなく、まず §10.4 の規定（「設定値到達で接点ON」＝到達したスキャンで ON、出力は同じスキャンの後段ネットワークに伝わる）と突き合わせ、実装が仕様どおりかを確かめること。上の期待値は次の理屈で決めてある。

- タイマは `applyOutput()` で加算してから比較するので、`preset = 100ms`・`scanMs = 10ms` なら**10回目のスキャン**（添字9）で `elapsedMs = 100` になり接点が入る。同じスキャンの後段（`n2`）はその値を読むので、`Y0` も添字9の履歴から ON になる。
- `onDelayProgram` は `n1` で M0 を作ってから**同じスキャンの** `n2` で計時するので、X0 を押したスキャン（添字10）で M0 が入って計時も始まり、添字309（押したスキャンを1回目と数えて300スキャン目）で点く。
- `oneShotProgram` は立上りで M0 を SET（添字10）→ 100スキャン目に T0 がタイムアップし、**同じスキャンの** `n3` が RST するので添字109で消える。

- [ ] **Step 3: カバレッジを確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run --coverage
```

Expected: `All files` の lines / statements / functions / branches がすべて 90% 以上（§14.2 は `ladder-core` を Phase 3 以降の対象と定めている）。

**branches が落ちやすい箇所（Step 1 で必ず書く）:** `runtime.ts` の `setOrReset()` は `timer` / `counter` / それ以外（`writeBit`）の3分岐を持つが、内蔵課題のラダーは `SET M0` / `RST M0` しか使わないため、上の「タイマ・カウンタへの SET / RST」の3件が無いと branches が 90% に届かない（レビュー時の実測で 90.74%）。この3件は**任意ではなく必須**である。それでも届かない場合は、未到達の分岐（`compile()` のエラー枝・`bit()` の特殊デバイス・`reset()`）にテストを足す。**実装を削って閾値に合わせてはならない。**

- [ ] **Step 4: コミットする**

```powershell
pnpm exec prettier --write packages/ladder-core/test/golden-ladder.test.ts
pnpm exec prettier --check packages/ladder-core
git add packages/ladder-core
git commit -m "test(ladder-core): pin the PLC golden cases (#26, #27) and the built-in ladders"
```

---
## Task 5: `@ojt/circuit-sim` に PLC本体の部品を足す

**Files:**
- Create: `packages/circuit-sim/src/plc.ts`
- Modify: `packages/circuit-sim/src/parts.ts`
- Modify: `packages/circuit-sim/src/index.ts`
- Test: `packages/circuit-sim/test/plc-part.test.ts`

§4.4 の表をそのまま実装する。PLC本体はネットリスト上の1部品で、入力 Xn は `PLC.SS`–`PLC.Xn` 間の**抵抗負荷**、出力 Yn は `PLC.Yn`–`PLC.COMg` 間の**接点**（`driver: 'external'`）、電源 L/N は**要素を持たない端子**である。機種ごとの値（端子名・抵抗値・COM分け）は引数の `PlcUnitSpec` で受け取り、このファイルには機種を書かない（機種定義は `@ojt/board-model`。Task 7）。

| 決めること | 本タスクの実装 |
|---|---|
| 入力 | `LoadElement`（`load: 'plcInput'`、`polarized: false`）。抵抗は機種値（FX5U 4.5kΩ、既定 `PLC_INPUT_OHMS` 4.7kΩ） |
| 出力 | `ContactElement`（a接点、`driver: 'external'`、`group` は出力番号）。開閉は Task 6 の `setPlcOutputs()` が書く |
| 電源 | `L` / `N` / `PE` は端子だけ。要素は作らない（AC は解かない。§5.2） |
| サービス電源 | `24V` / `0V` の端子は作るが要素は持たせない。本アプリの課題は入力電源を盤のDC24Vから取るため、内蔵電源は電気的に扱わない（§10.2） |
| 端子の並び | `power` → `inputCommon` → `service` → `inputs` → `commons` → `outputs` の順（§10.1 の記載順。§17 #11） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/circuit-sim/test/helpers/plc.ts`（Task 6 のテストからも使う）:

```ts
import type { PlcUnitSpec } from '../../src/index.js';

/** 入力2点・出力2点の最小PLC（FX5U と同じ 4.5kΩ／3.5mA／1.5mA）。 */
export function tinySpec(): PlcUnitSpec {
  return {
    model: 'TEST-2',
    power: ['L', 'N', 'PE'],
    inputCommon: 'SS',
    service: ['24V', '0V'],
    inputs: ['X0', 'X1'],
    commons: ['COM0'],
    outputs: [
      { name: 'Y0', com: 'COM0' },
      { name: 'Y1', com: 'COM0' },
    ],
    inputOhms: 4500,
    onAmps: 0.0035,
    offAmps: 0.0015,
  };
}
```

`packages/circuit-sim/test/plc-part.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createPlcUnit,
  PLC_INPUT_OFF_AMPS,
  PLC_INPUT_ON_AMPS,
  PLC_INPUT_OHMS,
  plcMetaOf,
  type PlcUnitSpec,
} from '../src/index.js';
import { tinySpec } from './helpers/plc.js';

describe('createPlcUnit', () => {
  it('lays the terminals out in the order the spec lists them (§10.1 / §17 #11)', () => {
    const part = createPlcUnit('PLC', tinySpec());
    expect(part.kind).toBe('plc');
    expect(part.terminals).toEqual([
      'PLC.L',
      'PLC.N',
      'PLC.PE',
      'PLC.SS',
      'PLC.24V',
      'PLC.0V',
      'PLC.X0',
      'PLC.X1',
      'PLC.COM0',
      'PLC.Y0',
      'PLC.Y1',
    ]);
  });

  it('models every input as a resistive load between S/S and Xn (§4.4)', () => {
    const part = createPlcUnit('PLC', tinySpec());
    const input = part.elements.find((el) => el.id === 'PLC:in0');
    expect(input).toEqual({
      kind: 'load',
      id: 'PLC:in0',
      from: 'PLC.SS',
      to: 'PLC.X0',
      load: 'plcInput',
      nominalOhms: 4500,
      polarized: false,
    });
  });

  it('models every output as an externally driven a-contact to its COM (§4.4)', () => {
    const part = createPlcUnit('PLC', tinySpec());
    const output = part.elements.find((el) => el.id === 'PLC:out1');
    expect(output).toEqual({
      kind: 'contact',
      id: 'PLC:out1',
      from: 'PLC.Y1',
      to: 'PLC.COM0',
      contact: 'a',
      driver: 'external',
      driverId: 'PLC',
      group: 1,
      energized: false,
      closedOhms: 0.001,
    });
  });

  it('gives the power terminals no element at all (§5.2 は交流を扱わない)', () => {
    const part = createPlcUnit('PLC', tinySpec());
    const touching = part.elements.filter(
      (el) => el.from.startsWith('PLC.L') || el.to.startsWith('PLC.N'),
    );
    expect(touching).toEqual([]);
  });

  it('records the channel map in the part meta', () => {
    const part = createPlcUnit('PLC', tinySpec());
    const meta = plcMetaOf(part);
    expect(meta?.model).toBe('TEST-2');
    expect(meta?.inputCommon).toBe('PLC.SS');
    expect(meta?.inputs).toEqual([
      { name: 'X0', terminal: 'PLC.X0', elementId: 'PLC:in0' },
      { name: 'X1', terminal: 'PLC.X1', elementId: 'PLC:in1' },
    ]);
    expect(meta?.outputs[1]).toEqual({
      name: 'Y1',
      terminal: 'PLC.Y1',
      com: 'PLC.COM0',
      elementId: 'PLC:out1',
    });
    expect(meta?.power).toEqual(['PLC.L', 'PLC.N', 'PLC.PE']);
    expect(meta?.onAmps).toBe(0.0035);
    expect(meta?.offAmps).toBe(0.0015);
  });

  it('falls back to the spec defaults of §5.1.3 when the model does not give them', () => {
    const spec: PlcUnitSpec = { ...tinySpec(), inputOhms: PLC_INPUT_OHMS };
    delete (spec as { onAmps?: number }).onAmps;
    delete (spec as { offAmps?: number }).offAmps;
    const meta = plcMetaOf(createPlcUnit('PLC', spec));
    expect(meta?.onAmps).toBe(PLC_INPUT_ON_AMPS);
    expect(meta?.offAmps).toBe(PLC_INPUT_OFF_AMPS);
    expect(PLC_INPUT_ON_AMPS).toBe(0.003);
    expect(PLC_INPUT_OFF_AMPS).toBe(0.0015);
  });

  it('rejects an output whose COM is not in the commons list', () => {
    const spec = tinySpec();
    expect(() =>
      createPlcUnit('PLC', { ...spec, outputs: [{ name: 'Y0', com: 'COM9' }] }),
    ).toThrow();
  });

  it('returns undefined for a part that is not a PLC', () => {
    expect(plcMetaOf(createLamp('PL1', '白'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/plc-part.test.ts
```

Expected: 失敗。`SyntaxError: The requested module '../src/index.js' does not provide an export named 'createPlcUnit'`。

- [ ] **Step 3: `src/parts.ts` に PLC のメタデータを足す**

`packages/circuit-sim/src/parts.ts` の `PartKind` に `'plc'` を足す:

```ts
/** 部品種別。 */
export type PartKind =
  | 'relay-my4n'
  | 'timer-h3y4'
  | 'pushbutton'
  | 'lamp'
  | 'buzzer'
  | 'power-supply'
  | 'terminal-block'
  | 'plc';
```

同じファイルに、`PartMeta` の直前でチャネル型を定義する:

```ts
/** PLCの入力1点（端子とその抵抗負荷要素）。§4.4 */
export interface PlcInputChannel {
  /** 機種の端子表記（`X0` / `0.00` など）。 */
  name: string;
  terminal: TerminalId;
  /** `PLC.SS` との間の抵抗負荷要素のID。 */
  elementId: string;
}

/** PLCの出力1点（端子・所属COM・接点要素）。§4.4 */
export interface PlcOutputChannel {
  name: string;
  terminal: TerminalId;
  com: TerminalId;
  /** 端子とCOMの間の接点要素のID。 */
  elementId: string;
}
```

`PartMeta` に枝を足す:

```ts
  | {
      kind: 'plc';
      /** 機種名（`FX5U` など。表示と課題データの照合に使う）。§7.6 */
      model: string;
      /** 入力コモン（S/S 相当）の端子。 */
      inputCommon: TerminalId;
      inputs: readonly PlcInputChannel[];
      outputs: readonly PlcOutputChannel[];
      /** 入力ON判定のしきい値[A]。§5.1.3 */
      onAmps: number;
      /** 入力OFF判定のしきい値[A]。§5.1.3 */
      offAmps: number;
      /** 電源端子（電気的には解かない）。§4.4 */
      power: readonly TerminalId[];
    };
```

- [ ] **Step 4: `src/plc.ts` を書く**

`packages/circuit-sim/src/plc.ts`:

```ts
import {
  CLOSED_CONTACT_OHMS,
  PLC_INPUT_OHMS,
  type ContactElement,
  type Element,
  type LoadElement,
} from './elements.js';
import { partId, terminalId, type PartId, type TerminalId } from './ids.js';
import type { Part, PartMeta, PlcInputChannel, PlcOutputChannel } from './parts.js';

/**
 * PLC本体の部品。設計仕様 §4.4 の表をそのまま実装する。
 *
 * | PLC要素 | ネットリスト上の表現 |
 * |---|---|
 * | 入力 Xn | `PLC.SS` と `PLC.Xn` の間の抵抗負荷（機種別。既定 4.7kΩ） |
 * | 出力 Yn | `PLC.Yn` と所属COMの間の接点（`driver: 'external'`。ランタイムが開閉する） |
 * | 電源 L/N | 要素を持たない端子（AC は解かない。§5.2） |
 *
 * 機種ごとの値（端子名・抵抗値・COM分け・外形）は `@ojt/board-model` が持ち、ここには書かない
 * （エンジンは特定の機種に依存しない。§4.2 と同じ考え方）。
 */

/** 入力ON判定の既定しきい値[A]（3mA）。§5.1.3 */
export const PLC_INPUT_ON_AMPS = 0.003;
/** 入力OFF判定の既定しきい値[A]（1.5mA）。§5.1.3 */
export const PLC_INPUT_OFF_AMPS = 0.0015;

/** 出力1点の仕様（端子名と所属COM）。 */
export interface PlcOutputSpec {
  name: string;
  com: string;
}

/** PLC本体1機種の仕様。§10.1 */
export interface PlcUnitSpec {
  /** 機種名（`FX5U` など）。 */
  model: string;
  /** 電源端子名（`L` / `N` / `PE`）。電気的には解かない。 */
  power: readonly string[];
  /** 入力コモン端子名（`S/S` 相当。端子IDに使うので `/` は入れない）。 */
  inputCommon: string;
  /** 本体のサービス電源など、要素を持たない付随端子（`24V` / `0V`）。 */
  service?: readonly string[];
  /** 入力端子名（機種の表記どおり。並び順が入力番号）。 */
  inputs: readonly string[];
  /** 出力コモン端子名。 */
  commons: readonly string[];
  /** 出力端子（並び順が出力番号）。 */
  outputs: readonly PlcOutputSpec[];
  /** 入力回路の抵抗[Ω]。§5.1.3 */
  inputOhms?: number;
  /** ON判定のしきい値[A]。既定 `PLC_INPUT_ON_AMPS`。 */
  onAmps?: number;
  /** OFF判定のしきい値[A]。既定 `PLC_INPUT_OFF_AMPS`。 */
  offAmps?: number;
}

/** PLC部品の組み立てに失敗したときに投げる。 */
export class PlcUnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlcUnitError';
  }
}

/** 部品がPLCならそのメタデータを返す。 */
export function plcMetaOf(part: Part): Extract<PartMeta, { kind: 'plc' }> | undefined {
  return part.meta.kind === 'plc' ? part.meta : undefined;
}

/** PLC本体の部品を作る。§4.4 */
export function createPlcUnit(id: PartId | string, spec: PlcUnitSpec): Part {
  const pid = partId(id);
  const term = (name: string): TerminalId => terminalId(pid, name);
  const commons = new Set(spec.commons);
  for (const output of spec.outputs) {
    if (!commons.has(output.com)) {
      throw new PlcUnitError(`出力 ${output.name} のCOM端子が機種にありません: ${output.com}`);
    }
  }
  const inputOhms = spec.inputOhms ?? PLC_INPUT_OHMS;
  const onAmps = spec.onAmps ?? PLC_INPUT_ON_AMPS;
  const offAmps = spec.offAmps ?? PLC_INPUT_OFF_AMPS;
  if (!(onAmps > offAmps)) {
    throw new PlcUnitError(`ON判定はOFF判定より大きい必要があります: ${onAmps} / ${offAmps}`);
  }

  const inputCommon = term(spec.inputCommon);
  const elements: Element[] = [];
  const inputs: PlcInputChannel[] = spec.inputs.map((name, index) => {
    const terminal = term(name);
    const elementId = `${pid}:in${index}`;
    const load: LoadElement = {
      kind: 'load',
      id: elementId,
      from: inputCommon,
      to: terminal,
      load: 'plcInput',
      nominalOhms: inputOhms,
      polarized: false,
    };
    elements.push(load);
    return { name, terminal, elementId };
  });
  const outputs: PlcOutputChannel[] = spec.outputs.map((output, index) => {
    const terminal = term(output.name);
    const com = term(output.com);
    const elementId = `${pid}:out${index}`;
    const contact: ContactElement = {
      kind: 'contact',
      id: elementId,
      from: terminal,
      to: com,
      contact: 'a',
      driver: 'external',
      driverId: pid,
      group: index,
      energized: false,
      closedOhms: CLOSED_CONTACT_OHMS,
    };
    elements.push(contact);
    return { name: output.name, terminal, com, elementId };
  });

  const terminals: TerminalId[] = [
    ...spec.power.map(term),
    inputCommon,
    ...(spec.service ?? []).map(term),
    ...inputs.map((channel) => channel.terminal),
    ...spec.commons.map(term),
    ...outputs.map((channel) => channel.terminal),
  ];

  return {
    id: pid,
    kind: 'plc',
    terminals,
    elements,
    meta: {
      kind: 'plc',
      model: spec.model,
      inputCommon,
      inputs,
      outputs,
      onAmps,
      offAmps,
      power: spec.power.map(term),
    },
  };
}
```

`packages/circuit-sim/src/index.ts` に追記する:

```ts
export {
  createPlcUnit,
  PLC_INPUT_OFF_AMPS,
  PLC_INPUT_ON_AMPS,
  plcMetaOf,
  PlcUnitError,
  type PlcOutputSpec,
  type PlcUnitSpec,
} from './plc.js';
```

`./parts.js` の再エクスポートに型を足す:

```ts
  type PlcInputChannel,
  type PlcOutputChannel,
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/plc-part.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  8 passed (8)`。

- [ ] **Step 6: コミットする**

```powershell
pnpm --filter @ojt/circuit-sim typecheck
npx prettier --check "packages/circuit-sim/**/*.ts"
git add packages/circuit-sim
git commit -m "feat(circuit-sim): add the PLC unit part with sensed inputs and driven outputs"
```

---

## Task 6: `Simulation` の PLC入出力（ヒステリシスと外部駆動接点）

**Files:**
- Modify: `packages/circuit-sim/src/simulation.ts`
- Modify: `packages/circuit-sim/src/index.ts`
- Test: `packages/circuit-sim/test/plc-simulation.test.ts`

入力の ON/OFF 判定（§5.1.3 のヒステリシス）と、Y接点の駆動、信号ログへの記録を `Simulation` に足す。スキャンそのもの（ラダーの実行）は `@ojt/content` が繋ぐ（決定表#4）ので、ここに `ladder-core` への依存は**入らない**。

| 決めること | 本タスクの実装 |
|---|---|
| 判定 | `|要素電流| >= onAmps` で ON、`<= offAmps` で OFF、その間は直前を保持（§5.1.3）。**絶対値**なのでシンク／ソースのどちらの結線でも同じ（§10.2） |
| 実行順 | `step()` の中で `updateTimers()` の後・`applyContacts()` の前に `updatePlcInputs(solved)` を呼ぶ |
| 出力 | `setPlcOutputs(partId, values)` が接点要素の `energized` を書く。値の配列は出力番号順、足りないぶんは false 扱い |
| 読み出し | `plcInputs(partId)` が入力番号順の配列（コピー）を返す。PLC以外のIDは `SimulationError` |
| ログ | `snapshot()` に `PLC.X0` / `PLC.Y0`（boolean）と `PLC.X0.mA`（数値、mA）を記録する。タイムチャートとモニタ（3B）で使う |
| リセット | `reset()` で入力・出力とも false に戻る（`resetNetlist()` が接点の `energized` を落とすのと揃える） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/circuit-sim/test/plc-simulation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createPlcUnit,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  injectFault,
  type Simulation,
} from '../src/index.js';
import { bench, powerOn, w } from './helpers/circuits.js';
import { tinySpec } from './helpers/plc.js';

/**
 * 盤（DC24V・PB1・CR1・PL1）＋ PLC のシンク結線。§10.2
 * - 入力: `PS.+ → PLC.SS`、`PLC.X0 → PB1.a`、`PB1.c → PS.-`
 * - 出力: `PS.+ → PLC.COM0`、`PLC.Y0 → CR1.14`、`CR1.13 → PS.-`
 * - 2段結線: `PS.+ → CR1.9`、`CR1.5 → PL1.+`、`PL1.- → PS.-`
 */
function plcBench(): Simulation {
  return bench(
    [
      createPowerSupply('PS'),
      createPushButton('PB1'),
      createRelay4c('CR1'),
      createLamp('PL1', '白'),
      createPlcUnit('PLC', tinySpec()),
    ],
    [
      w('w1', 'PS.+', 'PLC.SS'),
      w('w2', 'PLC.X0', 'PB1.a'),
      w('w3', 'PB1.c', 'PS.-'),
      w('w4', 'PS.+', 'PLC.COM0'),
      w('w5', 'PLC.Y0', 'CR1.14'),
      w('w6', 'CR1.13', 'PS.-'),
      w('w7', 'PS.+', 'CR1.9'),
      w('w8', 'CR1.5', 'PL1.+'),
      w('w9', 'PL1.-', 'PS.-'),
    ],
  );
}

describe('PLC入力の読み取り', () => {
  it('reads OFF while the push button is released', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.step();
    expect(sim.plcInputs('PLC')).toEqual([false, false]);
  });

  it('reads ON when the button closes the input loop (§4.4 / §5.1.3)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.step();
    expect(sim.plcInputs('PLC')).toEqual([true, false]);
    const amps = sim.state().plcs['PLC']?.inputAmps[0] ?? 0;
    // 24V ÷ (4500Ω + 電源0.1Ω + 接点1mΩ) ≒ 5.33mA（ON感度 3.5mA の 1.5 倍）
    expect(amps).toBeCloseTo(0.00533, 5);
  });

  it('keeps the previous state inside the hysteresis band (§5.1.3)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.step();
    expect(sim.plcInputs('PLC')[0]).toBe(true);
    // 接触不良で 6kΩ 直列 → 24V ÷ 10.5kΩ ≒ 2.29mA（1.5mA 超・3.5mA 未満）
    injectFault(sim.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 6000);
    sim.step();
    expect(sim.state().plcs['PLC']?.inputAmps[0]).toBeCloseTo(0.00229, 5);
    expect(sim.plcInputs('PLC')[0]).toBe(true);
    // 離せば 0mA になり OFF に落ちる
    sim.release('PB1');
    sim.step();
    expect(sim.plcInputs('PLC')[0]).toBe(false);
  });

  it('reads the same ON state with source wiring (§10.2 はどちらでもよい)', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createPlcUnit('PLC', tinySpec())],
      [w('w1', 'PS.-', 'PLC.SS'), w('w2', 'PLC.X0', 'PB1.a'), w('w3', 'PB1.c', 'PS.+')],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.step();
    expect(sim.plcInputs('PLC')[0]).toBe(true);
    expect(sim.state().plcs['PLC']?.inputAmps[0]).toBeCloseTo(0.00533, 5);
  });
});

describe('PLC出力の駆動', () => {
  it('closes the Y contact and lights the lamp through the board relay (§10.2 の2段結線)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.step();
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.setPlcOutputs('PLC', [true, false]);
    sim.step(); // コイルが励磁される
    expect(sim.state().relays['CR1']?.coilOn).toBe(true);
    sim.step(); // 接点が入る（動作時間1tick）
    // step() は updateLoads → updateRelays → applyContacts の順なので、
    // 接点が入った回の負荷更新は既に終わっている。ランプに反映されるのは次の step
    sim.step();
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.setPlcOutputs('PLC', [false, false]);
    sim.step();
    sim.step();
    sim.step(); // 復帰も同じ理由で3step必要
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('treats a short value array as all-off for the missing points', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.setPlcOutputs('PLC', [true]);
    sim.step();
    expect(sim.state().plcs['PLC']?.outputs).toEqual([true, false]);
  });

  it('records PLC signals in the log (§5.7)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.setPlcOutputs('PLC', [true, false]);
    sim.step();
    expect(sim.log.transitions('PLC.X0').at(-1)?.value).toBe(true);
    expect(sim.log.transitions('PLC.Y0').at(-1)?.value).toBe(true);
    expect(Number(sim.log.transitions('PLC.X0.mA').at(-1)?.value)).toBeCloseTo(5.33, 1);
  });

  it('clears the inputs and outputs on reset', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.setPlcOutputs('PLC', [true, true]);
    sim.step();
    sim.reset();
    expect(sim.plcInputs('PLC')).toEqual([false, false]);
    expect(sim.state().plcs['PLC']?.outputs).toEqual([false, false]);
  });

  it('refuses to read or write a part that is not a PLC', () => {
    const sim = plcBench();
    expect(() => sim.plcInputs('CR1')).toThrow(/PLC/u);
    expect(() => sim.setPlcOutputs('CR1', [true])).toThrow(/PLC/u);
  });
});
```

**注意:** `tinySpec()` は Task 5 で作った `test/helpers/plc.ts` のものをそのまま使う（テストファイルどうしの import はしない）。

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/plc-simulation.test.ts
```

Expected: 失敗。`TypeError: sim.plcInputs is not a function`。

- [ ] **Step 3: `src/simulation.ts` を直す**

import に PLC のメタ取得を足す:

```ts
import { plcMetaOf } from './plc.js';
```

型と内部状態を足す（`LampRuntime` の定義の後ろ）:

```ts
/** PLC本体の内部状態。§4.4 */
export interface PlcUnitRuntime {
  /** 入力点の論理値（入力番号順）。§5.1.3 */
  inputs: boolean[];
  /** 出力点の論理値（出力番号順）。ランタイムが `setPlcOutputs()` で書く。 */
  outputs: boolean[];
  /** 入力点の実測電流[A]（デバッグ・ログ用）。 */
  inputAmps: number[];
}
```

`SimulationState` に足す:

```ts
  plcs: Record<string, PlcUnitRuntime>;
```

`Simulation` のフィールドに足す:

```ts
  private readonly plcs = new Map<string, PlcUnitRuntime>();
```

`resetInternal()` に `this.plcs.clear();`（`this.lamps.clear();` の隣）を足す。

`syncRuntimeMaps()` の中の分岐に足す（`meta.kind === 'pushbutton'` の枝の後ろ）:

```ts
      } else if (meta.kind === 'plc') {
        plcIds.add(id);
        if (!this.plcs.has(id)) {
          this.plcs.set(id, {
            inputs: meta.inputs.map(() => false),
            outputs: meta.outputs.map(() => false),
            inputAmps: meta.inputs.map(() => 0),
          });
        }
      }
```

（同関数の冒頭に `const plcIds = new Set<string>();`、末尾に `pruneRuntime(this.plcs, plcIds);` を足す。）

`step()` の処理順に1行足す:

```ts
      this.updateTimers(solved, dtMs);
      this.updatePlcInputs(solved);
      this.applyContacts();
```

入力判定を実装する（`updateTimers()` の後ろ）:

```ts
  /**
   * PLC入力の論理値を更新する。§5.1.3 / §4.4
   * 入力要素の電流の**絶対値**で判定するので、シンク結線（`P`→`S/S`）でもソース結線
   * （`N`→`S/S`）でも同じ結果になる（§10.2 はどちらも認めている）。
   * しきい値の間（既定 1.5mA 超 3.5mA 未満）はヒステリシスで直前の状態を保つ。
   */
  private updatePlcInputs(solved: SolveResult): void {
    for (const part of this.netlist.parts) {
      const meta = plcMetaOf(part);
      if (meta === undefined) continue;
      const runtime = this.plcs.get(part.id);
      if (runtime === undefined) continue;
      meta.inputs.forEach((channel, index) => {
        const amps = Math.abs(solved.elementAmps.get(channel.elementId) ?? 0);
        runtime.inputAmps[index] = amps;
        const prev = runtime.inputs[index] ?? false;
        runtime.inputs[index] = amps >= meta.onAmps ? true : amps <= meta.offAmps ? false : prev;
      });
    }
  }
```

読み書きの公開APIを足す（`setTimerPreset()` の後ろ）:

```ts
  /** PLC本体のメタデータとランタイムを引く。PLCでなければ `SimulationError`。 */
  private plcOf(partId: string): {
    meta: NonNullable<ReturnType<typeof plcMetaOf>>;
    runtime: PlcUnitRuntime;
  } {
    const part = findPart(this.netlist, partId);
    const meta = part === undefined ? undefined : plcMetaOf(part);
    const runtime = this.plcs.get(partId);
    if (meta === undefined || runtime === undefined) {
      throw new SimulationError(`PLC本体が見つかりません: ${partId}`);
    }
    return { meta, runtime };
  }

  /**
   * PLC入力の論理値（入力番号順）。§10.4 の「①入力読込」で使う。
   * 返すのはコピーなので、呼び出し側が書き換えてもエンジンの状態は変わらない。
   */
  plcInputs(partId: string): boolean[] {
    return [...this.plcOf(partId).runtime.inputs];
  }

  /**
   * PLC出力を書く。§10.4 の「③出力書込」。配列が短いぶんは OFF として扱う。
   * 書いた値は次の `step()` の `solve()` から効く（Y接点は `driver: 'external'` なので
   * `applyContacts()` は触らない）。
   */
  setPlcOutputs(partId: string, values: readonly boolean[]): void {
    const { meta, runtime } = this.plcOf(partId);
    meta.outputs.forEach((channel, index) => {
      const on = values[index] ?? false;
      runtime.outputs[index] = on;
      const el = findElement(this.netlist, channel.elementId);
      if (el !== undefined && el.kind === 'contact') el.energized = on;
    });
  }
```

`state()` に足す:

```ts
    const plcs: Record<string, PlcUnitRuntime> = {};
    for (const [id, st] of this.plcs) {
      plcs[id] = { inputs: [...st.inputs], outputs: [...st.outputs], inputAmps: [...st.inputAmps] };
    }
```

（戻り値のオブジェクトに `plcs,` を足す。）

`snapshot()` の部品ごとの分岐に足す（`meta.kind === 'lamp' || meta.kind === 'buzzer'` の枝の後ろ）:

```ts
      } else if (meta.kind === 'plc') {
        const st = this.plcs.get(id);
        if (st !== undefined) {
          meta.inputs.forEach((channel, index) => {
            out.set(`${id}.${channel.name}`, st.inputs[index] ?? false);
            out.set(`${id}.${channel.name}.mA`, (st.inputAmps[index] ?? 0) * 1000);
          });
          meta.outputs.forEach((channel, index) => {
            out.set(`${id}.${channel.name}`, st.outputs[index] ?? false);
          });
        }
      }
```

`packages/circuit-sim/src/index.ts` の `./simulation.js` の再エクスポートに `type PlcUnitRuntime` を足す。

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/plc-simulation.test.ts
pnpm --filter @ojt/circuit-sim exec vitest run
```

Expected: 新しいファイル（`plc-simulation.test.ts`）が `Tests  9 passed (9)`、パッケージ全体は着手時のベースライン（前提#14。目安215件）＋17件（Task 5 の8件＋本タスクの9件）がすべて通る。**既存テストが1件でも落ちたら、`syncRuntimeMaps()` / `snapshot()` の変更が既存部品の挙動を変えていないか確認すること**（PLCを持たないネットリストでは、新しい分岐に一切入らないはずである）。

- [ ] **Step 5: カバレッジとコミット**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run --coverage
pnpm --filter @ojt/circuit-sim typecheck
npx prettier --check "packages/circuit-sim/**/*.ts"
git add packages/circuit-sim
git commit -m "feat(circuit-sim): sense PLC inputs with hysteresis and drive Y contacts"
```

Expected: カバレッジは 90% 以上を維持（PLC部品ぶんの分岐はすべて新テストが通る）。

---
## Task 7: `@ojt/board-model` に FX5U 本体と壁コンセントを足す

**Files:**
- Create: `packages/board-model/src/plc-unit.ts`
- Modify: `packages/board-model/src/board-jipm.ts`
- Modify: `packages/board-model/src/to-netlist.ts`
- Modify: `packages/board-model/src/routing.ts`
- Modify: `packages/board-model/src/index.ts`
- Test: `packages/board-model/test/plc-unit.test.ts`
- Test: `packages/board-model/test/plc-netlist.test.ts`

§10.1 の FX5U と、§10.1 の「壁コンセント（AC100V）」オブジェクトを盤モデルに足す。PLCは**盤の上ではなく机上**に置くので（決定事項#16）、盤の占有矩形・配線帯・経路生成の枠外に置き、`withPlcUnit()` が「同じ `id` のまま PLC とコンセントの端子を足した派生盤」を返す（決定表#8）。

| 決めること | 本タスクの実装 |
|---|---|
| 端子集合 | §10.1 の記載順をそのまま配列順にする（§17 #11）。入力側 `L` `⏚`(PE) `N` `S/S` `24V` `0V` `X0`〜`X17`（8進16点）／出力側 `COM0`〜`COM3` と `Y0`〜`Y17`（8進16点） |
| COM分け | `COM0`→`Y0`〜`Y3`、`COM1`→`Y4`〜`Y7`、`COM2`→`Y10`〜`Y13`、`COM3`→`Y14`〜`Y17`（4点1コモン。§17.1 の前提値） |
| 端子座標 | 千鳥2列（列ピッチ9mm・段間9mm・千鳥のずれ4.5mm）。当たり判定は盤と同じ半径4mmで、隣どうし9mm・斜め10.06mm なので重ならない（`validateBoard` が検査する） |
| 机上判定 | `isOffBoardTerminal(id)`（部品IDが `PLC` か `OUTLET`）。`validateBoard()` の「盤の外に端子がある」検査と経路生成から外す |
| 3D経路 | 机上へ渡る電線は `routeSession()` の結果に**含めない**。代わりに `deskWires()` が端子と座標を返し、Plan 3B が直線ケーブルとして描く（決定表#9） |
| ネットリスト | `board.plcUnit` があるとき `toNetlist()` が `PLC`（`createPlcUnit`）と `OUTLET`（端子だけの部品）を**部品配列の末尾**に足す（既存の部品順テストを壊さないため） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/board-model/test/plc-unit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FX5U_SPEC,
  isOffBoardTerminal,
  JIPM_BOARD,
  OUTLET_ID,
  PLC_PART_ID,
  PLC_UNIT_FX5U,
  plcUnitFor,
  validateBoard,
  withPlcUnit,
} from '../src/index.js';

describe('PLC_UNIT_FX5U', () => {
  it('describes the FX5U-32MR/ES body (§10.1)', () => {
    expect(PLC_UNIT_FX5U.model).toBe('FX5U');
    expect(PLC_UNIT_FX5U.vendor).toBe('mitsubishi');
    expect(PLC_UNIT_FX5U.sizeMm).toEqual({ width: 150, height: 90, depth: 83 });
    expect(PLC_UNIT_FX5U.leds).toContain('PWR');
    expect(PLC_UNIT_FX5U.leds).toContain('P.RUN');
  });

  it('names the 16 inputs and 16 outputs in octal (§10.1)', () => {
    expect(FX5U_SPEC.inputs).toEqual([
      'X0', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7',
      'X10', 'X11', 'X12', 'X13', 'X14', 'X15', 'X16', 'X17',
    ]);
    expect(FX5U_SPEC.outputs.map((o) => o.name)).toEqual([
      'Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7',
      'Y10', 'Y11', 'Y12', 'Y13', 'Y14', 'Y15', 'Y16', 'Y17',
    ]);
  });

  it('splits the outputs into four commons of four points (§17.1 の前提値)', () => {
    expect(FX5U_SPEC.commons).toEqual(['COM0', 'COM1', 'COM2', 'COM3']);
    expect(FX5U_SPEC.outputs.slice(0, 4).every((o) => o.com === 'COM0')).toBe(true);
    expect(FX5U_SPEC.outputs[4]?.com).toBe('COM1');
    expect(FX5U_SPEC.outputs[8]?.com).toBe('COM2');
    expect(FX5U_SPEC.outputs[12]?.com).toBe('COM3');
  });

  it('uses the FX5U input circuit values (§5.1.3)', () => {
    expect(FX5U_SPEC.inputOhms).toBe(4500);
    expect(FX5U_SPEC.onAmps).toBe(0.0035);
    expect(FX5U_SPEC.offAmps).toBe(0.0015);
  });

  it('is found by its model name (§7.6 の `plc.model`)', () => {
    expect(plcUnitFor('FX5U')).toBe(PLC_UNIT_FX5U);
    expect(plcUnitFor('CP1E')).toBeUndefined();
  });
});

describe('withPlcUnit', () => {
  const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

  it('keeps the board id so sessions still match (§8.2)', () => {
    expect(board.id).toBe(JIPM_BOARD.id);
    expect(board.plcUnit).toBe(PLC_UNIT_FX5U);
    expect(JIPM_BOARD.plcUnit).toBeUndefined();
  });

  it('adds the PLC and outlet terminals to the board terminal list', () => {
    const ids = board.terminals.map((t) => t.id);
    expect(ids).toContain('PLC.X0');
    expect(ids).toContain('PLC.X17');
    expect(ids).toContain('PLC.COM0');
    expect(ids).toContain('PLC.SS');
    expect(ids).toContain('PLC.L');
    expect(ids).toContain('OUTLET.L');
    expect(ids).toContain('OUTLET.N');
    // PLC = 電源3 ＋ S/S 1 ＋ サービス2 ＋ 入力16 ＋ COM 4 ＋ 出力16 = 42、コンセント2
    expect(board.terminals.length).toBe(JIPM_BOARD.terminals.length + 42 + 2);
  });

  it('keeps every PLC terminal wirable and labelled (§8.2)', () => {
    const plc = board.terminals.filter((t) => t.id.startsWith('PLC.'));
    expect(plc.every((t) => t.wirable)).toBe(true);
    expect(plc.every((t) => t.label.trim().length > 0)).toBe(true);
    // TerminalId は branded type なのでリテラルと `===` すると TS2367。String() で比較する
    expect(plc.find((t) => String(t.id) === 'PLC.SS')?.label).toBe('S/S');
    expect(plc.find((t) => String(t.id) === 'PLC.PE')?.label).toBe('⏚');
    expect(plc.find((t) => String(t.id) === 'PLC.X10')?.role).toBe('x');
    expect(plc.find((t) => String(t.id) === 'PLC.COM1')?.role).toBe('plc-com');
  });

  it('passes validateBoard with the desk terminals excluded from the board rect (§6.5)', () => {
    expect(validateBoard(board)).toEqual([]);
    expect(validateBoard(JIPM_BOARD)).toEqual([]);
  });

  it('does not add footprints or channels for the desk devices (§6.6)', () => {
    expect(board.footprints).toEqual(JIPM_BOARD.footprints);
    expect(board.wiringChannels).toEqual(JIPM_BOARD.wiringChannels);
  });
});

describe('isOffBoardTerminal', () => {
  it('knows the two desk devices', () => {
    expect(isOffBoardTerminal('PLC.X0')).toBe(true);
    expect(isOffBoardTerminal('OUTLET.L')).toBe(true);
    expect(isOffBoardTerminal('TB_PB.1a')).toBe(false);
    expect(isOffBoardTerminal('S1.13')).toBe(false);
    expect(PLC_PART_ID).toBe('PLC');
    expect(OUTLET_ID).toBe('OUTLET');
  });
});
```

`packages/board-model/test/plc-netlist.test.ts`:

```ts
import {
  buildNets,
  MAX_NODES,
  plcMetaOf,
  validateNetlist,
  type TerminalId,
} from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  addWire,
  createSession,
  deskWires,
  JIPM_BOARD,
  PLC_UNIT_FX5U,
  routeSession,
  TASK1_SOCKET_ROLES,
  toNetlist,
  withPlcUnit,
  type BoardSession,
} from '../src/index.js';

const BOARD = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

function t(id: string): TerminalId {
  return id as TerminalId;
}

/** 盤 → PLC のシンク結線を最小限だけ張ったセッション。§10.2 */
function wired(): BoardSession {
  const session = createSession(BOARD, { roles: TASK1_SOCKET_ROLES });
  const link = (from: string, to: string): void => {
    const result = addWire(session, BOARD, t(from), t(to));
    if (!result.ok) throw new Error(`${from} → ${to}: ${result.message}`);
  };
  link('P.1', 'PLC.SS');
  link('TB_PB.1a', 'PLC.X0');
  link('TB_PB.1c', 'N.1');
  link('PLC.SS', 'PLC.COM0');
  link('PLC.Y0', 'CR1.14');
  link('OUTLET.L', 'PLC.L');
  link('OUTLET.N', 'PLC.N');
  return session;
}

describe('PLCを載せた盤のセッション', () => {
  it('lets the trainee wire board terminals to the PLC (§10.2)', () => {
    const session = wired();
    expect(session.wires.map((w) => w.id)).toContain('w-001');
    expect(session.wires.filter((w) => !w.locked)).toHaveLength(7);
  });

  it('refuses a third wire on a PLC terminal as well (§6.6)', () => {
    const session = wired();
    const first = addWire(session, BOARD, t('PLC.SS'), t('CR2.14'));
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.code).toBe('terminal-overload');
  });

  it('refuses PLC wiring on a board without the unit', () => {
    const session = createSession(JIPM_BOARD, { roles: TASK1_SOCKET_ROLES });
    const result = addWire(session, JIPM_BOARD, t('P.1'), t('PLC.SS'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unknown-terminal');
  });
});

describe('toNetlist（PLCつき）', () => {
  it('adds the PLC unit and the outlet at the end of the part list', () => {
    const netlist = toNetlist(wired(), BOARD);
    const ids = netlist.parts.map((p) => p.id);
    expect(ids.at(-2)).toBe('PLC');
    expect(ids.at(-1)).toBe('OUTLET');
    const plc = netlist.parts.find((p) => p.id === 'PLC');
    expect(plc === undefined ? undefined : plcMetaOf(plc)?.model).toBe('FX5U');
    expect(validateNetlist(netlist)).toEqual([]);
  });

  it('leaves the netlist unchanged for a board without a PLC', () => {
    const plain = toNetlist(createSession(JIPM_BOARD, { roles: TASK1_SOCKET_ROLES }), JIPM_BOARD);
    expect(plain.parts.some((p) => p.id === 'PLC')).toBe(false);
  });

  it('stays under the solver node limit with the PLC on the board (§5.2)', () => {
    const netlist = toNetlist(wired(), BOARD);
    const nets = buildNets(netlist);
    expect(nets.nodeCount).toBeLessThan(MAX_NODES);
  });

  it('puts the PLC input terminals and the board rails in the expected nets (§10.2)', () => {
    const netlist = toNetlist(wired(), BOARD);
    const nets = buildNets(netlist);
    const ssNode = nets.nodeOf(t('PLC.SS'));
    expect(nets.terminalsOf(ssNode)).toContain('P.1');
    expect(nets.terminalsOf(ssNode)).toContain('PLC.COM0');
  });
});

describe('机上配線の経路', () => {
  it('keeps desk wires out of the board routing (§6.6 の不変条件を壊さない)', () => {
    const session = wired();
    const routes = routeSession(BOARD, session);
    const routed = new Set(routes.map((r) => r.wireId));
    const desk = deskWires(BOARD, session);
    expect(desk.map((d) => d.id).sort()).toEqual(
      session.wires
        .filter((w) => w.from.startsWith('PLC.') || w.to.startsWith('PLC.') || w.from.startsWith('OUTLET.') || w.to.startsWith('OUTLET.'))
        .map((w) => w.id)
        .sort(),
    );
    for (const wire of desk) expect(routed.has(wire.id)).toBe(false);
    // 盤の中だけで閉じた電線はこれまでどおり経路が出る
    expect(routed.has('w-003')).toBe(true);
  });

  it('gives both endpoints of a desk wire a position for the 3D cable (Plan 3B)', () => {
    const desk = deskWires(BOARD, wired());
    const outlet = desk.find((d) => String(d.from) === 'OUTLET.L' || String(d.to) === 'OUTLET.L');
    expect(outlet?.fromPos).toBeDefined();
    expect(outlet?.toPos).toBeDefined();
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/board-model exec vitest run test/plc-unit.test.ts test/plc-netlist.test.ts
```

Expected: 失敗。`SyntaxError: The requested module '../src/index.js' does not provide an export named 'withPlcUnit'`。

- [ ] **Step 3: `src/board-jipm.ts` に机上デバイスの型と判定を足す**

`TerminalRole` に §6.6 の PLC 用の役割を足す:

```ts
/** 端子の役割。§6.6 の `role`。 */
export type TerminalRole =
  | 'coil+'
  | 'coil-'
  | 'com'
  | 'no'
  | 'nc'
  | '+'
  | '-'
  | 'c'
  | 'a'
  | 'b'
  | 'ac'
  | 'x'
  | 'y'
  | 'ss'
  | 'plc-com'
  | 'ac-l'
  | 'ac-n';
```

`roleLabel()` に PLC 用の枝を足す（`case 'nc': return 'b';` の後ろ）:

```ts
    case 'ss':
      return 'S/S';
    case 'plc-com':
      return 'COM';
    case 'ac-l':
      return 'L';
    case 'ac-n':
      return 'N';
```

机上デバイスの定数と判定、PLC本体の定義型を足す（`BoardDefinition` の定義の直前）:

```ts
/** PLC本体の部品ID。§6.4 */
export const PLC_PART_ID = 'PLC';
/** 壁コンセントの部品ID。§6.4 / §10.1 */
export const OUTLET_ID = 'OUTLET';

/**
 * 机上に置く装置（PLC本体・壁コンセント）の端子か。§10.1
 * 盤面の座標系・占有矩形・配線帯の外にあるので、`validateBoard()` の盤内判定と
 * 経路生成（`routeSession()`）から外す。
 */
export function isOffBoardTerminal(id: TerminalId | string): boolean {
  return id.startsWith(`${PLC_PART_ID}.`) || id.startsWith(`${OUTLET_ID}.`);
}

/**
 * 机上に置くPLC本体1機種の定義。§10.1
 * 電気的な仕様（`spec`）は circuit-sim の `createPlcUnit()` にそのまま渡す。
 * 端子の物理的な並び順は一次資料が未確認のため §10.1 の表の記載順である（§17 #11）。
 */
export interface PlcUnitDefinition {
  /** 機種キー（`fx5u`）。 */
  id: string;
  /** 課題JSONの `plc.model` と一致する機種名（`FX5U`）。§7.6 */
  model: string;
  /** メーカーキー（`mitsubishi`）。§7.6 */
  vendor: string;
  displayName: string;
  sizeMm: { width: number; height: number; depth: number };
  /** 机上の設置位置（盤座標の延長。盤の右）。3Dは Plan 3B が描く。 */
  pos: Vec3;
  spec: PlcUnitSpec;
  terminals: readonly BoardTerminal[];
  /** 本体のLED表示。§10.1 */
  leds: readonly string[];
}
```

`import` に `type PlcUnitSpec` を足す（`@ojt/circuit-sim` から）。`BoardDefinition` に足す:

```ts
  /** 机上に置くPLC本体（モードDの盤だけが持つ）。`withPlcUnit()` が付ける。§10.1 */
  plcUnit?: PlcUnitDefinition;
```

`validateBoard()` の端子ループを1行直す:

```ts
    if (!isOffBoardTerminal(term.id) && !rectContains(boardRect, term.pos)) {
      errors.push(`端子が盤の外にあります: ${term.id}`);
    }
```

- [ ] **Step 4: `src/plc-unit.ts` を書く**

`packages/board-model/src/plc-unit.ts`:

```ts
import { type PlcUnitSpec, type TerminalId } from '@ojt/circuit-sim';
import {
  OUTLET_ID,
  PLC_PART_ID,
  TERMINAL_PICK_RADIUS_MM,
  type BoardDefinition,
  type BoardTerminal,
  type PlcUnitDefinition,
  type TerminalRole,
} from './board-jipm.js';
import { vec3, type Vec3 } from './geometry.js';

/**
 * 机上に置くPLC本体と壁コンセント。設計仕様 §10.1 / §10.2。
 *
 * Phase 3 の対象は三菱 FX5U-32MR/ES のみである（§16）。Phase 4 で CP1E・PC10G-1SP・JW300 を
 * 足すときは、この形の定義をもう3つ並べて `PLC_UNITS` に登録するだけでよい。
 * 端子の**並び順**は一次資料が未確認のため §10.1 の表の記載順を採る（§17 #11）。
 */

/** PLC本体の端子の列ピッチ[mm]（当たり判定半径4mmが重ならない値）。 */
export const PLC_TERMINAL_PITCH_MM = 9;
/** 千鳥2列の段間[mm]。 */
export const PLC_ROW_GAP_MM = 9;
/** 千鳥のずらし量[mm]。 */
export const PLC_STAGGER_MM = 4.5;
/** 机上のPLC本体の左奥の角（盤座標の延長。盤の右）。§10.1 */
export const PLC_ORIGIN_MM: Vec3 = vec3(390, 18, 0);
/** 壁コンセントの位置[mm]。 */
export const OUTLET_ORIGIN_MM: Vec3 = vec3(395, 190, 0);

/** FX5U の入力回路の抵抗[Ω]。§5.1.3 */
export const FX5U_INPUT_OHMS = 4500;
/** FX5U の入力ON感度[A]（3.5mA）。§5.1.3 */
export const FX5U_ON_AMPS = 0.0035;
/** FX5U の入力OFF感度[A]（1.5mA）。§5.1.3 */
export const FX5U_OFF_AMPS = 0.0015;
/** 1コモンあたりの出力点数（本アプリの前提値。§17.1）。 */
export const FX5U_POINTS_PER_COMMON = 4;

/** 8進表記の端子名を作る（`X0`〜`X7`, `X10`〜`X17`）。§10.1 */
export function octalNames(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => `${prefix}${i.toString(8)}`);
}

/** FX5U-32MR/ES の電気的な仕様。§10.1 / §5.1.3 */
export const FX5U_SPEC: PlcUnitSpec = {
  model: 'FX5U',
  power: ['L', 'PE', 'N'],
  inputCommon: 'SS',
  service: ['24V', '0V'],
  inputs: octalNames('X', 16),
  commons: ['COM0', 'COM1', 'COM2', 'COM3'],
  outputs: octalNames('Y', 16).map((name, index) => ({
    name,
    com: `COM${Math.floor(index / FX5U_POINTS_PER_COMMON)}`,
  })),
  inputOhms: FX5U_INPUT_OHMS,
  onAmps: FX5U_ON_AMPS,
  offAmps: FX5U_OFF_AMPS,
};

/** 端子名 → 役割（§6.6 の `role`）。 */
function plcRole(name: string): TerminalRole {
  if (name === 'L') return 'ac-l';
  if (name === 'N') return 'ac-n';
  if (name === 'PE') return 'ac';
  if (name === 'SS') return 'ss';
  if (name === '24V') return '+';
  if (name === '0V') return '-';
  if (name.startsWith('COM')) return 'plc-com';
  if (name.startsWith('X')) return 'x';
  return 'y';
}

/** 端子名 → 銘板（実機の印字）。 */
function plcLabel(name: string): string {
  if (name === 'SS') return 'S/S';
  if (name === 'PE') return '⏚';
  return name;
}

/** 千鳥2列に並べた端子を作る。偶数番が奥列、奇数番が手前列。 */
function staggeredTerminals(names: readonly string[], origin: Vec3): BoardTerminal[] {
  return names.map((name, index) => ({
    id: `${PLC_PART_ID}.${name}` as TerminalId,
    label: plcLabel(name),
    role: plcRole(name),
    pos: vec3(
      origin.x + Math.floor(index / 2) * PLC_TERMINAL_PITCH_MM + (index % 2) * PLC_STAGGER_MM,
      origin.y + (index % 2) * PLC_ROW_GAP_MM,
      origin.z,
    ),
    pickRadiusMm: TERMINAL_PICK_RADIUS_MM,
    wirable: true,
    optional: false,
    exit: 'either',
  }));
}

/** FX5U の端子（入力側の列 → 出力側の列）。§10.1 の記載順。 */
function fx5uTerminals(): BoardTerminal[] {
  const inputSide = [
    ...FX5U_SPEC.power,
    FX5U_SPEC.inputCommon,
    ...(FX5U_SPEC.service ?? []),
    ...FX5U_SPEC.inputs,
  ];
  const outputSide: string[] = [];
  FX5U_SPEC.outputs.forEach((output, index) => {
    if (index % FX5U_POINTS_PER_COMMON === 0) outputSide.push(output.com);
    outputSide.push(output.name);
  });
  return [
    ...staggeredTerminals(inputSide, vec3(PLC_ORIGIN_MM.x + 6, PLC_ORIGIN_MM.y + 6, 0)),
    ...staggeredTerminals(outputSide, vec3(PLC_ORIGIN_MM.x + 6, PLC_ORIGIN_MM.y + 72, 0)),
  ];
}

/** 三菱 FX5U-32MR/ES。§10.1 */
export const PLC_UNIT_FX5U: PlcUnitDefinition = {
  id: 'fx5u',
  model: 'FX5U',
  vendor: 'mitsubishi',
  displayName: '三菱 MELSEC iQ-F FX5U-32MR/ES',
  sizeMm: { width: 150, height: 90, depth: 83 },
  pos: PLC_ORIGIN_MM,
  spec: FX5U_SPEC,
  terminals: fx5uTerminals(),
  leds: ['PWR', 'ERR', 'P.RUN', 'BAT', 'CARD'],
};

/** 機種名（課題JSONの `plc.model`）→ 本体定義。Phase 4 で3機種増える。§7.6 */
export const PLC_UNITS: Readonly<Record<string, PlcUnitDefinition>> = {
  FX5U: PLC_UNIT_FX5U,
};

/** 機種名から本体定義を引く。未対応の機種は undefined（課題エラーにするのは content の責務）。 */
export function plcUnitFor(model: string): PlcUnitDefinition | undefined {
  return PLC_UNITS[model];
}

/** 壁コンセント（AC100V）の端子。§10.1 */
export const OUTLET_TERMINALS: readonly BoardTerminal[] = (['L', 'N'] as const).map(
  (name, index) => ({
    id: `${OUTLET_ID}.${name}` as TerminalId,
    label: name,
    role: name === 'L' ? ('ac-l' as const) : ('ac-n' as const),
    pos: vec3(OUTLET_ORIGIN_MM.x + index * PLC_TERMINAL_PITCH_MM, OUTLET_ORIGIN_MM.y, 0),
    pickRadiusMm: TERMINAL_PICK_RADIUS_MM,
    wirable: true,
    optional: false,
    exit: 'either' as const,
  }),
);

/**
 * 盤にPLC本体と壁コンセントを載せた**派生盤**を返す。§10.1 / 決定表#8
 * `id` は変えない（セッションは `boardId` で盤と照合するため）。占有矩形・配線帯は
 * 机上の装置を含まないので、盤の経路生成の不変条件（§6.6）はそのまま保たれる。
 */
export function withPlcUnit(board: BoardDefinition, unit: PlcUnitDefinition): BoardDefinition {
  return {
    ...board,
    plcUnit: unit,
    terminals: [...board.terminals, ...unit.terminals, ...OUTLET_TERMINALS],
  };
}
```

- [ ] **Step 5: `src/to-netlist.ts` と `src/routing.ts` を直す**

`to-netlist.ts` の import を差し替える（`createPlcUnit` を足し、`./board-jipm.js` から `OUTLET_ID` / `PLC_PART_ID` を足す。他の名前は現状のまま）:

```ts
import {
  createBuzzer,
  createLamp,
  createNetlist,
  createPlcUnit,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTerminalBlockLink,
  createTimer4c,
  partId,
  terminalId,
  validateNetlist,
  type LinkElement,
  type Netlist,
  type NetlistIssue,
  type Part,
  type TerminalId,
  type Wire,
} from '@ojt/circuit-sim';
import { OUTLET_ID, PLC_PART_ID, SOCKET_IDS, type BoardDefinition } from './board-jipm.js';
```

`toNetlist()` のソケットのループの後ろ（`const links = ...` の前）に足す:

```ts
  // 机上のPLC本体と壁コンセントは部品配列の末尾に置く（既存の部品順を変えないため）。§10.1
  if (board.plcUnit !== undefined) {
    parts.push(createPlcUnit(PLC_PART_ID, board.plcUnit.spec));
    parts.push(
      createTerminalOnlyPart(OUTLET_ID, [
        terminalId(OUTLET_ID, 'L'),
        terminalId(OUTLET_ID, 'N'),
      ]),
    );
  }
```

`routing.ts` の `routeSession()` を直し、`deskWires()` を足す:

```ts
/** 机上へ渡る電線（盤の経路生成の対象外）。§10.1 / 決定表#9 */
export interface DeskWire {
  id: string;
  from: TerminalId;
  to: TerminalId;
  fromPos: Vec3;
  toPos: Vec3;
}

/**
 * セッションの全電線の経路を、配列の並び順に求める。§6.6
 * （中略：既存のコメント）
 *
 * **机上の装置（PLC本体・壁コンセント）に繋がる電線は含まない。** 盤面の配線帯は机上まで
 * 伸びていないため、経路器にかけると帯・レーン・占有矩形の不変条件が壊れる。机上へ渡る
 * 電線は {@link deskWires} で取り、3D側は直線のケーブルとして描く（Plan 3B）。
 */
export function routeSession(board: BoardDefinition, session: BoardSession): WireRoute[] {
  const routes: WireRoute[] = [];
  for (const wire of session.wires) {
    if (isOffBoardTerminal(wire.from) || isOffBoardTerminal(wire.to)) continue;
    routes.push(
      routeWire(
        board,
        {
          id: wire.id,
          from: toPhysicalTerminal(session.socketRoles, wire.from),
          to: toPhysicalTerminal(session.socketRoles, wire.to),
        },
        routes,
      ),
    );
  }
  return routes;
}

/**
 * 机上へ渡る電線（PLC本体・壁コンセントに繋がるもの）。§10.1
 * 盤側の端子は物理端子IDに解決してから座標を引く。盤に無い端子（未割当の役割など）は飛ばす。
 */
export function deskWires(board: BoardDefinition, session: BoardSession): DeskWire[] {
  const out: DeskWire[] = [];
  for (const wire of session.wires) {
    if (!isOffBoardTerminal(wire.from) && !isOffBoardTerminal(wire.to)) continue;
    const from = toPhysicalTerminal(session.socketRoles, wire.from);
    const to = toPhysicalTerminal(session.socketRoles, wire.to);
    const fromTerminal = findBoardTerminal(board, from);
    const toTerminal = findBoardTerminal(board, to);
    if (fromTerminal === undefined || toTerminal === undefined) continue;
    out.push({ id: wire.id, from, to, fromPos: fromTerminal.pos, toPos: toTerminal.pos });
  }
  return out;
}
```

（`routing.ts` の import に `findBoardTerminal` と `isOffBoardTerminal` を足す。）

- [ ] **Step 6: `src/index.ts` に再エクスポートを足す**

```ts
export {
  FX5U_INPUT_OHMS,
  FX5U_OFF_AMPS,
  FX5U_ON_AMPS,
  FX5U_POINTS_PER_COMMON,
  FX5U_SPEC,
  octalNames,
  OUTLET_ORIGIN_MM,
  OUTLET_TERMINALS,
  PLC_ORIGIN_MM,
  PLC_ROW_GAP_MM,
  PLC_STAGGER_MM,
  PLC_TERMINAL_PITCH_MM,
  PLC_UNIT_FX5U,
  PLC_UNITS,
  plcUnitFor,
  withPlcUnit,
} from './plc-unit.js';
```

`./board-jipm.js` の再エクスポートに `isOffBoardTerminal` / `OUTLET_ID` / `PLC_PART_ID` / `type PlcUnitDefinition`、`./routing.js` の再エクスポートに `deskWires` / `type DeskWire` を足す。

- [ ] **Step 7: GREEN を確認する**

```powershell
pnpm --filter @ojt/board-model exec vitest run test/plc-unit.test.ts test/plc-netlist.test.ts
pnpm --filter @ojt/board-model exec vitest run
```

Expected: 新しい2ファイルが `Tests  17 passed (17)`、パッケージ全体は着手時のベースライン（前提#14。目安158件）＋17件が通る。**既存の経路テスト（`routing*.test.ts`）は1件も落ちないはずである**（PLCを載せない盤では `routeSession()` の新しい `continue` に一度も入らない）。

- [ ] **Step 8: カバレッジとコミット**

```powershell
pnpm --filter @ojt/board-model exec vitest run --coverage
pnpm --filter @ojt/board-model typecheck
npx prettier --check "packages/board-model/**/*.ts"
git add packages/board-model
git commit -m "feat(board-model): put the FX5U and the wall outlet on the desk beside the board"
```

---
## Task 8: `@ojt/plc-dialects` の雛形と `DialectProfile`

**Files:**
- Create: `packages/plc-dialects/package.json`
- Create: `packages/plc-dialects/tsconfig.json`
- Create: `packages/plc-dialects/vitest.config.ts`
- Create: `packages/plc-dialects/src/profile.ts`
- Create: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/profile.test.ts`

§10.5 のインターフェースと §10.6 のスキン定義の**型**を置く。データ（三菱プロファイル）は Task 9・10 で足す。このパッケージは `@ojt/ladder-core` だけに依存し、逆向きの依存を持たない（§4.2）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/package.json`:

```json
{
  "name": "@ojt/plc-dialects",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@ojt/ladder-core": "workspace:*"
  }
}
```

`packages/plc-dialects/tsconfig.json` と `vitest.config.ts` は `packages/ladder-core` のものと同じ内容にする（`rootDir: "."`、`include` は `src` / `test` / `vitest.config.ts`、カバレッジ閾値90%）。

`packages/plc-dialects/test/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DIALECT_IDS,
  IMPLEMENTED_DIALECT_IDS,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  UnknownDialectError,
  availableDialects,
  getDialect,
  isDialectId,
} from '../src/index.js';

describe('方言の一覧', () => {
  it('lists the four vendors of 決定事項#14 in release order', () => {
    expect(DIALECT_IDS).toEqual(['mitsubishi', 'jtekt', 'omron', 'sharp']);
    expect(isDialectId('mitsubishi')).toBe(true);
    expect(isDialectId('siemens')).toBe(false);
  });

  it('implements only Mitsubishi in Phase 3 (§16)', () => {
    expect(IMPLEMENTED_DIALECT_IDS).toEqual(['mitsubishi']);
    expect(availableDialects().map((d) => d.id)).toEqual(['mitsubishi']);
  });

  it('throws a readable error for a dialect that Phase 4 will add', () => {
    expect(() => getDialect('omron')).toThrow(UnknownDialectError);
    expect(() => getDialect('omron')).toThrow(/Phase 4/u);
  });

  it('bounds the display grid the settings screen may choose (§10.6)', () => {
    expect([MIN_GRID_COLS, MAX_GRID_COLS]).toEqual([8, 15]);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm install
pnpm --filter @ojt/plc-dialects exec vitest run
```

Expected: 失敗。`Error: Failed to load url ../src/index.js`。

- [ ] **Step 3: `src/profile.ts` を書く**

`packages/plc-dialects/src/profile.ts`:

```ts
import type { Device, DeviceKind, LadderProgram } from '@ojt/ladder-core';

/**
 * 方言プロファイルのインターフェース。設計仕様 §10.5 / §10.6。
 *
 * 1メーカー1機種ぶんの「デバイス表記・タイマ単位・命令語・バリデータ・スキン定義」をまとめた
 * 実装単位である（§2 用語）。IRとランタイムは方言を知らないので、Phase 4 でメーカーを足すときも
 * 触るのはこのインターフェースの実装ファイルだけで済む（§17.1 の「修正箇所」の区分）。
 */

/** 方言ID（決定事項#14 の4メーカー）。 */
export type DialectId = 'mitsubishi' | 'jtekt' | 'omron' | 'sharp';

/** 方言IDの一覧（初回リリースの順）。 */
export const DIALECT_IDS: readonly DialectId[] = ['mitsubishi', 'jtekt', 'omron', 'sharp'];

/** Phase 3 で実装済みの方言。§16 */
export const IMPLEMENTED_DIALECT_IDS: readonly DialectId[] = ['mitsubishi'];

/** 表示グリッドの接点列数の下限・上限（利用者が設定画面で選べる範囲）。§10.6 */
export const MIN_GRID_COLS = 8;
/** IRが16列でコイル列に1列使うため上限は15。§10.6 */
export const MAX_GRID_COLS = 15;

/** 文字列が方言IDか。 */
export function isDialectId(value: string): value is DialectId {
  return (DIALECT_IDS as readonly string[]).includes(value);
}

/** デバイス1種別の番号体系。§10.5 */
export interface DeviceRange {
  radix: 8 | 10 | 16;
  prefix: string;
  min: number;
  max: number;
}

/** 方言バリデータの指摘1件。§10.5 / §10.8 */
export interface DialectError {
  code: string;
  message: string;
  device?: Device;
  networkId?: string;
  row?: number;
  col?: number;
}

/** 命令語の項目。§10.5 */
export type InstructionKey =
  | 'ld'
  | 'ldi'
  | 'and'
  | 'ani'
  | 'or'
  | 'ori'
  | 'out'
  | 'set'
  | 'rst'
  | 'pulseUp'
  | 'pulseDown'
  | 'timer'
  | 'counter';

/**
 * ショートカット1件。§10.6
 * `confirmed` は「一次資料で確認済み（◎）」か「§17.1 の前提方針で採用した慣例（△）」かを表す。
 * UIは △ の項目に注記を出せる（§12.1 の常設注記と対応する）。
 */
export interface ShortcutEntry {
  action: string;
  keys: string;
  label: string;
  confirmed: boolean;
}

/** ショートカット表。§10.6 */
export type ShortcutTable = readonly ShortcutEntry[];

/**
 * 記号の描画定義。§10.6
 * **各社のロゴ・アイコン・画面キャプチャ・図記号ビットマップは持たない**（§17 / PLC調査資料 §6）。
 * ここにあるのは「どの線画を描くか」を指す自前の識別子だけで、描画は Plan 3B が行う。
 */
export interface SymbolDrawing {
  no: string;
  nc: string;
  rise: string;
  fall: string;
  coil: string;
  set: string;
  rst: string;
  timer: string;
  counter: string;
}

/** モニタ中の通電表示色。§10.6 */
export interface MonitorColors {
  /** 通電している回路の色。 */
  powered: string;
  /** 非通電の色。 */
  idle: string;
}

/** 画面構成（パネルの名称と並び）。§10.6 */
export interface PanelLayout {
  tree: string;
  editor: string;
  output: string;
  toolbar: readonly string[];
}

/** タイマ設定値の方言表記。 */
export interface TimerPresetText {
  text: string;
  device: Device;
}

/** 方言プロファイル。§10.5 */
export interface DialectProfile {
  id: DialectId;
  displayName: string;
  /** IRのデバイス → 方言表記（`X8` は三菱では `X10`）。 */
  formatDevice(device: Device): string;
  /** 方言表記 → IRのデバイス。読めない表記は `Error` を返す（投げない）。 */
  parseDevice(text: string): Device | Error;
  deviceRanges: Readonly<Record<DeviceKind, DeviceRange>>;
  /** ms → 方言のタイマ設定表記。機種で表せない値は `Error`。§10.5 */
  timerPreset(ms: number, device: Device): TimerPresetText | Error;
  /** 方言のタイマ設定表記 → ms。 */
  parseTimerPreset(text: string, device: Device): number | Error;
  instructionNames: Readonly<Record<InstructionKey, string>>;
  /** 特殊デバイス番号（`SP0`〜`SP2`）→ 実デバイス名。§10.3 / §10.5 */
  specialDevices: Readonly<Record<number, string>>;
  symbols: SymbolDrawing;
  /** 表示グリッドの接点列数（コイル列を含まない）。§10.6 */
  gridCols: number;
  shortcuts: ShortcutTable;
  /** 「変換」操作を要求するか。§10.6 */
  convertStep: boolean;
  monitorColors: MonitorColors;
  panels: PanelLayout;
  /** 方言に依る検査（デバイス範囲・タイマ単位・番号重複）。§10.8 */
  validate(program: LadderProgram): DialectError[];
  errorMessages: Readonly<Record<string, string>>;
}

/** まだ実装していない方言を要求されたときに投げる。 */
export class UnknownDialectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownDialectError';
  }
}
```

`packages/plc-dialects/src/index.ts`:

```ts
export {
  DIALECT_IDS,
  IMPLEMENTED_DIALECT_IDS,
  isDialectId,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  UnknownDialectError,
  type DeviceRange,
  type DialectError,
  type DialectId,
  type DialectProfile,
  type InstructionKey,
  type MonitorColors,
  type PanelLayout,
  type ShortcutEntry,
  type ShortcutTable,
  type SymbolDrawing,
  type TimerPresetText,
} from './profile.js';

import {
  DIALECT_IDS,
  UnknownDialectError,
  type DialectId,
  type DialectProfile,
} from './profile.js';

/**
 * 実装済みの方言プロファイル。Phase 4 で3つ増える（§16）。
 * Task 9・10 で `MITSUBISHI_FX5U` を足すまでは空にしておく。
 */
const PROFILES: Partial<Record<DialectId, DialectProfile>> = {};

/** 実装済みの方言プロファイル一覧（`DIALECT_IDS` の順）。 */
export function availableDialects(): DialectProfile[] {
  return DIALECT_IDS.map((id) => PROFILES[id]).filter(
    (profile): profile is DialectProfile => profile !== undefined,
  );
}

/** 方言プロファイルを引く。未実装のメーカーは `UnknownDialectError`。 */
export function getDialect(id: DialectId): DialectProfile {
  const profile = PROFILES[id];
  if (profile === undefined) {
    throw new UnknownDialectError(`この方言はまだ実装されていません（Phase 4 で追加します）: ${id}`);
  }
  return profile;
}
```

**注意:** この段階では `PROFILES` が空なので `IMPLEMENTED_DIALECT_IDS` と `availableDialects()` が食い違う。テストの `IMPLEMENTED_DIALECT_IDS` / `availableDialects()` の2件は **Task 9 で三菱を登録したあとに通る**。この2件は Task 8 の時点では `it.todo` にせず、**Task 9 の GREEN 条件**として扱う（Task 8 の Step 4 では残り2件が通ればよい）。

- [ ] **Step 4: 部分 GREEN を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run
```

Expected: `Tests  2 passed | 2 failed`（方言一覧と表示列数の2件が通り、`IMPLEMENTED_DIALECT_IDS` と `availableDialects()` の2件が Task 9 待ちで落ちる）。

- [ ] **Step 5: コミットする**

```powershell
pnpm --filter @ojt/plc-dialects typecheck
npx prettier --check "packages/plc-dialects/**/*.{ts,json}"
git add packages/plc-dialects
git commit -m "feat(plc-dialects): define the dialect profile and skin interfaces"
```

---

## Task 9: 三菱 FX5U のデバイス体系とタイマ単位

**Files:**
- Create: `packages/plc-dialects/src/mitsubishi.ts`
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/mitsubishi-devices.test.ts`

§10.5 の表の三菱の列を実装する。X/Y は**8進**、M/T/C は10進、特殊デバイスは `M8000`（常時ON）/ `M8002`（初期パルス）/ `M8013`（1秒クロック）。タイマ単位は「既定100ms／`T200`〜10ms／`T256`〜1ms」（§17 #20 の前提値）で、**ゴールデンケース #25**（`T0 K100`=10s、`T200 K100`=1s）をここで固定する。

| 決めること | 本タスクの実装 |
|---|---|
| 8進表記 | `formatDevice(X(8))` → `'X10'`。`parseDevice('X8')` は `Error`（8進に8・9は無い。§10.5 の固有バリデーション） |
| 特殊デバイス | `formatDevice(SP(0))` → `'M8000'`。`parseDevice('M8000')` は**特殊デバイス**として返す（内部リレーの `M8000` とは解釈しない） |
| タイマ単位 | 番号で時間単位が変わる。`T0`〜`T199`=100ms、`T200`〜`T255`=10ms、`T256`以上=1ms |
| 表せない値 | `timerPreset(15, T(0))` は `Error`（UIが §10.5 の「100ms 刻みに丸めますか？」を出す） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/mitsubishi-devices.test.ts`:

```ts
import { C, M, SP, T, X, Y } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { getDialect, MITSUBISHI_FX5U, TIMER_BASE_MS } from '../src/index.js';

const profile = MITSUBISHI_FX5U;

describe('三菱 FX5U のデバイス表記（§10.5）', () => {
  it('is registered as the mitsubishi dialect', () => {
    expect(getDialect('mitsubishi')).toBe(profile);
    expect(profile.id).toBe('mitsubishi');
    expect(profile.displayName).toContain('FX5U');
  });

  it('formats X and Y in octal and M/T/C in decimal', () => {
    expect(profile.formatDevice(X(0))).toBe('X0');
    expect(profile.formatDevice(X(7))).toBe('X7');
    expect(profile.formatDevice(X(8))).toBe('X10');
    expect(profile.formatDevice(Y(15))).toBe('Y17');
    expect(profile.formatDevice(M(10))).toBe('M10');
    expect(profile.formatDevice(T(200))).toBe('T200');
    expect(profile.formatDevice(C(3))).toBe('C3');
  });

  it('maps the three special devices to the FX numbers (§10.5 / §17 #22)', () => {
    expect(profile.formatDevice(SP(0))).toBe('M8000');
    expect(profile.formatDevice(SP(1))).toBe('M8002');
    expect(profile.formatDevice(SP(2))).toBe('M8013');
    expect(profile.specialDevices).toEqual({ 0: 'M8000', 1: 'M8002', 2: 'M8013' });
  });

  it('parses the dialect notation back into IR devices', () => {
    expect(profile.parseDevice('X10')).toEqual(X(8));
    expect(profile.parseDevice('Y17')).toEqual(Y(15));
    expect(profile.parseDevice('M100')).toEqual(M(100));
    expect(profile.parseDevice('T7')).toEqual(T(7));
    expect(profile.parseDevice('C0')).toEqual(C(0));
    expect(profile.parseDevice('M8002')).toEqual(SP(1));
  });

  it('rejects octal digits 8 and 9 on X and Y (§10.5 の固有バリデーション)', () => {
    expect(profile.parseDevice('X8')).toBeInstanceOf(Error);
    expect(profile.parseDevice('Y9')).toBeInstanceOf(Error);
    expect(String(profile.parseDevice('X8'))).toContain('8進');
  });

  it('rejects unknown prefixes and out-of-range numbers', () => {
    expect(profile.parseDevice('Z0')).toBeInstanceOf(Error);
    expect(profile.parseDevice('')).toBeInstanceOf(Error);
    expect(profile.parseDevice('T9000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('X2000')).toBeInstanceOf(Error);
  });

  it('publishes the device ranges of §10.5', () => {
    expect(profile.deviceRanges.input).toEqual({ radix: 8, prefix: 'X', min: 0, max: 1023 });
    expect(profile.deviceRanges.internal).toEqual({ radix: 10, prefix: 'M', min: 0, max: 32767 });
    expect(profile.deviceRanges.timer).toEqual({ radix: 10, prefix: 'T', min: 0, max: 7999 });
    expect(profile.deviceRanges.counter.max).toBe(32767);
  });
});

describe('三菱 FX5U のタイマ単位（ゴールデンケース #25 / §8.2 / §17 #20）', () => {
  it('uses 100 ms up to T199, 10 ms from T200 and 1 ms from T256', () => {
    expect(TIMER_BASE_MS(T(0))).toBe(100);
    expect(TIMER_BASE_MS(T(199))).toBe(100);
    expect(TIMER_BASE_MS(T(200))).toBe(10);
    expect(TIMER_BASE_MS(T(255))).toBe(10);
    expect(TIMER_BASE_MS(T(256))).toBe(1);
  });

  it('renders T0 K100 as 10 s and T200 K100 as 1 s (#25)', () => {
    expect(profile.timerPreset(10_000, T(0))).toEqual({ text: 'K100', device: T(0) });
    expect(profile.timerPreset(1_000, T(200))).toEqual({ text: 'K100', device: T(200) });
    expect(profile.parseTimerPreset('K100', T(0))).toBe(10_000);
    expect(profile.parseTimerPreset('K100', T(200))).toBe(1_000);
    expect(profile.parseTimerPreset('K30', T(256))).toBe(30);
  });

  it('refuses a preset the numbering band cannot express (§10.5)', () => {
    const error = profile.timerPreset(15, T(0));
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('100ms');
    expect(profile.timerPreset(0, T(0))).toBeInstanceOf(Error);
    expect(profile.timerPreset(10_000_000, T(0))).toBeInstanceOf(Error);
    expect(profile.timerPreset(15, T(200))).toBeInstanceOf(Error);
    expect(profile.timerPreset(150, T(200))).toEqual({ text: 'K15', device: T(200) });
  });

  it('refuses a preset text that is not K<number>', () => {
    expect(profile.parseTimerPreset('100', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('K', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('K0', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('K40000', T(0))).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/mitsubishi-devices.test.ts
```

Expected: 失敗。`SyntaxError: The requested module '../src/index.js' does not provide an export named 'MITSUBISHI_FX5U'`。

- [ ] **Step 3: `src/mitsubishi.ts` を書く（デバイスとタイマ部分）**

`packages/plc-dialects/src/mitsubishi.ts`:

```ts
import {
  device,
  deviceLabel,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  type Device,
  type DeviceKind,
  type LadderProgram,
} from '@ojt/ladder-core';
import type {
  DeviceRange,
  DialectError,
  DialectProfile,
  InstructionKey,
  MonitorColors,
  PanelLayout,
  ShortcutTable,
  SymbolDrawing,
  TimerPresetText,
} from './profile.js';

/**
 * 三菱 MELSEC iQ-F FX5U ＋ GX Works3風スキンの方言プロファイル。設計仕様 §10.5 / §10.6。
 *
 * 命令語・タイマ単位・特殊リレー番号のうち一次資料で確認できていない項目は、§17.1 の前提方針に
 * 従って「三菱系ツールで広く知られた値」を本アプリの表記として採用している（§17 #19・#20・#22）。
 * 実機と異なると分かった場合の修正箇所は**このファイルだけ**で、IR・ランタイム・回路エンジンは
 * 変更しなくてよい。
 */

/** タイマの番号帯ごとの時間単位[ms]。§8.2 / §17 #20 */
export function TIMER_BASE_MS(timer: Device): number {
  if (timer.index >= 256) return 1;
  if (timer.index >= 200) return 10;
  return 100;
}

/** タイマ設定値 `K` の範囲。 */
const MIN_K = 1;
const MAX_K = 32_767;

/** デバイス種別ごとの番号体系。§10.5 */
const DEVICE_RANGES: Readonly<Record<DeviceKind, DeviceRange>> = {
  input: { radix: 8, prefix: 'X', min: 0, max: 1023 },
  output: { radix: 8, prefix: 'Y', min: 0, max: 1023 },
  internal: { radix: 10, prefix: 'M', min: 0, max: 32_767 },
  timer: { radix: 10, prefix: 'T', min: 0, max: 7_999 },
  counter: { radix: 10, prefix: 'C', min: 0, max: 32_767 },
  special: { radix: 10, prefix: 'M', min: 0, max: 2 },
};

/** 特殊デバイス番号 → FX の実デバイス名。§10.5 / §17 #22 */
const SPECIAL_DEVICES: Readonly<Record<number, string>> = {
  [SPECIAL_ALWAYS_ON]: 'M8000',
  [SPECIAL_FIRST_SCAN]: 'M8002',
  [SPECIAL_CLOCK_1S]: 'M8013',
};

/** 実デバイス名 → 特殊デバイス番号（`parseDevice` 用の逆引き）。 */
const SPECIAL_BY_NAME = new Map<string, number>(
  Object.entries(SPECIAL_DEVICES).map(([index, name]) => [name, Number(index)]),
);

/** IRのデバイス → 方言表記。X/Y は8進。§10.5 */
function formatDevice(target: Device): string {
  if (target.kind === 'special') return SPECIAL_DEVICES[target.index] ?? deviceLabel(target);
  const range = DEVICE_RANGES[target.kind];
  return `${range.prefix}${target.index.toString(range.radix)}`;
}

/** 方言表記 → IRのデバイス。読めない表記は Error を返す（投げない）。§10.5 */
function parseDevice(text: string): Device | Error {
  const trimmed = text.trim().toUpperCase();
  const special = SPECIAL_BY_NAME.get(trimmed);
  if (special !== undefined) return device('special', special);
  const matched = /^([XYMTC])([0-9]+)$/u.exec(trimmed);
  if (matched === null) return new Error(`読めないデバイス表記です: ${text}`);
  const prefix = matched[1] ?? '';
  const digits = matched[2] ?? '';
  const kind = (Object.keys(DEVICE_RANGES) as DeviceKind[]).find(
    (k) => k !== 'special' && DEVICE_RANGES[k].prefix === prefix,
  );
  if (kind === undefined) return new Error(`読めないデバイス表記です: ${text}`);
  const range = DEVICE_RANGES[kind];
  if (range.radix === 8 && /[89]/u.test(digits)) {
    return new Error(`${prefix} は8進で表記します（8・9は使えません）: ${text}`);
  }
  const index = parseInt(digits, range.radix);
  if (!Number.isFinite(index) || index < range.min || index > range.max) {
    return new Error(`デバイス番号が範囲外です（${range.prefix}${range.min}〜）: ${text}`);
  }
  return device(kind, index);
}

/** ms → `K` 表記。番号帯の単位で割り切れないと Error。§10.5 */
function timerPreset(ms: number, timer: Device): TimerPresetText | Error {
  const base = TIMER_BASE_MS(timer);
  if (!Number.isInteger(ms) || ms <= 0 || ms % base !== 0) {
    return new Error(
      `${formatDevice(timer)} は ${base}ms 単位で指定します（${ms}ms は指定できません）`,
    );
  }
  const k = ms / base;
  if (k < MIN_K || k > MAX_K) {
    return new Error(`${formatDevice(timer)} の設定値が範囲外です（K${MIN_K}〜K${MAX_K}）: K${k}`);
  }
  return { text: `K${k}`, device: timer };
}

/** `K` 表記 → ms。§10.5 */
function parseTimerPreset(text: string, timer: Device): number | Error {
  const matched = /^K([0-9]+)$/u.exec(text.trim().toUpperCase());
  const digits = matched?.[1];
  if (digits === undefined) return new Error(`タイマ設定値は K<数値> の形式です: ${text}`);
  const k = Number(digits);
  if (k < MIN_K || k > MAX_K) {
    return new Error(`タイマ設定値が範囲外です（K${MIN_K}〜K${MAX_K}）: ${text}`);
  }
  return k * TIMER_BASE_MS(timer);
}
```

（この続き――`validate()` とスキン定義、`MITSUBISHI_FX5U` の組み立て――は Task 10 で書く。Task 9 の時点では `MITSUBISHI_FX5U` を**先に空でない形で**作る必要があるため、下の暫定オブジェクトを置き、Task 10 で中身を差し替える。）

```ts
/** 三菱 FX5U ＋ GX Works3風スキン。スキン定義とバリデータは Task 10 で埋める。 */
export const MITSUBISHI_FX5U: DialectProfile = {
  id: 'mitsubishi',
  displayName: '三菱電機 MELSEC iQ-F FX5U（GX Works3風）',
  formatDevice,
  parseDevice,
  deviceRanges: DEVICE_RANGES,
  timerPreset,
  parseTimerPreset,
  specialDevices: SPECIAL_DEVICES,
  instructionNames: INSTRUCTION_NAMES,
  symbols: SYMBOLS,
  gridCols: 11,
  shortcuts: SHORTCUTS,
  convertStep: true,
  monitorColors: MONITOR_COLORS,
  panels: PANELS,
  validate,
  errorMessages: ERROR_MESSAGES,
};
```

**Task 9 での最小実装:** `INSTRUCTION_NAMES` / `SYMBOLS` / `SHORTCUTS` / `MONITOR_COLORS` / `PANELS` / `ERROR_MESSAGES` / `validate` は Task 10 で本実装するが、Task 9 の時点でも**型が通る値**が必要である。Task 10 の Step 3 にある定義をそのまま先に書いてよい（そのほうが差分が小さい）。`validate` だけは Task 9 では `() => []` にしておき、Task 10 で中身を入れる。

`packages/plc-dialects/src/index.ts` に足す（`PROFILES` の定義を差し替える）:

```ts
import { MITSUBISHI_FX5U } from './mitsubishi.js';

const PROFILES: Partial<Record<DialectId, DialectProfile>> = { mitsubishi: MITSUBISHI_FX5U };
```

さらに再エクスポートを足す:

```ts
export { MITSUBISHI_FX5U, TIMER_BASE_MS } from './mitsubishi.js';
```

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run
```

Expected: `Tests  14 passed (14)`（Task 8 で保留していた `IMPLEMENTED_DIALECT_IDS` / `availableDialects()` の2件もここで通る）。

- [ ] **Step 5: コミットする**

```powershell
pnpm --filter @ojt/plc-dialects typecheck
npx prettier --check "packages/plc-dialects/**/*.ts"
git add packages/plc-dialects
git commit -m "feat(plc-dialects): add the FX5U device notation and timer bands (golden #25)"
```

---

## Task 10: 方言バリデータ・GX Works3風スキン・「変換」

**Files:**
- Modify: `packages/plc-dialects/src/mitsubishi.ts`
- Create: `packages/plc-dialects/src/convert.ts`
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/mitsubishi-validate.test.ts`
- Test: `packages/plc-dialects/test/convert.test.ts`
- Test: `packages/plc-dialects/test/skin.test.ts`

§10.5 の固有バリデーション、§10.6 の GX Works3風スキン定義、そして決定事項#15 の「変換」操作を実装する。「変換」＝ `compile()`（構造）＋ `profile.validate()`（方言）で、結果は §10.6 の出力ウィンドウに並ぶ1つの一覧になる。

| 決めること | 本タスクの実装 |
|---|---|
| `validate()` | デバイス番号の範囲外（`device-range`）／タイマ設定値が番号帯で表せない（`timer-unit`）／カウンタ設定値が範囲外（`counter-range`）／未対応の特殊デバイス（`special-unsupported`） |
| スキン | `gridCols: 11`、`monitorColors.powered: '#1E64FF'`、`convertStep: true`、ショートカット表は §10.6 の◎（一次資料）と△（慣例）を `confirmed` で区別する |
| `convert()` | `compile()` のエラーと `validate()` の指摘を1つの配列にまとめ、両方空のときだけ `ok: true`。二重コイルの警告は `ok: true` でも返す |

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/mitsubishi-validate.test.ts`:

```ts
import {
  C,
  ctu,
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  SP,
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { MITSUBISHI_FX5U } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = MITSUBISHI_FX5U;

describe('三菱バリデータ（§10.5 固有バリデーション / §10.8）', () => {
  it('accepts a program that stays inside the device ranges', () => {
    const p = program(network('n1', [rung(no(X(0)), out(Y(3)))]), endNetwork());
    expect(profile.validate(p)).toEqual([]);
  });

  it('reports a device number outside the range', () => {
    const p = program(network('n1', [rung(no(X(2000)), out(Y(0)))]), endNetwork());
    const errors = profile.validate(p);
    expect(errors.map((e) => e.code)).toEqual(['device-range']);
    expect(errors[0]?.message).toContain('X');
    expect(errors[0]?.networkId).toBe('n1');
  });

  it('reports a timer preset the numbering band cannot express (§10.5)', () => {
    const p = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    const errors = profile.validate(p);
    expect(errors.map((e) => e.code)).toEqual(['timer-unit']);
    expect(errors[0]?.message).toContain('100ms');
    // T200 帯なら 10ms 単位なので 150ms は通る
    const ok = program(network('n1', [rung(no(X(0)), ton(T(200), 150))]), endNetwork());
    expect(profile.validate(ok)).toEqual([]);
  });

  it('reports a counter preset outside the range', () => {
    const p = program(network('n1', [rung(no(X(0)), ctu(C(0), 40_000, X(1)))]), endNetwork());
    expect(profile.validate(p).map((e) => e.code)).toEqual(['counter-range']);
  });

  it('accepts the three special devices the profile maps', () => {
    const p = program(
      network('n1', [rung(no(SP(0)), out(Y(0)))]),
      network('n2', [rung(no(SP(2)), out(Y(1)))]),
      endNetwork(),
    );
    expect(profile.validate(p)).toEqual([]);
  });

  it('has a Japanese message for every error code it can raise', () => {
    for (const code of ['device-range', 'timer-unit', 'counter-range', 'special-unsupported']) {
      expect(profile.errorMessages[code]).toBeDefined();
    }
  });
});
```

`packages/plc-dialects/test/convert.test.ts`:

```ts
import {
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { convert, MITSUBISHI_FX5U } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

describe('convert（決定事項#15 の「変換」）', () => {
  it('returns the compiled program when both checks pass', () => {
    const result = convert(program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork()), MITSUBISHI_FX5U);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.networks).toHaveLength(2);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports structural errors with source "structure" (§10.3)', () => {
    const result = convert(program(network('n1', [rung(no(X(0)), out(Y(0)))])), MITSUBISHI_FX5U);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.source).toBe('structure');
    expect(result.errors[0]?.code).toBe('missing-end');
  });

  it('reports dialect errors with source "dialect" (§10.5)', () => {
    const result = convert(
      program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork()),
      MITSUBISHI_FX5U,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.source)).toEqual(['dialect']);
    expect(result.errors[0]?.code).toBe('timer-unit');
  });

  it('keeps the double-coil warning on a successful conversion (§10.4)', () => {
    const result = convert(
      program(
        network('n1', [rung(no(X(0)), out(Y(0)))]),
        network('n2', [rung(no(X(1)), out(Y(0)))]),
        endNetwork(),
      ),
      MITSUBISHI_FX5U,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((w) => w.code)).toEqual(['double-coil']);
  });

  it('runs the dialect checks even when the structure already failed', () => {
    const result = convert(
      program(network('n1', [rung(no(X(2000)), ton(T(0), 150))])),
      MITSUBISHI_FX5U,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new Set(result.errors.map((e) => e.source))).toEqual(new Set(['structure', 'dialect']));
  });
});
```

`packages/plc-dialects/test/skin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_GRID_COLS, MIN_GRID_COLS, MITSUBISHI_FX5U } from '../src/index.js';

const skin = MITSUBISHI_FX5U;

describe('GX Works3風スキン（§10.6）', () => {
  it('requires the conversion step (§10.6 の操作フロー)', () => {
    expect(skin.convertStep).toBe(true);
  });

  it('shows 11 contact columns and the Mitsubishi monitor colour (§10.6 の本アプリ既定)', () => {
    expect(skin.gridCols).toBe(11);
    expect(skin.gridCols).toBeGreaterThanOrEqual(MIN_GRID_COLS);
    expect(skin.gridCols).toBeLessThanOrEqual(MAX_GRID_COLS);
    expect(skin.monitorColors.powered).toBe('#1E64FF');
  });

  it('binds F5 / F7 / F4 as §16 Phase 3 の受入基準① requires', () => {
    const keysOf = (action: string): string | undefined =>
      skin.shortcuts.find((s) => s.action === action)?.keys;
    expect(keysOf('contact-no')).toBe('F5');
    expect(keysOf('coil')).toBe('F7');
    expect(keysOf('convert')).toBe('F4');
    expect(keysOf('contact-nc')).toBe('F6');
    expect(keysOf('or-contact-no')).toBe('Shift+F5');
    expect(keysOf('toggle-no-nc')).toBe('/');
  });

  it('marks which shortcuts come from a primary source and which are assumptions (§17.1)', () => {
    const confirmed = skin.shortcuts.filter((s) => s.confirmed).map((s) => s.keys);
    const assumed = skin.shortcuts.filter((s) => !s.confirmed).map((s) => s.keys);
    expect(confirmed).toContain('F5');
    expect(confirmed).toContain('F7');
    expect(assumed).toContain('F4');
    expect(assumed).toContain('F6');
  });

  it('names the instructions of §10.5 / §17 #21', () => {
    expect(skin.instructionNames.ld).toBe('LD');
    expect(skin.instructionNames.ldi).toBe('LDI');
    expect(skin.instructionNames.out).toBe('OUT');
    expect(skin.instructionNames.pulseUp).toBe('PLS');
    expect(skin.instructionNames.pulseDown).toBe('PLF');
    expect(skin.instructionNames.timer).toBe('OUT T');
    expect(skin.instructionNames.counter).toBe('OUT C');
  });

  it('lists the three GX Works3 panels without borrowing any vendor artwork (§17 / PLC調査資料 §6)', () => {
    expect(skin.panels.tree).toContain('ナビゲーション');
    expect(skin.panels.editor).toContain('ラダー');
    expect(skin.panels.output).toContain('出力');
    expect(skin.panels.toolbar.length).toBeGreaterThan(0);
    // 記号定義は自前の線画の識別子だけを持つ（画像ファイル名やロゴを含まない）
    for (const value of Object.values(skin.symbols)) {
      expect(value).toMatch(/^[a-z-]+$/u);
    }
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run
```

Expected: 失敗。`convert` が未実装（`does not provide an export named 'convert'`）で、`validate()` が空配列を返すため方言バリデータの4件も落ちる。

- [ ] **Step 3: `src/mitsubishi.ts` に定義とバリデータを入れる**

Task 9 で仮置きした定数を本実装にする:

```ts
/** 命令語。§10.5 / §17 #21（FX3系の体系を採用） */
const INSTRUCTION_NAMES: Readonly<Record<InstructionKey, string>> = {
  ld: 'LD',
  ldi: 'LDI',
  and: 'AND',
  ani: 'ANI',
  or: 'OR',
  ori: 'ORI',
  out: 'OUT',
  set: 'SET',
  rst: 'RST',
  pulseUp: 'PLS',
  pulseDown: 'PLF',
  timer: 'OUT T',
  counter: 'OUT C',
};

/** 記号の線画（自前の識別子。ベンダーの図記号ビットマップは持たない）。§10.6 / §17 */
const SYMBOLS: SymbolDrawing = {
  no: 'contact-no',
  nc: 'contact-nc',
  rise: 'contact-rise',
  fall: 'contact-fall',
  coil: 'coil-round',
  set: 'coil-set',
  rst: 'coil-reset',
  timer: 'coil-timer',
  counter: 'coil-counter',
};

/** モニタ中の通電表示色（本アプリ既定。§10.6 / §17 #19） */
const MONITOR_COLORS: MonitorColors = { powered: '#1E64FF', idle: '#6B7280' };

/** 画面構成。§10.6 */
const PANELS: PanelLayout = {
  tree: 'ナビゲーションウィンドウ（プロジェクトツリー）',
  editor: 'ラダーエディタ',
  output: '出力ウィンドウ',
  toolbar: ['変換', '全変換', '書込みモード', '読出しモード', 'モニタ開始', 'モニタ停止'],
};

/**
 * ショートカット表。§10.6
 * `confirmed: true` は PLC調査資料 §1-D で確認済みの割当（◎）、`false` は §17.1 の前提方針で
 * 採用した三菱系ツールの慣例（△）である。UIは △ に注記を出せる（§12.1）。
 */
const SHORTCUTS: ShortcutTable = [
  { action: 'contact-no', keys: 'F5', label: 'a接点', confirmed: true },
  { action: 'contact-nc', keys: 'F6', label: 'b接点', confirmed: false },
  { action: 'or-contact-no', keys: 'Shift+F5', label: 'OR a接点', confirmed: false },
  { action: 'or-contact-nc', keys: 'Shift+F6', label: 'OR b接点', confirmed: false },
  { action: 'coil', keys: 'F7', label: 'コイル', confirmed: true },
  { action: 'application', keys: 'F8', label: '応用命令', confirmed: true },
  { action: 'hline', keys: 'F9', label: '横線', confirmed: false },
  { action: 'vline', keys: 'Shift+F9', label: '縦線', confirmed: false },
  { action: 'convert', keys: 'F4', label: '変換', confirmed: false },
  { action: 'toggle-no-nc', keys: '/', label: 'a接点・b接点の切換', confirmed: true },
  { action: 'toggle-pulse', keys: 'Alt+/', label: '微分・SET/RST の切換', confirmed: true },
  { action: 'write-mode', keys: 'F2', label: '書込みモード', confirmed: true },
  { action: 'read-mode', keys: 'Shift+F2', label: '読出しモード', confirmed: true },
  { action: 'monitor', keys: 'F3', label: 'モニタ', confirmed: true },
  { action: 'monitor-write', keys: 'Shift+F3', label: 'モニタ（書込み）', confirmed: true },
  { action: 'insert-toggle', keys: 'Ins', label: '挿入・上書きの切換', confirmed: true },
  { action: 'next-symbol', keys: 'Tab', label: '次の回路記号', confirmed: true },
  { action: 'help', keys: 'F1', label: 'ヘルプ', confirmed: true },
];

/** 方言エラーの日本語文言。§10.5 の `errorMessages` */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'device-range': 'デバイス番号がこの機種の範囲を超えています',
  'timer-unit': 'このタイマ番号の時間単位では指定できない設定値です',
  'counter-range': 'カウンタ設定値がこの機種の範囲を超えています',
  'special-unsupported': 'この機種に対応する特殊デバイスがありません',
};

/** セルが参照するデバイスを列挙する（設定値の検査もここで行う）。 */
function checkCell(
  networkId: string,
  row: number,
  col: number,
  cell: Cell,
  errors: DialectError[],
): void {
  const devices: Device[] = [];
  if (cell.kind === 'contact' || cell.kind === 'coil' || cell.kind === 'mc' || cell.kind === 'mcr') {
    devices.push(cell.device);
  } else if (cell.kind === 'timer') {
    devices.push(cell.device);
    const preset = timerPreset(cell.presetMs, cell.device);
    if (preset instanceof Error) {
      errors.push({
        code: 'timer-unit',
        message: preset.message,
        device: cell.device,
        networkId,
        row,
        col,
      });
    }
  } else if (cell.kind === 'counter') {
    devices.push(cell.device, cell.resetDevice);
    if (cell.preset < 1 || cell.preset > MAX_K) {
      errors.push({
        code: 'counter-range',
        message: `カウンタ設定値が範囲外です（1〜${MAX_K}）: ${cell.preset}`,
        device: cell.device,
        networkId,
        row,
        col,
      });
    }
  }
  for (const target of devices) {
    if (target.kind === 'special') {
      if (SPECIAL_DEVICES[target.index] === undefined) {
        errors.push({
          code: 'special-unsupported',
          message: `この機種にはない特殊デバイスです: SP${target.index}`,
          device: target,
          networkId,
          row,
          col,
        });
      }
      continue;
    }
    const range = DEVICE_RANGES[target.kind];
    if (target.index < range.min || target.index > range.max) {
      errors.push({
        code: 'device-range',
        message: `${range.prefix} の番号が範囲外です（${range.prefix}${range.min}〜${range.prefix}${range.max.toString(range.radix)}）: ${formatDevice(target)}`,
        device: target,
        networkId,
        row,
        col,
      });
    }
  }
}

/** 方言に依る検査。§10.5 / §10.8 */
function validate(source: LadderProgram): DialectError[] {
  const errors: DialectError[] = [];
  for (const net of source.networks) {
    net.cells.forEach((cells, row) => {
      cells.forEach((cell, col) => {
        if (cell.kind === 'empty') return;
        checkCell(net.id, row, col, cell, errors);
      });
    });
  }
  return errors;
}
```

（`import` に `type Cell` を足す。）

- [ ] **Step 4: `src/convert.ts` を書く**

```ts
import {
  compile,
  type CompileWarning,
  type CompiledProgram,
  type LadderProgram,
} from '@ojt/ladder-core';
import type { DialectProfile } from './profile.js';

/**
 * 「変換」操作。決定事項#15 / §10.6。
 * 構造の検査（`@ojt/ladder-core` の `compile()`）と方言の検査（`DialectProfile.validate()`）を
 * 両方走らせ、結果を1つの一覧にして返す。UIは出力ウィンドウにそのまま並べる。
 */

/** 変換の指摘1件。 */
export interface ConvertError {
  /** 構造（IRの誤り）か方言（機種の制約）か。 */
  source: 'structure' | 'dialect';
  code: string;
  message: string;
  networkId?: string;
  row?: number;
  col?: number;
}

/** 変換結果。 */
export type ConvertResult =
  | { ok: true; program: CompiledProgram; errors: readonly ConvertError[]; warnings: CompileWarning[] }
  | { ok: false; errors: ConvertError[]; warnings: CompileWarning[] };

/**
 * ラダーを変換する。§10.6
 * 構造の検査に落ちても方言の検査は走らせる（出力ウィンドウに一度で全部出すため）。
 */
export function convert(source: LadderProgram, profile: DialectProfile): ConvertResult {
  const compiled = compile(source);
  const errors: ConvertError[] = compiled.ok
    ? []
    : compiled.errors.map((e) => ({
        source: 'structure' as const,
        code: e.code,
        message: e.message,
        ...(e.networkId === '' ? {} : { networkId: e.networkId }),
        ...(e.row === undefined ? {} : { row: e.row }),
        ...(e.col === undefined ? {} : { col: e.col }),
      }));
  for (const issue of profile.validate(source)) {
    errors.push({
      source: 'dialect',
      code: issue.code,
      message: issue.message,
      ...(issue.networkId === undefined ? {} : { networkId: issue.networkId }),
      ...(issue.row === undefined ? {} : { row: issue.row }),
      ...(issue.col === undefined ? {} : { col: issue.col }),
    });
  }
  if (!compiled.ok || errors.length > 0) {
    return { ok: false, errors, warnings: compiled.warnings };
  }
  return { ok: true, program: compiled.program, errors, warnings: compiled.warnings };
}
```

`src/index.ts` に `export { convert, type ConvertError, type ConvertResult } from './convert.js';` を足す。

- [ ] **Step 5: GREEN とカバレッジを確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run
pnpm --filter @ojt/plc-dialects exec vitest run --coverage
```

Expected: `Test Files  5 passed (5)` / `Tests  31 passed (31)`、カバレッジは lines / statements / functions / branches とも90%以上。

- [ ] **Step 6: コミットする**

```powershell
pnpm --filter @ojt/plc-dialects typecheck
npx prettier --check "packages/plc-dialects/**/*.ts"
git add packages/plc-dialects
git commit -m "feat(plc-dialects): validate FX5U programs and add the GX Works3-style skin"
```

---
## Task 11: `schema/ladder.ts` — ラダーIRの zod

**Files:**
- Create: `packages/content/src/schema/ladder.ts`
- Modify: `packages/content/package.json`（`@ojt/ladder-core` を依存に足す）
- Test: `packages/content/test/schema-ladder.test.ts`

課題JSONに模範ラダー（`referenceLadder`）を書けるようにする（§7.6）。定義の唯一の源は zod（§4.5）だが、**型は `@ojt/ladder-core` の `LadderProgram` と一致させる**（別々に持つと必ずずれる）。JSONを書きやすくするため、**行は16列まで書けば足りない列を空セルで詰める**（`network()` と同じ規則）。

| 決めること | 本タスクの実装 |
|---|---|
| 出力型 | `LadderProgramSchema.parse()` の戻り値は `@ojt/ladder-core` の `LadderProgram` そのもの（`rows` / `cols` は transform が埋める） |
| 列の省略 | 1行は1〜16セル。**行の最後が出力セルならコイル列（15列目）へ送り手前を横線で埋める**、そうでなければ空セルで詰める |
| デバイス | `{kind, index}`。`special` は 0〜2 のみ（§10.3） |
| タイマ | `presetMs` は10msの倍数（`TIMER_STEP_MS`）。範囲は `compile()` と同じ |
| 検証の重複 | 構造の検査（END・コイル列・MC対応）は `compile()` が持っているので**スキーマでは繰り返さない**。課題の読込時に `compile()` を呼ぶのは Task 12 の refinement |

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-ladder.test.ts`:

```ts
import { compile, IR_COLS } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { CellSchema, DeviceSchema, LadderProgramSchema } from '../src/schema/ladder.js';

/** 自己保持のJSON（課題ファイルに書く形）。 */
const SELF_HOLD = {
  networks: [
    {
      id: 'n1',
      comment: '自己保持',
      cells: [
        [
          { kind: 'contact', type: 'NO', device: { kind: 'input', index: 0 } },
          { kind: 'vline' },
          { kind: 'contact', type: 'NC', device: { kind: 'input', index: 1 } },
          { kind: 'coil', type: 'OUT', device: { kind: 'output', index: 0 } },
        ],
        [{ kind: 'contact', type: 'NO', device: { kind: 'output', index: 0 } }],
      ],
    },
    { id: 'end', cells: [[{ kind: 'end' }]] },
  ],
};

describe('LadderProgramSchema', () => {
  it('parses a program into the ladder-core shape (§10.3)', () => {
    const parsed = LadderProgramSchema.parse(SELF_HOLD);
    expect(parsed.networks).toHaveLength(2);
    const first = parsed.networks[0];
    expect(first?.rows).toBe(2);
    expect(first?.cols).toBe(IR_COLS);
    expect(first?.comment).toBe('自己保持');
    expect(first?.cells[1]).toHaveLength(IR_COLS);
    expect(first?.cells[1]?.[1]).toEqual({ kind: 'empty' });
  });

  it('sends a trailing output cell to the coil column and fills the gap with hlines', () => {
    const parsed = LadderProgramSchema.parse(SELF_HOLD);
    const row = parsed.networks[0]?.cells[0] ?? [];
    expect(row[3]).toEqual({ kind: 'hline' });
    expect(row[14]).toEqual({ kind: 'hline' });
    expect(row[15]).toEqual({
      kind: 'coil',
      type: 'OUT',
      device: { kind: 'output', index: 0 },
    });
    // 出力セルで終わらない行は空セルで詰める
    expect(parsed.networks[0]?.cells[1]?.[1]).toEqual({ kind: 'empty' });
  });

  it('produces a program that compiles (§10.3 の構造検査はここではしない)', () => {
    const result = compile(LadderProgramSchema.parse(SELF_HOLD));
    expect(result.ok).toBe(true);
  });

  it('leaves the comment out when the JSON omits it (exactOptionalPropertyTypes)', () => {
    const parsed = LadderProgramSchema.parse(SELF_HOLD);
    expect(Object.hasOwn(parsed.networks[1] ?? {}, 'comment')).toBe(false);
  });

  it('rejects a row longer than the IR width and an empty network list', () => {
    const wide = {
      networks: [
        { id: 'n1', cells: [Array.from({ length: IR_COLS + 1 }, () => ({ kind: 'hline' }))] },
      ],
    };
    expect(LadderProgramSchema.safeParse(wide).success).toBe(false);
    expect(LadderProgramSchema.safeParse({ networks: [] }).success).toBe(false);
    expect(LadderProgramSchema.safeParse({ networks: [{ id: 'n1', cells: [] }] }).success).toBe(false);
  });

  it('rejects duplicated network ids', () => {
    const duplicated = {
      networks: [
        { id: 'n1', cells: [[{ kind: 'end' }]] },
        { id: 'n1', cells: [[{ kind: 'end' }]] },
      ],
    };
    expect(LadderProgramSchema.safeParse(duplicated).success).toBe(false);
  });
});

describe('DeviceSchema / CellSchema', () => {
  it('accepts the six device kinds and rejects a negative index', () => {
    expect(DeviceSchema.parse({ kind: 'timer', index: 0 })).toEqual({ kind: 'timer', index: 0 });
    expect(DeviceSchema.safeParse({ kind: 'timer', index: -1 }).success).toBe(false);
    expect(DeviceSchema.safeParse({ kind: 'relay', index: 0 }).success).toBe(false);
  });

  it('allows only SP0〜SP2 for special devices (§10.3)', () => {
    expect(DeviceSchema.safeParse({ kind: 'special', index: 2 }).success).toBe(true);
    expect(DeviceSchema.safeParse({ kind: 'special', index: 3 }).success).toBe(false);
  });

  it('requires the timer preset to be a multiple of the scan period (§10.4)', () => {
    const cell = { kind: 'timer', type: 'TON', device: { kind: 'timer', index: 0 }, presetMs: 3000 };
    expect(CellSchema.safeParse(cell).success).toBe(true);
    expect(CellSchema.safeParse({ ...cell, presetMs: 15 }).success).toBe(false);
    expect(CellSchema.safeParse({ ...cell, presetMs: 0 }).success).toBe(false);
  });

  it('requires a reset device on a counter and a preset of at least 1', () => {
    const cell = {
      kind: 'counter',
      type: 'CTU',
      device: { kind: 'counter', index: 0 },
      preset: 3,
      resetDevice: { kind: 'input', index: 1 },
    };
    expect(CellSchema.safeParse(cell).success).toBe(true);
    expect(CellSchema.safeParse({ ...cell, preset: 0 }).success).toBe(false);
    const { resetDevice: _drop, ...withoutReset } = cell;
    expect(CellSchema.safeParse(withoutReset).success).toBe(false);
  });

  it('rejects unknown keys so typos surface as read errors (§13 #1)', () => {
    expect(CellSchema.safeParse({ kind: 'hline', device: { kind: 'input', index: 0 } }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-ladder.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/schema/ladder.js`。`@ojt/ladder-core` を依存に足していない場合は `Cannot find module '@ojt/ladder-core'` になるので、先に `packages/content/package.json` の `dependencies` に `"@ojt/ladder-core": "workspace:*"` を足して `pnpm install` する。

- [ ] **Step 3: `src/schema/ladder.ts` を書く**

```ts
import {
  COIL_COL,
  IR_COLS,
  MAX_COUNTER_PRESET,
  MAX_ROWS,
  MAX_TIMER_PRESET_MS,
  SPECIAL_INDEXES,
  TIMER_STEP_MS,
  type Cell,
  type LadderProgram,
  type Network,
} from '@ojt/ladder-core';
import { z } from 'zod';

/**
 * ラダーIRの zod スキーマ。設計仕様 §7.6 / §10.3。
 *
 * 型の源は `@ojt/ladder-core`（`Cell` / `Network` / `LadderProgram`）で、ここはその**入力形式**
 * （課題JSONの書き方）だけを決める。JSONを短く書けるように、1行は使う列までを並べれば足りない
 * ぶんを空セルで詰める（`network()` と同じ規則）。
 *
 * 構造の検査（END の有無・コイル列・MC/MCR の対応）は `compile()` が唯一の源なので**ここでは
 * 繰り返さない**。課題読込時に `compile()` を通すのは `schema/plc.ts` の refinement である。
 */

/** デバイス種別。§10.3 */
export const DeviceKindSchema = z.enum([
  'input',
  'output',
  'internal',
  'timer',
  'counter',
  'special',
]);

/** デバイス（種別＋0起点の通し番号）。8進表記は方言の担当なのでここは常に10進の整数。§10.3 */
export const DeviceSchema = z
  .strictObject({
    kind: DeviceKindSchema,
    index: z.int().min(0).max(65_535),
  })
  .refine((d) => d.kind !== 'special' || SPECIAL_INDEXES.includes(d.index), {
    message: `特殊デバイスは ${SPECIAL_INDEXES.join('／')} のみです（常時ON／初期パルス／1秒クロック）`,
    path: ['index'],
  });

/** デバイス。 */
export type DeviceData = z.infer<typeof DeviceSchema>;

/** セル。§10.3 */
export const CellSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('contact'),
    type: z.enum(['NO', 'NC', 'P', 'F']),
    device: DeviceSchema,
  }),
  z.strictObject({
    kind: z.literal('coil'),
    type: z.enum(['OUT', 'SET', 'RST']),
    device: DeviceSchema,
  }),
  z.strictObject({
    kind: z.literal('timer'),
    type: z.literal('TON'),
    device: DeviceSchema,
    presetMs: z
      .int()
      .min(TIMER_STEP_MS)
      .max(MAX_TIMER_PRESET_MS)
      .refine((ms) => ms % TIMER_STEP_MS === 0, {
        message: `タイマ設定値は ${TIMER_STEP_MS}ms の倍数にします`,
      }),
  }),
  z.strictObject({
    kind: z.literal('counter'),
    type: z.literal('CTU'),
    device: DeviceSchema,
    preset: z.int().min(1).max(MAX_COUNTER_PRESET),
    resetDevice: DeviceSchema,
  }),
  z.strictObject({ kind: z.literal('mc'), device: DeviceSchema }),
  z.strictObject({ kind: z.literal('mcr'), device: DeviceSchema }),
  z.strictObject({ kind: z.literal('end') }),
  z.strictObject({ kind: z.literal('hline') }),
  z.strictObject({ kind: z.literal('vline') }),
  z.strictObject({ kind: z.literal('empty') }),
]);

/** セル。 */
export type CellData = z.infer<typeof CellSchema>;

/** 出力位置に置くセル（コイル列に置くもの）。 */
function isOutputCellData(cell: CellData): boolean {
  return ['coil', 'timer', 'counter', 'mc', 'mcr'].includes(cell.kind);
}

/**
 * 1行を16列に詰める。
 * **行の最後が出力セル（コイル・タイマ・カウンタ・MC/MCR）なら、それをコイル列（15列目）へ送り、
 * 手前を横線で埋める。** 実機のラダーでもコイルは必ず右母線に付くので、課題JSONに横線を12個も
 * 並べずに済む。出力セルで終わらない行は、足りないぶんを空セルで詰める。
 */
function padRow(cells: readonly CellData[]): Cell[] {
  const row: Cell[] = [...cells];
  const last = row[row.length - 1];
  if (last !== undefined && isOutputCellData(last) && row.length < IR_COLS) {
    row.pop();
    while (row.length < COIL_COL) row.push({ kind: 'hline' });
    row.push(last);
    return row;
  }
  while (row.length < IR_COLS) row.push({ kind: 'empty' });
  return row;
}

/** ネットワーク。行は1〜`MAX_ROWS`、1行は1〜`IR_COLS` セル。§10.3 */
export const LadderNetworkSchema = z
  .strictObject({
    id: z.string().min(1),
    comment: z.string().optional(),
    cells: z.array(z.array(CellSchema).min(1).max(IR_COLS)).min(1).max(MAX_ROWS),
  })
  .transform(
    (net): Network => ({
      id: net.id,
      ...(net.comment === undefined ? {} : { comment: net.comment }),
      rows: net.cells.length,
      cols: IR_COLS,
      cells: net.cells.map(padRow),
    }),
  );

/** ラダープログラム。§10.3 */
export const LadderProgramSchema = z
  .strictObject({
    networks: z.array(LadderNetworkSchema).min(1).max(64),
  })
  .superRefine((program, ctx) => {
    const seen = new Set<string>();
    program.networks.forEach((net, index) => {
      if (seen.has(net.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['networks', index, 'id'],
          message: `ネットワークIDが重複しています: ${net.id}`,
        });
      }
      seen.add(net.id);
    });
  })
  .transform((program): LadderProgram => ({ networks: [...program.networks] }));

/** コイル列の列番号（課題データの読み手向けに再公開する）。§10.3 */
export const LADDER_COIL_COL = COIL_COL;
```

- [ ] **Step 4: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-ladder.test.ts
pnpm --filter @ojt/content typecheck
git add packages/content pnpm-lock.yaml
git commit -m "feat(content): add the zod schema for the ladder IR"
```

Expected: `Tests  11 passed (11)`。

---

## Task 12: `schema/plc.ts` — モードD課題のスキーマと3つの静的チェックID

**Files:**
- Create: `packages/content/src/schema/plc.ts`
- Modify: `packages/content/src/schema/judge.ts`
- Modify: `packages/content/src/static-checks.ts`（`CHECKS` に仮の3件。Task 16 で本実装に差し替える）
- Test: `packages/content/test/schema-plc.test.ts`
- Test: `packages/content/test/helpers/plc.ts`（モードD課題JSONの骨組み）

§7.6 のフィールド（`plc` / `io` / `referenceLadder` / `wiringRequired`）と、§7.4 の静的チェック3件（`twoStage` / `plcPowerIndependent` / `ioAssignment`）を足す。

| 決めること | 本タスクの実装 |
|---|---|
| `plc` | `{vendor, model}`。`vendor` は4値、`model` は4値（§7.6）。組合せの整合（`mitsubishi` ↔ `FX5U`）も検査する。Phase 3 で**開始できる**のは `FX5U` だけなので、他機種は `PHASE3_MODELS` に無い旨のエラーにする |
| `io` | `{mode, wiring, inputs?, outputs?}`。`inputs` は `{x, pb}`（`pb` は `PB1`〜`PB3` の**3点まで**。`PB4` は §6.3 の既設配線 `P.1 → TB_PB.4c` が塞いでいるチェック用回路の押ボタンなので使えない）、`outputs` は `{y, cr, pl}` の**4点まで**の配列。省略時は既定割付（§7.6 の表。入力3点・出力4点） |
| `referenceLadder` | Task 11 の `LadderProgramSchema`。読込時に `compile()` を通し、変換エラーがあれば課題のスキーマ違反にする（§13 #2 を読込の段で拾う） |
| `wiringRequired` | `true` 固定（決定事項#16） |
| 静的チェック | `STATIC_CHECK_IDS` を9件にし、モードB/C の既定では新3件を `false`、モードDの既定（`PLC_DEFAULT_STATIC_CHECKS`）では9件すべて `true` |
| 級 | モードDは1級・2級のみ（3級の課題1はPLCを使わない）。`grade: 3` はスキーマ違反 |

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/helpers/plc.ts`:

```ts
/** 課題JSONに書くセル（`schema/ladder.ts` の入力形式）。 */
export type CellJson = Record<string, unknown>;

/** a接点。 */
export const noJson = (kind: string, index: number): CellJson => ({
  kind: 'contact',
  type: 'NO',
  device: { kind, index },
});
/** b接点。 */
export const ncJson = (kind: string, index: number): CellJson => ({
  kind: 'contact',
  type: 'NC',
  device: { kind, index },
});
/** OUTコイル。 */
export const outJson = (index: number): CellJson => ({
  kind: 'coil',
  type: 'OUT',
  device: { kind: 'output', index },
});
/**
 * 1行ぶんのセル。コイル列への送りと横線の穴埋めは `LadderProgramSchema` が行うので、
 * ここでは使うセルを並べるだけでよい（§10.3 / Task 11 の詰め方の規則）。
 */
export function rungJson(...cells: CellJson[]): CellJson[] {
  return [...cells];
}

/** X0 が入ると Y0 が出るだけの最小ラダー。 */
export function simpleLadderJson(): Record<string, unknown> {
  return {
    networks: [
      { id: 'n1', cells: [rungJson(noJson('input', 0), outJson(0))] },
      { id: 'end', cells: [[{ kind: 'end' }]] },
    ],
  };
}

/** モードD課題JSONの骨組み（値は上書きして使う）。§7.6 */
export function plcProblemJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'd-test',
    mode: 'plc',
    title: 'テスト用PLC課題',
    grade: 2,
    description: 'X0 で Y0 を出す',
    timeLimit: { standardMin: 50, cutoffMin: 60 },
    board: {
      boardId: 'board-jipm-std',
      socketRoles: { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S7: 'CHK' },
    },
    inventory: [{ kind: 'relay-my4n', count: 4 }],
    plc: { vendor: 'mitsubishi', model: 'FX5U' },
    io: { mode: 'fixed', inputs: [{ x: 0, pb: 'PB1' }], outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }] },
    referenceLadder: simpleLadderJson(),
    wiringRequired: true,
    operations: [
      { t: 0, target: 'PB1', action: 'press' },
      { t: 300, target: 'PB1', action: 'release' },
    ],
    durationMs: 3000,
    judge: { compareSignals: ['PL1'] },
    ...overrides,
  };
}
```

`packages/content/test/schema-plc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_STATIC_CHECKS, STATIC_CHECK_IDS } from '../src/schema/judge.js';
import {
  DEFAULT_PLC_IO,
  PHASE3_MODELS,
  PLC_DEFAULT_STATIC_CHECKS,
  PLC_MODELS,
  PLC_VENDORS,
  PlcInputMapSchema,
  PlcProblemSchema,
  resolvePlcIo,
} from '../src/schema/plc.js';
import { noJson, outJson, plcProblemJson, rungJson } from './helpers/plc.js';

describe('PlcProblemSchema（§7.6）', () => {
  it('parses a mode D problem', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson());
    expect(parsed.mode).toBe('plc');
    expect(parsed.plc).toEqual({ vendor: 'mitsubishi', model: 'FX5U' });
    expect(parsed.wiringRequired).toBe(true);
    expect(parsed.referenceLadder.networks[0]?.cols).toBe(16);
    expect(parsed.io.wiring).toBe('sink');
  });

  it('turns on the three PLC static checks by default (§7.4 の D 列)', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson());
    expect(parsed.judge.staticChecks.twoStage).toBe(true);
    expect(parsed.judge.staticChecks.plcPowerIndependent).toBe(true);
    expect(parsed.judge.staticChecks.ioAssignment).toBe(true);
    expect(parsed.judge.staticChecks.coilPolarity).toBe(true);
    expect(PLC_DEFAULT_STATIC_CHECKS.twoStage).toBe(true);
    // モードB・C の既定では新しい3件は無効のまま（§7.4）
    expect(DEFAULT_STATIC_CHECKS.twoStage).toBe(false);
    expect(DEFAULT_STATIC_CHECKS.plcPowerIndependent).toBe(false);
    expect(DEFAULT_STATIC_CHECKS.ioAssignment).toBe(false);
    expect(STATIC_CHECK_IDS).toHaveLength(9);
  });

  it('knows the four vendors and models of 決定事項#14 and starts only FX5U (§16)', () => {
    expect(PLC_VENDORS).toEqual(['mitsubishi', 'jtekt', 'omron', 'sharp']);
    expect(PLC_MODELS).toEqual(['FX5U', 'PC10G-1SP', 'CP1E', 'JW-300']);
    expect(PHASE3_MODELS).toEqual(['FX5U']);
    const other = plcProblemJson({ plc: { vendor: 'omron', model: 'CP1E' } });
    const parsed = PlcProblemSchema.safeParse(other);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(JSON.stringify(parsed.error.issues)).toContain('Phase 4');
  });

  it('rejects a vendor and model that do not belong together', () => {
    const mismatched = plcProblemJson({ plc: { vendor: 'omron', model: 'FX5U' } });
    expect(PlcProblemSchema.safeParse(mismatched).success).toBe(false);
  });

  it('rejects grade 3 and a false wiringRequired (決定事項#16)', () => {
    expect(PlcProblemSchema.safeParse(plcProblemJson({ grade: 3 })).success).toBe(false);
    expect(PlcProblemSchema.safeParse(plcProblemJson({ wiringRequired: false })).success).toBe(false);
  });

  it('rejects a reference ladder that does not convert (§13 #2 を読込で拾う)', () => {
    // END のネットワークを外すと `compile()` が `missing-end` を返す
    const noEnd = {
      networks: [{ id: 'n1', cells: [rungJson(noJson('input', 0), outJson(0))] }],
    };
    const broken = plcProblemJson({ referenceLadder: noEnd });
    const parsed = PlcProblemSchema.safeParse(broken);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(JSON.stringify(parsed.error.issues)).toContain('END');
  });

  it('rejects duplicated assignments in the I/O map', () => {
    const duplicated = plcProblemJson({
      io: {
        mode: 'fixed',
        inputs: [
          { x: 0, pb: 'PB1' },
          { x: 1, pb: 'PB1' },
        ],
        outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
      },
    });
    expect(PlcProblemSchema.safeParse(duplicated).success).toBe(false);

    const sameRelay = plcProblemJson({
      io: {
        mode: 'fixed',
        inputs: [{ x: 0, pb: 'PB1' }],
        outputs: [
          { y: 0, cr: 'CR1', pl: 'PL1' },
          { y: 1, cr: 'CR1', pl: 'PL2' },
        ],
      },
    });
    expect(PlcProblemSchema.safeParse(sameRelay).success).toBe(false);
  });

  it('refuses PB4 because the check circuit already occupies TB_PB.4c (§6.3)', () => {
    const withPb4 = plcProblemJson({
      io: {
        mode: 'fixed',
        inputs: [
          { x: 0, pb: 'PB1' },
          { x: 3, pb: 'PB4' },
        ],
        outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
      },
    });
    expect(PlcProblemSchema.safeParse(withPb4).success).toBe(false);
    // 入力は3点までしか無い（PB1〜PB3）
    expect(PlcInputMapSchema.shape.pb.options).toEqual(['PB1', 'PB2', 'PB3']);
  });
});

describe('resolvePlcIo（§7.6 の既定割付）', () => {
  it('falls back to the default assignment when the problem omits the map', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson({ io: { mode: 'free' } }));
    const io = resolvePlcIo(parsed.io);
    expect(io.wiring).toBe('sink');
    expect(io.inputs).toEqual(DEFAULT_PLC_IO.inputs);
    expect(io.outputs).toEqual(DEFAULT_PLC_IO.outputs);
    // 入力3点（PB4はチェック用）・出力4点が既定。1級形式もこの形である
    expect(DEFAULT_PLC_IO.inputs).toHaveLength(3);
    expect(DEFAULT_PLC_IO.inputs[0]).toEqual({ x: 0, pb: 'PB1' });
    expect(DEFAULT_PLC_IO.outputs).toHaveLength(4);
    expect(DEFAULT_PLC_IO.outputs[3]).toEqual({ y: 3, cr: 'CR4', pl: 'PL4' });
  });

  it('keeps the problem assignment when it gives one', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson());
    const io = resolvePlcIo(parsed.io);
    expect(io.inputs).toHaveLength(1);
    expect(io.outputs).toEqual([{ y: 0, cr: 'CR1', pl: 'PL1' }]);
  });

  it('accepts source wiring as well (§10.2)', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson({ io: { mode: 'free', wiring: 'source' } }));
    expect(resolvePlcIo(parsed.io).wiring).toBe('source');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-plc.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/schema/plc.js`。

- [ ] **Step 3: `src/schema/judge.ts` に3つのIDを足す**

```ts
/** 静的チェックのID。§7.4（PLC用の3件は Phase 3 で追加） */
export const STATIC_CHECK_IDS = [
  'wireColorRule',
  'terminalLimit',
  'unusedParts',
  'forbiddenCircuit',
  'coilPolarity',
  'powerSequence',
  'twoStage',
  'plcPowerIndependent',
  'ioAssignment',
] as const;
```

`StaticChecksSchema` に3件を足す（既定は `false`。モードB・C では無効。§7.4 の表）:

```ts
export const StaticChecksSchema = z.strictObject({
  wireColorRule: z.boolean().default(true),
  terminalLimit: z.boolean().default(true),
  unusedParts: z.boolean().default(true),
  forbiddenCircuit: z.boolean().default(true),
  coilPolarity: z.boolean().default(true),
  powerSequence: z.boolean().default(true),
  twoStage: z.boolean().default(false),
  plcPowerIndependent: z.boolean().default(false),
  ioAssignment: z.boolean().default(false),
});

/** モードB・C の既定（PLC用の3件は無効）。§7.4 */
export const DEFAULT_STATIC_CHECKS: StaticChecksData = {
  wireColorRule: true,
  terminalLimit: true,
  unusedParts: true,
  forbiddenCircuit: true,
  coilPolarity: true,
  powerSequence: true,
  twoStage: false,
  plcPowerIndependent: false,
  ioAssignment: false,
};

/** モードD の既定（9件すべて有効）。§7.4 の D 列 */
export const PLC_DEFAULT_STATIC_CHECKS: StaticChecksData = {
  ...DEFAULT_STATIC_CHECKS,
  twoStage: true,
  plcPowerIndependent: true,
  ioAssignment: true,
};
```

`JudgeSettingsSchema` を「既定を差し替えられる形」に分けて、モードD用を作れるようにする:

```ts
/** 判定設定のスキーマを、静的チェックの既定を差し替えて作る。§7.4 */
function judgeSettings(staticDefaults: StaticChecksData) {
  return z.strictObject({
    compareSignals: z.array(z.string().min(1)).min(1).optional(),
    tolerance: ToleranceSchema.default({
      edgeMs: DEFAULT_TOLERANCE.edgeMs,
      ratio: DEFAULT_TOLERANCE.ratio,
    }),
    staticChecks: StaticChecksSchema.default(staticDefaults),
  });
}

/** 判定設定（モードB・C）。§7.4 */
export const JudgeSettingsSchema = judgeSettings(DEFAULT_STATIC_CHECKS);

/** 判定設定（モードD）。§7.4 の D 列 */
export const PlcJudgeSettingsSchema = judgeSettings(PLC_DEFAULT_STATIC_CHECKS);
```

**既存テストの追随（このタスクで直す）:** `packages/content/test/index.test.ts` の `STATIC_CHECK_IDS` の期待値（6件の配列リテラル）に3件を足す。`DEFAULT_STATIC_CHECKS` と突き合わせている行は両方が同時に変わるのでそのままでよい。

- [ ] **Step 4: `src/static-checks.ts` に仮の3件を足す（`tsc` を通すため）**

`STATIC_CHECK_IDS` が9件になった瞬間、`src/static-checks.ts` の既存の `CHECKS`（型は `Readonly<Record<StaticCheckId, (input: StaticCheckInput) => StaticCheckResult>>`）がキー不足で `tsc` に落ちる（`Property 'twoStage' is missing in type …`）。本実装は Task 16 なので、ここでは**「モードDの文脈が無い」ことを返す仮の3件**を置いて型を満たす。Task 16 Step 4 でこの3件を本物の関数にそのまま差し替える。

`src/static-checks.ts` の `CHECKS` の直前に足す:

```ts
/**
 * モードDの静的チェックの仮実装。本実装は Task 16 の `plc-static-checks.ts` で入れる。
 * それまでは「モードDの文脈が無いので実行できない」を返し、`STATIC_CHECK_IDS` の9件を型として満たす。
 */
function plcCheckNotReady(id: StaticCheckId): StaticCheckResult {
  return {
    id,
    ok: false,
    message: 'PLC課題ではないためこの検査は実行できません',
    details: ['この静的チェックはモードDの課題でのみ有効にできます（§7.4）'],
  };
}
```

`CHECKS` を9件にする:

```ts
const CHECKS: Readonly<Record<StaticCheckId, (input: StaticCheckInput) => StaticCheckResult>> = {
  wireColorRule: checkWireColorRule,
  terminalLimit: checkTerminalLimit,
  unusedParts: checkUnusedParts,
  forbiddenCircuit: checkForbiddenCircuit,
  coilPolarity: checkCoilPolarity,
  powerSequence: checkPowerSequence,
  // Task 16 で本実装（`checkTwoStage` / `checkPlcPowerIndependent` / `checkIoAssignment`）に差し替える
  twoStage: () => plcCheckNotReady('twoStage'),
  plcPowerIndependent: () => plcCheckNotReady('plcPowerIndependent'),
  ioAssignment: () => plcCheckNotReady('ioAssignment'),
};
```

`DEFAULT_STATIC_CHECKS`（`src/schema/judge.ts`）の3キーは Step 3 で既に足してある。モードB・C の既定では3件とも `false` なので、`runStaticChecks` がこの仮実装を呼ぶことは無い。

- [ ] **Step 5: `src/schema/plc.ts` を書く**

```ts
import { compile } from '@ojt/ladder-core';
import { TICK_MS } from '@ojt/circuit-sim';
import { z } from 'zod';
import { ProblemHeaderShape } from './common.js';
import { PlcJudgeSettingsSchema } from './judge.js';
import { LadderProgramSchema } from './ladder.js';
import { DurationMsSchema, lastOperationMs, OperationListSchema } from './operations.js';

/**
 * モードD（PLC）の課題本体。設計仕様 §7.6 / §10.2 / §10.8。
 *
 * 模範回路は展開接続図ではなく**I/O割付**で表す（PLC端子は §11.1 の回路図の語彙に無い）。
 * 模範配線は `plc-reference.ts` が割付から生成する（決定表#10）。
 */

/** PLCメーカー。決定事項#14 */
export const PLC_VENDORS = ['mitsubishi', 'jtekt', 'omron', 'sharp'] as const;
/** PLC機種。§7.6 */
export const PLC_MODELS = ['FX5U', 'PC10G-1SP', 'CP1E', 'JW-300'] as const;
/** Phase 3 で開始できる機種。§16 */
export const PHASE3_MODELS = ['FX5U'] as const;

/** メーカー → 機種（§7.6 の対応）。 */
const MODEL_OF_VENDOR: Readonly<Record<(typeof PLC_VENDORS)[number], (typeof PLC_MODELS)[number]>> =
  {
    mitsubishi: 'FX5U',
    jtekt: 'PC10G-1SP',
    omron: 'CP1E',
    sharp: 'JW-300',
  };

/** 使用するPLC。§7.6 */
export const PlcRefSchema = z
  .strictObject({
    vendor: z.enum(PLC_VENDORS).describe('PLCメーカー。'),
    model: z.enum(PLC_MODELS).describe('PLC機種。Phase 3 で開始できるのは FX5U のみです。'),
  })
  .superRefine((plc, ctx) => {
    if (MODEL_OF_VENDOR[plc.vendor] !== plc.model) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: `${plc.vendor} の機種は ${MODEL_OF_VENDOR[plc.vendor]} です`,
      });
    }
    if (!(PHASE3_MODELS as readonly string[]).includes(plc.model)) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: `この機種はまだ開始できません（Phase 4 で追加します）: ${plc.model}`,
      });
    }
  });

/** I/O割付の指定方法。§7.6 */
export const PlcIoModeSchema = z.enum(['fixed', 'free']);
/** 入力コモンの結線。§10.2 */
export const PlcWiringSchema = z.enum(['sink', 'source']);

/**
 * 入力1点の割付（`x` は入力番号、`pb` は押ボタン）。§7.6
 *
 * `PB4` は**チェック用回路の押ボタン**である。盤には §6.3 の既設固定配線
 * `fw-chk-1: P.1 → TB_PB.4c` があり、`TB_PB.4c` は既に1本埋まっている。ここへ模範配線の
 * N側（または `source` ならP側）の鎖を通すと端子が2本を超えるか、P と N を短絡してしまうため、
 * PLC入力に使えるのは `PB1` / `PB2` / `PB3` の3点だけである（1級形式でも入力3点・出力4点）。
 */
export const PlcInputMapSchema = z.strictObject({
  x: z.int().min(0).max(15),
  pb: z.enum(['PB1', 'PB2', 'PB3']),
});

/** 出力1点の割付（`y` は出力番号、`cr` は中継リレー、`pl` は表示灯）。§7.6 / §10.2 */
export const PlcOutputMapSchema = z.strictObject({
  y: z.int().min(0).max(15),
  cr: z.enum(['CR1', 'CR2', 'CR3', 'CR4']),
  pl: z.enum(['PL1', 'PL2', 'PL3', 'PL4']),
});

/** 入力割付。 */
export type PlcInputMapData = z.infer<typeof PlcInputMapSchema>;
/** 出力割付。 */
export type PlcOutputMapData = z.infer<typeof PlcOutputMapSchema>;

/** 既定のI/O割付（§7.6 の表。本アプリの既定）。 */
export const DEFAULT_PLC_IO: {
  inputs: readonly PlcInputMapData[];
  outputs: readonly PlcOutputMapData[];
} = {
  // PB4 はチェック用回路の押ボタンなので入力に使わない（`PlcInputMapSchema` の注記）
  inputs: [
    { x: 0, pb: 'PB1' },
    { x: 1, pb: 'PB2' },
    { x: 2, pb: 'PB3' },
  ],
  outputs: [
    { y: 0, cr: 'CR1', pl: 'PL1' },
    { y: 1, cr: 'CR2', pl: 'PL2' },
    { y: 2, cr: 'CR3', pl: 'PL3' },
    { y: 3, cr: 'CR4', pl: 'PL4' },
  ],
};

/** 重複した割当を指摘する。 */
function checkDuplicates(values: readonly (string | number)[], path: string, ctx: z.RefinementCtx) {
  const seen = new Set<string | number>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({ code: 'custom', path: [path, index], message: `割当が重複しています: ${value}` });
    }
    seen.add(value);
  });
}

/** I/O割付。§7.6 */
export const PlcIoSchema = z
  .strictObject({
    mode: PlcIoModeSchema.describe('`fixed` は割付を課題が固定し静的チェックで検証します。'),
    wiring: PlcWiringSchema.default('sink').describe('入力コモンの結線（シンク／ソース）。'),
    inputs: z.array(PlcInputMapSchema).min(1).max(3).optional(),
    outputs: z.array(PlcOutputMapSchema).min(1).max(4).optional(),
  })
  .superRefine((io, ctx) => {
    checkDuplicates((io.inputs ?? []).map((i) => i.x), 'inputs', ctx);
    checkDuplicates((io.inputs ?? []).map((i) => i.pb), 'inputs', ctx);
    checkDuplicates((io.outputs ?? []).map((o) => o.y), 'outputs', ctx);
    checkDuplicates((io.outputs ?? []).map((o) => o.cr), 'outputs', ctx);
    checkDuplicates((io.outputs ?? []).map((o) => o.pl), 'outputs', ctx);
  });

/** I/O割付。 */
export type PlcIoData = z.infer<typeof PlcIoSchema>;

/** 解決済みのI/O割付（省略されたら §7.6 の既定割付を使う）。 */
export interface ResolvedPlcIo {
  mode: z.infer<typeof PlcIoModeSchema>;
  wiring: z.infer<typeof PlcWiringSchema>;
  inputs: readonly PlcInputMapData[];
  outputs: readonly PlcOutputMapData[];
}

/** 課題のI/O割付を解決する。§7.6 */
export function resolvePlcIo(io: PlcIoData): ResolvedPlcIo {
  return {
    mode: io.mode,
    wiring: io.wiring,
    inputs: io.inputs ?? DEFAULT_PLC_IO.inputs,
    outputs: io.outputs ?? DEFAULT_PLC_IO.outputs,
  };
}

/** モードD課題。§7.6 */
export const PlcProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('plc').describe('課題モード。PLCは `plc`。'),
    plc: PlcRefSchema.describe('使用するPLCのメーカーと機種。'),
    io: PlcIoSchema.describe('I/O割付（`fixed` なら静的チェックで検証します）。'),
    referenceLadder: LadderProgramSchema.describe('模範ラダー（IR）。'),
    wiringRequired: z
      .literal(true)
      .describe('盤とPLCの実配線を必須にします（決定事項#16。常に true）。'),
    operations: OperationListSchema.describe('判定で再生する押ボタン操作列。'),
    durationMs: DurationMsSchema.describe('判定区間の長さ[ms]。'),
    judge: PlcJudgeSettingsSchema.describe('比較する信号・許容差・静的チェックの設定。'),
  })
  .superRefine((problem, ctx) => {
    if (problem.grade === 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['grade'],
        message: 'PLC課題は1級・2級のみです（3級の課題1はPLCを使いません）',
      });
    }
    const last = lastOperationMs(problem.operations);
    if (problem.durationMs < last + TICK_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: `判定区間長（${problem.durationMs}ms）は最後の操作（${last}ms）より少なくとも1tick（${TICK_MS}ms）長くする必要があります`,
      });
    }
    const compiled = compile(problem.referenceLadder);
    if (!compiled.ok) {
      for (const error of compiled.errors) {
        ctx.addIssue({
          code: 'custom',
          path: ['referenceLadder'],
          message: `模範ラダーを変換できません（${error.code}）: ${error.message}`,
        });
      }
    }
  });

/** モードD課題。 */
export type PlcProblem = z.infer<typeof PlcProblemSchema>;
```

- [ ] **Step 6: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-plc.test.ts test/index.test.ts test/schema-judge.test.ts
pnpm --filter @ojt/content typecheck
pnpm exec prettier --write packages/content/src/schema/plc.ts packages/content/src/schema/judge.ts packages/content/src/static-checks.ts packages/content/test/schema-plc.test.ts packages/content/test/helpers/plc.ts
pnpm exec prettier --check packages/content
git add packages/content
git commit -m "feat(content): add the mode D problem schema and the three PLC static check ids"
```

Expected: `Tests  11 passed (11)`（`schema-plc.test.ts`）に加え、`index.test.ts` / `schema-judge.test.ts` も通り、`typecheck` が無エラー（Step 4 の仮実装が無いとここで `CHECKS` のキー不足で落ちる）。

---

## Task 13: 判別共用体にモードDを足し「開始できないモード」を無くす

**Files:**
- Modify: `packages/content/src/schema/index.ts`
- Modify: `packages/content/src/schema/common.ts`
- Modify: `packages/content/src/index.ts`
- Modify: `packages/content/schema/task.schema.json`（再生成）
- Modify: `packages/content/test/index.test.ts` / `test/schema-common.test.ts` / `test/schema-index.test.ts` / `test/loader.test.ts`
- Modify: `apps/desktop/test/content-loader.test.ts`（**このファイルのみ。UI は Plan 3B**）

Phase 3 で4モードすべてが開始できるようになる（§16）。`UNSUPPORTED_MODES` を空にし、`UnsupportedProblemSchema` と `reason: 'unsupported-mode'` の分岐を落とす（決定表#13）。

- [ ] **Step 1: 失敗するテストを書く（既存テストの更新）**

```powershell
git grep -n "unsupported-mode\|UNSUPPORTED_MODES\|UnsupportedProblem"
```

出てくるのは次の5ファイルである。上から順に直す。

1. `packages/content/test/schema-common.test.ts`: `expect(UNSUPPORTED_MODES).toEqual(['plc'])` → `toEqual([])`。
2. `packages/content/test/index.test.ts`: 同じ行を `toEqual([])` に、`UnsupportedProblemSchema` の import と使用（バレルの網羅テスト）を削除し、代わりに `isPlcProblem` と `PlcProblemSchema` がバレルから引けることを確かめる。
3. `packages/content/test/schema-index.test.ts`: `unsupported-mode` を期待している3件を、**モードD課題が読める**ことと、**壊れたモードD課題が `reason: 'schema'` になる**ことの検証に置き換える。
4. `packages/content/test/loader.test.ts`: `'unsupported-mode'` を期待している行を、そのJSONがヘッダだけのPLC課題である以上 `'schema'`（`plc` / `referenceLadder` などが無い）になるよう直す。
5. `apps/desktop/test/content-loader.test.ts`: 「まだ開始できないモード」の describe を、**ヘッダだけのPLC課題は `reason: 'schema'` の読込エラーになる**という検証に書き換える（`payload.errors[0]?.reason` を `'schema'`、`message` を `'課題の形式が正しくありません'` に）。**このファイル以外の `apps/desktop` は触らない。**

加えて `packages/content/test/schema-index.test.ts` に次を足す:

```ts
import { plcProblemJson } from './helpers/plc.js';

describe('モードD課題の判別（§7.6 / §16）', () => {
  it('parses a mode D problem and marks it as plc', () => {
    const parsed = parseProblem(plcProblemJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.problem.mode).toBe('plc');
    expect(isPlcProblem(parsed.problem)).toBe(true);
    expect(isAssembleProblem(parsed.problem)).toBe(false);
  });

  it('reports a header-only PLC problem as a schema error, not as an unsupported mode', () => {
    const { plc: _plc, io: _io, referenceLadder: _ladder, ...headerOnly } = plcProblemJson();
    const parsed = parseProblem(headerOnly);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe('schema');
    expect(parsed.mode).toBe('plc');
    expect(parsed.issues.map((i) => i.path)).toContain('plc');
  });

  it('has no unsupported mode left (§16 Phase 3)', () => {
    expect(UNSUPPORTED_MODES).toEqual([]);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-index.test.ts
```

Expected: 失敗（`isPlcProblem` が無い／`UNSUPPORTED_MODES` が `['plc']` のまま）。

- [ ] **Step 3: `src/schema/common.ts` と `src/schema/index.ts` を直す**

`common.ts`:

```ts
/**
 * まだ本体スキーマを定義していないモード。§13 #1
 * Phase 3 で `plc` を実装したので**空**である（4モードすべてが開始できる。§16）。
 * 空のままにしてあるのは、将来モードを増やしたときに同じ仕組みで段階公開できるようにするため。
 */
export const UNSUPPORTED_MODES = [] as const satisfies readonly ProblemMode[];
```

`schema/index.ts`:

- `UnsupportedProblemSchema` と `UnsupportedProblem` 型、`isUnsupportedMode()`、`parseProblem()` の `unsupported-mode` 分岐を削除する。
- `ProblemSchema` の共用体を `[AssembleProblemSchema, InspectPartsProblemSchema, InspectRepairProblemSchema, PlcProblemSchema]` にする。
- `SupportedProblem` に `PlcProblem` を足し、`isPlcProblem()` を足す。
- `parseProblem()` のモード分岐に `plc` を足す:

```ts
  const parsed =
    mode === 'inspect-parts'
      ? InspectPartsProblemSchema.safeParse(json)
      : mode === 'inspect-repair'
        ? InspectRepairProblemSchema.safeParse(json)
        : mode === 'plc'
          ? PlcProblemSchema.safeParse(json)
          : AssembleProblemSchema.safeParse(json);
```

- `ProblemFailureReason` から `'unsupported-mode'` は**消さない**（Plan 2B の UI が分岐に使っている型なので、値が発行されなくなるだけ）。コメントで「Phase 3 以降は発行されない」と明記する。

`src/index.ts`（バレル）から `UnsupportedProblemSchema` / `type UnsupportedProblem` を外し、`isPlcProblem` と `schema/plc.js` / `schema/ladder.js` の公開名を足す（公開APIの一覧は Task 20 で確定する）。

- [ ] **Step 4: JSON Schema を再生成する**

```powershell
pnpm --filter @ojt/content schema:write
git diff --stat packages/content/schema/task.schema.json
```

Expected: `oneOf` が4分岐（assemble / inspect-parts / inspect-repair / plc）になり、`plc` 分岐に `referenceLadder` が入る。生成物はコミットに含める。

- [ ] **Step 5: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run
pnpm --filter desktop exec vitest run test/content-loader.test.ts
git add packages/content apps/desktop/test/content-loader.test.ts
git commit --only -m "feat(content): accept mode D problems and retire the unsupported mode path" -- packages/content apps/desktop/test/content-loader.test.ts
```

Expected: `@ojt/content` は着手時のベースライン（前提#14。目安442件）＋新規ぶんが通り、desktop の `content-loader.test.ts` も通る。**`apps/desktop` の他のファイルをコミットに含めないこと**（Plan 2B が並行作業中。前提#2）。

---
## Task 14: `plc-reference.ts` — 既定I/O割付から模範配線を組む

**Files:**
- Create: `packages/content/src/plc-reference.ts`
- Test: `packages/content/test/plc-reference.test.ts`

§10.2 の配線ルールと §11.3 の渡り配線で、**I/O割付から模範の盤セッションを生成する**（決定表#10・#11）。モードDの模範回路はこれと模範ラダーの組で表される。

生成する配線（`io.wiring: 'sink'` の場合）:

| 区分 | 電線 |
|---|---|
| 入力 | `TB_PB.{n}a → PLC.X{x}`（割付の数だけ） |
| 出力 | `PLC.Y{y} → {cr}.14`（割付の数だけ） |
| 2段目 | `{cr}.5 → TB_PL.{n}+`（割付の数だけ） |
| P側の渡り配線 | `P.1 → PLC.SS → PLC.COM{g} → {cr1}.9 → {cr2}.9 → …` |
| N側の渡り配線 | `N.1 → TB_PB.{n}c（各入力）→ {cr}.13（各出力）→ TB_PL.{n}-（各出力）` |
| PLC電源 | `OUTLET.L → PLC.L`、`OUTLET.N → PLC.N` |

`source` 結線では `PLC.SS` がN側の鎖に、押ボタンのコモン（`TB_PB.{n}c`）がP側の鎖に移る（§10.2）。どちらの結線でも**入力側の端子が鎖の先頭**（シンクは `P.1 → PLC.SS`、ソースは `P.1 → TB_PB.1c`）に来るように並べる。どの端子も**2本以内**に収まる（`P.1` / `N.1` はチェック用回路の既設配線で各1本埋まっているので、鎖の起点として1本だけ使う。§6.3）。

**PB4 は使えない:** §6.3 の既設配線 `fw-chk-1: P.1 → TB_PB.4c` が `TB_PB.4c` を1本埋めているため、そこへ母線の鎖を通すと本数上限を超えるか P と N を短絡する。PLC入力に使えるのは `PB1` / `PB2` / `PB3` の3点だけで、`PlcInputMapSchema`（Task 12）と `plcWiringPlanIssues()`（本タスク）の二重で弾く。1級形式も**入力3点・出力4点**である。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/plc-reference.test.ts`:

```ts
import { JIPM_BOARD, wireCountAtTerminal } from '@ojt/board-model';
import { MAX_WIRES_PER_TERMINAL } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  buildPlcReferenceSession,
  plcBoardFor,
  plcWiringPlan,
  plcWiringPlanIssues,
  PLC_WIRE_COLOR,
} from '../src/plc-reference.js';
import {
  PlcProblemSchema,
  resolvePlcIo,
  type PlcInputMapData,
  type ResolvedPlcIo,
} from '../src/schema/plc.js';
import { plcProblemJson } from './helpers/plc.js';

/** 2級形式（入力3・出力3）の課題。 */
function grade2Json(): Record<string, unknown> {
  return plcProblemJson({
    io: {
      mode: 'fixed',
      inputs: [
        { x: 0, pb: 'PB1' },
        { x: 1, pb: 'PB2' },
        { x: 2, pb: 'PB3' },
      ],
      outputs: [
        { y: 0, cr: 'CR1', pl: 'PL1' },
        { y: 1, cr: 'CR2', pl: 'PL2' },
        { y: 2, cr: 'CR3', pl: 'PL3' },
      ],
    },
    judge: { compareSignals: ['PL1', 'PL2', 'PL3'] },
  });
}

describe('plcWiringPlan（§10.2 / §11.3）', () => {
  const problem = PlcProblemSchema.parse(grade2Json());
  const board = plcBoardFor(problem, JIPM_BOARD);
  const io = resolvePlcIo(problem.io);

  it('wires the push buttons to X, the Y outputs to the relay coils and the contacts to the lamps', () => {
    const plan = plcWiringPlan(io, board?.plcUnit);
    const pairs = plan.map((w) => `${w.from}→${w.to}`);
    expect(pairs).toContain('TB_PB.1a→PLC.X0');
    expect(pairs).toContain('TB_PB.3a→PLC.X2');
    expect(pairs).toContain('PLC.Y0→CR1.14');
    expect(pairs).toContain('PLC.Y2→CR3.14');
    expect(pairs).toContain('CR1.5→TB_PL.1+');
    expect(pairs).toContain('OUTLET.L→PLC.L');
    expect(pairs).toContain('OUTLET.N→PLC.N');
  });

  it('daisy-chains the P and N rails so no terminal takes a third wire (§6.3 / §11.3)', () => {
    const plan = plcWiringPlan(io, board?.plcUnit);
    const pairs = plan.map((w) => `${w.from}→${w.to}`);
    expect(pairs).toContain('P.1→PLC.SS');
    expect(pairs).toContain('PLC.SS→PLC.COM0');
    expect(pairs).toContain('PLC.COM0→CR1.9');
    expect(pairs).toContain('CR1.9→CR2.9');
    expect(pairs).toContain('N.1→TB_PB.1c');
    expect(pairs).toContain('TB_PB.3c→CR1.13');
    expect(pairs).toContain('CR3.13→TB_PL.1-');
    expect(pairs).toContain('TB_PL.2-→TB_PL.3-');
    expect(plan).toHaveLength(25);
  });

  it('moves S/S to the N rail and the button commons to the P rail for source wiring (§10.2)', () => {
    const sourceIo = { ...io, wiring: 'source' as const };
    const pairs = plcWiringPlan(sourceIo, board?.plcUnit).map((w) => `${w.from}→${w.to}`);
    expect(pairs).toContain('N.1→PLC.SS');
    // ソースでは押ボタンのコモンが P側の鎖の先頭に来る（シンクの `P.1→PLC.SS` と対称）
    expect(pairs).toContain('P.1→TB_PB.1c');
    expect(pairs).not.toContain('P.1→PLC.SS');
    // 本数は結線の向きを変えても同じ
    expect(plcWiringPlan(sourceIo, board?.plcUnit)).toHaveLength(25);
  });

  it('refuses a push button whose common already carries a locked wire (§6.3)', () => {
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めませんでした');
    // `PlcInputMapSchema` は PB4 を受け付けないので、見張りの動作確認はキャストで直に渡す
    const withPb4: ResolvedPlcIo = {
      ...io,
      inputs: [{ x: 3, pb: 'PB4' as PlcInputMapData['pb'] }],
    };
    const issues = plcWiringPlanIssues(withPb4, built.value.session);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('io.inputs[0].pb');
    expect(issues[0]?.message).toContain('TB_PB.4c');
    // 既定の PB1〜PB3 では何も出ない
    expect(plcWiringPlanIssues(io, built.value.session)).toEqual([]);
  });
});

describe('buildPlcReferenceSession（§7.2 / §10.2）', () => {
  it('mounts one relay per output and wires the whole reference circuit in blue (§10.2 線色)', () => {
    const problem = PlcProblemSchema.parse(grade2Json());
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { session, netlist, unit, program } = built.value;
    expect(unit.model).toBe('FX5U');
    expect(Object.keys(session.mounted)).toEqual(['S1', 'S2', 'S3']);
    expect(session.wires.filter((w) => !w.locked)).toHaveLength(25);
    expect(session.wires.every((w) => w.color === PLC_WIRE_COLOR)).toBe(true);
    expect(netlist.parts.some((p) => p.id === 'PLC')).toBe(true);
    expect(program.networks.length).toBeGreaterThan(0);
  });

  it('never puts a third wire on a terminal (§6.6)', () => {
    const problem = PlcProblemSchema.parse(grade2Json());
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めませんでした');
    const seen = new Set<string>();
    for (const wire of built.value.session.wires) {
      for (const terminal of [wire.from, wire.to]) {
        if (seen.has(terminal)) continue;
        seen.add(terminal);
        expect(wireCountAtTerminal(built.value.session, terminal)).toBeLessThanOrEqual(
          MAX_WIRES_PER_TERMINAL,
        );
      }
    }
  });

  it('builds the 1級 form with four outputs as well (§7.6)', () => {
    const problem = PlcProblemSchema.parse(
      plcProblemJson({
        grade: 1,
        io: { mode: 'free' },
        judge: { compareSignals: ['PL1', 'PL2', 'PL3', 'PL4'] },
      }),
    );
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.value.session.mounted)).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('reports a problem error when the board does not match the problem (§13 #2)', () => {
    const problem = PlcProblemSchema.parse(
      plcProblemJson({ board: { boardId: 'other', socketRoles: { S7: 'CHK' } } }),
    );
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('board.boardId');
  });

  it('reports a problem error when a mapped relay has no socket role (§13 #2)', () => {
    const problem = PlcProblemSchema.parse(
      plcProblemJson({
        board: { boardId: 'board-jipm-std', socketRoles: { S1: 'CR1', S7: 'CHK' } },
        io: { mode: 'fixed', inputs: [{ x: 0, pb: 'PB1' }], outputs: [{ y: 1, cr: 'CR2', pl: 'PL2' }] },
      }),
    );
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toContain('io.outputs');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/plc-reference.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/plc-reference.js`。

- [ ] **Step 3: `src/plc-reference.ts` を書く**

```ts
import {
  addWire,
  createSession,
  N_RAIL_ID,
  P_RAIL_ID,
  PB_BLOCK_ID,
  PL_BLOCK_ID,
  plcUnitFor,
  plug,
  toNetlist,
  trySocketOf,
  withPlcUnit,
  type BoardDefinition,
  type BoardSession,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { terminalId, type Netlist, type TerminalId, type WireColor } from '@ojt/circuit-sim';
import { compile, type CompiledProgram } from '@ojt/ladder-core';
import { toSocketRoles } from './schema/common.js';
import type { ProblemIssue } from './schema/index.js';
import { resolvePlcIo, type PlcProblem, type ResolvedPlcIo } from './schema/plc.js';

/**
 * モードDの模範回路。設計仕様 §7.2 / §10.2 / §11.3 / 決定表#10。
 *
 * PLC端子は展開接続図（§11.1）の語彙に無いので、モードDの模範回路は回路図ではなく
 * **I/O割付から生成する**。生成規則は §10.2 の配線ルールそのままで、母線は §11.3 の
 * 渡り配線（鎖状）で分配する（`P.1` / `N.1` はチェック用回路の既設配線で各1本埋まっている。§6.3）。
 */

/** モードDの新規配線に使う線色（青）。§10.2 */
export const PLC_WIRE_COLOR: WireColor = '青';

/** 生成する電線1本。 */
export interface PlcWireSpec {
  from: TerminalId;
  to: TerminalId;
}

/** 模範回路（盤セッション＋ネットリスト＋変換済みラダー）。 */
export interface PlcReferenceCircuit {
  session: BoardSession;
  netlist: Netlist;
  /** PLC本体を載せた派生盤（判定でもこれを使う）。 */
  board: BoardDefinition;
  unit: PlcUnitDefinition;
  io: ResolvedPlcIo;
  program: CompiledProgram;
}

/** 模範回路の構築結果。§13 #2 */
export type PlcReferenceResult =
  | { ok: true; value: PlcReferenceCircuit }
  | { ok: false; errors: ProblemIssue[] };

/** 課題の機種に対応するPLC本体を載せた盤。未対応の機種は undefined。§10.1 */
export function plcBoardFor(
  problem: PlcProblem,
  board: BoardDefinition,
): BoardDefinition | undefined {
  const unit = plcUnitFor(problem.plc.model);
  return unit === undefined ? undefined : withPlcUnit(board, unit);
}

/** 押ボタン端子台のc端子・a端子。§6.4 */
function pbTerminal(pb: string, suffix: 'c' | 'a'): TerminalId {
  return terminalId(PB_BLOCK_ID, `${pb.slice(2)}${suffix}`);
}

/** ランプ端子台の端子。§6.4 */
function plTerminal(pl: string, sign: '+' | '-'): TerminalId {
  return terminalId(PL_BLOCK_ID, `${pl.slice(2)}${sign}`);
}

/** 鎖状の渡り配線を作る（起点 → 対象1 → 対象2 …）。§11.3 */
function chain(start: TerminalId, targets: readonly TerminalId[]): PlcWireSpec[] {
  const wires: PlcWireSpec[] = [];
  let previous = start;
  for (const target of targets) {
    wires.push({ from: previous, to: target });
    previous = target;
  }
  return wires;
}

/**
 * I/O割付から模範配線を生成する。§10.2
 * 並びは「入力 → 出力 → 2段目 → P側の鎖 → N側の鎖 → PLC電源」で決定論的である。
 */
export function plcWiringPlan(io: ResolvedPlcIo, unit: PlcUnitDefinition | undefined): PlcWireSpec[] {
  if (unit === undefined) return [];
  const inputName = (x: number): string => unit.spec.inputs[x] ?? `X${x}`;
  const outputName = (y: number): string => unit.spec.outputs[y]?.name ?? `Y${y}`;
  const comName = (y: number): string => unit.spec.outputs[y]?.com ?? 'COM0';
  const plcTerminal = (name: string): TerminalId => terminalId('PLC', name);

  const wires: PlcWireSpec[] = [];
  // 入力: 押ボタン端子台のa接点 → X
  for (const input of io.inputs) {
    wires.push({ from: pbTerminal(input.pb, 'a'), to: plcTerminal(inputName(input.x)) });
  }
  // 出力: Y → 盤のリレーコイル（2段結線の1段目）。§10.2
  for (const output of io.outputs) {
    wires.push({ from: plcTerminal(outputName(output.y)), to: terminalId(output.cr, '14') });
  }
  // 2段目: リレーのa接点（組1）→ ランプ端子台
  for (const output of io.outputs) {
    wires.push({ from: terminalId(output.cr, '5'), to: plTerminal(output.pl, '+') });
  }
  // P側の鎖: 入力コモン（シンクのみ）→ 出力COM → リレー接点のCOM
  const usedCommons = [...new Set(io.outputs.map((output) => comName(output.y)))];
  // 入力側の端子が必ず鎖の先頭に来る（シンクなら S/S、ソースなら押ボタンのコモン）。
  // N側の鎖と同じ並び方にしておくと、どちらの結線でも「起点 → 入力側 → 出力側」で読める
  const pTargets: TerminalId[] = [
    ...(io.wiring === 'sink' ? [plcTerminal(unit.spec.inputCommon)] : []),
    ...(io.wiring === 'source' ? io.inputs.map((input) => pbTerminal(input.pb, 'c')) : []),
    ...usedCommons.map(plcTerminal),
    ...io.outputs.map((output) => terminalId(output.cr, '9')),
  ];
  wires.push(...chain(terminalId(P_RAIL_ID, '1'), pTargets));
  // N側の鎖: 入力コモン（ソースのみ）→ 押ボタンのコモン（シンクのみ）→ コイル(−) → ランプ(−)
  const nTargets: TerminalId[] = [
    ...(io.wiring === 'source' ? [plcTerminal(unit.spec.inputCommon)] : []),
    ...(io.wiring === 'sink' ? io.inputs.map((input) => pbTerminal(input.pb, 'c')) : []),
    ...io.outputs.map((output) => terminalId(output.cr, '13')),
    ...io.outputs.map((output) => plTerminal(output.pl, '-')),
  ];
  wires.push(...chain(terminalId(N_RAIL_ID, '1'), nTargets));
  // PLC電源は壁コンセントから取る（盤から取ると `plcPowerIndependent` 違反。§10.1）
  wires.push({ from: terminalId('OUTLET', 'L'), to: plcTerminal('L') });
  wires.push({ from: terminalId('OUTLET', 'N'), to: plcTerminal('N') });
  return wires;
}

/**
 * 模範配線を張る前の見張り。§6.3 / §6.6
 *
 * 押ボタンのコモン（`TB_PB.{n}c`）に**既設の固定配線**が来ている押ボタンは、母線の鎖を通すと
 * 端子が2本を超えるか、P と N を短絡してしまうため PLC入力に使えない。既定の盤では
 * `fw-chk-1: P.1 → TB_PB.4c`（チェック用回路）がこれに当たるので `PB4` が弾かれる。
 * `PlcInputMapSchema` も `PB4` を受け付けないが、盤の既設配線が変わってもここで必ず捕まる。
 */
export function plcWiringPlanIssues(io: ResolvedPlcIo, session: BoardSession): ProblemIssue[] {
  const locked = new Set<string>();
  for (const wire of session.wires) {
    if (!wire.locked) continue;
    for (const terminal of [wire.from, wire.to]) locked.add(String(terminal));
  }
  const issues: ProblemIssue[] = [];
  io.inputs.forEach((input, index) => {
    const common = String(pbTerminal(input.pb, 'c'));
    if (!locked.has(common)) return;
    issues.push({
      path: `io.inputs[${index}].pb`,
      message: `${input.pb} は既設の固定配線（${common}）が来ているためPLC入力に使えません（§6.3）`,
    });
  });
  return issues;
}

/** 模範の盤セッションとネットリストを組む。§7.2 / §13 #2 */
export function buildPlcReferenceSession(
  problem: PlcProblem,
  board: BoardDefinition,
): PlcReferenceResult {
  if (problem.board.boardId !== board.id) {
    return {
      ok: false,
      errors: [
        {
          path: 'board.boardId',
          message: `課題が要求する盤（${problem.board.boardId}）と渡された盤（${board.id}）が違います`,
        },
      ],
    };
  }
  const plcBoard = plcBoardFor(problem, board);
  const unit = plcBoard?.plcUnit;
  if (plcBoard === undefined || unit === undefined) {
    return {
      ok: false,
      errors: [{ path: 'plc.model', message: `対応していないPLC機種です: ${problem.plc.model}` }],
    };
  }
  const compiled = compile(problem.referenceLadder);
  if (!compiled.ok) {
    return {
      ok: false,
      errors: compiled.errors.map((error) => ({
        path: 'referenceLadder',
        message: `模範ラダーを変換できません（${error.code}）: ${error.message}`,
      })),
    };
  }

  const roles = toSocketRoles(problem.board.socketRoles);
  const io = resolvePlcIo(problem.io);
  const session = createSession(plcBoard, {
    roles,
    allowedColors: [PLC_WIRE_COLOR],
    inventory: problem.inventory,
  });
  const pbIssues = plcWiringPlanIssues(io, session);
  if (pbIssues.length > 0) return { ok: false, errors: pbIssues };

  const errors: ProblemIssue[] = [];
  io.outputs.forEach((output, index) => {
    const socket = trySocketOf(roles, output.cr);
    if (socket === undefined) {
      errors.push({
        path: `io.outputs[${index}].cr`,
        message: `${output.cr} が盤のソケットに割り当てられていません（board.socketRoles）`,
      });
      return;
    }
    const mounted = plug(session, socket, 'relay-my4n');
    if (!mounted.ok) {
      errors.push({ path: `io.outputs[${index}].cr`, message: mounted.message });
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  for (const [index, spec] of plcWiringPlan(io, unit).entries()) {
    const result = addWire(session, plcBoard, spec.from, spec.to, PLC_WIRE_COLOR);
    if (!result.ok) {
      errors.push({
        path: `io`,
        message: `模範配線を張れません（${index + 1}本目 ${spec.from} – ${spec.to}）: ${result.message}`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      session,
      netlist: toNetlist(session, plcBoard),
      board: plcBoard,
      unit,
      io,
      program: compiled.program,
    },
  };
}
```

- [ ] **Step 4: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run test/plc-reference.test.ts
pnpm exec prettier --write packages/content/src/plc-reference.ts packages/content/test/plc-reference.test.ts
pnpm exec prettier --check packages/content
git add packages/content
git commit -m "feat(content): generate the mode D reference wiring from the I/O map"
```

Expected: `Tests  9 passed (9)`。**電線が25本にならない場合**は、鎖の組み方（どの端子を何番目に渡すか）ではなく**端子の本数上限**を先に疑うこと。`addWire` が `terminal-overload` で落ちていれば、その端子に既に2本（うち1本は §6.3 の既設配線）が来ている。

---

## Task 15: `plc-io.ts` — スキャンと tick の結合

**Files:**
- Create: `packages/content/src/plc-io.ts`
- Modify: `packages/content/src/runner.ts`
- Test: `packages/content/test/plc-io.test.ts`

§10.4 の「1 tick ＝ 1 スキャン」を実装する（決定表#4）。`runner.ts` に `beforeTick` フックと「既にあるシミュレーションを走らせる」入口を足し、`plc-io.ts` が `Simulation` を `PlcIoPort` として見せる。

| 決めること | 本タスクの実装 |
|---|---|
| 順序 | 1 tick の先頭で `runtime.scan()`（①`sim.plcInputs()` を読む ②ラダー実行 ③`sim.setPlcOutputs()`）→ そのあと `sim.step()` が回路を解く |
| 入力の遅れ | `plcInputs()` が返すのは**直前の tick の解**に基づく値。実機のスキャンと同じ1スキャンぶんの遅れで、許容差200msに対して十分小さい |
| 部品ID | 既定は `@ojt/board-model` の `PLC_PART_ID`（`'PLC'`）。テストのために差し替えられる |
| 出力点数 | 既定はPLC本体の出力点数（`outputCount`）。ラダーが使う番号より多くても、使っていない点は常にOFFで書かれる |

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/plc-io.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { Simulation, TICK_MS } from '@ojt/circuit-sim';
import {
  compile,
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { createPlcCoupling, createSimulationIoPort, runPlcOperations } from '../src/plc-io.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';
import { PlcProblemSchema } from '../src/schema/plc.js';
import { plcProblemJson } from './helpers/plc.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** 模範配線（Task 14）で組んだ盤とネットリスト。 */
function reference() {
  const problem = PlcProblemSchema.parse(plcProblemJson());
  const built = buildPlcReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

describe('createSimulationIoPort', () => {
  it('reads the simulation inputs and writes its outputs (§10.4)', () => {
    const { circuit } = reference();
    const sim = new Simulation(circuit.netlist);
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.step();
    const port = createSimulationIoPort(sim);
    expect(port.readInputs()[0]).toBe(false);
    sim.press('PB1');
    sim.step();
    expect(port.readInputs()[0]).toBe(true);
    port.writeOutputs([true]);
    sim.step();
    expect(sim.state().plcs['PLC']?.outputs[0]).toBe(true);
  });
});

describe('createPlcCoupling', () => {
  it('runs exactly one scan per tick (§10.4)', () => {
    const { circuit } = reference();
    const sim = new Simulation(circuit.netlist);
    const coupling = createPlcCoupling(sim, circuit.program);
    sim.setBreaker(true);
    sim.setSwitch(true);
    for (let i = 0; i < 5; i += 1) {
      coupling.beforeTick(sim, sim.tMs);
      sim.step();
    }
    expect(coupling.runtime.scanCount).toBe(5);
    expect(coupling.runtime.tMs).toBe(5 * TICK_MS);
  });
});

describe('runPlcOperations', () => {
  it('lights the lamp through the PLC, the relay and the two-stage wiring (§10.2 / §16 Phase 3 ③)', () => {
    const { problem, circuit } = reference();
    const result = runPlcOperations(circuit.netlist, circuit.program, problem.operations, {
      durationMs: problem.durationMs,
    });
    const transitions = result.log.transitions('PL1');
    expect(transitions.some((e) => e.value === true)).toBe(true);
    // PB1 を押してから 3tick 以内（入力1スキャン遅れ＋コイル1tick＋接点1tick）で点く
    const litMs = transitions.find((e) => e.value === true)?.tMs ?? -1;
    expect(litMs).toBeGreaterThan(0);
    expect(litMs).toBeLessThanOrEqual(4 * TICK_MS);
    expect(result.runtime.scanCount).toBe(problem.durationMs / TICK_MS);
  });

  it('is deterministic (§5.2)', () => {
    const { problem, circuit } = reference();
    const once = runPlcOperations(circuit.netlist, circuit.program, problem.operations, {
      durationMs: problem.durationMs,
    }).log.entries();
    const second = reference();
    const twice = runPlcOperations(second.circuit.netlist, second.circuit.program, problem.operations, {
      durationMs: problem.durationMs,
    }).log.entries();
    expect(once).toEqual(twice);
  });

  it('leaves the lamp dark when the ladder never turns the output on', () => {
    const { problem, circuit } = reference();
    const idle = compile(program(network('n1', [rung(no(X(1)), out(Y(1)))]), endNetwork()));
    if (!idle.ok) throw new Error('変換に失敗しました');
    const result = runPlcOperations(circuit.netlist, idle.program, problem.operations, {
      durationMs: problem.durationMs,
    });
    expect(result.log.transitions('PL1').some((e) => e.value === true)).toBe(false);
  });
});
```

**注意:** このテストは Task 14 の `buildPlcReferenceSession()`（模範配線）を使う。Task 14 を先に済ませているので前方参照は無い。

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/plc-io.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/plc-io.js`。

- [ ] **Step 3: `src/runner.ts` に `beforeTick` を足す**

`RunOptions` に足す:

```ts
  /**
   * 各 tick の先頭（操作の適用の後、`step()` の前）に呼ばれる。§10.4
   * モードDでは PLC のスキャン（入力読込 → ラダー実行 → 出力書込）をここで回す。
   */
  beforeTick?: (simulation: Simulation, tMs: number) => void;
```

`runOperations()` を「シミュレーションを作る入口」と「走らせる本体」に割る:

```ts
export function runOperations(
  netlist: Netlist,
  operations: readonly Operation[],
  options: RunOptions,
): RunResult {
  const simulation = new Simulation(netlist, {
    tickMs: options.tickMs ?? TICK_MS,
    ...(options.watch === undefined ? {} : { watch: options.watch }),
  });
  return runOperationsOn(simulation, operations, options);
}

/**
 * 既に作ったシミュレーションで操作列を再生する。§7.3
 * PLCのスキャンのように「シミュレーションを先に作ってから結線したいもの」があるときに使う（§10.4）。
 * `options.watch` はシミュレーション生成時にしか効かないのでここでは無視する。
 */
export function runOperationsOn(
  simulation: Simulation,
  operations: readonly Operation[],
  options: RunOptions,
): RunResult {
  const tickMs = options.tickMs ?? TICK_MS;
  powerUp(simulation);

  let cursor = 0;
  let tMs = 0;
  for (; tMs < options.durationMs; tMs += tickMs) {
    for (let op = operations[cursor]; op !== undefined && op.t <= tMs; op = operations[cursor]) {
      if (op.action === 'press') simulation.press(op.target);
      else simulation.release(op.target);
      cursor += 1;
    }
    options.beforeTick?.(simulation, tMs);
    simulation.step(tickMs);
  }

  return {
    simulation,
    log: simulation.log,
    events: simulation.events,
    lastTickMs: Math.max(0, tMs - tickMs),
  };
}
```

- [ ] **Step 4: `src/plc-io.ts` を書く**

```ts
import { PLC_PART_ID } from '@ojt/board-model';
import { TICK_MS, type Netlist, type Simulation } from '@ojt/circuit-sim';
import {
  createPlcRuntime,
  type CompiledProgram,
  type PlcIoPort,
  type PlcRuntime,
} from '@ojt/ladder-core';
import { runOperationsOn, type RunOptions, type RunResult } from './runner.js';
import type { Operation } from './schema/operations.js';

/**
 * PLCランタイムと回路エンジンの結合。設計仕様 §10.4 / §4.2 / 決定表#4。
 *
 * `@ojt/ladder-core` は回路エンジンを知らず、`@ojt/circuit-sim` はラダーを知らない。両方を知って
 * いるのはこのパッケージだけなので、結合点はここ1か所である。1 tick の順序は
 * 「①入力読込 ②ネットワーク実行 ③出力書込 → ④回路を解く」。入力は直前の tick の解に基づく値
 * なので、実機のスキャンと同じく1スキャンぶん遅れる。
 */

/** `Simulation` を `PlcIoPort` として見せる。§4.2 */
export function createSimulationIoPort(sim: Simulation, partId: string = PLC_PART_ID): PlcIoPort {
  return {
    readInputs: () => sim.plcInputs(partId),
    writeOutputs: (values) => {
      sim.setPlcOutputs(partId, values);
    },
  };
}

/** 結合オプション。 */
export interface PlcCouplingOptions {
  /** PLC本体の部品ID。既定 `PLC`。 */
  partId?: string;
  /** 出力配列の長さ。既定はラダーが使う最大番号＋1。 */
  outputCount?: number;
  /** スキャン周期[ms]。既定は `TICK_MS`（10）。§10.4 */
  scanMs?: number;
}

/** スキャンと tick の結合。 */
export interface PlcCoupling {
  runtime: PlcRuntime;
  /** `runOperations` の `beforeTick` にそのまま渡せる関数。 */
  beforeTick: (simulation: Simulation, tMs: number) => void;
}

/** シミュレーションとラダーを結ぶ。§10.4 */
export function createPlcCoupling(
  sim: Simulation,
  program: CompiledProgram,
  options: PlcCouplingOptions = {},
): PlcCoupling {
  const runtime = createPlcRuntime(program, {
    io: createSimulationIoPort(sim, options.partId ?? PLC_PART_ID),
    scanMs: options.scanMs ?? TICK_MS,
    ...(options.outputCount === undefined ? {} : { outputCount: options.outputCount }),
  });
  return {
    runtime,
    beforeTick: () => {
      runtime.scan();
    },
  };
}

/** モードDの再生オプション。 */
export interface PlcRunOptions extends RunOptions, PlcCouplingOptions {}

/** 再生結果（ランタイムの最終状態つき）。 */
export interface PlcRunResult extends RunResult {
  runtime: PlcRuntime;
}

/**
 * ラダー＋配線を操作列で再生する。§10.4 / §7.3
 * `runOperations()` と同じ規則（`t=0` で通電済み・10ms tick・決定論）で走り、
 * 各 tick の先頭で1スキャンずつラダーを実行する。
 */
export function runPlcOperations(
  netlist: Netlist,
  program: CompiledProgram,
  operations: readonly Operation[],
  options: PlcRunOptions,
): PlcRunResult {
  const simulation = new Simulation(netlist, {
    tickMs: options.tickMs ?? TICK_MS,
    ...(options.watch === undefined ? {} : { watch: options.watch }),
  });
  const coupling = createPlcCoupling(simulation, program, options);
  const result = runOperationsOn(simulation, operations, {
    ...options,
    beforeTick: coupling.beforeTick,
  });
  return { ...result, runtime: coupling.runtime };
}
```

- [ ] **Step 5: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run test/plc-io.test.ts test/runner.test.ts test/plc-reference.test.ts
git add packages/content
git commit -m "feat(content): couple the PLC scan to the engine tick"
```

Expected: `test/plc-io.test.ts` が `Tests  5 passed (5)`、既存の `test/runner.test.ts` もそのまま通る（`beforeTick` を渡さない呼び出しは挙動が変わらない）。

---

## Task 16: `plc-static-checks.ts` — `twoStage` / `plcPowerIndependent` / `ioAssignment`

**Files:**
- Create: `packages/content/src/static-check-types.ts`（`StaticCheckInput` / `StaticCheckResult` / `PlcCheckContext` の置き場）
- Create: `packages/content/src/plc-static-checks.ts`
- Modify: `packages/content/src/static-checks.ts`
- Test: `packages/content/test/plc-static-checks.test.ts`

§7.4 の3件と §10.2 の結線ルールを、**通電せずネットリストの節点だけ**で判定する（前提#7）。`buildNets()` が返す `Nets.terminalsOf(node)`（同じ節点に居る端子の一覧）だけを見る。

| チェック | 合格の条件 | 主なエラー |
|---|---|---|
| `twoStage` | すべての Y が盤のリレーコイル（`CRn.14`）と同じ節点にあり、ランプ端子台（`TB_PL.*`）とは繋がっていない。各ランプはリレーの接点端子と繋がっている | `Y0 が PL1 に直結しています` / `Y0 がリレーのコイルに繋がっていません` |
| `plcPowerIndependent` | `PLC.L` / `PLC.N` が盤の電源（`P.*` / `N.*` / `PS.*` / `CB.*` / `SW.*`）と繋がっておらず、壁コンセント（`OUTLET.*`）と繋がっている | `PLC の電源を盤から取っています` / `PLC の電源が壁コンセントに配線されていません` |
| `ioAssignment` | `io.mode` が `fixed` のとき、割付どおりに配線され、入力コモンが `io.wiring` の側の母線に繋がっている | `X0 は PB1 に割り付けます` / `入力コモン（S/S）が P 側に配線されていません` |

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/plc-static-checks.test.ts`:

```ts
import { addWire, JIPM_BOARD, removeWire, toNetlist } from '@ojt/board-model';
import { buildNets, type TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  checkIoAssignment,
  checkPlcPowerIndependent,
  checkTwoStage,
  detectPlcWiring,
  type PlcCheckContext,
} from '../src/plc-static-checks.js';
import { runPlcOperations } from '../src/plc-io.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';
import { runStaticChecks } from '../src/static-checks.js';
import type { StaticCheckInput } from '../src/static-check-types.js';
import { PlcProblemSchema } from '../src/schema/plc.js';
import { plcProblemJson } from './helpers/plc.js';

function t(id: string): TerminalId {
  return id as TerminalId;
}

/**
 * その電線がこの端子に繋がっているか。
 * `TerminalId` はブランド付きのテンプレートリテラル型なので、リテラルと `===` で比べると
 * `TS2367`（型に重なりが無い）になる。比較は必ず `String()` を挟む。
 */
function at(wire: { from: TerminalId; to: TerminalId }, id: string): boolean {
  return String(wire.from) === id || String(wire.to) === id;
}

const PROBLEM = PlcProblemSchema.parse(plcProblemJson());

/** 模範回路（＝正しく配線された盤）を作る。 */
function reference() {
  const built = buildPlcReferenceSession(PROBLEM, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem: PROBLEM, circuit: built.value };
}

/**
 * チェックの入力を組む。
 * PLCの3件はログを読まないが、`runStaticChecks` の他の6件（`coilPolarity` / `forbiddenCircuit` /
 * `powerSequence`）はログとイベントを読む。ダミーの空ログを渡すと検査が素通りしてしまうので、
 * **実際に操作列を再生した結果**を渡す。
 */
function checkInput(
  circuit: ReturnType<typeof reference>['circuit'],
  plc: PlcCheckContext,
): StaticCheckInput {
  const netlist = toNetlist(circuit.session, circuit.board);
  const result = runPlcOperations(netlist, circuit.program, PROBLEM.operations, {
    durationMs: PROBLEM.durationMs,
  });
  return {
    session: circuit.session,
    netlist,
    log: result.log,
    hazards: result.events.hazards(),
    chatters: result.events.chatters(),
    allowedColors: ['青' as const],
    plc,
  };
}

function context(circuit: ReturnType<typeof reference>['circuit']): PlcCheckContext {
  return { unit: circuit.unit, io: circuit.io, roles: circuit.session.socketRoles };
}

describe('twoStage（§10.2 / §7.4）', () => {
  it('passes on the reference circuit', () => {
    const { circuit } = reference();
    expect(checkTwoStage(checkInput(circuit, context(circuit))).ok).toBe(true);
  });

  it('fails when Y is wired straight to the lamp (§16 Phase 3 受入基準④)', () => {
    const { circuit } = reference();
    // Y0 → CR1.14 を外し、Y0 → TB_PL.1+ に直結する
    const direct = circuit.session.wires.find((w) => at(w, 'PLC.Y0'));
    expect(removeWire(circuit.session, direct?.id ?? '').ok).toBe(true);
    const lampWire = circuit.session.wires.find((w) => String(w.to) === 'TB_PL.1+');
    expect(removeWire(circuit.session, lampWire?.id ?? '').ok).toBe(true);
    expect(addWire(circuit.session, circuit.board, t('PLC.Y0'), t('TB_PL.1+')).ok).toBe(true);
    const result = checkTwoStage(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('')).toContain('直結');
  });

  it('fails when Y drives nothing at all', () => {
    const { circuit } = reference();
    const wire = circuit.session.wires.find((w) => at(w, 'PLC.Y0'));
    removeWire(circuit.session, wire?.id ?? '');
    const result = checkTwoStage(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('')).toContain('コイル');
  });
});

describe('plcPowerIndependent（§10.1 / §7.4）', () => {
  it('passes when the PLC takes its power from the wall outlet', () => {
    const { circuit } = reference();
    expect(checkPlcPowerIndependent(checkInput(circuit, context(circuit))).ok).toBe(true);
  });

  it('fails when the PLC power comes from the board (§16 Phase 3 受入基準⑤)', () => {
    const { circuit } = reference();
    const wire = circuit.session.wires.find((w) => String(w.to) === 'PLC.L');
    removeWire(circuit.session, wire?.id ?? '');
    // 盤の P.1 は既設配線＋鎖の1本で埋まっている。鎖の途中の端子も2本埋まっているので、
    // 空きがあるのは鎖の**末端**（最後の出力リレーの 9番ピン）だけである（§6.6）
    const lastRelay = circuit.io.outputs.at(-1)?.cr ?? 'CR3';
    expect(addWire(circuit.session, circuit.board, t(`${lastRelay}.9`), t('PLC.L')).ok).toBe(true);
    const result = checkPlcPowerIndependent(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('')).toContain('盤');
  });

  it('fails when the PLC power is not wired at all', () => {
    const { circuit } = reference();
    for (const wire of [...circuit.session.wires]) {
      if (at(wire, 'PLC.L') || at(wire, 'PLC.N')) removeWire(circuit.session, wire.id);
    }
    expect(checkPlcPowerIndependent(checkInput(circuit, context(circuit))).ok).toBe(false);
  });
});

describe('ioAssignment（§7.4 / §7.6）', () => {
  it('passes on the reference circuit when the map is fixed', () => {
    const { circuit } = reference();
    expect(checkIoAssignment(checkInput(circuit, context(circuit))).ok).toBe(true);
  });

  it('is skipped (always OK) when the map is free', () => {
    const { circuit } = reference();
    const free = { ...context(circuit), io: { ...circuit.io, mode: 'free' as const } };
    const result = checkIoAssignment(checkInput(circuit, free));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('自由');
  });

  it('fails when an input is wired to the wrong push button', () => {
    const { circuit } = reference();
    const wire = circuit.session.wires.find((w) => String(w.to) === 'PLC.X0');
    removeWire(circuit.session, wire?.id ?? '');
    expect(addWire(circuit.session, circuit.board, t('TB_PB.2a'), t('PLC.X0')).ok).toBe(true);
    expect(checkIoAssignment(checkInput(circuit, context(circuit))).ok).toBe(false);
  });
});

describe('detectPlcWiring（§10.2）', () => {
  it('recognises sink wiring on the reference circuit', () => {
    const { circuit } = reference();
    const nets = buildNets(toNetlist(circuit.session, circuit.board));
    expect(detectPlcWiring(nets, circuit.unit)).toBe('sink');
  });
});

describe('runStaticChecks（PLCの3件を含む）', () => {
  it('runs the nine checks in the fixed order when they are all enabled (§7.4)', () => {
    const { problem, circuit } = reference();
    const results = runStaticChecks(
      checkInput(circuit, context(circuit)),
      problem.judge.staticChecks,
    );
    expect(results.map((r) => r.id)).toEqual([
      'wireColorRule',
      'terminalLimit',
      'unusedParts',
      'forbiddenCircuit',
      'coilPolarity',
      'powerSequence',
      'twoStage',
      'plcPowerIndependent',
      'ioAssignment',
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('reports the PLC checks as errors when the mode D context is missing', () => {
    const { problem, circuit } = reference();
    const { plc: _drop, ...withoutPlc } = checkInput(circuit, context(circuit));
    const results = runStaticChecks(withoutPlc, problem.judge.staticChecks);
    expect(results.find((r) => r.id === 'twoStage')?.ok).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/plc-static-checks.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/plc-static-checks.js`。

- [ ] **Step 3a: `src/static-check-types.ts` を作って型を切り出す**

`plc-static-checks.ts` は `static-checks.ts` の型（`StaticCheckInput` / `StaticCheckResult`）が要り、`static-checks.ts` は `plc-static-checks.ts` の関数が要る。`import-x/no-cycle` はこのリポジトリでは `maxDepth: Infinity` で走り、**型だけの辺も循環として数える**ので、型は最初から第三のファイルに置く（後から直すのではなく、この順で作る）。

`packages/content/src/static-check-types.ts`（新規）:

```ts
import type { BoardSession, PlcUnitDefinition, SocketRoles } from '@ojt/board-model';
import type {
  ChatterEvent,
  HazardEvent,
  Netlist,
  SignalLog,
  WireColor,
} from '@ojt/circuit-sim';
import type { ResolvedPlcIo } from './schema/plc.js';
import type { StaticCheckId } from './schema/judge.js';

/**
 * 静的チェックの型だけを置くファイル。設計仕様 §7.4。
 *
 * `static-checks.ts`（汎用6件）と `plc-static-checks.ts`（モードD3件）が互いを必要とするため、
 * 型はどちらにも属さないここに置く。`import-x/no-cycle` は型だけの往復も循環と見なすので、
 * この切り出しは必須である。
 */

export type { StaticCheckId };

/** チェック1件の結果。§7.4 */
export interface StaticCheckResult {
  id: StaticCheckId;
  ok: boolean;
  message: string;
  details: string[];
}

/** モードDの静的チェックに要る文脈。§10.2 */
export interface PlcCheckContext {
  unit: PlcUnitDefinition;
  io: ResolvedPlcIo;
  roles: SocketRoles;
}

/** チェックの入力（訓練者側の盤・ネットリスト・再生結果）。 */
export interface StaticCheckInput {
  session: BoardSession;
  netlist: Netlist;
  log: SignalLog;
  hazards: readonly HazardEvent[];
  chatters: readonly ChatterEvent[];
  /** 新規配線に使ってよい線色。モードB・Dは青のみ、モードC2は白のみ。§8.1 */
  allowedColors: readonly WireColor[];
  /**
   * 課題の開始時点で既に盤にあった電線のID。線色の検査から外す。§9.2
   * モードC2は「初期配線は青のまま・修復だけ白」なので、残っている青線を違反にしない。
   * モードBでは渡さない（訓練者が引いた電線しか無いため）。
   */
  preexistingWireIds?: ReadonlySet<string>;
  /**
   * モードDの文脈（PLC本体・I/O割付・ソケット役割）。§10.2
   * `twoStage` / `plcPowerIndependent` / `ioAssignment` を有効にするときは必須である。
   */
  plc?: PlcCheckContext;
}
```

`src/static-checks.ts` からは `StaticCheckResult` / `StaticCheckInput` の**定義を消して**このファイルから import し、APIの互換のために再エクスポートする:

```ts
import type { PlcCheckContext, StaticCheckInput, StaticCheckResult } from './static-check-types.js';

export type { PlcCheckContext, StaticCheckInput, StaticCheckResult };
```

- [ ] **Step 3b: `src/plc-static-checks.ts` を書く**

```ts
import {
  OUTLET_ID,
  PLC_PART_ID,
  PL_BLOCK_ID,
  PB_BLOCK_ID,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { buildNets, terminalId, type Nets, type TerminalId } from '@ojt/circuit-sim';
import type {
  PlcCheckContext,
  StaticCheckInput,
  StaticCheckResult,
} from './static-check-types.js';

// 型は `static-check-types.ts` に置いてある（Step 3a）。テストの import 先を変えないため再エクスポートする
export type { PlcCheckContext };

/**
 * モードDの静的チェック。設計仕様 §7.4 / §10.2 / §10.8。
 *
 * 通電せずに構造だけで判定する（§2 用語「静的チェック」）ので、見るのは `buildNets()` が返す
 * 「同じ節点に居る端子の一覧」だけである。電線・0Ωリンクで繋がっている端子は同じ節点になるため、
 * 渡り配線を何段重ねても正しく追える。
 */

/** 盤の電源系端子の接頭辞（ここから PLC の電源を取ってはならない）。§10.1 */
export const BOARD_POWER_PREFIXES: readonly string[] = ['P.', 'N.', 'PS.', 'CB.', 'SW.'];

function result(
  id: StaticCheckResult['id'],
  details: string[],
  okMessage: string,
  ngMessage: string,
): StaticCheckResult {
  return details.length === 0
    ? { id, ok: true, message: okMessage, details }
    : { id, ok: false, message: ngMessage, details };
}

/** モードDの文脈が無いまま有効にされたときの結果。 */
function missingContext(id: StaticCheckResult['id']): StaticCheckResult {
  return {
    id,
    ok: false,
    message: 'PLC課題ではないためこの検査は実行できません',
    details: ['この静的チェックはモードDの課題でのみ有効にできます（§7.4）'],
  };
}

/** その端子と同じ節点にいる端子の一覧（端子が無ければ空）。 */
function netTerminals(nets: Nets, terminal: TerminalId): readonly TerminalId[] {
  if (!nets.hasTerminal(terminal)) return [];
  return nets.terminalsOf(nets.nodeOf(terminal));
}

/** PLCの端子ID。 */
function plcTerminal(name: string): TerminalId {
  return terminalId(PLC_PART_ID, name);
}

/** 割付の出力番号 → PLCの出力端子。 */
function outputTerminal(unit: PlcUnitDefinition, y: number): TerminalId {
  return plcTerminal(unit.spec.outputs[y]?.name ?? `Y${y}`);
}

/** 割付の入力番号 → PLCの入力端子。 */
function inputTerminal(unit: PlcUnitDefinition, x: number): TerminalId {
  return plcTerminal(unit.spec.inputs[x] ?? `X${x}`);
}

/** 入力コモンの結線方式を判定する。§10.2 */
export function detectPlcWiring(
  nets: Nets,
  unit: PlcUnitDefinition,
): 'sink' | 'source' | undefined {
  const terminals = netTerminals(nets, plcTerminal(unit.spec.inputCommon));
  if (terminals.some((id) => id.startsWith('P.'))) return 'sink';
  if (terminals.some((id) => id.startsWith('N.'))) return 'source';
  return undefined;
}

/**
 * 2段結線。§10.2 / §7.4
 * Y出力は盤のリレーのコイルへ、リレーの接点がランプへ、という2段でなければならない。
 * Y → ランプの直結（`twoStage` 違反）と、Y がどのコイルにも繋がっていない場合を検出する。
 */
export function checkTwoStage(input: StaticCheckInput): StaticCheckResult {
  const plc = input.plc;
  if (plc === undefined) return missingContext('twoStage');
  const nets = buildNets(input.netlist);
  const details: string[] = [];
  for (const output of plc.io.outputs) {
    const yTerminal = outputTerminal(plc.unit, output.y);
    const yNet = netTerminals(nets, yTerminal);
    if (yNet.some((id) => id.startsWith(`${PL_BLOCK_ID}.`))) {
      details.push(`${yTerminal} が ${output.pl} に直結しています（盤のリレーを介します）`);
      continue;
    }
    if (!yNet.includes(terminalId(output.cr, '14'))) {
      details.push(`${yTerminal} がリレー ${output.cr} のコイル（${output.cr}.14）に繋がっていません`);
      continue;
    }
    const lampNet = netTerminals(nets, terminalId(PL_BLOCK_ID, `${output.pl.slice(2)}+`));
    const drivenByContact = lampNet.some((id) => {
      if (!id.startsWith(`${output.cr}.`)) return false;
      const pin = Number(id.slice(output.cr.length + 1));
      return pin >= 1 && pin <= 12; // 接点（COM・a・b）のピン。コイル（13/14）は除く
    });
    if (!drivenByContact) {
      details.push(`${output.pl} が ${output.cr} の接点から駆動されていません`);
    }
  }
  return result(
    'twoStage',
    details,
    'PLC出力 → 盤のリレー → 表示灯の2段結線になっています',
    'PLCの出力を表示灯へ直結しています（盤のリレーを介してください）',
  );
}

/**
 * PLC電源の独立。§10.1 / §7.4
 * 盤の AC100V / DC24V から PLC本体の電源を取ってはならない（調査資料 §1.5）。
 * 入力回路（`S/S` と `Xn`）に盤のDC24Vを使うのは違反ではない（§10.2）。
 */
export function checkPlcPowerIndependent(input: StaticCheckInput): StaticCheckResult {
  const plc = input.plc;
  if (plc === undefined) return missingContext('plcPowerIndependent');
  const nets = buildNets(input.netlist);
  const details: string[] = [];
  for (const name of ['L', 'N']) {
    const terminal = plcTerminal(name);
    const terminals = netTerminals(nets, terminal);
    const fromBoard = terminals.filter((id) =>
      BOARD_POWER_PREFIXES.some((prefix) => id.startsWith(prefix)),
    );
    if (fromBoard.length > 0) {
      details.push(`${terminal} が盤の電源（${fromBoard.join('・')}）に繋がっています`);
      continue;
    }
    if (!terminals.some((id) => id.startsWith(`${OUTLET_ID}.`))) {
      details.push(`${terminal} が壁コンセントに配線されていません`);
    }
  }
  return result(
    'plcPowerIndependent',
    details,
    'PLCの電源は盤から独立しています',
    'PLCの電源を盤から取っています（壁コンセントに配線してください）',
  );
}

/** I/O割付の遵守。§7.4 / §7.6 */
export function checkIoAssignment(input: StaticCheckInput): StaticCheckResult {
  const plc = input.plc;
  if (plc === undefined) return missingContext('ioAssignment');
  if (plc.io.mode === 'free') {
    return {
      id: 'ioAssignment',
      ok: true,
      message: 'I/O割付は自由です（課題が固定していません）',
      details: [],
    };
  }
  const nets = buildNets(input.netlist);
  const details: string[] = [];
  for (const input_ of plc.io.inputs) {
    const terminal = inputTerminal(plc.unit, input_.x);
    const expected = terminalId(PB_BLOCK_ID, `${input_.pb.slice(2)}a`);
    if (!netTerminals(nets, terminal).includes(expected)) {
      details.push(`${terminal} は ${input_.pb} のa接点（${expected}）に割り付けます`);
    }
  }
  for (const output of plc.io.outputs) {
    const terminal = outputTerminal(plc.unit, output.y);
    const expected = terminalId(output.cr, '14');
    if (!netTerminals(nets, terminal).includes(expected)) {
      details.push(`${terminal} は ${output.cr} のコイル（${expected}）に割り付けます`);
    }
  }
  const wiring = detectPlcWiring(nets, plc.unit);
  if (wiring === undefined) {
    details.push('入力コモン（S/S）が盤のP側・N側のどちらにも配線されていません');
  } else if (wiring !== plc.io.wiring) {
    details.push(
      `入力コモン（S/S）の結線が課題の指定（${plc.io.wiring}）と違います（${wiring} になっています）`,
    );
  }
  return result(
    'ioAssignment',
    details,
    'I/O割付どおりに配線されています',
    'I/O割付と配線が食い違っています',
  );
}
```

- [ ] **Step 4: `src/static-checks.ts` の仮実装を本実装に差し替える**

Task 12 Step 4 で置いた仮実装（`plcCheckNotReady` と `CHECKS` の3件）を**そのまま消して**、本物の関数に差し替える。

1. `function plcCheckNotReady(...)` の定義ごと削除する。
2. import を足す:

```ts
import { checkIoAssignment, checkPlcPowerIndependent, checkTwoStage } from './plc-static-checks.js';
```

3. `CHECKS` の3件を差し替える:

```ts
const CHECKS: Readonly<Record<StaticCheckId, (input: StaticCheckInput) => StaticCheckResult>> = {
  wireColorRule: checkWireColorRule,
  terminalLimit: checkTerminalLimit,
  unusedParts: checkUnusedParts,
  forbiddenCircuit: checkForbiddenCircuit,
  coilPolarity: checkCoilPolarity,
  powerSequence: checkPowerSequence,
  twoStage: checkTwoStage,
  plcPowerIndependent: checkPlcPowerIndependent,
  ioAssignment: checkIoAssignment,
};
```

`StaticCheckInput` への `plc?: PlcCheckContext` の追加は Step 3a で `static-check-types.ts` に入っているので、ここでは何もしなくてよい。依存の向きは `static-check-types.ts` ← `plc-static-checks.ts` ← `static-checks.ts` の一方向だけになり、`import-x/no-cycle`（`maxDepth: Infinity`・型だけの辺も対象）は無警告になる。

- [ ] **Step 5: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run test/plc-static-checks.test.ts test/static-checks.test.ts
pnpm --filter @ojt/content typecheck
pnpm lint
pnpm exec prettier --write packages/content/src/static-check-types.ts packages/content/src/plc-static-checks.ts packages/content/src/static-checks.ts packages/content/test/plc-static-checks.test.ts
pnpm exec prettier --check packages/content
git add packages/content
git commit -m "feat(content): add the twoStage, plcPowerIndependent and ioAssignment checks"
```

Expected: 新ファイル11件と既存の `static-checks.test.ts` が通り、`pnpm lint`（`import-x/no-cycle` 込み）が無警告。

---

## Task 17: `judge-plc.ts` — モードDの判定

**Files:**
- Create: `packages/content/src/judge-plc.ts`
- Test: `packages/content/test/judge-plc.test.ts`

§10.8 の判定である。模範ラダー＋模範配線と、訓練者のラダー＋配線を、同じ操作列で並走させて出力波形を比べ（決定事項#8）、静的チェック9件と変換の結果を添える。

| 決めること | 本タスクの実装 |
|---|---|
| 訓練者のラダー | 引数で受け取る（`LadderProgram`）。`compile()` に落ちたら**シミュレートせず不合格**にし、`ladderErrors` に理由を入れる |
| 方言 | 見ない（決定表#7）。方言バリデータは Plan 3B が「変換」ボタンで走らせる |
| 危険操作 | モードBと同じで**セッション中の記録だけ**を数える（§5.6 / 2A のレビュー結果） |
| タイムチャート | 入力はPB4点、出力は比較信号。印はPLCタイマの設定値（`T0=3秒`）から作る（§7.7） |
| 合否 | 動作一致 ＋ 有効な静的チェックにエラー無し ＋ 変換エラー無し（§7.4） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/judge-plc.test.ts`:

```ts
import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { judgePlc, judgePlcReference } from '../src/judge-plc.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';
import { PlcProblemSchema } from '../src/schema/plc.js';
import { plcProblemJson } from './helpers/plc.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

function t(id: string): TerminalId {
  return id as TerminalId;
}

function problem() {
  return PlcProblemSchema.parse(plcProblemJson());
}

/** 模範どおりに配線した訓練者の盤。 */
function traineeSession() {
  const built = buildPlcReferenceSession(problem(), JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value;
}

describe('judgePlcReference（自己整合。§7.8 / §14.1 #30）', () => {
  it('passes the reference ladder against its own reference wiring', () => {
    const judged = judgePlcReference(problem(), JIPM_BOARD);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(true);
    expect(judged.value.mismatches).toEqual([]);
    expect(judged.value.staticChecks.every((c) => c.ok)).toBe(true);
    expect(judged.value.ladderErrors).toEqual([]);
    expect(judged.value.mode).toBe('plc');
  });
});

describe('judgePlc（§10.8）', () => {
  it('fails when the trainee ladder drives the wrong output', () => {
    const circuit = traineeSession();
    const wrong = program(network('n1', [rung(no(X(0)), out(Y(1)))]), endNetwork());
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, wrong);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
    expect(judged.value.mismatches[0]?.signal).toBe('PL1');
  });

  it('fails without simulating when the trainee ladder does not convert (§10.6)', () => {
    const circuit = traineeSession();
    const broken = { networks: [network('n1', [rung(no(X(0)), out(Y(0)))])] };
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, broken);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.ladderErrors.map((e) => e.code)).toContain('missing-end');
    expect(judged.value.mismatches).toEqual([]);
  });

  it('keeps the double-coil warning on the result (§10.4)', () => {
    const circuit = traineeSession();
    const doubled = program(
      network('n1', [rung(no(X(0)), out(Y(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      endNetwork(),
    );
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, doubled);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.ladderWarnings.map((w) => w.code)).toEqual(['double-coil']);
  });

  it('fails the twoStage check when the lamp is wired straight to Y (§16 Phase 3 受入基準④)', () => {
    const circuit = traineeSession();
    const coil = circuit.session.wires.find((w) => String(w.from) === 'PLC.Y0');
    removeWire(circuit.session, coil?.id ?? '');
    const lamp = circuit.session.wires.find((w) => String(w.to) === 'TB_PL.1+');
    removeWire(circuit.session, lamp?.id ?? '');
    addWire(circuit.session, circuit.board, t('PLC.Y0'), t('TB_PL.1+'));
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, problem().referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'twoStage')?.ok).toBe(false);
    expect(judged.value.passed).toBe(false);
  });

  it('fails the plcPowerIndependent check when the PLC is fed from the board (§16 Phase 3 受入基準⑤)', () => {
    const circuit = traineeSession();
    const wire = circuit.session.wires.find((w) => String(w.to) === 'PLC.L');
    removeWire(circuit.session, wire?.id ?? '');
    // 鎖の末端（最後の出力リレーの 9番ピン）だけが1本空いている（§6.6）
    const lastRelay = circuit.io.outputs.at(-1)?.cr ?? 'CR3';
    expect(addWire(circuit.session, circuit.board, t(`${lastRelay}.9`), t('PLC.L')).ok).toBe(true);
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, problem().referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'plcPowerIndependent')?.ok).toBe(false);
  });

  it('builds both charts with the PB inputs and the compared outputs (§7.7)', () => {
    const circuit = traineeSession();
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, problem().referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.charts.expected.signals.map((s) => s.name)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
    ]);
    expect(judged.value.charts.actual.durationMs).toBe(problem().durationMs);
  });

  it('returns a problem error when the reference circuit cannot be built (§13 #2)', () => {
    const broken = PlcProblemSchema.parse(
      plcProblemJson({ board: { boardId: 'other', socketRoles: { S7: 'CHK' } } }),
    );
    const circuit = traineeSession();
    const judged = judgePlc(broken, JIPM_BOARD, circuit.session, broken.referenceLadder);
    expect(judged.ok).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/judge-plc.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/judge-plc.js`。

- [ ] **Step 3: `src/judge-plc.ts` を書く**

```ts
import { toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import { compareLogs, type ChatterEvent, type Mismatch, type SignalLog } from '@ojt/circuit-sim';
import {
  compile,
  type CompileError,
  type CompiledProgram,
  type CompileWarning,
  type LadderProgram,
} from '@ojt/ladder-core';
import { countHazards, type HazardCounts, type JudgeOptions } from './judge.js';
import { runPlcOperations } from './plc-io.js';
import { buildPlcReferenceSession, PLC_WIRE_COLOR } from './plc-reference.js';
import { resolveCompareSignals } from './schema/judge.js';
import type { ProblemIssue } from './schema/index.js';
import type { PlcProblem } from './schema/plc.js';
import { runStaticChecks, type StaticCheckResult } from './static-checks.js';
import {
  buildTimeChart,
  defaultChartSignals,
  type TimeChart,
  type TimeChartMarker,
} from './timechart.js';

/**
 * モードDの判定。設計仕様 §10.8 / §7.4。
 * 模範（模範ラダー＋割付から生成した模範配線）と訓練者（自分のラダー＋自分の配線）を、
 * 同じ操作列で並走させて出力波形を比べる（決定事項#8）。方言は見ない（決定表#7）。
 */

/** モードDの判定結果。 */
export interface JudgePlcResult {
  mode: 'plc';
  passed: boolean;
  mismatches: Mismatch[];
  staticChecks: StaticCheckResult[];
  hazardCount: number;
  hazardsByKind: HazardCounts;
  chatter: ChatterEvent[];
  elapsedMs?: number;
  charts: { expected: TimeChart; actual: TimeChart };
  compareSignals: string[];
  /** 訓練者のラダーの変換エラー（あればシミュレートせず不合格）。§10.6 */
  ladderErrors: CompileError[];
  /** 二重コイルなどの変換警告。§10.4 */
  ladderWarnings: CompileWarning[];
}

/** 判定の実行結果（模範回路が作れなければ課題エラー）。§13 #2 */
export type JudgePlcOutcome =
  | { ok: true; value: JudgePlcResult }
  | { ok: false; errors: ProblemIssue[] };

/** ラダーのタイマ設定値からタイムチャートの印を作る。§7.7 */
export function plcTimerMarkers(program: CompiledProgram): TimeChartMarker[] {
  const markers: TimeChartMarker[] = [];
  for (const net of program.networks) {
    for (const output of net.outputs) {
      if (output.cell.kind !== 'timer') continue;
      const seconds = output.cell.presetMs / 1000;
      markers.push({
        tMs: output.cell.presetMs,
        label: `T${output.cell.device.index}=${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}秒`,
      });
    }
  }
  return markers;
}

/** 比較信号が模範のログに無い（課題データの誤り）。§13 #2 */
function unknownCompareSignals(compareSignals: readonly string[], log: SignalLog): ProblemIssue[] {
  const recorded = new Set(log.signals());
  const out: ProblemIssue[] = [];
  compareSignals.forEach((signal, index) => {
    if (recorded.has(signal)) return;
    out.push({
      path: `judge.compareSignals[${index}]`,
      message: `比較信号 ${signal} は模範回路の記録にありません`,
    });
  });
  return out;
}

/** モードDの判定を実行する。§10.8 */
export function judgePlc(
  problem: PlcProblem,
  board: BoardDefinition,
  traineeSession: BoardSession,
  traineeLadder: LadderProgram,
  options: JudgeOptions = {},
): JudgePlcOutcome {
  const reference = buildPlcReferenceSession(problem, board);
  if (!reference.ok) return reference;
  const { board: plcBoard, unit, io, program: referenceProgram } = reference.value;
  const outputCount = unit.spec.outputs.length;

  const expectedRun = runPlcOperations(
    reference.value.netlist,
    referenceProgram,
    problem.operations,
    { durationMs: problem.durationMs, outputCount },
  );
  const compareSignals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);
  const unknown = unknownCompareSignals(compareSignals, expectedRun.log);
  if (unknown.length > 0) return { ok: false, errors: unknown };

  const compiled = compile(traineeLadder);
  const ladderWarnings = compiled.warnings;
  const traineeNetlist = toNetlist(traineeSession, plcBoard);
  const sessionHazards = options.sessionHazards ?? [];
  const chartSignals = defaultChartSignals(compareSignals);
  const markers = plcTimerMarkers(referenceProgram);
  const expectedChart = buildTimeChart(
    expectedRun.log,
    chartSignals,
    problem.durationMs,
    markers,
  );

  if (!compiled.ok) {
    // 変換に落ちたラダーは実機にも書き込めない。シミュレートせず不合格にする（§10.6）。
    return {
      ok: true,
      value: {
        mode: 'plc',
        passed: false,
        mismatches: [],
        staticChecks: [],
        hazardCount: sessionHazards.length,
        hazardsByKind: countHazards(sessionHazards),
        chatter: [],
        ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
        // 実測波形は無い（走らせていない）ので空のチャートを返す
        charts: { expected: expectedChart, actual: { durationMs: problem.durationMs, signals: [], markers: [] } },
        compareSignals,
        ladderErrors: compiled.errors,
        ladderWarnings,
      },
    };
  }

  const actualRun = runPlcOperations(traineeNetlist, compiled.program, problem.operations, {
    durationMs: problem.durationMs,
    outputCount,
  });
  const mismatches = compareLogs(
    expectedRun.log,
    actualRun.log,
    compareSignals,
    problem.judge.tolerance,
  );
  const chatter = actualRun.events.chatters();
  const staticChecks = runStaticChecks(
    {
      session: traineeSession,
      netlist: traineeNetlist,
      log: actualRun.log,
      hazards: [...sessionHazards, ...actualRun.events.hazards()],
      chatters: chatter,
      allowedColors: [PLC_WIRE_COLOR],
      plc: { unit, io, roles: traineeSession.socketRoles },
    },
    problem.judge.staticChecks,
  );

  return {
    ok: true,
    value: {
      mode: 'plc',
      passed: mismatches.length === 0 && staticChecks.every((c) => c.ok),
      mismatches,
      staticChecks,
      hazardCount: sessionHazards.length,
      hazardsByKind: countHazards(sessionHazards),
      chatter: [...chatter],
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
      charts: {
        expected: expectedChart,
        actual: buildTimeChart(actualRun.log, chartSignals, problem.durationMs, markers),
      },
      compareSignals,
      ladderErrors: [],
      ladderWarnings,
    },
  };
}

/**
 * 課題の模範ラダー＋模範配線を、その課題自身の操作列で判定にかける（自己整合テスト）。§7.8 / §14.1 #30
 * 内蔵課題はこれが全件合格することをCIで保証する。
 */
export function judgePlcReference(problem: PlcProblem, board: BoardDefinition): JudgePlcOutcome {
  const reference = buildPlcReferenceSession(problem, board);
  if (!reference.ok) return reference;
  return judgePlc(problem, board, reference.value.session, problem.referenceLadder);
}
```

- [ ] **Step 4: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run test/judge-plc.test.ts
git add packages/content
git commit -m "feat(content): judge mode D by racing the reference ladder against the trainee"
```

Expected: `Tests  8 passed (8)`。

---
## Task 18: 内蔵モードD課題 前半4題（2級形式・入力3点／出力3点）

**Files:**
- Create: `packages/content/src/builtin/plc/d-001-self-hold.json`
- Create: `packages/content/src/builtin/plc/d-002-interlock.json`
- Create: `packages/content/src/builtin/plc/d-003-on-delay.json`
- Create: `packages/content/src/builtin/plc/d-004-one-shot.json`
- Modify: `packages/content/src/builtin/index.ts`
- Test: `packages/content/test/builtin-plc.test.ts`

§7.9 の「D（PLC）＝1級形式4題＋2級形式4題」の前半である。2級形式は**入力3点・出力3点**（調査資料 §1.1）で、`X0`=PB1（黒）・`X1`=PB2（黄）・`X2`=PB3（緑）、`Y0`→CR1→PL1（白）・`Y1`→CR2→PL2（黄）・`Y2`→CR3→PL3（緑）に固定する（§7.6 の既定割付）。題材は有接点のモードB課題（§7.9）と対応させ、同じ回路をPLCで組み直す構成にする。

**課題JSONの書き方（4題共通）:** ヘッダ・`plc`・`io`・`wiringRequired` は下の d-001 と同じで、変えるのは `id` / `title` / `description` / `referenceLadder` / `operations` / `durationMs` / `judge.compareSignals` だけである。セルのJSONと組み立てヘルパの対応は次のとおり:

| ラダーの部品 | JSON |
|---|---|
| `no(X(0))` | `{"kind":"contact","type":"NO","device":{"kind":"input","index":0}}` |
| `nc(X(1))` | `{"kind":"contact","type":"NC","device":{"kind":"input","index":1}}` |
| `rise(X(0))` | `{"kind":"contact","type":"P","device":{"kind":"input","index":0}}` |
| `no(M(0))` / `no(T(0))` / `no(C(0))` / `no(SP(2))` | `device.kind` を `internal` / `timer` / `counter` / `special` にする |
| `out(Y(0))` | `{"kind":"coil","type":"OUT","device":{"kind":"output","index":0}}` |
| `set(M(0))` / `rst(M(0))` | `"type"` を `SET` / `RST` にする |
| `ton(T(0), 3000)` | `{"kind":"timer","type":"TON","device":{"kind":"timer","index":0},"presetMs":3000}` |
| `ctu(C(0), 1, X(1))` | `{"kind":"counter","type":"CTU","device":{"kind":"counter","index":0},"preset":1,"resetDevice":{"kind":"input","index":1}}` |
| `vline()` / `hline()` | `{"kind":"vline"}` / `{"kind":"hline"}` |
| `end()` | `{"kind":"end"}`（`{"id":"end","cells":[[{"kind":"end"}]]}` のネットワークで置く） |

行の最後が出力セルなら**コイル列への送りと横線の穴埋めはスキーマが行う**（Task 11）。分岐（自己保持）は「上の行の分岐点に `vline`、下の行に分岐接点」と書く。

- [ ] **Step 1: d-001 を書く**

`packages/content/src/builtin/plc/d-001-self-hold.json`:

```json
{
  "formatVersion": 1,
  "id": "d-001",
  "mode": "plc",
  "title": "PLC 自己保持回路（2級形式）",
  "grade": 2,
  "description": "黒（X0）で運転を開始し、黄（X1）で停止する自己保持回路をPLCで組みます。運転中は白ランプ（PL1）が点灯し、停止中は黄ランプ（PL2）が点灯します。緑（X2）を押している間だけ緑ランプ（PL3）が点灯します。PLCの出力は必ず盤のリレーを介し、PLCの電源は壁コンセントから取ってください。",
  "timeLimit": { "standardMin": 50, "cutoffMin": 60 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S3": "CR3", "S4": "CR4", "S7": "CHK" }
  },
  "inventory": [{ "kind": "relay-my4n", "count": 4 }],
  "plc": { "vendor": "mitsubishi", "model": "FX5U" },
  "io": {
    "mode": "fixed",
    "wiring": "sink",
    "inputs": [
      { "x": 0, "pb": "PB1" },
      { "x": 1, "pb": "PB2" },
      { "x": 2, "pb": "PB3" }
    ],
    "outputs": [
      { "y": 0, "cr": "CR1", "pl": "PL1" },
      { "y": 1, "cr": "CR2", "pl": "PL2" },
      { "y": 2, "cr": "CR3", "pl": "PL3" }
    ]
  },
  "referenceLadder": {
    "networks": [
      {
        "id": "n1",
        "comment": "自己保持（X0で入り、X1で切れる）",
        "cells": [
          [
            { "kind": "contact", "type": "NO", "device": { "kind": "input", "index": 0 } },
            { "kind": "vline" },
            { "kind": "contact", "type": "NC", "device": { "kind": "input", "index": 1 } },
            { "kind": "coil", "type": "OUT", "device": { "kind": "output", "index": 0 } }
          ],
          [{ "kind": "contact", "type": "NO", "device": { "kind": "output", "index": 0 } }]
        ]
      },
      {
        "id": "n2",
        "comment": "停止中表示",
        "cells": [
          [
            { "kind": "contact", "type": "NC", "device": { "kind": "output", "index": 0 } },
            { "kind": "coil", "type": "OUT", "device": { "kind": "output", "index": 1 } }
          ]
        ]
      },
      {
        "id": "n3",
        "comment": "点検灯（押している間だけ）",
        "cells": [
          [
            { "kind": "contact", "type": "NO", "device": { "kind": "input", "index": 2 } },
            { "kind": "coil", "type": "OUT", "device": { "kind": "output", "index": 2 } }
          ]
        ]
      },
      { "id": "end", "cells": [[{ "kind": "end" }]] }
    ]
  },
  "wiringRequired": true,
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 2000, "target": "PB3", "action": "press" },
    { "t": 2300, "target": "PB3", "action": "release" },
    { "t": 4000, "target": "PB2", "action": "press" },
    { "t": 4300, "target": "PB2", "action": "release" }
  ],
  "durationMs": 6000,
  "judge": { "compareSignals": ["PL1", "PL2", "PL3"] }
}
```

- [ ] **Step 2: d-002〜d-004 を書く**

ヘッダは d-001 と同じ（`id` / `title` / `description` だけ変える）。`referenceLadder` と操作列は下表のとおり。

**d-002 `d-002-interlock.json`「PLC インターロック（2級形式）」（grade 2, durationMs 8000, compareSignals `PL1` `PL2` `PL3`）**

| ネットワーク | 行 | セル（左から） |
|---|---|---|
| `n1`（正転） | 0 | `no(X(0))`, `vline()`, `nc(X(2))`, `nc(Y(1))`, `out(Y(0))` |
| | 1 | `no(Y(0))` |
| `n2`（逆転） | 0 | `no(X(1))`, `vline()`, `nc(X(2))`, `nc(Y(0))`, `out(Y(1))` |
| | 1 | `no(Y(1))` |
| `n3`（停止中表示） | 0 | `nc(Y(0))`, `nc(Y(1))`, `out(Y(2))` |
| `end` | 0 | `end()` |

操作列: `PB1` press 500 / release 800（正転が入る）→ `PB2` press 2000 / release 2300（**入らない**＝インターロック）→ `PB3` press 4000 / release 4300（停止）→ `PB2` press 5500 / release 5800（今度は逆転が入る）。

**d-003 `d-003-on-delay.json`「PLC オンディレー点灯（2級形式）」（grade 2, durationMs 8000, compareSignals `PL1` `PL2` `PL3`）**

| ネットワーク | 行 | セル（左から） |
|---|---|---|
| `n1`（起動の自己保持） | 0 | `no(X(0))`, `vline()`, `nc(X(1))`, `out(M(0))` |
| | 1 | `no(M(0))` |
| `n2`（計時） | 0 | `no(M(0))`, `ton(T(0), 3000)` |
| `n3`（3秒後に点灯） | 0 | `no(T(0))`, `out(Y(0))` |
| `n4`（計時中表示） | 0 | `no(M(0))`, `nc(T(0))`, `out(Y(1))` |
| `n5`（点検灯） | 0 | `no(X(2))`, `out(Y(2))` |
| `end` | 0 | `end()` |

操作列: `PB1` press 500 / release 800 → `PB2` press 6000 / release 6300。期待: `PL2` が 500ms 付近で点いて 3500ms 付近で消え、同じ時刻に `PL1` が点く。

**d-004 `d-004-one-shot.json`「PLC ワンショット回路（2級形式）」（grade 2, durationMs 7000, compareSignals `PL1` `PL2` `PL3`）**

| ネットワーク | 行 | セル（左から） |
|---|---|---|
| `n1`（立上りで起動） | 0 | `rise(X(0))`, `set(M(0))` |
| `n2`（1秒計時） | 0 | `no(M(0))`, `ton(T(0), 1000)` |
| `n3`（タイムアップか停止で解除） | 0 | `no(T(0))`, `vline()`, `rst(M(0))` |
| | 1 | `no(X(1))` |
| `n4`（出力） | 0 | `no(M(0))`, `out(Y(0))` |
| `n5`（点検灯） | 0 | `no(X(2))`, `out(Y(1))` |
| `n6`（電源表示＝常時ON） | 0 | `no(SP(0))`, `out(Y(2))` |
| `end` | 0 | `end()` |

操作列: `PB1` press 500 / release 600（短押し）→ `PB1` press 3000 / release 5000（**長押ししても1秒で切れる**）→ `PB3` press 5500 / release 6000。

- [ ] **Step 3: 内蔵課題に登録する**

`packages/content/src/builtin/index.ts`:

```ts
import type { PlcProblem } from '../schema/plc.js';
import d001 from './plc/d-001-self-hold.json' with { type: 'json' };
import d002 from './plc/d-002-interlock.json' with { type: 'json' };
import d003 from './plc/d-003-on-delay.json' with { type: 'json' };
import d004 from './plc/d-004-one-shot.json' with { type: 'json' };
```

（Task 19 で d-005〜d-008 を足す。）

```ts
/** 内蔵のモードD課題のJSON。 */
const BUILTIN_PLC_JSON: readonly unknown[] = [d001, d002, d003, d004];

/** 内蔵のモードD課題（8題）。§7.9 */
export const BUILTIN_PLC_PROBLEMS: readonly PlcProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_PLC_JSON),
  isPlcProblem,
  'モードD課題',
);
```

`BUILTIN_ALL_PROBLEMS` に `...BUILTIN_PLC_PROBLEMS` を足す（並びは B → C1 → C2 → D）。

- [ ] **Step 4: 失敗するテストを書く**

`packages/content/test/builtin-plc.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLC_PROBLEMS } from '../src/builtin/index.js';
import { judgePlcReference } from '../src/judge-plc.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';
import { runPlcOperations } from '../src/plc-io.js';
import { buildTimeChart, defaultChartSignals, startsAndEndsLow } from '../src/timechart.js';
import { resolveCompareSignals } from '../src/schema/judge.js';

describe('内蔵モードD課題（§7.9）', () => {
  it('has the 2級 problems of Task 18', () => {
    expect(BUILTIN_PLC_PROBLEMS.map((p) => p.id)).toEqual(['d-001', 'd-002', 'd-003', 'd-004']);
    expect(BUILTIN_PLC_PROBLEMS.every((p) => p.plc.model === 'FX5U')).toBe(true);
    expect(BUILTIN_PLC_PROBLEMS.every((p) => p.wiringRequired)).toBe(true);
  });

  it('uses three inputs and three outputs in the 2級 form (調査資料 §1.1)', () => {
    for (const problem of BUILTIN_PLC_PROBLEMS.filter((p) => p.grade === 2)) {
      expect(problem.io.inputs).toHaveLength(3);
      expect(problem.io.outputs).toHaveLength(3);
    }
  });

  it.each(BUILTIN_PLC_PROBLEMS.map((p) => [p.id, p] as const))(
    '%s passes its own reference judgement (§7.8 / §14.1 #30)',
    (_id, problem) => {
      const judged = judgePlcReference(problem, JIPM_BOARD);
      expect(judged.ok).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.mismatches).toEqual([]);
      expect(judged.value.staticChecks.filter((c) => !c.ok)).toEqual([]);
      expect(judged.value.passed).toBe(true);
    },
  );

  it.each(BUILTIN_PLC_PROBLEMS.map((p) => [p.id, p] as const))(
    '%s starts and ends low on every compared signal (§7.3)',
    (_id, problem) => {
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const run = runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
        durationMs: problem.durationMs,
      });
      const signals = resolveCompareSignals(problem.judge, []);
      const chart = buildTimeChart(run.log, defaultChartSignals(signals), problem.durationMs, []);
      expect(startsAndEndsLow(chart)).toBe(true);
    },
  );

  it('actually drives every compared lamp at some point (課題として意味があること)', () => {
    for (const problem of BUILTIN_PLC_PROBLEMS) {
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      if (!built.ok) throw new Error(`${problem.id}: ${JSON.stringify(built.errors)}`);
      const run = runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
        durationMs: problem.durationMs,
      });
      for (const signal of resolveCompareSignals(problem.judge, [])) {
        const lit = run.log.transitions(signal).some((e) => e.value === true);
        expect(lit, `${problem.id} の ${signal} が一度も点灯しません`).toBe(true);
      }
    }
  });

  it('turns the on-delay lamp on 3 seconds after the start button (§10.4)', () => {
    const problem = BUILTIN_PLC_PROBLEMS.find((p) => p.id === 'd-003');
    if (problem === undefined) throw new Error('d-003 がありません');
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const run = runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
      durationMs: problem.durationMs,
    });
    const litMs = run.log.transitions('PL1').find((e) => e.value === true)?.tMs ?? -1;
    // 500ms に押す → 入力が1スキャン遅れて 510ms に M0 が入り、3000ms 計時して 3500ms に T0、
    // そこから盤のリレーの動作（1tick）とランプの点灯判定（1tick）で 3520ms に点く
    expect(litMs).toBeGreaterThanOrEqual(3500);
    expect(litMs).toBeLessThanOrEqual(3600);
  });

  it('keeps the one-shot output on for exactly 1 second even on a long press (d-004)', () => {
    const problem = BUILTIN_PLC_PROBLEMS.find((p) => p.id === 'd-004');
    if (problem === undefined) throw new Error('d-004 がありません');
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const run = runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
      durationMs: problem.durationMs,
    });
    const edges = run.log.transitions('PL1');
    const rises = edges.filter((e) => e.value === true).map((e) => e.tMs);
    const falls = edges.filter((e) => e.value === false && e.tMs > 0).map((e) => e.tMs);
    expect(rises).toHaveLength(2);
    // 入力は1スキャン遅れ、盤のリレーの動作・復帰に各1tick かかるので、点灯時間は
    // 設定1000ms ちょうどではなく 990ms 前後になる（§10.4 のスキャン＋§5.3.1 の動作時間）
    expect((falls[0] ?? 0) - (rises[0] ?? 0)).toBeGreaterThanOrEqual(950);
    expect((falls[0] ?? 0) - (rises[0] ?? 0)).toBeLessThanOrEqual(1050);
  });
});
```

- [ ] **Step 5: RED → GREEN**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-plc.test.ts
```

Expected（RED）: 課題JSONが無い／登録していない段で `BuiltinProblemError` か import エラー。

Expected（GREEN）: `Tests  11 passed (11)`（`it.each` の4題ぶんを含む）。**自己整合（3番目のテスト）が落ちる場合は課題データの誤り**である。よくある原因は、①ラダーの分岐で `vline` を下の行に置いた（上の行に置く。Task 1）②`io` の割付と `referenceLadder` のデバイス番号が食い違っている ③`durationMs` が最後の操作＋1tickより短い、の3つ。

- [ ] **Step 6: コミットする**

```powershell
npx prettier --check "packages/content/src/builtin/plc/*.json"
git add packages/content
git commit -m "feat(content): add the four 2級-form built-in PLC problems"
```

---

## Task 19: 内蔵モードD課題 後半4題（1級形式・入力3点／出力4点）と弁別テスト

**Files:**
- Create: `packages/content/src/builtin/plc/d-005-sequential.json`
- Create: `packages/content/src/builtin/plc/d-006-flicker.json`
- Create: `packages/content/src/builtin/plc/d-007-counter.json`
- Create: `packages/content/src/builtin/plc/d-008-stop-priority.json`
- Modify: `packages/content/src/builtin/index.ts`
- Test: `packages/content/test/builtin-plc-discrimination.test.ts`

1級形式は**入力3点・出力4点**（調査資料 §1.1）で、`Y3`→CR4→PL4（赤）が増える。`grade: 1`、`timeLimit` は `{standardMin: 50, cutoffMin: 60}`。§17.2 #8 のとおり**1題（d-007）はカウンタで「押した回数による順次動作」**にする。

**d-005 `d-005-sequential.json`「PLC 順次点灯（1級形式）」（durationMs 8000, compareSignals `PL1`〜`PL4`）**

| ネットワーク | 行 | セル（左から） |
|---|---|---|
| `n1`（起動の自己保持） | 0 | `no(X(0))`, `vline()`, `nc(X(1))`, `nc(X(2))`, `out(M(0))` |
| | 1 | `no(M(0))` |
| `n2` | 0 | `no(M(0))`, `ton(T(0), 1000)` |
| `n3` | 0 | `no(T(0))`, `ton(T(1), 1000)` |
| `n4` | 0 | `no(T(1))`, `ton(T(2), 1000)` |
| `n5` | 0 | `no(M(0))`, `out(Y(0))` |
| `n6` | 0 | `no(T(0))`, `out(Y(1))` |
| `n7` | 0 | `no(T(1))`, `out(Y(2))` |
| `n8` | 0 | `no(T(2))`, `out(Y(3))` |
| `end` | 0 | `end()` |

操作列: `PB1` press 500 / release 800 → `PB2` press 6000 / release 6300。期待: 500 / 1500 / 2500 / 3500ms 付近で順に点灯し、6000ms で全消灯。

**d-006 `d-006-flicker.json`「PLC フリッカ回路（1級形式）」（durationMs 7000, compareSignals `PL1`〜`PL4`）**

| ネットワーク | 行 | セル（左から） |
|---|---|---|
| `n1`（起動の自己保持） | 0 | `no(X(0))`, `vline()`, `nc(X(1))`, `out(M(0))` |
| | 1 | `no(M(0))` |
| `n2`（0.5秒） | 0 | `no(M(0))`, `nc(T(1))`, `ton(T(0), 500)` |
| `n3`（0.5秒） | 0 | `no(T(0))`, `ton(T(1), 500)` |
| `n4`（点滅） | 0 | `no(M(0))`, `no(T(0))`, `out(Y(0))` |
| `n5`（運転中表示） | 0 | `no(M(0))`, `out(Y(1))` |
| `n6`（1秒クロックの点滅） | 0 | `no(M(0))`, `no(SP(2))`, `out(Y(2))` |
| `n7`（停止中表示） | 0 | `nc(M(0))`, `no(X(2))`, `out(Y(3))` |
| `end` | 0 | `end()` |

操作列: `PB1` press 500 / release 800 → `PB2` press 5000 / release 5300 → `PB3` press 5600 / release 5900。**`SP2`（1秒クロック）はスキャン経過時刻で決まるので、模範と訓練者で必ず同じ波形になる**（§5.2 の決定論）。

**d-007 `d-007-counter.json`「PLC カウンタによる順次点灯（1級形式）」（durationMs 6000, compareSignals `PL1`〜`PL4`。§17.2 #8）**

| ネットワーク | 行 | セル（左から） |
|---|---|---|
| `n1` | 0 | `no(X(0))`, `ctu(C(0), 1, X(1))` |
| `n2` | 0 | `no(X(0))`, `ctu(C(1), 2, X(1))` |
| `n3` | 0 | `no(X(0))`, `ctu(C(2), 3, X(1))` |
| `n4` | 0 | `no(X(0))`, `ctu(C(3), 4, X(1))` |
| `n5`〜`n8` | 0 | `no(C(0))`→`out(Y(0))`／`no(C(1))`→`out(Y(1))`／`no(C(2))`→`out(Y(2))`／`no(C(3))`→`out(Y(3))` |
| `end` | 0 | `end()` |

操作列: `PB1` を 500 / 1200 / 1900 / 2600ms に press（各 200ms 後 release）→ `PB2` press 4500 / release 4800（リセット）。期待: 押すたびに点灯数が1つずつ増え、4回目で4点すべて点灯し、リセットで全消灯。

**d-008 `d-008-stop-priority.json`「PLC 停止優先と警報表示（1級形式）」（durationMs 8000, compareSignals `PL1`〜`PL4`）**

| ネットワーク | 行 | セル（左から） |
|---|---|---|
| `n1`（停止優先の自己保持） | 0 | `no(X(0))`, `vline()`, `nc(X(1))`, `out(Y(0))` |
| | 1 | `no(Y(0))` |
| `n2`（警報のセット） | 0 | `no(X(2))`, `set(Y(3))` |
| `n3`（警報の解除） | 0 | `no(X(1))`, `rst(Y(3))` |
| `n4`（運転中・正常表示） | 0 | `no(Y(0))`, `nc(Y(3))`, `out(Y(2))` |
| `n5`（運転中・警報表示） | 0 | `no(Y(0))`, `no(Y(3))`, `out(Y(1))` |
| `end` | 0 | `end()` |

操作列: `PB1` press 500 / release 800（運転）→ `PB3` press 2000 / release 2300（警報）→ `PB2` press 3500 / release 3800（停止＋警報解除）→ `PB1` press 5000・`PB2` press 5000（**同時押し**）/ 両方 release 5300（停止が優先し運転しない）。

**注意（`compareSignals` と §7.3 の始点・終点）:** 表示灯の条件はすべて「運転中かつ…」にしてある。`nc(Y(3))` だけの回路にすると**開始直後から点灯している**ことになり、§7.3 の「タイムチャートの始まりと終わりは論理0」に反して自己整合テスト（`startsAndEndsLow`）で落ちる。内蔵課題を増やすときも、比較信号は判定区間の始点・終点で必ず消えている条件にすること。

- [ ] **Step 1: 4題のJSONを書き、`builtin/index.ts` に登録する**

`BUILTIN_PLC_JSON` を8件にし、テストの期待値を `['d-001' … 'd-008']` に伸ばす。`BUILTIN_ALL_PROBLEMS` は 20 + 8 = **28題**になる。

- [ ] **Step 2: 弁別テストを書く**

`packages/content/test/builtin-plc-discrimination.test.ts`:

```ts
import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import type { LadderProgram } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLC_PROBLEMS } from '../src/builtin/index.js';
import { judgePlc } from '../src/judge-plc.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';

function t(id: string): TerminalId {
  return id as TerminalId;
}

/** 模範ラダーの最初の接点をa接点⇔b接点に入れ替えた「惜しい」ラダーを作る。 */
function flipFirstContact(ladder: LadderProgram): LadderProgram {
  const copy = structuredClone(ladder);
  for (const net of copy.networks) {
    for (const row of net.cells) {
      for (const cell of row) {
        if (cell.kind !== 'contact') continue;
        cell.type = cell.type === 'NO' ? 'NC' : 'NO';
        return copy;
      }
    }
  }
  throw new Error('接点が1つもありません');
}

const CASES = BUILTIN_PLC_PROBLEMS.map((problem) => [problem.id, problem] as const);

describe('内蔵モードD課題の弁別（§16 Phase 3 の受入基準）', () => {
  it.each(CASES)('%s: 正しいラダーと正しい配線なら合格する', (_id, problem) => {
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const judged = judgePlc(problem, JIPM_BOARD, built.value.session, problem.referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(true);
  });

  it.each(CASES)('%s: 接点を1つ裏返したラダーでは不合格になる', (_id, problem) => {
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const judged = judgePlc(
      problem,
      JIPM_BOARD,
      built.value.session,
      flipFirstContact(problem.referenceLadder),
    );
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
  });

  it.each(CASES)('%s: Y0 をランプへ直結すると twoStage で落ちる（受入基準④）', (_id, problem) => {
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const { session, board } = built.value;
    const coil = session.wires.find((w) => String(w.from) === 'PLC.Y0');
    expect(removeWire(session, coil?.id ?? '').ok).toBe(true);
    const lamp = session.wires.find((w) => String(w.to) === 'TB_PL.1+');
    expect(removeWire(session, lamp?.id ?? '').ok).toBe(true);
    expect(addWire(session, board, t('PLC.Y0'), t('TB_PL.1+')).ok).toBe(true);
    const judged = judgePlc(problem, JIPM_BOARD, session, problem.referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'twoStage')?.ok).toBe(false);
    expect(judged.value.passed).toBe(false);
  });

  it.each(CASES)('%s: PLC電源を盤から取ると plcPowerIndependent で落ちる（受入基準⑤）', (_id, problem) => {
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const { session, board, io } = built.value;
    const wire = session.wires.find((w) => String(w.to) === 'PLC.L');
    expect(removeWire(session, wire?.id ?? '').ok).toBe(true);
    // 鎖の末端（3点課題なら CR3.9、1級の4点課題なら CR4.9）だけが1本空いている（§6.6）
    expect(addWire(session, board, t(`${io.outputs.at(-1)?.cr ?? 'CR3'}.9`), t('PLC.L')).ok).toBe(
      true,
    );
    const judged = judgePlc(problem, JIPM_BOARD, session, problem.referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'plcPowerIndependent')?.ok).toBe(false);
  });

  it('入力を別の押ボタンへ配線すると ioAssignment で落ちる（§7.4）', () => {
    const problem = BUILTIN_PLC_PROBLEMS[0];
    if (problem === undefined) throw new Error('課題がありません');
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const { session, board } = built.value;
    const wire = session.wires.find((w) => String(w.to) === 'PLC.X0');
    expect(removeWire(session, wire?.id ?? '').ok).toBe(true);
    // PB1 のa接点ではなく PB4（チェック用回路の押ボタン。§6.3）のa接点へ繋ぐ
    expect(addWire(session, board, t('TB_PB.4a'), t('PLC.X0')).ok).toBe(true);
    const judged = judgePlc(problem, JIPM_BOARD, session, problem.referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'ioAssignment')?.ok).toBe(false);
  });
});
```

- [ ] **Step 3: RED → GREEN**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-plc.test.ts test/builtin-plc-discrimination.test.ts
```

Expected: `builtin-plc` は8題ぶんに増えて `Tests  19 passed (19)`、弁別テストは `Tests  33 passed (33)`（`it.each` 8題 × 4件 ＋ 1件）。

**実行時間の注意:** 1件の判定は模範と訓練者の2回ぶんを10ms tick で最後まで回すので、`durationMs: 8000` の課題では1件あたり数百msかかる。弁別テストは 33 件あるので合計で数十秒になる。`packages/content/vitest.config.ts` の `testTimeout` は既に 180 秒なので設定変更は不要だが、**カバレッジ計測込みだとさらに数倍になる**ことを見込むこと（Plan 2A の C2 弁別テストと同じ事情）。

- [ ] **Step 4: コミットする**

```powershell
npx prettier --check "packages/content/src/builtin/plc/*.json"
git add packages/content
git commit -m "feat(content): add the four 1級-form built-in PLC problems and the discrimination tests"
```

---

## Task 20: 公開APIの確定と全体検証

**Files:**
- Modify: `packages/content/src/index.ts`
- Modify: `packages/ladder-core/src/index.ts` / `packages/plc-dialects/src/index.ts`（漏れの補完）
- Test: `packages/content/test/index.test.ts`（バレルの網羅）

Plan 3B が使う公開APIを固定し（下の「3B への引き渡し」表と一致させる）、全体検証を行う。

- [ ] **Step 1: `@ojt/content` のバレルに Phase 3 の公開名を足す**

```ts
export {
  CellSchema,
  DeviceKindSchema,
  DeviceSchema,
  LADDER_COIL_COL,
  LadderNetworkSchema,
  LadderProgramSchema,
  type CellData,
  type DeviceData,
} from './schema/ladder.js';

export {
  DEFAULT_PLC_IO,
  PHASE3_MODELS,
  PLC_MODELS,
  PLC_VENDORS,
  PlcInputMapSchema,
  PlcIoModeSchema,
  PlcIoSchema,
  PlcOutputMapSchema,
  PlcProblemSchema,
  PlcRefSchema,
  PlcWiringSchema,
  resolvePlcIo,
  type PlcInputMapData,
  type PlcIoData,
  type PlcOutputMapData,
  type PlcProblem,
  type ResolvedPlcIo,
} from './schema/plc.js';

export {
  PLC_DEFAULT_STATIC_CHECKS,
  PlcJudgeSettingsSchema,
} from './schema/judge.js';

export {
  createPlcCoupling,
  createSimulationIoPort,
  runPlcOperations,
  type PlcCoupling,
  type PlcCouplingOptions,
  type PlcRunOptions,
  type PlcRunResult,
} from './plc-io.js';

export {
  buildPlcReferenceSession,
  PLC_WIRE_COLOR,
  plcBoardFor,
  plcWiringPlan,
  type PlcReferenceCircuit,
  type PlcReferenceResult,
  type PlcWireSpec,
} from './plc-reference.js';

export {
  BOARD_POWER_PREFIXES,
  checkIoAssignment,
  checkPlcPowerIndependent,
  checkTwoStage,
  detectPlcWiring,
  type PlcCheckContext,
} from './plc-static-checks.js';

export {
  judgePlc,
  judgePlcReference,
  plcTimerMarkers,
  type JudgePlcOutcome,
  type JudgePlcResult,
} from './judge-plc.js';

export { runOperationsOn } from './runner.js';

export { BUILTIN_PLC_PROBLEMS } from './builtin/index.js';

export { isPlcProblem } from './schema/index.js';
```

- [ ] **Step 2: バレルの網羅テストを更新する**

`packages/content/test/index.test.ts` に、上で足した名前が `undefined` でないことを確かめる節を足す（既存のテストと同じ書き方に合わせる）。加えて:

```ts
it('内蔵課題は28題（モードB 8 / C1 4 / C2 8 / D 8）', () => {
  expect(BUILTIN_ALL_PROBLEMS).toHaveLength(28);
  expect(BUILTIN_PLC_PROBLEMS).toHaveLength(8);
});
```

- [ ] **Step 3: 全体検証を走らせる**

```powershell
pnpm -r test
pnpm -r typecheck
pnpm lint
npx prettier --check "packages/**/*.{ts,json}" "docs/superpowers/plans/*.md"
pnpm --filter @ojt/ladder-core exec vitest run --coverage
pnpm --filter @ojt/plc-dialects exec vitest run --coverage
pnpm --filter @ojt/circuit-sim exec vitest run --coverage
pnpm --filter @ojt/content exec vitest run --coverage
pnpm --filter @ojt/content schema:write
git diff --stat packages/content/schema/task.schema.json
```

Expected:
- `pnpm -r test` が7プロジェクト（`circuit-sim` / `board-model` / `schematic-core` / `content` / `ladder-core` / `plc-dialects` / `desktop`）すべて通る。
- `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` 込み）が無警告。
- カバレッジは4パッケージとも lines / statements / functions / branches 90%以上（§14.2）。
- `schema:write` を流しても差分が出ない（Task 13 で生成済み）。

- [ ] **Step 4: 依存関係が §4.2 のとおりであることを確かめる**

```powershell
git grep -n "@ojt/" packages/ladder-core/src packages/plc-dialects/src packages/circuit-sim/src
```

Expected:
- `packages/ladder-core/src` には `@ojt/` の import が**1件も無い**（依存ゼロ）。
- `packages/plc-dialects/src` は `@ojt/ladder-core` のみ。
- `packages/circuit-sim/src` には `@ojt/` の import が**1件も無い**（`board-model` も `ladder-core` も知らない）。
- `packages/content/src` は `@ojt/board-model` / `@ojt/circuit-sim` / `@ojt/schematic-core` / `@ojt/ladder-core`（**`@ojt/plc-dialects` は無い**。決定表#7）。

- [ ] **Step 5: コミットする**

```powershell
git add packages
git commit -m "feat(content): finalise the Phase 3A public API"
```

---
## タスクと仕様節の対応

| タスク | 主に実装する仕様節 |
|---|---|
| Task 1 | §10.3（ラダーIRの型とグリッド）、§4.1（`packages/ladder-core` の役割） |
| Task 2 | §10.3（END・コイル列・MC/MCR）、§10.4（二重コイルの警告）、§10.6（「変換」の構造検査） |
| Task 3 | §10.4（スキャン・タイマ・カウンタ・SET/RST・二重コイルの後勝ち・決定論）、§10.3（特殊デバイス）、§4.2（`PlcIoPort`） |
| Task 4 | §14.1 #26・#27、§7.9（内蔵モードD課題が使うラダー）、§14.2（カバレッジ） |
| Task 5 | §4.4（PLC要素のネットリスト表現）、§5.1.3（PLC入力の抵抗）、§10.1（端子集合） |
| Task 6 | §5.1.3（ON/OFF判定とヒステリシス）、§10.2（シンク・ソース両対応）、§5.7（信号ログ） |
| Task 7 | §10.1（FX5U の3D構成・端子・壁コンセント）、§6.4（端子ID）、§6.6（経路生成の不変条件）、§17 #11 |
| Task 8 | §10.5（`DialectProfile`）、§10.6（スキン定義の型）、§17.1（前提の区分） |
| Task 9 | §10.5（デバイス体系とタイマ単位）、§14.1 #25、§17 #20・#22 |
| Task 10 | §10.5（固有バリデーション）、§10.6（GX Works3風スキン・変換）、§17.1・§17 #19 |
| Task 11 | §7.6（`referenceLadder`）、§10.3（IRの入力形式）、§4.5（zodが定義の源） |
| Task 12 | §7.6（`plc` / `io` / `wiringRequired`）、§7.4（静的チェックの追加3件）、§13 #2 |
| Task 13 | §7.1・§7.8（課題の判別と読込）、§16（開始できるモード）、§13 #1 |
| Task 14 | §10.2（配線ルール）、§11.3（渡り配線）、§7.2（模範回路）、§6.3（既設配線との共存） |
| Task 15 | §10.4（スキャンと tick の同期）、§7.3（操作列の再生）、§4.2（依存方向） |
| Task 16 | §7.4（`twoStage` / `plcPowerIndependent` / `ioAssignment`）、§10.2、§10.8 |
| Task 17 | §10.8（判定）、§7.4（合否の考え方）、§7.7（タイムチャート）、§8.3（結果画面の材料） |
| Task 18 | §7.9（モードD 2級形式4題）、§7.6（既定割付）、§7.8（自己整合） |
| Task 19 | §7.9（モードD 1級形式4題）、§17.2 #8（カウンタ課題）、§16（受入基準④⑤） |
| Task 20 | §4.1（公開API）、§4.2（依存方向）、§14.2（カバレッジ）、§14.3（CI） |

---

## 仕様との対応表（完了判定に使う）

| 仕様 | 要件 | 実装 | 検証 |
|---|---|---|---|
| §4.1 | `packages/ladder-core` は `LadderProgram` / `compile()` / `createPlcRuntime()` を公開する | `packages/ladder-core/src/index.ts` | `test/ir.test.ts` / `test/compile.test.ts` / `test/runtime.test.ts` |
| §4.1 | `packages/plc-dialects` は `getDialect(vendor)` / `DialectProfile` を公開する | `packages/plc-dialects/src/index.ts` | `test/profile.test.ts` |
| §4.2 | `ladder-core` は `circuit-sim` と独立（接続は `PlcIoPort`） | `runtime.ts` の `PlcIoPort`、結合は `content/src/plc-io.ts` | Task 20 Step 4（`git grep` で依存ゼロを確認） |
| §4.2 | `plc-dialects` → `ladder-core` の一方向 | `package.json` の依存と import | Task 20 Step 4 / `pnpm lint`（`import-x/no-cycle`） |
| §4.4 | 入力 Xn は `PLC.SS`–`PLC.Xn` 間の抵抗、3mA以上でON・1.5mA以下でOFF・間はヒステリシス | `circuit-sim/src/plc.ts` ＋ `Simulation.updatePlcInputs()` | `test/plc-part.test.ts` / `test/plc-simulation.test.ts` |
| §4.4 | 出力 Yn は `PLC.Yn`–`PLC.COMg` 間の接点をランタイムが駆動 | `createPlcUnit()`（`driver: 'external'`）＋ `setPlcOutputs()` | `test/plc-simulation.test.ts` |
| §4.4 | PLC電源 L/N は電気的に解かず接続の有無だけを見る | 要素を持たない端子 ＋ `checkPlcPowerIndependent()` | `test/plc-part.test.ts` / `test/plc-static-checks.test.ts` |
| §5.1.3 | FX5U の入力は 4.5kΩ／ON 3.5mA以上／OFF 1.5mA以下 | `FX5U_SPEC`（board-model） | `test/plc-unit.test.ts` / `test/plc-simulation.test.ts`（実測 5.33mA） |
| §5.2 | 決定論（同じ入力列から同じ結果） | 乱数を使わないランタイムと結合 | `test/runtime.test.ts` / `test/plc-io.test.ts` |
| §5.7 | PLC入出力端子の状態を信号ログに残す | `Simulation.snapshot()` の `PLC.X0` / `PLC.Y0` / `PLC.X0.mA` | `test/plc-simulation.test.ts` |
| §7.4 | `twoStage`（2段結線） | `checkTwoStage()` | `test/plc-static-checks.test.ts` / `test/builtin-plc-discrimination.test.ts` |
| §7.4 | `plcPowerIndependent`（PLC電源の独立） | `checkPlcPowerIndependent()` | 同上 |
| §7.4 | `ioAssignment`（`fixed` のとき割付どおり） | `checkIoAssignment()` | 同上 |
| §7.4 | 合格＝動作一致かつ有効な静的チェックにエラー無し | `judgePlc()` の `passed` | `test/judge-plc.test.ts` |
| §7.6 | `plc` / `io` / `referenceLadder` / `wiringRequired` | `schema/plc.ts` | `test/schema-plc.test.ts` |
| §7.6 | 既定I/O割付（X0=PB1 … Y3=CR4→PL4） | `DEFAULT_PLC_IO` / `resolvePlcIo()` | `test/schema-plc.test.ts` |
| §7.6 | 1級は入力3・出力4、2級は入力3・出力3 | 内蔵課題8題の `io` | `test/builtin-plc.test.ts` |
| §7.7 | タイムチャートは模範のシミュレーション結果から生成、印はタイマ設定値から | `judgePlc()` の `charts` ＋ `plcTimerMarkers()` | `test/judge-plc.test.ts` |
| §7.8 | zod検証・内蔵課題の自己整合 | `parseProblem()` の4分岐、`judgePlcReference()` | `test/schema-index.test.ts` / `test/builtin-plc.test.ts` |
| §7.9 | モードD 8題（1級形式4＋2級形式4） | `src/builtin/plc/d-001`〜`d-008` | `test/builtin-plc.test.ts` |
| §10.1 | FX5U の端子集合（電源・S/S・24V/0V・X0〜X17・COM・Y0〜Y17）と外形 | `PLC_UNIT_FX5U` / `FX5U_SPEC` | `test/plc-unit.test.ts` |
| §10.1 | 壁コンセント（AC100V）オブジェクト | `OUTLET_TERMINALS` ＋ `toNetlist()` | `test/plc-unit.test.ts` / `test/plc-netlist.test.ts` |
| §10.1 | 盤の `P/N/CB/SW/PS` から PLC電源へ配線すると違反 | `checkPlcPowerIndependent()` | `test/plc-static-checks.test.ts` |
| §10.2 | 入力はPB端子台 → X、コモンはシンク／ソースどちらでもよい | `plcWiringPlan()` ＋ 電流の絶対値判定 | `test/plc-reference.test.ts` / `test/plc-simulation.test.ts` |
| §10.2 | 出力は Y → CRコイル → CRのa接点 → ランプ端子台の2段結線 | `plcWiringPlan()` ＋ `checkTwoStage()` | `test/plc-reference.test.ts` / `test/plc-static-checks.test.ts` |
| §10.2 | 線色は青 | `PLC_WIRE_COLOR` ＋ `session.allowedColors` | `test/plc-reference.test.ts` |
| §10.3 | IRの形（ネットワーク・16列・接点4種・コイル3種・TON・CTU・MC/MCR・END・特殊デバイス3種） | `ir.ts` | `test/ir.test.ts` |
| §10.4 | スキャン周期10ms・実行順・タイマ・カウンタ・SET/RST・二重コイル後勝ち・決定論 | `runtime.ts` ＋ `plc-io.ts` | `test/runtime.test.ts` / `test/golden-ladder.test.ts` / `test/plc-io.test.ts` |
| §10.5 | `DialectProfile` の全項目 | `profile.ts` ＋ `mitsubishi.ts` | `test/profile.test.ts` / `test/mitsubishi-*.test.ts` / `test/skin.test.ts` |
| §10.5 | 三菱のデバイス体系（X/Y 8進、M/T/C 10進、特殊リレー） | `MITSUBISHI_FX5U.formatDevice` / `parseDevice` | `test/mitsubishi-devices.test.ts` |
| §10.5 | タイマ単位（既定100ms／T200〜10ms／T256〜1ms） | `TIMER_BASE_MS()` / `timerPreset()` | `test/mitsubishi-devices.test.ts`（#25） |
| §10.6 | GX Works3風スキン（F5/F7/F4・11列・青・`convertStep: true`） | `SHORTCUTS` / `gridCols` / `monitorColors` / `convertStep` | `test/skin.test.ts` |
| §10.6 | 「変換」＝構造検査＋方言検査 | `convert()` | `test/convert.test.ts` |
| §10.8 | 訓練者と模範を並走比較し静的チェックを添える | `judgePlc()` | `test/judge-plc.test.ts` / `test/builtin-plc-discrimination.test.ts` |
| §11.3 | 母線は渡り配線で分配（1端子2本以内） | `plcWiringPlan()` の `chain()` | `test/plc-reference.test.ts` |
| §13 #1 | 読込エラーは理由（zodのパスと日本語メッセージ）付き | `parseProblem()`（モードDを含む4分岐） | `test/schema-index.test.ts` |
| §13 #2 | 課題データの誤りは「模範回路エラー」として返しアプリを落とさない | `buildPlcReferenceSession()` / `judgePlc()` の `ok: false` | `test/plc-reference.test.ts` / `test/judge-plc.test.ts` |
| §14.1 #25 | 三菱 `T0 K100`=10s、`T200 K100`=1s | `timerPreset()` / `parseTimerPreset()` | `test/mitsubishi-devices.test.ts` |
| §14.1 #26 | 二重コイルは警告が出て後勝ちで実行される | `compile()` の警告 ＋ ランタイムの上書き | `test/golden-ladder.test.ts` |
| §14.1 #27 | 特殊デバイス（常時ON・初期パルス・1秒クロック） | `Runtime.bit()` | `test/golden-ladder.test.ts` |
| §14.1 #28 | 方言バリデータ（三菱の8進拒否・範囲外・タイマ単位） | `MITSUBISHI_FX5U.validate()` / `parseDevice()` | `test/mitsubishi-validate.test.ts` / `test/mitsubishi-devices.test.ts`（TOYOPUC の重複禁止は Phase 4） |
| §14.1 #30 | 内蔵課題を模範回路で判定して合格する | `judgePlcReference()` | `test/builtin-plc.test.ts` |
| §14.2 | `ladder-core` は Phase 3 以降カバレッジ90% | `vitest.config.ts` の閾値 | Task 20 Step 3 |
| §16 Phase 3 ① | GX Works3風スキンで F5/F7 を使いラダーを組み「変換」が通る | `SHORTCUTS`（F5/F7/F4）＋ `convert()`（UIは Plan 3B） | `test/skin.test.ts` / `test/convert.test.ts` |
| §16 Phase 3 ② | PB端子台→X0、Y0→CR1コイル、CR1のa接点→PL1、PLC電源→壁コンセント | `plcWiringPlan()`（模範）＋ `addWire()`（訓練者。3Dは 3B） | `test/plc-reference.test.ts` / `test/plc-netlist.test.ts` |
| §16 Phase 3 ③ | 判定で合格する | `judgePlc()` | `test/builtin-plc-discrimination.test.ts`（8題） |
| §16 Phase 3 ④ | Y0→PL1 直結は `twoStage` エラー | `checkTwoStage()` | `test/builtin-plc-discrimination.test.ts`（8題） |
| §16 Phase 3 ⑤ | PLC電源を盤から取ると `plcPowerIndependent` エラー | `checkPlcPowerIndependent()` | `test/builtin-plc-discrimination.test.ts`（8題） |
| §17.1 | 未確認の命令名・キー割当は前提として実装し、修正箇所は方言プロファイル／スキン定義に閉じる | `mitsubishi.ts` の1ファイル ＋ `ShortcutEntry.confirmed` | `test/skin.test.ts` |
| §17 #11 | 端子の並び順は §10.1 の記載順 | `fx5uTerminals()` | `test/plc-unit.test.ts` |
| §17.2 #8 | 1級の1題はカウンタで押した回数による順次動作 | `d-007-counter.json` | `test/builtin-plc.test.ts` |
| §17.2 #9 | 既定I/O割付は本アプリの既定、`fixed` のときだけ強制 | `DEFAULT_PLC_IO` ＋ `checkIoAssignment()` | `test/schema-plc.test.ts` / `test/plc-static-checks.test.ts` |

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本プランの実装 | 理由 |
|---|---|---|---|
| 1 | §10.5 の `timerPreset(ms: number)` は ms だけを取る | `timerPreset(ms, device)` と `parseTimerPreset(text, device)` にデバイスを渡す | 三菱は**番号帯で時間単位が変わる**（`T0`=100ms／`T200`=10ms）。デバイスが無いと `K` 値を決められない。§14.1 #25 の期待値（`T200 K100`=1s）はこの引数が無いと表現できない |
| 2 | §10.3 は `Device = {kind, index}` としか書いていない | `index` は**0起点の通し番号**と定め、8進・16進はすべて方言の表示上の話にした | §10.5 が「方言＝デバイス表記の差分」と定義している。IRに8進の桁を入れると Phase 4 の16進（TOYOPUC `1X000`）でIRを触ることになり §17.1 の「修正箇所は方言プロファイルのみ」が崩れる |
| 3 | §10.3 は `vline` の意味を定義していない | `vline` は「セルの左辺で下の行と繋ぐ渡り」で、**横線としても導通する**と定めた | 分岐（自己保持・OR）を1つの規則で書けるようにするため。分岐は「上の行の分岐点に `vline`、下の行に分岐接点」と書く。3B のエディタもこの規則で縦線を置く |
| 4 | §10.3 はIRを16列と定めるだけ | 課題JSONでは**行の最後が出力セルならコイル列へ送り、手前を横線で埋める** | 課題JSONに横線を12個並べさせないため。実機のラダーでもコイルは必ず右母線に付くので、意味は変わらない |
| 5 | §7.2 の模範回路は「回路図（SchematicDoc）」 | モードDの模範回路は**I/O割付から生成**する（`plc-reference.ts`）。回路図は持たない | PLCの端子は §11.1 の回路図の要素一覧に無い。§7.6 もモードDには `referenceLadder` しか要求していない |
| 6 | §10.2 は「シンク結線／ソース結線のどちらでもよい」 | 課題データに `io.wiring`（既定 `sink`）を足し、`ioAssignment` で指定どおりかを見る | 模範配線を生成するには「どちらで組むか」を決める必要がある。自由にしたい課題は `io.mode: 'free'` にすれば `ioAssignment` は常にOKになる |
| 7 | §10.1 の違反検出は「盤からPLC電源を取ったらエラー」だけ | `plcPowerIndependent` は**壁コンセントに繋がっていない場合もエラー**にした | §16 Phase 3 の受入基準②が「PLC電源を壁コンセントへ配線する」ことを求めている。未配線を合格にすると、配線しないほうが有利になってしまう |
| 8 | §10.8 は判定項目に「方言バリデータ」を挙げている | 判定（`judgePlc`）は方言を見ない。方言バリデータは「変換」（`convert()`、Plan 3B のボタン）で走らせる | §4.2 の依存グラフに `content → plc-dialects` の辺が無い。同じIRはどの方言でも同じ動作をするので、判定に方言は要らない。変換を通っていないラダーは書き込めない＝判定に出せない、という実機の手順とも合う |
| 9 | §10.8 は判定項目に「未使用デバイス」を挙げている | `CompiledProgram.usage`（読んだ／書いたデバイスの一覧）として公開し、**合否には使わない** | IRには「デバイスの宣言」という概念が無いので、「宣言したが使っていない」を判定できない。3B の出力ウィンドウが `usage` を使って表示する |
| 10 | §10.4 の二重コイルは「変換時に警告」 | 警告は `compile()` の戻り値に載せ、静的チェックの項目にはしない（合否に影響しない） | §7.4 の静的チェック一覧に二重コイルは無い。実行は後勝ちで通るので、警告として結果画面に出すのが仕様どおり |
| 11 | §13 #1 の読込エラーに `unsupported-mode` がある | `UNSUPPORTED_MODES` を空にし、この理由は**発行されなくなる**（型からは消さない） | Phase 3 で4モードすべてが開始できる（§16）。型を消すと Plan 2B の UI 分岐が壊れるので値だけを使わなくする |
| 12 | §6.6 の経路生成は「盤上の全電線」 | 机上（PLC・壁コンセント）に繋がる電線は `routeSession()` から外し、`deskWires()` で別に返す | 盤面の配線帯は机上まで伸びていない。経路器にかけると帯・レーン・占有矩形の不変条件（Plan 1B のテスト）が壊れる。3D は直線ケーブルとして描く（Plan 3B） |
| 13 | §10.1 は FX5U の COM を「`COM0`, `COM1`, … を仕切り線で区切る」とだけ書く | **4点1コモン**（`COM0`→`Y0`〜`Y3` …）を本アプリの前提とした | 一次資料が未確認のため §17.1 の前提方針で決めた。修正箇所は盤モデル（`FX5U_SPEC`）のみ。内蔵課題は `Y0`〜`Y3` しか使わないので、分け方が変わっても課題データは無変更 |
| 14 | 実機のラダーは「逆流」（右から左への通電）を認めない | union-find で連結性だけを見るので、縦線の組み方によっては逆流する回路も通る | 逆流の検出には有向グラフとブロック解析が要り、教材としての価値に対して実装が重い。GX Works3 は変換時に弾くので、実機と差が出る場面は「わざと逆流する回路を書いたとき」に限られる。Phase 4 以降で必要になったら `compile()` に検査を足す（IRもランタイムも変えずに済む） |
| 15 | §10.1 は FX5U に `24V` / `0V` のサービス電源端子があるとする | 端子は作るが**電気的には解かない** | 本アプリの課題は入力回路のDC24Vを盤から取る（§10.2 が明示的に認めている）。内蔵電源を解くと `S/S`–`24V` 短絡の扱いなど、教育目的に寄与しない分岐が増える |
| 16 | §8.4 は級ごとの回路図ヒントを定める | モードD課題は `hints` フィールドを持たない（`grade` は1・2のみ） | モードDに展開接続図は無い。1級・2級ともタイムチャートから起こすので、ヒントの開閉という状態が存在しない |
| 17 | §16 Phase 3 は「モードD（三菱のみ）が動くアプリ」 | 本プラン（3A）はライブラリまで。スキン画面・3D・モードDのセッション画面・E2Eは Plan 3B | 依頼による分割。3A の公開APIは下の「3B への引き渡し」に固定する |

---

## 3B への引き渡し（Plan 3B が使う公開API）

Plan 3B（`apps/desktop` のGX Works3風スキン・3D・モードD画面）は下記だけを使う。これ以外の内部関数に依存してはならない。

**`@ojt/ladder-core`（IR・変換・ランタイム）:**

| API | 用途 |
|---|---|
| `IR_COLS`(16) / `COIL_COL`(15) / `MAX_ROWS`(12) | エディタのグリッド寸法（表示列数は `DialectProfile.gridCols`、IRは常に16列） |
| `network(id, rows, options?)` / `program(...networks)` / `endNetwork(id?)` / `cellAt(net, row, col)` | エディタがIRを組み立て・読み出しする |
| `no(d)` / `nc(d)` / `rise(d)` / `fall(d)` / `out(d)` / `set(d)` / `rst(d)` / `ton(d, presetMs)` / `ctu(d, preset, resetDevice)` / `mc(d)` / `mcr(d)` / `end()` / `hline()` / `vline()` / `empty()` | F5/F6/F7 などのキー操作が置くセル |
| `X(i)` / `Y(i)` / `M(i)` / `T(i)` / `C(i)` / `SP(i)` / `device(kind, index)` | デバイス入力欄 → IR |
| `SPECIAL_ALWAYS_ON`(0) / `SPECIAL_FIRST_SCAN`(1) / `SPECIAL_CLOCK_1S`(2) / `SPECIAL_INDEXES` | 特殊デバイスの選択肢 |
| `deviceLabel(d)` / `deviceKey(d)` / `sameDevice(a, b)` / `isOutputCell(cell)` | 表示・比較・配置の可否 |
| `compile(program)` → `CompileResult` | 「変換」の構造検査（`ok` / `errors` / `warnings` / `program`） |
| `CompiledProgram.usage`（`reads` / `writes`）/ `inputCount` / `outputCount` | 出力ウィンドウの「使用デバイス一覧」（§10.8 の未使用デバイス表示） |
| `createPlcRuntime(program, {io, scanMs?, outputCount?})` → `PlcRuntime` | モニタ（`F3`）で使う。`scan()` / `reset()` / `bit(device)` / `state()` / `tMs` / `scanCount` |
| `PlcIoPort` / `PlcSnapshot` / `PlcTimerState` / `PlcCounterState` / `SCAN_MS`(10) | Worker プロトコルの型付けとモニタ表示 |
| `LadderError` / `CompileError` / `CompileWarning` / `CompileErrorCode` | エラー表示の型 |
| 型: `Cell` / `Device` / `DeviceKind` / `ContactType` / `CoilType` / `Network` / `LadderProgram` / `OutputCell` | 全面的に使う |

**`@ojt/plc-dialects`（方言とスキン）:**

| API | 用途 |
|---|---|
| `getDialect('mitsubishi')` → `DialectProfile` / `availableDialects()` / `DIALECT_IDS` / `IMPLEMENTED_DIALECT_IDS` / `isDialectId(s)` | 設定画面のメーカー選択（Phase 3 は三菱のみ実装） |
| `MITSUBISHI_FX5U` | 既定のプロファイル（`getDialect()` 経由でも同じ実体） |
| `profile.formatDevice(d)` / `parseDevice(text)` | セルのデバイス表示とデバイス入力欄 |
| `profile.timerPreset(ms, device)` / `parseTimerPreset(text, device)` / `TIMER_BASE_MS(device)` | タイマ設定欄（`K100` ⇄ ms）。`Error` が返ったら §10.5 の「100ms 刻みに丸めますか？」を出す |
| `profile.deviceRanges` / `specialDevices` / `instructionNames` | 入力補助・命令語表示 |
| `profile.gridCols`(11) / `MIN_GRID_COLS`(8) / `MAX_GRID_COLS`(15) / `monitorColors`(`powered: '#1E64FF'`) | 表示列数と通電色（設定画面で変更できる） |
| `profile.shortcuts`（`{action, keys, label, confirmed}`） | キー割当表。`confirmed: false` の項目には §12.1 の注記を添える |
| `profile.symbols` / `panels` / `convertStep`(true) / `errorMessages` | 記号の線画・画面構成・「変換」ボタンの有無・エラー文言 |
| `convert(program, profile)` → `ConvertResult` | **「変換」ボタンの実体**。`ok` なら `program`（実行形式）、`errors`（`source: 'structure' \| 'dialect'`）は出力ウィンドウにそのまま並べる。`warnings` は二重コイル |
| `UnknownDialectError` | 未実装メーカーを選ばれたときの扱い |

**`@ojt/circuit-sim`（PLC本体）:**

| API | 用途 |
|---|---|
| `createPlcUnit(id, spec)` / `PlcUnitSpec` / `PlcOutputSpec` / `plcMetaOf(part)` | 通常は `toNetlist()` が呼ぶ。デバッグUIで直接組むときに使う |
| `Simulation.plcInputs(partId)` / `setPlcOutputs(partId, values)` | Worker がスキャンを回すとき（通常は `runPlcOperations()` 経由） |
| `SimulationState.plcs`（`{inputs, outputs, inputAmps}`） / `PlcUnitRuntime` | 3Dの入出力表示LEDとモニタ |
| `PLC_INPUT_ON_AMPS`(0.003) / `PLC_INPUT_OFF_AMPS`(0.0015) / `PLC_INPUT_OHMS`(4700) | デバッグ表示（機種値は `FX5U_SPEC` にある） |
| 信号ログの `PLC.X0` / `PLC.Y0`（boolean）/ `PLC.X0.mA`（数値） | タイムチャートとモニタ |

**`@ojt/board-model`（FX5U と壁コンセント）:**

| API | 用途 |
|---|---|
| `withPlcUnit(board, unit)` → `BoardDefinition` | **モードDのセッションは必ずこの派生盤で作る**（`JIPM_BOARD` のままだと `PLC.*` が「盤に無い端子」になる） |
| `PLC_UNIT_FX5U` / `PLC_UNITS` / `plcUnitFor(model)` / `PlcUnitDefinition` | 機種の3Dモデル（`sizeMm` / `pos` / `terminals` / `leds`）と電気仕様 |
| `FX5U_SPEC` / `octalNames(prefix, count)` / `FX5U_POINTS_PER_COMMON`(4) | 端子名・COM分け |
| `PLC_PART_ID`(`'PLC'`) / `OUTLET_ID`(`'OUTLET'`) / `OUTLET_TERMINALS` / `isOffBoardTerminal(id)` | 3Dのピック処理と机上判定 |
| `deskWires(board, session)` → `DeskWire[]`（`{id, from, to, fromPos, toPos}`） | 机上へ渡るケーブルの描画（`routeSession()` には**含まれない**） |
| `PLC_ORIGIN_MM` / `OUTLET_ORIGIN_MM` / `PLC_TERMINAL_PITCH_MM` / `PLC_ROW_GAP_MM` / `PLC_STAGGER_MM` | 3Dの配置（実機の並び順が判明したら `terminals[].pos` だけ差し替える。§17 #11） |

**`@ojt/content`（モードD課題・結合・判定）:**

| API | 用途 |
|---|---|
| `BUILTIN_PLC_PROBLEMS`（8題）/ `BUILTIN_ALL_PROBLEMS`（28題）/ `findBuiltinProblem(id)` | 課題一覧（モードDを一覧に出す） |
| `isPlcProblem(problem)` / `PlcProblem` / `SupportedProblem` | モード判別と型付け |
| `PlcProblemSchema` / `parseProblem(json)` | 利用者フォルダのモードD課題の読込 |
| `resolvePlcIo(problem.io)` → `ResolvedPlcIo`（`{mode, wiring, inputs, outputs}`）/ `DEFAULT_PLC_IO` | 割付の表示（「X0 = PB1（黒）」等）と3Dの配線ガイド |
| `plcBoardFor(problem, board)` → `BoardDefinition \| undefined` | セッションを作る盤（＝`withPlcUnit` 済み）を得る |
| `buildPlcReferenceSession(problem, board)` → `PlcReferenceResult` | 模範回路（`session` / `netlist` / `board` / `unit` / `io` / `program`）。デバッグ表示と自己整合に使う |
| `plcWiringPlan(io, unit)` → `PlcWireSpec[]` | 「模範の配線を見る」ヒント表示（判定には使わない） |
| `PLC_WIRE_COLOR`(`'青'`) | 線色パレット（モードDは青のみ。§8.1） |
| `createPlcCoupling(sim, program, options?)` → `{runtime, beforeTick}` | **Worker がセッション中にスキャンを回す実体**。`loadLadder` で `compile()` 済みのプログラムを受け取り、毎tick `beforeTick()` を呼ぶ |
| `createSimulationIoPort(sim, partId?)` | 上の内部で使う。自前でランタイムを持ちたいときだけ |
| `runPlcOperations(netlist, program, operations, options)` → `PlcRunResult` | 判定の並走（Worker 内で実行する。UIスレッドでは呼ばない） |
| `runOperationsOn(simulation, operations, options)` / `RunOptions.beforeTick` | 既存のシミュレーションで操作列を再生する |
| `judgePlc(problem, board, traineeSession, traineeLadder, options?)` → `JudgePlcOutcome` | **モードDの判定**。`board` は素の `JIPM_BOARD` を渡してよい（内部で `withPlcUnit` する）。`options` は `{elapsedMs?, sessionHazards?}` |
| `judgePlcReference(problem, board)` | 自己整合（デバッグUI・CI） |
| `JudgePlcResult`（`mode: 'plc'` / `passed` / `mismatches` / `staticChecks` / `hazardCount` / `hazardsByKind` / `chatter` / `charts` / `compareSignals` / `ladderErrors` / `ladderWarnings`） | 結果画面。`mode` で C1/C2/B の結果型と判別できる |
| `plcTimerMarkers(program)` → `TimeChartMarker[]` | タイムチャートの印（`T0=3秒`） |
| `checkTwoStage` / `checkPlcPowerIndependent` / `checkIoAssignment` / `PlcCheckContext` / `detectPlcWiring(nets, unit)` | セッション中の「いまの配線の診断」表示（判定前に警告を出したいとき） |
| `LadderProgramSchema` / `CellSchema` / `DeviceSchema` | 作業ファイル（`.ojtw`）に保存したラダーの読み戻し（§12.3） |
| （ハンドオフ注記 H-1） | **訓練者のラダーは「変換」を通ったものだけを判定に出すこと。** `judgePlc()` は変換に落ちたラダーを受け取ると、シミュレートせずに `passed: false` と `ladderErrors` を返す（§10.6 の操作フローどおり） |
| （ハンドオフ注記 H-2） | **セッション中のスキャンと判定のスキャンは別物である。** セッション中は `createPlcCoupling()` の `runtime` が動き続け、判定（`judgePlc()`）は別のシミュレーションを最初から走らせる。判定後にセッションを続ける場合、`runtime.reset()` を呼ぶかどうかは 3B が決める（実機の「RUN/STOP」に対応させるなら STOP→RUN で `reset()`） |
| （ハンドオフ注記 H-3） | **作業ファイルに残すもの**: 課題ID、盤セッション（配線・装着）、**ラダーIR**（`LadderProgram` をそのままJSONに）、選んでいる方言ID、変換済みかどうか、経過時間、危険操作カウンタ（§12.3） |
| （ハンドオフ注記 H-4） | `judgePlc()` は模範と訓練者の2回ぶんを10ms tick で最後まで回す。内蔵課題（`durationMs` 6000〜8000ms）で1件あたり 0.3〜1 秒かかるので、**Worker 内で実行**すること（Plan 2B の `judgeInspectRepair` と同じ扱い） |

**Plan 3B が自分で作るもの（3A では作らない）:** GX Works3風スキンの画面（プロジェクトツリー・ラダーエディタ・出力ウィンドウ）、F5/F7/F4 のキー操作とセル編集、「変換」ボタンとモニタ表示、FX5U と壁コンセントの3Dモデル・机上配線ケーブル、モードDのセッション画面と結果画面、Worker プロトコルの新コマンド（`loadLadder` / `convert` / `monitor` など）、モードD課題の一覧表示、E2E（§14.2 の③）。

---

## 完了条件

- [ ] `pnpm -r test` が7プロジェクト（`circuit-sim` / `board-model` / `schematic-core` / `content` / `ladder-core` / `plc-dialects` / `desktop`）すべて通る。
- [ ] `pnpm --filter @ojt/ladder-core exec vitest run --coverage` と `pnpm --filter @ojt/plc-dialects exec vitest run --coverage` が閾値90%（lines / statements / functions / branches）を満たす（§14.2）。
- [ ] `pnpm --filter @ojt/circuit-sim exec vitest run --coverage` と `pnpm --filter @ojt/content exec vitest run --coverage` が着手前と同じく90%以上を維持する。
- [ ] `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` 込み）が無警告で通る。
- [ ] `npx prettier --check "packages/**/*.{ts,json}"` が `All matched files use Prettier code style!` を出す。
- [ ] `pnpm --filter @ojt/content schema:write` を流しても `packages/content/schema/task.schema.json` に差分が出ない（`oneOf` が4分岐で、`plc` 分岐が `referenceLadder` を持つ）。
- [ ] 内蔵モードD課題8題が、①自分の模範ラダー＋模範配線で合格し ②接点を1つ裏返したラダーで不合格になり ③`Y0` をランプへ直結すると `twoStage` で落ち ④PLC電源を盤から取ると `plcPowerIndependent` で落ちる。
- [ ] 内蔵モードD課題8題の比較信号が、すべて判定区間の始点・終点で論理0である（`startsAndEndsLow`。§7.3）。
- [ ] `packages/ladder-core/src` に `@ojt/` の import が1件も無く、`packages/plc-dialects/src` は `@ojt/ladder-core` のみ、`packages/circuit-sim/src` は `@ojt/` を1件も import していない（§4.2）。
- [ ] `packages/content/src` が `@ojt/plc-dialects` を import していない（決定表#7）。
- [ ] 三菱の `T0 K100` が 10s、`T200 K100` が 1s になる（§14.1 #25）。
- [ ] 二重コイルが変換警告として出て、実行は後勝ちになる（§14.1 #26）。特殊デバイス3種が §10.3 のとおり動く（#27）。
- [ ] `withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U)` が `validateBoard()` を空配列で通り、`toNetlist()` の節点数が `MAX_NODES`（400）未満である。
- [ ] `apps/desktop` への変更が `test/content-loader.test.ts` の1ファイルだけである（`git show --stat` で確認する）。

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-18 | 初版。Phase 3（モードD＝PLC）をライブラリ（3A）と `apps/desktop`（3B）に分割し、本書は 3A を扱う。新パッケージ `@ojt/ladder-core` / `@ojt/plc-dialects` の構成、PLC本体の電気モデル（入力＝抵抗負荷・出力＝外部駆動接点・電源＝非電気端子）、スキャンと tick の結合点（`@ojt/content` の `beforeTick`）、IRの `Device.index` を0起点の通し番号とする決定、`vline` の意味、模範配線をI/O割付から生成する方式、`twoStage` / `plcPowerIndependent` / `ioAssignment` の判定方法、内蔵モードD課題8題の題材と操作列を確定した |
