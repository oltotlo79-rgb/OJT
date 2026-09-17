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
import { CLOSED_CONTACT_OHMS, PLC_INPUT_OHMS, type ContactElement, type Element, type LoadElement } from './elements.js';
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
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.setPlcOutputs('PLC', [false, false]);
    sim.step();
    sim.step();
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

Expected: 新しいファイルが `Tests  8 passed (8)`、パッケージ全体は着手時のベースライン（前提#14。目安214件）＋16件がすべて通る。**既存テストが1件でも落ちたら、`syncRuntimeMaps()` / `snapshot()` の変更が既存部品の挙動を変えていないか確認すること**（PLCを持たないネットリストでは、新しい分岐に一切入らないはずである）。

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
    expect(plc.find((t) => t.id === 'PLC.SS')?.label).toBe('S/S');
    expect(plc.find((t) => t.id === 'PLC.PE')?.label).toBe('⏚');
    expect(plc.find((t) => t.id === 'PLC.X10')?.role).toBe('x');
    expect(plc.find((t) => t.id === 'PLC.COM1')?.role).toBe('plc-com');
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
import { buildNets, MAX_NODES, plcMetaOf, validateNetlist, type TerminalId } from '@ojt/circuit-sim';
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
    const outlet = desk.find((d) => d.from === 'OUTLET.L' || d.to === 'OUTLET.L');
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

`to-netlist.ts` の import に足す:

```ts
import { createPlcUnit, ... } from '@ojt/circuit-sim';
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

Expected: 新しい2ファイルが `Tests  17 passed (17)`、パッケージ全体は着手時のベースライン（前提#14。目安155件）＋17件が通る。**既存の経路テスト（`routing*.test.ts`）は1件も落ちないはずである**（PLCを載せない盤では `routeSession()` の新しい `continue` に一度も入らない）。

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

import { DIALECT_IDS, UnknownDialectError, type DialectId, type DialectProfile } from './profile.js';

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
import { compile, type CompileWarning, type CompiledProgram, type LadderProgram } from '@ojt/ladder-core';
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
