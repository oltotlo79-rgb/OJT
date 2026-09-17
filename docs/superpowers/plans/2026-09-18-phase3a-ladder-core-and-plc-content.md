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
| 14 | テスト件数のベースライン（handoff 2026-09-18 時点）: `circuit-sim` 214・`board-model` 155・`content` 32ファイル442・`desktop` 541・E2E 11。本プランの完了条件では**着手時に測り直した値**を基準にすること | `pnpm -r test` |

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
| `packages/content/src/plc-io.ts` | `Simulation` を `PlcIoPort` として見せる橋渡しと、1 tick ＝ 1 スキャンの結合。§10.4 |
| `packages/content/src/runner.ts` | `RunOptions.beforeTick` を足す（変更）。§10.4 |
| `packages/content/src/plc-reference.ts` | 既定I/O割付、模範配線の生成（渡り配線）、模範セッションの構築。§7.6 / §10.2 / §11.3 |
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
| A | 1 → 2 → 3 → 4 | `@ojt/ladder-core` | 1=Sonnet / 2=Opus / 3=Opus / 4=Sonnet | なし（最初に着手する） |
| B | 5 → 6 | `@ojt/circuit-sim`（PLC部品とスキャン結合点） | 5=Sonnet / 6=Opus | なし（Aと並行可） |
| C | 7 | `@ojt/board-model`（FX5U・コンセント・盤の派生） | Opus | B |
| D | 8 → 9 → 10 | `@ojt/plc-dialects` | 8=Sonnet / 9=Opus / 10=Opus | A |
| E | 11 → 12 → 13 | `@ojt/content`（スキーマ） | 11=Sonnet / 12=Opus / 13=Sonnet | A |
| F | 14 → 15 → 16 → 17 | `@ojt/content`（結合・模範配線・静的チェック・判定） | すべて Opus | B・C・E |
| G | 18 → 19 | `@ojt/content`（内蔵課題8題） | どちらも Opus | F |
| H | 20 | 全体（公開APIと検証） | Sonnet | A〜G すべて |

並行の上限は「A＋B」「D＋E」の2組までにする（C は B の、F は C・E の成果物を import するため）。**どのタスクも、後のタスクが作るファイルを import しない**ことを各タスクの Files 欄で確認すること（Plan 2B で一度この順序を誤っている）。

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
      [no(X(0)), vline(), nc(X(1)), ...Array.from({ length: IR_COLS - 4 }, () => hline()), out(Y(0))],
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
      [no(X(0)), vline(), nc(X(1)), ...Array.from({ length: IR_COLS - 4 }, () => hline()), out(Y(0))],
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
      [no(X(0)), vline(), nc(X(1)), ...Array.from({ length: IR_COLS - 4 }, () => hline()), out(M(0))],
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
      [no(X(0)), vline(), nc(X(1)), ...Array.from({ length: IR_COLS - 4 }, () => hline()), out(Y(0))],
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
    scans(runtime, 300);
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
    scans(runtime, 48); // 合計50スキャン = 500ms
    expect(io.outputs[2]).toBe(false);
    scans(runtime, 50); // 合計100スキャン = 1000ms
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

  it('clears every device on reset (§10.4 の RUN停止・リセット)', () => {
    const io = new TestIo();
    const runtime = boot(oneShotProgram(1000), io);
    io.press(0);
    scans(runtime, 5);
    expect(runtime.bit(M(0))).toBe(true);
    runtime.reset();
    expect(runtime.bit(M(0))).toBe(false);
    expect(runtime.tMs).toBe(0);
    expect(runtime.scanCount).toBe(0);
    expect(runtime.state().timers[0]?.elapsedMs ?? 0).toBe(0);
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
  /** 全デバイスと時刻を初期化する（RUN停止・リセット相当）。§10.4 */
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
    this.mcStack = [];
    this.firstScan = true;
    this.elapsedMs = 0;
    this.scans = 0;
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
    return {
      scanCount: this.scans,
      tMs: this.elapsedMs,
      inputs: [...this.inputs],
      outputs: [...this.outputs],
      internals,
      timers,
      counters,
    };
  }

  scan(): void {
    // ① 入力読込
    this.inputs = [...this.io.readInputs()];
    this.mcStack = [];
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
    for (const output of net.outputs) {
      const powered = rails.poweredAt(output.row, COIL_COL);
      this.applyOutput(output.cell, powered);
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

Expected: `Test Files  1 passed (1)` / `Tests  15 passed (15)`。

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
  compile,
  createPlcRuntime,
  endNetwork,
  network,
  no,
  out,
  program,
  SP,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  T,
  ton,
  X,
  Y,
  type LadderProgram,
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
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run test/golden-ladder.test.ts
```

Expected: 実装は揃っているので、**期待値の食い違いだけが出る**（`spans()` の境界が1スキャンずれる等）。ずれた場合は **実装ではなく期待値を直す**のではなく、まず §10.4 の規定（「設定値到達で接点ON」＝到達したスキャンで ON、出力は同じスキャンの後段ネットワークに伝わる）と突き合わせ、実装が仕様どおりかを確かめること。上の期待値は次の理屈で決めてある。

- タイマは `applyOutput()` で加算してから比較するので、`preset = 100ms`・`scanMs = 10ms` なら**10回目のスキャン**（添字9）で `elapsedMs = 100` になり接点が入る。同じスキャンの後段（`n2`）はその値を読むので、`Y0` も添字9の履歴から ON になる。
- `onDelayProgram` は `n1` で M0 を作ってから `n2` で計時するので、X0 を押したスキャン（添字10）で M0 が入り、そこから300スキャン後の添字310で点く。
- `oneShotProgram` は立上りで M0 を SET（添字10）→ 100スキャン後に T0 がタイムアップし、次のスキャンの `n3` で RST される（添字111で消える）。

- [ ] **Step 3: カバレッジを確認する**

```powershell
pnpm --filter @ojt/ladder-core exec vitest run --coverage
```

Expected: `All files` の lines / statements / functions / branches がすべて 90% 以上（§14.2 は `ladder-core` を Phase 3 以降の対象と定めている）。届かない場合は、未到達の分岐（`compile()` のエラー枝・`bit()` の特殊デバイス・`reset()`）にテストを足す。**実装を削って閾値に合わせてはならない。**

- [ ] **Step 4: コミットする**

```powershell
git add packages/ladder-core
git commit -m "test(ladder-core): pin the PLC golden cases (#26, #27) and the built-in ladders"
```

---
