# Plan 4A: 3方言プロファイル・表記切替・命令語リスト・PLC機種モデル（packages のみ）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 4（4方言の切替）の**ライブラリ側**を完成させる。すなわち `@ojt/plc-dialects` に OMRON CP1E（CX-Programmer風）・JTEKT TOYOPUC PC10G-1SP（PCwin風）・シャープ JW300（JW-300SP風）の3プロファイルと、表記切替（`switchNotation()`）・命令語リストのエクスポート（`instructionList()`）・方言バリデータを足し、`@ojt/circuit-sim` の `PlcUnitSpec` を「8点1コモン」「点ごとに入力抵抗が違う機種」に対応させ、`@ojt/board-model` に CP1E（一体形）・TOYOPUC ラック・JW300 ラックの本体定義を足し、`@ojt/content` のモードD課題を4機種すべてで開始できるようにする。**スキン画面・3D描画・設定画面・E2E はすべて Plan 4B の担当**である。

**Architecture:** Phase 3 で作った4層（IR → 方言 → 電気的実体 → 課題と判定）はそのまま使い、**層を増やさず各層に機種を足す**。①`@ojt/ladder-core` は**一切変更しない**（IRはベンダー中立。§17.1 の「修正箇所は方言プロファイル／スキン定義／盤モデルの3区分のみ」を実地で検証する回でもある）。②`@ojt/plc-dialects` は `mitsubishi.ts` と同じ形のファイルを3つ増やし、4プロファイルで共通する「デバイス範囲・タイマ単位・カウンタ範囲の検査」を `device-rules.ts` に、GX Works3風のキー割当の流用（§17 #19）を `shortcuts.ts` に括り出す。表記切替と命令語リストは**プロファイルを引数に取る純関数**で、方言ごとの分岐を持たない。③`@ojt/circuit-sim` の `PlcUnitSpec` は入力1点ぶんを `PlcInputSpec { name, com, ohms? }` に格上げする（TOYOPUC・JW300 は8点1コモン、CP1E は `0.00`〜`0.07` が 3.3kΩ・`0.08` 以降が 4.8kΩ。§5.1.3）。④`@ojt/board-model` に `PlcModuleDefinition` を足し、ラック形は「ベース＋モジュール」の入れ物として描ける形にする（3Dは 4B）。⑤`@ojt/content` は機種名の白紙リストを外し、機種にない入出力点を課題スキーマで弾き、静的チェックから三菱固有の正規表現（`/^PLC\.X\d+$/`）を取り除く。

**4A が触らないもの:** `packages/ladder-core/**`（IR・compile・runtime）、`apps/desktop/**`（4B）、`packages/schematic-core/**`。

**Tech Stack:** TypeScript（`strict` ＋ `noUncheckedIndexedAccess` ＋ `exactOptionalPropertyTypes` ＋ `verbatimModuleSyntax`、`.js` 拡張子つき相対 import）、zod 4.6.0、Vitest 5（カバレッジ v8・閾値90%）、pnpm workspace、Prettier（printWidth 100）。**新しい外部依存は追加しない。新しいパッケージも作らない。**

---

## 前提（このプランを始める前に満たしていること）

実コードで確認した事実のみを載せる。番号は本文から参照する。

| # | 前提 | 確認した場所 |
|---|---|---|
| 1 | Plan 3A・3B が完了し `main` に入っている。`pnpm -r test` が7プロジェクト（`circuit-sim` / `board-model` / `schematic-core` / `content` / `ladder-core` / `plc-dialects` / `desktop`）で通る | `pnpm -r test` |
| 2 | `DialectProfile`（`profile.ts`）は `id` / `displayName` / `formatDevice` / `parseDevice` / `deviceRanges` / `timerPreset` / `parseTimerPreset` / `instructionNames` / `specialDevices` / `symbols` / `gridCols` / `shortcuts` / `convertStep` / `monitorColors` / `panels` / `validate` / `errorMessages` を持つ。`timerPreset(ms, device)` と `parseTimerPreset(text, device)` は**デバイスを第2引数に取る**（3A の意図的な差分 #1） | `packages/plc-dialects/src/profile.ts` |
| 3 | `DIALECT_IDS` は `['mitsubishi','jtekt','omron','sharp']`、`IMPLEMENTED_DIALECT_IDS` は現在 `['mitsubishi']`、`getDialect()` は未実装IDに `UnknownDialectError`（文言に「Phase 4」を含む）を投げる。`MIN_GRID_COLS`=8 / `MAX_GRID_COLS`=15 | `packages/plc-dialects/src/{profile,index}.ts`、`test/profile.test.ts` |
| 4 | `InstructionKey` は現在13種（`ld`〜`counter`）で、`ANB`/`ORB`/`MC`/`MCR`/`END` と接点形の微分（`LDP` 等）に対応するキーが**無い**。命令語リストにはこれらが要る | `packages/plc-dialects/src/profile.ts` L47-60 |
| 5 | `MITSUBISHI_FX5U.errorMessages` のキー集合は `device-range` / `timer-unit` / `timer-range` / `counter-range` / `special-unsupported` の5つちょうどで、`test/mitsubishi-validate.test.ts` が `Object.keys(...).sort()` を**完全一致**で見張っている。三菱の `errorMessages` にキーを足してはならない | `packages/plc-dialects/test/mitsubishi-validate.test.ts` 末尾 |
| 6 | `test/skin.test.ts` はショートカット表の不変条件（action・keys が一意、`enabled: false` はちょうど1件、`panels`/`shortcuts`/`errorMessages` にベンダー名を含まない、`displayName` に「風」を含む）を見張っている。`application` の `note` に `'Phase 4'` を含むことも見ている（**Task 1 で文言を変えるので同時に更新する**） | `packages/plc-dialects/test/skin.test.ts` |
| 7 | IRの `Device.index` は**0起点の通し番号**で、8進・10進・16進はすべて方言の表示上の話である（3A 決定表#5）。`DeviceKind` は `input`/`output`/`internal`/`timer`/`counter`/`special` の6種、特殊デバイスは `SP0`〜`SP2` の3つだけ | `packages/ladder-core/src/ir.ts` |
| 8 | `TerminalId` は `<部品ID>.<端子名>` で、**端子名側に `.` を含んでよい**（`parseTerminalId` は最初の `.` で割る。型コメントに `PLC.0.00` の例がある）。部品IDは `.` と `:` を拒否するが、端子名は空でなければ何でもよい | `packages/circuit-sim/src/ids.ts` L11・L37-48 |
| 9 | `PlcUnitSpec` は現在 `inputCommon: string`（**単数**）と `inputs: readonly string[]`（端子名の配列。添字がIRの `device.index`）と `outputs: readonly PlcOutputSpec[]`（`{name, com}`）と `inputOhms?` / `onAmps?` / `offAmps?`（**機種で1つ**）を持つ。8点1コモンの機種と、点ごとに抵抗が違う CP1E はこの形では表せない | `packages/circuit-sim/src/plc.ts` L36-64 |
| 10 | `createPlcUnit()` は入力を `PLC.<inputCommon>`–`PLC.<入力端子>` 間の `load`（`plcInput`）、出力を `PLC.<出力端子>`–`PLC.<COM>` 間の `contact`（`driver: 'external'`）にする。電源端子（`spec.power`）は要素を持たない | `packages/circuit-sim/src/plc.ts` L76-150 |
| 11 | `PartMeta`（`kind: 'plc'`）は `inputCommon: TerminalId` を持ち、`test/plc-part.test.ts` が `expect(meta?.inputCommon).toBe('PLC.SS')` を見ている。`simulation.ts` は `inputCommon` を**参照していない**（grep 済み） | `packages/circuit-sim/src/parts.ts` L91、`test/plc-part.test.ts` L75 |
| 12 | `PlcUnitDefinition`（`board-jipm.ts` L296-311）は `id` / `model` / `vendor` / `displayName` / `sizeMm` / `pos` / `spec` / `terminals` / `leds` を持つ。ラック形（ベース＋モジュール）を表す項目が無い | `packages/board-model/src/board-jipm.ts` |
| 13 | `withPlcUnit(board, unit)` は `id` を変えずに `plcUnit` と `unit.terminals` ＋ `OUTLET_TERMINALS` を足した派生盤を返す。**機種に依存しない**ので Phase 4 で変更は要らない | `packages/board-model/src/plc-unit.ts` 末尾 |
| 14 | `validateBoard()` と `routeSession()` は `isOffBoardTerminal()`（`PLC.` / `OUTLET.` 接頭辞）で机上の端子を除外する。`deskWires()` が机上配線を別に返す | `packages/board-model/src/{board-jipm,routing}.ts` |
| 15 | `test/plc-geometry-review.test.ts` は「机上端子どうしが `2 × TERMINAL_PICK_RADIUS_MM`（8mm）以上離れている」「PLC端子はすべて本体の外形矩形の内側」「コンセント端子は外形矩形の外」「机上端子はすべて盤の右」を見張っている。**新機種もこれを満たす必要がある** | `packages/board-model/test/plc-geometry-review.test.ts` |
| 16 | `TERMINAL_PICK_RADIUS_MM` は 4、`PLC_ORIGIN_MM` は `(390, 18, 0)`、`OUTLET_ORIGIN_MM` は `(395, 190, 0)`、`PLC_TERMINAL_PITCH_MM`=9 / `PLC_ROW_GAP_MM`=9 / `PLC_STAGGER_MM`=4.5 | `packages/board-model/src/plc-unit.ts` 先頭 |
| 17 | `packages/content/src/schema/plc.ts` の `PHASE3_MODELS` は `['FX5U']` で、`PlcRefSchema` が「この機種はまだ開始できません（Phase 4 で追加します）」を出す。`PLC_MODELS` は `['FX5U','PC10G-1SP','CP1E','JW-300']`、`MODEL_OF_VENDOR` がメーカーと機種を結んでいる | `packages/content/src/schema/plc.ts` L22-59 |
| 18 | `PHASE3_MODELS` を参照しているのは `content/src/index.ts` L144・`content/test/index.test.ts` L141,652・`content/test/schema-plc.test.ts` L5,42 の**4ファイルだけ**で、`apps/desktop` は参照していない（grep 済み） | `grep -rn PHASE3_MODELS` |
| 19 | `plc-static-checks.ts` の `checkIoAssignment()` は `/^PLC\.X\d+$/` と `/^PLC\.Y\d+$/` という**三菱の端子名を前提にした正規表現**を持つ。CP1E の `PLC.0.00` / `PLC.100.00`、JW300 の `PLC.A0` では一致しない | `packages/content/src/plc-static-checks.ts` の `isPlcX` / `isPlcY` |
| 20 | `checkPlcPowerIndependent()` は端子名 `'L'` / `'N'` を**直書き**している。CP1E の電源端子は `L1` / `L2/N` なので機種仕様から引く必要がある | 同上 |
| 21 | `plcWiringPlan()` は `unit.spec.inputs[x]` / `unit.spec.outputs[y]` / `unit.spec.inputCommon` / `terminalId('OUTLET','L')→plcTerminal('L')` を使う。入力コモンが複数ある機種と、電源端子名が `L`/`N` でない機種に対応が要る | `packages/content/src/plc-reference.ts` L86-140 |
| 22 | 内蔵モードD課題8題は `plc.model: 'FX5U'` で、使う点は 2級形式が X0〜X2 / Y0〜Y2、1級形式が X0〜X2 / Y0〜Y3 である。IR側に三菱固有の要素は無い（`device.index` は通し番号） | `packages/content/src/builtin/plc/d-00*.json`、`test/builtin-plc.test.ts` |
| 23 | `PlcInputMapSchema` は `x: 0〜15`、`PlcOutputMapSchema` は `y: 0〜15` を許す。CP1E は出力が12点しかないので `y: 12` 以降は機種にない点になる | `packages/content/src/schema/plc.ts` |
| 24 | `@ojt/content` は `@ojt/board-model` に依存している（`plc-reference.ts` が import 済み）。`schema/plc.ts` から `plcUnitFor()` を呼んでも循環は起きない（`board-model` は `content` を知らない） | `packages/content/package.json`、`src/plc-reference.ts` L1-15 |
| 25 | テスト件数のベースラインは**着手時に測り直す**（`pnpm -r test` の各プロジェクトの件数をメモしてから始める） | `pnpm -r test` |

**この計画が前提として置いた設計値（§17.1 の前提方針で採用。実機と異なると分かったら「修正箇所」の1ファイルだけを差し替える）:**

| 値 | 採用値 | 区分 | 修正箇所（1ファイル） |
|---|---|---|---|
| OMRON のデバイス番号体系 | 入力は CP1E-N30DR-A の実装点の並び（`0.00`〜`0.11`・`1.00`〜`1.05` の18点）、出力は `100.00`〜`100.07`・`101.00`〜`101.03` の12点。IRの `index` はこの並びの通し番号 | 一次資料（§10.1 の点数）＋本アプリの写像 | `packages/plc-dialects/src/omron.ts` |
| OMRON のタイマ表記 | `TIM`（BCD）系の `#0000`〜`#9999`、0.1s単位。`parseTimerPreset` は `&`（BIN・`TIMX`）も受ける | 一次資料（§10.5） | `omron.ts` |
| OMRON のカウンタ設定値 | `#0001`〜`#9999` | 二次資料（BCD 4桁） | `omron.ts` |
| JTEKT のプログラム番号 | **1 固定**（`1X000` 形式）。`2`/`3` を入力するとエラー | §10.5（先頭の1/2/3はプログラム番号） | `packages/plc-dialects/src/jtekt.ts` |
| JTEKT のタイマ表記 | 設定値レジスタ `H` ＋ 16進4桁（`H001E` = 3.0s）、0.1s単位 | 本アプリ独自（§17 #20） | `jtekt.ts` |
| JTEKT の命令ニーモニック | 三菱系の `LD`/`LDI`/`AND`/`ANI`/`OR`/`ORI`/`OUT`/`SET`/`RST`/`PLS`/`PLF`/`ANB`/`ORB`/`MC`/`MCR`/`END`。タイマ・カウンタは `OUT` | 本アプリ独自（§17 #10） | `jtekt.ts` の `INSTRUCTION_NAMES` |
| シャープのリレー番号割付 | 入力ユニット（スロット1）= `000000`〜`000017`、出力ユニット（スロット2）= `000020`〜`000037`、内部リレー = `001000`〜`001777`（いずれも8進6桁） | 本アプリ独自（§10.5 は「割付はユニット装着位置による」とのみ規定） | `packages/plc-dialects/src/sharp.ts` |
| シャープのタイマ・カウンタ表記 | `TMR00000`〜`TMR17777` / `CNT00000`〜`CNT17777`（8進5桁）。実機は命令語の文脈で番号だけを書くが、`parseDevice()` が一意に読めるよう本アプリは接頭辞を付ける。設定値は0.1s単位の10進4桁（`0030` = 3.0s） | 本アプリ独自（§10.5 の `00000`〜`17777` と `DTMR(BCD) 00001 / 0100` の書式から） | `sharp.ts` |
| シャープの常時ON | `007366` を**b接点**で使う。プロファイルは `specialInverted` にこの番号を載せ、4B が b接点として描く | 一次資料（§10.5 / §17 #22） | `sharp.ts` |
| 4スキンの表示列数・通電色 | 接点11列、三菱 `#1E64FF` / OMRON `#2FA02C` / JTEKT `#E08A1E` / シャープ `#00A0C8` | 本アプリ既定（§10.6 / §17 #19） | 各プロファイルの `gridCols` / `monitorColors` |
| PCwin風・JW-300SP風のキー割当 | GX Works3風と同一（`shortcuts.ts` の `GX_STYLE_SHORTCUTS` を流用）。PCwin風は `convertStep: false` なので「変換」の行だけ落とす | 本アプリ独自（§17 #19） | `packages/plc-dialects/src/shortcuts.ts` |
| CP1E の出力COM分け | `COM0`〜`COM4` に 3/3/2/2/2 点（`100.00`〜`100.02` / `100.03`〜`100.05` / `100.06`〜`100.07` / `101.00`〜`101.01` / `101.02`〜`101.03`） | 本アプリ独自（§17.1・COM端子が5個であることは一次資料） | `packages/board-model/src/plc-unit.ts` |
| CP1E の電源端子名 | `L1` / `L2N`（銘板は `L2/N`。端子IDに `/` を使わないため）。入力端子台側に同居 | 一次資料（§10.1）＋端子ID規則 | `plc-unit.ts` |
| TOYOPUC の入出力コモン分け | `IN-12` は8点1コモンで `ICOM0`（`X0`〜`X7`）/ `ICOM1`（`X8`〜`XF`）、`OUT-12` は 5A/COM・2A/点 から8点1コモンとして `COM0`（`Y0`〜`Y7`）/ `COM1`（`Y8`〜`YF`） | 入力側は一次資料（§10.1 の「8点/COM」）、出力側は本アプリ独自 | `plc-unit.ts` |
| JW300 の端子名 | 入力 `A0`〜`A7` ＋ `COM.A`、`B0`〜`B7` ＋ `COM.B`（§10.1 で確定）。出力は同じ様式で `C0`〜`C7` ＋ `COM.C`、`D0`〜`D7` ＋ `COM.D` | 入力は一次資料、出力は本アプリ独自 | `plc-unit.ts` |
| ラック形モジュールの外形・端子配置 | 1モジュール 幅35 × 高さ130 mm、奥行は TOYOPUC 120 / JW300 109.4（CUは99.8）。ベース外形 = モジュール幅合計＋左右各10mm、高さ140。端子は1モジュールにつき**2列×最大9段**（列間17mm・段間13mm）に並べる（当たり判定半径4mmが重ならない最小構成） | 本アプリ独自（§10.1・§17 #11・§17.1 の TOYOPUC 外形前提） | `plc-unit.ts` |
| 各機種のPLC入力しきい値 | FX5U のみ ON 3.5mA（§5.1.3）。CP1E・TOYOPUC・JW300 は `circuit-sim` の既定（ON 3mA / OFF 1.5mA）を使う。24V印加時の入力電流は CP1E 5.0mA（4.8kΩの点）・JW300 7.3mA・TOYOPUC 10.0mA でいずれもON判定を超える | 本アプリ独自（各社の感度はPLC調査資料に無い） | `plc-unit.ts` の `*_SPEC` |

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `packages/plc-dialects/src/profile.ts` | **変更**: `InstructionKey` を24種に拡張（ブロック接続・MC/MCR・END・接点形の微分）、`DialectProfile.specialInverted?` を追加。§10.5 |
| `packages/plc-dialects/src/shortcuts.ts` | **新規**: GX Works3風のキー割当表（`GX_STYLE_SHORTCUTS`）と「変換」行を落とすヘルパ（`withoutConvert`）。§10.6 / §17 #19 |
| `packages/plc-dialects/src/device-rules.ts` | **新規**: 4方言で共通するデバイス検査（範囲・タイマ単位・カウンタ範囲・未対応の特殊デバイス）と、IRからデバイスを集める `collectDevices()`。§10.5 / §10.8 |
| `packages/plc-dialects/src/mitsubishi.ts` | **変更**: `INSTRUCTION_NAMES` に11キー追加、ショートカット表を `shortcuts.ts` から取る。デバイス検査は既存実装のまま（前提#5） |
| `packages/plc-dialects/src/omron.ts` | **新規**: OMRON CP1E ＋ CX-Programmer風スキン。§10.5 / §10.6 |
| `packages/plc-dialects/src/jtekt.ts` | **新規**: JTEKT TOYOPUC PC10G-1SP ＋ PCwin風スキン（X/Y・T/C 同番号重複の検査つき）。§10.5 / §10.6 |
| `packages/plc-dialects/src/sharp.ts` | **新規**: シャープ JW300 ＋ JW-300SP風スキン（8進検査つき）。§10.5 / §10.6 |
| `packages/plc-dialects/src/notation.ts` | **新規**: 表記切替 `switchNotation()`。§10.7 |
| `packages/plc-dialects/src/instruction-list.ts` | **新規**: 命令語リストのエクスポート `instructionList()`。§10.7 |
| `packages/plc-dialects/src/index.ts` | **変更**: 4プロファイルの登録とバレル |
| `packages/circuit-sim/src/plc.ts` | **変更**: `PlcInputSpec`（点ごとのCOM・抵抗）、`inputCommons`（複数）、`acPower`（壁コンセントへ繋ぐ2点）。§5.1.3 / §10.1 |
| `packages/circuit-sim/src/parts.ts` | **変更**: `PartMeta.plc.inputCommons` |
| `packages/circuit-sim/src/index.ts` | **変更**: 再エクスポート |
| `packages/board-model/src/board-jipm.ts` | **変更**: `PlcModuleDefinition` と `PlcUnitDefinition.form` / `modules?`。§10.1 |
| `packages/board-model/src/plc-unit.ts` | **変更**: FX5U を新しい `PlcUnitSpec` に追随、CP1E・TOYOPUC ラック・JW300 ラックを追加、`PLC_UNITS` に4機種登録。§10.1 / §5.1.3 / §17 #11 |
| `packages/board-model/src/index.ts` | **変更**: 再エクスポート |
| `packages/content/src/schema/plc.ts` | **変更**: `SUPPORTED_PLC_MODELS`（4機種）、機種にない入出力点の検証。§7.6 |
| `packages/content/src/plc-reference.ts` | **変更**: 複数入力コモン・機種別AC端子に対応した模範配線。§10.2 |
| `packages/content/src/plc-static-checks.ts` | **変更**: 三菱固有の正規表現を撤去し機種仕様から端子集合を引く。§10.8 |
| `packages/content/src/index.ts` | **変更**: 公開APIの確定 |
| `packages/plc-dialects/test/*.test.ts` | 新規5ファイル＋既存2ファイルの追随 |
| `packages/circuit-sim/test/*`・`packages/board-model/test/*`・`packages/content/test/*` | 既存テストの追随と新規テスト |

---

## 実装バッチ（推奨）

| バッチ | タスク | 対象 | モデル | 依存 |
|---|---|---|---|---|
| A | 1 → 2 → 3 → 4 → 5 | `@ojt/plc-dialects`（共通土台と3プロファイル） | 1=Sonnet-verbatim / 2=Sonnet / 3=**Opus** / 4=**Opus** / 5=Sonnet-verbatim | なし（最初に着手する） |
| B | 6 → 7 | `@ojt/plc-dialects`（表記切替・命令語リスト） | 6=Sonnet / 7=**Opus** | A |
| C | 8 → 9 → 10 → 11 | `@ojt/circuit-sim` ＋ `@ojt/board-model`（機種モデル） | 8=**Opus** / 9=Sonnet / 10=**Opus** / 11=**Opus** | なし（Aと並行可） |
| D | 12 → 13 → 14 | `@ojt/content`（課題・模範配線・静的チェック・検証） | すべて **Opus** | B・C |

進め方: **A ∥ C** → **B**（Aの後）→ **D**。並行の上限は「A＋C」の1組だけにする（B は A の、D は B・C の成果物を import する）。各バッチの終わりに **Opus レビューを1回**かける（レビュー方針: グループごとに1回、細かい指摘はまとめて修正）。

「Sonnet-verbatim」と書いたタスクは、本書のコードとテストをそのまま書き写せば通る。**Opus** と書いたのは判断が要るタスク（バリデータの設計、ラックの端子座標、機種横断の整合）である。どのタスクも、後のタスクが作るファイルを import しない。

---

## 設計判断（レビューで確認する決定表）

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| 1 | 方言ごとのデバイス番号の意味 | IRの `index` は**その機種で実際に使える点の通し番号**。OMRON は `X(12)` → `1.00`（ch0は12点しかないため）、シャープは `X(8)` → `000010`（8進） | 端子名（`spec.inputs[i].name`）とデバイス表記（`formatDevice(X(i))`）が同じ添字で引けるようにするため。CIOの16ビット/chをそのまま使うと `X(12)`=`0.12` が CP1E に無い点を指してしまい、`plc-reference` / `plc-static-checks` が使う「添字 → 端子」の対応に穴があく |
| 2 | 端子名とデバイス表記の関係 | **一致させない**。TOYOPUC は端子が `X0`〜`XF`・デバイスが `1X000`〜`1X00F`、シャープは端子が `A0`〜`B7`・デバイスが `000000`〜`000017` | 実機でも端子台の印字とプログラムのアドレスは別物である。3A の `plcWiringPlan()` も「割付の `x`/`y` は通し番号、端子名は機種仕様から引く」と書いてあり、その規約をそのまま守る |
| 3 | 共通のデバイス検査 | `device-rules.ts` の `collectDeviceIssues(program, rules)` に括り出し、**新しい3方言だけが使う**。`mitsubishi.ts` の `validate()` は現状のまま | 三菱の `errorMessages` のキー集合とメッセージ文言は既存テストが完全一致で見張っている（前提#5）。共通化のために三菱の文言を動かすと Phase 3 のテストを機能上の利得なしに書き換えることになる。重複は約50行で、範囲外メッセージの組み立て方は共通ヘルパ側が方言の `formatDevice` から導出する |
| 4 | 方言固有のバリデーション | `validate()` = 共通検査 ＋ 方言固有検査。固有検査は TOYOPUC が「X と Y、T と C の同一番号の併用禁止」（`device-conflict`）、シャープが8進桁（`parseDevice` 側）、OMRON が `ch.bit` のビット部00〜15（`parseDevice` 側） | §10.5 の「固有バリデーション」行そのまま。表記の誤り（8進に8、ビット部16）は**入力時**に `parseDevice` が弾くのが自然で、IRになった後には現れない。IRに残りうる誤りだけを `validate()` が見る |
| 5 | 「変換」不要スキンのショートカット | `convertStep: false` のスキン（CX-Programmer風・PCwin風）は**ショートカット表から「変換」の行を落とす** | 押しても何も起きないキーを表に出すと §12.1 のキー一覧が実機と食い違う。`withoutConvert()` の1行で落とせるようにした |
| 6 | 表記切替 | IRは書き換えない。`switchNotation(program, from, to)` が「デバイスの表記が変わる一覧（`changes`）」と「切替先の方言で表せない項目（`errors`）」を返すだけ | §10.7「同じIRを別スキンで表示する。切替時に対象方言のバリデータを走らせ、表現できないデバイス・設定値を一覧で示す」。IRはベンダー中立（3A 決定表#5）なので変換は要らない |
| 7 | 命令語リストの生成 | グリッドを「節点と枝」のグラフに直し、**直並列簡約**（同じ2点を結ぶ枝どうしを OR、次数2の中間節点で AND）で式に落としてから命令語に展開する。簡約しきれないグリッド（ブリッジ回路）は `not-series-parallel` を返す | 行ごとに `LD`〜`ORB` を並べる素朴な方法では、途中から分岐する回路（コイル手前だけの OR）で誤った並びになる。直並列簡約は約70行で、ラダーとして意味のある回路（＝直並列）はすべて正しく展開できる |
| 8 | 命令語リストのエラー文言 | `instruction-list.ts` が自前の文言表（`INSTRUCTION_LIST_MESSAGES`）を持つ。`DialectProfile.errorMessages` には足さない | 前提#5（三菱の `errorMessages` はキー集合が固定）。`errorMessages` は「`validate()` が返しうるコードの文言表」と定義し直す |
| 9 | 入力1点ぶんの仕様 | `PlcUnitSpec.inputs` を `readonly string[]` から `readonly PlcInputSpec[]`（`{name, com, ohms?}`）へ格上げし、`inputCommon: string` を `inputCommons: readonly string[]` に替える | §5.1.3 が CP1E の入力抵抗を点によって 3.3kΩ / 4.8kΩ と分けており、§10.1 が TOYOPUC・JW300 を「8点/COM」と定めている。どちらも機種で1つの値では表せない。出力（`PlcOutputSpec`）と同じ形になるので読み手の負担も減る |
| 10 | 壁コンセントへ繋ぐ端子 | `PlcUnitSpec.acPower: readonly [string, string]`（活線側・中性線側）を足し、`plc-reference` と `plcPowerIndependent` はここから引く | CP1E の電源端子は `L1` / `L2/N` で `L`/`N` ではない（§10.1）。`power` の先頭2つを使う規約は `PE` の位置（FX5U は `L`/`PE`/`N` の順）で破れる |
| 11 | ラック形の表現 | `PlcUnitDefinition.form: 'unit' \| 'rack'` と `modules?: readonly PlcModuleDefinition[]`（`{id, model, displayName, sizeMm, pos}`）。端子は従来どおり `unit.terminals` に**平らに**並べ、どのモジュールの端子かは `id` の接頭辞ではなく `modules[].pos` との包含で分かる | ネットリスト上はラックでも1部品（`PLC`）である（`to-netlist.ts` は `board.plcUnit.spec` だけを見る）。端子IDにモジュール名を入れると `PLC.IN-12.X0` となり、`plcWiringPlan()` の端子名の引き方が機種ごとに変わってしまう。3Dの箱を4つ描くのは 4B の仕事なので、寸法と位置だけを渡せばよい |
| 12 | ラックの端子配置 | 1モジュールにつき**2列 × 最大9段**（列オフセット +9mm / +26mm、段ピッチ13mm、上端から8mm）。実機の着脱式端子台は1列だが、当たり判定半径4mm（＝8mm離す必要）が高さ130mmに18点は入らない | §17 #11 が「並び順は前提・修正箇所は `terminals[].pos` のみ」としている。ピック可能であることは §8.2 の操作要件で、2列にすれば段間13mm・列間17mmで確実に満たせる |
| 13 | 機種にない入出力点 | `PlcRefSchema` ではなく `PlcProblemSchema` の `superRefine` で「`io.inputs[].x` / `io.outputs[].y` が機種の点数の範囲内か」を検査する（`plcUnitFor(model)` を使う） | `PlcRefSchema` は `{vendor, model}` しか見えないので割付を検査できない。`plcUnitFor()` が未対応機種に `undefined` を返したときは既存の「対応していないPLC機種です」の経路に任せる |
| 14 | 内蔵課題8題の扱い | JSONは**1文字も変えない**。4機種すべてで通ることを `plc-cross-validation.test.ts` が「`plc` だけ差し替えて再検証し、`judgePlcReference()` が合格する」形で確かめる | §16 Phase 4 の「4方言が切替できるアプリ」は同じ課題が機種を跨いで成立することを意味する。課題を機種別に増やすと §7.9 の題数（モードD 8題）と食い違う |

---

## Task 1: 方言プロファイルの共通土台（命令語キーの拡張・共有ショートカット表・共通デバイス検査）

**モデル: Sonnet-verbatim**

**Files:**
- Modify: `packages/plc-dialects/src/profile.ts`
- Create: `packages/plc-dialects/src/shortcuts.ts`
- Create: `packages/plc-dialects/src/device-rules.ts`
- Modify: `packages/plc-dialects/src/mitsubishi.ts`
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/device-rules.test.ts`（新規）
- Test: `packages/plc-dialects/test/skin.test.ts`（1行だけ追随。前提#6）

命令語リスト（Task 7）には `ANB`/`ORB`/`MC`/`MCR`/`END` と接点形の微分（`LDP`/`ANDP`/`ORP`）が要るが、現在の `InstructionKey` は13種で足りない（前提#4）。ここで24種に拡張し、三菱の表にも11キーを足す。あわせて、3方言が共通して使う「デバイス範囲・タイマ単位・カウンタ範囲の検査」と「GX Works3風キー割当の流用」（§17 #19）を括り出す。

| 決めること | 本タスクの実装 |
|---|---|
| 命令語キー | 24種（接点6 ＋ 接点形の微分6 ＋ ブロック接続2 ＋ 出力3 ＋ 出力形の微分2 ＋ タイマ・カウンタ2 ＋ MC/MCR/END 3） |
| `specialInverted` | 任意項目。シャープの `007366`（b接点で常時ON）のためにあり、他の3方言は持たない（§10.5 / §17 #22） |
| 共通デバイス検査 | `collectDeviceIssues(program, rules)`。三菱は**使わない**（決定表#3） |
| タイマ規則 | `TimerRule`（時間単位が一定の方言用）と `makeTimerPreset` / `makeParseTimerPreset`。三菱だけは番号帯で単位が変わるので自前実装のまま |

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/device-rules.test.ts`:

```ts
import {
  C,
  ctu,
  endNetwork,
  hline,
  IR_COLS,
  M,
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
import {
  collectDeviceIssues,
  collectDevices,
  makeParseTimerPreset,
  makeTimerPreset,
  type DeviceRuleSet,
  type TimerRule,
} from '../src/device-rules.js';
import { GX_STYLE_SHORTCUTS, withoutConvert } from '../src/shortcuts.js';
import { MITSUBISHI_FX5U } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** 試験用の架空方言: 10進・接頭辞つき・0.1秒刻みのタイマ。 */
const TIMER: TimerRule = {
  baseMs: 100,
  min: 1,
  max: 9999,
  unitLabel: '0.1秒',
  format: (count) => `#${String(count).padStart(4, '0')}`,
  parse: (text) => {
    const matched = /^#([0-9]{1,4})$/u.exec(text.trim());
    return matched === null ? undefined : Number(matched[1]);
  },
};

const RULES: DeviceRuleSet = {
  deviceRanges: {
    input: { radix: 10, prefix: 'I', min: 0, max: 7 },
    output: { radix: 10, prefix: 'Q', min: 0, max: 7 },
    internal: { radix: 10, prefix: 'W', min: 0, max: 15 },
    timer: { radix: 10, prefix: 'T', min: 0, max: 15 },
    counter: { radix: 10, prefix: 'K', min: 0, max: 15 },
    special: { radix: 10, prefix: 'SP', min: 0, max: 2 },
  },
  specialDevices: { 0: 'ON', 1: 'FIRST', 2: 'CLK' },
  formatDevice: (d) =>
    d.kind === 'special'
      ? (RULES.specialDevices[d.index] ?? `SP${d.index}`)
      : `${RULES.deviceRanges[d.kind].prefix}${d.index}`,
  timer: TIMER,
  counter: { min: 1, max: 999 },
};

describe('collectDevices（表記切替とバリデータが共用する走査）', () => {
  it('lists every device once, in grid order, with its place', () => {
    const p = program(
      network('n1', [rung(no(X(0)), out(Y(0))), [no(Y(0))]]),
      network('n2', [rung(no(M(1)), ctu(C(0), 3, X(1)))]),
      endNetwork(),
    );
    const uses = collectDevices(p);
    expect(uses.map((u) => `${u.device.kind}:${u.device.index}`)).toEqual([
      'input:0',
      'output:0',
      'internal:1',
      'counter:0',
      'input:1',
    ]);
    expect(uses[0]?.place).toEqual({ networkId: 'n1', row: 0, col: 0 });
  });
});

describe('makeTimerPreset / makeParseTimerPreset（時間単位が一定の方言）', () => {
  const timerPreset = makeTimerPreset(TIMER, RULES.formatDevice);
  const parseTimerPreset = makeParseTimerPreset(TIMER);

  it('renders and parses a preset on the fixed 0.1 s base', () => {
    expect(timerPreset(3000, T(0))).toEqual({ text: '#0030', device: T(0) });
    expect(parseTimerPreset('#0030', T(0))).toBe(3000);
  });

  it('refuses a preset the base cannot express or that is out of range', () => {
    expect(timerPreset(150, T(0))).toBeInstanceOf(Error);
    expect(String(timerPreset(150, T(0)))).toContain('0.1秒');
    expect(timerPreset(0, T(0))).toBeInstanceOf(Error);
    expect(timerPreset(1_000_000, T(0))).toBeInstanceOf(Error);
    expect(parseTimerPreset('30', T(0))).toBeInstanceOf(Error);
    expect(parseTimerPreset('#0000', T(0))).toBeInstanceOf(Error);
  });
});

describe('collectDeviceIssues（4方言で共通するデバイス検査）', () => {
  it('accepts a program inside every range', () => {
    const p = program(network('n1', [rung(no(X(0)), out(Y(1)))]), endNetwork());
    expect(collectDeviceIssues(p, RULES)).toEqual([]);
  });

  it('reports an out-of-range device with the dialect notation in the message', () => {
    const p = program(network('n1', [rung(no(X(9)), out(Y(0)))]), endNetwork());
    const errors = collectDeviceIssues(p, RULES);
    expect(errors.map((e) => e.code)).toEqual(['device-range']);
    expect(errors[0]?.message).toContain('I9');
    expect(errors[0]?.message).toContain('I0〜I7');
    expect(errors[0]?.networkId).toBe('n1');
  });

  it('separates timer-unit from timer-range', () => {
    const unit = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    expect(collectDeviceIssues(unit, RULES).map((e) => e.code)).toEqual(['timer-unit']);
    const over = program(network('n1', [rung(no(X(0)), ton(T(0), 1_000_000))]), endNetwork());
    expect(collectDeviceIssues(over, RULES).map((e) => e.code)).toEqual(['timer-range']);
  });

  it('reports a counter preset outside the range and an unmapped special device', () => {
    const counter = program(network('n1', [rung(no(X(0)), ctu(C(0), 1000, X(1)))]), endNetwork());
    expect(collectDeviceIssues(counter, RULES).map((e) => e.code)).toEqual(['counter-range']);
    const cell: Cell = { kind: 'contact', type: 'NO', device: { kind: 'special', index: 9 } };
    const special = program(network('n1', [rung(cell, out(Y(0)))]), endNetwork());
    const errors = collectDeviceIssues(special, RULES);
    expect(errors.map((e) => e.code)).toEqual(['special-unsupported']);
    expect(errors[0]?.message).toContain('SP9');
  });

  it('accepts the three special devices the rule set maps', () => {
    const p = program(network('n1', [rung(no(SP(0)), out(Y(0)))]), endNetwork());
    expect(collectDeviceIssues(p, RULES)).toEqual([]);
  });
});

describe('GX Works3風キー割当の共有（§17 #19）', () => {
  it('is the table the Mitsubishi profile publishes', () => {
    expect(MITSUBISHI_FX5U.shortcuts).toBe(GX_STYLE_SHORTCUTS);
  });

  it('drops the conversion row for skins that do not require a conversion step', () => {
    const table = withoutConvert(GX_STYLE_SHORTCUTS);
    expect(table.some((s) => s.action === 'convert')).toBe(false);
    expect(table).toHaveLength(GX_STYLE_SHORTCUTS.length - 1);
    expect(table.filter((s) => s.enabled === false)).toHaveLength(1);
  });
});

describe('命令語キーの拡張（Task 7 の命令語リストが使う）', () => {
  it('names the block, master-control, END and edge-contact instructions of 三菱', () => {
    const names = MITSUBISHI_FX5U.instructionNames;
    expect(names.andBlock).toBe('ANB');
    expect(names.orBlock).toBe('ORB');
    expect(names.mc).toBe('MC');
    expect(names.mcr).toBe('MCR');
    expect(names.end).toBe('END');
    expect(names.ldp).toBe('LDP');
    expect(names.ldf).toBe('LDF');
    expect(names.andp).toBe('ANDP');
    expect(names.andf).toBe('ANDF');
    expect(names.orp).toBe('ORP');
    expect(names.orf).toBe('ORF');
  });

  it('leaves the Mitsubishi profile without an inverted special device', () => {
    expect(MITSUBISHI_FX5U.specialInverted).toBeUndefined();
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/device-rules.test.ts
```

Expected: 失敗。`Failed to resolve import "../src/device-rules.js"`。

- [ ] **Step 3: `src/profile.ts` を拡張する**

`InstructionKey` の定義を次で置き換える:

```ts
/**
 * 命令語の項目。§10.5
 * 接点（`ld`〜`ori`）・接点形の微分（`ldp`〜`orf`）・ブロック接続（`andBlock` / `orBlock`）・
 * 出力（`out` / `set` / `rst`）・出力形の微分（`pulseUp` / `pulseDown`）・タイマ／カウンタ・
 * 区間制御（`mc` / `mcr`）・終端（`end`）の24項目。命令語リスト（§10.7）はこの表だけを使う。
 */
export type InstructionKey =
  | 'ld'
  | 'ldi'
  | 'and'
  | 'ani'
  | 'or'
  | 'ori'
  | 'ldp'
  | 'ldf'
  | 'andp'
  | 'andf'
  | 'orp'
  | 'orf'
  | 'andBlock'
  | 'orBlock'
  | 'out'
  | 'set'
  | 'rst'
  | 'pulseUp'
  | 'pulseDown'
  | 'timer'
  | 'counter'
  | 'mc'
  | 'mcr'
  | 'end';
```

`DialectProfile` の `specialDevices` の直後に次を足す:

```ts
  /**
   * 実機ではb接点で使う特殊デバイスの番号（シャープの `007366`＝常時ON。§10.5 / §17 #22）。
   * 4B のエディタはここに載っている番号の接点をb接点として描く。IRとランタイムは関知しない
   * （IRの `SP0` は常時ONという意味そのもので、表示だけが方言に依る）。
   */
  specialInverted?: readonly number[];
```

- [ ] **Step 4: `src/shortcuts.ts` を書く**

`packages/plc-dialects/src/shortcuts.ts`:

```ts
import type { ShortcutTable } from './profile.js';

/**
 * GX Works3風のキー割当表。設計仕様 §10.6 / §17 #19。
 *
 * PCwin風（JTEKT）と JW-300SP風（シャープ）は一次資料が未確認のため**この表を流用する**のが
 * §17.1 の前提方針である。実機の割当が判明したら、その方言のプロファイルでこの表を使うのを
 * やめて自前の表を置けばよい（修正箇所はスキン定義1箇所）。
 *
 * `confirmed: true` は PLC調査資料 §1-D で確認済みの割当（◎）、`false` は §17.1 の前提方針で
 * 採用した三菱系ツールの慣例（△）である。UIは △ に注記を出せる（§12.1）。
 */
export const GX_STYLE_SHORTCUTS: ShortcutTable = [
  { action: 'contact-no', keys: 'F5', label: 'a接点', confirmed: true },
  { action: 'contact-nc', keys: 'F6', label: 'b接点', confirmed: false },
  { action: 'or-contact-no', keys: 'Shift+F5', label: 'OR a接点', confirmed: false },
  { action: 'or-contact-nc', keys: 'Shift+F6', label: 'OR b接点', confirmed: false },
  { action: 'coil', keys: 'F7', label: 'コイル', confirmed: true },
  {
    action: 'application',
    keys: 'F8',
    label: '応用命令',
    confirmed: true,
    enabled: false,
    note: '本アプリのラダーIRには応用命令に対応するセル種別がありません（§10.3）',
  },
  { action: 'hline', keys: 'F9', label: '横線', confirmed: false },
  { action: 'vline', keys: 'Shift+F9', label: '縦線', confirmed: false },
  {
    action: 'rule-line',
    keys: 'Ctrl+←↑↓→',
    label: '罫線（縦線・横線の作図）',
    confirmed: true,
    note: '`setVerticalLink()` / `setCell()`（`ladder-core` の編集API）に対応する',
  },
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

/**
 * 「変換」の行を落とした表を返す。§10.6
 * `convertStep: false` のスキン（CX-Programmer風・PCwin風）は変換操作を持たないので、
 * 押しても何も起きないキーを一覧に出さない（決定表#5）。
 */
export function withoutConvert(table: ShortcutTable): ShortcutTable {
  return table.filter((entry) => entry.action !== 'convert');
}
```

- [ ] **Step 5: `src/device-rules.ts` を書く**

`packages/plc-dialects/src/device-rules.ts`:

```ts
import type { Cell, Device, DeviceKind, LadderProgram } from '@ojt/ladder-core';
import type { DeviceRange, DialectError, TimerPresetText } from './profile.js';

/**
 * 4方言で共通するデバイス検査と、IRからデバイスを集める走査。設計仕様 §10.5 / §10.8。
 *
 * 三菱（`mitsubishi.ts`）は番号帯ごとにタイマの時間単位が変わるうえ、エラー文言が Phase 3 の
 * テストで固定されているので**この器を使わない**（決定表#3）。Phase 4 で足す3方言は時間単位が
 * 一定なので、ここに置いた `TimerRule` と `collectDeviceIssues()` をそのまま使える。
 */

/** 時間単位が一定の方言のタイマ規則（OMRON・JTEKT・シャープはいずれも0.1秒刻み）。 */
export interface TimerRule {
  /** 設定値1カウントの長さ[ms]。 */
  baseMs: number;
  /** 設定値カウントの下限。 */
  min: number;
  /** 設定値カウントの上限。 */
  max: number;
  /** エラー文言に出す単位名（`0.1秒`）。 */
  unitLabel: string;
  /** カウント → 方言の設定値表記。 */
  format(count: number): string;
  /** 方言の設定値表記 → カウント。読めなければ `undefined`。 */
  parse(text: string): number | undefined;
}

/** `DialectProfile.timerPreset` を作る。 */
export function makeTimerPreset(
  rule: TimerRule,
  formatDevice: (device: Device) => string,
): (ms: number, timer: Device) => TimerPresetText | Error {
  return (ms, timer) => {
    if (!Number.isInteger(ms) || ms <= 0 || ms % rule.baseMs !== 0) {
      return new Error(
        `${formatDevice(timer)} は${rule.unitLabel}単位で指定します（${ms}ms は指定できません）`,
      );
    }
    const count = ms / rule.baseMs;
    if (count < rule.min || count > rule.max) {
      return new Error(
        `${formatDevice(timer)} の設定値が範囲外です（${rule.format(rule.min)}〜${rule.format(rule.max)}）: ${rule.format(count)}`,
      );
    }
    return { text: rule.format(count), device: timer };
  };
}

/** `DialectProfile.parseTimerPreset` を作る。 */
export function makeParseTimerPreset(
  rule: TimerRule,
): (text: string, timer: Device) => number | Error {
  return (text) => {
    const count = rule.parse(text);
    if (count === undefined) return new Error(`読めないタイマ設定値です: ${text}`);
    if (count < rule.min || count > rule.max) {
      return new Error(
        `タイマ設定値が範囲外です（${rule.format(rule.min)}〜${rule.format(rule.max)}）: ${text}`,
      );
    }
    return count * rule.baseMs;
  };
}

/** 共通デバイス検査に要る方言の情報。 */
export interface DeviceRuleSet {
  deviceRanges: Readonly<Record<DeviceKind, DeviceRange>>;
  specialDevices: Readonly<Record<number, string>>;
  formatDevice(device: Device): string;
  timer: TimerRule;
  counter: { min: number; max: number };
}

/** デバイスが現れた位置。 */
export interface DevicePlace {
  networkId: string;
  row: number;
  col: number;
}

/** IR上のデバイス1件（最初に現れた位置つき）。 */
export interface DeviceUse {
  device: Device;
  place: DevicePlace;
}

/** セルが参照するデバイスを左から右の順に返す。 */
function devicesOf(cell: Cell): Device[] {
  if (cell.kind === 'contact' || cell.kind === 'coil' || cell.kind === 'mc' || cell.kind === 'mcr') {
    return [cell.device];
  }
  if (cell.kind === 'timer') return [cell.device];
  if (cell.kind === 'counter') return [cell.device, cell.resetDevice];
  return [];
}

/**
 * プログラムが使うデバイスを、グリッドの順（ネットワーク → 行 → 列）で重複なく集める。§10.7
 * 表記切替（`switchNotation()`）と共通デバイス検査の両方がこの走査を使う。
 */
export function collectDevices(source: LadderProgram): DeviceUse[] {
  const seen = new Set<string>();
  const uses: DeviceUse[] = [];
  for (const net of source.networks) {
    net.cells.forEach((cells, row) => {
      cells.forEach((cell, col) => {
        for (const target of devicesOf(cell)) {
          const key = `${target.kind}:${target.index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          uses.push({ device: target, place: { networkId: net.id, row, col } });
        }
      });
    });
  }
  return uses;
}

/** デバイス種別の番号帯を方言表記で書いた文字列（`I0〜I7`）。 */
function rangeLabel(rules: DeviceRuleSet, kind: DeviceKind): string {
  const range = rules.deviceRanges[kind];
  if (kind === 'special') return `${range.prefix}${range.min}〜${range.prefix}${range.max}`;
  const low = rules.formatDevice({ kind, index: range.min });
  const high = rules.formatDevice({ kind, index: range.max });
  return `${low}〜${high}`;
}

/** デバイス1つの番号帯を検査する。 */
function checkDevice(
  target: Device,
  place: DevicePlace,
  rules: DeviceRuleSet,
  errors: DialectError[],
): void {
  if (target.kind === 'special') {
    if (rules.specialDevices[target.index] !== undefined) return;
    const range = rules.deviceRanges.special;
    errors.push({
      code: 'special-unsupported',
      message: `この機種にはない特殊デバイスです（${rangeLabel(rules, 'special')}）: ${range.prefix}${target.index}`,
      device: target,
      ...place,
    });
    return;
  }
  const range = rules.deviceRanges[target.kind];
  if (target.index >= range.min && target.index <= range.max) return;
  errors.push({
    code: 'device-range',
    message: `${rules.formatDevice(target)} はこの機種のデバイス範囲外です（${rangeLabel(rules, target.kind)}）`,
    device: target,
    ...place,
  });
}

/** セル1つを検査する（設定値の検査もここで行う）。 */
function checkCell(
  cell: Cell,
  place: DevicePlace,
  rules: DeviceRuleSet,
  errors: DialectError[],
): void {
  if (cell.kind === 'timer') {
    const preset = makeTimerPreset(rules.timer, rules.formatDevice)(cell.presetMs, cell.device);
    if (preset instanceof Error) {
      const divisible =
        Number.isInteger(cell.presetMs) &&
        cell.presetMs > 0 &&
        cell.presetMs % rules.timer.baseMs === 0;
      errors.push({
        code: divisible ? 'timer-range' : 'timer-unit',
        message: preset.message,
        device: cell.device,
        ...place,
      });
    }
  } else if (cell.kind === 'counter') {
    if (cell.preset < rules.counter.min || cell.preset > rules.counter.max) {
      errors.push({
        code: 'counter-range',
        message: `カウンタ設定値が範囲外です（${rules.counter.min}〜${rules.counter.max}）: ${cell.preset}`,
        device: cell.device,
        ...place,
      });
    }
  }
  for (const target of devicesOf(cell)) checkDevice(target, place, rules, errors);
}

/**
 * デバイス範囲・タイマ単位・カウンタ範囲・未対応の特殊デバイスを検査する。§10.5 / §10.8
 * 方言固有の検査（TOYOPUC の同番号重複など）は各プロファイルがこの結果に足す。
 */
export function collectDeviceIssues(source: LadderProgram, rules: DeviceRuleSet): DialectError[] {
  const errors: DialectError[] = [];
  for (const net of source.networks) {
    net.cells.forEach((cells, row) => {
      cells.forEach((cell, col) => {
        if (cell.kind === 'empty') return;
        checkCell(cell, { networkId: net.id, row, col }, rules, errors);
      });
    });
  }
  return errors;
}
```

- [ ] **Step 6: `src/mitsubishi.ts` を追随させる**

`SHORTCUTS` の定義（`const SHORTCUTS: ShortcutTable = [ … ];` のブロック全体）と型 import の `ShortcutTable` を削除し、import に次を足す:

```ts
import { GX_STYLE_SHORTCUTS } from './shortcuts.js';
```

`MITSUBISHI_FX5U` の `shortcuts: SHORTCUTS,` を `shortcuts: GX_STYLE_SHORTCUTS,` に変える。`INSTRUCTION_NAMES` を次で置き換える:

```ts
/** 命令語。§10.5 / §17 #21（FX3系の体系を採用） */
const INSTRUCTION_NAMES: Readonly<Record<InstructionKey, string>> = {
  ld: 'LD',
  ldi: 'LDI',
  and: 'AND',
  ani: 'ANI',
  or: 'OR',
  ori: 'ORI',
  ldp: 'LDP',
  ldf: 'LDF',
  andp: 'ANDP',
  andf: 'ANDF',
  orp: 'ORP',
  orf: 'ORF',
  andBlock: 'ANB',
  orBlock: 'ORB',
  out: 'OUT',
  set: 'SET',
  rst: 'RST',
  pulseUp: 'PLS',
  pulseDown: 'PLF',
  timer: 'OUT T',
  counter: 'OUT C',
  mc: 'MC',
  mcr: 'MCR',
  end: 'END',
};
```

- [ ] **Step 7: `src/index.ts` に新しい公開物を足す**

`export { convert, … } from './convert.js';` の下に足す:

```ts
export {
  collectDeviceIssues,
  collectDevices,
  makeParseTimerPreset,
  makeTimerPreset,
  type DevicePlace,
  type DeviceRuleSet,
  type DeviceUse,
  type TimerRule,
} from './device-rules.js';

export { GX_STYLE_SHORTCUTS, withoutConvert } from './shortcuts.js';
```

- [ ] **Step 8: `test/skin.test.ts` を追随させる（前提#6）**

`expect(entry('application')?.note).toContain('Phase 4');` を次に置き換える:

```ts
    expect(entry('application')?.note).toContain('応用命令');
```

- [ ] **Step 9: GREEN を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run
```

Expected: `Test Files  6 passed`（既存5＋新規1）。`device-rules.test.ts` の全ケースが通り、`skin.test.ts` / `mitsubishi-validate.test.ts` / `profile.test.ts` / `convert.test.ts` / `mitsubishi-devices.test.ts` が引き続き通る。

- [ ] **Step 10: コミットする**

```powershell
pnpm --filter @ojt/plc-dialects exec tsc --noEmit
git add packages/plc-dialects
git commit -m "feat(plc-dialects): add the shared dialect groundwork for Phase 4"
```

---

## Task 2: OMRON CP1E プロファイル（CX-Programmer風）

**モデル: Sonnet**

**Files:**
- Create: `packages/plc-dialects/src/omron.ts`
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/omron.test.ts`

§10.5 の OMRON 列と §10.6 の CX-Programmer風の行を実装する。デバイスは `ch.bit` 形式の10進2桁（`0.00` / `100.00`）、特殊デバイスは `P_On` / `A200.11` / `P_1s`（§17 #22 で確定）、タイマは `TIM` の0.1秒・`#0000` 形式、**`convertStep: false`**（§16 Phase 4 受入基準①）。

| 決めること | 本タスクの実装 |
|---|---|
| 入力の番号 | CP1E-N30DR-A の実装点の通し番号。`X(0)`〜`X(11)` → `0.00`〜`0.11`、`X(12)`〜`X(17)` → `1.00`〜`1.05`（決定表#1） |
| 出力の番号 | `Y(0)`〜`Y(7)` → `100.00`〜`100.07`、`Y(8)`〜`Y(11)` → `101.00`〜`101.03` |
| 内部リレー | `W0.00`〜`W99.15`（`W` 帯。§10.5） |
| ビット部の検査 | `parseDevice('0.16')` は「ビット部は00〜15です」のエラー（§10.5 固有バリデーション） |
| 機種にない点 | `parseDevice('0.12')` は範囲外エラー（CP1E の ch0 は12点） |
| ショートカット | `C` a接点／`/` b接点／`O` コイル／`I` 命令入力／`Ctrl+E` オンライン編集／`Ctrl+Shift+E` 転送（PLC調査資料 §5-4 の○）、`W` 横線／`L` 縦線（△。§17.1） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/omron.test.ts`:

```ts
import {
  C,
  ctu,
  device,
  endNetwork,
  hline,
  IR_COLS,
  M,
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
import { getDialect, MAX_GRID_COLS, MIN_GRID_COLS, OMRON_CP1E } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = OMRON_CP1E;

describe('OMRON CP1E のデバイス表記（§10.5）', () => {
  it('is registered as the omron dialect', () => {
    expect(getDialect('omron')).toBe(profile);
    expect(profile.id).toBe('omron');
    expect(profile.displayName).toContain('CP1E');
    expect(profile.displayName).toContain('風');
  });

  it('formats inputs and outputs as CIO ch.bit (§16 Phase 4 受入基準②)', () => {
    expect(profile.formatDevice(X(0))).toBe('0.00');
    expect(profile.formatDevice(X(11))).toBe('0.11');
    expect(profile.formatDevice(X(12))).toBe('1.00');
    expect(profile.formatDevice(X(17))).toBe('1.05');
    expect(profile.formatDevice(Y(0))).toBe('100.00');
    expect(profile.formatDevice(Y(7))).toBe('100.07');
    expect(profile.formatDevice(Y(8))).toBe('101.00');
    expect(profile.formatDevice(Y(11))).toBe('101.03');
  });

  it('formats the work relays, timers and counters', () => {
    expect(profile.formatDevice(M(0))).toBe('W0.00');
    expect(profile.formatDevice(M(16))).toBe('W1.00');
    expect(profile.formatDevice(M(1599))).toBe('W99.15');
    expect(profile.formatDevice(T(0))).toBe('T0');
    expect(profile.formatDevice(C(255))).toBe('C255');
  });

  it('maps the three special devices (§17 #22)', () => {
    expect(profile.formatDevice(SP(0))).toBe('P_On');
    expect(profile.formatDevice(SP(1))).toBe('A200.11');
    expect(profile.formatDevice(SP(2))).toBe('P_1s');
    expect(profile.specialInverted).toBeUndefined();
  });

  it('parses the dialect notation back into IR devices', () => {
    expect(profile.parseDevice('0.00')).toEqual(X(0));
    expect(profile.parseDevice('1.05')).toEqual(X(17));
    expect(profile.parseDevice('100.07')).toEqual(Y(7));
    expect(profile.parseDevice('101.03')).toEqual(Y(11));
    expect(profile.parseDevice('W1.00')).toEqual(M(16));
    expect(profile.parseDevice('T3')).toEqual(T(3));
    expect(profile.parseDevice('C3')).toEqual(C(3));
    expect(profile.parseDevice('P_1s')).toEqual(SP(2));
    expect(profile.parseDevice('p_on')).toEqual(SP(0));
  });

  it('rejects a bit part outside 00〜15 (§10.5 固有バリデーション)', () => {
    expect(String(profile.parseDevice('0.16'))).toContain('00〜15');
    expect(String(profile.parseDevice('W0.16'))).toContain('00〜15');
    expect(profile.parseDevice('0.5')).toBeInstanceOf(Error);
  });

  it('rejects points this model does not have', () => {
    expect(profile.parseDevice('0.12')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1.06')).toBeInstanceOf(Error);
    expect(profile.parseDevice('100.08')).toBeInstanceOf(Error);
    expect(profile.parseDevice('2.00')).toBeInstanceOf(Error);
    expect(profile.parseDevice('T256')).toBeInstanceOf(Error);
    expect(profile.parseDevice('Z0')).toBeInstanceOf(Error);
    expect(profile.parseDevice('')).toBeInstanceOf(Error);
  });

  it('publishes the device ranges of this model', () => {
    expect(profile.deviceRanges.input).toEqual({ radix: 10, prefix: '', min: 0, max: 17 });
    expect(profile.deviceRanges.output).toEqual({ radix: 10, prefix: '', min: 0, max: 11 });
    expect(profile.deviceRanges.internal.max).toBe(1599);
    expect(profile.deviceRanges.timer.max).toBe(255);
    expect(profile.deviceRanges.counter.max).toBe(255);
  });
});

describe('OMRON CP1E のタイマ（§10.5 の TIM／0.1s）', () => {
  it('renders and parses the BCD preset', () => {
    expect(profile.timerPreset(3000, T(0))).toEqual({ text: '#0030', device: T(0) });
    expect(profile.timerPreset(999_900, T(0))).toEqual({ text: '#9999', device: T(0) });
    expect(profile.parseTimerPreset('#0030', T(0))).toBe(3000);
    expect(profile.parseTimerPreset('&30', T(0))).toBe(3000);
  });

  it('refuses a preset the 0.1 s base cannot express', () => {
    expect(profile.timerPreset(150, T(0))).toBeInstanceOf(Error);
    expect(String(profile.timerPreset(150, T(0)))).toContain('0.1秒');
    expect(profile.timerPreset(0, T(0))).toBeInstanceOf(Error);
    expect(profile.timerPreset(1_000_000, T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('30', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('#0000', T(0))).toBeInstanceOf(Error);
  });
});

describe('OMRON CP1E のバリデータとスキン（§10.5 / §10.6）', () => {
  it('accepts a program inside the ranges and reports one outside', () => {
    const ok = program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
    expect(profile.validate(ok)).toEqual([]);
    const ng = program(network('n1', [rung(no(X(0)), out(device('output', 12)))]), endNetwork());
    const errors = profile.validate(ng);
    expect(errors.map((e) => e.code)).toEqual(['device-range']);
    expect(errors[0]?.message).toContain('100.00〜101.03');
  });

  it('reports timer and counter presets outside the model range', () => {
    const t = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    expect(profile.validate(t).map((e) => e.code)).toEqual(['timer-unit']);
    const c = program(network('n1', [rung(no(X(0)), ctu(C(0), 10_000, X(1)))]), endNetwork());
    expect(profile.validate(c).map((e) => e.code)).toEqual(['counter-range']);
  });

  it('skips the conversion step and uses the OMRON monitor colour (§10.6 / 受入基準①)', () => {
    expect(profile.convertStep).toBe(false);
    expect(profile.monitorColors.powered).toBe('#2FA02C');
    expect(profile.gridCols).toBe(11);
    expect(profile.gridCols).toBeGreaterThanOrEqual(MIN_GRID_COLS);
    expect(profile.gridCols).toBeLessThanOrEqual(MAX_GRID_COLS);
  });

  it('binds the CX-Programmer keys of PLC調査資料 §5-4 and has no conversion key', () => {
    const keysOf = (action: string): string | undefined =>
      profile.shortcuts.find((s) => s.action === action)?.keys;
    expect(keysOf('contact-no')).toBe('C');
    expect(keysOf('contact-nc')).toBe('/');
    expect(keysOf('coil')).toBe('O');
    expect(keysOf('instruction')).toBe('I');
    expect(keysOf('online-edit')).toBe('Ctrl+E');
    expect(keysOf('transfer')).toBe('Ctrl+Shift+E');
    expect(keysOf('hline')).toBe('W');
    expect(keysOf('vline')).toBe('L');
    expect(keysOf('convert')).toBeUndefined();
  });

  it('names the instructions of §10.5', () => {
    const names = profile.instructionNames;
    expect(names.ldi).toBe('LD NOT');
    expect(names.rst).toBe('RSET');
    expect(names.pulseUp).toBe('DIFU');
    expect(names.pulseDown).toBe('DIFD');
    expect(names.ldp).toBe('LD UP');
    expect(names.orf).toBe('OR DOWN');
    expect(names.andBlock).toBe('AND LD');
    expect(names.orBlock).toBe('OR LD');
    expect(names.mc).toBe('IL');
    expect(names.mcr).toBe('ILC');
    expect(names.end).toBe('END');
    expect(names.timer).toBe('TIM');
    expect(names.counter).toBe('CNT');
  });

  it('borrows no vendor artwork or vendor name outside displayName (§17 / PLC調査資料 §6)', () => {
    const text = [
      profile.panels.tree,
      profile.panels.editor,
      profile.panels.output,
      ...profile.panels.toolbar,
      ...profile.shortcuts.map((s) => s.label),
      ...Object.values(profile.errorMessages),
    ].join('|');
    expect(text).not.toMatch(/CX-Programmer|OMRON|オムロン/iu);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/omron.test.ts
```

Expected: 失敗。`does not provide an export named 'OMRON_CP1E'`。

- [ ] **Step 3: `src/omron.ts` を書く**

`packages/plc-dialects/src/omron.ts`:

```ts
import {
  device,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  type Device,
  type DeviceKind,
  type LadderProgram,
} from '@ojt/ladder-core';
import {
  collectDeviceIssues,
  makeParseTimerPreset,
  makeTimerPreset,
  type DeviceRuleSet,
  type TimerRule,
} from './device-rules.js';
import type {
  DeviceRange,
  DialectError,
  DialectProfile,
  InstructionKey,
  MonitorColors,
  PanelLayout,
  ShortcutTable,
  SymbolDrawing,
} from './profile.js';

/**
 * OMRON CP1E-N30DR-A ＋ CX-Programmer風スキンの方言プロファイル。設計仕様 §10.5 / §10.6。
 *
 * デバイスは `ch.bit` の10進2桁（`0.00` / `100.00` / `W0.00`）で、IRの通し番号は
 * **この機種が実装している点の並び**に写す（入力は ch0 が12点・ch1 が6点、出力は ch100 が8点・
 * ch101 が4点。§10.1）。実機と異なると分かった場合の修正箇所はこのファイルだけである（§17.1）。
 */

/** 入力の ch0 の点数（残りは ch1）。§10.1 */
const INPUT_CH0_POINTS = 12;
/** 入力の総点数。§10.1 */
const INPUT_POINTS = 18;
/** 出力の ch100 の点数（残りは ch101）。§10.1 */
const OUTPUT_CH100_POINTS = 8;
/** 出力の総点数。§10.1 */
const OUTPUT_POINTS = 12;
/** 1チャネルのビット数。 */
const BITS_PER_CH = 16;
/** 内部リレー `W` の総点数（`W0`〜`W99CH`）。§10.5 */
const WORK_POINTS = 100 * BITS_PER_CH;

/** ビット部を2桁で書く。 */
function bit2(value: number): string {
  return String(value).padStart(2, '0');
}

/** デバイス種別ごとの番号体系。§10.5 */
const DEVICE_RANGES: Readonly<Record<DeviceKind, DeviceRange>> = {
  input: { radix: 10, prefix: '', min: 0, max: INPUT_POINTS - 1 },
  output: { radix: 10, prefix: '', min: 0, max: OUTPUT_POINTS - 1 },
  internal: { radix: 10, prefix: 'W', min: 0, max: WORK_POINTS - 1 },
  timer: { radix: 10, prefix: 'T', min: 0, max: 255 },
  counter: { radix: 10, prefix: 'C', min: 0, max: 255 },
  special: { radix: 10, prefix: 'SP', min: 0, max: 2 },
};

/** 特殊デバイス番号 → CP1E の実デバイス名。§10.5 / §17 #22 */
const SPECIAL_DEVICES: Readonly<Record<number, string>> = {
  [SPECIAL_ALWAYS_ON]: 'P_On',
  [SPECIAL_FIRST_SCAN]: 'A200.11',
  [SPECIAL_CLOCK_1S]: 'P_1s',
};

/** 実デバイス名（大文字化）→ 特殊デバイス番号。 */
const SPECIAL_BY_NAME = new Map<string, number>(
  Object.entries(SPECIAL_DEVICES).map(([index, name]) => [name.toUpperCase(), Number(index)]),
);

/** IRのデバイス → 方言表記。§10.5 */
function formatDevice(target: Device): string {
  switch (target.kind) {
    case 'special':
      return SPECIAL_DEVICES[target.index] ?? `SP${target.index}`;
    case 'input':
      return target.index < INPUT_CH0_POINTS
        ? `0.${bit2(target.index)}`
        : `1.${bit2(target.index - INPUT_CH0_POINTS)}`;
    case 'output':
      return target.index < OUTPUT_CH100_POINTS
        ? `100.${bit2(target.index)}`
        : `101.${bit2(target.index - OUTPUT_CH100_POINTS)}`;
    case 'internal':
      return `W${Math.floor(target.index / BITS_PER_CH)}.${bit2(target.index % BITS_PER_CH)}`;
    default:
      return `${DEVICE_RANGES[target.kind].prefix}${target.index}`;
  }
}

/** `ch.bit` を読む。ビット部は必ず2桁で00〜15。§10.5 の固有バリデーション */
function parseChannelBit(text: string): { ch: number; bit: number } | Error {
  const matched = /^([0-9]{1,3})\.([0-9]{2})$/u.exec(text);
  if (matched === null) {
    return new Error(`読めないデバイス表記です（<チャネル>.<ビット>）: ${text}`);
  }
  const bit = Number(matched[2]);
  if (bit > BITS_PER_CH - 1) {
    return new Error(`ビット部は00〜15です（1チャネルは16点）: ${text}`);
  }
  return { ch: Number(matched[1]), bit };
}

/** 番号が範囲内なら IR デバイス、外なら Error。 */
function inRange(kind: DeviceKind, index: number, text: string): Device | Error {
  const range = DEVICE_RANGES[kind];
  if (index < range.min || index > range.max) {
    const low = formatDevice({ kind, index: range.min });
    const high = formatDevice({ kind, index: range.max });
    return new Error(`この機種にはないデバイスです（${low}〜${high}）: ${text}`);
  }
  return device(kind, index);
}

/** 方言表記 → IRのデバイス。読めない表記は Error を返す（投げない）。§10.5 */
function parseDevice(text: string): Device | Error {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  const special = SPECIAL_BY_NAME.get(upper);
  if (special !== undefined) return device('special', special);
  const numbered = /^([TC])([0-9]+)$/u.exec(upper);
  if (numbered !== null) {
    const kind: DeviceKind = numbered[1] === 'T' ? 'timer' : 'counter';
    return inRange(kind, Number(numbered[2]), trimmed);
  }
  if (upper.startsWith('W')) {
    const work = parseChannelBit(upper.slice(1));
    if (work instanceof Error) return work;
    return inRange('internal', work.ch * BITS_PER_CH + work.bit, trimmed);
  }
  const parsed = parseChannelBit(upper);
  if (parsed instanceof Error) return parsed;
  if (parsed.ch === 0) return inRange('input', parsed.bit, trimmed);
  if (parsed.ch === 1) return inRange('input', INPUT_CH0_POINTS + parsed.bit, trimmed);
  if (parsed.ch === 100) return inRange('output', parsed.bit, trimmed);
  if (parsed.ch === 101) return inRange('output', OUTPUT_CH100_POINTS + parsed.bit, trimmed);
  return new Error(`この機種にはないチャネルです（0／1／100／101）: ${trimmed}`);
}

/** タイマ規則（`TIM`＝BCD・0.1秒・`#0000`〜`#9999`）。§10.5 */
const TIMER: TimerRule = {
  baseMs: 100,
  min: 1,
  max: 9999,
  unitLabel: '0.1秒',
  format: (count) => `#${String(count).padStart(4, '0')}`,
  // `TIMX`（BIN）の `&` 表記も読む。書き出しは `TIM`（BCD）の `#` に揃える（§10.5）
  parse: (text) => {
    const matched = /^[#&]([0-9]{1,5})$/u.exec(text.trim());
    return matched === null ? undefined : Number(matched[1]);
  },
};

const timerPreset = makeTimerPreset(TIMER, formatDevice);
const parseTimerPreset = makeParseTimerPreset(TIMER);

/** 共通デバイス検査に渡す規則。 */
const RULES: DeviceRuleSet = {
  deviceRanges: DEVICE_RANGES,
  specialDevices: SPECIAL_DEVICES,
  formatDevice,
  timer: TIMER,
  counter: { min: 1, max: 9999 },
};

/** 命令語。§10.5 の OMRON 列 */
const INSTRUCTION_NAMES: Readonly<Record<InstructionKey, string>> = {
  ld: 'LD',
  ldi: 'LD NOT',
  and: 'AND',
  ani: 'AND NOT',
  or: 'OR',
  ori: 'OR NOT',
  ldp: 'LD UP',
  ldf: 'LD DOWN',
  andp: 'AND UP',
  andf: 'AND DOWN',
  orp: 'OR UP',
  orf: 'OR DOWN',
  andBlock: 'AND LD',
  orBlock: 'OR LD',
  out: 'OUT',
  set: 'SET',
  rst: 'RSET',
  pulseUp: 'DIFU',
  pulseDown: 'DIFD',
  timer: 'TIM',
  counter: 'CNT',
  mc: 'IL',
  mcr: 'ILC',
  end: 'END',
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
const MONITOR_COLORS: MonitorColors = { powered: '#2FA02C', idle: '#6B7280' };

/** 画面構成。§10.6（「変換」ボタンを持たない） */
const PANELS: PanelLayout = {
  tree: 'プロジェクトツリー',
  editor: 'ラダー編集',
  output: '出力ウィンドウ',
  toolbar: ['オンライン編集', '転送［PC → PLC］', 'モニタ開始', 'モニタ停止', '運転／停止'],
};

/**
 * ショートカット表。§10.6
 * `confirmed: true` は PLC調査資料 §5-4 で確認できた割当（○）、`false` は §17.1 の前提方針で
 * 採用した割当（△）である。**「変換」は無い**（`convertStep: false`。決定表#5）。
 */
const SHORTCUTS: ShortcutTable = [
  { action: 'contact-no', keys: 'C', label: 'a接点', confirmed: true },
  { action: 'contact-nc', keys: '/', label: 'b接点', confirmed: true },
  { action: 'coil', keys: 'O', label: 'コイル', confirmed: true },
  { action: 'instruction', keys: 'I', label: '命令入力', confirmed: true },
  { action: 'online-edit', keys: 'Ctrl+E', label: 'オンライン編集', confirmed: true },
  { action: 'transfer', keys: 'Ctrl+Shift+E', label: '転送［PC → PLC］', confirmed: true },
  { action: 'hline', keys: 'W', label: '横線', confirmed: false },
  { action: 'vline', keys: 'L', label: '縦線', confirmed: false },
];

/** 方言エラーの日本語文言。§10.5 の `errorMessages` */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'device-range': 'デバイス番号がこの機種の範囲を超えています',
  'timer-unit': 'このタイマの時間単位では指定できない設定値です',
  'timer-range': 'タイマ設定値がこの機種の範囲を超えています',
  'counter-range': 'カウンタ設定値がこの機種の範囲を超えています',
  'special-unsupported': 'この機種に対応する特殊デバイスがありません',
};

/** 方言に依る検査。§10.5 / §10.8 */
function validate(source: LadderProgram): DialectError[] {
  return collectDeviceIssues(source, RULES);
}

/** OMRON CP1E-N30DR-A ＋ CX-Programmer風スキン。§10.5 / §10.6 */
export const OMRON_CP1E: DialectProfile = {
  id: 'omron',
  displayName: 'OMRON CP1E-N30DR-A（CX-Programmer風）',
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
  convertStep: false,
  monitorColors: MONITOR_COLORS,
  panels: PANELS,
  validate,
  errorMessages: ERROR_MESSAGES,
};
```

- [ ] **Step 4: `src/index.ts` に登録する**

`export { MITSUBISHI_FX5U, … } from './mitsubishi.js';` の下に `export { OMRON_CP1E } from './omron.js';` を足し、ファイル下部の `PROFILES` を次にする（`IMPLEMENTED_DIALECT_IDS` は Task 5 でまとめて直すので**ここでは触らない**）:

```ts
import { OMRON_CP1E } from './omron.js';

const PROFILES: Partial<Record<DialectId, DialectProfile>> = {
  mitsubishi: MITSUBISHI_FX5U,
  omron: OMRON_CP1E,
};
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/omron.test.ts
pnpm --filter @ojt/plc-dialects exec vitest run
```

Expected: `omron.test.ts` は全ケース通過。パッケージ全体では `test/profile.test.ts` の2ケース（`implements only Mitsubishi in Phase 3` と `throws a readable error for a dialect that Phase 4 will add`）が**一時的に落ちる**。これは Task 5 で直すので、落ちるのがこの2ケースだけであることを確認して先へ進む。

- [ ] **Step 6: コミットする**

```powershell
git add packages/plc-dialects
git commit -m "feat(plc-dialects): add the OMRON CP1E profile"
```

---
