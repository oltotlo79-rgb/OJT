# Plan 4A: 3方言プロファイル・表記切替・命令語リスト・PLC機種モデル（packages のみ）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 4（4方言の切替）の**ライブラリ側**を完成させる。すなわち `@ojt/plc-dialects` に OMRON CP1E（CX-Programmer風）・JTEKT TOYOPUC PC10G-1SP（PCwin風）・シャープ JW300（JW-300SP風）の3プロファイルと、表記切替（`switchNotation()`）・命令語リストのエクスポート（`instructionList()`）・方言バリデータを足し、`@ojt/circuit-sim` の `PlcUnitSpec` を「8点1コモン」「点ごとに入力抵抗が違う機種」に対応させ、`@ojt/board-model` に CP1E（一体形）・TOYOPUC ラック・JW300 ラックの本体定義を足し、`@ojt/content` のモードD課題を4機種すべてで開始できるようにする。**スキン画面・3D描画・設定画面・E2E はすべて Plan 4B の担当**である。

**Architecture:** Phase 3 で作った4層（IR → 方言 → 電気的実体 → 課題と判定）はそのまま使い、**層を増やさず各層に機種を足す**。①`@ojt/ladder-core` は**一切変更しない**（IRはベンダー中立。§17.1 の「修正箇所は方言プロファイル／スキン定義／盤モデルの3区分のみ」を実地で検証する回でもある）。②`@ojt/plc-dialects` は `mitsubishi.ts` と同じ形のファイルを3つ増やし、4プロファイルで共通する「デバイス範囲・タイマ単位・カウンタ範囲の検査」を `device-rules.ts` に、GX Works3風のキー割当の流用（§17 #19）を `shortcuts.ts` に括り出す。表記切替と命令語リストは**プロファイルを引数に取る純関数**で、方言ごとの分岐を持たない。③`@ojt/circuit-sim` の `PlcUnitSpec` は入力1点ぶんを `PlcInputSpec { name, com, ohms? }` に格上げする（TOYOPUC・JW300 は8点1コモン、CP1E は `0.00`〜`0.07` が 3.3kΩ・`0.08` 以降が 4.8kΩ。§5.1.3）。④`@ojt/board-model` に `PlcModuleDefinition` を足し、ラック形は「ベース＋モジュール」の入れ物として描ける形にする（3Dは 4B）。⑤`@ojt/content` は機種名の白紙リストを外し、機種にない入出力点を課題スキーマで弾き、静的チェックから三菱固有の正規表現（`/^PLC\.X\d+$/`）を取り除く。

**4A が触らないもの:** `packages/ladder-core/**`（IR・compile・runtime）、`packages/schematic-core/**`、そして `apps/desktop/**` — ただし Task 8 の型変更に追随する2行（`IoTable.tsx` L32 と `MonitorPanel.tsx` L94）だけは例外で、これを直さないと `pnpm -r typecheck` が通らない（B1）。画面・3D・設定・E2E はすべて 4B の担当である。

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
| 9 | `PlcUnitSpec` は現在 `inputCommon: string`（**単数**）と `inputs: readonly string[]`（端子名の配列。添字がIRの `device.index`）と `outputs: readonly PlcOutputSpec[]`（`{name, com}`）と `inputOhms?` / `onAmps?` / `offAmps?`（**機種で1つ**）を持つ。8点1コモンの機種と、点ごとに抵抗が違う CP1E はこの形では表せない | `packages/circuit-sim/src/plc.ts` L36-57 |
| 10 | `createPlcUnit()` は入力を `PLC.<inputCommon>`–`PLC.<入力端子>` 間の `load`（`plcInput`）、出力を `PLC.<出力端子>`–`PLC.<COM>` 間の `contact`（`driver: 'external'`）にする。電源端子（`spec.power`）は要素を持たない | `packages/circuit-sim/src/plc.ts` L73-151 |
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
| 21 | `plcWiringPlan()` は `unit.spec.inputs[x]` / `unit.spec.outputs[y]` / `unit.spec.inputCommon` / `terminalId('OUTLET','L')→plcTerminal('L')` を使う。入力コモンが複数ある機種と、電源端子名が `L`/`N` でない機種に対応が要る | `packages/content/src/plc-reference.ts` L93-139 |
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
| OMRON の接点形微分の命令名 | `LD UP` / `LD DOWN` / `AND UP` / `AND DOWN` / `OR UP` / `OR DOWN` | **本アプリの表記**（§10.5 は接点形を「`UP` / `DOWN`」とだけ書き、`LD`/`AND`/`OR` との綴り方を示していない。§17.1 の前提方針） | `omron.ts` の `INSTRUCTION_NAMES` |
| JTEKT のプログラム番号 | **1 固定**（`1X000` 形式）。`2`/`3` を入力するとエラー | 本アプリ独自（§10.5 の固有バリデーション欄は「プログラム番号の**1〜3**」で、2・3 も認めている。本アプリのIRが1プログラムしか持たないため1に絞った。意図的な差分#9） | `packages/plc-dialects/src/jtekt.ts` |
| TOYOPUC の入出力アドレス割付 | `X(i)` → `1X000` から連番（`IN-12` の16点は `1X000`〜`1X00F`）、`Y(i)` → **次の16点境界** `1Y010` から連番（`OUT-12` の16点は `1Y010`〜`1Y01F`）。出力の先頭アドレス `0x010` は定数 `OUTPUT_BASE` | 本アプリ独自（§10.5 は X・Y とも `000`〜`7FF` としか書かない。§10.5 の固有バリデーション「X と Y の同一番号の重複使用禁止」と既定の割付を両立させるために置いた。意図的な差分#14） | `jtekt.ts` の `OUTPUT_BASE` と `plc-unit.ts` の `PC10G_SPEC.outputs` |
| JTEKT のタイマ表記 | 設定値レジスタ `H` ＋ 16進4桁（`H001E` = 3.0s）、0.1s単位 | 本アプリ独自（§17 #20） | `jtekt.ts` |
| JTEKT の命令ニーモニック | 三菱系の `LD`/`LDI`/`AND`/`ANI`/`OR`/`ORI`/`OUT`/`SET`/`RST`/`PLS`/`PLF`/`ANB`/`ORB`/`MC`/`MCR`/`END`。タイマ・カウンタは `OUT` | 本アプリ独自（§17 #10） | `jtekt.ts` の `INSTRUCTION_NAMES` |
| シャープのリレー番号割付 | 入力ユニット（スロット1）= `000000`〜`000017`、出力ユニット（スロット2）= `000020`〜`000037`、内部リレー = `001000`〜`001777`（いずれも8進6桁） | 本アプリ独自（§10.5 は「割付はユニット装着位置による」とのみ規定） | `packages/plc-dialects/src/sharp.ts` |
| シャープのタイマ・カウンタ表記 | `TMR00000`〜`TMR17777` / `CNT00000`〜`CNT17777`（8進5桁）。実機は命令語の文脈で番号だけを書くが、`parseDevice()` が一意に読めるよう本アプリは接頭辞を付ける。設定値は0.1s単位の10進4桁（`0030` = 3.0s） | 本アプリ独自（§10.5 の `00000`〜`17777` と `DTMR(BCD) 00001 / 0100` の書式から） | `sharp.ts` |
| シャープの常時ON | `007366` を**b接点**で使う。プロファイルは `specialInverted` にこの番号を載せ、4B が b接点として描く | 一次資料（§10.5 / §17 #22） | `sharp.ts` |
| 4スキンの表示列数・通電色 | 接点11列、三菱 `#1E64FF` / OMRON `#2FA02C` / JTEKT `#E08A1E` / シャープ `#00A0C8` | 本アプリ既定（§10.6 / §17 #19） | 各プロファイルの `gridCols` / `monitorColors` |
| PCwin風・JW-300SP風のキー割当 | GX Works3風と同一（`shortcuts.ts` の `GX_STYLE_SHORTCUTS` を流用）。PCwin風は `convertStep: false` なので「変換」の行だけ落とす | 本アプリ独自（§17 #19） | `packages/plc-dialects/src/shortcuts.ts` |
| CP1E の出力COM分け | `COM0`〜`COM4` に 3/3/2/2/2 点（`100.00`〜`100.02` / `100.03`〜`100.05` / `100.06`〜`100.07` / `101.00`〜`101.01` / `101.02`〜`101.03`） | 本アプリ独自（§17.1・COM端子が5個であることは一次資料） | `packages/board-model/src/plc-unit.ts` |
| CP1E の電源端子名 | `L1` / `L2N`（銘板は `L2/N`。端子IDに `/` を使わないため）。入力端子台側に同居 | 一次資料（§10.1）＋端子ID規則 | `plc-unit.ts` |
| TOYOPUC の入出力の8点1コモン | `IN-12`（DC24V 16点）は**8点1コモン**。`OUT-12` も 5A/COM・2A/点 の記載から同じく8点1コモンとする | 入力側は一次資料（§10.1 の `IN-12` 欄「**8点/COM**」）、出力側は本アプリ独自 | `plc-unit.ts` |
| TOYOPUC のコモン端子名 | 入力 `ICOM0`（`X0`〜`X7`）/ `ICOM1`（`X8`〜`XF`）、出力 `COM0`（`Y10`〜`Y17`）/ `COM1`（`Y18`〜`Y1F`） | 本アプリ独自（§10.1 はコモンの**点数**だけを書き、端子名を示していない。端子名は部品ID `PLC` の下で一意である必要がある） | `plc-unit.ts` |
| JW300 の端子名 | 入力 `A0`〜`A7` ＋ `COM.A`、`B0`〜`B7` ＋ `COM.B`（§10.1 で確定）。出力は同じ様式で `C0`〜`C7` ＋ `COM.C`、`D0`〜`D7` ＋ `COM.D` | 入力は一次資料、出力は本アプリ独自 | `plc-unit.ts` |
| ラック形モジュールの外形・端子配置 | 1モジュール 幅35 × 高さ130 mm、奥行は TOYOPUC 120 / JW300 109.4（CUは99.8）。ベース外形 = モジュール幅合計＋左右各10mm、高さ140。端子は1モジュールにつき**2列×最大9段**（列間17mm・段間13mm）に並べる（当たり判定半径4mmが重ならない最小構成） | 本アプリ独自（§10.1・§17 #11・§17.1 の TOYOPUC 外形前提） | `plc-unit.ts` |
| 各機種のPLC入力しきい値 | FX5U のみ ON 3.5mA（§5.1.3）。CP1E・TOYOPUC・JW300 は `circuit-sim` の既定（ON 3mA / OFF 1.5mA）を使う。24V印加時の入力電流は CP1E 5.0mA（4.8kΩの点）・JW300 **約7.3mA**（24V ÷ 3.3kΩ = 7.27mA。§5.1.3 の 7.5mA は丸めた値）・TOYOPUC 10.0mA でいずれもON判定を超える | 本アプリ独自（各社の感度はPLC調査資料に無い） | `plc-unit.ts` の `*_SPEC` |
| 機種の**外観**（筐体色・端子カバー・LED位置・正面の造作） | 外形寸法はカタログ値（§10.1）。色と面上の配置は一般に知られた見え方を再現した本アプリの記述: FX5U＝濃灰の筐体＋明灰のヒンジ式端子カバー、CP1E＝明灰（アイボリー）の筐体＋黒の端子台、TOYOPUC・JW300＝明灰のモジュール＋黒の端子台。LED列・RUN/STOPスイッチ・Ethernet／SD／USB・スロットラッチは §10.1 の記載と一般的な前面構成から置く | 寸法は一次資料（カタログ）、色と配置は本アプリ独自（実機写真・純正画像は使わない。§17.1 / PLC調査資料 §6・§7） | `packages/board-model/src/plc-unit.ts` の `*_APPEARANCE` |
| 銘板の表記 | **型式の文字列だけ**（`FX5U-32MR/ES` / `CP1E-N30DR-A` / `PC10G-1SP` / `JW-212NA` …）。ロゴ・商標図形・ブランド名（`MELSEC` / `TOYOPUC` 等）は3Dに描かない。商標の帰属は設定画面の `trademarkNotice`（§15、Phase 1D で実装済み）に載せる | 本アプリ独自 | 同上（`nameplate`） |

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
| `packages/board-model/src/plc-unit.ts` | **変更**: FX5U を新しい `PlcUnitSpec` に追随、CP1E・TOYOPUC ラック・JW300 ラックを追加、`PLC_UNITS` に4機種登録、**各機種・各モジュールの外観記述（`PlcAppearance`）**。§10.1 / §5.1.3 / §17 #11 |
| `packages/board-model/src/index.ts` | **変更**: 再エクスポート |
| `packages/content/src/schema/plc.ts` | **変更**: `SUPPORTED_PLC_MODELS`（4機種）、機種にない入出力点の検証。§7.6 |
| `packages/content/src/plc-reference.ts` | **変更**: 複数入力コモン・機種別AC端子に対応した模範配線。§10.2 |
| `packages/content/src/plc-static-checks.ts` | **変更**: 三菱固有の正規表現を撤去し機種仕様から端子集合を引く。§10.8 |
| `packages/content/src/index.ts` | **変更**: 公開APIの確定 |
| `apps/desktop/src/renderer/ladder/IoTable.tsx` | **変更**: L32 の1行だけ（`unit.spec.inputs[x]` → `?.name`）。Task 8 の型追随（B1） |
| `apps/desktop/src/renderer/ladder/MonitorPanel.tsx` | **変更**: L94 の1行だけ（同上） |
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
| 2 | 端子名とデバイス表記の関係 | **一致させない**。TOYOPUC は端子が `X0`〜`XF` / `Y10`〜`Y1F`・デバイスが `1X000`〜`1X00F` / `1Y010`〜`1Y01F`、シャープは端子が `A0`〜`B7`・デバイスが `000000`〜`000017` | 実機でも端子台の印字とプログラムのアドレスは別物である。3A の `plcWiringPlan()` も「割付の `x`/`y` は通し番号、端子名は機種仕様から引く」と書いてあり、その規約をそのまま守る |
| 3 | 共通のデバイス検査 | `device-rules.ts` の `collectDeviceIssues(program, rules)` に括り出し、**新しい3方言だけが使う**。`mitsubishi.ts` の `validate()` は現状のまま | 三菱の `errorMessages` のキー集合とメッセージ文言は既存テストが完全一致で見張っている（前提#5）。共通化のために三菱の文言を動かすと Phase 3 のテストを機能上の利得なしに書き換えることになる。重複は約50行で、範囲外メッセージの組み立て方は共通ヘルパ側が方言の `formatDevice` から導出する |
| 4 | 方言固有のバリデーション | `validate()` = 共通検査 ＋ 方言固有検査。固有検査は TOYOPUC が「X と Y、T と C の同一番号の併用禁止」（`device-conflict`）、シャープが8進桁（`parseDevice` 側）、OMRON が `ch.bit` のビット部00〜15（`parseDevice` 側） | §10.5 の「固有バリデーション」行そのまま。表記の誤り（8進に8、ビット部16）は**入力時**に `parseDevice` が弾くのが自然で、IRになった後には現れない。IRに残りうる誤りだけを `validate()` が見る |
| 5 | 「変換」不要スキンのショートカット | `convertStep: false` のスキン（CX-Programmer風・PCwin風）は**ショートカット表から「変換」の行を落とす** | 押しても何も起きないキーを表に出すと §12.1 のキー一覧が実機と食い違う。`withoutConvert()` の1行で落とせるようにした |
| 6 | 表記切替 | IRは書き換えない。`switchNotation(program, from, to)` が「デバイスの表記が変わる一覧（`changes`）」と「切替先の方言で表せない項目（`errors`）」を返すだけ | §10.7「同じIRを別スキンで表示する。切替時に対象方言のバリデータを走らせ、表現できないデバイス・設定値を一覧で示す」。IRはベンダー中立（3A 決定表#5）なので変換は要らない |
| 7 | 命令語リストの生成 | グリッドを「節点と枝」のグラフに直し、**直並列簡約**（同じ2点を結ぶ枝どうしを OR、次数2の中間節点で AND）で式に落としてから命令語に展開する。簡約しきれないグリッド（ブリッジ回路）は `not-series-parallel` を返す | 行ごとに `LD`〜`ORB` を並べる素朴な方法では、途中から分岐する回路（コイル手前だけの OR）で誤った並びになる。直並列簡約は約70行で、ラダーとして意味のある回路（＝直並列）はすべて正しく展開できる |
| 8 | 命令語リストのエラー文言 | `instruction-list.ts` が自前の文言表（`INSTRUCTION_LIST_MESSAGES`）を持つ。`DialectProfile.errorMessages` には足さない | 前提#5（三菱の `errorMessages` はキー集合が固定）。`errorMessages` は「`validate()` が返しうるコードの文言表」と定義し直す |
| 9 | 入力1点ぶんの仕様 | `PlcUnitSpec.inputs` を `readonly string[]` から `readonly PlcInputSpec[]`（`{name, com, ohms?}`）へ格上げし、`inputCommon: string` を `inputCommons: readonly string[]` に替える | §5.1.3 が CP1E の入力抵抗を点によって 3.3kΩ / 4.8kΩ と分けており、§10.1 が TOYOPUC・JW300 を「8点/COM」と定めている。どちらも機種で1つの値では表せない。出力（`PlcOutputSpec`）と同じ形になるので読み手の負担も減る |
| 10 | 壁コンセントへ繋ぐ端子 | `PlcUnitSpec.acPower: readonly [string, string]`（活線側・中性線側）を足し、`plc-reference` と `plcPowerIndependent` はここから引く | CP1E の電源端子は `L1` / `L2/N` で `L`/`N` ではない（§10.1）。`power` の先頭2つを使う規約は `PE` の位置（FX5U は `L`/`PE`/`N` の順）で破れる |
| 11 | ラック形の表現 | `PlcUnitDefinition.form: 'unit' \| 'rack'` と `modules?: readonly PlcModuleDefinition[]`（`{id, model, displayName, sizeMm, pos}`）。端子は従来どおり `unit.terminals` に**平らに**並べ、どのモジュールの端子かは `id` の接頭辞ではなく `modules[].pos` との包含で分かる | ネットリスト上はラックでも1部品（`PLC`）である（`to-netlist.ts` は `board.plcUnit.spec` だけを見る）。端子IDにモジュール名を入れると `PLC.IN-12.X0` となり、`plcWiringPlan()` の端子名の引き方が機種ごとに変わってしまう。3Dの箱を4つ描くのは 4B の仕事なので、寸法と位置だけを渡せばよい |
| 12 | ラックの端子配置 | 1モジュールにつき**2列 × 最大9段**（列オフセット +9mm / +26mm、段ピッチ13mm、上端から14mm）。上の14mmは入出力表示灯の帯に空ける。実機の着脱式端子台は1列だが、当たり判定半径4mm（＝8mm離す必要）が高さ130mmに18点は入らない | §17 #11 が「並び順は前提・修正箇所は `terminals[].pos` のみ」としている。ピック可能であることは §8.2 の操作要件で、2列にすれば段間13mm・列間17mmで確実に満たせる |
| 13 | 機種にない入出力点 | `PlcRefSchema` ではなく `PlcProblemSchema` の `superRefine` で「`io.inputs[].x` / `io.outputs[].y` が機種の点数の範囲内か」を検査する（`plcUnitFor(model)` を使う） | `PlcRefSchema` は `{vendor, model}` しか見えないので割付を検査できない。`plcUnitFor()` が未対応機種に `undefined` を返したときは既存の「対応していないPLC機種です」の経路に任せる |
| 14 | 内蔵課題8題の扱い | JSONは**1文字も変えない**。4機種すべてで通ることを `plc-cross-validation.test.ts` が「`plc` だけ差し替えて再検証し、`judgePlcReference()` が合格する」形で確かめる | §16 Phase 4 の「4方言が切替できるアプリ」は同じ課題が機種を跨いで成立することを意味する。課題を機種別に増やすと §7.9 の題数（モードD 8題）と食い違う |
| 15 | 3Dの外観をどこに持つか | `PlcUnitDefinition.appearance` / `PlcModuleDefinition.appearance`（`PlcAppearance`）に**データとして**持ち、4B はそれを読んで描くだけにする。色はhex、寸法・矩形はmm、座標系は「正面の左上が原点・x右・y下」 | 利用者の要求は「各メーカーのシーケンサーの外観を忠実に再現する」ことだが、実機写真・純正画像は入手できない（§17.1 / PLC調査資料 §7）。カタログの外形寸法と一般に知られた見え方から**自前で作図**し、値を1ファイルに集める。4B に色や座標を直書きすると、実機と違うと分かったときの修正箇所が3Dコンポーネントに散る（§17.1 の「修正箇所は盤モデル」を守れない） |
| 16 | TOYOPUC の X と Y のアドレス | **同じアドレス空間に置き、出力を次の16点境界からにずらす**。`X(i)` → `1X000`＋i、`Y(i)` → `1Y010`＋i（`OUTPUT_BASE = 0x010`）。同番号検査（`checkNumberConflicts`）は IRの `index` ではなく**この写像を通したアドレス**どうしを比べる | §10.5 の固有バリデーションは「X と Y、T と C の同一番号の重複使用禁止」である（実機では同じ番号のXとYが同じI/Oメモリを指す）。IRの `index` をそのまま X・Y 両方のアドレスにすると、内蔵8題がすべて `X(0)`＋`Y(0)` を使うため `convert()` が全題 `device-conflict` になり、Task 14 が通らない。実機のラックでも入力モジュールと出力モジュールは別のアドレスに実装されるので、既定の割付を「`IN-12` が `1X000`〜`1X00F`、`OUT-12` が `1Y010`〜`1Y01F`」とすれば衝突は起きず、検査は**利用者が明示的に同じ番号を書いたとき**（`1X010` と `1Y010`）にだけ働く。却下案: ①検査を落とす → §10.5 の固有バリデーションを実装しないことになる ②`index` を比べたまま内蔵課題のJSONを書き換える → 決定表#14（JSONは1文字も変えない）に反する |
| 17 | TOYOPUC の T と C のアドレス | **ずらさない**（`1T000` と `1C000` は併用できないまま）。内蔵8題はタイマを使う題（d-003〜d-006）とカウンタを使う題（d-007）が分かれており、同じ題でTとCを併用していないので衝突しない（実コードで確認済み） | X/Y と違い、TとCを同じ課題で使う要求が今のところ無い。必要になった時点で #16 と同じ要領で `COUNTER_BASE` を置けばよく、そのときの修正箇所は `jtekt.ts` の1ファイルである |
| 18 | 模範配線と `ioAssignment` が見る入力コモンの範囲 | 模範配線と `ioAssignment` は**使う点のコモンだけ**を見る（使わない群は浮かせたまま）— ラック機種を1端子2本の予算内に収めるため、未使用の `ICOM1` / `COM.B` の誤配線は判定しない | 8点1コモンの機種（ラック形）は入力コモンが複数ある。母線の鎖（§11.3）が全コモンを通すと、使わない群のコモンにも1本の渡り配線が要り、他の端子（チェック用回路など）が2本の予算を超えかねない。使わない群は模範配線でも浮いたままにしておけば、`ioAssignment` も「未配線」と「誤配線」を混同せずに済む。両者で判定が重複しないよう `usedInputCommons(unit, io)` を共有ヘルパに括り出した（レビュー M4） |

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

/**
 * チャネル内のビットを検査してからIRの通し番号に直す。§10.1 / 決定表#1
 * CP1E が実装しているのは ch0 が12点・ch1 が6点・ch100 が8点・ch101 が4点で、
 * `0.12` や `100.08` は「隣のチャネルの先頭」ではなく**この機種に無い点**である。
 * `inRange` にそのまま渡すと `0.12` が `1.00` と同じ通し番号（12）になってしまうので、
 * 通し番号に直す**前に**チャネル内の点数で弾く。
 */
function inChannel(
  kind: DeviceKind,
  ch: number,
  bit: number,
  points: number,
  base: number,
  text: string,
): Device | Error {
  if (bit >= points) {
    return new Error(`この機種にはないデバイスです（${ch}.00〜${ch}.${bit2(points - 1)}）: ${text}`);
  }
  return inRange(kind, base + bit, text);
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
  if (parsed.ch === 0) return inChannel('input', 0, parsed.bit, INPUT_CH0_POINTS, 0, trimmed);
  if (parsed.ch === 1) {
    const points = INPUT_POINTS - INPUT_CH0_POINTS;
    return inChannel('input', 1, parsed.bit, points, INPUT_CH0_POINTS, trimmed);
  }
  if (parsed.ch === 100) {
    return inChannel('output', 100, parsed.bit, OUTPUT_CH100_POINTS, 0, trimmed);
  }
  if (parsed.ch === 101) {
    const points = OUTPUT_POINTS - OUTPUT_CH100_POINTS;
    return inChannel('output', 101, parsed.bit, points, OUTPUT_CH100_POINTS, trimmed);
  }
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

Expected: `omron.test.ts` は全ケース通過。パッケージ全体では `test/profile.test.ts` の**3ケース**（`implements only Mitsubishi in Phase 3` / `keeps availableDialects() consistent with IMPLEMENTED_DIALECT_IDS` / `throws a readable error for a dialect that Phase 4 will add`）が**一時的に落ちる**。これは Task 5 で直すので、落ちるのがこの3ケースだけであることを確認して先へ進む。

- [ ] **Step 6: コミットする**

```powershell
git add packages/plc-dialects
git commit -m "feat(plc-dialects): add the OMRON CP1E profile"
```

---

## Task 3: JTEKT TOYOPUC PC10G-1SP プロファイル（PCwin風）と同番号重複バリデータ

**モデル: Opus**（§10.5 固有バリデーションの設計判断があるため）

**Files:**
- Create: `packages/plc-dialects/src/jtekt.ts`
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/jtekt.test.ts`

§10.5 の JTEKT 列（16進デバイス、先頭の `1` はプログラム番号）と §10.6 の PCwin風の行を実装する。命令ニーモニックは §17 #10 の前提（三菱系の流用）、タイマ単位は §17 #20 の前提（0.1秒）、特殊デバイスは §17 #22 の前提割当（`1V00` / `1V01` / `V072`）である。**この機種だけが持つ検査**が「X と Y、T と C の同一番号の併用禁止」（§10.5 固有バリデーション・調査資料 §8.1）である。この検査を素直に実装すると内蔵8題（`X(0)`＋`Y(0)` を使う）が全題エラーになるため、**出力のアドレスを入力の次の16点境界からにずらす**（`OUTPUT_BASE = 0x010`）。検査は IRの通し番号ではなく**ずらした後のアドレス**どうしを比べる（決定表#16・意図的な差分#14）。

| 決めること | 本タスクの実装 |
|---|---|
| デバイス表記 | `1X000`〜`1X7FF`（16進3桁・大文字）。`1M` は同じ形、`1T` / `1C` は `000`〜`1FF` |
| 入出力アドレス | `X(i)` → `1X000`＋i（`IN-12` の16点は `1X000`〜`1X00F`）、`Y(i)` → `1Y010`＋i（`OUT-12` の16点は `1Y010`〜`1Y01F`）。出力の上限は `1Y7FF` なので `deviceRanges.output.max` は 2031（決定表#16） |
| プログラム番号 | **1 固定**。`parseDevice('2X000')` は「プログラム番号は1です」のエラー（前提表） |
| タイマ設定値 | 設定値レジスタ `H` ＋ 16進4桁。`H001E` = 30カウント = 3.0s（前提表） |
| 同番号重複 | **アドレス**どうしを比べる。`1X010`（＝`X(16)`）と `1Y010`（＝`Y(0)`）を同じプログラムで使うと `device-conflict`。`1T000` と `1C000` も同様。既定の割付（`X(0)`＋`Y(0)`）では衝突しない（§16 Phase 4 受入基準③の3A側・決定表#16） |
| 変換 | **不要**（`convertStep: false`。スクリーンエディタ方式。§10.6）。ショートカットは GX Works3風から「変換」を落として流用（§17 #19） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/jtekt.test.ts`:

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
import { getDialect, GX_STYLE_SHORTCUTS, JTEKT_PC10G } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = JTEKT_PC10G;

describe('JTEKT TOYOPUC PC10G-1SP のデバイス表記（§10.5 / PLC調査資料 §3-B）', () => {
  it('is registered as the jtekt dialect', () => {
    expect(getDialect('jtekt')).toBe(profile);
    expect(profile.id).toBe('jtekt');
    expect(profile.displayName).toContain('PC10G-1SP');
    expect(profile.displayName).toContain('風');
  });

  it('formats every device kind in hexadecimal with the program number 1', () => {
    expect(profile.formatDevice(X(0))).toBe('1X000');
    expect(profile.formatDevice(X(15))).toBe('1X00F');
    expect(profile.formatDevice(X(2047))).toBe('1X7FF');
    expect(profile.formatDevice(M(255))).toBe('1M0FF');
    expect(profile.formatDevice(T(511))).toBe('1T1FF');
    expect(profile.formatDevice(C(0))).toBe('1C000');
  });

  it('starts the outputs at the next 16-point boundary (決定表#16)', () => {
    // `IN-12` の16点が `1X000`〜`1X00F`、`OUT-12` の16点が `1Y010`〜`1Y01F` になる。
    // 既定の割付（`X(0)` と `Y(0)`）で X と Y のアドレスが衝突しないようにするため
    expect(profile.formatDevice(Y(0))).toBe('1Y010');
    expect(profile.formatDevice(Y(15))).toBe('1Y01F');
    expect(profile.formatDevice(Y(16))).toBe('1Y020');
    expect(profile.formatDevice(Y(2031))).toBe('1Y7FF');
  });

  it('maps the three special devices (§17 #22 の前提割当)', () => {
    expect(profile.formatDevice(SP(0))).toBe('1V00');
    expect(profile.formatDevice(SP(1))).toBe('1V01');
    expect(profile.formatDevice(SP(2))).toBe('V072');
    expect(profile.specialInverted).toBeUndefined();
  });

  it('parses the dialect notation back into IR devices', () => {
    expect(profile.parseDevice('1X00F')).toEqual(X(15));
    expect(profile.parseDevice('1x00f')).toEqual(X(15));
    expect(profile.parseDevice('1Y010')).toEqual(Y(0));
    expect(profile.parseDevice('1Y01F')).toEqual(Y(15));
    expect(profile.parseDevice('1M0FF')).toEqual(M(255));
    expect(profile.parseDevice('1T1FF')).toEqual(T(511));
    expect(profile.parseDevice('V072')).toEqual(SP(2));
  });

  it('rejects a program number other than 1 (前提表)', () => {
    expect(String(profile.parseDevice('2X000'))).toContain('プログラム番号');
    expect(String(profile.parseDevice('3Y000'))).toContain('プログラム番号');
  });

  it('rejects out-of-range and unreadable notations', () => {
    expect(profile.parseDevice('1X800')).toBeInstanceOf(Error);
    // 出力は `1Y010` から始まるので `1Y000`〜`1Y00F` はこの機種に無い（決定表#16）
    expect(profile.parseDevice('1Y000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1Y800')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1T200')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1G000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('1XGGG')).toBeInstanceOf(Error);
    expect(profile.parseDevice('')).toBeInstanceOf(Error);
  });

  it('publishes the device ranges of PLC調査資料 §3-B', () => {
    expect(profile.deviceRanges.input).toEqual({ radix: 16, prefix: '1X', min: 0, max: 2047 });
    // 出力は `OUTPUT_BASE`（0x010）ぶん後ろにずれるので、上限 `1Y7FF` は通し番号 2031
    expect(profile.deviceRanges.output).toEqual({ radix: 16, prefix: '1Y', min: 0, max: 2031 });
    expect(profile.deviceRanges.internal.max).toBe(2047);
    expect(profile.deviceRanges.timer.max).toBe(511);
    expect(profile.deviceRanges.counter.max).toBe(511);
  });
});

describe('JTEKT のタイマ（§17 #20 の前提: 0.1秒単位・設定値レジスタ H）', () => {
  it('renders and parses the hexadecimal preset', () => {
    expect(profile.timerPreset(3000, T(0))).toEqual({ text: 'H001E', device: T(0) });
    expect(profile.timerPreset(100, T(0))).toEqual({ text: 'H0001', device: T(0) });
    expect(profile.parseTimerPreset('H001E', T(0))).toBe(3000);
    expect(profile.parseTimerPreset('h1e', T(0))).toBe(3000);
  });

  it('refuses a preset the 0.1 s base cannot express', () => {
    expect(profile.timerPreset(150, T(0))).toBeInstanceOf(Error);
    expect(String(profile.timerPreset(150, T(0)))).toContain('0.1秒');
    expect(profile.timerPreset(0, T(0))).toBeInstanceOf(Error);
    expect(profile.timerPreset(10_000_000, T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('30', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('H0000', T(0))).toBeInstanceOf(Error);
  });
});

describe('JTEKT 固有のバリデーション（§10.5 / 調査資料 §8.1 / 受入基準③）', () => {
  it('rejects the same address used on both X and Y', () => {
    // `X(16)` は `1X010`、`Y(0)` は `1Y010` で**同じアドレス 0x010**（利用者が明示的に重ねた場合）
    const p = program(network('n1', [rung(no(X(16)), out(Y(0)))]), endNetwork());
    const errors = profile.validate(p);
    expect(errors.map((e) => e.code)).toEqual(['device-conflict']);
    expect(errors[0]?.message).toContain('1X010');
    expect(errors[0]?.message).toContain('1Y010');
    expect(errors[0]?.networkId).toBe('n1');
  });

  it('rejects the same number used on both T and C', () => {
    const p = program(
      network('n1', [rung(no(X(1)), ton(T(0), 1000))]),
      network('n2', [rung(no(X(2)), ctu(C(0), 3, X(3)))]),
      endNetwork(),
    );
    expect(profile.validate(p).map((e) => e.code)).toEqual(['device-conflict']);
  });

  it('accepts the default assignment where X and Y never collide (決定表#16)', () => {
    // 内蔵8題はすべて `X(0)`〜`X(2)` と `Y(0)`〜`Y(3)` を使う。出力が `1Y010` から始まるので通る
    const p = program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
    expect(profile.validate(p)).toEqual([]);
  });

  it('still reports the shared device-range issues', () => {
    const p = program(network('n1', [rung(no(X(1)), ton(T(0), 150))]), endNetwork());
    expect(profile.validate(p).map((e) => e.code)).toEqual(['timer-unit']);
    expect(profile.errorMessages['device-conflict']).toBeDefined();
  });
});

describe('PCwin風スキン（§10.6 / §17 #19）', () => {
  it('is a screen editor: no conversion step and no conversion key', () => {
    expect(profile.convertStep).toBe(false);
    expect(profile.shortcuts.some((s) => s.action === 'convert')).toBe(false);
    expect(profile.shortcuts).toHaveLength(GX_STYLE_SHORTCUTS.length - 1);
    expect(profile.shortcuts.find((s) => s.action === 'contact-no')?.keys).toBe('F5');
    expect(profile.shortcuts.find((s) => s.action === 'coil')?.keys).toBe('F7');
  });

  it('uses the JTEKT monitor colour and the shared grid width (§10.6 の本アプリ既定)', () => {
    expect(profile.monitorColors.powered).toBe('#E08A1E');
    expect(profile.gridCols).toBe(11);
  });

  it('names the instructions borrowed from the Mitsubishi set (§17 #10)', () => {
    const names = profile.instructionNames;
    expect(names.ld).toBe('LD');
    expect(names.ldi).toBe('LDI');
    expect(names.pulseUp).toBe('PLS');
    expect(names.andBlock).toBe('ANB');
    expect(names.orBlock).toBe('ORB');
    expect(names.mc).toBe('MC');
    expect(names.end).toBe('END');
    expect(names.timer).toBe('OUT');
    expect(names.counter).toBe('OUT');
  });

  it('borrows no vendor artwork or vendor name outside displayName', () => {
    const text = [
      profile.panels.tree,
      profile.panels.editor,
      profile.panels.output,
      ...profile.shortcuts.map((s) => s.label),
      ...Object.values(profile.errorMessages),
    ].join('|');
    expect(text).not.toMatch(/PCwin|TOYOPUC|JTEKT|ジェイテクト/iu);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/jtekt.test.ts
```

Expected: 失敗。`does not provide an export named 'JTEKT_PC10G'`。

- [ ] **Step 3: `src/jtekt.ts` を書く**

`packages/plc-dialects/src/jtekt.ts`:

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
  collectDevices,
  makeParseTimerPreset,
  makeTimerPreset,
  type DeviceRuleSet,
  type DeviceUse,
  type TimerRule,
} from './device-rules.js';
import { GX_STYLE_SHORTCUTS, withoutConvert } from './shortcuts.js';
import type {
  DeviceRange,
  DialectError,
  DialectProfile,
  InstructionKey,
  MonitorColors,
  PanelLayout,
  SymbolDrawing,
} from './profile.js';

/**
 * JTEKT TOYOPUC PC10G-1SP ＋ PCwin風スキンの方言プロファイル。設計仕様 §10.5 / §10.6。
 *
 * デバイス体系は PLC調査資料 §3-B の「PC10標準モード」（16進・先頭の数字はプログラム番号）で、
 * 本アプリは**プログラム1のみ**を使う（§17 #21 のとおり PC10G-1SP にそのまま対応する）。
 * 命令ニーモニック・タイマ時間単位・特殊リレー番号は一次資料が未入手のため §17 #10 / #20 / #22 の
 * 前提値である。実機と異なると分かった場合の修正箇所はこのファイルだけである（§17.1）。
 *
 * **入出力のアドレス割付**（決定表#16 / 意図的な差分#14）: §10.5 は X と Y を同じ番号帯
 * （`000`〜`7FF`）と書きつつ「X と Y の同一番号の重複使用禁止」も定めている。両方をそのまま
 * 実装すると `X(0)` と `Y(0)` を使う内蔵8題が全題エラーになるので、本アプリは実機のラック構成に
 * 合わせて **`IN-12` を `1X000`〜`1X00F`、`OUT-12` をその次の16点境界 `1Y010`〜`1Y01F`** に置く。
 * 同番号検査はIRの通し番号ではなく、この写像を通した**アドレス**どうしを比べる。
 */

/** 本アプリが使うプログラム番号。§10.5（先頭の 1/2/3 はプログラム番号） */
const PROGRAM_NUMBER = 1;

/** 出力の先頭アドレス（`IN-12` の16点の次の16点境界）。決定表#16 */
const OUTPUT_BASE = 0x010;

/** デバイス種別ごとの番号体系。PLC調査資料 §3-B */
const DEVICE_RANGES: Readonly<Record<DeviceKind, DeviceRange>> = {
  input: { radix: 16, prefix: '1X', min: 0, max: 0x7ff },
  // 出力は `OUTPUT_BASE` ぶん後ろにずれるので、上限は `1Y7FF` に当たる通し番号（0x7ff - 0x010）
  output: { radix: 16, prefix: '1Y', min: 0, max: 0x7ff - OUTPUT_BASE },
  internal: { radix: 16, prefix: '1M', min: 0, max: 0x7ff },
  timer: { radix: 16, prefix: '1T', min: 0, max: 0x1ff },
  counter: { radix: 16, prefix: '1C', min: 0, max: 0x1ff },
  special: { radix: 10, prefix: 'SP', min: 0, max: 2 },
};

/** 種別を表す1文字（プログラム番号の次の桁）。 */
const KIND_LETTER: Readonly<Record<string, DeviceKind>> = {
  X: 'input',
  Y: 'output',
  M: 'internal',
  T: 'timer',
  C: 'counter',
};

/** 特殊デバイス番号 → TOYOPUC の実デバイス名。§17 #22 の前提割当 */
const SPECIAL_DEVICES: Readonly<Record<number, string>> = {
  [SPECIAL_ALWAYS_ON]: '1V00',
  [SPECIAL_FIRST_SCAN]: '1V01',
  [SPECIAL_CLOCK_1S]: 'V072',
};

/** 実デバイス名（大文字化）→ 特殊デバイス番号。 */
const SPECIAL_BY_NAME = new Map<string, number>(
  Object.entries(SPECIAL_DEVICES).map(([index, name]) => [name.toUpperCase(), Number(index)]),
);

/** IRの通し番号 → この機種のアドレス（出力だけ `OUTPUT_BASE` ぶんずらす）。決定表#16 */
function addressOf(target: Device): number {
  return target.kind === 'output' ? target.index + OUTPUT_BASE : target.index;
}

/** IRのデバイス → 方言表記（16進3桁・大文字）。§10.5 */
function formatDevice(target: Device): string {
  if (target.kind === 'special') return SPECIAL_DEVICES[target.index] ?? `SP${target.index}`;
  const range = DEVICE_RANGES[target.kind];
  return `${range.prefix}${addressOf(target).toString(16).toUpperCase().padStart(3, '0')}`;
}

/** 方言表記 → IRのデバイス。読めない表記は Error を返す（投げない）。§10.5 */
function parseDevice(text: string): Device | Error {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  const special = SPECIAL_BY_NAME.get(upper);
  if (special !== undefined) return device('special', special);
  const matched = /^([0-9])([XYMTC])([0-9A-F]{1,3})$/u.exec(upper);
  if (matched === null) {
    return new Error(`読めないデバイス表記です（<プログラム番号><種別><16進3桁>）: ${trimmed}`);
  }
  if (Number(matched[1]) !== PROGRAM_NUMBER) {
    return new Error(`プログラム番号は${PROGRAM_NUMBER}です（本アプリはプログラム1のみ）: ${trimmed}`);
  }
  const kind = KIND_LETTER[matched[2] ?? ''];
  if (kind === undefined) return new Error(`読めないデバイス種別です: ${trimmed}`);
  // アドレス → IRの通し番号。出力は `1Y010` が `Y(0)` なので `OUTPUT_BASE` を引く（決定表#16）
  const address = parseInt(matched[3] ?? '', 16);
  const index = kind === 'output' ? address - OUTPUT_BASE : address;
  const range = DEVICE_RANGES[kind];
  if (index < range.min || index > range.max) {
    return new Error(
      `デバイス番号が範囲外です（${formatDevice({ kind, index: range.min })}〜${formatDevice({ kind, index: range.max })}）: ${trimmed}`,
    );
  }
  return device(kind, index);
}

/** タイマ規則（設定値レジスタ `H` ＋ 16進4桁、0.1秒単位）。§17 #20 の前提 */
const TIMER: TimerRule = {
  baseMs: 100,
  min: 1,
  max: 0xffff,
  unitLabel: '0.1秒',
  format: (count) => `H${count.toString(16).toUpperCase().padStart(4, '0')}`,
  parse: (text) => {
    const matched = /^H([0-9A-F]{1,4})$/u.exec(text.trim().toUpperCase());
    return matched === null ? undefined : parseInt(matched[1] ?? '', 16);
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
  counter: { min: 1, max: 0xffff },
};

/**
 * この機種だけの検査: **X と Y、T と C に同じ番号を使ってはならない**。§10.5 / 調査資料 §8.1
 * 同じ番号のX/Yは実機では同じメモリ領域を指すため、入力を読んだつもりで出力を読んでしまう。
 * 比べるのはIRの通し番号ではなく `addressOf()` を通した**アドレス**である（決定表#16）。
 * 既定の割付では `IN-12` が `0x000`〜`0x00F`、`OUT-12` が `0x010`〜`0x01F` で重ならないので、
 * ここが鳴るのは利用者が `1X010` と `1Y010` のように**明示的に同じ番号を書いたとき**だけである。
 * 指摘位置は「後から現れたほう」にする（先に書いた側を消させないため）。
 */
function checkNumberConflicts(source: LadderProgram): DialectError[] {
  const uses = collectDevices(source);
  const errors: DialectError[] = [];
  const pairs: readonly (readonly [DeviceKind, DeviceKind])[] = [
    ['input', 'output'],
    ['timer', 'counter'],
  ];
  for (const [first, second] of pairs) {
    const seen = new Map<number, DeviceUse>();
    for (const use of uses) {
      if (use.device.kind === first) seen.set(addressOf(use.device), use);
    }
    for (const use of uses) {
      if (use.device.kind !== second) continue;
      const other = seen.get(addressOf(use.device));
      if (other === undefined) continue;
      errors.push({
        code: 'device-conflict',
        message: `${formatDevice(other.device)} と ${formatDevice(use.device)} は同じアドレスです（この機種では併用できません）`,
        device: use.device,
        ...use.place,
      });
    }
  }
  return errors;
}

/** 命令語（§17 #10 の前提: 三菱系の流用）。タイマ・カウンタは `OUT` ＋ デバイス ＋ 設定値。 */
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
  timer: 'OUT',
  counter: 'OUT',
  mc: 'MC',
  mcr: 'MCR',
  end: 'END',
};

/** 記号の線画（自前の識別子）。§10.6 / §17 */
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
const MONITOR_COLORS: MonitorColors = { powered: '#E08A1E', idle: '#6B7280' };

/** 画面構成。§10.6（左にツリー、右にラダー編集、下にステータスバー） */
const PANELS: PanelLayout = {
  tree: 'プロジェクトツリー（プログラム／データファイル／パラメータ／LD／SFC）',
  editor: 'ラダー編集エリア',
  output: 'ステータスバー',
  toolbar: ['JP1', 'DGR', 'MOB', 'STP', 'RDY', 'RUN', 'RES', 'モニタ開始', 'モニタ停止'],
};

/** 方言エラーの日本語文言。§10.5 の `errorMessages` */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'device-range': 'デバイス番号がこの機種の範囲を超えています',
  'device-conflict': 'この機種では X と Y、T と C に同じ番号を使えません',
  'timer-unit': 'このタイマの時間単位では指定できない設定値です',
  'timer-range': 'タイマ設定値がこの機種の範囲を超えています',
  'counter-range': 'カウンタ設定値がこの機種の範囲を超えています',
  'special-unsupported': 'この機種に対応する特殊デバイスがありません',
};

/** 方言に依る検査。§10.5 / §10.8 */
function validate(source: LadderProgram): DialectError[] {
  return [...collectDeviceIssues(source, RULES), ...checkNumberConflicts(source)];
}

/** JTEKT TOYOPUC PC10G-1SP ＋ PCwin風スキン。§10.5 / §10.6 */
export const JTEKT_PC10G: DialectProfile = {
  id: 'jtekt',
  displayName: 'JTEKT TOYOPUC PC10G-1SP（PCwin風）',
  formatDevice,
  parseDevice,
  deviceRanges: DEVICE_RANGES,
  timerPreset,
  parseTimerPreset,
  specialDevices: SPECIAL_DEVICES,
  instructionNames: INSTRUCTION_NAMES,
  symbols: SYMBOLS,
  gridCols: 11,
  shortcuts: withoutConvert(GX_STYLE_SHORTCUTS),
  convertStep: false,
  monitorColors: MONITOR_COLORS,
  panels: PANELS,
  validate,
  errorMessages: ERROR_MESSAGES,
};
```

- [ ] **Step 4: `src/index.ts` に登録する**

`export { OMRON_CP1E } from './omron.js';` の下に `export { JTEKT_PC10G } from './jtekt.js';` を足し、`PROFILES` に `jtekt: JTEKT_PC10G,` を足す（`import { JTEKT_PC10G } from './jtekt.js';` も要る）。

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/jtekt.test.ts
```

Expected: 全ケース通過。

> `test/profile.test.ts` の3ケース（Task 2 Step 5 の注記と同じもの）は `IMPLEMENTED_DIALECT_IDS` を直す **Task 5 まで赤のまま**である。ここでは `test/jtekt.test.ts` だけを走らせ、パッケージ全体を走らせたときに落ちるのがその3ケースだけであることを確認する。

- [ ] **Step 6: コミットする**

```powershell
git add packages/plc-dialects
git commit -m "feat(plc-dialects): add the JTEKT TOYOPUC PC10G-1SP profile"
```

---

## Task 4: シャープ JW300 プロファイル（JW-300SP風）と8進バリデータ

**モデル: Opus**（リレー番号の割付と8進検査の設計判断があるため）

**Files:**
- Create: `packages/plc-dialects/src/sharp.ts`
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/sharp.test.ts`

§10.5 のシャープ列（8進リレー番号、`STR/AND/OR POS·NEG`、`OUT POS/NEG`、`SET`/`RST`、`AND STR`/`OR STR`、`F-40`/`F-47`/`F-48`）と §10.6 の JW-300SP風の行を実装する。命令ニーモニックは §17 #10 で**確定済み**（PLC調査資料 §4-C）、特殊リレーも §17 #22 で確定（`007366` は**b接点**で常時ON／`007362` 初期パルス／`007364` 1秒クロック）。リレー番号の割付（どのユニットが何番から始まるか）だけが本アプリの前提である。

| 決めること | 本タスクの実装 |
|---|---|
| リレー番号 | 8進6桁。入力ユニット（スロット1）`000000`〜`000017`、出力ユニット（スロット2）`000020`〜`000037`、内部リレー `001000`〜`001777`（前提表） |
| 8進の検査 | `parseDevice('000008')` は「8進で表記します（8・9は使えません）」のエラー（§16 Phase 4 受入基準④） |
| タイマ・カウンタ | `TMR00000`〜`TMR17777` / `CNT00000`〜`CNT17777`（8進5桁）。接頭辞は `parseDevice()` を一意にするための本アプリの表記（前提表） |
| 設定値 | 0.1秒単位の10進4桁（`0030` = 3.0s）。§10.5 の `DTMR(BCD) 00001 / 0100` の書式に合わせる |
| 常時ON | `specialInverted: [SPECIAL_ALWAYS_ON]`。4B は `007366` の接点をb接点で描く |
| 変換 | **必要**（`convertStep: true`。§17.1 の前提）。ショートカットは GX Works3風をそのまま流用 |

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/sharp.test.ts`:

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
  SPECIAL_ALWAYS_ON,
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { getDialect, GX_STYLE_SHORTCUTS, SHARP_JW300 } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = SHARP_JW300;

describe('シャープ JW300 のリレー番号（§10.5 / 前提表）', () => {
  it('is registered as the sharp dialect', () => {
    expect(getDialect('sharp')).toBe(profile);
    expect(profile.id).toBe('sharp');
    expect(profile.displayName).toContain('JW300');
    expect(profile.displayName).toContain('風');
  });

  it('numbers the relays in octal by unit slot', () => {
    expect(profile.formatDevice(X(0))).toBe('000000');
    expect(profile.formatDevice(X(7))).toBe('000007');
    expect(profile.formatDevice(X(8))).toBe('000010');
    expect(profile.formatDevice(X(15))).toBe('000017');
    expect(profile.formatDevice(Y(0))).toBe('000020');
    expect(profile.formatDevice(Y(15))).toBe('000037');
    expect(profile.formatDevice(M(0))).toBe('001000');
    expect(profile.formatDevice(M(511))).toBe('001777');
  });

  it('prefixes timers and counters so the notation can be read back (前提表)', () => {
    expect(profile.formatDevice(T(0))).toBe('TMR00000');
    expect(profile.formatDevice(T(8191))).toBe('TMR17777');
    expect(profile.formatDevice(C(9))).toBe('CNT00011');
  });

  it('maps the three special relays and marks the always-on one as a b contact (§17 #22)', () => {
    expect(profile.formatDevice(SP(0))).toBe('007366');
    expect(profile.formatDevice(SP(1))).toBe('007362');
    expect(profile.formatDevice(SP(2))).toBe('007364');
    expect(profile.specialInverted).toEqual([SPECIAL_ALWAYS_ON]);
  });

  it('parses the dialect notation back into IR devices', () => {
    expect(profile.parseDevice('000010')).toEqual(X(8));
    expect(profile.parseDevice('000020')).toEqual(Y(0));
    expect(profile.parseDevice('001000')).toEqual(M(0));
    expect(profile.parseDevice('TMR00000')).toEqual(T(0));
    expect(profile.parseDevice('cnt00011')).toEqual(C(9));
    expect(profile.parseDevice('007366')).toEqual(SP(0));
    expect(profile.parseDevice('20')).toEqual(Y(0));
  });

  it('rejects the octal digits 8 and 9 (§16 Phase 4 受入基準④)', () => {
    expect(profile.parseDevice('000008')).toBeInstanceOf(Error);
    expect(String(profile.parseDevice('000008'))).toContain('8進');
    expect(String(profile.parseDevice('8'))).toContain('8進');
    expect(String(profile.parseDevice('TMR00009'))).toContain('8進');
  });

  it('rejects numbers no unit of this rack owns', () => {
    expect(profile.parseDevice('000040')).toBeInstanceOf(Error);
    expect(profile.parseDevice('002000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('TMR20000')).toBeInstanceOf(Error);
    expect(profile.parseDevice('ABC')).toBeInstanceOf(Error);
    expect(profile.parseDevice('')).toBeInstanceOf(Error);
  });

  it('publishes the device ranges of this rack', () => {
    expect(profile.deviceRanges.input).toEqual({ radix: 8, prefix: '', min: 0, max: 15 });
    expect(profile.deviceRanges.output).toEqual({ radix: 8, prefix: '', min: 0, max: 15 });
    expect(profile.deviceRanges.internal.max).toBe(511);
    expect(profile.deviceRanges.timer).toEqual({ radix: 8, prefix: 'TMR', min: 0, max: 8191 });
  });
});

describe('シャープのタイマ（§10.5 の TMR／0.1秒）', () => {
  it('renders and parses the 4-digit preset', () => {
    expect(profile.timerPreset(3000, T(0))).toEqual({ text: '0030', device: T(0) });
    expect(profile.parseTimerPreset('0030', T(0))).toBe(3000);
    expect(profile.parseTimerPreset('30', T(0))).toBe(3000);
  });

  it('refuses a preset the 0.1 s base cannot express', () => {
    expect(profile.timerPreset(150, T(0))).toBeInstanceOf(Error);
    expect(String(profile.timerPreset(150, T(0)))).toContain('0.1秒');
    expect(profile.timerPreset(1_000_000, T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('0000', T(0))).toBeInstanceOf(Error);
    expect(profile.parseTimerPreset('K30', T(0))).toBeInstanceOf(Error);
  });
});

describe('シャープのバリデータと JW-300SP風スキン（§10.5 / §10.6）', () => {
  it('accepts a program inside the ranges and reports one outside', () => {
    const ok = program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
    expect(profile.validate(ok)).toEqual([]);
    const ng = program(network('n1', [rung(no(device('input', 16)), out(Y(0)))]), endNetwork());
    const errors = profile.validate(ng);
    expect(errors.map((e) => e.code)).toEqual(['device-range']);
    expect(errors[0]?.message).toContain('000000〜000017');
  });

  it('reports timer and counter presets outside the model range', () => {
    const t = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    expect(profile.validate(t).map((e) => e.code)).toEqual(['timer-unit']);
    const c = program(network('n1', [rung(no(X(0)), ctu(C(0), 10_000, X(1)))]), endNetwork());
    expect(profile.validate(c).map((e) => e.code)).toEqual(['counter-range']);
  });

  it('keeps the conversion step and reuses the GX-style keys (§17.1 の前提)', () => {
    expect(profile.convertStep).toBe(true);
    expect(profile.shortcuts).toBe(GX_STYLE_SHORTCUTS);
    expect(profile.monitorColors.powered).toBe('#00A0C8');
    expect(profile.gridCols).toBe(11);
  });

  it('names the instructions confirmed in PLC調査資料 §4-C (§17 #10)', () => {
    const names = profile.instructionNames;
    expect(names.ld).toBe('STR');
    expect(names.ldi).toBe('STR NOT');
    expect(names.ldp).toBe('STR POS');
    expect(names.andf).toBe('AND NEG');
    expect(names.pulseUp).toBe('OUT POS');
    expect(names.pulseDown).toBe('OUT NEG');
    expect(names.andBlock).toBe('AND STR');
    expect(names.orBlock).toBe('OR STR');
    expect(names.mc).toBe('F-47');
    expect(names.mcr).toBe('F-48');
    expect(names.end).toBe('F-40');
    expect(names.timer).toBe('TMR');
    expect(names.counter).toBe('CNT');
  });

  it('borrows no vendor artwork or vendor name outside displayName', () => {
    const text = [
      profile.panels.tree,
      profile.panels.editor,
      profile.panels.output,
      ...profile.panels.toolbar,
      ...Object.values(profile.errorMessages),
    ].join('|');
    expect(text).not.toMatch(/JW-300SP|SHARP|シャープ/iu);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/sharp.test.ts
```

Expected: 失敗。`does not provide an export named 'SHARP_JW300'`。

- [ ] **Step 3: `src/sharp.ts` を書く**

`packages/plc-dialects/src/sharp.ts`:

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
import { GX_STYLE_SHORTCUTS } from './shortcuts.js';
import type {
  DeviceRange,
  DialectError,
  DialectProfile,
  InstructionKey,
  MonitorColors,
  PanelLayout,
  SymbolDrawing,
} from './profile.js';

/**
 * シャープ JW300（基本ベース＋`JW-301PU`＋`JW-312CU`＋`JW-212NA`＋`JW-214SA`）＋
 * JW-300SP風スキンの方言プロファイル。設計仕様 §10.5 / §10.6。
 *
 * 命令ニーモニックと特殊リレー番号は PLC調査資料 §4-C / §17 #22 で**確定済み**である。
 * 本アプリの前提はリレー番号の割付（どのユニットが何番から始まるか。§10.5 は「割付はユニット
 * 装着位置による」とのみ規定）と、タイマ・カウンタに接頭辞を付ける表記の2点だけで、
 * 実機と異なると分かった場合の修正箇所はこのファイルである（§17.1）。
 */

/** 入力ユニット（スロット1）の先頭リレー番号（8進）。前提表 */
const INPUT_BASE = 0o0;
/** 出力ユニット（スロット2）の先頭リレー番号（8進）。前提表 */
const OUTPUT_BASE = 0o20;
/** 内部リレーの先頭番号（8進）。前提表 */
const INTERNAL_BASE = 0o1000;
/** 入出力ユニットの点数。§10.1 */
const IO_POINTS = 16;
/** 内部リレーの点数（`001000`〜`001777`）。 */
const INTERNAL_POINTS = 512;
/** タイマ・カウンタ番号の上限（`17777` 8進）。§10.5 */
const TIMER_MAX = 0o17777;

/** 値を8進 `digits` 桁で書く。 */
function octal(value: number, digits: number): string {
  return value.toString(8).padStart(digits, '0');
}

/** デバイス種別ごとの番号体系。§10.5 */
const DEVICE_RANGES: Readonly<Record<DeviceKind, DeviceRange>> = {
  input: { radix: 8, prefix: '', min: 0, max: IO_POINTS - 1 },
  output: { radix: 8, prefix: '', min: 0, max: IO_POINTS - 1 },
  internal: { radix: 8, prefix: '', min: 0, max: INTERNAL_POINTS - 1 },
  timer: { radix: 8, prefix: 'TMR', min: 0, max: TIMER_MAX },
  counter: { radix: 8, prefix: 'CNT', min: 0, max: TIMER_MAX },
  special: { radix: 10, prefix: 'SP', min: 0, max: 2 },
};

/** リレー種別 → 先頭番号。 */
const RELAY_BASE: Readonly<Record<'input' | 'output' | 'internal', number>> = {
  input: INPUT_BASE,
  output: OUTPUT_BASE,
  internal: INTERNAL_BASE,
};

/** 特殊デバイス番号 → JW の実リレー番号。§10.5 / §17 #22 */
const SPECIAL_DEVICES: Readonly<Record<number, string>> = {
  [SPECIAL_ALWAYS_ON]: '007366',
  [SPECIAL_FIRST_SCAN]: '007362',
  [SPECIAL_CLOCK_1S]: '007364',
};

/** 実リレー番号 → 特殊デバイス番号。 */
const SPECIAL_BY_NAME = new Map<string, number>(
  Object.entries(SPECIAL_DEVICES).map(([index, name]) => [name, Number(index)]),
);

/** IRのデバイス → 方言表記。§10.5 */
function formatDevice(target: Device): string {
  switch (target.kind) {
    case 'special':
      return SPECIAL_DEVICES[target.index] ?? `SP${target.index}`;
    case 'timer':
      return `TMR${octal(target.index, 5)}`;
    case 'counter':
      return `CNT${octal(target.index, 5)}`;
    default:
      return octal(RELAY_BASE[target.kind] + target.index, 6);
  }
}

/** 8進の数字だけか（`8` / `9` を拒否する。§16 Phase 4 受入基準④）。 */
function parseOctal(digits: string, text: string): number | Error {
  if (/[89]/u.test(digits)) {
    return new Error(`リレー番号は8進で表記します（8・9は使えません）: ${text}`);
  }
  return parseInt(digits, 8);
}

/** 番号が範囲内なら IR デバイス、外なら Error。 */
function inRange(kind: DeviceKind, index: number, text: string): Device | Error {
  const range = DEVICE_RANGES[kind];
  if (index < range.min || index > range.max) {
    const low = formatDevice({ kind, index: range.min });
    const high = formatDevice({ kind, index: range.max });
    return new Error(`この機種にはない番号です（${low}〜${high}）: ${text}`);
  }
  return device(kind, index);
}

/** 方言表記 → IRのデバイス。読めない表記は Error を返す（投げない）。§10.5 */
function parseDevice(text: string): Device | Error {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  const timer = /^(TMR|CNT)([0-9]{1,5})$/u.exec(upper);
  if (timer !== null) {
    const index = parseOctal(timer[2] ?? '', trimmed);
    if (index instanceof Error) return index;
    return inRange(timer[1] === 'TMR' ? 'timer' : 'counter', index, trimmed);
  }
  if (!/^[0-9]{1,6}$/u.test(upper)) {
    return new Error(`読めないデバイス表記です（8進6桁のリレー番号）: ${trimmed}`);
  }
  const special = SPECIAL_BY_NAME.get(upper.padStart(6, '0'));
  if (special !== undefined) return device('special', special);
  const value = parseOctal(upper, trimmed);
  if (value instanceof Error) return value;
  for (const kind of ['input', 'output', 'internal'] as const) {
    const base = RELAY_BASE[kind];
    const index = value - base;
    if (index >= 0 && index <= DEVICE_RANGES[kind].max) return device(kind, index);
  }
  return new Error(
    `この機種のユニットに割り付いていない番号です（入力 000000〜000017／出力 000020〜000037／内部 001000〜001777）: ${trimmed}`,
  );
}

/** タイマ規則（`TMR` の0.1秒・10進4桁）。§10.5 の `DTMR(BCD) 00001 / 0100` の書式 */
const TIMER: TimerRule = {
  baseMs: 100,
  min: 1,
  max: 9999,
  unitLabel: '0.1秒',
  format: (count) => String(count).padStart(4, '0'),
  parse: (text) => {
    const matched = /^([0-9]{1,4})$/u.exec(text.trim());
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

/** 命令語。§10.5 のシャープ列（PLC調査資料 §4-C で確定。§17 #10） */
const INSTRUCTION_NAMES: Readonly<Record<InstructionKey, string>> = {
  ld: 'STR',
  ldi: 'STR NOT',
  and: 'AND',
  ani: 'AND NOT',
  or: 'OR',
  ori: 'OR NOT',
  ldp: 'STR POS',
  ldf: 'STR NEG',
  andp: 'AND POS',
  andf: 'AND NEG',
  orp: 'OR POS',
  orf: 'OR NEG',
  andBlock: 'AND STR',
  orBlock: 'OR STR',
  out: 'OUT',
  set: 'SET',
  rst: 'RST',
  pulseUp: 'OUT POS',
  pulseDown: 'OUT NEG',
  timer: 'TMR',
  counter: 'CNT',
  mc: 'F-47',
  mcr: 'F-48',
  end: 'F-40',
};

/** 記号の線画（自前の識別子）。§10.6 / §17 */
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
const MONITOR_COLORS: MonitorColors = { powered: '#00A0C8', idle: '#6B7280' };

/** 画面構成。§10.6（変換の要否は §17.1 の前提で `true`） */
const PANELS: PanelLayout = {
  tree: 'プロジェクトツリー',
  editor: 'ラダー編集',
  output: '出力ウィンドウ',
  toolbar: ['変換', 'PLCへの書込み', '運転／停止', 'モニタ開始', 'モニタ停止'],
};

/** 方言エラーの日本語文言。§10.5 の `errorMessages` */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'device-range': 'リレー番号がこの機種のユニット割付を外れています',
  'timer-unit': 'このタイマの時間単位では指定できない設定値です',
  'timer-range': 'タイマ設定値がこの機種の範囲を超えています',
  'counter-range': 'カウンタ設定値がこの機種の範囲を超えています',
  'special-unsupported': 'この機種に対応する特殊リレーがありません',
};

/** 方言に依る検査。§10.5 / §10.8 */
function validate(source: LadderProgram): DialectError[] {
  return collectDeviceIssues(source, RULES);
}

/** シャープ JW300 ＋ JW-300SP風スキン。§10.5 / §10.6 */
export const SHARP_JW300: DialectProfile = {
  id: 'sharp',
  displayName: 'シャープ JW300（JW-300SP風）',
  formatDevice,
  parseDevice,
  deviceRanges: DEVICE_RANGES,
  timerPreset,
  parseTimerPreset,
  specialDevices: SPECIAL_DEVICES,
  specialInverted: [SPECIAL_ALWAYS_ON],
  instructionNames: INSTRUCTION_NAMES,
  symbols: SYMBOLS,
  gridCols: 11,
  shortcuts: GX_STYLE_SHORTCUTS,
  convertStep: true,
  monitorColors: MONITOR_COLORS,
  panels: PANELS,
  validate,
  errorMessages: ERROR_MESSAGES,
};
```

- [ ] **Step 4: `src/index.ts` に登録する**

`export { JTEKT_PC10G } from './jtekt.js';` の下に `export { SHARP_JW300 } from './sharp.js';` を足し、`PROFILES` に `sharp: SHARP_JW300,` を足す（import も要る）。

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/sharp.test.ts
```

Expected: 全ケース通過。

> `test/profile.test.ts` の3ケース（Task 2 Step 5 の注記と同じもの）は `IMPLEMENTED_DIALECT_IDS` を直す **Task 5 まで赤のまま**である。ここでは `test/sharp.test.ts` だけを走らせ、パッケージ全体を走らせたときに落ちるのがその3ケースだけであることを確認する。

- [ ] **Step 6: コミットする**

```powershell
git add packages/plc-dialects
git commit -m "feat(plc-dialects): add the Sharp JW300 profile"
```

---

## Task 5: 4方言の登録と方言横断の不変条件

**モデル: Sonnet-verbatim**

**Files:**
- Modify: `packages/plc-dialects/src/profile.ts`（`IMPLEMENTED_DIALECT_IDS`）
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/profile.test.ts`（Phase 3 の2ケースを差し替え）
- Test: `packages/plc-dialects/test/dialects.test.ts`（新規。4方言に同じ条件をかける）

4方言が揃ったので `IMPLEMENTED_DIALECT_IDS` を全IDにし、`getDialect()` がどのIDでも引けるようにする。あわせて「新しい方言を足したときに必ず守らせたい条件」を1ファイルにまとめ、Plan 4B のスキン実装が拠れる土台にする。

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/dialects.test.ts`:

```ts
import { C, M, SP, T, X, Y, type Device } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  availableDialects,
  DIALECT_IDS,
  IMPLEMENTED_DIALECT_IDS,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  type DialectProfile,
} from '../src/index.js';

const profiles = availableDialects();
const cases = profiles.map((profile) => [profile.id, profile] as const);

describe('4方言が揃っている（§16 Phase 4）', () => {
  it('implements every vendor of 決定事項#14', () => {
    expect(IMPLEMENTED_DIALECT_IDS).toEqual([...DIALECT_IDS]);
    expect(profiles.map((p) => p.id)).toEqual([...DIALECT_IDS]);
  });

  it('requires the conversion step in the Mitsubishi and Sharp skins only (§10.6)', () => {
    // 変換ありは GX Works3風 と JW-300SP風 の2つ。CX-Programmer風・PCwin風は画面編集で完結する
    const withConvert = profiles.filter((p) => p.convertStep).map((p) => p.id);
    expect(withConvert.sort()).toEqual(['mitsubishi', 'sharp']);
  });

  it('gives every skin its own monitor colour (§10.6 の本アプリ既定)', () => {
    const colours = profiles.map((p) => p.monitorColors.powered);
    expect(colours).toEqual(['#1E64FF', '#E08A1E', '#2FA02C', '#00A0C8']);
    expect(new Set(colours).size).toBe(colours.length);
  });
});

describe.each(cases)('%s プロファイルの不変条件', (_id, profile: DialectProfile) => {
  it('shows 11 contact columns inside the settings bounds (§10.6)', () => {
    expect(profile.gridCols).toBe(11);
    expect(profile.gridCols).toBeGreaterThanOrEqual(MIN_GRID_COLS);
    expect(profile.gridCols).toBeLessThanOrEqual(MAX_GRID_COLS);
  });

  it('maps the three special devices of §10.3', () => {
    expect(Object.keys(profile.specialDevices).sort()).toEqual(['0', '1', '2']);
    for (const index of [0, 1, 2]) {
      expect(profile.formatDevice(SP(index)).length).toBeGreaterThan(0);
    }
    for (const index of profile.specialInverted ?? []) {
      expect(profile.specialDevices[index]).toBeDefined();
    }
  });

  it('round-trips every device kind through formatDevice and parseDevice (§10.7 表記切替)', () => {
    const samples: Device[] = [X(0), X(1), Y(0), Y(1), M(0), T(0), C(0), SP(0), SP(1), SP(2)];
    for (const target of samples) {
      const text = profile.formatDevice(target);
      expect(profile.parseDevice(text), `${profile.id}: ${text}`).toEqual(target);
    }
  });

  it('round-trips a 3 s timer preset', () => {
    const preset = profile.timerPreset(3000, T(0));
    expect(preset, profile.id).not.toBeInstanceOf(Error);
    if (preset instanceof Error) return;
    expect(profile.parseTimerPreset(preset.text, T(0))).toBe(3000);
  });

  it('names all 24 instructions without an empty string', () => {
    const names = Object.values(profile.instructionNames);
    expect(names).toHaveLength(24);
    for (const name of names) expect(name.trim().length).toBeGreaterThan(0);
  });

  it('has a Japanese message for every error code and a unique shortcut table', () => {
    for (const message of Object.values(profile.errorMessages)) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
    const actions = profile.shortcuts.map((s) => s.action);
    const keys = profile.shortcuts.map((s) => s.keys);
    expect(new Set(actions).size).toBe(actions.length);
    expect(new Set(keys).size).toBe(keys.length);
    // 「変換」の行は convertStep のスキンにしか無い（決定表#5）
    expect(profile.shortcuts.some((s) => s.action === 'convert')).toBe(profile.convertStep);
  });

  it('names the panels and keeps the symbol drawings vendor-neutral (§17 / PLC調査資料 §6)', () => {
    expect(profile.panels.tree.trim().length).toBeGreaterThan(0);
    expect(profile.panels.editor.trim().length).toBeGreaterThan(0);
    expect(profile.panels.output.trim().length).toBeGreaterThan(0);
    expect(profile.panels.toolbar.length).toBeGreaterThan(0);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
    expect(profile.displayName).toContain('風');
  });
});
```

- [ ] **Step 2: `test/profile.test.ts` の Phase 3 の2ケースを差し替える**

`it('implements only Mitsubishi in Phase 3 (§16)', …)` と `it('throws a readable error for a dialect that Phase 4 will add', …)` を次の2つで置き換える:

```ts
  it('implements all four vendors in Phase 4 (§16)', () => {
    expect(IMPLEMENTED_DIALECT_IDS).toEqual(['mitsubishi', 'jtekt', 'omron', 'sharp']);
    expect(availableDialects().map((d) => d.id)).toEqual([
      'mitsubishi',
      'jtekt',
      'omron',
      'sharp',
    ]);
  });

  it('throws a readable error for an id that is not a dialect', () => {
    // 作業ファイルや設定に未知の方言IDが入っていた場合（`isDialectId()` を通していない経路）
    expect(() => getDialect('siemens' as DialectId)).toThrow(UnknownDialectError);
  });
```

`import` に `type DialectId` を足す。

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/dialects.test.ts test/profile.test.ts
```

Expected: 失敗。`IMPLEMENTED_DIALECT_IDS` が `['mitsubishi']` のままなので `implements every vendor of 決定事項#14` などが落ちる。

- [ ] **Step 4: `src/profile.ts` の `IMPLEMENTED_DIALECT_IDS` を直す**

```ts
/** Phase 4 で4メーカーすべてを実装した。§16 */
export const IMPLEMENTED_DIALECT_IDS: readonly DialectId[] = DIALECT_IDS;
```

- [ ] **Step 5: `src/index.ts` の `PROFILES` と例外文言を仕上げる**

```ts
/** 実装済みの方言プロファイル（`DIALECT_IDS` の順）。§16 Phase 4 */
const PROFILES: Partial<Record<DialectId, DialectProfile>> = {
  mitsubishi: MITSUBISHI_FX5U,
  jtekt: JTEKT_PC10G,
  omron: OMRON_CP1E,
  sharp: SHARP_JW300,
};
```

`getDialect()` の例外文言を次に変える（4方言が揃ったので「Phase 4 で追加します」はもう正しくない）:

```ts
    throw new UnknownDialectError(`対応していない方言IDです: ${id}`);
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run
pnpm --filter @ojt/plc-dialects exec vitest run --coverage
```

Expected: `Test Files  10 passed`（`convert` / `device-rules` / `dialects` / `jtekt` / `mitsubishi-devices` / `mitsubishi-validate` / `omron` / `profile` / `sharp` / `skin` の10ファイル。`notation` と `instruction-list` は Task 6・7 で増える）。カバレッジは lines / statements / functions / branches すべて90%以上。

- [ ] **Step 7: バッチAのレビューとコミット**

```powershell
pnpm --filter @ojt/plc-dialects exec tsc --noEmit
npx prettier --check "packages/plc-dialects/**/*.ts"
git add packages/plc-dialects
git commit -m "feat(plc-dialects): register all four dialects and pin the cross-profile invariants"
```

ここで**バッチA のレビュー（Opus 1回）**をかける。見どころ: ①`formatDevice` / `parseDevice` の往復が4方言すべてで閉じているか ②`deviceRanges` の上限が §10.5 の表と機種の実装点数のどちらを採ったか（決定表#1）の一貫性 ③TOYOPUC の同番号重複が「後から現れたほう」を指しているか ④シャープの8進エラーが `8` を含む入力すべてで出るか。

---

## Task 6: 表記切替（`switchNotation()`）

**モデル: Sonnet**

**Files:**
- Create: `packages/plc-dialects/src/notation.ts`
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/notation.test.ts`

§10.7 の「表記切替」を実装する。IRはベンダー中立なので**書き換えは要らない**（決定表#6）。この関数は「切替後にデバイス名がどう変わるか」と「切替先で表せない項目」を返すだけで、4B の表記切替ダイアログがその一覧をそのまま出す。§16 Phase 4 受入基準②（三菱で組んだラダーを OMRON 表記に切り替えると `0.00` 形式になる）の3A側の裏づけになる。

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/notation.test.ts`:

```ts
import {
  device,
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
import { JTEKT_PC10G, MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300, switchNotation } from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const selfHold = program(
  network('n1', [rung(no(X(8)), out(Y(1))), [no(Y(1))]]),
  network('n2', [rung(no(X(0)), ton(T(0), 3000))]),
  endNetwork(),
);

describe('switchNotation（§10.7 表記切替 / §16 Phase 4 受入基準②）', () => {
  it('lists how every device is spelled in the target dialect', () => {
    const result = switchNotation(selfHold, MITSUBISHI_FX5U, OMRON_CP1E);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.changes.map((c) => [c.from, c.to])).toEqual([
      ['X10', '0.08'],
      ['Y1', '100.01'],
      ['X0', '0.00'],
    ]);
  });

  it('keeps only the devices whose spelling actually differs', () => {
    const result = switchNotation(selfHold, MITSUBISHI_FX5U, OMRON_CP1E);
    // `T0` は両方の方言で `T0` なので一覧に出ない
    expect(result.changes.some((c) => c.from === 'T0')).toBe(false);
    for (const change of result.changes) expect(change.from).not.toBe(change.to);
  });

  it('spells the same program in the other two dialects', () => {
    const jtekt = switchNotation(selfHold, MITSUBISHI_FX5U, JTEKT_PC10G);
    expect(jtekt.changes[0]).toEqual({ device: X(8), from: 'X10', to: '1X008' });
    // 出力は `OUTPUT_BASE`（0x010）ぶんずれる（決定表#16）
    expect(jtekt.changes.find((c) => c.device.kind === 'output')?.to).toBe('1Y011');
    const sharp = switchNotation(selfHold, MITSUBISHI_FX5U, SHARP_JW300);
    expect(sharp.changes[0]).toEqual({ device: X(8), from: 'X10', to: '000010' });
    expect(sharp.changes.find((c) => c.device.kind === 'output')?.to).toBe('000021');
  });

  it('reports what the target dialect cannot express (§10.7)', () => {
    const wide = program(
      network('n1', [rung(no(X(0)), out(device('output', 14)))]),
      endNetwork(),
    );
    const result = switchNotation(wide, MITSUBISHI_FX5U, OMRON_CP1E);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(['device-range']);
    // 表記の一覧は「表せない」ときも返す（UIは赤字で並べる）
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('reports a preset the target dialect cannot express', () => {
    const fine = program(network('n1', [rung(no(X(0)), ton(T(200), 150))]), endNetwork());
    // 三菱の T200 帯は 10ms 単位なので 150ms は書ける
    expect(MITSUBISHI_FX5U.validate(fine)).toEqual([]);
    const result = switchNotation(fine, MITSUBISHI_FX5U, SHARP_JW300);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(['timer-unit']);
  });

  it('is a no-op when the source and the target are the same dialect', () => {
    const result = switchNotation(selfHold, OMRON_CP1E, OMRON_CP1E);
    expect(result.changes).toEqual([]);
    expect(result.from).toBe('omron');
    expect(result.to).toBe('omron');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/notation.test.ts
```

Expected: 失敗。`does not provide an export named 'switchNotation'`。

- [ ] **Step 3: `src/notation.ts` を書く**

`packages/plc-dialects/src/notation.ts`:

```ts
import type { Device, LadderProgram } from '@ojt/ladder-core';
import { collectDevices } from './device-rules.js';
import type { DialectError, DialectId, DialectProfile } from './profile.js';

/**
 * 表記切替。設計仕様 §10.7。
 *
 * IRはベンダー中立（§10.3 / 3A 決定表#5）なので、方言を切り替えてもプログラムは**変換しない**。
 * 変わるのは画面に出るデバイス名と設定値の書き方だけである。この関数は
 * 「切替後にどう書かれるか」の一覧と「切替先の方言で表せない項目」を返し、4B の切替ダイアログが
 * そのまま並べる。プログラム自体は呼び出し側が持ったままでよい。
 */

/** デバイス1つの表記の変化。 */
export interface NotationChange {
  device: Device;
  from: string;
  to: string;
}

/** 表記切替の下見の結果。 */
export interface NotationSwitchResult {
  /** 切替先の方言で表せるか（`errors` が空か）。 */
  ok: boolean;
  from: DialectId;
  to: DialectId;
  /** 表記が変わるデバイス（変わらないものは載せない）。グリッドの順。 */
  changes: readonly NotationChange[];
  /** 切替先の方言のバリデータの指摘（デバイス範囲・設定値）。 */
  errors: readonly DialectError[];
}

/**
 * 方言を切り替えたときの表記の変化と、切替先で表せない項目を調べる。§10.7
 * プログラムは書き換えない（引数も戻り値も IR を含まない）。
 */
export function switchNotation(
  source: LadderProgram,
  from: DialectProfile,
  to: DialectProfile,
): NotationSwitchResult {
  const changes: NotationChange[] = [];
  for (const use of collectDevices(source)) {
    const before = from.formatDevice(use.device);
    const after = to.formatDevice(use.device);
    if (before === after) continue;
    changes.push({ device: use.device, from: before, to: after });
  }
  const errors = to.validate(source);
  return { ok: errors.length === 0, from: from.id, to: to.id, changes, errors };
}
```

- [ ] **Step 4: `src/index.ts` に足す**

```ts
export {
  switchNotation,
  type NotationChange,
  type NotationSwitchResult,
} from './notation.js';
```

- [ ] **Step 5: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/notation.test.ts
git add packages/plc-dialects
git commit -m "feat(plc-dialects): add the notation switch preview"
```

---

## Task 7: 命令語リストのエクスポート（`instructionList()`）

**モデル: Opus**（グリッドから直並列式への分解が本プランで最も判断の要る部分）

**Files:**
- Create: `packages/plc-dialects/src/instruction-list.ts`
- Modify: `packages/plc-dialects/src/profile.ts`（`counterPresetText?` / `parseCounterPreset?` を足す）
- Modify: `packages/plc-dialects/src/{mitsubishi,omron,jtekt,sharp}.ts`（`counterPresetText` / `parseCounterPreset` を1組ずつ）
- Modify: `packages/plc-dialects/src/index.ts`
- Test: `packages/plc-dialects/test/instruction-list.test.ts`
- Test: `packages/plc-dialects/test/counter-preset.test.ts`

§10.7 の「命令語リストのエクスポート（テキスト、UTF-8、CRLF）」を実装する。§16 Phase 4 受入基準⑥（方言どおりの命令名で出力される）の本体である。

**アルゴリズム（決定表#7）:** グリッドを「節点と枝」の無向グラフに直す。枝は接点セル（`(row,col)`–`(row,col+1)`）と横線・縦線（縦線は右方向の枝と下方向の枝の2本）で、各行の0列目はすべて左母線の1節点（`-1`）にまとめる（ランタイムの `solve()` と同じ結線。§10.4）。出力セルの行のコイル列の節点を終点にして、**並列簡約**（同じ2点を結ぶ枝を OR にまとめる）と**直列簡約**（端点でない次数2の節点で2本を AND にまとめる）を繰り返す。1本に縮んだらその式を命令語へ展開し、縮まなければ `not-series-parallel` を返す。

| 決めること | 本タスクの実装 |
|---|---|
| 接点の位置と命令 | 先頭は `ld`/`ldi`/`ldp`/`ldf`、AND位置は `and`/`ani`/`andp`/`andf`、OR位置は `or`/`ori`/`orp`/`orf` |
| ブロック接続 | 合成式どうしの直列は `andBlock`、並列は `orBlock` |
| タイマ・カウンタ | ニーモニックがデバイス接頭辞で終わる方言（三菱の `OUT T`）は番号を続けて `OUT T0 K100`、そうでなければ `TIM T0 #0030` のように空けて書く |
| カウンタのリセット | IRは `resetDevice` をセルに持つので、`OUT C0 K5` の直後に `LD <reset>` ＋ `RST C0` の2行を足す（実機の書き方） |
| 同じ条件の複数出力 | 直前の出力と式が同じなら条件行を繰り返さない（`OUT Y0` / `OUT Y1` が並ぶ） |
| END | END ネットワークは条件なしで `end` の1行（三菱 `END`、シャープ `F-40`） |
| テキスト | `0000  LD        X0` の形。ネットワークの切れ目に `; n1  自己保持` の見出し。改行は **CRLF**、末尾にも改行を置く（§10.7） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/plc-dialects/test/instruction-list.test.ts`:

```ts
import {
  C,
  ctu,
  empty,
  endNetwork,
  hline,
  IR_COLS,
  M,
  mc,
  mcr,
  network,
  nc,
  no,
  out,
  program,
  rise,
  set,
  T,
  ton,
  vline,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  instructionList,
  INSTRUCTION_LIST_MESSAGES,
  JTEKT_PC10G,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  SHARP_JW300,
} from '../src/index.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** 自己保持（X0 で入り X1 で切れる）。内蔵課題 d-001 の n1 と同じ形。 */
const selfHold = program(
  network('n1', [rung(no(X(0)), vline(), nc(X(1)), out(Y(0))), [no(Y(0))]], {
    comment: '自己保持',
  }),
  endNetwork(),
);

const mnemonics = (profile: typeof MITSUBISHI_FX5U, source: typeof selfHold): string[] =>
  instructionList(source, profile).lines.map((line) => `${line.mnemonic} ${line.operand}`.trim());

describe('instructionList（§10.7 / §16 Phase 4 受入基準⑥）', () => {
  it('turns a self-holding rung into the textbook Mitsubishi list', () => {
    expect(mnemonics(MITSUBISHI_FX5U, selfHold)).toEqual([
      'LD X0',
      'OR Y0',
      'ANI X1',
      'OUT Y0',
      'END',
    ]);
  });

  it('writes the same rung in each dialect mnemonics', () => {
    expect(mnemonics(OMRON_CP1E, selfHold)).toEqual([
      'LD 0.00',
      'OR 100.00',
      'AND NOT 0.01',
      'OUT 100.00',
      'END',
    ]);
    expect(mnemonics(JTEKT_PC10G, selfHold)).toEqual([
      'LD 1X000',
      'OR 1Y010',
      'ANI 1X001',
      'OUT 1Y010',
      'END',
    ]);
    expect(mnemonics(SHARP_JW300, selfHold)).toEqual([
      'STR 000000',
      'OR 000020',
      'AND NOT 000001',
      'OUT 000020',
      'F-40',
    ]);
  });

  it('uses the edge-contact and SET mnemonics', () => {
    const p = program(network('n1', [rung(rise(X(0)), set(M(0)))]), endNetwork());
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LDP X0', 'SET M0', 'END']);
    expect(mnemonics(SHARP_JW300, p)).toEqual(['STR POS 000000', 'SET 001000', 'F-40']);
  });

  it('loads the always-on device as a b-contact where the dialect needs one (H-4)', () => {
    // 接点の無い行は「常時ON」を読む。シャープの `007366` は**b接点**で常時ONなので
    // `STR NOT` で読む（`specialInverted`。§10.5 / §17 #22 / 4B 引き渡し H-4）
    const p = program(network('n1', [rung(hline(), out(Y(0)))]), endNetwork());
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD M8000', 'OUT Y0', 'END']);
    expect(mnemonics(OMRON_CP1E, p)).toEqual(['LD P_On', 'OUT 100.00', 'END']);
    expect(mnemonics(SHARP_JW300, p)).toEqual(['STR NOT 007366', 'OUT 000020', 'F-40']);
  });

  it('merges the timer mnemonic with its device when the dialect spells it that way', () => {
    const p = program(network('n1', [rung(no(X(0)), ton(T(0), 3000))]), endNetwork());
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD X0', 'OUT T0 K30', 'END']);
    expect(mnemonics(OMRON_CP1E, p)).toEqual(['LD 0.00', 'TIM T0 #0030', 'END']);
    expect(mnemonics(JTEKT_PC10G, p)).toEqual(['LD 1X000', 'OUT 1T000 H001E', 'END']);
    expect(mnemonics(SHARP_JW300, p)).toEqual(['STR 000000', 'TMR00000 0030', 'F-40']);
  });

  it('writes the counter and its reset the way the manual does', () => {
    const p = program(network('n1', [rung(no(X(0)), ctu(C(0), 5, X(1)))]), endNetwork());
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual([
      'LD X0',
      'OUT C0 K5',
      'LD X1',
      'RST C0',
      'END',
    ]);
  });

  it('writes MC / MCR with the master-control mnemonics of the dialect', () => {
    const p = program(
      network('n1', [rung(no(X(0)), mc(M(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      network('n3', [rung(no(X(0)), mcr(M(0)))]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toContain('MC M0');
    expect(mnemonics(MITSUBISHI_FX5U, p)).toContain('MCR M0');
    expect(mnemonics(OMRON_CP1E, p)).toContain('IL W0.00');
  });

  it('emits a block instruction when a branch is itself a series', () => {
    // X0 と（X1 AND X2）の並列 → LD X0 / LD X1 / AND X2 / ORB / OUT Y0。
    // 分岐は2列ぶん伸びるので、合流の縦線は 2列目に置く（下の行の X2 の右側）
    const p = program(
      network('n1', [
        [
          no(X(0)),
          hline(),
          vline(),
          ...Array.from({ length: IR_COLS - 4 }, () => hline()),
          out(Y(0)),
        ],
        [no(X(1)), no(X(2))],
      ]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual([
      'LD X0',
      'LD X1',
      'AND X2',
      'ORB',
      'OUT Y0',
      'END',
    ]);
  });

  it('does not repeat the condition when two outputs share a rung', () => {
    // 出力の分岐はコイル列の手前で縦線に落とす。下の行の0列目を横線にすると左母線と
    // 直結してしまい、実機どおり「常時ON」の回路になってしまう（ランタイムの `solve()` と同じ）
    const p = program(
      network('n1', [
        [no(X(0)), ...Array.from({ length: IR_COLS - 3 }, () => hline()), vline(), out(Y(0))],
        [...Array.from({ length: IR_COLS - 2 }, () => empty()), hline(), out(Y(1))],
      ]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD X0', 'OUT Y0', 'OUT Y1', 'END']);
  });

  it('numbers the steps and renders CRLF text with a heading per network (§10.7)', () => {
    const result = instructionList(selfHold, MITSUBISHI_FX5U);
    expect(result.errors).toEqual([]);
    expect(result.lines.map((l) => l.step)).toEqual([0, 1, 2, 3, 4]);
    expect(result.lines[0]?.networkId).toBe('n1');
    expect(result.text).toContain('\r\n');
    expect(result.text).not.toMatch(/[^\r]\n/u);
    expect(result.text.endsWith('\r\n')).toBe(true);
    expect(result.text).toContain('; n1  自己保持');
    expect(result.text).toContain('0000  LD');
  });

  it('reports a ladder it cannot convert', () => {
    const broken = program(network('n1', [[no(X(0))]]));
    const result = instructionList(broken, MITSUBISHI_FX5U);
    expect(result.lines).toEqual([]);
    expect(result.errors[0]?.code).toBe('compile-failed');
    expect(INSTRUCTION_LIST_MESSAGES['compile-failed']).toBeDefined();
    expect(INSTRUCTION_LIST_MESSAGES['not-series-parallel']).toBeDefined();
  });

  it('marks a preset the dialect cannot express instead of guessing', () => {
    const p = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    const result = instructionList(p, SHARP_JW300);
    expect(result.errors.map((e) => e.code)).toEqual(['preset-unavailable']);
    expect(result.lines.map((l) => l.operand)).toContain('?');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run test/instruction-list.test.ts
```

Expected: 失敗。`does not provide an export named 'instructionList'`。

- [ ] **Step 3: `src/profile.ts` に `counterPresetText` / `parseCounterPreset` を足す**

`DialectProfile` の `parseTimerPreset` の直後に、タイマの対と同じ形で足す（landed 名。Plan 4B の申し送り F-2 がこの対をそのまま使う）:

```ts
  /**
   * カウンタ設定値の方言表記（三菱は `K5`、OMRON は `#0005`）。§10.7
   * 命令語リストと 4B のカウンタ設定値欄が使う。省略した方言は10進の数値そのままで書かれる。
   */
  counterPresetText?(preset: number): string;
  /** 方言のカウンタ設定表記 → 設定値。読めない表記と機種の範囲外は `Error` を返す（投げない）。 */
  parseCounterPreset?(text: string): number | Error;
```

- [ ] **Step 4: 4プロファイルに `counterPresetText` / `parseCounterPreset` を足す**

それぞれのプロファイル定数（`MITSUBISHI_FX5U` など）の `parseTimerPreset,` の直後に、読み書きの対で足す（この機種で表せる範囲の値だけをベンダー表記で書き、範囲外は素の10進数のまま返す。M4）:

```ts
// mitsubishi.ts
  counterPresetText: (preset) => (1 <= preset && preset <= 32_767 ? `K${preset}` : String(preset)),
  parseCounterPreset: (text) => { /* `K<数値>` を読み、1〜32767 の範囲を検査する */ },
// omron.ts
  counterPresetText: (preset) => /* 1〜9999 なら `#0005` 式、それ以外は素の10進数 */,
  parseCounterPreset: (text) => { /* `#`／`&` の10進1〜5桁を読み、1〜9999 の範囲を検査する */ },
// jtekt.ts
  counterPresetText: (preset) => /* 1〜65535 なら `H0005` 式、それ以外は素の10進数 */,
  parseCounterPreset: (text) => { /* `H<16進4桁>` を読み、1〜65535 の範囲を検査する */ },
// sharp.ts
  counterPresetText: (preset) => /* 1〜9999 なら10進4桁、それ以外は素の10進数 */,
  parseCounterPreset: (text) => { /* 10進1〜4桁を読み、1〜9999 の範囲を検査する */ },
```

- [ ] **Step 5: `src/instruction-list.ts` を書く**

`packages/plc-dialects/src/instruction-list.ts`:

```ts
import {
  COIL_COL,
  compile,
  IR_COLS,
  SPECIAL_ALWAYS_ON,
  type Cell,
  type CompiledNetwork,
  type ContactType,
  type Device,
  type LadderProgram,
  type OutputCell,
} from '@ojt/ladder-core';
import type { DialectError, DialectProfile, InstructionKey } from './profile.js';

/**
 * 命令語リストのエクスポート。設計仕様 §10.7。
 *
 * グリッドを「節点と枝」のグラフに直し、直並列簡約で1つの式にしてから方言の命令語へ展開する
 * （決定表#7）。方言に依るのは命令名・デバイス表記・設定値表記の3つだけで、
 * 分解の手順は方言に依らない。
 *
 * **方言バリデータは走らせない**（`convert()` の仕事。§10.6）。ここが返すのは
 * 「リストにできなかった」種類の指摘だけである。
 */

/** 命令語リスト1行。 */
export interface InstructionLine {
  /** 0起点のステップ番号。 */
  step: number;
  mnemonic: string;
  /** デバイスや設定値（無ければ空文字）。 */
  operand: string;
  networkId: string;
}

/** エクスポートの結果。 */
export interface InstructionListResult {
  lines: readonly InstructionLine[];
  /** UTF-8・CRLF のテキスト（§10.7）。 */
  text: string;
  errors: readonly DialectError[];
}

/** 命令語リスト固有の指摘の文言。`DialectProfile.errorMessages` には入れない（決定表#8）。 */
export const INSTRUCTION_LIST_MESSAGES: Readonly<Record<string, string>> = {
  'compile-failed': 'ラダーを変換できないため命令語リストを作れません',
  'not-series-parallel': '直列・並列に分解できない回路です（命令語リストにできません）',
  'preset-unavailable': 'この機種で表せない設定値です（`?` で書き出しました）',
};

/** 接点セル。 */
type ContactCell = Extract<Cell, { kind: 'contact' }>;

/** 直並列に分解した回路。接点はグリッド上の位置を持つ（並べ替えを決定論にするため）。 */
type Expr =
  | { kind: 'wire' }
  | { kind: 'contact'; cell: ContactCell; row: number; col: number }
  | { kind: 'and'; parts: readonly Expr[] }
  | { kind: 'or'; parts: readonly Expr[] };

/** 式が含む接点のうち、いちばん上・いちばん左の位置。 */
function span(expr: Expr): { row: number; col: number } {
  if (expr.kind === 'contact') return { row: expr.row, col: expr.col };
  if (expr.kind === 'wire') return { row: Number.MAX_SAFE_INTEGER, col: Number.MAX_SAFE_INTEGER };
  let row = Number.MAX_SAFE_INTEGER;
  let col = Number.MAX_SAFE_INTEGER;
  for (const part of expr.parts) {
    const at = span(part);
    row = Math.min(row, at.row);
    col = Math.min(col, at.col);
  }
  return { row, col };
}

/**
 * 直列に繋ぐ（渡り＝`wire` は直列では消える）。
 * **列（左→右）の順に並べ替える**ので、簡約が枝をどちら向きに辿っても同じ並びになる。
 */
function andOf(parts: readonly Expr[]): Expr {
  const flat: Expr[] = [];
  for (const part of parts) {
    if (part.kind === 'wire') continue;
    if (part.kind === 'and') flat.push(...part.parts);
    else flat.push(part);
  }
  if (flat.length === 0) return { kind: 'wire' };
  flat.sort((a, b) => {
    const left = span(a);
    const right = span(b);
    return left.col - right.col || left.row - right.row;
  });
  return flat.length === 1 ? (flat[0] ?? { kind: 'wire' }) : { kind: 'and', parts: flat };
}

/** 並列に繋ぐ（渡りが1本でもあれば常時成立）。**行（上→下）の順に並べ替える**。 */
function orOf(parts: readonly Expr[]): Expr {
  const flat: Expr[] = [];
  for (const part of parts) {
    if (part.kind === 'wire') return { kind: 'wire' };
    if (part.kind === 'or') flat.push(...part.parts);
    else flat.push(part);
  }
  if (flat.length === 0) return { kind: 'wire' };
  flat.sort((a, b) => {
    const left = span(a);
    const right = span(b);
    return left.row - right.row || left.col - right.col;
  });
  return flat.length === 1 ? (flat[0] ?? { kind: 'wire' }) : { kind: 'or', parts: flat };
}

/** 式の同一性を見るためのキー（同じ条件の複数出力をまとめるのに使う）。 */
function exprKey(expr: Expr): string {
  if (expr.kind === 'wire') return 'w';
  if (expr.kind === 'contact') {
    return `c:${expr.cell.type}:${expr.cell.device.kind}:${expr.cell.device.index}`;
  }
  return `${expr.kind}(${expr.parts.map(exprKey).join(',')})`;
}

/** グラフの枝。 */
interface Edge {
  a: number;
  b: number;
  expr: Expr;
}

/** 左母線の節点番号（各行の0列目はここへまとめる。§10.4 の `solve()` と同じ結線）。 */
const LEFT_RAIL = -1;

/** 節点番号。0列目はすべて左母線。 */
function nodeId(row: number, col: number): number {
  return col === 0 ? LEFT_RAIL : row * (IR_COLS + 1) + col;
}

/** ネットワークのグリッドを枝の集まりに直す。 */
function buildEdges(net: CompiledNetwork): Edge[] {
  const edges: Edge[] = [];
  for (let row = 0; row < net.rows; row += 1) {
    for (let col = 0; col < COIL_COL; col += 1) {
      const cell = net.cells[row]?.[col];
      if (cell === undefined) continue;
      if (cell.kind === 'contact') {
        edges.push({
          a: nodeId(row, col),
          b: nodeId(row, col + 1),
          expr: { kind: 'contact', cell, row, col },
        });
      } else if (cell.kind === 'hline' || cell.kind === 'vline') {
        edges.push({ a: nodeId(row, col), b: nodeId(row, col + 1), expr: { kind: 'wire' } });
      }
      if (cell.kind === 'vline' && row + 1 < net.rows) {
        edges.push({ a: nodeId(row, col), b: nodeId(row + 1, col), expr: { kind: 'wire' } });
      }
    }
  }
  return edges.filter((edge) => edge.a !== edge.b);
}

/** 同じ2点を結ぶ枝をまとめる。まとめたら true。 */
function reduceParallel(edges: Edge[]): { edges: Edge[]; changed: boolean } {
  const groups = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = edge.a < edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`;
    const list = groups.get(key) ?? [];
    list.push(edge);
    groups.set(key, list);
  }
  const next: Edge[] = [];
  let changed = false;
  for (const list of groups.values()) {
    const head = list[0];
    if (head === undefined) continue;
    if (list.length === 1) {
      next.push(head);
      continue;
    }
    changed = true;
    // `orOf()` が行順に並べ替えるので、枝をどちら向きに辿っても同じ並びになる
    next.push({ a: head.a, b: head.b, expr: orOf(list.map((edge) => edge.expr)) });
  }
  return { edges: next, changed };
}

/** 端点でない次数2の節点を潰す（行き止まりの枝は落とす）。潰したら true。 */
function reduceSeries(edges: Edge[], sink: number): { edges: Edge[]; changed: boolean } {
  const incident = new Map<number, Edge[]>();
  for (const edge of edges) {
    for (const node of [edge.a, edge.b]) {
      const list = incident.get(node) ?? [];
      list.push(edge);
      incident.set(node, list);
    }
  }
  for (const [node, list] of incident) {
    if (node === LEFT_RAIL || node === sink) continue;
    const first = list[0];
    if (first === undefined) continue;
    if (list.length === 1) {
      // 行き止まり（分岐を描いたが繋がっていない枝）。落としても導通は変わらない
      return { edges: edges.filter((edge) => edge !== first), changed: true };
    }
    const second = list[1];
    if (list.length !== 2 || second === undefined || first === second) continue;
    // `andOf()` が列順に並べ替えるので、枝の向きは端点の付け替えだけ気にすればよい
    const leftEnd = first.a === node ? first.b : first.a;
    const rightEnd = second.a === node ? second.b : second.a;
    const rest = edges.filter((edge) => edge !== first && edge !== second);
    rest.push({ a: leftEnd, b: rightEnd, expr: andOf([first.expr, second.expr]) });
    return { edges: rest, changed: true };
  }
  return { edges, changed: false };
}

/** 左母線 → 終点 の式にまとめる。分解できなければ undefined。 */
function reduceToExpr(source: readonly Edge[], sink: number): Expr | undefined {
  let edges = source.map((edge) => ({ ...edge }));
  for (;;) {
    const parallel = reduceParallel(edges);
    edges = parallel.edges;
    const series = reduceSeries(edges, sink);
    edges = series.edges;
    if (!parallel.changed && !series.changed) break;
  }
  const only = edges[0];
  if (edges.length !== 1 || only === undefined) return undefined;
  const ends = [only.a, only.b];
  if (!ends.includes(LEFT_RAIL) || !ends.includes(sink)) return undefined;
  return only.expr;
}

/** 接点の置かれた位置 → 命令語キー。§10.5 */
const CONTACT_KEYS: Readonly<Record<'ld' | 'and' | 'or', Readonly<Record<ContactType, InstructionKey>>>> =
  {
    ld: { NO: 'ld', NC: 'ldi', P: 'ldp', F: 'ldf' },
    and: { NO: 'and', NC: 'ani', P: 'andp', F: 'andf' },
    or: { NO: 'or', NC: 'ori', P: 'orp', F: 'orf' },
  };

/** 組み立て中の1行。 */
interface Emit {
  mnemonic: string;
  operand: string;
}

/** 接点1つを命令語にする。 */
function contactEmit(cell: ContactCell, at: 'ld' | 'and' | 'or', profile: DialectProfile): Emit {
  const key = CONTACT_KEYS[at][cell.type];
  return { mnemonic: profile.instructionNames[key], operand: profile.formatDevice(cell.device) };
}

/**
 * 式を1つのブロックとして展開する（先頭は必ず `ld` 系）。
 * 接点の無い枝（`wire`）は「常時ON」を読む。`specialInverted` に常時ONが載っている方言
 * （シャープの `007366`）は実機で**b接点**として書くので `ldi` 側を使う（4B 引き渡し H-4）。
 */
function emitBlock(expr: Expr, profile: DialectProfile, out: Emit[]): void {
  if (expr.kind === 'wire') {
    const inverted = profile.specialInverted?.includes(SPECIAL_ALWAYS_ON) ?? false;
    out.push({
      mnemonic: inverted ? profile.instructionNames.ldi : profile.instructionNames.ld,
      operand: profile.formatDevice({ kind: 'special', index: SPECIAL_ALWAYS_ON }),
    });
    return;
  }
  if (expr.kind === 'contact') {
    out.push(contactEmit(expr.cell, 'ld', profile));
    return;
  }
  const [first, ...rest] = expr.parts;
  if (first === undefined) return;
  emitBlock(first, profile, out);
  const at = expr.kind === 'and' ? 'and' : 'or';
  const blockKey: InstructionKey = expr.kind === 'and' ? 'andBlock' : 'orBlock';
  for (const part of rest) {
    if (part.kind === 'contact') {
      out.push(contactEmit(part.cell, at, profile));
      continue;
    }
    emitBlock(part, profile, out);
    out.push({ mnemonic: profile.instructionNames[blockKey], operand: '' });
  }
}

/**
 * ニーモニックがデバイス接頭辞で終わる方言では番号だけを続ける。
 * 三菱の `OUT T` ＋ `T0` は `OUT T0`、OMRON の `TIM` ＋ `T0` は `TIM T0` になる。
 *
 * 実機の CX-Programmer はタイマ・カウンタを `CNT 0 #0005` のように**種別の文字を落とした番号だけ**
 * で書くが、本アプリは `parseDevice()` が文字列だけから一意に読める `CNT C0 #0005` に統一する
 * （**本アプリの表記**。§17.1 の前提方針。シャープの接頭辞つきタイマと同じ理由。意図的な差分#2）。
 */
function presetEmit(
  profile: DialectProfile,
  key: 'timer' | 'counter',
  target: Device,
  preset: string,
): Emit {
  const name = profile.instructionNames[key];
  const prefix = profile.deviceRanges[target.kind].prefix;
  const text = profile.formatDevice(target);
  if (prefix.length > 0 && name.endsWith(prefix) && text.startsWith(prefix)) {
    return { mnemonic: `${name}${text.slice(prefix.length)}`, operand: preset };
  }
  return { mnemonic: name, operand: `${text} ${preset}`.trim() };
}

/** 出力セルを命令語にする。表せない設定値は `?` にして指摘を返す。 */
function emitOutput(
  cell: OutputCell,
  profile: DialectProfile,
  networkId: string,
  out: Emit[],
  errors: DialectError[],
): void {
  if (cell.kind === 'coil') {
    const key: InstructionKey = cell.type === 'OUT' ? 'out' : cell.type === 'SET' ? 'set' : 'rst';
    out.push({ mnemonic: profile.instructionNames[key], operand: profile.formatDevice(cell.device) });
    return;
  }
  if (cell.kind === 'mc' || cell.kind === 'mcr') {
    out.push({
      mnemonic: profile.instructionNames[cell.kind],
      operand: profile.formatDevice(cell.device),
    });
    return;
  }
  if (cell.kind === 'timer') {
    const preset = profile.timerPreset(cell.presetMs, cell.device);
    if (preset instanceof Error) {
      errors.push({ code: 'preset-unavailable', message: preset.message, device: cell.device, networkId });
    }
    out.push(
      presetEmit(profile, 'timer', cell.device, preset instanceof Error ? '?' : preset.text),
    );
    return;
  }
  const preset = profile.counterPresetText?.(cell.preset) ?? String(cell.preset);
  out.push(presetEmit(profile, 'counter', cell.device, preset));
  // リセットは実機と同じく別の回路として書く（IRはセルに resetDevice を持っている）
  out.push({
    mnemonic: profile.instructionNames.ld,
    operand: profile.formatDevice(cell.resetDevice),
  });
  out.push({
    mnemonic: profile.instructionNames.rst,
    operand: profile.formatDevice(cell.device),
  });
}

/** ネットワーク1つを命令語にする。 */
function emitNetwork(
  net: CompiledNetwork,
  profile: DialectProfile,
  out: Emit[],
  errors: DialectError[],
): void {
  if (net.isEnd) {
    out.push({ mnemonic: profile.instructionNames.end, operand: '' });
    return;
  }
  const edges = buildEdges(net);
  let previousKey = '';
  for (const output of net.outputs) {
    const expr = reduceToExpr(edges, nodeId(output.row, COIL_COL));
    if (expr === undefined) {
      errors.push({
        code: 'not-series-parallel',
        message: `${net.id} は直列・並列に分解できないため命令語リストにできません`,
        networkId: net.id,
        row: output.row,
        col: output.col,
      });
      continue;
    }
    const key = exprKey(expr);
    if (key !== previousKey) emitBlock(expr, profile, out);
    previousKey = key;
    emitOutput(output.cell, profile, net.id, out, errors);
  }
}

/** テキストへ整形する（UTF-8・CRLF。§10.7）。 */
function render(lines: readonly InstructionLine[], source: LadderProgram): string {
  const comments = new Map(source.networks.map((net) => [net.id, net.comment ?? '']));
  const rows: string[] = [];
  let current = '';
  for (const line of lines) {
    if (line.networkId !== current) {
      current = line.networkId;
      rows.push(`; ${current}  ${comments.get(current) ?? ''}`.trimEnd());
    }
    rows.push(
      `${String(line.step).padStart(4, '0')}  ${line.mnemonic.padEnd(10)}${line.operand}`.trimEnd(),
    );
  }
  return rows.length === 0 ? '' : `${rows.join('\r\n')}\r\n`;
}

/**
 * ラダーを方言の命令語リストへ書き出す。§10.7 / §16 Phase 4 受入基準⑥
 * 変換に落ちるラダーは行を1つも作らず `compile-failed` を返す（実機でも書き込めない）。
 */
export function instructionList(
  source: LadderProgram,
  profile: DialectProfile,
): InstructionListResult {
  const compiled = compile(source);
  if (!compiled.ok) {
    return {
      lines: [],
      text: '',
      errors: compiled.errors.map((error) => ({
        code: 'compile-failed',
        message: error.message,
        ...(error.networkId === '' ? {} : { networkId: error.networkId }),
      })),
    };
  }
  const errors: DialectError[] = [];
  const lines: InstructionLine[] = [];
  for (const net of compiled.program.networks.slice(0, compiled.program.endNetworkIndex + 1)) {
    const emits: Emit[] = [];
    emitNetwork(net, profile, emits, errors);
    for (const emit of emits) {
      lines.push({ step: lines.length, mnemonic: emit.mnemonic, operand: emit.operand, networkId: net.id });
    }
  }
  return { lines, text: render(lines, source), errors };
}
```

- [ ] **Step 6: `src/index.ts` に足す**

```ts
export {
  instructionList,
  INSTRUCTION_LIST_MESSAGES,
  type InstructionLine,
  type InstructionListResult,
} from './instruction-list.js';
```

- [ ] **Step 7: GREEN を確認する**

```powershell
pnpm --filter @ojt/plc-dialects exec vitest run
pnpm --filter @ojt/plc-dialects exec vitest run --coverage
```

Expected: 全ファイル通過。カバレッジ90%以上。もし `not-series-parallel` の枝が未到達でカバレッジが落ちるなら、テストに「ブリッジ回路（`[no(X0), vline(), no(X1)]` と `[no(X2), vline(), no(X3)]` の2行を中央で横に繋いだ形）が `not-series-parallel` になる」ケースを足す。

- [ ] **Step 8: バッチBのレビューとコミット**

```powershell
pnpm --filter @ojt/plc-dialects exec tsc --noEmit
npx prettier --check "packages/plc-dialects/**/*.ts"
git add packages/plc-dialects
git commit -m "feat(plc-dialects): export the instruction list in each dialect"
```

ここで**バッチB のレビュー（Opus 1回）**をかける。見どころ: ①直並列簡約が内蔵課題8題の全ネットワークで `not-series-parallel` を出さないか（レビューで `BUILTIN_PLC_PROBLEMS` を読み込んで確かめる probe を書いてよい）②`presetEmit` の接頭辞合流が4方言で意図どおりか ③CRLF とステップ番号の連番。

---

## Task 8: `PlcUnitSpec` を「8点1コモン・点別入力抵抗・機種別AC端子」に対応させる

**モデル: Opus**（既存3パッケージに跨る型変更で、振る舞いを変えないことの確認が要るため）

**Files:**
- Modify: `packages/circuit-sim/src/plc.ts`・`src/parts.ts`・`src/index.ts`
- Modify: `packages/board-model/src/plc-unit.ts`（FX5U の追随と `plcRole` の一般化）
- Modify: `packages/content/src/plc-reference.ts`・`src/plc-static-checks.ts`（呼び出し側の追随）
- Modify: `apps/desktop/src/renderer/ladder/IoTable.tsx`（L32 の1行。型追随）
- Modify: `apps/desktop/src/renderer/ladder/MonitorPanel.tsx`（L94 の1行。型追随）
- Test: `packages/circuit-sim/test/helpers/plc.ts`・`test/plc-part.test.ts`・`test/plc-physics-review.test.ts`
- Test: `packages/board-model/test/plc-unit.test.ts`
- Test: `apps/desktop/test/monitor-panel.test.tsx`（L60 の期待値は不変。注記だけ足す）

**振る舞いは変えない**。FX5U のネットリスト・端子・判定はこのタスクの前後で同一でなければならない（既存テストがそのまま通ることで確かめる）。変えるのは「機種を足せる形」にするための型だけである（決定表#9・#10）。

`inputs` の要素が `string` から `PlcInputSpec` になるため、**`apps/desktop` の2箇所も一緒に直す**（`IoTable.tsx` L32 と `MonitorPanel.tsx` L94。どちらも `unit.spec.inputs[i]` を端子名の文字列として使っている）。直さないと `pnpm -r typecheck` が落ちるので、4B を待てない。Step 7 で扱う。

| 変更 | 前 | 後 |
|---|---|---|
| 入力1点 | `inputs: readonly string[]`（端子名） | `inputs: readonly PlcInputSpec[]`（`{name, com, ohms?}`） |
| 入力コモン | `inputCommon: string`（単数） | `inputCommons: readonly string[]`（8点1コモンの機種は2つ） |
| AC電源端子 | `checkPlcPowerIndependent` が `'L'`/`'N'` を直書き | `acPower: readonly [string, string]`（CP1E は `L1`/`L2N`） |
| `PartMeta` | `inputCommon: TerminalId` | `inputCommons: readonly TerminalId[]` |

- [ ] **Step 1: 失敗するテストを書く（既存テストの更新が RED になる）**

`packages/circuit-sim/test/helpers/plc.ts` の spec を新しい形にする:

```ts
    power: ['L', 'PE', 'N'],
    acPower: ['L', 'N'],
    inputCommons: ['SS'],
    inputs: ['X0', 'X1', 'X2', 'X3'].map((name) => ({ name, com: 'SS' })),
```

（`inputs` の並びと端子名は変えない。`plc-physics-review.test.ts` の2箇所の spec も同じ形に直す。）

`packages/circuit-sim/test/plc-part.test.ts` の `expect(meta?.inputCommon).toBe('PLC.SS');` を次にする:

```ts
    expect(meta?.inputCommons).toEqual(['PLC.SS']);
```

`packages/board-model/test/plc-unit.test.ts` の入力端子名の検査を次にする:

```ts
    expect(FX5U_SPEC.inputs.map((input) => input.name)).toEqual([
```

同じファイルに、点別の値とAC端子の検査を足す:

```ts
  it('ties every input to the single S/S common and the AC pair to L and N (§10.1)', () => {
    expect(FX5U_SPEC.inputCommons).toEqual(['SS']);
    expect(FX5U_SPEC.inputs.every((input) => input.com === 'SS')).toBe(true);
    expect(FX5U_SPEC.acPower).toEqual(['L', 'N']);
  });
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/plc-part.test.ts
```

Expected: 失敗（`inputCommons` が無い／`inputs` の型が合わない）。

- [ ] **Step 3: `packages/circuit-sim/src/plc.ts` を直す**

`PlcOutputSpec` の直後に足す:

```ts
/**
 * 入力1点の仕様（端子名・所属する入力コモン・入力回路の抵抗）。§10.1 / §5.1.3
 * 8点1コモンの機種（TOYOPUC `IN-12` / シャープ `JW-212NA`）と、点によって抵抗が違う機種
 * （CP1E は `0.00`〜`0.07` が 3.3kΩ、`0.08` 以降が 4.8kΩ）を表すために点ごとに持つ。
 */
export interface PlcInputSpec {
  name: string;
  com: string;
  /** この点の入力回路の抵抗[Ω]。省略時は `PlcUnitSpec.inputOhms`。 */
  ohms?: number;
}
```

`PlcUnitSpec` の `inputCommon` / `inputs` を次で置き換える（他の項目はそのまま）:

```ts
  /** 壁コンセントへ配線するAC電源端子（活線側・中性線側）。§10.1 */
  acPower: readonly [string, string];
  /** 入力コモン端子名（`S/S` 相当。8点1コモンの機種は複数。端子IDに使うので `/` は入れない）。 */
  inputCommons: readonly string[];
  /** 入力端子（並び順が入力番号）。 */
  inputs: readonly PlcInputSpec[];
```

`createPlcUnit()` の本体を次のように直す（変更箇所のみ）:

```ts
  const commons = new Set(spec.commons);
  for (const output of spec.outputs) {
    if (!commons.has(output.com)) {
      throw new PlcUnitError(`出力 ${output.name} のCOM端子が機種にありません: ${output.com}`);
    }
  }
  const inputCommons = new Set(spec.inputCommons);
  for (const input of spec.inputs) {
    if (!inputCommons.has(input.com)) {
      throw new PlcUnitError(`入力 ${input.name} のコモン端子が機種にありません: ${input.com}`);
    }
  }
  const power = new Set(spec.power);
  for (const name of spec.acPower) {
    if (!power.has(name)) {
      throw new PlcUnitError(`AC電源端子が機種の電源端子にありません: ${name}`);
    }
  }
```

入力要素の組み立てを次にする:

```ts
  const inputs: PlcInputChannel[] = spec.inputs.map((input, index) => {
    const terminal = term(input.name);
    const elementId = `${pid}:in${index}`;
    const load: LoadElement = {
      kind: 'load',
      id: elementId,
      from: term(input.com),
      to: terminal,
      load: 'plcInput',
      nominalOhms: input.ohms ?? inputOhms,
      polarized: false,
    };
    elements.push(load);
    return { name: input.name, terminal, elementId };
  });
```

端子一覧とメタデータを次にする（`const inputCommon = term(spec.inputCommon);` の行は削除する）:

```ts
  const commonTerminals = spec.inputCommons.map(term);
  const terminals: TerminalId[] = [
    ...spec.power.map(term),
    ...commonTerminals,
    ...(spec.service ?? []).map(term),
    ...inputs.map((channel) => channel.terminal),
    ...spec.commons.map(term),
    ...outputs.map((channel) => channel.terminal),
  ];
```

```ts
    meta: {
      kind: 'plc',
      model: spec.model,
      inputCommons: commonTerminals,
      inputs,
      outputs,
      onAmps,
      offAmps,
      power: spec.power.map(term),
    },
```

- [ ] **Step 4: `packages/circuit-sim/src/parts.ts` と `src/index.ts` を直す**

`PartMeta` の `inputCommon: TerminalId;` を次にする:

```ts
      /** 入力コモン端子（8点1コモンの機種は複数）。§10.1 */
      inputCommons: readonly TerminalId[];
```

`src/index.ts` の `plc.js` からの再エクスポートに `type PlcInputSpec` を足す。

- [ ] **Step 5: `packages/board-model/src/plc-unit.ts` を追随させる**

`FX5U_SPEC` を次にする:

```ts
/** FX5U-32MR/ES の電気的な仕様。§10.1 / §5.1.3 */
export const FX5U_SPEC: PlcUnitSpec = {
  model: 'FX5U',
  power: ['L', 'PE', 'N'],
  acPower: ['L', 'N'],
  inputCommons: ['SS'],
  service: ['24V', '0V'],
  inputs: octalNames('X', 16).map((name) => ({ name, com: 'SS' })),
  commons: ['COM0', 'COM1', 'COM2', 'COM3'],
  outputs: octalNames('Y', 16).map((name, index) => ({
    name,
    com: `COM${Math.floor(index / FX5U_POINTS_PER_COMMON)}`,
  })),
  inputOhms: FX5U_INPUT_OHMS,
  onAmps: FX5U_ON_AMPS,
  offAmps: FX5U_OFF_AMPS,
};
```

`plcRole()` を機種仕様から引く形にする（名前の綴りに頼らない。Phase 4 の `0.00` / `A0` / `COM.A` に備える）:

```ts
/** 端子名 → 役割（§6.6 の `role`）。機種仕様の集合から引く。 */
function plcRole(spec: PlcUnitSpec, name: string): TerminalRole {
  if (name === spec.acPower[0]) return 'ac-l';
  if (name === spec.acPower[1]) return 'ac-n';
  if (spec.power.includes(name)) return 'ac';
  if (spec.inputCommons.includes(name)) return 'ss';
  if (spec.commons.includes(name)) return 'plc-com';
  if ((spec.service ?? []).includes(name)) return name === '0V' || name === '-' ? '-' : '+';
  if (spec.inputs.some((input) => input.name === name)) return 'x';
  return 'y';
}
```

`plcLabel()` に CP1E の銘板を足す:

```ts
function plcLabel(name: string): string {
  if (name === 'SS') return 'S/S';
  if (name === 'PE') return '⏚';
  if (name === 'L2N') return 'L2/N';
  return name;
}
```

`staggeredTerminals()` に機種仕様を渡すようにし（`plcRole(spec, name)`）、`fx5uTerminals()` の入力側を次にする:

```ts
  const inputSide = [
    ...FX5U_SPEC.power,
    ...FX5U_SPEC.inputCommons,
    ...(FX5U_SPEC.service ?? []),
    ...FX5U_SPEC.inputs.map((input) => input.name),
  ];
```

- [ ] **Step 6: `@ojt/content` の呼び出し側を追随させる（コンパイルを通す最小の変更）**

`packages/content/src/plc-reference.ts` の `plcWiringPlan()`:

```ts
  const inputName = (x: number): string => unit.spec.inputs[x]?.name ?? `X${x}`;
```

入力コモンを鎖に入れる2箇所を次にする（FX5U は1本なので従来と同じ配線になる）:

```ts
    ...(io.wiring === 'sink' ? unit.spec.inputCommons.map(plcTerminal) : []),
```

```ts
    ...(io.wiring === 'source' ? unit.spec.inputCommons.map(plcTerminal) : []),
```

PLC電源の2本を次にする:

```ts
  wires.push({ from: terminalId('OUTLET', 'L'), to: plcTerminal(unit.spec.acPower[0]) });
  wires.push({ from: terminalId('OUTLET', 'N'), to: plcTerminal(unit.spec.acPower[1]) });
```

`packages/content/src/plc-static-checks.ts`:

```ts
function inputTerminal(unit: PlcUnitDefinition, x: number): TerminalId {
  return plcTerminal(unit.spec.inputs[x]?.name ?? `X${x}`);
}
```

```ts
/** 入力コモンの結線方式を判定する。§10.2（8点1コモンの機種はどれか1本でも判定できる） */
export function detectPlcWiring(
  nets: Nets,
  unit: PlcUnitDefinition,
): 'sink' | 'source' | undefined {
  const terminals = unit.spec.inputCommons.flatMap((name) => netTerminals(nets, plcTerminal(name)));
  if (terminals.some((id) => id.startsWith('P.'))) return 'sink';
  if (terminals.some((id) => id.startsWith('N.'))) return 'source';
  return undefined;
}
```

`checkPlcPowerIndependent()` の `for (const name of ['L', 'N'])` を次にする:

```ts
  for (const name of plc.unit.spec.acPower) {
```

（`checkIoAssignment()` の三菱固有の正規表現は Task 13 で直す。）

- [ ] **Step 7: `apps/desktop` の2行を追随させる（型追随の最小変更）**

`unit.spec.inputs[x]` の型が `string | undefined` から `PlcInputSpec | undefined` になるので、端子名を
そのまま使っている2箇所が `pnpm -r typecheck` で落ちる。**この2行だけ**を直す（4B の担当ではない）。

`apps/desktop/src/renderer/ladder/IoTable.tsx` L32:

```ts
  const inputTerminal = (x: number): string | undefined => unit.spec.inputs[x]?.name;
```

`apps/desktop/src/renderer/ladder/MonitorPanel.tsx` L94（L34 のヘルパ `terminal` は
`(name: string | undefined): string` で端子名を受けるので、渡すものを端子名に戻す）:

```tsx
                  <td>{terminal(unit.spec.inputs[index]?.name)}</td>
```

`apps/desktop/test/monitor-panel.test.tsx` L60 の期待値（`'PLC.X0'`）は**そのまま通る**（FX5U の入力0の
端子名は `X0` のままだから）。取り違えを防ぐため、その行の上に1行の注記だけ足す:

```ts
    // 端子名は機種仕様（`unit.spec.inputs[i].name`）から引く。FX5U の入力0は `X0`（Task 8 で型だけ変えた）
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('PLC.X0');
```

出力側（`unit.spec.outputs[y]?.name`）は Phase 3 から `PlcOutputSpec` なので変更は要らない。

- [ ] **Step 8: GREEN を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run
pnpm --filter @ojt/board-model exec vitest run
pnpm --filter @ojt/content exec vitest run
pnpm --filter @ojt/desktop exec vitest run test/monitor-panel.test.tsx
pnpm -r typecheck
```

Expected: 4プロジェクトとも着手前と**同じ件数**が通る（振る舞いを変えていないため）。特に `board-model/test/plc-netlist.test.ts` と `content/test/builtin-plc.test.ts` と `desktop/test/monitor-panel.test.tsx` が期待値を1つも変えずに通ること。

- [ ] **Step 9: コミットする**

```powershell
git add packages/circuit-sim packages/board-model packages/content apps/desktop
git commit -m "refactor(circuit-sim): let a PLC spec describe per-point commons, resistance and AC terminals"
```

---

## Task 9: 外観記述（`PlcAppearance`）と OMRON CP1E-N30DR-A（一体形）の本体定義

**モデル: Opus**（面上の配置を決める判断があるため）

**Files:**
- Modify: `packages/board-model/src/board-jipm.ts`（`PlcUnitDefinition.form` / `appearance`）
- Modify: `packages/board-model/src/plc-unit.ts`
- Modify: `packages/board-model/src/index.ts`
- Test: `packages/board-model/test/plc-appearance.test.ts`（新規）
- Test: `packages/board-model/test/plc-cp1e.test.ts`（新規）

§10.1 の CP1E 行を実装し、あわせて**3Dが忠実な外観を描くためのデータ構造**を入れる（決定表#15。利用者の要求「各メーカーのシーケンサーの外観を忠実に再現すること」に対応する）。一体形なので端子の並べ方は FX5U と同じ千鳥2列でよい（前提#16 の定数をそのまま使う）。COM分けは §17.1 の前提値 3/3/2/2/2、入力抵抗は §5.1.3 の 3.3kΩ（`0.00`〜`0.07`）と 4.8kΩ（`0.08` 以降）。

**外観の座標系**: 正面（訓練者から見える面）の**左上を原点**、x が右、y が下、単位はmm。`faceMm` は本体（ラックはモジュール1枚）の正面の大きさで、矩形はすべてこの中に収まる。3Dは 4B がこの記述だけを読んで描く（色や座標を直書きしない）。

**素材の出どころ**: 外形寸法はカタログ値（§10.1）、色と面上の配置は一般に知られた見え方から自前で作図した**本アプリの記述**である。実機写真・純正画像・ロゴは使わない（§17.1 / PLC調査資料 §6・§7）。銘板は**型式の文字列だけ**を描き、商標の帰属は設定画面の `trademarkNotice`（§15、Phase 1D で実装済み）に載せる。

- [ ] **Step 1: 失敗するテストを書く（外観）**

`packages/board-model/test/plc-appearance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PLC_UNITS, type PlcAppearance } from '../src/index.js';

/** 外観記述1件（本体またはモジュール）とその名前。 */
const faces: [string, PlcAppearance][] = Object.values(PLC_UNITS).flatMap((unit) => [
  [unit.model, unit.appearance] as [string, PlcAppearance],
  ...(unit.modules ?? []).map((m) => [`${unit.model}/${m.model}`, m.appearance] as [string, PlcAppearance]),
]);

describe('PlcAppearance（3Dが外観を描くための記述）', () => {
  it('exists for every catalogue unit and every rack module', () => {
    // Task 9 の時点は FX5U と CP1E の2機種だけ。Task 10 で `3 + 4`、Task 11 で `4 + 4 + 4` に上げる
    expect(faces.length).toBe(2);
    for (const [name, face] of faces) {
      expect(face.faceMm.width, name).toBeGreaterThan(0);
      expect(face.faceMm.height, name).toBeGreaterThan(0);
      expect(face.bodyColor, name).toMatch(/^#[0-9A-F]{6}$/u);
      expect(face.terminalBlockColor, name).toMatch(/^#[0-9A-F]{6}$/u);
      expect(face.nameplate.trim().length, name).toBeGreaterThan(0);
    }
  });

  it('keeps every rect inside the face', () => {
    for (const [name, face] of faces) {
      const rects = [
        face.nameplateRect,
        ...face.covers.map((c) => c.rect),
        ...face.leds.map((l) => l.rect),
        ...face.features.map((f) => f.rect),
      ];
      for (const rect of rects) {
        expect(rect.x, name).toBeGreaterThanOrEqual(0);
        expect(rect.y, name).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, name).toBeLessThanOrEqual(face.faceMm.width);
        expect(rect.y + rect.h, name).toBeLessThanOrEqual(face.faceMm.height);
      }
    }
  });

  it('matches the unit face to the unit size (§10.1 のカタログ寸法)', () => {
    for (const unit of Object.values(PLC_UNITS)) {
      expect(unit.appearance.faceMm, unit.model).toEqual({
        width: unit.sizeMm.width,
        height: unit.sizeMm.height,
      });
      for (const module of unit.modules ?? []) {
        expect(module.appearance.faceMm, module.model).toEqual({
          width: module.sizeMm.width,
          height: module.sizeMm.height,
        });
      }
    }
  });

  it('puts only the model string on the nameplate — no logo, no brand (§17 / PLC調査資料 §6)', () => {
    for (const [name, face] of faces) {
      expect(face.nameplate, name).not.toMatch(
        /三菱|MITSUBISHI|MELSEC|OMRON|オムロン|JTEKT|ジェイテクト|TOYOPUC|SHARP|シャープ/iu,
      );
      expect(face.nameplate, name).toMatch(/^[0-9A-Z][0-9A-Z./-]*$/u);
    }
  });

  it('marks which appearance values are assumptions (§17.1)', () => {
    for (const [name, face] of faces) {
      expect(face.assumed.length, name).toBeGreaterThan(0);
      for (const item of face.assumed) expect(item.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives FX5U its status LEDs, hinged covers and front features (§10.1)', () => {
    const fx5u = PLC_UNITS['FX5U']?.appearance;
    expect(fx5u?.nameplate).toBe('FX5U-32MR/ES');
    expect(fx5u?.leds.filter((l) => l.group === 'status').map((l) => l.name)).toEqual([
      'PWR',
      'ERR',
      'P.RUN',
      'BAT',
      'CARD',
    ]);
    expect(fx5u?.leds.filter((l) => l.group === 'input')).toHaveLength(16);
    expect(fx5u?.leds.filter((l) => l.group === 'output')).toHaveLength(16);
    expect(fx5u?.covers.map((c) => c.hinge)).toEqual(['top', 'bottom']);
    expect(fx5u?.features.map((f) => f.id)).toEqual(['run-stop', 'ethernet', 'sd-card']);
  });
});
```

- [ ] **Step 2: 失敗するテストを書く（CP1E）**

`packages/board-model/test/plc-cp1e.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CP1E_SPEC,
  JIPM_BOARD,
  PLC_UNIT_CP1E,
  plcUnitFor,
  validateBoard,
  withPlcUnit,
} from '../src/index.js';

describe('PLC_UNIT_CP1E（§10.1 / §17.1 の前提値）', () => {
  it('describes the CP1E-N30DR-A body', () => {
    expect(PLC_UNIT_CP1E.model).toBe('CP1E');
    expect(PLC_UNIT_CP1E.vendor).toBe('omron');
    expect(PLC_UNIT_CP1E.form).toBe('unit');
    expect(PLC_UNIT_CP1E.sizeMm).toEqual({ width: 130, height: 90, depth: 85 });
    expect(PLC_UNIT_CP1E.leds).toEqual(['POWER', 'RUN', 'ERR', 'ALM']);
    expect(plcUnitFor('CP1E')).toBe(PLC_UNIT_CP1E);
  });

  it('names 18 inputs and 12 outputs in the CIO spelling (§10.1)', () => {
    expect(CP1E_SPEC.inputs.map((i) => i.name).slice(0, 3)).toEqual(['0.00', '0.01', '0.02']);
    expect(CP1E_SPEC.inputs.map((i) => i.name).slice(11, 14)).toEqual(['0.11', '1.00', '1.01']);
    expect(CP1E_SPEC.inputs).toHaveLength(18);
    expect(CP1E_SPEC.outputs.map((o) => o.name).slice(0, 2)).toEqual(['100.00', '100.01']);
    expect(CP1E_SPEC.outputs.map((o) => o.name).slice(8, 10)).toEqual(['101.00', '101.01']);
    expect(CP1E_SPEC.outputs).toHaveLength(12);
  });

  it('splits the outputs 3/3/2/2/2 over five commons (§17.1 の前提値)', () => {
    expect(CP1E_SPEC.commons).toEqual(['COM0', 'COM1', 'COM2', 'COM3', 'COM4']);
    expect(CP1E_SPEC.outputs.map((o) => o.com)).toEqual([
      'COM0', 'COM0', 'COM0',
      'COM1', 'COM1', 'COM1',
      'COM2', 'COM2',
      'COM3', 'COM3',
      'COM4', 'COM4',
    ]);
  });

  it('uses the two input resistances of §5.1.3 and the L1 / L2N power pair', () => {
    expect(CP1E_SPEC.inputs.slice(0, 8).every((i) => i.ohms === 3300)).toBe(true);
    expect(CP1E_SPEC.inputs.slice(8).every((i) => i.ohms === 4800)).toBe(true);
    expect(CP1E_SPEC.inputCommons).toEqual(['COM']);
    expect(CP1E_SPEC.power).toEqual(['L1', 'L2N']);
    expect(CP1E_SPEC.acPower).toEqual(['L1', 'L2N']);
    expect(CP1E_SPEC.service).toEqual(['+', '-']);
  });

  it('puts every terminal on the board with a readable label (§8.2)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_CP1E);
    const ids = board.terminals.map((t) => String(t.id));
    expect(ids).toContain('PLC.0.00');
    expect(ids).toContain('PLC.1.05');
    expect(ids).toContain('PLC.100.00');
    expect(ids).toContain('PLC.COM4');
    expect(ids).toContain('PLC.L1');
    const plc = board.terminals.filter((t) => String(t.id).startsWith('PLC.'));
    // 電源2 ＋ 入力コモン1 ＋ サービス2 ＋ 入力18 ＋ COM5 ＋ 出力12 = 40
    expect(plc).toHaveLength(40);
    expect(plc.every((t) => t.wirable && t.label.trim().length > 0)).toBe(true);
    expect(plc.find((t) => String(t.id) === 'PLC.L2N')?.label).toBe('L2/N');
    expect(plc.find((t) => String(t.id) === 'PLC.COM')?.role).toBe('ss');
    expect(plc.find((t) => String(t.id) === 'PLC.100.00')?.role).toBe('y');
    expect(validateBoard(board)).toEqual([]);
  });
});
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/board-model exec vitest run test/plc-appearance.test.ts test/plc-cp1e.test.ts
```

Expected: 失敗。`does not provide an export named 'CP1E_SPEC'` / `PlcAppearance`。

- [ ] **Step 4: `src/board-jipm.ts` に外観の型と `form` を足す**

`PlcUnitDefinition` の直前に足す:

```ts
/** 正面の矩形[mm]。**正面の左上が原点**、x が右、y が下。§10.1 */
export interface FaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** LED 1個。`name` は実機の印字（`PWR` / `X0`）。§10.1 */
export interface PlcLedMark {
  name: string;
  /** 本体表示（`status`）か入出力表示（`input` / `output`）か。 */
  group: 'status' | 'input' | 'output';
  rect: FaceRect;
  /** 点灯時の色。 */
  color: string;
}

/** ヒンジ式の端子カバー。§10.1（FX5U は着脱式端子台のカバー、ラックは端子台カバー） */
export interface PlcCoverMark {
  id: string;
  rect: FaceRect;
  color: string;
  /** 蝶番の辺（開く向き）。 */
  hinge: 'top' | 'bottom' | 'left' | 'right';
}

/** 正面の造作（スイッチ・コネクタ・スロット・ラッチ）。§10.1 */
export interface PlcFeatureMark {
  id: string;
  kind: 'switch' | 'port' | 'slot' | 'latch';
  /** 3Dのツールチップに出す名前。 */
  label: string;
  rect: FaceRect;
  color: string;
}

/**
 * 1機種（ラックはモジュール1枚）の外観。§10.1 / §17.1 / 決定表#15
 *
 * 外形寸法はカタログ値、色と面上の配置は一般に知られた見え方から作図した**本アプリの記述**で、
 * 実機写真・純正画像・各社のロゴは一切持たない（PLC調査資料 §6・§7）。銘板は**型式の文字列だけ**
 * を描き、商標の帰属は設定画面の `trademarkNotice`（§15）に載せる。
 * 実機と異なると分かった場合の修正箇所は `plc-unit.ts` の `*_APPEARANCE` だけである。
 */
export interface PlcAppearance {
  /** 正面の大きさ[mm]（本体は `sizeMm` の W×H、モジュールはモジュールの W×H）。 */
  faceMm: { width: number; height: number };
  /** 筐体の色。 */
  bodyColor: string;
  /** 端子台（ネジ端子ブロック）の色。 */
  terminalBlockColor: string;
  /** 銘板の文字（型式のみ）。 */
  nameplate: string;
  nameplateRect: FaceRect;
  covers: readonly PlcCoverMark[];
  leds: readonly PlcLedMark[];
  features: readonly PlcFeatureMark[];
  /** この外観のうち §17.1 の前提値である項目（4B が注記に使う）。 */
  assumed: readonly string[];
}
```

同じ位置に、ラック形のモジュール1枚を表す型も置く（実体を作るのは Task 10・11 だが、
`PlcUnitDefinition.modules?` を先に生やしておかないと外観のテストが型検査を通らない）:

```ts
/**
 * ラック形PLCのモジュール1枚。§10.1 / §17 #21
 * 端子は `PlcUnitDefinition.terminals` に平らに載っている（ネットリスト上はラックでも1部品。
 * 決定表#11）。ここにあるのは 4B が箱を描くための寸法・位置・外観だけである。
 */
export interface PlcModuleDefinition {
  /** ベース内のスロット番号（0起点）。 */
  slot: number;
  /** 形式名（`IN-12` / `JW-212NA`）。 */
  model: string;
  displayName: string;
  sizeMm: { width: number; height: number; depth: number };
  /** 机上の設置位置（モジュールの左奥の角）。 */
  pos: Vec3;
  /** このモジュールの外観。§10.1 / 決定表#15 */
  appearance: PlcAppearance;
}
```

`PlcUnitDefinition` の `displayName` の直後に足す:

```ts
  /** 一体形（`unit`）かラック形（`rack`）か。§10.1 */
  form: 'unit' | 'rack';
  /** 本体（ラックはベース）の外観。§10.1 / 決定表#15 */
  appearance: PlcAppearance;
```

`leds` の直前に足す:

```ts
  /** ラック形のときのモジュール一覧（一体形は持たない）。§10.1 */
  modules?: readonly PlcModuleDefinition[];
```

- [ ] **Step 5: `src/plc-unit.ts` に外観の道具と FX5U の外観を足す**

`./board-jipm.js` からの型 import に `FaceRect` / `PlcAppearance` / `PlcCoverMark` / `PlcLedMark` / `PlcFeatureMark` / `PlcModuleDefinition` を足したうえで:

```ts
/** LEDの点灯色（本アプリ既定）。 */
export const PLC_LED_GREEN = '#35C759';
export const PLC_LED_RED = '#FF3B30';
export const PLC_LED_AMBER = '#FFB020';

/**
 * LEDを横1列に並べる。`pitch` は中心間隔[mm]。
 * `colorOverrides` に名前があればそちらの色を使う（既定色 `color` は他の全灯）。§10.1
 */
export function ledRow(
  names: readonly string[],
  group: PlcLedMark['group'],
  at: { x: number; y: number; w: number; h: number; pitch: number },
  color: string,
  colorOverrides: Readonly<Record<string, string>> = {},
): PlcLedMark[] {
  return names.map((name, index) => ({
    name,
    group,
    rect: { x: at.x + index * at.pitch, y: at.y, w: at.w, h: at.h },
    color: colorOverrides[name] ?? color,
  }));
}

/** 濃灰の筐体（FX5U）。 */
const FX5U_BODY_COLOR = '#3A3D42';
/** 明灰のヒンジ式端子カバー（FX5U）。 */
const FX5U_COVER_COLOR = '#C8CBD0';

/**
 * FX5U-32MR/ES の外観。§10.1 / 決定表#15
 * 濃灰の筐体に明灰のヒンジ式端子カバーが上下2枚、中央の帯に本体表示LED・銘板・入出力表示LED・
 * RUN/STOPスイッチ・Ethernetポート・SDカードスロットが並ぶ。色と配置は本アプリの記述である。
 */
export const FX5U_APPEARANCE: PlcAppearance = {
  faceMm: { width: 150, height: 90 },
  bodyColor: FX5U_BODY_COLOR,
  terminalBlockColor: '#1F2226',
  nameplate: 'FX5U-32MR/ES',
  nameplateRect: { x: 54, y: 28, w: 60, h: 6 },
  covers: [
    { id: 'input-cover', rect: { x: 0, y: 0, w: 150, h: 26 }, color: FX5U_COVER_COLOR, hinge: 'top' },
    { id: 'output-cover', rect: { x: 0, y: 64, w: 150, h: 26 }, color: FX5U_COVER_COLOR, hinge: 'bottom' },
  ],
  leds: [
    // §10.1: PWR(緑) / ERR(赤) / P.RUN(緑) / BAT(赤) / CARD(緑)
    ...ledRow(['PWR', 'ERR', 'P.RUN', 'BAT', 'CARD'], 'status', { x: 6, y: 28, w: 4, h: 3, pitch: 9 }, PLC_LED_GREEN, { ERR: PLC_LED_RED, BAT: PLC_LED_RED }),
    ...ledRow(octalNames('X', 16), 'input', { x: 6, y: 36, w: 3, h: 3, pitch: 8.5 }, PLC_LED_AMBER),
    ...ledRow(octalNames('Y', 16), 'output', { x: 6, y: 42, w: 3, h: 3, pitch: 8.5 }, PLC_LED_AMBER),
  ],
  features: [
    { id: 'run-stop', kind: 'switch', label: 'RUN/STOP/RESET スイッチ', rect: { x: 6, y: 50, w: 24, h: 8 }, color: '#8A8F96' },
    { id: 'ethernet', kind: 'port', label: 'Ethernetポート', rect: { x: 36, y: 49, w: 16, h: 11 }, color: '#1F2226' },
    { id: 'sd-card', kind: 'slot', label: 'SDカードスロット', rect: { x: 58, y: 49, w: 14, h: 11 }, color: '#1F2226' },
  ],
  assumed: [
    '筐体色・端子カバー色（一般に知られた見え方。実機写真は使っていない）',
    'LED・スイッチ・コネクタの面上の位置（カタログ寸法と一般的な前面構成から作図）',
    '銘板は型式の文字列のみ（ロゴ・ブランド名は描かない）',
  ],
};
```

`PLC_UNIT_FX5U` に `form: 'unit',` と `appearance: FX5U_APPEARANCE,` を足す（`leds` は既存のまま残す。名前の一覧として他のテストが使っている）。

- [ ] **Step 6: `src/plc-unit.ts` に CP1E を足す**

```ts
/** CP1E の入力抵抗[Ω]（`0.00`〜`0.07`）。§5.1.3 */
export const CP1E_INPUT_OHMS_LOW = 3300;
/** CP1E の入力抵抗[Ω]（`0.08` 以降）。§5.1.3 */
export const CP1E_INPUT_OHMS_HIGH = 4800;
/** CP1E の出力COMごとの点数（§17.1 の前提値 3/3/2/2/2）。 */
export const CP1E_COMMON_SIZES: readonly number[] = [3, 3, 2, 2, 2];

/** `ch.bit` 形式の端子名を作る（`0.00`〜`0.11`）。§10.1 */
export function channelNames(ch: number, count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => `${ch}.${String(i).padStart(2, '0')}`);
}

/** 出力の並びから所属COMを決める（先頭から `sizes` 点ずつ）。 */
function commonOf(index: number, sizes: readonly number[]): string {
  let start = 0;
  for (const [group, size] of sizes.entries()) {
    if (index < start + size) return `COM${group}`;
    start += size;
  }
  return `COM${sizes.length - 1}`;
}

/** CP1E-N30DR-A の電気的な仕様。§10.1 / §5.1.3 / §17.1 */
export const CP1E_SPEC: PlcUnitSpec = {
  model: 'CP1E',
  power: ['L1', 'L2N'],
  acPower: ['L1', 'L2N'],
  inputCommons: ['COM'],
  service: ['+', '-'],
  inputs: [...channelNames(0, 12), ...channelNames(1, 6)].map((name, index) => ({
    name,
    com: 'COM',
    ohms: index < 8 ? CP1E_INPUT_OHMS_LOW : CP1E_INPUT_OHMS_HIGH,
  })),
  commons: CP1E_COMMON_SIZES.map((_unused, group) => `COM${group}`),
  outputs: [...channelNames(100, 8), ...channelNames(101, 4)].map((name, index) => ({
    name,
    com: commonOf(index, CP1E_COMMON_SIZES),
  })),
};

/** CP1E の端子（入力側の列 → 出力側の列）。§10.1 の記載順 / §17 #11 */
function cp1eTerminals(): BoardTerminal[] {
  const inputSide = [
    ...CP1E_SPEC.power,
    ...CP1E_SPEC.inputCommons,
    ...CP1E_SPEC.inputs.map((input) => input.name),
  ];
  const outputSide: string[] = [];
  let previous = '';
  for (const output of CP1E_SPEC.outputs) {
    if (output.com !== previous) outputSide.push(output.com);
    previous = output.com;
    outputSide.push(output.name);
  }
  outputSide.push(...(CP1E_SPEC.service ?? []));
  return [
    ...staggeredTerminals(CP1E_SPEC, inputSide, vec3(PLC_ORIGIN_MM.x + 6, PLC_ORIGIN_MM.y + 6, 0)),
    ...staggeredTerminals(CP1E_SPEC, outputSide, vec3(PLC_ORIGIN_MM.x + 6, PLC_ORIGIN_MM.y + 72, 0)),
  ];
}

/** 明灰（アイボリー）の筐体（CP1E）。 */
const CP1E_BODY_COLOR = '#D8D5CC';

/**
 * CP1E-N30DR-A の外観。§10.1 / 決定表#15
 * 明灰の筐体に黒の端子台が上下2段、上段（入力側）に電源端子 `L1` / `L2/N` が同居する。
 * 中央の帯に本体表示LED・銘板・入出力表示LED・周辺USBポート・オプションボードスロット。
 */
export const CP1E_APPEARANCE: PlcAppearance = {
  faceMm: { width: 130, height: 90 },
  bodyColor: CP1E_BODY_COLOR,
  terminalBlockColor: '#2A2A2A',
  nameplate: 'CP1E-N30DR-A',
  nameplateRect: { x: 46, y: 27, w: 56, h: 6 },
  covers: [
    { id: 'input-cover', rect: { x: 0, y: 0, w: 130, h: 24 }, color: '#C0BEB6', hinge: 'top' },
    { id: 'output-cover', rect: { x: 0, y: 66, w: 130, h: 24 }, color: '#C0BEB6', hinge: 'bottom' },
  ],
  leds: [
    // 【本アプリの前提】ERR/ALM を赤とした（PLC調査資料 O-3 が未確認）
    ...ledRow(['POWER', 'RUN', 'ERR', 'ALM'], 'status', { x: 6, y: 27, w: 4, h: 3, pitch: 9 }, PLC_LED_GREEN, { ERR: PLC_LED_RED, ALM: PLC_LED_RED }),
    ...ledRow(
      CP1E_SPEC.inputs.map((input) => input.name),
      'input',
      { x: 5, y: 35, w: 3, h: 3, pitch: 6.8 },
      PLC_LED_AMBER,
    ),
    ...ledRow(
      CP1E_SPEC.outputs.map((output) => output.name),
      'output',
      { x: 5, y: 41, w: 3, h: 3, pitch: 6.8 },
      PLC_LED_AMBER,
    ),
  ],
  features: [
    { id: 'usb', kind: 'port', label: '周辺USBポート', rect: { x: 6, y: 48, w: 14, h: 10 }, color: '#2A2A2A' },
    { id: 'option-slot', kind: 'slot', label: 'オプションボードスロット', rect: { x: 26, y: 47, w: 26, h: 12 }, color: '#B3B0A8' },
  ],
  assumed: [
    '筐体色・端子台色（一般に知られた見え方。実機写真は使っていない）',
    'LED・USBポート・オプションボードスロットの面上の位置',
    '本体表示LEDの種類は §10.1 の【本アプリの前提】（PLC調査資料 O-3 が未確認）',
    '銘板は型式の文字列のみ（ロゴ・ブランド名は描かない）',
  ],
};

/** OMRON CP1E-N30DR-A（一体形）。§10.1 */
export const PLC_UNIT_CP1E: PlcUnitDefinition = {
  id: 'cp1e',
  model: 'CP1E',
  vendor: 'omron',
  displayName: 'OMRON CP1E-N30DR-A',
  form: 'unit',
  sizeMm: { width: 130, height: 90, depth: 85 },
  pos: PLC_ORIGIN_MM,
  spec: CP1E_SPEC,
  terminals: cp1eTerminals(),
  appearance: CP1E_APPEARANCE,
  // 【本アプリの前提】PLC調査資料 O-3 が未確認のため §10.1 の記載どおり
  leds: ['POWER', 'RUN', 'ERR', 'ALM'],
};
```

`PLC_UNITS` に `CP1E: PLC_UNIT_CP1E,` を足す。`src/index.ts` に `CP1E_SPEC` / `CP1E_APPEARANCE` / `FX5U_APPEARANCE` / `PLC_UNIT_CP1E` / `CP1E_INPUT_OHMS_LOW` / `CP1E_INPUT_OHMS_HIGH` / `CP1E_COMMON_SIZES` / `channelNames` / `ledRow` / `PLC_LED_GREEN` / `PLC_LED_RED` / `PLC_LED_AMBER` / 型 `PlcAppearance` / `FaceRect` / `PlcLedMark` / `PlcCoverMark` / `PlcFeatureMark` を足す。

- [ ] **Step 7: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/board-model exec vitest run
git add packages/board-model
git commit -m "feat(board-model): describe the PLC appearance and add the OMRON CP1E body"
```

> `plc-appearance.test.ts` の「本体4 ＋ モジュール8」を数える1ケースは、Task 11 で全機種が揃うまで落ちたままになる。Task 9 の時点では `faces.length` の期待値を `2` とし（FX5U と CP1E）、Task 10 で `3 + 4`、Task 11 で `4 + 4 + 4` に更新する。

---

## Task 10: ラック形の枠組みと JTEKT TOYOPUC PC10G-1SP ラック

**モデル: Opus**（端子座標の不変条件（前提#15）を満たす配置を決める判断があるため）

**Files:**
- Modify: `packages/board-model/src/plc-unit.ts`
- Modify: `packages/board-model/src/index.ts`
- Test: `packages/board-model/test/plc-rack.test.ts`
- Test: `packages/board-model/test/plc-appearance.test.ts`（`faces.length` の期待値）

§10.1 の JTEKT 行と §17 #21 を実装する。ラックは「ベース＋モジュール」で、ネットリスト上は従来どおり1部品（`PLC`）である（決定表#11）。3Dで箱を4つ描くのは 4B の仕事なので、ここで渡すのは**寸法と位置**だけである。

**端子配置（決定表#12）**: 1モジュールにつき2列×最大9段。列は左端から 9mm と 26mm、段は上端から 14mm・ピッチ 13mm（上の14mmは入出力表示灯の帯に空ける）。段間13mm・列間17mm・モジュール間18mm となり、前提#15 の「8mm以上離す」を満たす。

- [ ] **Step 1: 失敗するテストを書く**

`packages/board-model/test/plc-rack.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  JIPM_BOARD,
  PLC_ORIGIN_MM,
  PLC_UNIT_PC10G,
  PC10G_SPEC,
  RACK_MODULE_HEIGHT_MM,
  RACK_MODULE_WIDTH_MM,
  TERMINAL_PICK_RADIUS_MM,
  plcUnitFor,
  validateBoard,
  withPlcUnit,
} from '../src/index.js';

describe('PLC_UNIT_PC10G（§10.1 / §17 #21）', () => {
  it('is a rack of four modules', () => {
    expect(PLC_UNIT_PC10G.model).toBe('PC10G-1SP');
    expect(PLC_UNIT_PC10G.vendor).toBe('jtekt');
    expect(PLC_UNIT_PC10G.form).toBe('rack');
    expect(PLC_UNIT_PC10G.modules?.map((m) => m.model)).toEqual([
      'POWER1',
      'PC10G-1SP',
      'IN-12',
      'OUT-12',
    ]);
    expect(plcUnitFor('PC10G-1SP')).toBe(PLC_UNIT_PC10G);
  });

  it('sizes the base from the module widths (§17.1 の前提値)', () => {
    expect(PLC_UNIT_PC10G.sizeMm).toEqual({ width: 4 * RACK_MODULE_WIDTH_MM + 20, height: 140, depth: 120 });
    for (const module of PLC_UNIT_PC10G.modules ?? []) {
      expect(module.sizeMm).toEqual({ width: RACK_MODULE_WIDTH_MM, height: RACK_MODULE_HEIGHT_MM, depth: 120 });
      expect(module.pos.x).toBeGreaterThanOrEqual(PLC_ORIGIN_MM.x);
    }
  });

  it('wires 16 inputs on two commons of eight and 16 relay outputs likewise (§10.1)', () => {
    expect(PC10G_SPEC.inputCommons).toEqual(['ICOM0', 'ICOM1']);
    expect(PC10G_SPEC.inputs.map((i) => i.name).slice(0, 3)).toEqual(['X0', 'X1', 'X2']);
    expect(PC10G_SPEC.inputs.map((i) => i.name).slice(14)).toEqual(['XE', 'XF']);
    expect(PC10G_SPEC.inputs.slice(0, 8).every((i) => i.com === 'ICOM0')).toBe(true);
    expect(PC10G_SPEC.inputs.slice(8).every((i) => i.com === 'ICOM1')).toBe(true);
    expect(PC10G_SPEC.inputs.every((i) => i.ohms === 2400)).toBe(true);
    expect(PC10G_SPEC.commons).toEqual(['COM0', 'COM1']);
    // 出力端子の印字は `OUT-12` のアドレス（方言の `1Y010`〜`1Y01F` と同じ番号）。決定表#16
    expect(PC10G_SPEC.outputs.map((o) => o.name).slice(0, 3)).toEqual(['Y10', 'Y11', 'Y12']);
    expect(PC10G_SPEC.outputs.map((o) => o.name).slice(14)).toEqual(['Y1E', 'Y1F']);
    expect(PC10G_SPEC.outputs.map((o) => o.com).slice(7, 9)).toEqual(['COM0', 'COM1']);
    expect(PC10G_SPEC.acPower).toEqual(['L', 'N']);
  });

  it('describes each module front so 4B can draw it (決定表#15)', () => {
    const modules = PLC_UNIT_PC10G.modules ?? [];
    const byModel = new Map(modules.map((m) => [m.model, m.appearance]));
    expect(byModel.get('IN-12')?.leds.filter((l) => l.group === 'input')).toHaveLength(16);
    expect(byModel.get('IN-12')?.covers.map((c) => c.id)).toEqual(['terminal-cover']);
    expect(byModel.get('PC10G-1SP')?.features.map((f) => f.id)).toEqual([
      'run-stop',
      'peripheral',
      'latch',
    ]);
    expect(byModel.get('POWER1')?.leds.map((l) => l.name)).toEqual(['POWER']);
    for (const module of modules) expect(module.appearance.nameplate).toBe(module.model);
  });

  it('keeps every terminal inside its module box and 8 mm apart (前提#15)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_PC10G);
    const plc = board.terminals.filter((t) => String(t.id).startsWith('PLC.'));
    // 電源3 ＋ 入力コモン2 ＋ 入力16 ＋ COM2 ＋ 出力16 = 39
    expect(plc).toHaveLength(39);
    expect(String(plc.find((t) => String(t.id) === 'PLC.ICOM0')?.role)).toBe('ss');
    for (let i = 0; i < plc.length; i += 1) {
      for (let j = i + 1; j < plc.length; j += 1) {
        const a = plc[i];
        const b = plc[j];
        if (a === undefined || b === undefined) continue;
        expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThanOrEqual(
          2 * TERMINAL_PICK_RADIUS_MM,
        );
      }
    }
    expect(validateBoard(board)).toEqual([]);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/board-model exec vitest run test/plc-rack.test.ts
```

Expected: 失敗。`does not provide an export named 'PLC_UNIT_PC10G'`。

- [ ] **Step 3: `src/plc-unit.ts` にラックの枠組みと TOYOPUC を足す**

（`PlcModuleDefinition` と `PlcUnitDefinition.modules?` は Task 9 Step 4 で入れてある。）

```ts
/** ラック形モジュール1枚の幅[mm]。§10.1 / §17.1 の前提値 */
export const RACK_MODULE_WIDTH_MM = 35;
/** ラック形モジュールの高さ[mm]。 */
export const RACK_MODULE_HEIGHT_MM = 130;
/** ベースの左右の余白[mm]。 */
export const RACK_BASE_MARGIN_MM = 10;
/** ベースの高さ[mm]（モジュール高さ＋上下の縁）。 */
export const RACK_BASE_HEIGHT_MM = 140;
/** モジュール左端から端子2列までの距離[mm]。 */
export const RACK_TERMINAL_COLS_MM: readonly [number, number] = [9, 26];
/** モジュール内の端子の段ピッチ[mm]。 */
export const RACK_TERMINAL_ROW_PITCH_MM = 13;
/** モジュール上端から最初の段までの距離[mm]（上の帯は入出力表示灯に空ける）。 */
export const RACK_TERMINAL_TOP_MM = 14;
/** 1モジュールに並べられる端子数の上限（2列×9段）。 */
export const RACK_TERMINALS_PER_MODULE = 18;

/** スロット番号 → モジュールの左奥の角。 */
export function rackModulePos(slot: number): Vec3 {
  return vec3(
    PLC_ORIGIN_MM.x + RACK_BASE_MARGIN_MM + slot * RACK_MODULE_WIDTH_MM,
    PLC_ORIGIN_MM.y + 5,
    PLC_ORIGIN_MM.z,
  );
}

/** ベースの外形（モジュール幅の合計＋左右の余白）。§10.1 の前提 */
export function rackSizeMm(slots: number, depthMm: number): {
  width: number;
  height: number;
  depth: number;
} {
  return {
    width: slots * RACK_MODULE_WIDTH_MM + 2 * RACK_BASE_MARGIN_MM,
    height: RACK_BASE_HEIGHT_MM,
    depth: depthMm,
  };
}

/**
 * モジュール1枚の端子を2列×最大9段で並べる。§17 #11 / 決定表#12
 * 実機の着脱式端子台は1列だが、当たり判定半径4mm（＝8mm離す必要）が高さ130mmに18点は入らない
 * ため、本アプリは2列に配置する。実機の並びが判明したらここだけを差し替える。
 */
function rackTerminals(spec: PlcUnitSpec, names: readonly string[], slot: number): BoardTerminal[] {
  if (names.length > RACK_TERMINALS_PER_MODULE) {
    throw new BoardError(
      `1モジュールの端子は${RACK_TERMINALS_PER_MODULE}点までです: ${names.length}点`,
    );
  }
  const origin = rackModulePos(slot);
  return names.map((name, index) => ({
    id: `${PLC_PART_ID}.${name}` as TerminalId,
    label: plcLabel(name),
    role: plcRole(spec, name),
    pos: vec3(
      origin.x + (RACK_TERMINAL_COLS_MM[index % 2] ?? 0),
      origin.y + RACK_TERMINAL_TOP_MM + Math.floor(index / 2) * RACK_TERMINAL_ROW_PITCH_MM,
      origin.z,
    ),
    pickRadiusMm: TERMINAL_PICK_RADIUS_MM,
    wirable: true,
    optional: false,
    exit: 'either',
  }));
}

/** 16進表記の端子名を作る（`X0`〜`XF`、`start` を与えると `Y10`〜`Y1F`）。§10.1 */
export function hexNames(prefix: string, count: number, start = 0): string[] {
  return Array.from(
    { length: count },
    (_unused, i) => `${prefix}${(start + i).toString(16).toUpperCase()}`,
  );
}

/**
 * `OUT-12` の先頭アドレス。`@ojt/plc-dialects` の `jtekt.ts` の `OUTPUT_BASE` と同じ値で、
 * 端子の印字（`Y10`）と方言表記（`1Y010`）を揃えるためにある（決定表#16）。
 * 片方だけ変えると `plcWiringPlan()` が引く端子名とラダーの表記がずれるので、必ず両方直す。
 */
export const PC10G_OUTPUT_BASE = 0x010;

/** TOYOPUC `IN-12` の入力抵抗[Ω]（10mA/点）。§5.1.3 */
export const PC10G_INPUT_OHMS = 2400;
/** ラック形の入出力モジュールの1コモンあたりの点数。§10.1（`IN-12` は8点/COM） */
export const RACK_POINTS_PER_COMMON = 8;

/** TOYOPUC PC10G-1SP ラックの電気的な仕様。§10.1 / §5.1.3 / §17 #21 */
export const PC10G_SPEC: PlcUnitSpec = {
  model: 'PC10G-1SP',
  power: ['L', 'N', 'PE'],
  acPower: ['L', 'N'],
  inputCommons: ['ICOM0', 'ICOM1'],
  inputs: hexNames('X', 16).map((name, index) => ({
    name,
    com: `ICOM${Math.floor(index / RACK_POINTS_PER_COMMON)}`,
    ohms: PC10G_INPUT_OHMS,
  })),
  commons: ['COM0', 'COM1'],
  outputs: hexNames('Y', 16, PC10G_OUTPUT_BASE).map((name, index) => ({
    name,
    com: `COM${Math.floor(index / RACK_POINTS_PER_COMMON)}`,
  })),
};

/** TOYOPUC ラックの端子（`POWER1` → `IN-12` → `OUT-12` の順）。§10.1 の記載順 */
function pc10gTerminals(): BoardTerminal[] {
  const inputNames = ['ICOM0', ...PC10G_SPEC.inputs.slice(0, 8).map((i) => i.name), 'ICOM1', ...PC10G_SPEC.inputs.slice(8).map((i) => i.name)];
  const outputNames = ['COM0', ...PC10G_SPEC.outputs.slice(0, 8).map((o) => o.name), 'COM1', ...PC10G_SPEC.outputs.slice(8).map((o) => o.name)];
  return [
    ...rackTerminals(PC10G_SPEC, [...PC10G_SPEC.power], 0),
    ...rackTerminals(PC10G_SPEC, inputNames, 2),
    ...rackTerminals(PC10G_SPEC, outputNames, 3),
  ];
}

/**
 * ラックのモジュール1枚ぶんの外観を組み立てる。§10.1 / 決定表#15
 * 上端の帯（y 0〜12mm）が入出力表示灯、その下が端子台カバー、最下段が銘板と固定ラッチである。
 * 色と配置は一般に知られた見え方から作図した本アプリの記述で、実機写真は使っていない（§17.1）。
 */
function rackFace(options: {
  model: string;
  bodyColor: string;
  terminalColor: string;
  /** 端子台カバーの矩形（端子を持たないモジュールは省略）。 */
  cover?: FaceRect;
  /** 本体表示LED（列の上端 y）。 */
  statusLeds?: { names: readonly string[]; y: number };
  /** 入出力表示灯。上端の帯に `perRow` 点ずつ並べる（`JW-212NA` は A/B 各8点2段）。 */
  pointLeds?: { names: readonly string[]; group: 'input' | 'output'; perRow: number };
  features?: readonly PlcFeatureMark[];
  assumed: readonly string[];
}): PlcAppearance {
  const leds: PlcLedMark[] = [];
  if (options.statusLeds !== undefined) {
    leds.push(
      ...ledRow(
        options.statusLeds.names,
        'status',
        { x: 4, y: options.statusLeds.y, w: 4, h: 3, pitch: 9 },
        PLC_LED_GREEN,
      ),
    );
  }
  const points = options.pointLeds;
  if (points !== undefined) {
    for (let row = 0; row * points.perRow < points.names.length; row += 1) {
      leds.push(
        ...ledRow(
          points.names.slice(row * points.perRow, (row + 1) * points.perRow),
          points.group,
          { x: 3, y: 3 + row * 5, w: 2.5, h: 2.5, pitch: 3.8 },
          PLC_LED_AMBER,
        ),
      );
    }
  }
  return {
    faceMm: { width: RACK_MODULE_WIDTH_MM, height: RACK_MODULE_HEIGHT_MM },
    bodyColor: options.bodyColor,
    terminalBlockColor: options.terminalColor,
    nameplate: options.model,
    nameplateRect: { x: 2, y: 123, w: 22, h: 5 },
    covers:
      options.cover === undefined
        ? []
        : [
            {
              id: 'terminal-cover',
              rect: options.cover,
              color: options.terminalColor,
              hinge: 'top' as const,
            },
          ],
    leds,
    features: [
      ...(options.features ?? []),
      {
        id: 'latch',
        kind: 'latch',
        label: 'モジュール固定ラッチ',
        rect: { x: 27, y: 123, w: 6, h: 5 },
        color: '#7A7F86',
      },
    ],
    assumed: options.assumed,
  };
}

/** ラックのモジュール一覧を作る。 */
function rackModules(
  entries: readonly {
    model: string;
    displayName: string;
    depthMm: number;
    appearance: PlcAppearance;
  }[],
): PlcModuleDefinition[] {
  return entries.map((entry, slot) => ({
    slot,
    model: entry.model,
    displayName: entry.displayName,
    sizeMm: { width: RACK_MODULE_WIDTH_MM, height: RACK_MODULE_HEIGHT_MM, depth: entry.depthMm },
    pos: rackModulePos(slot),
    appearance: entry.appearance,
  }));
}

/** TOYOPUC モジュールの筐体色（明灰）。 */
const PC10G_BODY_COLOR = '#B9BCC1';
/** TOYOPUC の端子台色（黒）。 */
const PC10G_TERMINAL_COLOR = '#22262B';
/** ラック形の外観が前提値である旨（4スロット共通）。§17.1 */
const RACK_ASSUMED: readonly string[] = [
  'モジュールの筐体色・端子台色（一般に知られた見え方。実機写真は使っていない）',
  '表示灯・スイッチ・コネクタ・固定ラッチの面上の位置（カタログ寸法から作図）',
  '端子台カバーの範囲（端子を2列に並べた本アプリの配置に合わせてある。決定表#12）',
  '銘板は型式の文字列のみ（ロゴ・ブランド名は描かない）',
];

/** JTEKT TOYOPUC PC10G-1SP（ラック形）。§10.1 / §17 #21 */
export const PLC_UNIT_PC10G: PlcUnitDefinition = {
  id: 'pc10g',
  model: 'PC10G-1SP',
  vendor: 'jtekt',
  displayName: 'JTEKT TOYOPUC PC10G-1SP（基本ベース＋POWER1＋CPU＋IN-12＋OUT-12）',
  form: 'rack',
  sizeMm: rackSizeMm(4, 120),
  pos: PLC_ORIGIN_MM,
  spec: PC10G_SPEC,
  terminals: pc10gTerminals(),
  appearance: {
    faceMm: { width: rackSizeMm(4, 120).width, height: RACK_BASE_HEIGHT_MM },
    bodyColor: '#9AA0A6',
    terminalBlockColor: PC10G_TERMINAL_COLOR,
    nameplate: 'PC10G-1SP',
    nameplateRect: { x: 4, y: 132, w: 40, h: 6 },
    covers: [],
    leds: [],
    // ベース側の造作はモジュールを並べるスロットのレールだけ（モジュールはこの上に載る）
    features: [
      {
        id: 'slot-rail',
        kind: 'slot',
        label: '基本ベース（電源部＋3スロット）',
        rect: { x: 0, y: 0, w: rackSizeMm(4, 120).width, h: RACK_BASE_HEIGHT_MM },
        color: '#7E848B',
      },
    ],
    assumed: RACK_ASSUMED,
  },
  modules: rackModules([
    {
      model: 'POWER1',
      displayName: '電源モジュール',
      depthMm: 120,
      appearance: rackFace({
        model: 'POWER1',
        bodyColor: PC10G_BODY_COLOR,
        terminalColor: PC10G_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 28 },
        statusLeds: { names: ['POWER'], y: 46 },
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'PC10G-1SP',
      displayName: 'CPUモジュール',
      depthMm: 120,
      appearance: rackFace({
        model: 'PC10G-1SP',
        bodyColor: PC10G_BODY_COLOR,
        terminalColor: PC10G_TERMINAL_COLOR,
        statusLeds: { names: ['RUN', 'ERR'], y: 20 },
        features: [
          { id: 'run-stop', kind: 'switch', label: 'RUN/STOPスイッチ', rect: { x: 6, y: 34, w: 23, h: 8 }, color: '#8A8F96' },
          { id: 'peripheral', kind: 'port', label: 'ツールポート', rect: { x: 8, y: 50, w: 19, h: 12 }, color: PC10G_TERMINAL_COLOR },
        ],
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'IN-12',
      displayName: 'DC入力16点（THK-2750）',
      depthMm: 120,
      appearance: rackFace({
        model: 'IN-12',
        bodyColor: PC10G_BODY_COLOR,
        terminalColor: PC10G_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 110 },
        pointLeds: { names: hexNames('X', 16), group: 'input', perRow: 8 },
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'OUT-12',
      displayName: 'リレー出力16点（THK-2752）',
      depthMm: 120,
      appearance: rackFace({
        model: 'OUT-12',
        bodyColor: PC10G_BODY_COLOR,
        terminalColor: PC10G_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 110 },
        pointLeds: { names: hexNames('Y', 16, PC10G_OUTPUT_BASE), group: 'output', perRow: 8 },
        assumed: RACK_ASSUMED,
      }),
    },
  ]),
  // 【本アプリの前提】PLC調査資料 J-3 が未確認のため §10.1 の記載どおり
  leds: ['POWER', 'RUN', 'ERR', 'IN'],
};
```

`PLC_UNITS` に `'PC10G-1SP': PLC_UNIT_PC10G,` を足す。`src/index.ts` にラックの定数・`hexNames` / `rackModulePos` / `rackSizeMm` / `PC10G_SPEC` / `PC10G_INPUT_OHMS` / `PC10G_OUTPUT_BASE` / `RACK_POINTS_PER_COMMON` / `PLC_UNIT_PC10G` / `type PlcModuleDefinition` を足す。`test/plc-appearance.test.ts` の `faces.length` の期待値を `3 + 4` にする。

- [ ] **Step 4: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/board-model exec vitest run
git add packages/board-model
git commit -m "feat(board-model): add the rack form and the JTEKT TOYOPUC PC10G-1SP rack"
```

---

## Task 11: シャープ JW300 ラックと机上ジオメトリ・外観の機種横断検査

**モデル: Opus**

**Files:**
- Modify: `packages/board-model/src/plc-unit.ts`
- Modify: `packages/board-model/src/index.ts`
- Test: `packages/board-model/test/plc-rack.test.ts`（JW300 を追記）
- Test: `packages/board-model/test/plc-geometry-review.test.ts`（4機種に広げる）

§10.1 のシャープ行を実装し、前提#15 の机上ジオメトリ検査を**全機種**にかける。`COM.A` へ配線できること（§16 Phase 4 受入基準⑤の3A側）をここで固定する。

- [ ] **Step 1: 失敗するテストを書く**

`packages/board-model/test/plc-rack.test.ts` に足す:

```ts
describe('PLC_UNIT_JW300（§10.1 / 受入基準⑤）', () => {
  it('is a rack of four units with the A / B input groups', () => {
    expect(PLC_UNIT_JW300.model).toBe('JW-300');
    expect(PLC_UNIT_JW300.vendor).toBe('sharp');
    expect(PLC_UNIT_JW300.form).toBe('rack');
    expect(PLC_UNIT_JW300.modules?.map((m) => m.model)).toEqual([
      'JW-301PU',
      'JW-312CU',
      'JW-212NA',
      'JW-214SA',
    ]);
    expect(PLC_UNIT_JW300.modules?.[1]?.sizeMm.depth).toBe(99.8);
    expect(JW300_SPEC.inputCommons).toEqual(['COM.A', 'COM.B']);
    expect(JW300_SPEC.inputs.map((i) => i.name).slice(0, 2)).toEqual(['A0', 'A1']);
    expect(JW300_SPEC.inputs.map((i) => i.name).slice(8, 10)).toEqual(['B0', 'B1']);
    expect(JW300_SPEC.inputs.slice(0, 8).every((i) => i.com === 'COM.A')).toBe(true);
    expect(JW300_SPEC.inputs.every((i) => i.ohms === 3300)).toBe(true);
    expect(JW300_SPEC.commons).toEqual(['COM.C', 'COM.D']);
    expect(JW300_SPEC.outputs.map((o) => o.name).slice(0, 2)).toEqual(['C0', 'C1']);
  });

  it('shows the A / B input lamps in two rows of eight (§10.1)', () => {
    const na = PLC_UNIT_JW300.modules?.find((m) => m.model === 'JW-212NA')?.appearance;
    const lamps = na?.leds.filter((l) => l.group === 'input') ?? [];
    expect(lamps.map((l) => l.name)).toEqual(JW300_SPEC.inputs.map((i) => i.name));
    expect(new Set(lamps.map((l) => l.rect.y)).size).toBe(2);
    expect(PLC_UNIT_JW300.modules?.find((m) => m.model === 'JW-312CU')?.appearance.leds.map((l) => l.name)).toEqual(
      ['RUN', 'FLT', 'MW'],
    );
  });

  it('exposes COM.A as a wirable terminal (受入基準⑤)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_JW300);
    const comA = board.terminals.find((t) => String(t.id) === 'PLC.COM.A');
    expect(comA).toBeDefined();
    expect(comA?.wirable).toBe(true);
    expect(comA?.role).toBe('ss');
    expect(comA?.label).toBe('COM.A');
    expect(validateBoard(board)).toEqual([]);
  });
});
```

`packages/board-model/test/plc-geometry-review.test.ts` の3ケースを4機種に広げる。ファイル先頭の `const BOARD = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);` はそのまま残し（後段の配線テストが使う）、机上ジオメトリの `describe` を次で置き換える:

```ts
describe.each(Object.values(PLC_UNITS).map((unit) => [unit.model, unit] as const))(
  'desk-terminal geometry (%s + outlet)',
  (_model, unit) => {
    const board = withPlcUnit(JIPM_BOARD, unit);

    it('no two desk terminals are closer than two pick radii (>= 8mm)', () => {
      const desk = board.terminals.filter((x) => isOffBoardTerminal(x.id));
      for (let i = 0; i < desk.length; i += 1) {
        for (let j = i + 1; j < desk.length; j += 1) {
          const a = desk[i];
          const b = desk[j];
          if (a === undefined || b === undefined) continue;
          expect(dist(a.pos, b.pos), `${String(a.id)} <-> ${String(b.id)}`).toBeGreaterThanOrEqual(
            2 * TERMINAL_PICK_RADIUS_MM,
          );
        }
      }
    });

    it('every PLC terminal sits inside the unit box and every outlet terminal is outside it', () => {
      const box = {
        x0: PLC_ORIGIN_MM.x,
        y0: PLC_ORIGIN_MM.y,
        x1: PLC_ORIGIN_MM.x + unit.sizeMm.width,
        y1: PLC_ORIGIN_MM.y + unit.sizeMm.height,
      };
      for (const term of unit.terminals) {
        expect(term.pos.x, String(term.id)).toBeGreaterThanOrEqual(box.x0);
        expect(term.pos.x, String(term.id)).toBeLessThanOrEqual(box.x1);
        expect(term.pos.y, String(term.id)).toBeGreaterThanOrEqual(box.y0);
        expect(term.pos.y, String(term.id)).toBeLessThanOrEqual(box.y1);
      }
      for (const term of OUTLET_TERMINALS) {
        const inside =
          term.pos.x >= box.x0 &&
          term.pos.x <= box.x1 &&
          term.pos.y >= box.y0 &&
          term.pos.y <= box.y1;
        expect(inside, String(term.id)).toBe(false);
      }
      expect(OUTLET_ORIGIN_MM.y).toBeGreaterThan(box.y1);
    });

    it('all desk terminals are entirely to the right of the board footprint', () => {
      const boardMaxX = Math.max(...JIPM_BOARD.terminals.map((x) => x.pos.x));
      for (const term of board.terminals.filter((x) => isOffBoardTerminal(x.id))) {
        expect(term.pos.x, String(term.id)).toBeGreaterThan(boardMaxX);
      }
    });

    it('every rack terminal sits inside one of its modules', () => {
      if (unit.form !== 'rack') return;
      for (const term of unit.terminals) {
        const inside = (unit.modules ?? []).some(
          (module) =>
            term.pos.x >= module.pos.x &&
            term.pos.x <= module.pos.x + module.sizeMm.width &&
            term.pos.y >= module.pos.y &&
            term.pos.y <= module.pos.y + module.sizeMm.height,
        );
        expect(inside, String(term.id)).toBe(true);
      }
    });
  },
);
```

（`PLC_UNITS` / `PLC_ORIGIN_MM` / `OUTLET_TERMINALS` / `OUTLET_ORIGIN_MM` / `isOffBoardTerminal` / `TERMINAL_PICK_RADIUS_MM` を import に足す。）

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/board-model exec vitest run test/plc-rack.test.ts test/plc-geometry-review.test.ts
```

Expected: 失敗。`does not provide an export named 'PLC_UNIT_JW300'`。

- [ ] **Step 3: `src/plc-unit.ts` に JW300 を足す**

```ts
/** `JW-212NA` の入力抵抗[Ω]（7.5mA/点）。§5.1.3 */
export const JW300_INPUT_OHMS = 3300;

/** 群の文字ごとの端子名を作る（`A0`〜`A7`）。§10.1 */
export function groupNames(letter: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => `${letter}${i}`);
}

/**
 * JW300 ラックの電気的な仕様。§10.1 / §5.1.3
 * 入力の `A` / `B` 群と `COM.A` / `COM.B` は §10.1 で確定。出力側は一次資料に記載が無いため、
 * 同じ様式で `C` / `D` 群（`COM.C` / `COM.D`）とするのが本アプリの前提である（前提表）。
 */
export const JW300_SPEC: PlcUnitSpec = {
  model: 'JW-300',
  power: ['L', 'N', 'PE'],
  acPower: ['L', 'N'],
  inputCommons: ['COM.A', 'COM.B'],
  inputs: [...groupNames('A', 8), ...groupNames('B', 8)].map((name, index) => ({
    name,
    com: index < RACK_POINTS_PER_COMMON ? 'COM.A' : 'COM.B',
    ohms: JW300_INPUT_OHMS,
  })),
  commons: ['COM.C', 'COM.D'],
  outputs: [...groupNames('C', 8), ...groupNames('D', 8)].map((name, index) => ({
    name,
    com: index < RACK_POINTS_PER_COMMON ? 'COM.C' : 'COM.D',
  })),
};

/** JW300 ラックの端子（電源 → `JW-212NA` → `JW-214SA` の順）。§10.1 の記載順 */
function jw300Terminals(): BoardTerminal[] {
  const inputNames = [
    ...JW300_SPEC.inputs.slice(0, 8).map((i) => i.name),
    'COM.A',
    ...JW300_SPEC.inputs.slice(8).map((i) => i.name),
    'COM.B',
  ];
  const outputNames = [
    ...JW300_SPEC.outputs.slice(0, 8).map((o) => o.name),
    'COM.C',
    ...JW300_SPEC.outputs.slice(8).map((o) => o.name),
    'COM.D',
  ];
  return [
    ...rackTerminals(JW300_SPEC, [...JW300_SPEC.power], 0),
    ...rackTerminals(JW300_SPEC, inputNames, 2),
    ...rackTerminals(JW300_SPEC, outputNames, 3),
  ];
}

/** シャープ JW300（ラック形）。§10.1 */
export const PLC_UNIT_JW300: PlcUnitDefinition = {
  id: 'jw300',
  model: 'JW-300',
  vendor: 'sharp',
  displayName: 'シャープ JW300（基本ベース＋JW-301PU＋JW-312CU＋JW-212NA＋JW-214SA）',
  form: 'rack',
  sizeMm: rackSizeMm(4, 109.4),
  pos: PLC_ORIGIN_MM,
  spec: JW300_SPEC,
  terminals: jw300Terminals(),
  appearance: {
    faceMm: { width: rackSizeMm(4, 109.4).width, height: RACK_BASE_HEIGHT_MM },
    bodyColor: '#A9A8A2',
    terminalBlockColor: JW300_TERMINAL_COLOR,
    nameplate: 'JW-300',
    nameplateRect: { x: 4, y: 132, w: 40, h: 6 },
    covers: [],
    leds: [],
    features: [
      {
        id: 'slot-rail',
        kind: 'slot',
        label: '基本ベース（電源＋CU＋2スロット）',
        rect: { x: 0, y: 0, w: rackSizeMm(4, 109.4).width, h: RACK_BASE_HEIGHT_MM },
        color: '#8C8B85',
      },
    ],
    assumed: RACK_ASSUMED,
  },
  modules: rackModules([
    {
      model: 'JW-301PU',
      displayName: '電源ユニット',
      depthMm: 109.4,
      appearance: rackFace({
        model: 'JW-301PU',
        bodyColor: JW300_BODY_COLOR,
        terminalColor: JW300_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 28 },
        statusLeds: { names: ['POWER'], y: 46 },
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'JW-312CU',
      displayName: 'コントロールユニット',
      depthMm: 99.8,
      appearance: rackFace({
        model: 'JW-312CU',
        bodyColor: JW300_BODY_COLOR,
        terminalColor: JW300_TERMINAL_COLOR,
        // RUN / FLT / MW は §10.1 で確定している本体表示
        statusLeds: { names: ['RUN', 'FLT', 'MW'], y: 20 },
        features: [
          { id: 'run-stop', kind: 'switch', label: 'RUN/STOPスイッチ', rect: { x: 6, y: 34, w: 23, h: 8 }, color: '#8A8F96' },
          { id: 'peripheral', kind: 'port', label: 'ツールポート', rect: { x: 8, y: 50, w: 19, h: 12 }, color: JW300_TERMINAL_COLOR },
        ],
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'JW-212NA',
      displayName: 'DC入力16点（18P着脱式端子台）',
      depthMm: 109.4,
      appearance: rackFace({
        model: 'JW-212NA',
        bodyColor: JW300_BODY_COLOR,
        terminalColor: JW300_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 110 },
        // §10.1 の「入力表示灯 A/B 各8点2段」をそのまま2段で並べる
        pointLeds: {
          names: JW300_SPEC.inputs.map((input) => input.name),
          group: 'input',
          perRow: 8,
        },
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'JW-214SA',
      displayName: 'リレー出力16点',
      depthMm: 109.4,
      appearance: rackFace({
        model: 'JW-214SA',
        bodyColor: JW300_BODY_COLOR,
        terminalColor: JW300_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 110 },
        pointLeds: {
          names: JW300_SPEC.outputs.map((output) => output.name),
          group: 'output',
          perRow: 8,
        },
        assumed: RACK_ASSUMED,
      }),
    },
  ]),
  leds: ['RUN', 'FLT', 'MW'],
};
```

`JW300_SPEC` の直前に色の定数を足す:

```ts
/** JW300 ユニットの筐体色（明灰）。 */
const JW300_BODY_COLOR = '#C9C7C0';
/** JW300 の端子台色（黒）。 */
const JW300_TERMINAL_COLOR = '#2B2B2B';
```

`PLC_UNITS` を4機種にする:

```ts
/** 機種名（課題JSONの `plc.model`）→ 本体定義。§7.6 / §16 Phase 4 */
export const PLC_UNITS: Readonly<Record<string, PlcUnitDefinition>> = {
  FX5U: PLC_UNIT_FX5U,
  CP1E: PLC_UNIT_CP1E,
  'PC10G-1SP': PLC_UNIT_PC10G,
  'JW-300': PLC_UNIT_JW300,
};
```

`src/index.ts` に `JW300_SPEC` / `JW300_INPUT_OHMS` / `groupNames` / `PLC_UNIT_JW300` を足す。`test/plc-appearance.test.ts` の `faces.length` の期待値を `4 + 4 + 4` にする（本体4＋TOYOPUC 4枚＋JW300 4枚）。

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/board-model exec vitest run
pnpm --filter @ojt/board-model exec vitest run --coverage
pnpm -r typecheck
```

Expected: 全ケース通過。カバレッジ90%以上。

- [ ] **Step 5: バッチCのレビューとコミット**

```powershell
npx prettier --check "packages/board-model/**/*.ts" "packages/circuit-sim/**/*.ts"
git add packages/board-model packages/circuit-sim
git commit -m "feat(board-model): add the Sharp JW300 rack and check the desk geometry for all four models"
```

ここで**バッチC のレビュー（Opus 1回）**をかける。見どころ: ①`createPlcUnit()` の検証（入力コモン・AC端子）が全機種で通ること ②端子の総数が §10.1 の点数と一致すること ③ラックの端子がモジュールの箱に収まり8mm以上離れていること ④CP1E の点別抵抗が §5.1.3 のとおりで、24V印加時の入力電流がON判定を超えること（`24 / 4800 = 5.0mA > 3mA`）⑤外観記述の矩形が面からはみ出さず、重なって読めなくなる箇所が無いこと（LED帯・端子カバー・銘板・ラッチ）、銘板にロゴ・ブランド名が入っていないこと。

---

## Task 12: モードD課題を4機種で開始できるようにする

**モデル: Opus**（機種にない入出力点の扱いを決めるため）

**Files:**
- Modify: `packages/content/src/schema/plc.ts`
- Modify: `packages/content/src/index.ts`
- Test: `packages/content/test/schema-plc.test.ts`・`test/index.test.ts`（既存の `PHASE3_MODELS` の2箇所）

`PHASE3_MODELS`（前提#17）を外し、4機種すべてを開始できるようにする。ただし**機種にない入出力点**は弾く: `PlcInputMapSchema` は `x: 0〜15`、`PlcOutputMapSchema` は `y: 0〜15` を許すが、CP1E の出力は12点しかない（前提#23）。判定は `plcUnitFor()` が返す機種仕様で行う（決定表#13）。

`io.inputs[].x` / `io.outputs[].y` は**IRの通し番号（0起点）のまま**で、`resolvePlcIo()` は機種を知らない。TOYOPUC で出力アドレスを `1Y010` からにずらした（決定表#16）のは**方言の表記と端子の印字だけ**の話で、割付の番号・`plcWiringPlan()`・`plc-static-checks` は4機種とも通し番号で引き続き動く（決定表#2「端子名とデバイス表記は一致させない」）。文言に `X`/`Y` の文字を出さないのも同じ理由である（引き渡し注記 H-1）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-plc.test.ts` の `expect(PHASE3_MODELS).toEqual(['FX5U']);` を含むケースを次で置き換え、`import` の `PHASE3_MODELS` を `SUPPORTED_PLC_MODELS` に直す:

```ts
  it('starts every vendor of 決定事項#14 in Phase 4 (§16)', () => {
    expect(SUPPORTED_PLC_MODELS).toEqual(['FX5U', 'PC10G-1SP', 'CP1E', 'JW-300']);
    for (const [vendor, model] of [
      ['mitsubishi', 'FX5U'],
      ['jtekt', 'PC10G-1SP'],
      ['omron', 'CP1E'],
      ['sharp', 'JW-300'],
    ] as const) {
      expect(PlcRefSchema.safeParse({ vendor, model }).success).toBe(true);
    }
    // メーカーと機種の組み合わせ違いは引き続き拒否する（§7.6）
    expect(PlcRefSchema.safeParse({ vendor: 'omron', model: 'FX5U' }).success).toBe(false);
  });

  it('rejects an I/O point the model does not have (前提#23 / 決定表#13)', () => {
    const cp1e = { vendor: 'omron', model: 'CP1E' } as const;
    const ok = PlcProblemSchema.safeParse(
      plcProblemJson({
        plc: cp1e,
        io: { mode: 'fixed', inputs: [{ x: 0, pb: 'PB1' }], outputs: [{ y: 11, cr: 'CR1', pl: 'PL1' }] },
        referenceLadder: ladderWith(11, 0),
      }),
    );
    expect(ok.success).toBe(true);
    const ng = PlcProblemSchema.safeParse(
      plcProblemJson({
        plc: cp1e,
        io: { mode: 'fixed', inputs: [{ x: 0, pb: 'PB1' }], outputs: [{ y: 12, cr: 'CR1', pl: 'PL1' }] },
        referenceLadder: ladderWith(12, 0),
      }),
    );
    expect(ng.success).toBe(false);
    if (ng.success) return;
    expect(JSON.stringify(ng.error.issues)).toContain('CP1E');
  });
```

（`ladderWith()` は `test/plc-cross-validation.test.ts` にある同名のヘルパと同じもの。`test/helpers/plc.ts` へ移して両方から使う。）

`packages/content/test/index.test.ts` の `expect(PHASE3_MODELS).toEqual(['FX5U']);` を次にし、import も直す:

```ts
    expect(SUPPORTED_PLC_MODELS).toEqual([...PLC_MODELS]);
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-plc.test.ts
```

Expected: 失敗。`SUPPORTED_PLC_MODELS` が無い。

- [ ] **Step 3: `src/schema/plc.ts` を直す**

`PHASE3_MODELS` の定義を次で置き換える:

```ts
/** Phase 4 で4機種すべてを開始できるようにした。§16 */
export const SUPPORTED_PLC_MODELS = PLC_MODELS;
```

`PlcRefSchema` の `superRefine` の「まだ開始できません」の分岐を次で置き換える（機種名と本体定義の対応が切れていないかの見張りに変える）:

```ts
    if (plcUnitFor(plc.model) === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: `この機種の本体定義がありません（board-model の PLC_UNITS）: ${plc.model}`,
      });
    }
```

ファイル先頭の import に足す:

```ts
import { plcUnitFor } from '@ojt/board-model';
```

`PlcProblemSchema` の `superRefine` に、割付の点が機種にあるかの検査を足す（`const io = resolvePlcIo(problem.io);` の直後）:

```ts
    // 機種にない入出力点を割り付けると、模範配線を張る段になって初めて崩れる。
    // 端子は機種仕様（`unit.spec`）だけが知っているのでここで前もって拾う（決定表#13）
    const unit = plcUnitFor(problem.plc.model);
    if (unit !== undefined) {
      io.inputs.forEach((input, index) => {
        if (input.x < unit.spec.inputs.length) return;
        ctx.addIssue({
          code: 'custom',
          path: ['io', 'inputs', index, 'x'],
          message: `${problem.plc.model} の入力は ${unit.spec.inputs.length} 点です（割付 x: ${input.x} はありません）`,
        });
      });
      io.outputs.forEach((output, index) => {
        if (output.y < unit.spec.outputs.length) return;
        ctx.addIssue({
          code: 'custom',
          path: ['io', 'outputs', index, 'y'],
          message: `${problem.plc.model} の出力は ${unit.spec.outputs.length} 点です（割付 y: ${output.y} はありません）`,
        });
      });
    }
```

- [ ] **Step 4: `src/index.ts` の再エクスポートを直す**

`PHASE3_MODELS,` を `SUPPORTED_PLC_MODELS,` に変える。

- [ ] **Step 5: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run
pnpm --filter @ojt/content exec pnpm schema:write
git diff --stat packages/content/schema/task.schema.json
```

Expected: 全ケース通過。JSON Schema は `plc.model` の `description` が変わるだけ（`enum` は元から4機種）。差分が出たらコミットに含める。

```powershell
git add packages/content
git commit -m "feat(content): let mode D problems start on all four PLC models"
```

---

## Task 13: 静的チェックから三菱固有の端子名を取り除く

**モデル: Opus**

**Files:**
- Modify: `packages/content/src/plc-static-checks.ts`
- Modify: `packages/content/src/plc-reference.ts`
- Test: `packages/content/test/plc-static-checks.test.ts`
- Test: `packages/content/test/plc-reference.test.ts`

前提#19 のとおり `checkIoAssignment()` は `/^PLC\.X\d+$/` と `/^PLC\.Y\d+$/` を持っており、CP1E の `PLC.0.00` や JW300 の `PLC.A0` では一致しない（短絡の検出がすり抜ける）。機種仕様から端子集合を作って判定する形に変える。あわせて、8点1コモンの機種で**使うコモンが配線されていない**場合を拾う（§16 Phase 4 受入基準③・⑤の「`IN-12` の COM端子へ配線でき」「`COM.A` へ配線でき」に対応する検査）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/plc-static-checks.test.ts` の既存ヘルパ `checkInput()`（L46）に課題を差し替えられる
第3引数を足す（既定値を `PROBLEM` にするので、既存の呼び出し約20箇所は書き換え不要）:

```ts
function checkInput(
  circuit: PlcReferenceCircuit,
  plc: PlcCheckContext,
  problem: typeof PROBLEM = PROBLEM,
): StaticCheckInput {
  const netlist = toNetlist(circuit.session, circuit.board);
  const result = runPlcOperations(netlist, circuit.program, problem.operations, {
    durationMs: problem.durationMs,
  });
```

（以降の `return { … }` は変えない。`PROBLEM.operations` / `PROBLEM.durationMs` の2箇所だけを
`problem.` にする。）続けて、既存の `reference()` / `context()` の下に機種引数つきのヘルパを足す:

```ts
/** メーカーと機種の対応（§7.6）。 */
const VENDOR_OF: Readonly<Record<string, string>> = {
  FX5U: 'mitsubishi',
  'PC10G-1SP': 'jtekt',
  CP1E: 'omron',
  'JW-300': 'sharp',
};

/**
 * 機種だけを差し替えた模範回路を組む（課題JSONの `plc` 以外は `plcProblemJson()` の既定のまま）。
 * 返した `circuit.session` を書き換えてから `inputOf()` を呼べば「配線を崩した場合」を作れる。
 */
function buildFor(model: string): { problem: typeof PROBLEM; circuit: PlcReferenceCircuit } {
  const problem = PlcProblemSchema.parse({
    ...plcProblemJson(),
    plc: { vendor: VENDOR_OF[model] ?? 'mitsubishi', model },
  });
  const built = buildPlcReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(`${model}: ${JSON.stringify(built.errors)}`);
  return { problem, circuit: built.value };
}

/** 組んだ回路を静的チェックの入力にする（操作列はその課題のものを再生する）。 */
function inputOf(built: ReturnType<typeof buildFor>): StaticCheckInput {
  return checkInput(built.circuit, context(built.circuit), built.problem);
}

/** 2つの端子を1本の電線でつないで短絡を作る。 */
function shortTogether(built: ReturnType<typeof buildFor>, a: string, b: string): StaticCheckInput {
  expect(addWire(built.circuit.session, built.circuit.board, t(a), t(b)).ok).toBe(true);
  return inputOf(built);
}

/**
 * その端子**だけ**を浮かせる。来ている電線を外し、相手どうしを1本で結び直す。
 * 単に外すと母線の鎖（`chain()` が作る P側・N側の直列）がそこで切れて後続の端子まで浮き、
 * 何を検出したのか分からなくなる。
 */
function withoutWire(built: ReturnType<typeof buildFor>, id: string): StaticCheckInput {
  const { session, board } = built.circuit;
  const touching = session.wires.filter((wire) => at(wire, id));
  const others = touching.map((wire) => (String(wire.from) === id ? wire.to : wire.from));
  for (const wire of [...touching]) expect(removeWire(session, wire.id).ok).toBe(true);
  const [first, second] = others;
  if (first !== undefined && second !== undefined) {
    expect(addWire(session, board, first, second).ok).toBe(true);
  }
  return inputOf(built);
}
```

実際に着地した形は、上の `withoutWire()` の中身（電線を外して相手どうしを結び直す部分）が
`unchain()` という名前の別関数に分かれ、`withoutWire()` はそれを呼んでから `inputOf()` を返すだけの
薄いラッパーになっている。「配線を崩してから静的チェックの入力を作る」処理と「その端子だけを
浮かせる」処理を分けたのは、Batch D で足したテスト（結線方式の mismatch を作るテストなど）が
`unchain()` だけを呼んで**続けて別の電線を足す**必要があったため（`withoutWire()` はすぐ
`inputOf()` を呼んでしまい、その隙が無い）。あわせて `buildFor()` の中身（課題を組んで回路を
建てる部分）も `buildOf(problem)` という機種を選ばない下位ヘルパーに分かれ、`buildFor(model)` は
`buildOf(PlcProblemSchema.parse({ ...plcProblemJson(), plc: {...} }))` を呼ぶだけになっている。

そのうえで、このファイルの末尾に足す:

```ts
describe('ioAssignment は機種の端子名で判定する（Phase 4）', () => {
  it('detects a short between two inputs on a model whose terminals are not Xn', () => {
    // CP1E の入力端子は `PLC.0.00` / `PLC.0.01`。三菱の正規表現では拾えなかった（前提#19）
    const result = checkIoAssignment(shortTogether(buildFor('CP1E'), 'PLC.0.00', 'PLC.0.01'));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain('短絡');
  });

  it('reports an unwired common on an 8-point-per-common model (受入基準③⑤)', () => {
    // JW300 の入力コモンは `PLC.COM.A` / `PLC.COM.B`。使う点のコモンが浮いていたら落とす
    const result = checkIoAssignment(withoutWire(buildFor('JW-300'), 'PLC.COM.A'));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain('COM.A');
  });

  it('passes on the reference wiring of every model', () => {
    for (const model of ['FX5U', 'CP1E', 'PC10G-1SP', 'JW-300']) {
      const input = inputOf(buildFor(model));
      expect(checkIoAssignment(input).ok, model).toBe(true);
      expect(checkTwoStage(input).ok, model).toBe(true);
      expect(checkPlcPowerIndependent(input).ok, model).toBe(true);
    }
  });
});
```

（`t()` / `at()` / `PROBLEM` / `reference()` / `checkInput()` / `context()` はこのファイルに既にある
ヘルパで、`addWire` / `removeWire` / `JIPM_BOARD` / `toNetlist` も既に import 済みである。
追加で要る import は無い。）

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/plc-static-checks.test.ts
```

Expected: 失敗（CP1E の短絡が検出されない／`COM.A` 未配線が通ってしまう）。

- [ ] **Step 3: `src/plc-static-checks.ts` を直す**

`checkIoAssignment()` の中の `isPlcX` / `isPlcY` の2行を削除し、機種仕様から作った集合に置き換える:

```ts
  // 端子名は機種で違う（三菱 `X0` / CP1E `0.00` / JW300 `A0`）ので、正規表現ではなく
  // 機種仕様の端子集合で判定する（前提#19）
  const inputIds = new Set(plc.unit.spec.inputs.map((input) => String(plcTerminal(input.name))));
  const outputIds = new Set(plc.unit.spec.outputs.map((output) => String(plcTerminal(output.name))));
  const isPlcX = (id: string): boolean => inputIds.has(id);
  const isPlcY = (id: string): boolean => outputIds.has(id);
```

入力側のループの末尾（短絡の判定の後）に、その点のコモンが配線されているかの検査を足す:

```ts
    const inputCom = plc.unit.spec.inputs[assigned.x]?.com;
    if (inputCom !== undefined && netTerminals(nets, plcTerminal(inputCom)).length <= 1) {
      details.push(`${terminal} の入力コモン（${plcTerminal(inputCom)}）が配線されていません`);
    }
```

出力側のループの末尾にも同じ形で足す:

```ts
    const outputCom = plc.unit.spec.outputs[output.y]?.com;
    if (outputCom !== undefined && netTerminals(nets, plcTerminal(outputCom)).length <= 1) {
      details.push(`${terminal} の出力コモン（${plcTerminal(outputCom)}）が配線されていません`);
    }
```

**Batch D のレビュー反映（2026-09-19）**: `detectPlcWiring()` に、見るコモンを絞り込む第3引数
`commons?`（省略時は機種の全入力コモン）を足し、返り値に `'mismatch'` を追加する。8点1コモンの
機種は複数コモンがあるので、最初に見つかった1本だけで `sink`/`source` を決めると
`ICOM0`→P・`ICOM1`→N のような誤配線を `sink` と見逃してしまう。**見るべきコモンがすべて
同じ側に揃っているか**を見て、P側・N側が混ざっていたら `mismatch` を返す:

```ts
export type PlcInputWiring = 'sink' | 'source' | 'mismatch';

export function detectPlcWiring(
  nets: Nets,
  unit: PlcUnitDefinition,
  commons: readonly string[] = unit.spec.inputCommons,
): PlcInputWiring | undefined {
  let sink = false;
  let source = false;
  for (const name of commons) {
    const terminals = netTerminals(nets, plcTerminal(name));
    if (terminals.some((id) => id.startsWith('P.'))) sink = true;
    if (terminals.some((id) => id.startsWith('N.'))) source = true;
  }
  if (sink && source) return 'mismatch';
  if (sink) return 'sink';
  if (source) return 'source';
  return undefined;
}
```

`checkIoAssignment()` の末尾に、`commons` を**使う点のコモンだけ**（`usedInputCommons()`。
下記の設計判断の行を参照）に絞って `detectPlcWiring()` を呼び、`mismatch` と「判定した結線方式が
課題の指定（`plc.io.wiring`）と違う」場合を報告する検査を足す:

```ts
  const commons = usedInputCommons(plc.unit, plc.io);
  const commonLabel = commons.map((name) => String(plcTerminal(name))).join('・');
  const wiring = detectPlcWiring(nets, plc.unit, commons);
  if (wiring === undefined) {
    details.push(`入力コモン（${commonLabel}）が盤のP側・N側のどちらにも配線されていません`);
  } else if (wiring === 'mismatch') {
    details.push(
      commons.length === 1
        ? `入力コモン（${commonLabel}）でP側とN側を短絡しています`
        : `入力コモン（${commonLabel}）のP側・N側が食い違っています（すべて同じ側に揃えます）`,
    );
  } else if (wiring !== plc.io.wiring) {
    details.push(
      `入力コモン（${commonLabel}）の結線が課題の指定（${plc.io.wiring}）と違います（${wiring} になっています）`,
    );
  }
```

- [ ] **Step 4: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/content exec vitest run
git add packages/content
git commit -m "fix(content): judge the I/O assignment from the model spec instead of Mitsubishi terminal names"
```

---

## Task 14: 4機種のクロス検証と公開APIの確定

**モデル: Opus**

**Files:**
- Modify: `packages/content/package.json`（devDependencies に `@ojt/plc-dialects`）
- Modify: `packages/content/src/index.ts`・`packages/plc-dialects/src/index.ts`（最終確認）
- Test: `packages/content/test/plc-cross-validation.test.ts`
- Test: `packages/content/test/builtin-plc.test.ts`（ベンダー中立であることの明示）

内蔵モードD課題8題は `plc.model: 'FX5U'` のままだが（決定表#14）、**同じIRが4機種すべてで成立する**ことをここで固定する。§16 Phase 4 の受入基準②③④⑥はすべて 4B のUI操作だが、その土台がライブラリ側で揃っていることをこのテストが示す。

| 確かめること | 方法 |
|---|---|
| 課題が4機種で読める | 各課題の `plc` を差し替えて `PlcProblemSchema.parse()` |
| 模範が4機種で合格する | 差し替えた課題で `judgePlcReference()`（配線・静的チェック・並走比較） |
| 模範ラダーがベンダー中立 | 8題の `referenceLadder` が4方言すべてで `convert()` に通る |
| 命令語リストが4方言で出る | 8題を `instructionList()` にかけ、`not-series-parallel` が出ないこと |

- [ ] **Step 1: `@ojt/plc-dialects` をテスト用の依存に足す**

`packages/content/package.json` の `devDependencies` に足す（**`dependencies` ではない**。`src` からの import は 3A 決定表#7 で禁じたまま）:

```json
    "@ojt/plc-dialects": "workspace:*",
```

```powershell
pnpm install
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/content/test/plc-cross-validation.test.ts` に足す:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { availableDialects, convert, instructionList } from '@ojt/plc-dialects';
import { BUILTIN_PLC_PROBLEMS } from '../src/builtin/index.js';
import { judgePlcReference } from '../src/judge-plc.js';

/** 4メーカーと機種の対応（§7.6）。 */
const MODELS = [
  { vendor: 'mitsubishi', model: 'FX5U' },
  { vendor: 'jtekt', model: 'PC10G-1SP' },
  { vendor: 'omron', model: 'CP1E' },
  { vendor: 'sharp', model: 'JW-300' },
] as const;

describe('内蔵モードD課題8題は4機種すべてで成立する（§16 Phase 4）', () => {
  it.each(MODELS.map((m) => [m.model, m] as const))(
    '%s で8題すべてが読めて模範が合格する',
    (_model, plc) => {
      for (const problem of BUILTIN_PLC_PROBLEMS) {
        const swapped = PlcProblemSchema.parse({ ...problem, plc });
        const judged = judgePlcReference(swapped, JIPM_BOARD);
        expect(judged.ok, `${problem.id} / ${plc.model}`).toBe(true);
        if (!judged.ok) continue;
        expect(judged.value.mismatches, `${problem.id} / ${plc.model}`).toEqual([]);
        expect(judged.value.staticChecks.filter((c) => !c.ok)).toEqual([]);
        expect(judged.value.passed).toBe(true);
      }
    },
  );

  it('模範ラダーはベンダー中立で、4方言すべてで変換が通る（受入基準②）', () => {
    // TOYOPUC の「X と Y の同番号禁止」は **アドレス**で判定する（決定表#16）。8題はすべて
    // `X(0)`〜`X(2)` と `Y(0)`〜`Y(3)` を使うので、出力が `1Y010` から始まる限り衝突しない。
    // ここが `device-conflict` で落ちたら `jtekt.ts` の `OUTPUT_BASE` を疑う
    for (const profile of availableDialects()) {
      for (const problem of BUILTIN_PLC_PROBLEMS) {
        const result = convert(problem.referenceLadder, profile);
        expect(result.errors, `${problem.id} / ${profile.id}`).toEqual([]);
        expect(result.ok).toBe(true);
      }
    }
  });

  it('命令語リストが4方言すべてで書き出せる（受入基準⑥）', () => {
    for (const profile of availableDialects()) {
      for (const problem of BUILTIN_PLC_PROBLEMS) {
        const list = instructionList(problem.referenceLadder, profile);
        expect(list.errors, `${problem.id} / ${profile.id}`).toEqual([]);
        expect(list.lines.length).toBeGreaterThan(0);
        expect(list.text.endsWith('\r\n')).toBe(true);
      }
    }
  });
});
```

`packages/content/test/builtin-plc.test.ts` の `expect(BUILTIN_PLC_PROBLEMS.every((p) => p.plc.model === 'FX5U')).toBe(true);` に注記を足す（JSONは変えない。決定表#14）:

```ts
    // 同梱の8題は三菱で出題するが、IRはベンダー中立で4機種すべてで成立する
    // （`plc-cross-validation.test.ts` が機種を差し替えて確かめている）
    expect(BUILTIN_PLC_PROBLEMS.every((p) => p.plc.model === 'FX5U')).toBe(true);
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/plc-cross-validation.test.ts
```

Expected: 失敗。`Failed to resolve import "@ojt/plc-dialects"`（Step 1 の `pnpm install` を忘れた場合）か、機種差し替えで模範配線が張れない場合の `judged.ok === false`。後者が出たら原因は Task 8〜11 のどれかなので**そこを直す**（このタスクでテストを緩めない）。

- [ ] **Step 4: 公開APIを確定する**

`packages/plc-dialects/src/index.ts` が次をすべて公開していることを確認する（不足があれば足す）: `MITSUBISHI_FX5U` / `OMRON_CP1E` / `JTEKT_PC10G` / `SHARP_JW300` / `getDialect` / `availableDialects` / `DIALECT_IDS` / `IMPLEMENTED_DIALECT_IDS` / `isDialectId` / `MIN_GRID_COLS` / `MAX_GRID_COLS` / `UnknownDialectError` / `convert` / `switchNotation` / `instructionList` / `INSTRUCTION_LIST_MESSAGES` / `GX_STYLE_SHORTCUTS` / `withoutConvert` / `collectDevices` / `collectDeviceIssues` / `makeTimerPreset` / `makeParseTimerPreset` / `roundTimerPreset` / `timerBaseMs` と、型 `DialectProfile` / `DialectId` / `DialectError` / `DeviceRange` / `InstructionKey` / `MonitorColors` / `PanelLayout` / `ShortcutEntry` / `ShortcutTable` / `SymbolDrawing` / `TimerPresetText` / `TimerRule` / `DeviceRuleSet` / `DeviceUse` / `DevicePlace` / `NotationChange` / `NotationSwitchResult` / `InstructionLine` / `InstructionListResult` / `ConvertError` / `ConvertResult`。

`packages/board-model/src/index.ts` が `PLC_UNITS` / `plcUnitFor` / `PLC_UNIT_FX5U` / `PLC_UNIT_CP1E` / `PLC_UNIT_PC10G` / `PLC_UNIT_JW300` / 各 `*_SPEC` / ラック定数 / `type PlcModuleDefinition` を公開していることを確認する。

- [ ] **Step 5: 全体検証**

```powershell
pnpm -r test
pnpm -r typecheck
pnpm lint
npx prettier --check "packages/**/*.{ts,json}"
pnpm --filter @ojt/plc-dialects exec vitest run --coverage
pnpm --filter @ojt/board-model exec vitest run --coverage
pnpm --filter @ojt/circuit-sim exec vitest run --coverage
pnpm --filter @ojt/content exec vitest run --coverage
```

Expected: 7プロジェクトすべて通過、型検査とリントが無警告、Prettier が `All matched files use Prettier code style!`、4パッケージのカバレッジが90%以上。

- [ ] **Step 6: バッチDのレビューとコミット**

```powershell
git add packages
git commit -m "test(content): cross-validate the eight built-in mode D problems on all four PLC models"
```

ここで**バッチD のレビュー（Opus 1回）**をかける。見どころ: ①機種を差し替えた模範配線が1端子2本の制限を破っていないか（8点1コモンの機種はコモンが2本ぶん鎖に入る）②`ioAssignment` の新しいコモン検査が `io.mode: 'free'` の課題で誤検出しないか ③`content/src` が `@ojt/plc-dialects` を import していないこと。

---

## タスクと仕様節の対応

| タスク | 主に実装する仕様節 |
|---|---|
| Task 1 | §10.5（`DialectProfile`）、§10.6（スキン定義）、§17.1・§17 #19（前提の区分と流用） |
| Task 2 | §10.5（OMRON 列）、§10.6（CX-Programmer風）、§17 #22 |
| Task 3 | §10.5（JTEKT 列・固有バリデーション）、§10.6（PCwin風）、§17 #10・#20・#21・#22 |
| Task 4 | §10.5（シャープ列）、§10.6（JW-300SP風）、§17 #10・#22 |
| Task 5 | §10.5（4方言の一覧）、§10.6（列数・通電色）、§16 Phase 4 |
| Task 6 | §10.7（表記切替）、§16 Phase 4 受入基準② |
| Task 7 | §10.7（命令語リストのエクスポート）、§16 Phase 4 受入基準⑥ |
| Task 8 | §5.1.3（機種別の入力抵抗）、§10.1（端子集合とCOM分け）、§10.2（入力コモン） |
| Task 9 | §10.1（CP1E 一体形・外観）、§5.1.3、§17.1（COM分け 3/3/2/2/2・外観の前提）、利用者要求（外観の忠実な再現） |
| Task 10 | §10.1（TOYOPUC ラックと前面構成）、§17 #11・#21、§6.4（端子ID） |
| Task 11 | §10.1（JW300 ラック・入力表示灯 A/B 各8点2段）、§17 #11、§8.2（端子のピック）、§16 Phase 4 受入基準⑤ |
| Task 12 | §7.6（`plc` / `io`）、§16 Phase 4（4機種が開始できる） |
| Task 13 | §7.4・§10.8（`ioAssignment`）、§10.2（入力コモン）、§16 Phase 4 受入基準③⑤ |
| Task 14 | §7.9（内蔵課題8題）、§14.1（ゴールデンケース）、§16 Phase 4（受入基準の3A側） |

---

## 仕様との対応表（完了判定に使う）

| 仕様 | 要件 | 実装 | 検証 |
|---|---|---|---|
| §10.5 | 4方言の `DialectProfile` が揃う | `mitsubishi/omron/jtekt/sharp.ts` | `test/dialects.test.ts` |
| §10.5 | OMRON は `0.00` / `100.00` 形式、特殊は `P_On`/`A200.11`/`P_1s` | `omron.ts` | `test/omron.test.ts` |
| §10.5 | JTEKT は16進、特殊は `1V00`/`1V01`/`V072`、0.1s タイマ | `jtekt.ts` | `test/jtekt.test.ts` |
| §10.5 | JTEKT は X/Y・T/C の同番号を拒否する | `checkNumberConflicts()` | `test/jtekt.test.ts` |
| §10.5 | シャープは8進、`8` を入れるとエラー、特殊は `007366`/`007362`/`007364` | `sharp.ts` | `test/sharp.test.ts` |
| §10.5 | シャープの命令は `STR/AND/OR POS·NEG`・`OUT POS/NEG`・`AND STR`/`OR STR`・`F-40`/`F-47`/`F-48` | `INSTRUCTION_NAMES` | `test/sharp.test.ts` |
| §10.6 | `convertStep` は CX-Programmer風・PCwin風が `false` | 各プロファイル | `test/dialects.test.ts` |
| §10.6 | 接点11列、通電色は青／緑／オレンジ／水色 | 各プロファイル | `test/dialects.test.ts` |
| §10.6 | PCwin風・JW-300SP風は GX Works3風のキーを流用 | `shortcuts.ts` | `test/jtekt.test.ts` / `test/sharp.test.ts` |
| §10.7 | 表記切替は対象方言のバリデータを走らせ表せない項目を示す | `switchNotation()` | `test/notation.test.ts` |
| §10.7 | 命令語リストは UTF-8・CRLF のテキスト | `instructionList()` | `test/instruction-list.test.ts` |
| §10.1 | CP1E は18入力・12出力・COM5個（3/3/2/2/2） | `CP1E_SPEC` | `test/plc-cp1e.test.ts` |
| §10.1 | TOYOPUC は `POWER1`＋CPU＋`IN-12`＋`OUT-12` のラック | `PLC_UNIT_PC10G` | `test/plc-rack.test.ts` |
| §10.1 | JW300 は電源＋CU＋`JW-212NA`＋`JW-214SA`、`COM.A` に配線できる | `PLC_UNIT_JW300` | `test/plc-rack.test.ts` |
| §5.1.3 | 機種別の入力抵抗（CP1E 3.3k/4.8k、JW300 3.3k、TOYOPUC 2.4k） | 各 `*_SPEC` | `test/plc-cp1e.test.ts` / `test/plc-rack.test.ts` |
| §7.6 | 4機種のモードD課題が開始できる | `SUPPORTED_PLC_MODELS` | `test/schema-plc.test.ts` |
| §10.8 | `ioAssignment` が機種の端子名で判定する | `plc-static-checks.ts` | `test/plc-static-checks.test.ts` |
| §17 #11 | 端子の並び順は §10.1 の記載順、修正箇所は `terminals[].pos` のみ | `plc-unit.ts` | `test/plc-geometry-review.test.ts` |
| 利用者要求 | 4機種の外観（外形・色・端子カバー・LED・銘板・前面の造作）を機種ごとに記述し、3Dがそれを読んで描ける | `PlcAppearance` と `*_APPEARANCE` | `test/plc-appearance.test.ts` |
| §15・§17.1 | 銘板は型式の文字列のみでロゴ・ブランド名を持たない（商標注記は設定画面） | `appearance.nameplate` | `test/plc-appearance.test.ts` |
| §16 | 内蔵8題が4機種すべてで合格する | 変更なし（JSONは無改変） | `test/plc-cross-validation.test.ts` |

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本プランの実装 | 理由 |
|---|---|---|---|
| 1 | §10.5 は OMRON の入力を「`CIO 0`〜`99CH` のビット」と書く | IRの通し番号は **CP1E-N30DR-A が実装している点の並び**に写す（`X(12)` → `1.00`）。`0.12`〜`0.15` は「この機種にはない」エラー | `spec.inputs[i]` と `formatDevice(X(i))` が同じ添字で引けないと、模範配線・静的チェックが使う「割付の番号 → 端子」の対応に穴があく（決定表#1）。1チャネル16ビットという規則自体は `parseDevice` のビット部検査（00〜15）で守っている |
| 2 | §10.5 はシャープのタイマを番号だけで書く（`DTMR(BCD) 00001 / 0100`） | `TMR00000` / `CNT00011` のように接頭辞を付ける | 実機は命令語の文脈で種別が決まるが、本アプリの `parseDevice()` は文字列だけから一意に読める必要がある。接頭辞が無いと8進6桁のリレー番号と区別できない |
| 3 | §10.5 の `errorMessages` は「変換エラー文言」 | **バリデータが返すコードの文言表**と定義し直し、命令語リスト固有の文言は `INSTRUCTION_LIST_MESSAGES` に別置きする | `MITSUBISHI_FX5U.errorMessages` のキー集合は Phase 3 のテストが完全一致で見張っている（前提#5）。命令語リストのコードを足すとそのテストを機能上の利得なしに壊す |
| 4 | — | 三菱の `validate()` は共通の `collectDeviceIssues()` に載せ替えず現状のまま | 同上。三菱のエラー文言は Phase 3 のテストで固定されており、共通化は重複50行を消すだけで振る舞いを何も良くしない（決定表#3） |
| 5 | §10.1 は TOYOPUC・JW300 の端子台を1列の着脱式と書く | 1モジュールにつき**2列×最大9段**に並べる | 当たり判定半径4mm（8mm離す必要。前提#15）で18点を高さ130mmの1列に入れると4mm間隔になり、3Dでどの端子を掴んだか決まらない。§17 #11 は「並び順は前提・修正箇所は `terminals[].pos` のみ」としている（決定表#12） |
| 6 | §10.1 は `JW-214SA` を「リレー16点」としか書かない／TOYOPUC `OUT-12` のCOM分けを書かない | JW300 の出力を `C0`〜`C7`＋`COM.C` / `D0`〜`D7`＋`COM.D`、TOYOPUC の出力を8点1コモン（`COM0`/`COM1`）とする | 入力側と同じ様式に揃えた本アプリの前提（前提表）。端子名は部品ID `PLC` の下で一意でなければならないので、入力の `A`/`B` と衝突しない文字を選んだ |
| 7 | §10.5 は OMRON の固有バリデーションに「BCD/BINの指定整合」を挙げる | **実装しない** | IRはタイマ設定値を常にmsで持ち（§10.3）、BCD（`TIM`）とBIN（`TIMX`）の別を持たない。書き出しは `TIM` の `#` 表記に固定し、読み込みだけ `&` も受ける。BCD/BINを選ばせるにはIRに命令の別を持たせる必要があり、§17.1 の「IRは変更不要」に反する |
| 8 | §10.5 の表は各社の**保持リレー**（三菱 `L` / OMRON `H` / TOYOPUC `1K` / シャープ キープリレー）を挙げる | 実装しない（`DeviceKind` は6種のまま） | IRに保持リレーの種別が無い（§10.3）。足すとIR・ランタイム・課題スキーマ・作業ファイルがすべて動く。SET/RST で保持は表現できており、内蔵課題も保持リレーを要求していない |
| 9 | §10.5 は TOYOPUC の先頭を「プログラム番号 1/2/3」とする | **1 固定**とし、`2X000` は表記エラーにする | 本アプリのIRは1プログラムしか持たない（§10.3 はネットワークの列のみ）。2・3 を受けると「読めるが実行されないデバイス」ができてしまう |
| 10 | §10.7 は「命令語リストのエクスポート」とだけ書く | 直並列に分解できないグリッド（ブリッジ回路）は `not-series-parallel` を返して行を作らない | 命令語リストは本質的に直並列の表現である。ブリッジ回路は実機の純正ツールでも命令語に落ちない。IRとしては実行できるので、変換（`convert()`）は通したままにする（決定表#7） |
| 11 | §10.5 の `PlcUnitSpec` 相当は「入力端子名の配列」 | `{name, com, ohms?}` の配列に格上げし、`inputCommon` を `inputCommons`（複数）にし、`acPower` を足した | §5.1.3 が CP1E の入力抵抗を点で分け、§10.1 が TOYOPUC・JW300 を8点1コモンと定め、CP1E の電源端子は `L1`/`L2/N` である。いずれも旧い型では表せない（決定表#9・#10） |
| 13 | §10.1 は機種の外形寸法・端子集合・LEDの種類までしか定めない | 筐体色・端子カバー・LED/スイッチ/コネクタの面上の位置まで `PlcAppearance` に記述する | 利用者の要求（2026-09-19）が「各メーカーのシーケンサーの外観を忠実に再現すること」である。実機写真・純正画像は入手できない（§17.1 / PLC調査資料 §7）ので、カタログ寸法と一般に知られた見え方から**自前で作図**し、値を1ファイルに集めて `assumed` で前提であることを明示した（決定表#15） |
| 12 | §16 Phase 4 は「4方言が切替できるアプリ」 | 内蔵課題8題のJSONは無改変のまま、テストで機種を差し替えて4機種の成立を確かめる | §7.9 のモードD題数は8題である。機種別に課題を増やすと題数が32になり仕様と食い違う（決定表#14） |
| 14 | §10.5 は TOYOPUC の入力を `1X000`〜`1X7FF`、出力を `1Y000`〜`1Y7FF` と書く（同じ番号帯） | 出力のIR通し番号を **`1Y010` から**始める（`OUTPUT_BASE = 0x010`）。`deviceRanges.output.max` は `1Y7FF` を超えないよう 2031 にする | 同じ §10.5 が「X と Y の同一番号の重複使用禁止」も定めており、両方をそのまま実装すると `X(0)` と `Y(0)` を使う内蔵8題が全題エラーになる。実機のラックでも入出力モジュールは別アドレスに実装される（決定表#16） |
| 15 | §10.5 の `DialectProfile` は命令語を13キー（`ld`〜`counter`）で示す | `InstructionKey` を **24キー**に拡張する（`ldp`/`ldf`/`andp`/`andf`/`orp`/`orf`・`andBlock`/`orBlock`・`mc`/`mcr`・`end` を追加） | §10.7 の命令語リストは `ANB`/`ORB`・`MC`/`MCR`・`END`・接点形の微分（`LDP` 等）を書き出す必要があり、13キーでは方言ごとの綴り（OMRON `AND LD`、シャープ `AND STR` / `F-40`）を表に持てない。§10.5 の表自体はこれらの綴りを4社ぶん載せており、キーが足りないだけである（前提#4） |
| 16 | §10.5 の命令語の行は JTEKT 列を「同上（前提）」と書く（表の並びでは直前の **OMRON 列**と同じに読める） | JTEKT は**三菱系**の綴り（`SET`/`RST`・`ANB`/`ORB`・`MC`/`MCR`・`END`）にする | §17.2 #10 が「JTEKT TOYOPUC の命令名のみ未入手のため、**三菱系**の `LD`/`OUT`/`SET`/`RST`/`PLS`/`PLF` を前提表記とする」と明記しており、§10.5 の同じ表の微分の行も JTEKT に `PLS` / `PLF`（三菱系）を割り当てている。表の「同上」は直前列ではなく §17.1 の前提方針を指すと読んだ（§17 #10） |
| 17 | 実機は MC/MCR の書式が方言でまちまち（GX Works3 は `MC N0 M0` / `MCR N0` とネスト番号＋デバイス、CX-Programmer の `IL` / `ILC` はオペランド無し） | **全方言で「命令語＋デバイスのみ」の1形式**に統一する（ネスト番号は持たない） | IRの `mc`/`mcr` セルはネスト番号を持たない（§10.3）。CX-Programmer の「オペランド無し」をそのまま書くとIRのデバイス情報が命令語リストから消える。全方言を1形式に揃えれば `emitOutput()`（`instruction-list.ts`）が方言に依らない1つの手順で書ける（本アプリの表記。レビュー I1） |
| 18 | 実機の CX-Programmer・JW-300SP はカウンタを `LD <計数条件> / LD <リセット条件> / CNT <デバイス> <設定値>`（LDを2回重ねてから命令語）の順で書く | 全方言を**三菱の書式**（`<計数条件> / OUT・CNT <デバイス> <設定値> / LD <リセット条件> / RST <デバイス>`）に統一する | 三菱のカウンタは計数とリセットを別回路（別の `LD` 始まり）として書き、IRの `counter` セルも `device`（計数・プリセット）と `resetDevice`（リセット）を別々に持つ（§10.3）。全方言をこの形に揃えれば `emitOutput()` が1つの手順で書ける（本アプリの表記。レビュー I2） |
| 19 | §10.5 はシャープのタイマ単位を「0.1／0.01／0.001秒」の3通りとして挙げる | **0.1秒固定**にする | シャープの `TMR` 命令は §4-C の一次資料で0.1秒刻みとしか確認できておらず（§17.1 の前提方針）、IRのタイマ設定値はms単位のみで刻みの種別を持たない（§10.3）。0.01／0.001秒を選ばせるにはIRに刻みの種別を持たせる必要があり、§17.1 の「IRは変更不要」に反する（レビュー A-I2） |
| 20 | §10.5 は OMRON の `&`（BIN）表記の上限を書いていない | 読み込みは `&10000`〜`&65535` も**拒否**し、`#0001`〜`#9999`（BCD 4桁）と同じ範囲にする | `TIM`（本アプリが書き出す唯一の形）は BCD 4桁機であり、CP1E の設定値レジスタは機種を通じて 0〜9999 が上限である。`&` はBIN表記を読めるだけの入口であり、機種の設定値レンジそのものを広げるものではない（レビュー A-I2） |

---

## 4B への引き渡し（Plan 4B が使う公開API）

Plan 4B（`apps/desktop` の3スキン・ラックの3D・設定画面・表記切替UI・命令語リストの保存・E2E）は下記だけを使う。

**`@ojt/plc-dialects`:**

| API | 用途 |
|---|---|
| `availableDialects()` → `DialectProfile[]` | 設定画面の既定メーカー一覧（4件、`DIALECT_IDS` の順） |
| `getDialect(id)` / `isDialectId(text)` | 作業ファイル・設定から読んだ方言IDの解決（未知IDは `UnknownDialectError`） |
| `profile.convertStep` | ツールバーに「変換」ボタンを出すか（**受入基準①**: OMRON では出ない） |
| `profile.shortcuts` | キー割当表と §12.1 の注記（`confirmed: false` に「本アプリの表記です」を付ける） |
| `profile.gridCols` / `profile.monitorColors` | ラダーの表示列数とモニタ通電色。設定画面は 8〜15（`MIN_GRID_COLS`/`MAX_GRID_COLS`）と色を上書きできる |
| `profile.panels` | パネル名称とツールバーのボタン名（スキンごとに変える） |
| `profile.formatDevice` / `parseDevice` | デバイス入力欄と表示（**受入基準④**: シャープで `8` を入れると `Error` が返る。その文言をそのまま出す） |
| `profile.timerPreset(ms, device)` / `parseTimerPreset(text, device)` / `counterPresetText?(n)` / `parseCounterPreset?(text)` | タイマ・カウンタの設定値欄。`Error` のときは §10.5 の「丸めますか？」を出す（三菱は `roundTimerPreset(ms, timerBaseMs(device))`）。カウンタの対は Plan 4B の申し送り F-2 がそのまま使う |
| `profile.specialDevices` / `specialInverted` | 特殊デバイスの選択肢。**`specialInverted` に載っている番号はb接点で描く**（シャープの `007366`＝常時ON） |
| `profile.validate(program)` / `convert(program, profile)` | 「変換」操作と出力ウィンドウ |
| `switchNotation(program, from, to)` → `{ok, changes, errors}` | **表記切替ダイアログ**（受入基準②）。`changes` は `X10 → 0.08` の一覧、`errors` は切替先で表せない項目。IRは書き換えないので、切り替えても取り消しスタックは無傷 |
| `instructionList(program, profile)` → `{lines, text, errors}` | **命令語リストの保存**（受入基準⑥）。`text` は CRLF 済みなので、UTF-8 でそのまま書けばよい。印刷用レイアウトは `lines`（`step` / `mnemonic` / `operand` / `networkId`）から組む |
| `INSTRUCTION_LIST_MESSAGES` | 上の `errors[].code` の日本語文言 |
| `GX_STYLE_SHORTCUTS` / `withoutConvert(table)` | 設定画面でキー割当を上書きするときの元表 |

**`@ojt/board-model`:**

| API | 用途 |
|---|---|
| `PLC_UNITS` / `plcUnitFor(model)` | 機種 → 本体定義（4機種） |
| `unit.form`（`'unit'` / `'rack'`）/ `unit.modules` | **3Dの描き分け**。`rack` はベース1枚＋`modules[]` の箱を `pos` / `sizeMm` に置く（受入基準③⑤）。`modules[].displayName` をツールチップに使う |
| `unit.appearance` / `module.appearance`（`PlcAppearance`） | **3Dの外観をここから描く**。`faceMm`（正面の大きさ）・`bodyColor`・`terminalBlockColor`・`nameplate`＋`nameplateRect`（型式の文字だけ。ロゴは描かない）・`covers`（ヒンジ式端子カバー）・`leds`（`status` / `input` / `output` と点灯色）・`features`（RUN/STOPスイッチ・Ethernet／SD／USB・オプションスロット・モジュール固定ラッチ）。座標は**正面の左上が原点・x右・y下・mm**。色や座標を 4B に直書きしない（決定表#15）。`assumed` に前提項目が入っているので、設定画面の注記に並べてよい |
| `unit.terminals` / `unit.spec` / `unit.leds` | 端子のピックとラベル、LED表示。端子は機種で名前が違う（`0.00` / `A0` / `COM.A`）ので**名前を決め打ちしない** |
| `withPlcUnit(board, unit)` / `deskWires(board, session)` | 機種を差し替えた派生盤と机上配線（Phase 3 から変更なし） |
| ラック定数（`RACK_MODULE_WIDTH_MM` ほか） | 3Dの寸法合わせ |

**`@ojt/content`:** `SUPPORTED_PLC_MODELS`（4機種）。課題読込・判定・静的チェックのAPIは Phase 3 から変わらない。

**引き渡し注記:**

- **H-1** 機種を変えると端子名が変わる。3Dの端子ラベル・配線ガイド・結果画面の文言は `unit.spec` / `unit.terminals` から引くこと。`PLC.X0` のような文字列を書かない（Task 13 で静的チェック側の決め打ちを外した理由と同じ）。
- **H-2** 表記切替は**IRを書き換えない**。切替前後で `LadderProgram` は同一オブジェクトのままでよく、保存する作業ファイルにも方言IDだけを持たせる（§12.3）。
- **H-3** `convertStep: false` のスキンでは「変換」を経ずに書込みへ進む。ただし判定に出す前に `convert()` は必ず走らせる（3A ハンドオフ注記 H-1 は変わらない）。画面に変換ボタンが無いだけである。
- **H-4** シャープの常時ONは**b接点**で描く（`specialInverted`）。IRの `SP0` はあくまで「常時ON」であり、a接点で描くと実機の見た目と食い違う。
- **H-5** 設定画面には §17.1 の常設注記「一部の命令名・キー割当は実機マニュアル未確認のため本アプリの表記です」を出す。どの項目が前提かは `shortcuts[].confirmed === false` で分かる。
- **H-6** ラックは4スロットぶんの箱を描くが、**ネットリスト上は1部品（`PLC`）**である。端子IDにモジュール名は入っていない（決定表#11）。
- **H-7** `apps/desktop/src/renderer/three/PlcUnit.tsx` が持つ FX5U 決め打ちの定数は `unit.appearance`（`PlcAppearance`）で置き換える。対象は `BODY_COLOR`（L22 `'#D8DBE0'`）・`LED_LEFT_MM`（L26）と `LED_TOP_MM`（L33、L27-32 のコメント込み）・`PLC_LABEL_PAD_MM`（L47）である。`plcFaceRect()`（L62）は**そのまま残す**（端子座標から面の矩形を導いているだけで機種に依存しない）。`FX5U_APPEARANCE.bodyColor` は `'#3A3D42'`（濃灰）なので、置き換えると**机上のPLCの見た目が変わる**（現行の `'#D8DBE0'` は明灰）。4B の受入確認にスクリーンショットを1枚入れること。
- **H-8** `apps/desktop/src/renderer/three/labels.ts:267`（`blockTerminalMark()`）は `terminal.id.split('.')` の**2番目の断片**を端子名として使っている。端子名に `.` を含む機種ではこれが壊れる（CP1E の `PLC.0.00` が `'0'`、JW300 の `PLC.COM.A` が `'COM'` になる）。4B は `parseTerminalId()`（`@ojt/circuit-sim` から公開。`packages/circuit-sim/src/ids.ts` L44）の `.name` に差し替えること。直さないと §16 Phase 4 受入基準⑤（`PLC.COM.A` へ配線できる）の3D側が満たせない。前提#8 のとおり端子名側に `.` を含むのは仕様どおりである。

---

## 実装者への MERGE 注意

- 作業ツリーは他のエージェントと共有している。**着手前に必ず `git fetch && git pull --rebase origin main`**、コミットは `git add <このプランが挙げたパスだけ>` で行う。`git stash` / `git reset` / `git clean` は使わない。
- Task 8 は `circuit-sim` / `board-model` / `content` の3パッケージ**と `apps/desktop` の2行**に跨る型変更である。**1つのコミットにまとめる**（途中の状態では `pnpm -r typecheck` が通らない）。`apps/desktop` に触るのはこの2行だけで、他は 4B の担当である（B1）。
- Task 12 は `PHASE3_MODELS` を **`SUPPORTED_PLC_MODELS` に改名**する。`apps/desktop` は現在この定数を参照していない（前提#18）が、4B が参照を足していたら同じコミットで直す。
- Task 14 で `packages/content/package.json` に devDependency を足したら `pnpm install` を走らせ、`pnpm-lock.yaml` の差分もコミットに含める。
- 内蔵課題JSON（`packages/content/src/builtin/plc/*.json`）と `apps/desktop/resources/content/plc/*.json` は**このプランでは1文字も変えない**（決定表#14）。

---

## 完了条件

- [ ] `pnpm -r test` が7プロジェクトすべて通る。
- [ ] `pnpm --filter @ojt/plc-dialects exec vitest run --coverage` と `@ojt/board-model` / `@ojt/circuit-sim` / `@ojt/content` の4つが閾値90%（lines / statements / functions / branches）を満たす。
- [ ] `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` 込み）が無警告で通る。
- [ ] `npx prettier --check "packages/**/*.{ts,json}"` が `All matched files use Prettier code style!` を出す。
- [ ] `availableDialects()` が4件を返し、`getDialect('omron' | 'jtekt' | 'sharp')` が投げない。
- [ ] OMRON の `convertStep` が `false`、三菱・シャープが `true`、JTEKT が `false` である（受入基準①）。
- [ ] `switchNotation(p, MITSUBISHI_FX5U, OMRON_CP1E)` が `X10 → 0.08` / `Y1 → 100.01` を返す（受入基準②）。
- [ ] `PLC_UNIT_PC10G.modules` が `POWER1` / `PC10G-1SP` / `IN-12` / `OUT-12` の4枚で、`PLC.ICOM0` が配線可能端子である。`1X010` と `1Y010`（＝ `X(16)` と `Y(0)`。同じアドレス `0x010`）を同時に使うラダーが `device-conflict` になり、既定の `X(0)`＋`Y(0)` では**ならない**（受入基準③・決定表#16）。
- [ ] シャープで `parseDevice('000008')` が `8進` を含む `Error` を返す（受入基準④）。
- [ ] `PLC_UNIT_JW300.modules` が `JW-301PU` / `JW-312CU` / `JW-212NA` / `JW-214SA` の4枚で、`PLC.COM.A` が配線可能端子である（受入基準⑤）。
- [ ] `instructionList()` が4方言で内蔵8題すべてを書き出し、`text` が CRLF で終わる（受入基準⑥）。
- [ ] 内蔵モードD課題8題が4機種すべてで `PlcProblemSchema.parse()` を通り、`judgePlcReference()` が合格する。
- [ ] 4機種すべてで `withPlcUnit(JIPM_BOARD, unit)` が `validateBoard()` を空配列で通り、机上端子が8mm以上離れ、PLC端子が本体（ラックはモジュール）の箱に収まる。
- [ ] `PLC_UNITS` の4機種すべてと、ラック2機種の各4モジュールに `appearance` があり、矩形が面からはみ出さず、銘板がロゴ・ブランド名を含まない（`test/plc-appearance.test.ts`）。
- [ ] `packages/ladder-core` に**一切の変更が無い**（`git diff --stat packages/ladder-core` が空。§17.1 の「IR・ランタイムの変更は不要」の実地検証）。
- [ ] `packages/content/src` が `@ojt/plc-dialects` を import していない（テストのみ可。3A 決定表#7）。
- [ ] `apps/desktop` の変更は `src/renderer/ladder/IoTable.tsx` と `src/renderer/ladder/MonitorPanel.tsx` の**各1行**（と `test/monitor-panel.test.tsx` の期待値1行）**だけ**である（Task 8 の型変更に追随させる最小変更。それ以外は 4B の担当）。**Plan 4A 時点では各1行；以後は Plan 4B が変更する**（4B は UI 側の実装なので `apps/desktop` に本格的に手を入れる。この条件は 4A が終わった時点のスナップショットであり、4B 完了後の `apps/desktop` の行数を縛るものではない）。

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-19 | Batch D レビュー反映: I1、I2、M3〜M9、決定表（使う点のコモン） |
| 2026-09-19 | Batch A/B レビュー反映: B1、B2、I1〜I4、M1〜M6、A-I1、A-I2、A-M1〜A-M7 |
| 2026-09-19 | Batch C レビュー反映: B1、I1〜I3、M1〜M8 |
| 2026-09-19 | レビュー反映: B1〜B3、I1〜I8、M1〜M7、行番号修正 |
| 2026-09-19 | 利用者要求（3Dのシーケンサーを各メーカーの外観どおりに再現する）を反映: `PlcAppearance`（筐体色・端子カバー・LED・銘板・前面の造作を正面座標で持つ記述）を `board-model` に追加し、FX5U・CP1E・TOYOPUC 4モジュール・JW300 4モジュールぶんを定義。ラックの端子開始位置を上端8mm→14mmに変えて入出力表示灯の帯を確保。決定表#15・意図的な差分#13・4B引き渡しの行・`test/plc-appearance.test.ts` を追加 |
| 2026-09-19 | 初版。Phase 4 をライブラリ（4A）と `apps/desktop`（4B）に分割し、本書は 4A を扱う。OMRON・JTEKT・シャープの3プロファイル、GX Works3風キー割当の共有、共通デバイス検査、表記切替（IRを書き換えない）、命令語リスト（直並列簡約）、`PlcUnitSpec` の点別コモン・点別抵抗・AC端子への格上げ、CP1E（一体形）と TOYOPUC・JW300（ラック形）の本体定義、ラック端子の2列配置、4機種でのモードD課題の開始、静的チェックの機種非依存化、内蔵8題の4機種クロス検証を確定した |
