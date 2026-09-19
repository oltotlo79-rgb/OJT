# Plan 4B: 4メーカーのスキン画面・表記切替UI・命令語リスト保存・機種別の3D（apps/desktop のみ）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 4A が `packages/` に用意した4方言プロファイル・表記切替・命令語リスト・4機種の本体定義（＋外観記述 `PlcAppearance`）を、**アプリの画面として使えるようにする**。すなわち ①GX Works3風／CX-Programmer風／PCwin風／JW-300SP風の**4スキンの回路入力画面を、公知の情報の範囲で実物に近い見た目まで作り込み**（画面の並び・配色・セル寸法・記号の描き方・ツールバーとメニューの日本語・タイトルバー・ステータスバー）、②設定画面の既定メーカーで4社すべてを選べるようにし、③ラダーの表記を別メーカーへ切り替えるダイアログを足し、④命令語リストをテキストファイルへ保存できるようにし、⑤3Dの `PlcUnit` を `PlcAppearance` から描く汎用部品に作り替えて一体形2機種とラック形2機種（TOYOPUC / JW300）を描き分け、⑥§16 Phase 4 の受入基準①〜⑥をE2Eで通す。

**利用者要求（2026-09-19）:** 「分かりやすく直感的に操作できるUI、UXにしてね」／「3Dのシーケンサーは三菱やトヨプックなどの各メーカーのシーケンサーの外観を忠実に再現すること」／**「ソフト図の回路入力画面も各メーカーのソフト画面や仕様に合わせた可能な限り実物に忠実な画面にすること」／「各画面のクオリティも可能な限り向上すること」**。本プランはこの4点を、①スキンの見た目を `SkinTheme`（CSS変数＋レイアウト旗）というデータに集め、②3Dの外観を 4A の `PlcAppearance` から描き、③手順ガイド・状態表示・無効理由の文言は4スキン共通で残し、④「実物との対応」表で前提（§17.1）の範囲を明示する、という形で満たす。**各社のロゴ・アイコン・画面キャプチャ・図記号ビットマップ・配色データは一切複製しない**（§17 / PLC調査資料 §6）。再現するのは公知の画面構成・項目名・一般に知られた色調であり、値はすべて本アプリの記述である。

**Architecture:** Phase 3 で landed した画面の構造（`session/ladder.ts` の純粋層 → `ladder/**` の部品 → `screens/PlcSession.tsx`）は**そのまま**で、「方言ごとに変わるもの」を2ファイル（`session/plc-skin.ts` = 振る舞い、`ladder/skins/*.ts` = 見た目）に集める。画面部品はそこから引くだけにして、`'F4'` / `'#1E64FF'` / `48px` のような方言の値を**部品にもCSSにも直書きしない**。3Dも同じ方針で、色・寸法・面上の配置は `@ojt/board-model` の `PlcAppearance` が唯一の持ち主であり、`three/**` は**描くだけ**にする（4A 決定表#15。実機と違うと分かったときの修正箇所を1ファイルに保つ）。

**4B が触らないもの:** `packages/**`（4A の担当。1行も変えない）、`src/worker/**` の判定・スキャン結合（Phase 3 のまま。`spec.inputs` の型追随を除く）、`schematic-core` と回路図画面。

**Tech Stack:** TypeScript（`strict` ＋ `noUncheckedIndexedAccess` ＋ `exactOptionalPropertyTypes` ＋ `verbatimModuleSyntax`、`.js` 拡張子つき相対 import）、React 19 ＋ zustand、@react-three/fiber 9 ＋ drei 10、Vitest 5（`globals: false` / `environment: 'happy-dom'`）、`@testing-library/react` ＋ `@testing-library/jest-dom`、Playwright（Electron）、CSS Modules ＋ CSS カスタムプロパティ、Prettier（printWidth 100）。**新しい外部依存は追加しない。**

---

## 前提（このプランを始める前に満たしていること）

実コード（`apps/desktop/src` / `test` / `e2e`）と Plan 4A の本文で確認した事実だけを載せる。番号は本文から参照する。

### 前提A: Plan 4A が `packages/` に landed させる公開API（4A「## 4B への引き渡し」より）

| # | 前提 | 出どころ |
|---|---|---|
| 1 | `availableDialects()` が4件（`DIALECT_IDS` の順 = `mitsubishi` / `jtekt` / `omron` / `sharp`）を返し、`IMPLEMENTED_DIALECT_IDS` が `DIALECT_IDS` と等しくなる。`getDialect(id)` はどのIDでも投げない | 4A Task 5 |
| 2 | プロファイル4件の識別子は `MITSUBISHI_FX5U` / `JTEKT_PC10G` / `OMRON_CP1E` / `SHARP_JW300`。`displayName` は `三菱電機 MELSEC iQ-F FX5U（GX Works3風）` / `OMRON CP1E-N30DR-A（CX-Programmer風）` / `JTEKT TOYOPUC PC10G-1SP（PCwin風）` / `シャープ JW300（JW-300SP風）` | 4A Task 2〜5、landed `mitsubishi.ts` L315-317 |
| 3 | `profile.convertStep` は 三菱 `true` / シャープ `true` / OMRON `false` / JTEKT `false` | 4A 完了条件（受入基準①） |
| 4 | `profile.panels` は `{ tree, editor, output, toolbar }`。`toolbar` の項目数と文言は方言ごとに違う: 三菱8件（`変換`/`全変換`/`書込みモード`/`読出しモード`/`オンライン`/`シーケンサへの書込み`/`モニタ開始`/`モニタ停止`）、OMRON5件（`オンライン編集`/`転送［PC → PLC］`/`モニタ開始`/`モニタ停止`/`運転／停止`）、JTEKT9件（`JP1`/`DGR`/`MOB`/`STP`/`RDY`/`RUN`/`RES`/`モニタ開始`/`モニタ停止`）、シャープ5件（`変換`/`PLCへの書込み`/`運転／停止`/`モニタ開始`/`モニタ停止`）。`tree` も方言ごとに違う（JTEKT は `プロジェクトツリー（プログラム／データファイル／パラメータ／LD／SFC）`）、`output` は JTEKT だけ `ステータスバー` | 4A Task 2 L1209 / Task 3 L1719 / Task 4 L2206、landed `mitsubishi.ts` L194（`PANELS`） |
| 5 | `profile.monitorColors` は `{ powered, idle }`。`powered` は 三菱 `#1E64FF` / OMRON `#2FA02C` / JTEKT `#E08A1E` / シャープ `#00A0C8`。`gridCols` は4方言とも 11 | 4A 前提表（§10.6） |
| 6 | `profile.deviceRanges.input.prefix` は 三菱 `'X'` / JTEKT `'1X'` / **OMRON `''`** / **シャープ `''`**。`deviceRanges.input.radix` は **三菱 8**（`X`/`Y` は8進。`X8` は `X10` と書く） / JTEKT 16 / OMRON 10 / シャープ 8 | landed `mitsubishi.ts` L68・`jtekt.ts` L53・`omron.ts` L56・`sharp.ts` L58 |
| 7 | `profile.specialInverted?: readonly number[]` は**シャープだけ**が `[SPECIAL_ALWAYS_ON]`（`007366`）を持つ | 4A Task 1 L401 / Task 4 L2237 |
| 8 | **landed（4A Task 7 / d721b23）**: `DialectProfile` に **`counterPresetText?(preset: number): string`**（`profile.ts` L159）と **`parseCounterPreset?(text: string): number \| Error`**（L164）の対がある。4方言すべてが実装済みで、三菱 `K5`（1〜32767）/ OMRON `#0005`（1〜9999。読みは `&` も受ける）/ JTEKT `H0005`（**16進**4桁。1〜65535）/ シャープ `0005`（1〜9999）。**`formatCounterPreset` という名前は存在しない** | landed `packages/plc-dialects/src/profile.ts` L155-164、`mitsubishi.ts` L150-163、`omron.ts` L196-217、`test/counter-preset.test.ts` |
| 9 | **`switchNotation(source: LadderProgram, from: DialectProfile, to: DialectProfile): NotationSwitchResult`**（引数は**方言IDではなくプロファイル**。landed `notation.ts` L37-41）。`NotationSwitchResult = { ok: boolean; from: DialectId; to: DialectId; changes: readonly NotationChange[]; errors: readonly DialectError[] }`（**戻り値の `from` / `to` は ID**）。`NotationChange = { device: Device; from: string; to: string }`。**IRは書き換えない**（H-2） | 4A Task 6、landed `packages/plc-dialects/src/notation.ts` L15-50 |
| 10 | `instructionList(program, profile)` → `{ lines: InstructionLine[]; text: string; errors: DialectError[] }`。`InstructionLine = { step: number; mnemonic: string; operand: string; networkId: string }`。`text` は CRLF 済みで末尾にも改行、UTF-8 でそのまま書けばよい | 4A Task 7 |
| 11 | `INSTRUCTION_LIST_MESSAGES` は `compile-failed` / `not-series-parallel` / `preset-unavailable` の3キー | 4A Task 7 L2960 |
| 12 | `PLC_UNITS` は4機種（`FX5U` / `PC10G-1SP` / `CP1E` / `JW-300`）、`plcUnitFor(model)` が引く | 4A Task 9〜11 |
| 13 | `PlcUnitDefinition` に `form: 'unit' \| 'rack'` / `appearance: PlcAppearance` / `modules?: readonly PlcModuleDefinition[]` が生える。`PlcModuleDefinition = { slot; model; displayName; sizeMm; pos; appearance }` | 4A Task 9 Step 4 |
| 14 | `PlcAppearance = { faceMm: {width;height}; bodyColor; terminalBlockColor; nameplate; nameplateRect; covers; leds; features; assumed }`。座標系は**正面の左上が原点・x右・y下・mm**。`FaceRect = { x; y; w; h }`、`PlcLedMark = { name; group: 'status'\|'input'\|'output'; rect; color }`、`PlcCoverMark = { id; rect; color; hinge: 'top'\|'bottom'\|'left'\|'right' }`、`PlcFeatureMark = { id; kind: 'switch'\|'port'\|'slot'\|'latch'; label; rect; color }` | 4A Task 9 Step 4 |
| 15 | FX5U の外観は `nameplate: 'FX5U-32MR/ES'`、`covers` が `hinge: 'top'`/`'bottom'` の2枚（明灰 `#C8CBD0`）、本体色 `#3A3D42`、`leds` が status 5個（`PWR`/`ERR`/`P.RUN`/`BAT`/`CARD`）＋ input 16 ＋ output 16、`features` が `run-stop`/`ethernet`/`sd-card` | 4A Task 9 Step 5 |
| 16 | ラックの寸法定数は `RACK_MODULE_WIDTH_MM`=35 / `RACK_MODULE_HEIGHT_MM`=130 / `RACK_BASE_MARGIN_MM`=10 / `RACK_BASE_HEIGHT_MM`=140、`rackModulePos(slot)` / `rackSizeMm(slots, depthMm)`。ラックの `appearance.features` にはベース1枚ぶんの `slot-rail` が入り、`covers` / `leds` は空 | 4A Task 10 Step 3 |
| 17 | `PlcUnitSpec` が `inputs: readonly PlcInputSpec[]`（`{ name; com; ohms? }`）・`inputCommons: readonly string[]`・`acPower: readonly [string, string]` に格上げされる（旧 `inputs: readonly string[]` / `inputCommon: string` は消える） | 4A Task 8・決定表#9 |
| 18 | `SUPPORTED_PLC_MODELS`（`@ojt/content`）が4機種になり、内蔵モードD課題8題は**JSONを1文字も変えず**4機種すべてで `PlcProblemSchema.parse()` と `judgePlcReference()` を通る。機種にない入出力点（CP1E の `y: 12` 以降）は `PlcProblemSchema` が弾く | 4A Task 12・Task 14 |
| 19 | 課題の `plc` は `{ vendor, model }`。`MODEL_OF_VENDOR`（メーカー→機種の1対1）は `schema/plc.ts` の**非公開**定数である | `packages/content/src/schema/plc.ts` L31-38 |
| 20 | `H-1`（端子名は `unit.spec` / `unit.terminals` から引く。`PLC.X0` を書かない）・`H-2`（表記切替はIRを書き換えない）・`H-3`（`convertStep: false` でも判定前に `convert()` は必ず走らせる）・`H-4`（シャープの常時ONはb接点で描く）・`H-5`（設定画面に §17.1 の常設注記）・`H-6`（ラックもネットリスト上は1部品 `PLC`、端子IDにモジュール名は入らない） | 4A「引き渡し注記」（改訂版 6c875a1） |
| 20b | **H-7**: `three/PlcUnit.tsx` の FX5U 決め打ちの定数を `unit.appearance` で置き換える。**削除する5つ**は `BODY_COLOR`（L21-22 `'#D8DBE0'`）・`LED_D_MM`（L23-24）・`LED_LEFT_MM`（L25-26）・`LED_TOP_MM`（L27-33 のコメント込み）・`BODY_Z_MM`（L35-40 のコメント込み）で、**残す2つ**は `PLC_LABEL_PAD_MM`（L42-47。`blockFaceTexture()` / `plcFaceRect()` の既定の余白）と `plcFaceRect()`（L62）である（`LABEL_LIFT_MM`（L48-49）だけは `appearance.ts` の `FACE_LABEL_LIFT_MM` に置き換えて消す）。この一覧が唯一の版で、Task 10 Step 4 も同じ7つを指す。`FX5U_APPEARANCE.bodyColor` は `'#3A3D42'`（濃灰）なので、**机上のPLCの見た目が変わる**（受入確認にスクリーンショットを1枚入れる） | 4A H-7 |
| 20c | **H-8**: `three/labels.ts:266` の `blockTerminalMark()` は `terminal.id.split('.')` の2番目の断片を端子名にしている。端子名側に `.` を含む機種（CP1E の `PLC.0.00` → `'0'`、JW300 の `PLC.COM.A` → `'COM'`）で壊れる。**`parseTerminalId()`（`@ojt/circuit-sim`、`src/ids.ts` L44）の `.name`** に差し替える。直さないと受入基準⑤の3D側が satisfied にならない | 4A H-8 |
| 20d | **JTEKT のアドレス写像**（4A 決定表#16）: `X(i)` → `1X000`＋i（`IN-12` の端子は `X0`〜`XF`）、`Y(i)` → `1Y010`＋i（`OUT-12` の端子は `Y10`〜`Y1F`。`PC10G_OUTPUT_BASE = 0x010`）。同番号検査（`device-conflict`）は**この写像を通したアドレス**どうしを比べるので、既定の `X(0)`＋`Y(0)` では**起きず**、`1X010` と `1Y010` を同時に使ったときだけ起きる（受入基準③）。T と C はずらさない（決定表#17） | 4A 決定表#16・#17、完了条件 |
| 20e | 4A Task 8 が **`apps/desktop` の2行だけ**を直す: `ladder/IoTable.tsx:32` と `ladder/MonitorPanel.tsx:94` を `unit.spec.inputs[x]?.name` にする（＋`test/monitor-panel.test.tsx` の期待値1行）。**それ以外の `apps/desktop` の変更は 4B の担当**である | 4A MERGE 注意・完了条件 |

### 前提B: `apps/desktop` の既存API（**本プランが触る分だけ**。実ソースを確認済み）

```ts
// src/renderer/ladder/LadderWorkspace.tsx
export const TOOLBAR_ACTIONS: readonly ToolbarAction[];   // 8件・**位置で** panels.toolbar に対応させている
type ToolbarAction = 'convert'|'convert-all'|'write-mode'|'read-mode'|'online'|'download'|'monitor-start'|'monitor-stop';
export function LadderWorkspace(p: { problem: PlcProblem; profile: DialectProfile; gridCols: number;
  onPlc: (action: PlcCommandAction) => void }): JSX.Element;
//   内部: convert() = runConvert(current, profile) → setConverted() → onPlc({kind:'load'}) → toast
//        changeMode(mode) = setLadderMode(mode) + onPlc({kind:'monitor', on: mode==='monitor'})
//        edit(run) = ladderMode !== 'write' なら JA.ladder.readOnly を出して false
//   JSX: <div className={styles.workspace}> → .toolbar（role="group"） → .workspaceBody
//        → ProjectTree / .workspaceMain(LadderEditor + OutputWindow) / .workspaceSide(MonitorPanel, IoTable, CommentPanel, ShortcutHelp)

// src/renderer/ladder/*.tsx（props だけ抜粋）
export function LadderEditor(p: { profile; gridCols: number; errorCells: ReadonlySet<string>;
  onConvert: () => void; onModeChange: (mode: LadderEditorMode) => void }): JSX.Element;
export function LadderGrid(p: {…}): JSX.Element;   // memo。内部で colors = {...profile.monitorColors, powered: monitorColor || 既定}
export function displayColumns(gridCols: number): number[];
export function hasHiddenCells(net: Network, gridCols: number): boolean;
export function DeviceInput(p: { initial: CellForm; profile; onCommit: (cell: Cell) => void; onCancel: () => void }): JSX.Element;
//   内部 hints: { device: `${profile.deviceRanges.input.prefix}0`, reset: `${…prefix}2`, timer: …, counter: '5' }
export function OutputWindow(p: { issues: ConvertIssues; converted: boolean; onJump: (c: LadderCursor) => void }): JSX.Element;
export function ProjectTree(p: { program; profile; currentNetworkId: string; onPick: (id: string) => void }): JSX.Element;
export function ShortcutHelp(p: { profile: DialectProfile }): JSX.Element;   // 行は data-testid={`shortcut-${action}`}
export function IoTable(p: { io: ResolvedPlcIo; profile; unit: PlcUnitDefinition }): JSX.Element;
export function MonitorPanel(p: { profile; unit: PlcUnitDefinition; onPlc }): JSX.Element;

// src/renderer/ladder/symbols.ts（L11-108。実ソースを読み直して写した）
export const CELL_W = 48; export const CELL_H = 36; export const WIRE_Y = CELL_H / 2;   // L11/L13/L15
export interface SymbolShape { paths: readonly string[]; text?: string }               // L24-29
export function symbolShape(id: string): SymbolShape;   // L71。**`undefined` を返さない**（未知のIDは `?` 付きの接点 `UNKNOWN` に倒す）
export const MC_SYMBOL_ID = 'coil-mc'; export const MCR_SYMBOL_ID = 'coil-mcr';        // L48-49
export const LEAD_LEFT: string; export const LEAD_RIGHT: string; export const LEAD_FULL: string;  // L76/L78/L80
export const LINK_DOWN: string;        // L88 = `M 0 18 L 0 54`。**セルの左辺**（`M 0 …`）で、下端は `CELL_H + WIRE_Y`
export const END_MARK: readonly string[];  // L90。**文字列ではなく2本の縦棒の配列**（`M 12 8 L 12 28` / `M 18 8 L 18 28`）
export function leadAcrossHidden(lastContactIndex: number, row: number): string;  // L101。**引数2つ**。
//   3B 最終修正で始点は「コイル列の左端」= `(lastContactIndex + 1) * CELL_W`、終点は `+ LEFT`(15) の短い線。
//   `row` は行番号（行の `<g>` に移動が掛かっていないので縦位置をこの線自身が持つ）

// src/renderer/ladder/ladder.module.css（全385行。色の直書きは L3-97 に集まっている）
//   L3 .gridScroll{background:#f7f8fa}  L41 .rail{fill:#3a3f47}  L60-69 .symbolText/.deviceText{fill:#1b1e23}
//   L78 .presetText{fill:#555}  L83 .commentText{fill:#1b6ac9;font-size:8px}  L88 .cursor{stroke:#1e64ff}
//   L94 .errorCell{stroke:#d14343}  L29 .networkComment{color:#1b6ac9}  L53-56 .wire,.symbol{stroke-width:1.6}
//   → **色・寸法がすべて直書き**（前提#26）

// src/renderer/session/*
export function shortcutKeyOf(profile: DialectProfile, action: string): string | undefined;
export function runConvert(source: LadderProgram, profile: DialectProfile): ConvertRun;  // {ok, issues, program}
export function errorCellKeys(errors: readonly ConvertErrorLine[]): Set<string>;
export function plcBoardOf(problem: SupportedProblem): BoardDefinition | undefined;
export function boardForProblem(problem: SupportedProblem | undefined): BoardDefinition;
export function canJudgePlc(s: { converted: boolean; ladder?: LadderProgram }): JudgeReadiness;
export function toWorkFile(...): WorkFile;   // `dialectId: state.dialectId` / `converted` / `ladder` を載せる
export function applyWorkFile(file, options?): Promise<boolean>;  // isDialectId && IMPLEMENTED_DIALECT_IDS で setDialect()

// src/renderer/three/*
export function PlcUnit(p: { unit: PlcUnitDefinition; terminals: readonly BoardTerminal[];
  hoveredTerminal; pendingTerminal; onHoverTerminal; onPickTerminal }): JSX.Element;
export function plcFaceRect(terminals, padMm?): { cx; cy; w; h } | undefined;   // = labels.ts の faceRect()
export function Outlet(p: {…}): JSX.Element;
export function DeskWires(p: { board: BoardDefinition; session: BoardSession }): JSX.Element | null;
export function offBoardTerminals(board: BoardDefinition): BoardTerminal[];
export function deskCablePoints(from: Vec3, to: Vec3): Array<[number, number, number]>;
export const PLC_VIEW_ASPECT = 0.75; export const PLC_VIEW_MARGIN_MM = 20;
export const PLC_VIEW_RECT: { x; y; w; h };     // IIFE。**`PLC_UNIT_FX5U` 決め打ち**
export function cameraPose(preset: CameraPreset): CameraPose;        // 引数は1つだけ
export function fitDistanceMm(widthMm, heightMm, aspect): number;
export const MAX_CAMERA_DISTANCE_MM = 1200;
export function toScene(v: Vec3): [number, number, number];
export function sharedMaterial(color: string, o?: { roughness?; metalness? }): MeshStandardMaterial;
export const UNIT_BOX: BoxGeometry;             // 1×1×1。scale で使う
export function TerminalHit(p: { terminal; tooltip; hovered; pending; onHover; onPick }): JSX.Element;
export function terminalTooltip(terminal: BoardTerminal, roleLabel: string): string;
export function blockFaceTexture(terminals, padMm): Texture | undefined;
export interface FaceRect { cx; cy; w; h }      // labels.ts。board-model の FaceRect と**同名**

// src/shared/ipc.ts
export const IPC_CHANNELS = { contentList; contentRead; workfileSave; workfileLoad; settingsGet; settingsSet };  // **6本**
export interface AppSettings { userContentDir; soundEnabled; soundVolume; restorePrompt;
  defaultVendor: DialectId; ladderGridCols: number; monitorColor: string }  // L164-179。**`defaultVendor` は既に `DialectId`**（前提#31 / I4）
export const DEFAULT_SETTINGS: AppSettings = { …, defaultVendor: 'mitsubishi', ladderGridCols: 11, monitorColor: '#1E64FF' };
export interface OjtApi { listProblems; readProblem; saveWorkFile; loadWorkFile; getSettings; setSettings }
export interface WorkFile { …; ladder?: unknown; dialectId?: string; converted?: boolean }

// src/renderer/app/store.ts
dialectId: DialectId; ladderGridCols: number; monitorColor: string;
applyLadderSettings(s: { gridCols: number; monitorColor: string; vendor: string }): void;  // gridCols を 8..15 に丸める
setDialect(id: DialectId): void;
openProblem(problem, options?): boolean;   // …plcFields(problem) ＋ isPlcProblem なら camera:'plc'
```

### 前提C: 実コードで確認した「4B が直さなければならない箇所」

| # | いまの実装 | なぜ4方言だと破れるか | 確認した場所 |
|---|---|---|---|
| 21 | `TOOLBAR_ACTIONS` は**位置**で `panels.toolbar` に対応する（0番目＝`convert`、…）。表に無い位置は `?? 'convert'` に倒れる | 三菱（8件）でしか合わない。OMRON（5件）では `オンライン編集` が `convert` に、JTEKT（9件）では `JP1` が `convert` になり、**「変換」を出さないはずのスキンで押すと変換が走る**（受入基準①が成立しない） | `LadderWorkspace.tsx` L38-62（`type ToolbarAction` と `TOOLBAR_ACTIONS`）, L195-198（`panels.toolbar.map()` と `?? 'convert'`） |
| 22 | `JA.ladder.notConverted = '未変換（F4 で変換します）'`、`readOnly = '書込みモード（F2）に…'`、`monitorOff = 'モニタ（F3）を開始すると…'`、`monitorWriteSame = 'Phase 3 ではモニタと同じ動作です'`、`JA.settings.gridColsHelp`（`GX Works3 の既定は 11 です`）、`monitorColorHelp`（`モニタ（F3）で…`） | キー文字列とツール名が**文言に直書き**されている。Plan 3B 決定表#12（キーは方言が決める）に反し、OMRON では出ない `F4` を案内してしまう | `i18n/ja.ts` L414（`readOnly`）, L419（`monitorWriteSame`）, L433（`notConverted`）, L472（`monitorOff`）, L113（`gridColsHelp`）, L116（`monitorColorHelp`） |
| 23 | `DeviceInput` の入力例は `` `${profile.deviceRanges.input.prefix}0` `` | OMRON とシャープの `prefix` は `''`（前提#6）なので、入力例が `0` と `2` になる。正しくは `0.00` / `000000` | `DeviceInput.tsx` L74-82（`hints`） |
| 24 | `store.monitorColor` の既定は `'#1E64FF'`（三菱の色）で、`LadderGrid` / `ProjectTree` は `monitorColor.length > 0 ? monitorColor : profile.monitorColors.powered` と書いてある | 既定値が空でないので**プロファイルの色が一度も使われない**。OMRON を選んでも通電色が青のまま（§10.6 の「色のみ各社に寄せる」が画面に出ない） | `store.ts` L621, `LadderGrid.tsx` L273-277, `ProjectTree.tsx` L24-25 |
| 25 | `IoTable` の `unit.spec.inputs[x]`（string）と `MonitorPanel` の `terminal(unit.spec.inputs[index])` は **4A Task 8 が `?.name` に直して landed している**（前提#20e） | 4B が足すのは**入力コモンの表示**（`spec.inputCommons` は機種で複数）だけである。ここを二重に直さない | `IoTable.tsx` L32, `MonitorPanel.tsx` L94、4A MERGE 注意 |
| 26 | `ladder.module.css` は背景 `#f7f8fa`・母線 `#3a3f47`・記号 `#1b1e23`・コメント `#1b6ac9`・カーソル `#1e64ff`・エラー `#d14343` を**直書き**し、`symbols.ts` は `CELL_W = 48` / `CELL_H = 36` / 線幅 1.6 / 接点の縦棒 8〜28px を**定数**で持つ | 4スキンが同じ配色・同じセル寸法・同じ記号になる。利用者要求（実物に忠実な回路入力画面）を満たせない | `ladder.module.css` L3-97、`symbols.ts` L11-21 |
| 27 | 画面にタイトルバーもステータスバーも無い。`LadderWorkspace` はツールバー → ツリー／編集／出力の3ペイン固定で、出力ウィンドウは常に**編集ペインの下**にある | JTEKT の `panels.output` は `ステータスバー` で（前提#4）、PCwin風は「下部にステータスバー」と §10.6 が定める。同じ枠のままでは4スキンが見分けられない | `LadderWorkspace.tsx` L188-314（`return (` から末尾まで。`workspaceBody` は L273-310） |
| 28 | `three/PlcUnit.tsx` は `BODY_COLOR = '#D8DBE0'` / `LED_D_MM` / `LED_LEFT_MM` / `LED_TOP_MM` / `BODY_Z_MM` を**直書き**し、LEDは `unit.leds`（名前の配列）を等間隔で並べ、色は常に `#5A6070` | CP1E（明灰）・FX5U（濃灰）・ラック（モジュール4枚）を描き分けられない。利用者要求と 4A 決定表#15（色と座標を 4B に直書きしない）に反する | `three/PlcUnit.tsx` L21-49（定数）, L104（`BODY_COLOR`）, L109-121（`unit.leds.map()` と `color="#5A6070"`） |
| 29 | `three/labels.ts` は **`FaceRect { cx; cy; w; h }`** を export している | 4A の `@ojt/board-model` も **`FaceRect { x; y; w; h }`** を export する。同じファイルで両方 import すると衝突する | `three/labels.ts` L128 |
| 30 | `camera.ts` の `PLC_VIEW_RECT` は IIFE の中で `PLC_UNIT_FX5U` を決め打ちし、`cameraPose(preset)` は引数を1つしか取らない。`e2e/projection.ts` も `PLC_BOARD = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U)` 決め打ち | ラック（幅 4×35+20 = 160mm・高さ140mm）は FX5U（150×90）より大きく縦に長いので、FX5U 基準の画角ではモジュールの下段の端子が切れる（受入基準③⑤の配線ができない） | `three/camera.ts` L118-144（`PLC_VIEW_RECT` の IIFE）, L200（`cameraPose(preset)`）, L241-255（`case 'plc'`）、`e2e/projection.ts` L134（`PLC_BOARD`）, L140-150（`plcBoardPoint`）, L151-159（`plcTerminalPoint`） |
| 31 | `Settings.tsx` は `IMPLEMENTED_DIALECT_IDS.includes(id)` で `<option disabled>` を決め、`JA.settings.vendorUnimplemented = 'Phase 4 で対応します'` を添える。メーカー名は **`JA.settings.vendorLabels`（`ja.ts` L122-127）に既に移設済み**で、`Settings.tsx` に `VENDOR_LABELS` という定数は**もう無い**。`main/settings.ts` も **`isDialectId()` ＋ `IMPLEMENTED_DIALECT_IDS`** で `defaultVendor` を検証しており、`AppSettings.defaultVendor` の型も既に `DialectId` である | 4A で `IMPLEMENTED_DIALECT_IDS` が4件になるので**選べるようになる仕組みは既にある**。残るのは ①注記の文言 ②メーカー名を `profile.displayName` から引くこと ③色・列数を「メーカーの既定に従う」にする入口 の3点だけで、**型の変更（`DialectId` 化）と `isDialectId()` の追加は既に済んでいる** | `Settings.tsx` L1-7（import）, L227-257（`<select>` と注記）, `main/settings.ts` L68-75 |
| 31b | `Settings.tsx` L76-84 は**保存のたびに** `applyLadderSettings({ …, vendor: saved.defaultVendor })` を呼び、これが `dialectId` を `defaultVendor` に上書きする。`AppSettings.defaultVendor` の型は既に `DialectId` である（`shared/ipc.ts` L174）ので、4B が直すのは**呼び出しの向き**だけである | Phase 4 では、作業ファイルから復元した方言（`setDialect()`）や表記切替（`switchDialect()`）で選んだ方言が、**セッションの途中で設定を1つ触っただけで既定メーカーに戻される**。既定メーカーは「**課題を開くときの初期値**」であって「いまのセッションの方言」ではない（§12.1 / 決定表#24） | `Settings.tsx` L80-95（`changesLadderSettings` → `applyLadderSettings()`）、`store.ts` L1106-1125、`shared/ipc.ts` L174 |
| 32 | `openProblem()` は課題の `plc` をそのまま使い、`dialectId` を触らない。内蔵モードD課題8題は全部 `{ vendor: 'mitsubishi', model: 'FX5U' }` | 既定メーカーを OMRON にしても開く課題は FX5U のままで CX-Programmer風にならない（受入基準①）。TOYOPUC / JW300 のラックも一度も画面に出ない（受入基準③⑤） | `store.ts` L660-795（`openProblem()`）、`packages/content/src/builtin/plc/d-00*.json` |
| 33 | IPCチャネルは6本で、§4.3 が「6本のみ」と明記。`preload/index.ts` も6本だけを `window.ojt` に出す。`main/work-files.ts` が `dialog.showSaveDialog()` を持つ | 命令語リストの保存には**保存ダイアログ**が要る（§10.7「ファイル出力先は利用者が選ぶ」）。renderer からはダイアログを開けない | `src/shared/ipc.ts` L10-18、`src/main/ipc.ts`、`src/main/work-files.ts` L225-232（`showSave()`） |
| 34 | `PlcSession.tsx` の手順表は `wire` / `ladder` / `convert` / `run` / `judge` の5段固定 | `convertStep: false` のスキンには「変換」という手順が無い（§10.6）。5段のままだと、押すボタンが無い手順が「いまここ」で止まる | `PlcSession.tsx` L463-487（`steps` の5段） |
| 35 | テストの流儀: `test/setup.ts` が `@testing-library/jest-dom/vitest` を読むだけ。各 UI テストは自前で `afterEach(() => { cleanup(); })` を書き（`globals: false` なので自動クリーンアップは効かない）、ストアへの書き込みは `act()` で包み、`data-testid` で引く | 新しいテストも同じ流儀で書く | `test/setup.ts`、`test/ladder-workspace.test.tsx` L14-16 |
| 36 | 着手時のベースライン（2026-09-19 に実測）: `apps/desktop/test` は **84ファイル**、E2E は **23本**（`chart` 2 / `inspect` 8 / `navigation` 5 / `plc` 4 / `polish` 3 / `smoke` 1）。テスト件数は**着手時に `pnpm --filter @ojt/desktop test --no-file-parallelism` で測り直す**（他のエージェントが並行して足していることがある） | 完了条件の数合わせに使う | `ls apps/desktop/test`、`grep -c "^  test(" apps/desktop/e2e/*.spec.ts` |
| 37 | `ladder.module.css` は**原則として末尾へ追記のみ**（クラス名を接頭辞で分ける）。`i18n/ja.ts` は挿入のたびにファイルを読み直す | Plan 3B MERGE 注意 #1・#13 | Plan 3B |
| 37b | **本プランが唯一認める既存行の書き換え**は Task 2 Step 6 の表に挙げた**12宣言**（`.gridScroll` の `background`、`.rail` の `fill`、`.wire, .symbol` の `stroke-width`、`.symbolText, .deviceText` の `fill`、`.presetText` の `fill`、`.commentText` の `fill`、`.cursor` の `stroke`、`.errorCell` の `stroke`、`.networkComment` の `color`、`.toolbar` の `background`、`.output` の `background`、`.tree` の `width`）だけである。いずれも `#f7f8fa` → `var(--skin-canvas, #f7f8fa)` のように**既定値へ現在の値をそのまま入れる**書き換えで、変数を流し込まない場所（既存テスト・他の画面）では**1pxも1色も変わらない**。セレクタの追加・削除・並べ替えはしない | 決定表#5 が「CSS Modules のクラスを方言ごとに4組書かない」と決めた以上、既存の宣言を変数読みにしないと4スキンが効かない（追記だけでは既存の宣言に勝てず、`!important` を撒くことになる） | 本プラン Task 2 Step 6 |

**この計画が前提として置いた設計値（§17.1 の前提方針で採用。実機と異なると分かったら「修正箇所」の1ファイルだけを差し替える）:**

| 値 | 採用値 | 区分 | 修正箇所（1ファイル） |
|---|---|---|---|
| 各スキンのツールバー項目が押したときの意味 | `TOOLBAR_ACTIONS_BY_DIALECT`（方言ID → `ToolbarAction[]`。`panels.toolbar` と**同じ長さ**） | 本アプリ独自（§10.6 は項目名までしか定めない） | `src/renderer/session/plc-skin.ts` |
| PCwin風の `JP1` / `DGR` / `MOB` / `RDY` | **本アプリでは動作しない**（押すと理由を出す `vendor-only`）。`STP` = 停止、`RUN` = 運転、`RES` = デバイス初期化 | 本アプリ独自（PLC調査資料 J-10 未確認） | 同上 |
| 4スキンの**画面の見た目**（配色・セル寸法・記号の描き方・ペインの並び・タイトルバー・ステータスバー） | `SkinTheme`（下の「実物との対応」表が全項目と値） | **すべて本アプリの記述**（一次資料＝画面キャプチャは複製しない。§17.1 / PLC調査資料 §6） | `src/renderer/ladder/skins/*.ts` |
| 3DのLEDが何を映すか | 本体表示 `POWER`/`PWR` は**セッション中は常時点灯**、`RUN`/`P.RUN` は `plcRunning`、`ERR`/`FLT` は直前の変換が失敗したとき、入出力表示灯は**モニタ中だけ** `SimSnapshot.plc.inputs` / `.outputs` | 本アプリ独自 | `src/renderer/three/appearance.ts` の `ledLit()` |
| 3Dの筐体の厚み | `appearance` は正面（2D）しか持たないので、奥行きは `PLC_BODY_Z_MM`（6mm）／ラックのモジュールは `RACK_BODY_Z_MM`（8mm）の薄い台として描く（Plan 3B 意図的な差分 #1 を踏襲） | 本アプリ独自 | `src/renderer/three/appearance.ts` |
| 命令語リストの保存チャネル | IPC 7本目 `file:saveText` を足す。renderer は文字列と既定ファイル名を渡すだけ | 本アプリ独自（§4.3 の「6本のみ」からの意図的な差分 #1） | `src/shared/ipc.ts` |
| 通電色・表示列数の「メーカー既定」 | `AppSettings.monitorColor` が**空文字**、`ladderGridCols` が **0** のとき「方言の既定に従う」。既定値をこの2つにする | 本アプリ独自（§10.6 は「利用者も変更できる」とだけ定める） | `src/shared/ipc.ts` の `DEFAULT_SETTINGS` |
| 課題の機種と既定メーカーの関係 | セッションを開くとき、課題の `plc` を**既定メーカーの `{vendor, model}` に差し替えて**開く（内蔵8題はJSON無改変のまま4機種で成立する。4A 決定表#14・Task 14） | 本アプリ独自 | `src/renderer/session/plc-skin.ts` の `plcForVendor()` |

---

## 実物との対応（利用者要求「可能な限り実物に忠実な画面」に対する回答表）

**◎ = §10.6 が定める確定事項** ／ **△ = 一次資料（画面キャプチャ・純正マニュアル）が未確認のため §17.1 の前提方針で採用した本アプリの記述**。△ は「未決定」ではなく「実機と異なると判明するまでこの値で実装する」決定である。**画面キャプチャ・ロゴ・アイコン・図記号ビットマップ・純正の配色データは一切使っていない。** 値はすべて `src/renderer/ladder/skins/*.ts` の1箇所にあり、判明したらそこだけを差し替える。

| 画面の要素 | GX Works3風（三菱） | CX-Programmer風（OMRON） | PCwin風（JTEKT） | JW-300SP風（シャープ） | 区分 |
|---|---|---|---|---|---|
| タイトルバーの文字 | `MELSOFT GX Works3 風` | `CX-Programmer 風` | `PCwin 風` | `JW-300SP 風` | △（「風」を必ず残す。商標注記を併記。§15 / §17.1） |
| パネル名称 | `ナビゲーションウィンドウ（プロジェクトツリー）` / `ラダーエディタ` / `出力ウィンドウ` | `プロジェクトツリー` / `ラダー編集` / `出力ウィンドウ` | `プロジェクトツリー（プログラム／データファイル／パラメータ／LD／SFC）` / `ラダー編集エリア` / `ステータスバー` | `プロジェクトツリー` / `ラダー編集` / `出力ウィンドウ` | ◎（`profile.panels`。4A が持つ） |
| ツールバーの項目名 | 変換／全変換／書込みモード／読出しモード／オンライン／シーケンサへの書込み／モニタ開始／モニタ停止 | オンライン編集／転送［PC → PLC］／モニタ開始／モニタ停止／運転／停止 | JP1／DGR／MOB／STP／RDY／RUN／RES／モニタ開始／モニタ停止 | 変換／PLCへの書込み／運転／停止／モニタ開始／モニタ停止 | ◎（`profile.panels.toolbar`） |
| 「変換」操作 | 要（`F4`） | 不要（編集で即反映） | 不要（スクリーンエディタ方式） | 要 | ◎（`profile.convertStep`） |
| ツリーの幅（位置は4スキンとも**左**。`SkinLayout` に `tree` の欄は持たない） | 140px（UX 判断） | 140px（UX 判断） | 140px（UX 判断） | 140px（UX 判断） | UX判断（`仕様からの意図的な差分` #12。レビュー I4） |
| 出力ペインの形 | 編集ペインの下の**出力ウィンドウ**（高さ 160px） | 編集ペインの下の**出力ウィンドウ**（高さ 140px） | 画面最下部の**ステータスバー**（高さ 28px・1行）＋折りたたみの詳細 | 編集ペインの下の**出力ウィンドウ**（高さ 150px） | ◎（名称は §10.6）／△（高さ） |
| ステータスバーの項目 | モード／回路ブロック／上書き・挿入 | モード／PLC状態／スキャン時間 | モード／PLC状態／スキャン時間／デバイス点数（LD追っかけモニタの想定） | モード／回路ブロック／PLC状態 | △ |
| 編集領域の背景 | `#F7F8FA`（淡灰） | `#FFFFFF`（白） | `#EDEFF2`（灰） | `#F2F5F7`（淡青灰） | △ |
| 格子線 | 無し（罫線のみ） | 薄い格子 `#E3E8EE` | 薄い格子 `#DCE0E6` | 無し | △ |
| 左母線の色 | `#3A3F47` | `#1F1F1F` | `#333A42` | `#2C3E50` | △ |
| 記号の線色 | `#1B1E23` | `#000000` | `#12212E` | `#102A3C` | △ |
| 記号の線幅 | 1.6px | 1.4px | 1.8px | 1.6px | △ |
| セルの大きさ | 48 × 36px | 52 × 40px | 46 × 34px | 50 × 38px | △ |
| 接点の描き方 | 縦棒2本（上下に余白 8px）。b接点は右上がりの斜線 | 縦棒2本（上下の余白 10px・やや細長）。b接点は斜線 | 縦棒2本（上下の余白 7px・太め） | 縦棒2本（上下の余白 8px） | △（線画は JIS C 0617 に沿った自前の作図） |
| コイルの描き方 | 左右の半円（`( )`。`coilRxPx` 9） | 左右の半円（やや扁平。`coilRxPx` 7） | 左右の半円（`coilRxPx` 9） | 左右の半円（`coilRxPx` 9） | △（横の膨らみ＝`SkinCell.coilRxPx`。縦は接点と同じ `barInsetPx` から決まる） |
| デバイス名の位置 | 記号の**上** | 記号の**上** | 記号の**上** | 記号の**上** | △ |
| デバイスコメントの位置・行数 | 記号の**下**に1行（`#1B6AC9`） | 記号の**下**に2行（`#0B6E4F`） | 記号の**下**に1行（`#8A5A00`） | 記号の**下**に1行（`#00647A`） | △ |
| カーソル（選択セル） | 青の実線枠 `#1E64FF` | 緑の実線枠 `#2FA02C` | 橙の実線枠 `#E08A1E` | 水色の実線枠 `#00A0C8` | △（方言の `monitorColors.powered` と揃える） |
| 選択中の回路ブロック | ツリーの項目に同色の下線 | 同左 | 同左 | 同左 | △ |
| 通電表示色（モニタ中） | 青 `#1E64FF` | 緑 `#2FA02C` | 橙 `#E08A1E` | 水色 `#00A0C8` | ◎（§10.6 の本アプリ既定） |
| 接点の表示列数 | 11 | 11 | 11 | 11 | ◎（§10.6。利用者は 8〜15 で変更可） |
| キー割当 | `F5`/`F6`/`F7`/`F9`/`F4`… | `C`/`/`/`O`/`I`/`Ctrl+E`… | GX Works3風と同一 | GX Works3風と同一 | ◎（`profile.shortcuts`。`confirmed:false` は表に注記が出る） |
| ロゴ・アイコン・画面キャプチャ | **持たない**（汎用の文字ボタンのみ） | 同左 | 同左 | 同左 | ◎（§17 / PLC調査資料 §6） |

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `apps/desktop/src/renderer/session/plc-skin.ts` | **新規**: 方言ごとの**振る舞い**。ツールバーの項目 → 操作の対応表、`convertStep` による手順の畳み込み、通電色／表示列数の「メーカー既定」解決、メーカー → 課題の `plc`。§10.6（Task 1） |
| `apps/desktop/src/renderer/ladder/skins/types.ts` | **新規**: `SkinTheme` の型と CSS 変数への変換（Task 2） |
| `apps/desktop/src/renderer/ladder/skins/{mitsubishi,omron,jtekt,sharp}.ts` | **新規**: 4スキンの**見た目**（上の「実物との対応」表の値）。§10.6 / §17.1（Task 2） |
| `apps/desktop/src/renderer/ladder/skins/index.ts` | **新規**: `skinThemeOf(profile)` と一覧（Task 2） |
| `apps/desktop/src/renderer/ladder/SkinFrame.tsx` | **新規**: タイトルバー＋ステータスバー（スキンの枠）（Task 3） |
| `apps/desktop/src/renderer/ladder/LadderWorkspace.tsx` | **変更**: ツールバーをスキンから引く、`convertStep: false` の自動変換、CSS変数の適用、枠の差し込み、表記切替・命令語リストのボタン（Task 3 / 8 / 9） |
| `apps/desktop/src/renderer/ladder/LadderGrid.tsx` | **変更**: セル寸法・色・コメント行数をテーマから引く（Task 4） |
| `apps/desktop/src/renderer/ladder/symbols.ts` | **変更（追記のみ）**: `symbolMetrics(cell)` とスキン別のセル寸法。既存の `CELL_W` / `CELL_H` / `symbolShape()` / `LEAD_*` / `LINK_DOWN` / `END_MARK` / `leadAcrossHidden()` は**署名も値も変えない**（Task 4） |
| `apps/desktop/src/renderer/ladder/ladder.module.css` | **変更（末尾追記のみ）**: 色・寸法を `var(--skin-*)` に寄せる、`.titleBar` / `.statusBar` / `.vendorTool` / `.notation*`（Task 2 / 3 / 4 / 8） |
| `apps/desktop/src/renderer/ladder/LadderEditor.tsx` | **変更**: `skinThemeOf(profile)` を `LadderGrid` へ渡す（Task 4） |
| `apps/desktop/src/renderer/ladder/OutputWindow.tsx` | **変更**: `convertKey`（Task 3）、命令語リストの書き出しボタンと指摘欄（Task 9） |
| `apps/desktop/src/renderer/ladder/MonitorPanel.tsx` | **変更（1行）**: `JA.ladder.monitorOff` が関数になることへの追随（Task 3）。端子名（`spec.inputs[x].name`）は **4A Task 8 が直す**（前提#20e） |
| `apps/desktop/src/renderer/ladder/DeviceInput.tsx` | **変更**: 入力例を `formatDevice()` / `counterPresetText()` から引く（Task 5） |
| `apps/desktop/src/renderer/ladder/ShortcutHelp.tsx` | **変更**: 「変換」が無いスキンの注記（Task 5） |
| `apps/desktop/src/renderer/ladder/IoTable.tsx` | **変更**: 入力コモンの表示（Task 5） |
| `apps/desktop/src/renderer/ladder/NotationDialog.tsx` | **新規**: 表記切替ダイアログ（§10.7）（Task 8） |
| `apps/desktop/src/renderer/screens/Settings.tsx` | **変更**: 4メーカーを選べるようにし、「メーカーの既定に従う」を足す（Task 6） |
| `apps/desktop/src/renderer/screens/PlcSession.tsx` | **変更**: 手順表を `convertStep` で畳む、機種名の表示、カメラへ機種を渡す（Task 3 / 7 / 12） |
| `apps/desktop/src/renderer/app/store.ts` | **変更**: `applyLadderSettings` の「既定に従う」対応、`openProblem()` の機種差し替え、`restartSession()` の `{ vendor }`、`switchDialect()`（Task 6 / 7 / 8） |
| `apps/desktop/src/renderer/session/work-file.ts` | **変更（1箇所）**: モードDの復元で保存された方言を `openProblem()` へ渡す（Task 7） |
| `apps/desktop/src/renderer/three/appearance.ts` | **新規**: `PlcAppearance` の正面座標（mm・左上原点）→ 盤モデル座標の純関数と LED の点灯判定（Task 10） |
| `apps/desktop/src/renderer/three/PlcUnit.tsx` | **変更**: `appearance` から筐体・カバー・LED・銘板・造作を描く汎用部品にする（Task 10） |
| `apps/desktop/src/renderer/three/PlcRack.tsx` | **新規**: ラック形（ベース＋モジュール4枚）の3D（Task 11） |
| `apps/desktop/src/renderer/three/BoardScene.tsx` | **変更**: `unit.form` で `PlcUnit` / `PlcRack` を選ぶ（Task 11） |
| `apps/desktop/src/renderer/three/camera.ts` / `CameraPresets.tsx` / `navigation.ts` | **変更**: `plcViewRect(unit)` と `cameraPose(preset, options?)`（Task 12） |
| `apps/desktop/src/shared/ipc.ts` | **変更**: `DEFAULT_SETTINGS` の既定（Task 6）、`textfileSave` チャネルと型（Task 9） |
| `apps/desktop/src/shared/messages.ts` / `src/main/text-files.ts` / `src/main/ipc.ts` / `src/preload/index.ts` | **変更・新規**: 命令語リストの保存（Task 9） |
| `apps/desktop/src/main/settings.ts` | **変更**: 空の通電色と 0 の表示列数を受ける（Task 6） |
| `apps/desktop/src/renderer/i18n/ja.ts` | **変更**: 文言一式（Task 3〜11。**MERGE 注意 #1**） |
| `apps/desktop/e2e/projection.ts` | **変更（追記のみ）**: 機種を取る射影（Task 12 / 13） |
| `apps/desktop/e2e/plc-vendors.spec.ts` | **新規**: §16 Phase 4 受入基準①〜⑥＋機種別スクリーンショット（Task 13） |
| `apps/desktop/test/*.test.ts(x)` | 各タスクのテスト。**新規9ファイル**（`plc-skin` / `skin-theme` / `skin-workspace` / `skin-grid` / `notation-dialog` / `instruction-list-export` / `text-files` / `plc-appearance-view` / `plc-rack-view`）＋既存テストの追随（約20ファイル） |

---

## 設計判断（レビューで確認する決定表）

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| 1 | **方言ごとに変わる値の持ち主** | 振る舞いは `session/plc-skin.ts`、見た目は `ladder/skins/*.ts` の **2ファイルだけ**。画面部品と CSS に `'F4'` / `'#1E64FF'` / `48px` を書かない | §17.1 の「修正箇所はスキン定義／盤モデルのみ」を画面側でも守る。振る舞いと見た目を分けるのは、前者が Node で単体テストでき（`happy-dom` 不要）、後者が CSS 変数として DOM に出る値だからである。`DialectProfile` に足す案は 4A の所有物を触ることになるので却下 |
| 2 | **ツールバーの項目 → 操作の対応** | 方言IDをキーにした表（`TOOLBAR_ACTIONS_BY_DIALECT`）で、`panels.toolbar` と**同じ長さの配列**を持つ。長さが合うことをテストで縛る | 位置で対応させる現在の実装（前提#21）は三菱でしか合わず、OMRON では「変換」ボタンが出てしまう（受入基準①が落ちる）。ラベル文字列で引く案は、同じ意味のボタンが `変換` / `PLCへの書込み` / `転送［PC → PLC］` と方言ごとに違う以上ただの言い換え表になり、`panels` の文言を変えた瞬間に黙って壊れる |
| 3 | **`convertStep: false` のとき何が起きるか** | ①ツールバーに「変換」を出さない ②キー割当表から「変換」の行が落ちている（4A の `withoutConvert()`）③**ラダーが変わるたびに自動で変換を走らせる**。失敗しても**トーストは出さず**出力ウィンドウだけを更新する ④手順表から「変換」の段を落とす ⑤ステータスバーに「自動変換」と出す | §10.6 の「`false` なら『PLC書込』→『RUN/STOP』→『モニタ開始』」。4A H-3 が「判定前に `convert()` は必ず走らせる」と定めているので、押す場所が無い以上どこかで自動的に走らせるしかない。編集のたびにトーストを出すと1文字打つたびに「変換できませんでした」が並ぶ（出力ウィンドウが結果の置き場所だと §10.6 が定めている） |
| 4 | **PCwin風の動かないボタン** | `ToolbarAction` に `'vendor-only'` を足し、押すと「このボタンは実機の操作パネルの項目で、本アプリでは動作しません」を出す。ボタンは淡色（`.vendorTool`） | 消すと §10.6 が定める PCwin風の画面構成（`JP1` `DGR` `MOB` `STP` `RDY` `RUN` `RES`）が再現できない。押して黙っていると壊れているように見える。キー割当表の `enabled: false` と同じ扱い（Phase 3 の `F8` で確立した流儀）に揃える |
| 5 | **スキンの見た目をどう持つか** | `SkinTheme`（`colors` / `cell` / `layout` / `statusItems` / `commentLines` / `titleBar` / `assumed`）というデータにし、`colors` と `cell` は**CSS カスタムプロパティ（`--skin-*`）として `.workspace` に流し込む**。CSS Modules 側は `var(--skin-canvas, #f7f8fa)` のように既定値つきで読む | CSS Modules のクラスを方言ごとに4組書くと、1つ直すたびに4箇所直すことになり、「実物と違うと分かったら1ファイル」（§17.1）を守れない。インラインスタイルで全要素に色を撒く案は、`LadderGrid` が `memo` で再描画を抑えている設計（3B 決定表#5）を壊す（毎レンダーで新しい `style` オブジェクトが要素数ぶん生まれる）。CSS変数なら**親に1回**書けば済み、子の `memo` は効いたままになる |
| 6 | **セル寸法と記号の描き方** | `symbols.ts` の既存 export（`CELL_W` / `CELL_H` / `WIRE_Y` / `symbolShape(id)` / `LEAD_*` / `LINK_DOWN` / `END_MARK` / `leadAcrossHidden(lastContactIndex, row)`）は**署名も値も一切変えず**、その下に **`symbolMetrics(cell: SkinCell)` を1本足す**。スキンで変わるのは `SkinCell` の5つの数（`widthPx` / `heightPx` / `strokeWidth` / `barInsetPx` / `coilRxPx`）だけで、**`SkinSymbolStyle` のような種別の列挙は持たない** | 記号そのもの（接点2本の縦棒・コイルの丸括弧）は JIS C 0617 に沿った共通の描き方で、メーカーで変わるのは寸法と線の太さの印象である。形ごと分けると、4通りの SVG パスを持つことになり、どれも一次資料の裏づけが無い（△を増やすだけ）。**`'gx' \| 'cx' \| 'pcwin' \| 'jw'` という列挙を持つ案は却下した**: 値が `SkinCell`（寸法）と `symbolStyle`（種別）の2箇所に割れ、`symbolMetrics()` の引数が2つになってメモ化のキーも2つになる。コイルの扁平率は数（`coilRxPx`）なので `SkinCell` に1つ足せば足り、「実物との対応」表の『やや扁平』も実装される。既存の定数を消さないのは、`LadderGrid` 以外（`ladder-grid.test.tsx` のレイアウト計算・`ladder-symbols.test.ts`）が参照しているため |
| 7 | **タイトルバーとステータスバー** | `SkinFrame.tsx` が `title`（`<スキン名> 風` ＋ 商標注記のツールチップ）と `statusItems` を描く。ステータスバーの項目は `SkinTheme.statusItems`（`'mode'` / `'plc-state'` / `'scan'` / `'network'` / `'overwrite'` / `'device-count'`）で選ぶ | 前提#27。4スキンを「見て」区別できるようにする最短の要素で、しかも中身（モード・スキャン時間・回路ブロック名）は**すでにストアにある**ので新しい状態が要らない。ウィンドウ枠そのものを模す（偽の最小化ボタンを描く等）案は、押せない飾りが増えて §12.1 の「分かりやすく」に反するので却下 |
| 8 | **通電色・表示列数の「メーカー既定」** | `AppSettings.monitorColor` の**空文字**＝「スキンの既定色」、`ladderGridCols` の **0**＝「スキンの既定列数」とし、**これを既定値にする**。`sanitizePatch()` は `''` と `#rrggbb` の両方を受け、「既定に戻す」は `''` / `0` を書く。設定画面の色見本は空のとき**いま選んでいるスキンの色**を見せる。**既存の設定ファイルで値が旧既定（`'#1E64FF'`）と一致するものは、読込（`loadSettings()`）のときに一度だけ `''` へ移行し、`monitorColorMigrated: true` を設定ファイルに残して二度と走らせない**（保存の経路でも通る `sanitizePatch()` には置かない。置くと、移行後に利用者が改めて選び直した `#1E64FF` まで毎回消してしまう） | 前提#24 のとおり、既定が `'#1E64FF'` のままだと `LadderGrid.tsx` L274 の「空ならプロファイルの色」という分岐が**一度も通らない死んだ枝**で、OMRON（`#2FA02C`）・JTEKT（`#E08A1E`）・シャープ（`#00A0C8`）のどれを選んでも通電色が三菱の青のままになる（§10.6 の「色のみ各社に寄せる」が画面に出ない）。移行を equality だけで判定するので、**三菱の青を意図して選んでいた利用者も1度だけ「スキンの既定」に戻る**——代償は「色が1回だけ変わる」ことだけで、色は設定画面からいつでも選び直せる（印が残っているので、選び直した青は二度と消えない）。`monitorColorAuto` のような真偽値を足す案は設定の項目が2倍になり、既にある分岐を無駄にする。「上書きする」に切り替えたときの初期色は **`#1E64FF` の直書きではなく、いま選んでいるメーカーの `monitorColors.powered`** にする（`DEFAULT_MONITOR_COLOR` という定数は作らない。作ると「メーカーの既定に従う」を外した瞬間に OMRON の利用者へ三菱の青が入る） |
| 9 | **既定メーカーと課題の機種の関係** | セッションを開くとき、課題の `plc` を**既定メーカーの `{vendor, model}` へ差し替える**（`plcForVendor()`）。差し替えた課題がそのまま盤・Worker・判定・作業ファイルへ流れる | 受入基準①③⑤は「設定を変えると画面が変わる」ことを求めるが、内蔵8題は全部 `mitsubishi` / `FX5U` である（前提#32）。4A 決定表#14 が「JSONは変えず `plc` だけ差し替えて4機種で成立することを確かめる」と決めているので、アプリも同じ差し替えをするのが一貫している。画面（スキン）だけ替えて機種を据え置く案は、ラダーが `0.00` なのに3Dの端子が `X0`、ラックが一度も出ない、という食い違いを生む |
| 10 | **差し替えられない課題** | 差し替えた機種に割付が収まらないときは**元の課題のまま開き**、理由をトーストに出す（`plcForVendor()` が `undefined`） | CP1E は出力が12点しかない（4A 前提#23）ので、`y: 12` 以降を使う利用者課題は CP1E で開けない。黙って点を落とすと模範配線と食い違う |
| 11 | **表記切替はIRを書き換えない** | ダイアログで選ぶと `setDialect(next)` を呼ぶだけ。`switchNotation()` の `changes` は一覧として見せ、`errors` は**出力ウィンドウの「機種エラー」行として**出す。取り消しスタック（`ladderHistory`）は触らない | 4A H-2。IRはベンダー中立なので変換は要らない。`errors` を専用の場所に出すと、同じ指摘が画面に2箇所できる |
| 12 | **表記切替で機種（3D）も変わるか** | **変わる**。方言を切り替えると `plcForVendor()` で課題の機種も差し替え、盤・Worker・カメラを作り直す。**配線は一度全部外れる**ので、ダイアログに明記して確認を取る。**ラダーとデバイスコメントは持ち越す** | 機種が変わると端子名が変わる（`X0` → `0.00` → `A0`）。配線を残すと盤に無い端子を指す電線が残り `validateBoard()` が落ちる。§10.7 は「同じIRを別スキンで表示する」としか書いていないので、ラダーだけ持ち越すのが素直 |
| 13 | **命令語リストの保存口** | IPC を**7本目**（`file:saveText`）だけ足す。main が保存ダイアログ→UTF-8 書き出しまでやり、renderer は `{ defaultFileName, text }` を渡すだけ | §10.7 が「ファイル出力先は利用者が選ぶ」と定める以上 `dialog.showSaveDialog()` が要る＝main の仕事である。`workfile:save` に相乗りさせる案は作業ファイルの検証（`parseWorkFile`・上限・`.ojtw`）を通ることになり型も拡張子も合わない。`a[download]` は Electron の `file://` では保存先を選べない |
| 14 | **命令語リストを出す場所** | 出力ウィンドウのヘッダに1つ（`data-testid="export-il"`）。どのスキンでも出す | §10.7 はスキン別の扱いを定めていない。ツールバーへ入れると `panels.toolbar` の項目数と対応表（決定表#2）が崩れる。出力ウィンドウは「変換の結果」を見る場所なので、`not-series-parallel` の指摘もそこに並ぶ |
| 15 | **3Dの外観の描き方** | `PlcAppearance` の矩形（正面・左上原点・mm）を `appearance.ts` の純関数で盤モデル座標へ直し、`UNIT_BOX`（筐体・カバー・造作）と `circleGeometry`（LED）で描く。**色はすべて `appearance` から**、`three/**` に hex を書かない | 4A 決定表#15。純関数に切り出す理由は、three を読み込めない環境（`happy-dom`）でも座標と点灯判定をテストできるようにするため（Phase 3 の `camera.ts` / `labels.ts` と同じ流儀） |
| 16 | **端子の印字とカバーの重なり** | 端子の印字テクスチャ（`blockFaceTexture()`）は**カバーより手前**に置き、カバーは筐体の上・印字の下に描く。カバーは「開いた状態」として描く | 実機のヒンジ式カバーは閉じると端子が隠れる。3Dで閉じたまま描くと配線操作（§8.2）ができない。`hinge` は**どの辺から開くか**の記述として持ち、板を面の外側へ倒した位置に描く |
| 17 | **ラックの3Dの構造** | `PlcRack.tsx` が「ベース1枚（`unit.appearance`）＋ `unit.modules` のモジュール」を描く。**端子とその印字は `PlcRack` が1回だけ描く**（`unit.terminals` は平らな1本の配列。4A H-6） | 端子をモジュールごとに配り直すと、どのモジュールに属するかを `pos` の包含で判定することになり、印字テクスチャも4枚に割れる。ピックの対象を `unit.terminals` のままにしておけば `BoardScene` の既存の配線操作がそのまま動く |
| 18 | **カメラの画角** | `PLC_VIEW_RECT` を `plcViewRect(unit)` に変え、`cameraPose(preset, options?: { plcUnit })` の第2引数で機種を渡す。**引数を省いたときは FX5U**（既存の呼び出しと landed テストを壊さない） | ラックは 160×140mm で FX5U（150×90）より縦に 50mm 大きい（前提#30）。`cameraPose` の引数を必須にすると `navigation.ts` / `CameraPresets.tsx` / 既存テスト16箇所すべてを書き換えることになる |
| 19 | **`FaceRect` の名前の衝突** | `three/**` では board-model 側を **`import type { FaceRect as AppearanceRect }`** で読む。`labels.ts` の `FaceRect` は**改名しない** | 前提#29。`labels.ts` の `FaceRect`（`{cx,cy,w,h}`）は `TerminalBlock` / `MountedPart` / `PlcUnit` が使っており、改名は無関係な3部品に波及する。別名は `three/appearance.ts` の1箇所だけで付ける |
| 20 | **LEDが映すもの** | 本体表示（`status`）は `POWER`/`PWR` = 常時点灯、`RUN`/`P.RUN` = `plcRunning`、`ERR`/`FLT` = 直前の変換が失敗、それ以外は消灯。入出力表示灯は**モニタ中だけ** `plcMonitor.inputs[i]` / `.outputs[i]` | 本アプリのPLCはAC電源を電気的に解かない（3A 決定表#3）ので、`POWER` を配線の有無で点けると `plcPowerIndependent` の判定結果を漏らす（3B 決定表#7 の禁止事項）。入出力は `SimSnapshot.plc` がモニタ中しか載らない（3B 決定表#5）ので、モニタ外は消灯にして画面にその旨を出す |
| 21 | **E2Eの機種切替** | 設定画面の既定メーカーを変えてから課題を開く（＝利用者と同じ道筋）。`plc-vendors.spec.ts` は**各テストの最後に三菱へ戻す**（設定は `userData` に永続化されるので、戻さないと既存の `plc.spec.ts` が落ちる） | 受入基準①が「設定で既定メーカーをOMRONにすると」と書いている。作業ファイルや起動フラグで注入する案は、その道筋自体が受入基準だから使えない |
| 22 | **既存の `plc.spec.ts` は触らない** | 4本の既存E2Eはそのまま（三菱の道筋）。Phase 4 の6基準は新しい `plc-vendors.spec.ts` に書く。`projection.ts` は**追記のみ** | 既存4本は Phase 3 の受入基準の証拠なので、消すと「まだ通ることを誰も確かめていない」状態になる（MERGE 注意 #11・Plan 3B と同じ） |
| 23 | **スクリーンショット** | `plc-vendors.spec.ts` が `40-mitsubishi-skin` / `41-omron-skin` / `42-jtekt-skin` / `43-sharp-skin` / `44-jtekt-rack` / `45-sharp-rack` / `46-notation-dialog` / `47-instruction-list` の8枚を撮る。`screenshots/` は `.gitignore` 済みなので**コミットしない** | 利用者の「見えるものは見せる」方針。4スキンを1枚ずつ撮るのは、利用者が「実物に近いか」を確かめる唯一の手段だからである |
| 24 | **既定メーカーはいつ効くか** | `AppSettings.defaultVendor` は**課題を開くときの初期値**であって「いまのセッションの方言」ではない。`applyLadderSettings()` はストアの **`defaultVendor`** だけを更新し、**`dialectId` には触らない**。`dialectId` を決めるのは `openProblem(problem, { vendor })` の1箇所で、`vendor` を省くと `defaultVendor` を使う。作業ファイルの復元は保存されていた方言を `vendor` に渡す。型は `AppSettings.defaultVendor: DialectId`（`string` をやめる） | 前提#31b。いまの実装は**保存のたび**に `dialectId` を `defaultVendor` へ戻すので、Phase 4 では「作業ファイルから OMRON で復元 → 音量を1つ動かす → ラダーが三菱表記に戻る」「表記切替で JTEKT にした直後に設定を触ると三菱へ戻る」が起きる。`openProblem` の1箇所に寄せれば、方言の持ち主（セッション）と既定の持ち主（設定）が分かれ、`switchDialect()`（決定表#12）とも衝突しない。`DialectId` に型を狭めると、`isDialectId()` の判定漏れを `tsc` が捕まえる |

---

## 実装バッチ（推奨）

依存関係にもとづく4バッチ。バッチ内の `/` 区切りは並行可、`→` は直列。**並行の上限は2系統**（`i18n/ja.ts` の追記が衝突するため。MERGE 注意 #1）。

| バッチ | タスク | 対象 | モデル | 依存 |
|---|---|---|---|---|
| A | 1 → 2 → 3 → 4 → 5 ／ 10 → 11 → 12 | スキン層とラダー画面（`ladder/**`・`ja.ts`・`ladder.module.css` を直列で触る） ／ 3Dの外観・ラック・カメラ | 1=**Opus** / 2=**Opus** / 3=**Opus** / 4=**Opus** / 5=Sonnet ／ 10=**Opus** / 11=**Opus** / 12=Sonnet | 4A 完了 |
| B | 6 → 7 | 設定（`shared/ipc.ts` ＋ `main/settings.ts`） → 課題を既定メーカーの機種で開く（`store.ts`） | 6=**Opus** / 7=**Opus** | A |
| C | 8 → 9 | 表記切替ダイアログ → 命令語リストの保存（`shared/ipc.ts` を 6 の後に触る） | 8=**Opus** / 9=**Opus** | A・B |
| D | 13 → 14 | E2E・スクリーンショット → 全体検証 | 13=**Opus** / 14=Sonnet | A〜C すべて |

進め方: **A（2系統を並行）** → **B** → **C** → **D**。各バッチの終わりに **Opus レビューを1回**かける（レビュー方針: グループごとに1回、細かい指摘はまとめて修正）。

「Sonnet-verbatim」と書いたタスクは、本書のコードとテストをそのまま書き写せば通る。**Opus** と書いたのは判断の要るタスク（対応表の設計、自動変換の入れ方、CSS変数の流し込み、`store.ts` / `shared/ipc.ts` の MERGE、3Dの座標、E2Eの待ち方）である。**どのタスクも、後のタスクが作るファイルを import しない。**

---

## Task 1: スキン層の土台（`session/plc-skin.ts`）

**モデル: Opus**（ツールバーの対応表とメーカー→機種の規則を決める判断があるため）

**Files:**
- Create: `apps/desktop/src/renderer/session/plc-skin.ts`
- Test: `apps/desktop/test/plc-skin.test.ts`（新規）

方言ごとの**振る舞い**を1ファイルに集める（決定表#1）。**React も three も CSS も import しない純粋層**なので Node でも読める。`i18n/ja.ts` にも触らない。

| 決めること | 本タスクの実装 |
|---|---|
| ツールバーの項目 → 操作 | `TOOLBAR_ACTIONS_BY_DIALECT`（方言ID → `ToolbarAction[]`。`panels.toolbar` と同じ長さ）。決定表#2 |
| 「変換」が要るか | `profile.convertStep`。`false` なら自動変換（`autoConvert()`）と手順の畳み込み（`skinStepKeys()`）。決定表#3 |
| 表示列数・通電色 | 設定値が `0` / 空文字なら方言の既定。決定表#8 |
| メーカー → 機種 | `plcUnitForVendor()`（`PLC_UNITS` から `vendor` で引く。`MODEL_OF_VENDOR` は非公開。前提#19） |
| 機種を差し替えられるか | `plcForVendor()`。割付の点数がその機種に収まるときだけ差し替えた課題を返す。決定表#10 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/plc-skin.test.ts`:

```ts
import { PLC_UNITS } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, SUPPORTED_PLC_MODELS } from '@ojt/content';
import { availableDialects, DIALECT_IDS, getDialect, type DialectId } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  autoConvert,
  plcForVendor,
  plcUnitForVendor,
  PLC_STEP_KEYS,
  skinGridCols,
  skinMonitorColor,
  skinStepKeys,
  toolbarItems,
  TOOLBAR_ACTIONS_BY_DIALECT,
} from '../src/renderer/session/plc-skin.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

describe('ツールバーの項目 → 操作（§10.6 / 決定表#2）', () => {
  it('has exactly one action per toolbar label in every dialect', () => {
    for (const profile of availableDialects()) {
      expect(TOOLBAR_ACTIONS_BY_DIALECT[profile.id], profile.id).toHaveLength(
        profile.panels.toolbar.length,
      );
      const items = toolbarItems(profile);
      expect(items.map((item) => item.label)).toEqual([...profile.panels.toolbar]);
      expect(items.map((item) => item.index)).toEqual(items.map((_unused, i) => i));
    }
  });

  it('shows a 変換 button only where the skin asks for one (受入基準①)', () => {
    const has = (id: DialectId): boolean =>
      toolbarItems(getDialect(id)).some((item) => item.action === 'convert');
    expect(has('mitsubishi')).toBe(true);
    expect(has('sharp')).toBe(true);
    expect(has('omron')).toBe(false);
    expect(has('jtekt')).toBe(false);
  });

  it('keeps every dialect able to write, run and monitor', () => {
    for (const profile of availableDialects()) {
      const actions = new Set(toolbarItems(profile).map((item) => item.action));
      expect(actions.has('download'), profile.id).toBe(true);
      expect(actions.has('monitor-start'), profile.id).toBe(true);
      expect(actions.has('monitor-stop'), profile.id).toBe(true);
      expect(
        actions.has('plc-run') || actions.has('online'),
        `${profile.id} には運転にできる項目が要る`,
      ).toBe(true);
    }
  });

  it('marks the PCwin-only buttons as inert (決定表#4)', () => {
    const jtekt = toolbarItems(getDialect('jtekt'));
    expect(jtekt.filter((item) => item.action === 'vendor-only').map((item) => item.label)).toEqual([
      'JP1',
      'DGR',
      'MOB',
      'RDY',
    ]);
    expect(jtekt.find((item) => item.label === 'RUN')?.action).toBe('plc-run');
    expect(jtekt.find((item) => item.label === 'STP')?.action).toBe('plc-stop');
    expect(jtekt.find((item) => item.label === 'RES')?.action).toBe('plc-reset');
  });
});

describe('変換の要否（§10.6 / 決定表#3）', () => {
  it('auto-converts exactly where there is no 変換 button', () => {
    for (const profile of availableDialects()) {
      expect(autoConvert(profile), profile.id).toBe(!profile.convertStep);
    }
  });

  it('drops the 変換 step from the guide when the skin has none', () => {
    expect(skinStepKeys(getDialect('mitsubishi'))).toEqual([...PLC_STEP_KEYS]);
    expect(skinStepKeys(getDialect('omron'))).toEqual(['wire', 'ladder', 'run', 'judge']);
    expect(skinStepKeys(getDialect('jtekt'))).toEqual(['wire', 'ladder', 'run', 'judge']);
    expect(skinStepKeys(getDialect('sharp'))).toEqual([...PLC_STEP_KEYS]);
  });
});

describe('表示列数と通電色（§10.6 / 決定表#8）', () => {
  it('falls back to the dialect default when the setting says "follow the vendor"', () => {
    for (const profile of availableDialects()) {
      expect(skinGridCols(profile, 0), profile.id).toBe(profile.gridCols);
      expect(skinMonitorColor(profile, ''), profile.id).toBe(profile.monitorColors.powered);
    }
    expect(skinMonitorColor(getDialect('omron'), '')).toBe('#2FA02C');
    expect(skinMonitorColor(getDialect('jtekt'), '')).toBe('#E08A1E');
    expect(skinMonitorColor(getDialect('sharp'), '')).toBe('#00A0C8');
  });

  it('lets the setting win and clamps it to 8..15', () => {
    const profile = getDialect('omron');
    expect(skinGridCols(profile, 9)).toBe(9);
    expect(skinGridCols(profile, 99)).toBe(15);
    expect(skinGridCols(profile, 3)).toBe(8);
    expect(skinMonitorColor(profile, '#FF00AA')).toBe('#FF00AA');
  });
});

describe('メーカー → 機種（§7.6 / 決定表#9）', () => {
  it('finds one unit per vendor', () => {
    for (const id of DIALECT_IDS) {
      const unit = plcUnitForVendor(id);
      expect(unit?.vendor, id).toBe(id);
      expect(SUPPORTED_PLC_MODELS as readonly string[]).toContain(unit?.model);
    }
    expect(Object.keys(PLC_UNITS)).toHaveLength(4);
  });

  it('swaps the problem model to the chosen vendor (受入基準①③⑤)', () => {
    for (const id of DIALECT_IDS) {
      const swapped = plcForVendor(problem, id);
      expect(swapped?.plc.vendor, id).toBe(id);
      expect(swapped?.plc.model, id).toBe(plcUnitForVendor(id)?.model);
      // 課題の中身（割付・操作列・判定設定）は触らない
      expect(swapped?.io).toEqual(problem.io);
      expect(swapped?.id).toBe(problem.id);
    }
  });

  it('returns the same object when the vendor already matches', () => {
    expect(plcForVendor(problem, 'mitsubishi')).toBe(problem);
  });

  it('refuses a model that cannot host the assignment (決定表#10)', () => {
    // CP1E の出力は12点しかない（4A 前提#23）
    const wide = {
      ...problem,
      io: {
        ...problem.io,
        mode: 'fixed' as const,
        inputs: [{ x: 0, pb: 'PB1' as const }],
        outputs: [{ y: 12, cr: 'CR1', pl: 'PL1' }],
      },
    };
    expect(plcForVendor(wide, 'omron')).toBeUndefined();
    expect(plcForVendor(wide, 'mitsubishi')).toBe(wide);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-skin.test.ts
```

Expected: 失敗。`Failed to load url ../src/renderer/session/plc-skin.js`。

- [ ] **Step 3: `src/renderer/session/plc-skin.ts` を作る**

```ts
import { PLC_UNITS, type PlcUnitDefinition } from '@ojt/board-model';
import { resolvePlcIo, type PlcProblem } from '@ojt/content';
import {
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  type DialectId,
  type DialectProfile,
} from '@ojt/plc-dialects';

/**
 * スキン層（振る舞い）。設計仕様 §10.6 / §17.1。決定表#1
 *
 * 「メーカーによって変わる動き」の**唯一の持ち主**である。画面部品はここから引くだけにし、
 * キー文字列・色・列数・機種名を直書きしない。実機と違うと分かったときの修正箇所を
 * この1ファイルに保つため。見た目（配色・寸法）は `ladder/skins/*.ts` が持つ。
 *
 * React も three も import しない（純粋層）。
 */

/** ツールバーの項目を押したときの意味。§10.6 */
export type ToolbarAction =
  /** 変換（`convertStep: true` のスキンだけが持つ）。 */
  | 'convert'
  /** 全変換（本アプリでは `convert` と同じ）。 */
  | 'convert-all'
  /** 書込みモード（オンライン編集）。 */
  | 'write-mode'
  /** 読出しモード。 */
  | 'read-mode'
  /** オンライン（本アプリでは書込みと同じ。Plan 3B 意図的な差分 #2）。 */
  | 'online'
  /** PLCへの書込み・転送。 */
  | 'download'
  | 'monitor-start'
  | 'monitor-stop'
  /** 運転／停止の切換。 */
  | 'plc-run'
  /** 停止（PCwin風の `STP`）。 */
  | 'plc-stop'
  /** デバイス初期化（PCwin風の `RES`）。 */
  | 'plc-reset'
  /** 実機の操作パネルにはあるが本アプリでは動かない項目。決定表#4 */
  | 'vendor-only';

/**
 * 方言ID → ツールバーの項目の意味。**`profile.panels.toolbar` と同じ並び・同じ長さ**である。
 * 位置ではなくこの表で引くことで、項目数が方言ごとに違っても取り違えない（決定表#2）。
 *
 * 【本アプリの前提】PCwin風の `JP1` / `DGR` / `MOB` / `RDY` は実機の操作パネルの項目で、
 * 本アプリには対応する機能が無い（PLC調査資料 J-10 未確認）。`vendor-only` として淡色で出す。
 */
export const TOOLBAR_ACTIONS_BY_DIALECT: Readonly<Record<DialectId, readonly ToolbarAction[]>> = {
  // 変換／全変換／書込みモード／読出しモード／オンライン／シーケンサへの書込み／モニタ開始／モニタ停止
  mitsubishi: [
    'convert',
    'convert-all',
    'write-mode',
    'read-mode',
    'online',
    'download',
    'monitor-start',
    'monitor-stop',
  ],
  // JP1／DGR／MOB／STP／RDY／RUN／RES／モニタ開始／モニタ停止
  jtekt: [
    'vendor-only',
    'vendor-only',
    'vendor-only',
    'plc-stop',
    'vendor-only',
    'plc-run',
    'plc-reset',
    'monitor-start',
    'monitor-stop',
  ],
  // オンライン編集／転送［PC → PLC］／モニタ開始／モニタ停止／運転／停止
  omron: ['write-mode', 'download', 'monitor-start', 'monitor-stop', 'plc-run'],
  // 変換／PLCへの書込み／運転／停止／モニタ開始／モニタ停止
  sharp: ['convert', 'download', 'plc-run', 'monitor-start', 'monitor-stop'],
};

/** ツールバー1項目。 */
export interface ToolbarItem {
  action: ToolbarAction;
  label: string;
  /** `panels.toolbar` の位置（`data-testid` を一意にするために使う）。 */
  index: number;
}

/**
 * スキンのツールバー。`panels.toolbar`（文言）と `TOOLBAR_ACTIONS_BY_DIALECT`（意味）を
 * 突き合わせる。長さが合わないときは**足りない分を落とす**（表の取り違えで押せない項目を
 * 出すより、出さないほうが安全）。長さが合っていることは `test/plc-skin.test.ts` が見張る。
 */
export function toolbarItems(profile: DialectProfile): ToolbarItem[] {
  const actions = TOOLBAR_ACTIONS_BY_DIALECT[profile.id];
  return profile.panels.toolbar.flatMap((label, index) => {
    const action = actions[index];
    return action === undefined ? [] : [{ action, label, index }];
  });
}

/** 手順表の段。§10.6 の操作フロー */
export const PLC_STEP_KEYS = ['wire', 'ladder', 'convert', 'run', 'judge'] as const;
export type PlcStepKey = (typeof PLC_STEP_KEYS)[number];

/**
 * このスキンの手順。`convertStep: false`（CX-Programmer風・PCwin風）は
 * 「変換」という手順そのものが無い（§10.6）。決定表#3
 */
export function skinStepKeys(profile: DialectProfile): PlcStepKey[] {
  return PLC_STEP_KEYS.filter((key) => key !== 'convert' || profile.convertStep);
}

/**
 * ラダーが変わるたびに自動で変換するか。決定表#3
 * 「変換」ボタンが無いスキンでは、判定前に `convert()` を通す機会がここしかない（4A H-3）。
 */
export function autoConvert(profile: DialectProfile): boolean {
  return !profile.convertStep;
}

/**
 * ラダーの表示列数。設定値 `0` は「メーカーの既定に従う」。§10.6 / 決定表#8
 * 利用者が選んだ値は 8〜15 に丸める（`MIN_GRID_COLS` / `MAX_GRID_COLS`）。
 */
export function skinGridCols(profile: DialectProfile, setting: number): number {
  if (!Number.isFinite(setting) || setting <= 0) return profile.gridCols;
  return Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(setting)));
}

/** モニタ中の通電色。設定値が空文字なら方言の既定。§10.6 / 決定表#8 */
export function skinMonitorColor(profile: DialectProfile, setting: string): string {
  return setting.length > 0 ? setting : profile.monitorColors.powered;
}

/**
 * メーカー → 机上に置くPLC本体。§7.6
 * `@ojt/content` の `MODEL_OF_VENDOR` は非公開なので、本体定義の `vendor` から引く
 * （4A Task 12 が「メーカーと機種の組み合わせ違いは拒否する」ことを保証している）。
 */
export function plcUnitForVendor(vendor: DialectId): PlcUnitDefinition | undefined {
  return Object.values(PLC_UNITS).find((unit) => unit.vendor === vendor);
}

/**
 * 割付がこの機種に収まるか。決定表#10
 * CP1E は出力が12点しかないので、`y: 12` 以降を使う課題は開けない（4A 前提#23）。
 */
export function fitsPlcUnit(problem: PlcProblem, unit: PlcUnitDefinition): boolean {
  const io = resolvePlcIo(problem.io);
  return (
    io.inputs.every((input) => input.x < unit.spec.inputs.length) &&
    io.outputs.every((output) => output.y < unit.spec.outputs.length)
  );
}

/**
 * 課題を「このメーカーの機種で開く」形に直す。§7.6 / 決定表#9
 *
 * 内蔵モードD課題8題は機種に依らず成立する（4A 決定表#14 / Task 14）ので、既定メーカーを
 * 変えるだけで CP1E・TOYOPUC・JW300 の課題として開ける。割付が収まらない課題（利用者課題）は
 * `undefined` を返し、呼び出し側が元の機種のまま開いて理由を出す。
 *
 * 既にそのメーカーなら**同じオブジェクトを返す**（呼び出し側が差し替えの有無を `===` で見る）。
 */
export function plcForVendor(problem: PlcProblem, vendor: DialectId): PlcProblem | undefined {
  if (problem.plc.vendor === vendor) return problem;
  const unit = plcUnitForVendor(vendor);
  if (unit === undefined || !fitsPlcUnit(problem, unit)) return undefined;
  /*
   * `DialectId` と `@ojt/content` の `PLC_VENDORS` / `PLC_MODELS` は同じ4つの文字列だが
   * 別々に宣言されている。両者が揃っていることは `test/plc-skin.test.ts` の
   * 「finds one unit per vendor」が `SUPPORTED_PLC_MODELS` と突き合わせて見張る。
   */
  const plc = { vendor, model: unit.model } as PlcProblem['plc'];
  return { ...problem, plc };
}
```

- [ ] **Step 4: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-skin.test.ts
```

Expected: 4 describe / **12 ケース**すべて通過。

```powershell
git add apps/desktop/src/renderer/session/plc-skin.ts apps/desktop/test/plc-skin.test.ts
git commit -m "feat(desktop): add the vendor skin behaviour layer for mode D"
```

---

## Task 2: スキンの見た目（`ladder/skins/*.ts` と CSS 変数）

**モデル: Opus**（「実物との対応」表の値を CSS 変数へ落とす設計判断があるため）

**Files:**
- Create: `apps/desktop/src/renderer/ladder/skins/types.ts`
- Create: `apps/desktop/src/renderer/ladder/skins/{mitsubishi,omron,jtekt,sharp}.ts`
- Create: `apps/desktop/src/renderer/ladder/skins/index.ts`
- Modify: `apps/desktop/src/renderer/ladder/ladder.module.css`（**末尾追記＋既存の色・寸法を `var(--skin-*)` に置き換え**）
- Test: `apps/desktop/test/skin-theme.test.ts`（新規）

利用者要求「各メーカーのソフト画面に合わせた可能な限り実物に忠実な画面」に対する**データ側**の回答である。上の「実物との対応」表の値をそのままコードにする。**画面キャプチャ・ロゴ・配色データは使わない。** すべて §17.1 の前提（△）であることを `assumed` に残し、設定画面とキー割当欄の注記から辿れるようにする。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/skin-theme.test.ts`:

```ts
import { availableDialects, DIALECT_IDS, getDialect } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import { SKIN_THEMES, skinCssVars, skinThemeOf } from '../src/renderer/ladder/skins/index.js';

describe('SkinTheme（利用者要求: 実物に近い回路入力画面 / §10.6 / §17.1）', () => {
  it('has one theme per dialect', () => {
    expect(Object.keys(SKIN_THEMES).sort()).toEqual([...DIALECT_IDS].sort());
    for (const profile of availableDialects()) {
      expect(skinThemeOf(profile).id, profile.id).toBe(profile.id);
    }
  });

  it('keeps the 風 suffix and no vendor product screenshot in the title bar (§17.1)', () => {
    for (const profile of availableDialects()) {
      const theme = skinThemeOf(profile);
      expect(theme.titleBar, profile.id).toMatch(/風$/u);
      expect(theme.titleBar.length).toBeLessThanOrEqual(24);
    }
    expect(skinThemeOf(getDialect('mitsubishi')).titleBar).toBe('MELSOFT GX Works3 風');
    expect(skinThemeOf(getDialect('omron')).titleBar).toBe('CX-Programmer 風');
    expect(skinThemeOf(getDialect('jtekt')).titleBar).toBe('PCwin 風');
    expect(skinThemeOf(getDialect('sharp')).titleBar).toBe('JW-300SP 風');
  });

  it('gives every theme a full, distinct colour set', () => {
    const canvases = new Set<string>();
    for (const theme of Object.values(SKIN_THEMES)) {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(value, `${theme.id}.${key}`).toMatch(/^#[0-9A-F]{6}$/u);
      }
      canvases.add(theme.colors.canvas);
      expect(theme.cell.widthPx).toBeGreaterThanOrEqual(40);
      expect(theme.cell.heightPx).toBeGreaterThanOrEqual(30);
      expect(theme.assumed.length).toBeGreaterThan(0);
    }
    // 4スキンが見分けられること（背景がすべて同じなら「忠実に」の要求を満たさない）
    expect(canvases.size).toBe(4);
  });

  it('matches the powered colour to the dialect (§10.6)', () => {
    for (const profile of availableDialects()) {
      expect(skinThemeOf(profile).colors.powered, profile.id).toBe(
        profile.monitorColors.powered,
      );
      expect(skinThemeOf(profile).colors.cursor, profile.id).toBe(profile.monitorColors.powered);
    }
  });

  it('shows the output pane as a status bar only in the PCwin style (§10.6)', () => {
    expect(skinThemeOf(getDialect('jtekt')).layout.outputPane).toBe('status-bar');
    for (const id of ['mitsubishi', 'omron', 'sharp'] as const) {
      expect(skinThemeOf(getDialect(id)).layout.outputPane, id).toBe('window');
    }
  });

  it('lists the status bar items each tool shows', () => {
    expect(skinThemeOf(getDialect('mitsubishi')).statusItems).toEqual([
      'mode',
      'network',
      'overwrite',
    ]);
    expect(skinThemeOf(getDialect('omron')).statusItems).toEqual(['mode', 'plc-state', 'scan']);
    expect(skinThemeOf(getDialect('jtekt')).statusItems).toEqual([
      'mode',
      'plc-state',
      'scan',
      'device-count',
    ]);
    expect(skinThemeOf(getDialect('sharp')).statusItems).toEqual(['mode', 'network', 'plc-state']);
  });
});

describe('CSS 変数への変換（決定表#5）', () => {
  it('turns every colour and size into a --skin-* custom property', () => {
    const vars = skinCssVars(skinThemeOf(getDialect('omron')), '#FF00AA');
    expect(vars['--skin-canvas']).toBe('#FFFFFF');
    expect(vars['--skin-rail']).toBe('#1F1F1F');
    expect(vars['--skin-cell-w']).toBe('52px');
    expect(vars['--skin-cell-h']).toBe('40px');
    expect(vars['--skin-stroke']).toBe('1.4');
    expect(vars['--skin-coil-rx']).toBe('7');
    // 出力ウィンドウの高さもスキンが決める（`window` でも `status-bar` でも同じ変数。I11）
    expect(vars['--skin-output-h']).toBe('140px');
    // 設定画面の通電色は方言の色を上書きする（決定表#8）
    expect(vars['--skin-powered']).toBe('#FF00AA');
    expect(Object.keys(vars).every((key) => key.startsWith('--skin-'))).toBe(true);
  });

  it('falls back to the dialect colour when the setting is empty', () => {
    const vars = skinCssVars(skinThemeOf(getDialect('jtekt')), '');
    expect(vars['--skin-powered']).toBe('#E08A1E');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/skin-theme.test.ts
```

Expected: 失敗。`Failed to load url ../src/renderer/ladder/skins/index.js`。

- [ ] **Step 3: `ladder/skins/types.ts` を作る**

```ts
import type { DialectId } from '@ojt/plc-dialects';

/**
 * スキンの見た目。設計仕様 §10.6 / §17.1。決定表#5
 *
 * 利用者要求（2026-09-19）「各メーカーのソフト画面や仕様に合わせた可能な限り実物に忠実な画面」
 * に対する記述である。**各社の画面キャプチャ・ロゴ・アイコン・図記号ビットマップ・純正の配色
 * データは一切使っていない**（§17 / PLC調査資料 §6）。再現するのは公知の画面構成・項目名・
 * 一般に知られた色調で、値はすべて本アプリの記述（§17.1 の前提方針）である。
 * 実機と異なると分かったときの修正箇所は `ladder/skins/<メーカー>.ts` の1ファイルだけである。
 */

/** ステータスバーに出す項目。 */
export type SkinStatusItem =
  /** 書込／読出／モニタ。 */
  | 'mode'
  /** RUN / STOP。 */
  | 'plc-state'
  /** スキャン回数と経過時間。 */
  | 'scan'
  /** いまカーソルがある回路ブロック。 */
  | 'network'
  /** 挿入／上書き。 */
  | 'overwrite'
  /** 使っているデバイス点数。 */
  | 'device-count';

/** スキンの配色。すべて `#RRGGBB`（大文字）。 */
export interface SkinColors {
  /** 編集領域の背景。 */
  canvas: string;
  /** 格子線（`transparent` にしたいときは背景と同色にする）。 */
  grid: string;
  /** 左母線。 */
  rail: string;
  /** 記号と導線の線色。 */
  symbol: string;
  /** デバイス名の文字色。 */
  device: string;
  /** 設定値（タイマ・カウンタ）の文字色。 */
  preset: string;
  /** デバイスコメントの文字色。 */
  comment: string;
  /** カーソル枠。 */
  cursor: string;
  /** 変換エラーのセル枠。 */
  error: string;
  /** 通電表示（モニタ中）。 */
  powered: string;
  /** ツールバーの背景。 */
  toolbar: string;
  /** タイトルバーの背景。 */
  titleBar: string;
  /** タイトルバーの文字。 */
  titleBarText: string;
  /** ステータスバーの背景。 */
  statusBar: string;
  /** 出力ウィンドウの背景。 */
  output: string;
}

/**
 * セルの寸法と線の太さ[px]。**スキンで変わる値はこの5つだけ**で、記号の「種別」は持たない
 * （決定表#6。`'gx' | 'cx' | …` のような列挙を作らないのは、値が2箇所に割れるため）。
 */
export interface SkinCell {
  widthPx: number;
  heightPx: number;
  /** 記号・導線の線幅。 */
  strokeWidth: number;
  /** 接点の縦棒の上下の余白[px]（小さいほど縦長の接点になる）。 */
  barInsetPx: number;
  /**
   * コイルの半円の横の膨らみ（SVG 楕円弧の `rx`）[px]。
   * 小さいほど扁平に見える（CX-Programmer風の「やや扁平」＝ 7。ほかは 9）。「実物との対応」表
   */
  coilRxPx: number;
}

/**
 * 画面の並び。
 * ツリーの**位置**は4スキンとも左なので欄を持たない（持っても誰も読まない旗になる。I11）。
 */
export interface SkinLayout {
  /** ツリーの幅[px]。 */
  treeWidthPx: number;
  /** 出力ペインの形（`status-bar` は PCwin風だけ。§10.6）。 */
  outputPane: 'window' | 'status-bar';
  /**
   * 出力ペインの高さ[px]。`window` のときは出力ウィンドウそのものの高さ、`status-bar` のときは
   * 折りたたんだ詳細の高さ。どちらも CSS 変数 `--skin-output-h` として同じ場所から効く。
   */
  outputHeightPx: number;
}

/** スキン1つぶんの見た目。 */
export interface SkinTheme {
  id: DialectId;
  /** タイトルバーの文字。**必ず「風」で終わる**（§15 / §17.1 の商標の扱い）。 */
  titleBar: string;
  layout: SkinLayout;
  statusItems: readonly SkinStatusItem[];
  colors: SkinColors;
  cell: SkinCell;
  /** デバイスコメントを記号の下に何行で出すか。 */
  commentLines: 0 | 1 | 2;
  /** この見た目のうち §17.1 の前提である項目（設定画面とツールチップに出す）。 */
  assumed: readonly string[];
}

/** 4スキン共通の前提（「実物との対応」表の △ の理由）。 */
export const SKIN_ASSUMED: readonly string[] = [
  '画面の配色・セル寸法・記号の線の太さ（一般に知られた見え方から作図。純正の画面キャプチャ・配色データは使っていない）',
  'ペインの幅・出力ウィンドウの高さ・ステータスバーの項目（公知の画面構成から）',
  'タイトルバーの文字は「風」を付けた本アプリの表記（各社のロゴ・製品画像は持たない）',
];
```

- [ ] **Step 4: 4スキンの定義を作る**

`ladder/skins/mitsubishi.ts`:

```ts
import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/** GX Works3風（三菱）。「実物との対応」表の三菱列。§10.6 / §17.1 */
export const MITSUBISHI_SKIN: SkinTheme = {
  id: 'mitsubishi',
  titleBar: 'MELSOFT GX Works3 風',
  layout: { treeWidthPx: 240, outputPane: 'window', outputHeightPx: 160 },
  statusItems: ['mode', 'network', 'overwrite'],
  colors: {
    canvas: '#F7F8FA',
    grid: '#F7F8FA',
    rail: '#3A3F47',
    symbol: '#1B1E23',
    device: '#1B1E23',
    preset: '#555555',
    comment: '#1B6AC9',
    cursor: '#1E64FF',
    error: '#D14343',
    powered: '#1E64FF',
    toolbar: '#EDEFF3',
    titleBar: '#2F4A73',
    titleBarText: '#FFFFFF',
    statusBar: '#E6E9EE',
    output: '#FFFFFF',
  },
  cell: { widthPx: 48, heightPx: 36, strokeWidth: 1.6, barInsetPx: 8, coilRxPx: 9 },
  commentLines: 1,
  assumed: SKIN_ASSUMED,
};
```

`ladder/skins/omron.ts`:

```ts
import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/** CX-Programmer風（OMRON）。白地・細い線・コメント2行。§10.6 / §17.1 */
export const OMRON_SKIN: SkinTheme = {
  id: 'omron',
  titleBar: 'CX-Programmer 風',
  layout: { treeWidthPx: 220, outputPane: 'window', outputHeightPx: 140 },
  statusItems: ['mode', 'plc-state', 'scan'],
  colors: {
    canvas: '#FFFFFF',
    grid: '#E3E8EE',
    rail: '#1F1F1F',
    symbol: '#000000',
    device: '#101418',
    preset: '#4A5560',
    comment: '#0B6E4F',
    cursor: '#2FA02C',
    error: '#C62828',
    powered: '#2FA02C',
    toolbar: '#F2F4F6',
    titleBar: '#1F5C99',
    titleBarText: '#FFFFFF',
    statusBar: '#EAEEF2',
    output: '#FBFCFD',
  },
  // コイルは「やや扁平」（「実物との対応」表）＝ `coilRxPx` を 9 より小さくする
  cell: { widthPx: 52, heightPx: 40, strokeWidth: 1.4, barInsetPx: 10, coilRxPx: 7 },
  commentLines: 2,
  assumed: SKIN_ASSUMED,
};
```

`ladder/skins/jtekt.ts`:

```ts
import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/**
 * PCwin風（JTEKT）。灰地・太い線・**下部ステータスバー**（§10.6 の画面構成）。§17.1
 * ツリーは5分類（プログラム／データファイル／パラメータ／LD／SFC）を出すので少し広い。
 */
export const JTEKT_SKIN: SkinTheme = {
  id: 'jtekt',
  titleBar: 'PCwin 風',
  layout: { treeWidthPx: 260, outputPane: 'status-bar', outputHeightPx: 150 },
  statusItems: ['mode', 'plc-state', 'scan', 'device-count'],
  colors: {
    canvas: '#EDEFF2',
    grid: '#DCE0E6',
    rail: '#333A42',
    symbol: '#12212E',
    device: '#12212E',
    preset: '#5A626B',
    comment: '#8A5A00',
    cursor: '#E08A1E',
    error: '#C0392B',
    powered: '#E08A1E',
    toolbar: '#E2E5EA',
    titleBar: '#40546B',
    titleBarText: '#FFFFFF',
    statusBar: '#D8DCE2',
    output: '#F6F7F9',
  },
  cell: { widthPx: 46, heightPx: 34, strokeWidth: 1.8, barInsetPx: 7, coilRxPx: 9 },
  commentLines: 1,
  assumed: SKIN_ASSUMED,
};
```

`ladder/skins/sharp.ts`:

```ts
import type { SkinTheme } from './types.js';
import { SKIN_ASSUMED } from './types.js';

/** JW-300SP風（シャープ）。淡青灰の地。§10.6 / §17.1 */
export const SHARP_SKIN: SkinTheme = {
  id: 'sharp',
  titleBar: 'JW-300SP 風',
  layout: { treeWidthPx: 220, outputPane: 'window', outputHeightPx: 150 },
  statusItems: ['mode', 'network', 'plc-state'],
  colors: {
    canvas: '#F2F5F7',
    grid: '#F2F5F7',
    rail: '#2C3E50',
    symbol: '#102A3C',
    device: '#102A3C',
    preset: '#546A79',
    comment: '#00647A',
    cursor: '#00A0C8',
    error: '#B03A3A',
    powered: '#00A0C8',
    toolbar: '#E7ECEF',
    titleBar: '#1E6F86',
    titleBarText: '#FFFFFF',
    statusBar: '#DCE3E7',
    output: '#FAFCFD',
  },
  cell: { widthPx: 50, heightPx: 38, strokeWidth: 1.6, barInsetPx: 8, coilRxPx: 9 },
  commentLines: 1,
  assumed: SKIN_ASSUMED,
};
```

- [ ] **Step 5: `ladder/skins/index.ts` を作る**

```ts
import type { DialectId, DialectProfile } from '@ojt/plc-dialects';
import { JTEKT_SKIN } from './jtekt.js';
import { MITSUBISHI_SKIN } from './mitsubishi.js';
import { OMRON_SKIN } from './omron.js';
import { SHARP_SKIN } from './sharp.js';
import type { SkinTheme } from './types.js';

export type { SkinCell, SkinColors, SkinLayout, SkinStatusItem, SkinTheme } from './types.js';
export { SKIN_ASSUMED } from './types.js';

/** 方言ID → スキンの見た目。§10.6 / 決定表#5 */
export const SKIN_THEMES: Readonly<Record<DialectId, SkinTheme>> = {
  mitsubishi: MITSUBISHI_SKIN,
  jtekt: JTEKT_SKIN,
  omron: OMRON_SKIN,
  sharp: SHARP_SKIN,
};

/** そのプロファイルのスキン。 */
export function skinThemeOf(profile: DialectProfile): SkinTheme {
  return SKIN_THEMES[profile.id];
}

/**
 * スキンを CSS カスタムプロパティに直す。決定表#5
 *
 * `.workspace` に**1回だけ**流し込む。子の要素（`LadderGrid` の `memo` が効いている部分）に
 * インラインスタイルを撒かないので、再描画の性質（3B 決定表#5）を壊さない。
 *
 * 表示列数（`ladderGridCols`）はここでは扱わない。列数は SVG の `width` を決める値で、
 * `LadderGrid` が `gridCols` の props として受け取る（CSS には出さない）。
 *
 * @param monitorColor 設定画面の通電色（空なら方言の既定）。決定表#8
 */
export function skinCssVars(theme: SkinTheme, monitorColor: string): Record<string, string> {
  const powered = monitorColor.length > 0 ? monitorColor : theme.colors.powered;
  return {
    '--skin-canvas': theme.colors.canvas,
    '--skin-grid': theme.colors.grid,
    '--skin-rail': theme.colors.rail,
    '--skin-symbol': theme.colors.symbol,
    '--skin-device': theme.colors.device,
    '--skin-preset': theme.colors.preset,
    '--skin-comment': theme.colors.comment,
    '--skin-cursor': theme.colors.cursor,
    '--skin-error': theme.colors.error,
    '--skin-powered': powered,
    '--skin-toolbar': theme.colors.toolbar,
    '--skin-title-bar': theme.colors.titleBar,
    '--skin-title-text': theme.colors.titleBarText,
    '--skin-status-bar': theme.colors.statusBar,
    '--skin-output': theme.colors.output,
    '--skin-cell-w': `${String(theme.cell.widthPx)}px`,
    '--skin-cell-h': `${String(theme.cell.heightPx)}px`,
    '--skin-stroke': String(theme.cell.strokeWidth),
    '--skin-coil-rx': String(theme.cell.coilRxPx),
    '--skin-tree-w': `${String(theme.layout.treeWidthPx)}px`,
    '--skin-output-h': `${String(theme.layout.outputHeightPx)}px`,
  };
}
```

- [ ] **Step 6: `ladder.module.css` を CSS 変数で読むように直す**

**既定値つきで読む**（`var(--skin-canvas, #f7f8fa)`）ので、変数を流し込まない場所（既存テスト）でも今までどおりに見える。ファイルを読み直してから、次の行だけを置き換える:

| 置き換え前 | 置き換え後 |
|---|---|
| `.gridScroll { background: #f7f8fa; }` | `background: var(--skin-canvas, #f7f8fa);` |
| `.rail { fill: #3a3f47; }` | `fill: var(--skin-rail, #3a3f47);` |
| `.wire, .symbol { stroke-width: 1.6; }` | `stroke-width: var(--skin-stroke, 1.6);` |
| `.symbolText, .deviceText, … { fill: #1b1e23; }` | `fill: var(--skin-device, #1b1e23);` |
| `.presetText { fill: #555; }` | `fill: var(--skin-preset, #555);` |
| `.commentText { fill: #1b6ac9; }` | `fill: var(--skin-comment, #1b6ac9);` |
| `.cursor { stroke: #1e64ff; }` | `stroke: var(--skin-cursor, #1e64ff);` |
| `.errorCell { stroke: #d14343; }` | `stroke: var(--skin-error, #d14343);` |
| `.networkComment { color: #1b6ac9; }` | `color: var(--skin-comment, #1b6ac9);` |
| `.toolbar { … }`（背景を持っていなければ足す） | `background: var(--skin-toolbar, #edeff3);` |
| `.output { … }` の背景 | `background: var(--skin-output, #fff);` |
| `.output { … }` の高さ（無ければ足す） | `max-height: var(--skin-output-h, 160px);`（**`window` の出力ウィンドウにも効かせる**。I11） |
| `.tree { width: … }` | `width: var(--skin-tree-w, 240px);` |

さらに末尾へ追記する:

```css
/* --- Plan 4B Task 2: スキンの枠（決定表#5・#7） --- */
.titleBar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
  background: var(--skin-title-bar, #2f4a73);
  color: var(--skin-title-text, #fff);
}

.titleBarName {
  font-weight: 700;
}

.titleBarNote {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.85;
}

.statusBar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  background: var(--skin-status-bar, #e6e9ee);
  border-top: 1px solid rgb(0 0 0 / 12%);
}

.statusItem {
  white-space: nowrap;
}

/* 実機の操作パネルにあるが動かない項目（決定表#4） */
.vendorTool {
  opacity: 0.55;
  font-style: italic;
}

/* PCwin風は出力を下部のステータスバーに畳む（§10.6 / 決定表#7） */
.outputCollapsed {
  max-height: var(--skin-output-h, 150px);
}
```

- [ ] **Step 7: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/skin-theme.test.ts
npx prettier --check "apps/desktop/src/renderer/ladder/**/*.{ts,css}"
```

Expected: 2 describe / 8 ケース通過、Prettier は `All matched files use Prettier code style!`。

```powershell
git add apps/desktop/src/renderer/ladder apps/desktop/test/skin-theme.test.ts
git commit -m "feat(desktop): describe the four vendor skins as themes with CSS variables"
```

---

## Task 3: `LadderWorkspace` をスキンで駆動する（ツールバー・自動変換・タイトルバー・ステータスバー）

**モデル: Opus**（自動変換の入れ方、押せないボタンの扱い、CSS変数の流し込み位置の判断があるため）

**Files:**
- Create: `apps/desktop/src/renderer/ladder/SkinFrame.tsx`
- Modify: `apps/desktop/src/renderer/ladder/LadderWorkspace.tsx`
- Modify: `apps/desktop/src/renderer/ladder/OutputWindow.tsx`（`convertKey` props）
- Modify: `apps/desktop/src/renderer/ladder/MonitorPanel.tsx`（`JA.ladder.monitorOff` が関数になることへの追随。**ここだけ**。端子名は 4A Task 8 が直す）
- Modify: `apps/desktop/src/renderer/screens/PlcSession.tsx`（手順表・表示列数）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（既存3件を関数化＋追記）
- Test: `apps/desktop/test/skin-workspace.test.tsx`（新規）
- Test: `apps/desktop/test/ladder-workspace.test.tsx` / `output-window.test.tsx`（追随）

§16 Phase 4 受入基準①の本体である。**ツールバーは `toolbarItems()` から**描き、`convertStep: false` のスキンでは「変換」ボタンを出さず、ラダーが変わるたびに自動で変換する。あわせてスキンの枠（タイトルバー・ステータスバー）と CSS 変数を入れて、4スキンが見て区別できるようにする（利用者要求）。

| 決めること | 本タスクの実装 |
|---|---|
| ボタンの `data-testid` | その action が**最初に出る位置**は `toolbar-<action>`、2つ目以降は `toolbar-<action>-<index>`（PCwin風は `vendor-only` が4つ並ぶ） |
| CSS 変数 | `.workspace` に `style={skinCssVars(theme, monitorColor)}` を1回だけ（決定表#5。表示列数は CSS に出さない） |
| 自動変換 | `useEffect([program])` で `autoConvert(profile)` なら `convert({ silent: true })` |
| `vendor-only` | 押すと `JA.ladder.vendorOnly` をトーストに出し、`className={styles.vendorTool}` |
| `plc-run` / `plc-stop` / `plc-reset` | `onPlc({kind:'run', on})` / `onPlc({kind:'reset'})`。RUN の現在値は `plcRunning` |
| 文言 | `JA.ladder.notConverted` / `readOnly` / `monitorOff` を**引数を取る関数**にし、キーは `shortcutKeyOf(profile, …)` から渡す（前提#22） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/skin-workspace.test.tsx`:

```tsx
import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { empty, network, no, program, X } from '@ojt/ladder-core';
import { getDialect, JTEKT_PC10G, MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { SKIN_THEMES } from '../src/renderer/ladder/skins/index.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

function workspace(profile = MITSUBISHI_FX5U, onPlc = vi.fn()): typeof onPlc {
  render(<LadderWorkspace problem={problem} profile={profile} gridCols={11} onPlc={onPlc} />);
  return onPlc;
}

describe('スキンごとのツールバー（§10.6 / §16 Phase 4 受入基準①）', () => {
  it('draws exactly the labels the skin names, in order', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      const labels = screen
        .getAllByTestId(/^toolbar-/u)
        .map((button) => button.textContent)
        .slice(0, profile.panels.toolbar.length);
      expect(labels, profile.id).toEqual([...profile.panels.toolbar]);
    }
  });

  it('has no 変換 button in the CX-Programmer style skin (受入基準①)', () => {
    workspace(OMRON_CP1E);
    expect(screen.queryByTestId('toolbar-convert')).toBeNull();
    expect(screen.queryByText('変換')).toBeNull();
    expect(screen.getByTestId('toolbar-download')).toHaveTextContent('転送［PC → PLC］');
  });

  it('keeps the 変換 button in the GX Works3 and JW-300SP style skins', () => {
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('toolbar-convert')).toHaveTextContent('変換');
    cleanup();
    workspace(SHARP_JW300);
    expect(screen.getByTestId('toolbar-convert')).toHaveTextContent('変換');
  });

  it('explains the PCwin-only buttons instead of doing nothing (決定表#4)', () => {
    workspace(JTEKT_PC10G);
    const jp1 = screen.getByTestId('toolbar-vendor-only');
    expect(jp1).toHaveTextContent('JP1');
    act(() => {
      fireEvent.click(jp1);
    });
    expect(useStore.getState().toasts.at(-1)?.text).toContain('本アプリでは動作しません');
    // 2つ目以降は位置つきで引ける
    expect(screen.getByTestId('toolbar-vendor-only-1')).toHaveTextContent('DGR');
  });

  it('sends run / stop / reset from the PCwin buttons', () => {
    const onPlc = workspace(JTEKT_PC10G);
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-plc-run'));
    });
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: true });
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-plc-stop'));
    });
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: false });
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-plc-reset'));
    });
    expect(onPlc).toHaveBeenCalledWith({ kind: 'reset' });
  });
});

describe('スキンの枠（利用者要求: 実物に近い画面）', () => {
  it('names the tool in the title bar, with 風 and the trademark note', () => {
    workspace(OMRON_CP1E);
    expect(screen.getByTestId('skin-title')).toHaveTextContent('CX-Programmer 風');
    expect(screen.getByTestId('skin-title')).toHaveTextContent('商標');
  });

  it('pushes the skin colours in as CSS variables, once, on the workspace', () => {
    workspace(JTEKT_PC10G);
    const root = screen.getByTestId('ladder-workspace');
    expect(root.style.getPropertyValue('--skin-canvas')).toBe(
      SKIN_THEMES['jtekt'].colors.canvas,
    );
    expect(root.style.getPropertyValue('--skin-powered')).toBe('#E08A1E');
    expect(root.style.getPropertyValue('--skin-cell-w')).toBe('46px');
    expect(root).toHaveAttribute('data-skin', 'jtekt');
  });

  it('shows the status items each tool shows', () => {
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('status-mode')).toHaveTextContent('書込');
    expect(screen.getByTestId('status-network')).toHaveTextContent('n1');
    expect(screen.getByTestId('status-overwrite')).toBeInTheDocument();
    expect(screen.queryByTestId('status-scan')).toBeNull();
    cleanup();
    workspace(JTEKT_PC10G);
    expect(screen.getByTestId('status-scan')).toBeInTheDocument();
    expect(screen.getByTestId('status-device-count')).toBeInTheDocument();
    expect(screen.queryByTestId('status-overwrite')).toBeNull();
  });

  it('folds the output pane into the status bar in the PCwin style (§10.6)', () => {
    workspace(JTEKT_PC10G);
    expect(screen.getByTestId('ladder-workspace')).toHaveAttribute('data-output-pane', 'status-bar');
    cleanup();
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('ladder-workspace')).toHaveAttribute('data-output-pane', 'window');
  });
});

describe('変換のいらないスキン（§10.6 / 決定表#3）', () => {
  /** 1セルだけ置いたラダー（変換は `no-output` で落ちる）。 */
  const oneContact = program(network('n1', [[no(X(0)), empty()]]), network('end', [[empty()]]));

  it('converts on every change when the skin has no 変換 step', () => {
    const onPlc = workspace(OMRON_CP1E);
    act(() => {
      useStore.getState().setLadder(oneContact);
    });
    // 自動変換が走り、結果が出力ウィンドウに出る（トーストは出さない）
    expect(useStore.getState().convertIssues.errors.length).toBeGreaterThan(0);
    expect(useStore.getState().toasts).toHaveLength(0);
    expect(onPlc).not.toHaveBeenCalled();
  });

  it('does not convert by itself when the skin has a 変換 button', () => {
    workspace(MITSUBISHI_FX5U);
    act(() => {
      useStore.getState().setLadder(oneContact);
    });
    expect(useStore.getState().convertIssues.errors).toHaveLength(0);
    expect(useStore.getState().converted).toBe(false);
  });
});

describe('キーの文字列を文言に埋め込まない（前提#22 / 決定表#2）', () => {
  it('names the convert key of the current skin in the output window', () => {
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('convert-state')).toHaveTextContent('F4');
  });

  it('says the ladder is converted automatically where there is no 変換', () => {
    workspace(OMRON_CP1E);
    expect(screen.getByTestId('convert-state')).not.toHaveTextContent('F4');
    expect(screen.getByTestId('convert-state')).toHaveTextContent('自動');
  });

  it('names the write-mode key of the current skin when an edit is refused', () => {
    workspace(MITSUBISHI_FX5U);
    act(() => {
      useStore.getState().setLadderMode('read');
      fireEvent.click(screen.getByTestId('toolbar-insert-network'));
    });
    const key = getDialect('mitsubishi').shortcuts.find((s) => s.action === 'write-mode')?.keys;
    expect(useStore.getState().toasts.at(-1)?.text).toContain(key);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/skin-workspace.test.tsx
```

Expected: 失敗。`Unable to find an element by: [data-testid="toolbar-download"]`（OMRON では位置 1 が `convert-all` に倒れている）。

- [ ] **Step 3: `i18n/ja.ts` の文言を方言非依存にする**

`ja.ts` を読み直してから、`JA.ladder` の該当行を**関数に差し替える**（同じキーを2回書かない）:

```ts
    /** 読出し・モニタ中に編集しようとした。§10.6（キーは方言から渡す。決定表#2） */
    readOnly: (writeKey: string): string => `書込みモード（${writeKey}）に切り替えると編集できます`,
    /** 変換前。「変換」のあるスキンはキーを、無いスキンは自動である旨を出す。決定表#3 */
    notConverted: (convertKey: string): string => `未変換（${convertKey} で変換します）`,
    notConvertedAuto: '自動で変換します（このメーカーのツールに「変換」操作はありません）',
    /** モニタの案内（キーは方言から渡す）。前提#22 */
    monitorOff: (monitorKey: string): string =>
      `モニタ（${monitorKey}）を開始すると通電状態が表示されます。`,
    /** `Shift+F3`（モニタ書込み）の注記。Plan 3B 決定表#11（Phase の番号は出さない） */
    monitorWriteSame: 'モニタと同じ動作です（本アプリにオンライン変更はありません）',
```

`JA.ladder` の末尾（`// --- /Plan 3B Task 9 ---` の直後）に足す:

```ts
    // --- Plan 4B Task 3 ---
    /** 実機の操作パネルにあるが本アプリでは動かない項目。決定表#4 */
    vendorOnly: 'このボタンは実機の操作パネルの項目で、本アプリでは動作しません',
    /** タイトルバー（スキン名は `SkinTheme.titleBar`）。§15 / §17.1 */
    skinTitleNote: '各社の商標については設定画面の「このアプリについて」をご覧ください',
    /** ステータスバーの項目名。 */
    statusMode: 'モード',
    statusPlcState: 'PLC',
    statusScan: 'スキャン',
    statusNetwork: '回路ブロック',
    statusOverwrite: '入力',
    statusDeviceCount: 'デバイス点数',
    statusInsert: '挿入',
    statusOverwriteMode: '上書き',
    // --- /Plan 4B Task 3 ---
```

呼び出し側の追随（`tsc` が全部教えてくれる）:

| ファイル | 直し方 |
|---|---|
| `ladder/LadderWorkspace.tsx` | `JA.ladder.readOnly` → `JA.ladder.readOnly(shortcutKeyOf(profile, 'write-mode') ?? 'F2')` |
| `ladder/OutputWindow.tsx` | 下の Step 5 のとおり `convertKey` で分岐 |
| `ladder/MonitorPanel.tsx` | `JA.ladder.monitorOff` → `JA.ladder.monitorOff(shortcutKeyOf(profile, 'monitor') ?? 'F3')` |

- [ ] **Step 4: `ladder/SkinFrame.tsx` を作る**

```tsx
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import type { SkinStatusItem, SkinTheme } from './skins/index.js';
import styles from './ladder.module.css';

/**
 * スキンの枠（タイトルバーとステータスバー）。設計仕様 §10.6 / §12.1 / §17.1。決定表#7
 *
 * 利用者要求（2026-09-19）「各メーカーのソフト画面に合わせた可能な限り実物に忠実な画面」に
 * 対する部分である。**各社のロゴ・アイコン・画面キャプチャは持たない**（§17）。出すのは
 * 「`<ツール名> 風`」という文字と、実機のステータスバーが見せている種類の値だけである。
 */

/** ステータスバーの1項目。値はストアから引くので、新しい状態は増えない。 */
function StatusItem({ item }: { item: SkinStatusItem }): JSX.Element | null {
  const mode = useStore((s) => s.ladderMode);
  const running = useStore((s) => s.plcRunning);
  const scan = useStore((s) => s.plcMonitor?.scanCount);
  const networkId = useStore((s) => s.ladderCursor.networkId);
  const insertMode = useStore((s) => s.insertMode);
  const usage = useStore((s) => s.convertIssues.usage);
  const text = ((): string => {
    switch (item) {
      case 'mode':
        return `${JA.ladder.statusMode}: ${
          mode === 'write' ? JA.plc.modeWrite : mode === 'read' ? JA.plc.modeRead : JA.plc.modeMonitor
        }`;
      case 'plc-state':
        return `${JA.ladder.statusPlcState}: ${running ? JA.ladder.run : JA.ladder.stop}`;
      case 'scan':
        return `${JA.ladder.statusScan}: ${scan === undefined ? '—' : String(scan)}`;
      case 'network':
        return `${JA.ladder.statusNetwork}: ${networkId}`;
      case 'overwrite':
        return `${JA.ladder.statusOverwrite}: ${
          insertMode === 'insert' ? JA.ladder.statusInsert : JA.ladder.statusOverwriteMode
        }`;
      case 'device-count':
        return `${JA.ladder.statusDeviceCount}: ${String(
          (usage?.reads.length ?? 0) + (usage?.writes.length ?? 0),
        )}`;
    }
  })();
  return (
    <span className={styles.statusItem} data-testid={`status-${item}`}>
      {text}
    </span>
  );
}

/** タイトルバー。スキン名（「風」つき）と商標の案内だけを出す。§15 / §17.1 */
export function SkinTitleBar({
  theme,
  profile,
}: {
  theme: SkinTheme;
  profile: DialectProfile;
}): JSX.Element {
  return (
    <div className={styles.titleBar} data-testid="skin-title">
      <span className={styles.titleBarName}>{theme.titleBar}</span>
      <span>{profile.displayName}</span>
      <span className={styles.titleBarNote}>{JA.ladder.skinTitleNote}</span>
    </div>
  );
}

/** ステータスバー。項目はスキンが決める（決定表#7）。 */
export function SkinStatusBar({ theme }: { theme: SkinTheme }): JSX.Element {
  return (
    <div className={styles.statusBar} data-testid="skin-status" role="status">
      {theme.statusItems.map((item) => (
        <StatusItem key={item} item={item} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: `OutputWindow.tsx` に `convertKey` を足す**

```tsx
export function OutputWindow({
  issues,
  converted,
  convertKey,
  onJump,
}: {
  issues: ConvertIssues;
  converted: boolean;
  /** 「変換」のキー。無いスキン（`convertStep: false`）では `undefined`。決定表#3 */
  convertKey: string | undefined;
  onJump: (cursor: LadderCursor) => void;
}): JSX.Element {
```

```tsx
        <span data-testid="convert-state" className={converted ? styles.okTag : styles.ngTag}>
          {converted
            ? JA.ladder.convertOk
            : convertKey === undefined
              ? JA.ladder.notConvertedAuto
              : JA.ladder.notConverted(convertKey)}
        </span>
```

- [ ] **Step 6: `LadderWorkspace.tsx` をスキンで駆動する**

import に足す（既存の import 行に混ぜる）:

```ts
import { useEffect, useRef } from 'react';                          // 既存の react import に足す
import { shortcutKeyOf } from '../session/ladder.js';                // 既存行に足す
import { autoConvert, toolbarItems, type ToolbarAction } from '../session/plc-skin.js';
import { skinCssVars, skinThemeOf } from './skins/index.js';
import { SkinStatusBar, SkinTitleBar } from './SkinFrame.js';
```

`TOOLBAR_ACTIONS` の定義（`type ToolbarAction` ごと）を**丸ごと削除**する。購読を足す:

```ts
  const plcRunning = useStore((s) => s.plcRunning);
  const monitorColor = useStore((s) => s.monitorColor);
  const theme = useMemo(() => skinThemeOf(profile), [profile]);
  const cssVars = useMemo(() => skinCssVars(theme, monitorColor), [theme, monitorColor]);
```

`convert()` を差し替える:

```ts
  /**
   * 「変換」。成功したときだけ Worker へ載せる（4A H-3）。§10.6
   * `silent` は自動変換（`convertStep: false` のスキン）から呼ぶとき。結果は出力ウィンドウに
   * 出るので、編集のたびにトーストを積まない（決定表#3）。
   */
  /*
   * `onPlc` は呼び出し側（`LadderEditor` → `PlcSession`）が**毎レンダー作り直す無名関数**である。
   * そのまま `convert` の依存に入れると `convert` も毎レンダー新しくなり、下の自動変換の
   * `useEffect` が毎レンダー走って「変換 → setConverted → 再レンダー → 変換」のループになる
   * （レビュー I12）。ref に持ち替えて、`convert` の同一性を `profile` だけに結びつける。
   */
  const onPlcRef = useRef(onPlc);
  useEffect(() => {
    onPlcRef.current = onPlc;
  }, [onPlc]);

  const convert = useCallback(
    (options: { silent?: boolean } = {}): void => {
      const store = useStore.getState();
      const current = store.ladder;
      if (current === undefined) return;
      const run = runConvert(current, profile);
      store.setConverted(run.ok, run.issues);
      if (!run.ok) {
        if (options.silent !== true) store.toast(JA.ladder.convertFailed, 'error');
        return;
      }
      onPlcRef.current({ kind: 'load', program: current });
      if (options.silent !== true) store.toast(JA.ladder.convertOk);
    },
    [profile],
  );

  /**
   * 「変換」のないスキンでは、ラダーが変わるたびに黙って変換し直す（決定表#3）。
   * 判定は変換済みのラダーしか受け取らない（4A H-3）ので、押す場所が無い以上ここで走らせる。
   *
   * 依存は実質 `[auto, program]` である（`convert` は上のとおり `profile` が変わったときしか
   * 作り直されないので、`react-hooks/exhaustive-deps` を満たしたまま余計に走らない。I12）。
   */
  const auto = autoConvert(profile);
  useEffect(() => {
    if (!auto || program === undefined) return;
    convert({ silent: true });
  }, [auto, program, convert]);
```

`edit()` の断り文句にキーを渡す（`useCallback` の依存配列に `profile` を足す）:

```ts
      if (store.ladderMode !== 'write') {
        store.toast(JA.ladder.readOnly(shortcutKeyOf(profile, 'write-mode') ?? 'F2'), 'error');
        return false;
      }
```

`onToolbar` を新しい `ToolbarAction` に合わせる:

```ts
  const onToolbar = (action: ToolbarAction): void => {
    const store = useStore.getState();
    const convertKey = shortcutKeyOf(profile, 'convert');
    switch (action) {
      case 'convert':
      case 'convert-all':
        convert();
        break;
      case 'write-mode':
        changeMode('write');
        break;
      case 'read-mode':
        changeMode('read');
        break;
      case 'online':
      case 'download':
        // 本アプリでは「変換」がそのまま書込みに当たる（意図的な差分 #2）
        if (!store.converted) {
          store.toast(
            convertKey === undefined
              ? JA.ladder.notConvertedAuto
              : JA.ladder.notConverted(convertKey),
            'error',
          );
          break;
        }
        onPlc({ kind: 'load', program });
        store.toast(JA.ladder.downloaded);
        break;
      case 'monitor-start':
        changeMode('monitor');
        break;
      case 'monitor-stop':
        changeMode('read');
        break;
      case 'plc-run':
        onPlc({ kind: 'run', on: !store.plcRunning });
        store.setPlcRunning(!store.plcRunning);
        break;
      case 'plc-stop':
        onPlc({ kind: 'run', on: false });
        store.setPlcRunning(false);
        break;
      case 'plc-reset':
        onPlc({ kind: 'reset' });
        break;
      case 'vendor-only':
        store.toast(JA.ladder.vendorOnly);
        break;
    }
  };
```

ルート要素と枠:

```tsx
  const items = toolbarItems(profile);
  return (
    <div
      className={styles.workspace}
      data-testid="ladder-workspace"
      data-skin={theme.id}
      data-output-pane={theme.layout.outputPane}
      // スキンの色と寸法は**ここ1回だけ**流し込む（決定表#5）
      style={cssVars as CSSProperties}
    >
      <SkinTitleBar theme={theme} profile={profile} />
      <div className={styles.toolbar} role="group" aria-label={JA.ladder.title}>
        {items.map((item) => {
          const first = items.findIndex((other) => other.action === item.action) === item.index;
          return (
            <button
              key={`${item.action}-${String(item.index)}`}
              type="button"
              // その action の**最初の1つ**は位置なし（既存テストと E2E がこの名前で引く）、
              // 2つ目以降は位置つき（PCwin風は `vendor-only` が4つ並ぶ）
              data-testid={
                first ? `toolbar-${item.action}` : `toolbar-${item.action}-${String(item.index)}`
              }
              data-action={item.action}
              className={item.action === 'vendor-only' ? styles.vendorTool : undefined}
              aria-pressed={item.action === 'plc-run' ? plcRunning : undefined}
              onClick={() => {
                onToolbar(item.action);
              }}
            >
              {item.label}
            </button>
          );
        })}
        <span className={styles.toolbarGap} />
        {/* 回路ブロック・行の4ボタンは既存のまま（Plan 3B 決定表#12） */}
```

`OutputWindow` の呼び出しを差し替え、PCwin風は畳む:

```tsx
          <div
            className={
              theme.layout.outputPane === 'status-bar' ? styles.outputCollapsed : undefined
            }
          >
            <OutputWindow
              issues={issues}
              converted={converted}
              convertKey={shortcutKeyOf(profile, 'convert')}
              onJump={(next) => {
                useStore.getState().setLadderCursor(next);
              }}
            />
          </div>
```

`workspaceBody` を閉じたあと（`</div>` の直前）に足す:

```tsx
      <SkinStatusBar theme={theme} />
```

`import type { CSSProperties }` を react の型 import に足す。

- [ ] **Step 7: `PlcSession.tsx` の手順表を畳む**

import に足す:

```ts
import { skinGridCols, skinStepKeys, type PlcStepKey } from '../session/plc-skin.js';
```

`gridCols` の行を差し替える:

```ts
  /** 表示列数は設定画面の値。`0` なら方言の既定（§10.6 / 決定表#8）。 */
  const gridColsSetting = useStore((s) => s.ladderGridCols);
  const gridCols = skinGridCols(profile, gridColsSetting);
```

`steps` の定義を差し替える:

```ts
  const written = hasLadderContent(ladder);
  const stepState: Readonly<Record<PlcStepKey, StepState>> = {
    wire: 'anytime',
    ladder: written ? 'done' : 'current',
    convert: converted ? 'done' : written ? 'current' : 'todo',
    // 「変換」の無いスキンは、ラダーを書いた時点で（自動変換が通れば）運転へ進める
    run: plcRunning ? 'done' : converted ? 'current' : 'todo',
    judge: readiness.ok && modelKnown ? 'current' : 'todo',
  };
  const stepLabel: Readonly<Record<PlcStepKey, string>> = {
    wire: JA.plc.stepWire,
    ladder: JA.plc.stepLadder,
    convert: JA.plc.stepConvert,
    run: JA.plc.stepRun,
    judge: JA.plc.stepJudge,
  };
  const steps = skinStepKeys(profile).map((key) => ({
    key,
    label: stepLabel[key],
    state: stepState[key],
  }));
  const currentStepKey = steps.find((step) => step.state === 'current')?.key;
```

`stepHintText()` の引数の型を `PlcStepKey | undefined` にする（`'convert'` の枝はそのまま残す。三菱・シャープが使う）。

`judgeTitle` のキー無しの枝を足す:

```ts
  const convertKey = shortcutKeyOf(profile, 'convert');
  const judgeTitle = !modelKnown
    ? JA.plc.unknownModel(problem.plc.model)
    : readiness.ok
      ? JA.session.judge
      : readiness.reason === 'no-ladder'
        ? JA.plc.judgeNoLadder
        : convertKey === undefined
          ? JA.plc.judgeAutoConverting
          : JA.plc.judgeNotConverted(convertKey);
```

`JA.plc` に足す（`// --- /Plan 3B Task 12 ---` の直前）:

```ts
    // --- Plan 4B Task 3 ---
    /** 「変換」のないスキンで、まだ変換が通っていないとき。決定表#3 */
    judgeAutoConverting: 'ラダーに直すところがあります（出力ウィンドウを確認してください）',
    // --- /Plan 4B Task 3 ---
```

- [ ] **Step 8: 既存テストを追随させる**

| ファイル | 直し方 |
|---|---|
| `test/ladder-workspace.test.tsx` | `TOOLBAR_ACTIONS` の import を消し、`toolbarItems(MITSUBISHI_FX5U)` で回す（三菱の8件は並びが変わらないので期待値はそのまま） |
| `test/output-window.test.tsx` | `render(<OutputWindow … />)` に `convertKey="F4"` を足す |
| `test/ladder-panels.test.tsx` | `MonitorPanel` の「モニタを開始すると…」を引いているケースがあれば文言はそのまま（関数化しても出力は同じ） |

- [ ] **Step 9: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/skin-workspace.test.tsx test/ladder-workspace.test.tsx test/output-window.test.tsx test/ladder-panels.test.tsx test/plc-session-screen.test.tsx
pnpm --filter @ojt/desktop exec tsc -p tsconfig.json --noEmit
```

Expected: すべて通過（`skin-workspace.test.tsx` は 4 describe / **14 ケース**）。`tsc` は無警告。

```powershell
git add apps/desktop/src/renderer/ladder apps/desktop/src/renderer/screens/PlcSession.tsx apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test
git commit -m "feat(desktop): drive the ladder workspace, title bar and status bar from the skin"
```

---

## Task 4: 回路入力画面の描画をスキンに合わせる（セル寸法・記号・コメント）

**モデル: Opus**（記号の作図をスキン別にする設計判断があるため）

**Files:**
- Modify: `apps/desktop/src/renderer/ladder/symbols.ts`
- Modify: `apps/desktop/src/renderer/ladder/LadderGrid.tsx`
- Modify: `apps/desktop/src/renderer/ladder/LadderEditor.tsx`（`theme` を渡す）
- Modify: `apps/desktop/src/renderer/ladder/ladder.module.css`（末尾追記）
- Test: `apps/desktop/test/skin-grid.test.tsx`（新規）
- Test: `apps/desktop/test/ladder-grid.test.tsx` / `ladder-symbols.test.ts`（追随）

利用者要求「実物に忠実な回路入力画面」の**描画側**である。「実物との対応」表のセル寸法・線幅・接点の余白・コメント行数を効かせる。**記号の形そのもの（接点2本の縦棒・コイルの丸括弧）は4スキン共通**で、変わるのは寸法と線の太さだけである（決定表#6。形を分けても一次資料の裏づけが無く、△ を増やすだけになる）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/skin-grid.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { SKIN_THEMES } from '../src/renderer/ladder/skins/index.js';
import { CELL_H, CELL_W, GX_CELL, symbolMetrics } from '../src/renderer/ladder/symbols.js';

describe('スキン別の記号の寸法（決定表#6）', () => {
  it('keeps the GX Works3 numbers as the default', () => {
    const gx = symbolMetrics(GX_CELL);
    expect(gx.w).toBe(CELL_W);
    expect(gx.h).toBe(CELL_H);
    expect(gx.wireY).toBe(CELL_H / 2);
    expect(symbolMetrics(SKIN_THEMES['mitsubishi'].cell).w).toBe(48);
  });

  it('follows the theme for every skin', () => {
    expect(symbolMetrics(SKIN_THEMES['omron'].cell).w).toBe(52);
    expect(symbolMetrics(SKIN_THEMES['omron'].cell).h).toBe(40);
    expect(symbolMetrics(SKIN_THEMES['jtekt'].cell).w).toBe(46);
    expect(symbolMetrics(SKIN_THEMES['sharp'].cell).h).toBe(38);
  });

  it('draws the same two bars for an NO contact in every skin, at the skin size', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      const metrics = symbolMetrics(theme.cell);
      const shape = metrics.shape('contact-no');
      expect(shape.paths, theme.id).toHaveLength(2);
      for (const path of shape.paths) {
        // 縦棒は `M x top L x bottom` の形で、上下の余白はスキンの `barInsetPx`
        expect(path, theme.id).toMatch(
          new RegExp(`^M [\\d.]+ ${String(theme.cell.barInsetPx)} L [\\d.]+ `, 'u'),
        );
      }
      expect(metrics.shape('contact-nc').paths).toHaveLength(3);
      expect(metrics.shape('coil-round').paths).toHaveLength(2);
      expect(metrics.shape('coil-set').text).toBe('S');
      // 知らない識別子は `?` 付きの接点（landed の `symbolShape()` と同じ倒し方。`undefined` にしない）
      expect(metrics.shape('no-such-symbol').text, theme.id).toBe('?');
      // `END_MARK` と同じく**2本の縦棒の配列**である（1本の文字列ではない）
      expect(metrics.endMark, theme.id).toHaveLength(2);
      // 縦リンクはセルの**左辺**（landed の `LINK_DOWN` と同じ `M 0 …`）で、下端は `h + wireY`
      expect(metrics.linkDown, theme.id).toBe(
        `M 0 ${String(metrics.wireY)} L 0 ${String(metrics.h + metrics.wireY)}`,
      );
      // コイルの弧の `rx` はスキンの `coilRxPx`
      expect(metrics.shape('coil-round').paths[0], theme.id).toContain(
        `A ${String(theme.cell.coilRxPx)} `,
      );
    }
  });

  it('returns the same object for the same cell (memoised, so `memo` keeps working)', () => {
    expect(symbolMetrics(SKIN_THEMES['omron'].cell)).toBe(
      symbolMetrics(SKIN_THEMES['omron'].cell),
    );
  });

  it('bridges the hidden columns from the coil column, at the right row', () => {
    const omron = symbolMetrics(SKIN_THEMES['omron'].cell);
    /*
     * landed の `leadAcrossHidden(lastContactIndex, row)` と**同じ2引数・同じ規則**である
     * （3B 最終修正）。始点は「コイル列の左端」＝ `(lastContactIndex + 1) × セル幅` で、
     * 終点は記号の左端まで。最後の接点セルの絵の上をオーバーレイが横切らない。
     */
    expect(omron.leadAcrossHidden(4, 0)).toBe(`M ${String(5 * 52)} 20 L ${String(5 * 52 + 17)} 20`);
    // 行の `<g>` には移動が掛かっていないので、縦位置はこの線自身が持つ
    expect(omron.leadAcrossHidden(4, 2)).toContain(` ${String(2 * 40 + 20)} `);
  });
});
```

`apps/desktop/test/ladder-grid.test.tsx` に足す（グリッドがテーマの寸法で描かれること）:

```tsx
  it('sizes the cells from the skin (利用者要求: 実物に近い画面)', () => {
    renderGrid({ profile: OMRON_CP1E });
    const svg = screen.getByRole('grid', { name: /n1/u });
    // OMRON は 52×40。接点11列＋コイル列1＋母線6px
    expect(svg.getAttribute('height')).toBe('40');
    expect(Number(svg.getAttribute('width'))).toBe(12 * 52 + 6);
  });

  it('shows two comment lines in the CX-Programmer style and one elsewhere', () => {
    renderGrid({ profile: OMRON_CP1E, comments: { X0: 'とても長いデバイスコメントの例です' } });
    expect(screen.getAllByTestId(/^comment-line-/u)).toHaveLength(2);
    cleanup();
    renderGrid({ profile: MITSUBISHI_FX5U, comments: { X0: 'とても長いデバイスコメントの例です' } });
    expect(screen.getAllByTestId(/^comment-line-/u)).toHaveLength(1);
  });
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/skin-grid.test.tsx test/ladder-grid.test.tsx
```

Expected: 失敗。`symbols.js` に `symbolMetrics` / `GX_CELL` が無い。

- [ ] **Step 3: `symbols.ts` に `symbolMetrics()` を足す**

**既存の `CELL_W` / `CELL_H` / `WIRE_Y` / `symbolShape()` / `LEAD_*` / `LINK_DOWN` / `END_MARK` / `leadAcrossHidden()` は、署名も値も1文字も変えずに残す**（GX Works3風の既定として、既存のテストと `LadderGrid` 以外の呼び出しが使う）。**実ソースを読み直し、下の `SymbolMetrics` が landed と同じ型・同じ規則になっていることを確かめてから**、その下に足す:

```ts
import type { SkinCell } from './skins/index.js';

/** GX Works3風の寸法（既定。`CELL_W` / `CELL_H` と同じ値）。 */
export const GX_CELL: SkinCell = {
  widthPx: CELL_W,
  heightPx: CELL_H,
  strokeWidth: 1.6,
  barInsetPx: 8,
  coilRxPx: 9,
};

/**
 * そのスキンの寸法で描いた記号と導線一式。
 *
 * **型と規則は landed のモジュール定数と1対1で揃える**（レビュー B2）。`endMark` は
 * `END_MARK` と同じく**配列**、`linkDown` は `LINK_DOWN` と同じく**セルの左辺**、
 * `leadAcrossHidden` は landed と同じ**2引数**、`shape()` は `symbolShape()` と同じく
 * **`undefined` を返さない**（知らない識別子は `?` 付きの接点に倒す）。こうしておけば
 * `LadderGrid` の置き換えは「名前を差し替えるだけ」で済み、見た目は色と寸法しか変わらない。
 */
export interface SymbolMetrics {
  /** セルの幅・高さ[px]と桟の縦位置。 */
  w: number;
  h: number;
  wireY: number;
  /** 左半分・右半分・全幅の導線。 */
  leadLeft: string;
  leadRight: string;
  leadFull: string;
  /** 下の行へ降りる縦リンク（`LINK_DOWN` と同じくセルの**左辺**）。 */
  linkDown: string;
  /** END の印（`END_MARK` と同じく**2本の縦棒**）。 */
  endMark: readonly string[];
  /** 省略された接点列をまたいでコイルへ繋ぐ導線（`leadAcrossHidden()` と同じ2引数）。 */
  leadAcrossHidden: (lastContactIndex: number, row: number) => string;
  /** 識別子 → 線画（`symbolShape()` と同じく、知らない識別子は `?` 付きの接点）。 */
  shape: (id: string) => SymbolShape;
}

/**
 * `SkinCell` は `ladder/skins/*.ts` のモジュール定数なので**同一性が保たれる**。
 * 同じ寸法には同じオブジェクトを返し、`memo(LadderGrid)` の props 比較を壊さない。
 */
const METRICS_CACHE = new WeakMap<SkinCell, SymbolMetrics>();

/**
 * スキンの寸法で記号を作り直す。決定表#6
 * 変えるのは**寸法と接点の縦棒の余白**だけで、形（縦棒2本・丸括弧・斜線）は4スキン共通である
 * （JIS C 0617 に沿った自前の作図。各社の図記号ビットマップは複製しない。§17）。
 */
export function symbolMetrics(cell: SkinCell): SymbolMetrics {
  const cached = METRICS_CACHE.get(cell);
  if (cached !== undefined) return cached;
  const w = cell.widthPx;
  const h = cell.heightPx;
  const wireY = h / 2;
  // 記号の横幅は 18px 固定（セルの中央に置く）。左右の余りがリード線になる
  const left = Math.round((w - 18) / 2);
  const right = left + 18;
  const top = cell.barInsetPx;
  const bottom = h - cell.barInsetPx;
  const bars = [`M ${left} ${top} L ${left} ${bottom}`, `M ${right} ${top} L ${right} ${bottom}`];
  // 横の膨らみはスキンが決める（CX-Programmer風の「やや扁平」＝ 7）。「実物との対応」表 / 決定表#6
  const arcRx = cell.coilRxPx;
  const arcRy = (bottom - top) / 2;
  const arcs = [
    `M ${left + 2} ${top} A ${arcRx} ${arcRy} 0 0 0 ${left + 2} ${bottom}`,
    `M ${right - 2} ${top} A ${arcRx} ${arcRy} 0 0 1 ${right - 2} ${bottom}`,
  ];
  const shapes: Readonly<Record<string, SymbolShape>> = {
    'contact-no': { paths: bars },
    'contact-nc': { paths: [...bars, `M ${left} ${bottom} L ${right} ${top}`] },
    'contact-rise': { paths: bars, text: '↑' },
    'contact-fall': { paths: bars, text: '↓' },
    'coil-round': { paths: arcs },
    'coil-set': { paths: arcs, text: 'S' },
    'coil-reset': { paths: arcs, text: 'R' },
    'coil-timer': { paths: arcs, text: 'T' },
    'coil-counter': { paths: arcs, text: 'C' },
    [MC_SYMBOL_ID]: { paths: arcs, text: 'MC' },
    [MCR_SYMBOL_ID]: { paths: arcs, text: 'MCR' },
  };
  // 知らない識別子の倒し先（landed の `UNKNOWN` と同じ扱い。`undefined` は返さない）
  const unknown: SymbolShape = { paths: bars, text: '?' };
  const metrics: SymbolMetrics = {
    w,
    h,
    wireY,
    leadLeft: `M 0 ${wireY} L ${left} ${wireY}`,
    leadRight: `M ${right} ${wireY} L ${w} ${wireY}`,
    leadFull: `M 0 ${wireY} L ${w} ${wireY}`,
    // `LINK_DOWN`（L88）と同じ: セルの**左辺**を、次の行の桟（`h + wireY`）まで伸ばす
    linkDown: `M 0 ${wireY} L 0 ${h + wireY}`,
    // `END_MARK`（L90）と同じ: 二重線（縦棒2本）。記号の左端から 3px / 9px の位置に置く
    endMark: [
      `M ${left + 3} ${top} L ${left + 3} ${bottom}`,
      `M ${left + 9} ${top} L ${left + 9} ${bottom}`,
    ],
    /*
     * `leadAcrossHidden()`（L101）と同じ規則。始点は「コイル列の左端」で、最後の接点セルの
     * 絵の上をオーバーレイが横切らないようにする（3B 最終修正）。
     */
    leadAcrossHidden: (lastContactIndex: number, row: number): string => {
      const y = row * h + wireY;
      const coilX = (lastContactIndex + 1) * w;
      return `M ${coilX} ${y} L ${coilX + left} ${y}`;
    },
    shape: (id: string): SymbolShape => shapes[id] ?? unknown,
  };
  METRICS_CACHE.set(cell, metrics);
  return metrics;
}
```

> `MC_SYMBOL_ID` / `MCR_SYMBOL_ID` と `SymbolShape` は既存の宣言をそのまま使う。既存の `SHAPES` テーブルと `symbolShape()` は**消さない**（`ladder-symbols.test.ts` が見張っている）。

- [ ] **Step 4: `LadderGrid.tsx` をテーマで描く**

`symbols.js` からの import を `symbolMetrics` 1本に寄せる（`CELL_W` / `CELL_H` / `LEAD_*` / `END_MARK` / `LINK_DOWN` / `leadAcrossHidden` / `symbolShape` の import を落とす。`COIL_COL` などの `ladder-core` からの import はそのまま）。`LadderGrid` / `NetworkGrid` / `GridCell` の props に `theme: SkinTheme` を足し、先頭で:

```ts
  const metrics = symbolMetrics(theme.cell);
```

置き換えの対応:

**署名が変わるものは1つも無い**（レビュー B2）。名前を差し替えるだけで、JSX の形も引数の並びも
そのままにする。テーマが変えるのは**色と寸法だけ**で、絵の描き方は変わらない:

| 置き換え前（landed） | 置き換え後 | 型 |
|---|---|---|
| `CELL_W` | `metrics.w` | `number` |
| `CELL_H` | `metrics.h` | `number` |
| `WIRE_Y` | `metrics.wireY` | `number` |
| `LEAD_LEFT` / `LEAD_RIGHT` / `LEAD_FULL` | `metrics.leadLeft` / `metrics.leadRight` / `metrics.leadFull` | `string` |
| `LINK_DOWN` | `metrics.linkDown` | `string`（どちらもセルの左辺 `M 0 …`） |
| `END_MARK`（`.map()` で2本の `<path>` を描いている） | `metrics.endMark` | `readonly string[]`（**`.map()` の形はそのまま**） |
| `leadAcrossHidden(lastContactIndex, row)` | `metrics.leadAcrossHidden(lastContactIndex, row)` | **引数2つのまま** |
| `symbolShape(id)` | `metrics.shape(id)` | `SymbolShape`（**`undefined` にならないので `?.` を足さない**） |

デバイスコメントの行数をテーマから引く（`GridCell` の描画部）:

```tsx
              {/*
                デバイスコメントは記号の**下**に `theme.commentLines` 行で出す
                （CX-Programmer風は2行。「実物との対応」表）。長い文字は行ごとに切る。
              */}
              {comment === undefined
                ? null
                : commentLines(comment, theme.commentLines, COMMENT_CHARS).map((line, index) => (
                    <text
                      key={line + String(index)}
                      className={styles.commentText}
                      data-testid={`comment-line-${String(index)}`}
                      x={metrics.w / 2}
                      y={metrics.h - 2 - (theme.commentLines - 1 - index) * COMMENT_LINE_H}
                    >
                      {line}
                    </text>
                  ))}
```

`symbolIdOf()` に**シャープの常時ON**の扱いを足す（4A H-4）。`profile.specialInverted` に
載っている特殊デバイス番号の接点は**b接点の線画**で描く:

```ts
/** セルの記号（`SymbolDrawing` の識別子）。線画を持たないセル（`empty` / 導線）は `undefined`。 */
function symbolIdOf(cell: Cell, profile: DialectProfile): string | undefined {
  const symbols = profile.symbols;
  switch (cell.kind) {
    case 'contact': {
      /*
       * 実機ではb接点で使う特殊デバイス（シャープの `007366`＝常時ON。4A H-4 / §17 #22）。
       * IRの `SP0` は「常時ON」という意味そのもので、a接点で描くと実機の見た目と食い違う。
       * 判定・ランタイムには一切効かない**表示だけ**の話である。
       */
      const inverted =
        cell.device.kind === 'special' &&
        (profile.specialInverted ?? []).includes(cell.device.index);
      if (cell.type === 'NO') return inverted ? symbols.nc : symbols.no;
      if (cell.type === 'NC') return inverted ? symbols.no : symbols.nc;
      // 微分接点（`P` / `F`）は反転しない（立上り／立下りそのものが向きを持つ）
      return cell.type === 'P' ? symbols.rise : symbols.fall;
    }
    case 'coil':
      return cell.type === 'SET' ? symbols.set : cell.type === 'RST' ? symbols.rst : symbols.coil;
    case 'timer':
      return symbols.timer;
    case 'counter':
      return symbols.counter;
    case 'mc':
      return MC_SYMBOL_ID;
    case 'mcr':
      return MCR_SYMBOL_ID;
    default:
      // `empty` / `hline` / `vline` は記号を持たない（導線は `metrics.lead*` が描く）
      return undefined;
  }
}
```

> `case` の並びと戻り値は landed 実装（`LadderGrid.tsx`）と同じである。**変わったのは
> `'contact'` の枝に `inverted` の2行が入ったことだけ**なので、写す前に実ソースを読み直し、
> `Cell['kind']` の列挙が増えていないことを確かめる。

テストに1ケース足す（`test/skin-grid.test.tsx`）:

```tsx
  it('draws the SHARP always-on special relay as an NC contact (4A H-4)', () => {
    expect(SHARP_JW300.specialInverted).toContain(SPECIAL_ALWAYS_ON);
    renderGrid({ profile: SHARP_JW300, cell: no(SP(SPECIAL_ALWAYS_ON)) });
    expect(screen.getByTestId('cell-n1:0:0').querySelector('path[data-symbol]')).toHaveAttribute(
      'data-symbol',
      SHARP_JW300.symbols.nc,
    );
    // 他の3方言は a接点のまま
    cleanup();
    renderGrid({ profile: MITSUBISHI_FX5U, cell: no(SP(SPECIAL_ALWAYS_ON)) });
    expect(screen.getByTestId('cell-n1:0:0').querySelector('path[data-symbol]')).toHaveAttribute(
      'data-symbol',
      MITSUBISHI_FX5U.symbols.no,
    );
  });
```

（`data-symbol` 属性が無ければ `GridCell` の `<path>` に足す。`SP` / `SPECIAL_ALWAYS_ON` は
`@ojt/ladder-core` から import する。）

ファイル上部に足す:

```ts
/** デバイスコメント1行の文字数（セル幅に収まる目安）。 */
const COMMENT_CHARS = 6;
/** デバイスコメントの行間[px]。 */
const COMMENT_LINE_H = 8;

/** コメントを `lines` 行に折り返す（入りきらない分は最後の行の末尾を `…` にする）。 */
export function commentLines(text: string, lines: number, perLine: number): string[] {
  if (lines <= 0 || text.length === 0) return [];
  const out: string[] = [];
  for (let index = 0; index < lines; index += 1) {
    const slice = text.slice(index * perLine, (index + 1) * perLine);
    if (slice.length === 0) break;
    const last = index === lines - 1 && text.length > (index + 1) * perLine;
    out.push(last ? `${slice.slice(0, Math.max(0, perLine - 1))}…` : slice);
  }
  return out;
}
```

- [ ] **Step 5: `LadderEditor.tsx` から `theme` を渡す**

```ts
import { skinThemeOf } from './skins/index.js';
// …
  const theme = useMemo(() => skinThemeOf(profile), [profile]);
```

`<LadderGrid … theme={theme} />` を足す（`profile` の隣）。

- [ ] **Step 6: `ladder.module.css` の末尾に追記する**

```css
/* --- Plan 4B Task 4: スキンの格子線（「実物との対応」表） --- */
.gridScroll {
  background-image: linear-gradient(
      to right,
      var(--skin-grid, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(to bottom, var(--skin-grid, transparent) 1px, transparent 1px);
  background-size: var(--skin-cell-w, 48px) var(--skin-cell-h, 36px);
}
```

> `--skin-grid` を背景と同色にしているスキン（GX Works3風・JW-300SP風）では格子線が見えない。
> 「実物との対応」表の「格子線: 無し」がそのまま実装になる。

- [ ] **Step 7: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/skin-grid.test.tsx test/ladder-grid.test.tsx test/ladder-symbols.test.ts test/ladder-editor.test.tsx
npx prettier --check "apps/desktop/src/renderer/ladder/**/*.{ts,tsx,css}"
```

Expected: すべて通過（`skin-grid.test.tsx` は **6 ケース**）。

```powershell
git add apps/desktop/src/renderer/ladder apps/desktop/test
git commit -m "feat(desktop): draw the ladder grid at each skin's size and comment style"
```

---

## Task 5: デバイス入力欄・キー割当表・I/O表・モニタ一覧の方言／機種対応

**モデル: Sonnet**（本書のコードをそのまま書き写せば通る）

**Files:**
- Modify: `apps/desktop/src/renderer/session/ladder-cell.ts`（カウンタ設定値を方言へ寄せる。申し送り F-2）
- Modify: `apps/desktop/src/renderer/ladder/DeviceInput.tsx`
- Modify: `apps/desktop/src/renderer/ladder/ShortcutHelp.tsx`
- Modify: `apps/desktop/src/renderer/ladder/IoTable.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/device-input.test.tsx` / `ladder-panels.test.tsx` / `ladder-cell.test.ts`（追記）

§16 Phase 4 受入基準④（シャープで `8` を入れると8進エラー）の画面側と、4A Task 8 の `PlcUnitSpec` 格上げ（前提#25）への追随である。**エラー文言は `profile.parseDevice()` が返す `Error` をそのまま出す**ので、直すのは「入力例」「注記」「端子名の引き方」と、**カウンタ設定値の綴り**（landed の `ladder-cell.ts` が三菱の `K` に固定している。4A Task 7 が
プロファイルへ対を landed させたので、そちらへ寄せる。申し送り F-2）だけである。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/device-input.test.tsx` の末尾に足す:

```tsx
describe('方言ごとの入力例とエラー（§10.5 / §16 Phase 4 受入基準④）', () => {
  function hintOf(profile: DialectProfile): string {
    cleanup();
    render(
      <DeviceInput
        initial={emptyCellForm('contact')}
        profile={profile}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    return screen.getByTestId('device-text').getAttribute('placeholder') ?? '';
  }

  it('shows the first input point in the dialect spelling, not a bare prefix', () => {
    expect(hintOf(MITSUBISHI_FX5U)).toBe('X0');
    expect(hintOf(OMRON_CP1E)).toBe('0.00');
    expect(hintOf(JTEKT_PC10G)).toBe('1X000');
    expect(hintOf(SHARP_JW300)).toBe('000000');
  });

  it('shows the counter preset in the dialect spelling', () => {
    cleanup();
    render(
      <DeviceInput
        initial={{ ...emptyCellForm('output'), output: 'CTU' }}
        profile={OMRON_CP1E}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // OMRON のカウンタ設定値は `#0005`（4A Task 7 / d721b23。申し送り F-2）
    expect(screen.getByTestId('preset-text')).toHaveAttribute('placeholder', '#0005');
  });

  it('shows the octal error of the JW-300SP skin (受入基準④)', () => {
    const onCommit = vi.fn();
    render(
      <DeviceInput
        initial={emptyCellForm('contact')}
        profile={SHARP_JW300}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    act(() => {
      fireEvent.change(screen.getByTestId('device-text'), { target: { value: '000008' } });
      fireEvent.click(screen.getByTestId('device-commit'));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('device-error')).toHaveTextContent('8進');
  });

  it('accepts the OMRON ch.bit spelling', () => {
    const onCommit = vi.fn();
    render(
      <DeviceInput
        initial={emptyCellForm('contact')}
        profile={OMRON_CP1E}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    act(() => {
      fireEvent.change(screen.getByTestId('device-text'), { target: { value: '0.08' } });
      fireEvent.click(screen.getByTestId('device-commit'));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

`apps/desktop/test/ladder-panels.test.tsx` に足す:

```tsx
describe('キー割当表と端子名のスキン差（§10.6 / §10.1）', () => {
  it('drops the 変換 row where the skin has no convert step', () => {
    render(<ShortcutHelp profile={OMRON_CP1E} />);
    expect(screen.queryByTestId('shortcut-convert')).toBeNull();
    expect(screen.getByTestId('shortcuts-convert-note')).toHaveTextContent('変換');
    cleanup();
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.queryByTestId('shortcuts-convert-note')).toBeNull();
    expect(screen.getByTestId('shortcut-convert')).toHaveTextContent('F4');
  });

  it('marks the assumed key bindings of every skin (§17.1)', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      render(<ShortcutHelp profile={profile} />);
      for (const entry of profile.shortcuts.filter((s) => !s.confirmed)) {
        expect(
          screen.getByTestId(`shortcut-${entry.action}`),
          `${profile.id}/${entry.action}`,
        ).toHaveTextContent('本アプリの表記です');
      }
    }
  });

  it('names the terminals of the model, not the Mitsubishi spelling (4A H-1)', () => {
    render(<IoTable io={IO} profile={OMRON_CP1E} unit={PLC_UNIT_CP1E} />);
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('PLC.0.00');
    cleanup();
    render(<IoTable io={IO} profile={SHARP_JW300} unit={PLC_UNIT_JW300} />);
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('PLC.A0');
    expect(screen.getByTestId('io-common')).toHaveTextContent('COM.A');
  });
});
```

（`IO` は既存のヘルパ、`PLC_UNIT_CP1E` / `PLC_UNIT_JW300` は `@ojt/board-model` から import する。
`emptyCellForm()` の引数は **`'contact' | 'output'` の2値**である（`ladder-cell.ts` L49。
`'contact-no'` や `'coil'` は**セルの種別で、入力欄の `target` ではない**）。）

`apps/desktop/test/ladder-cell.test.ts` に足す（申し送り F-2 のフォールバックと、生えた後の両方）:

```ts
describe('カウンタ設定値を方言へ寄せる（§10.5 / 申し送り F-2）', () => {
  it('spells the preset the way each dialect does (4A Task 7)', () => {
    expect(counterPresetText(5, MITSUBISHI_FX5U)).toBe('K5');
    expect(counterPresetText(5, OMRON_CP1E)).toBe('#0005');
    expect(counterPresetText(5, JTEKT_PC10G)).toBe('H0005');
    expect(counterPresetText(5, SHARP_JW300)).toBe('0005');
  });

  it('reads the preset in each dialect spelling', () => {
    expect(parseCounterPreset('K5', MITSUBISHI_FX5U)).toBe(5);
    expect(parseCounterPreset('#0005', OMRON_CP1E)).toBe(5);
    // OMRON は BIN 表記（`&`）も受ける（4A 意図的な差分#7）
    expect(parseCounterPreset('&5', OMRON_CP1E)).toBe(5);
    expect(parseCounterPreset('H0005', JTEKT_PC10G)).toBe(5);
    expect(parseCounterPreset('0005', SHARP_JW300)).toBe(5);
    // 別の方言の綴りは受けない
    expect(parseCounterPreset('K5', OMRON_CP1E)).toBeInstanceOf(Error);
  });

  it('also takes a plain number, like the timer field does', () => {
    expect(parseCounterPreset('5', MITSUBISHI_FX5U)).toBe(5);
    expect(parseCounterPreset('5', OMRON_CP1E)).toBe(5);
  });

  it('refuses a preset that is not a positive integer', () => {
    expect(parseCounterPreset('K0', MITSUBISHI_FX5U)).toBeInstanceOf(Error);
    expect(parseCounterPreset('0', MITSUBISHI_FX5U)).toBeInstanceOf(Error);
    expect(parseCounterPreset('あ', MITSUBISHI_FX5U)).toBeInstanceOf(Error);
    expect(parseCounterPreset('', MITSUBISHI_FX5U)).toBeInstanceOf(Error);
  });
});
```

（`JTEKT_PC10G` / `SHARP_JW300` / `OMRON_CP1E` と `counterPresetText` / `parseCounterPreset` を
import に足す。）

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/device-input.test.tsx test/ladder-panels.test.tsx
```

Expected: 失敗。`expected '0' to be '0.00'`、`Unable to find … [data-testid="io-common"]`、
`counterPresetText is not exported by src/renderer/session/ladder-cell.ts`。

- [ ] **Step 3: `session/ladder-cell.ts` のカウンタ設定値を方言へ寄せる（申し送り F-2）**

landed の `ladder-cell.ts` は L46 で `const COUNTER_PRESET_PREFIX = /^K/iu;`（三菱の `K30` の `K`）を
持ち、L148 の `buildCell()` がそれで剥がしている。**4方言では綴りが違う**（三菱 `K5` / OMRON `#0005` /
JTEKT `H0005` / シャープ `0005`）ので、方言のフックへ寄せる。**フックは 4A Task 7（d721b23）で
landed 済み**（前提#8 / 申し送り F-2）なので、そのまま使う——**三菱へのフォールバックは要らない**。

`ladder-cell.ts` の `COUNTER_PRESET_PREFIX` の宣言（L42-46）を削除し、代わりに置く:

```ts
/** 1以上の整数であることだけを確かめる（番号帯の上限は `profile.validate()` が見る）。 */
function checkedCounterPreset(preset: number): number | Error {
  return Number.isInteger(preset) && preset >= 1
    ? preset
    : new Error('カウンタの設定値は1以上の整数にします');
}

/**
 * カウンタ設定値の綴り → 数。§10.5 / 申し送り F-2
 *
 * 綴りの持ち主は `DialectProfile`（三菱 `K5` / OMRON `#0005` / JTEKT `H0005` / シャープ `0005`。
 * 4A Task 7 / d721b23）。タイマの {@link timerPresetMs} と同じく、**素の数値（`5`）も受ける**
 * ——訓練者が方言の頭字を知らなくても入力できるようにするためで、Phase 3 からの振る舞いでもある。
 */
export function parseCounterPreset(text: string, profile: DialectProfile): number | Error {
  const trimmed = text.trim();
  if (trimmed.length === 0) return new Error('設定値を入力してください');
  const parsed = profile.parseCounterPreset?.(trimmed);
  if (typeof parsed === 'number') return checkedCounterPreset(parsed);
  if (/^[0-9]+$/u.test(trimmed)) return checkedCounterPreset(Number(trimmed));
  return parsed ?? new Error('カウンタの設定値を入力してください');
}

/**
 * 数 → カウンタ設定値の綴り（入力例と `Enter` での編集に使う）。
 * 4方言すべてが `counterPresetText` を持つが、型の上では任意なので素の数値へ倒す枝を置く。
 */
export function counterPresetText(preset: number, profile: DialectProfile): string {
  return profile.counterPresetText?.(preset) ?? String(preset);
}
```

`buildCell()` の `CTU` の枝（landed L146-154）を差し替える:

```ts
  // Phase 4: 設定値の綴りは方言が決める（`DialectProfile.parseCounterPreset`。申し送り F-2）
  const preset = parseCounterPreset(form.presetText, profile);
  if (preset instanceof Error) return preset;
  const reset = readDevice(form.resetText, profile);
  if (reset instanceof Error) return reset;
  return ctu(device, preset, reset);
```

`formForCell()` の `counter` の枝（landed L179-187）の `presetText` を差し替える:

```ts
      presetText: counterPresetText(cell.preset, profile),
```

> **既存テストの追随**: `test/ladder-cell.test.ts` L90 は三菱で `presetText: '5'` を期待している
> （landed は `String(cell.preset)` だった）。綴りを方言へ寄せたので **`'K5'` に直す**。
> `buildCell()` 側に素の `'5'` を渡すケース（同 L60）は**そのまま通る**（上の「素の数値も受ける」）。

- [ ] **Step 4: `DeviceInput.tsx` の入力例を `formatDevice()` から引く**

import を `import { T, X, type Cell } from '@ojt/ladder-core';` にし、`hints` を差し替える:

```ts
  /*
   * 入力例（placeholder）は**方言の綴りそのもの**から作る（前提#23）。
   * `deviceRanges.input.prefix` だけを使うと、接頭辞を持たない OMRON（`0.00`）と
   * シャープ（`000000`）で入力例が `0` になり、何を入れる欄か分からない。
   */
  const hints = useMemo(() => {
    const preset = profile.timerPreset(3_000, T(0));
    return {
      device: profile.formatDevice(X(0)),
      reset: profile.formatDevice(X(2)),
      timer: preset instanceof Error ? '3000' : preset.text,
      // カウンタは Step 3 の `counterPresetText()`（申し送り F-2 のフォールバック込み）
      counter: counterPresetText(5, profile),
    };
  }, [profile]);
```

（`import { counterPresetText } from '../session/ladder-cell.js';` を足す。`DeviceInput.tsx` は
既に `emptyCellForm` と同じモジュールから型を読んでいるので依存は増えない。）

- [ ] **Step 5: `ShortcutHelp.tsx` に「変換が無い」注記を足す**

`APP_NOTES` の直後に足す:

```ts
/**
 * 「変換」が無いスキンの注記。決定表#3
 * 表から `convert` の行が落ちている（4A の `withoutConvert()`）ので、なぜ無いのかを1行で出す。
 */
function convertNote(profile: DialectProfile): string | undefined {
  return profile.convertStep ? undefined : JA.ladder.noConvertNote;
}
```

`shortcuts-note` の段落の直後に足す:

```tsx
      {convertNote(profile) === undefined ? null : (
        <p className={styles.sideNote} data-testid="shortcuts-convert-note">
          {convertNote(profile)}
        </p>
      )}
```

- [ ] **Step 6: `IoTable.tsx` に入力コモンの行を足す**

`inputTerminal` / `outputTerminal` は **4A Task 8 が既に `?.name` へ直している**（前提#25・#20e）。
ここで足すのは入力コモンの表示だけである（機種によって1個とは限らない。4A 前提#17）。
`<table>` に `<caption>` は1つしか置けないので、既存の `io-outlet-note` のキャプションの中へ
1行として入れる:

```tsx
        <caption className={styles.sideNote}>
          <span data-testid="io-outlet-note">{JA.plc.outletNote}</span>{' '}
          <span data-testid="io-common">
            {JA.ladder.ioCommon}: {unit.spec.inputCommons.map((name) => `PLC.${name}`).join('・')}
          </span>
        </caption>
```

- [ ] **Step 7: `i18n/ja.ts` に追記する**

`JA.ladder` の Plan 4B ブロックに足す:

```ts
    /** 「変換」操作のないスキンの注記。§10.6 / 決定表#3 */
    noConvertNote:
      'このメーカーのツールには「変換」操作がありません。編集するとそのまま反映されます。',
    /** 入力コモン（機種によって1個とは限らない。4A 前提#17） */
    ioCommon: '入力コモン',
```

- [ ] **Step 8: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/device-input.test.tsx test/ladder-panels.test.tsx test/ladder-cell.test.ts test/monitor-panel.test.tsx test/ladder-editor.test.tsx
pnpm --filter @ojt/desktop exec tsc -p tsconfig.json --noEmit
```

Expected: すべて通過。`tsc` は `spec.inputs` の型追随が済んでいれば無警告。

```powershell
git add apps/desktop/src/renderer/ladder apps/desktop/src/renderer/session/ladder-cell.ts apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test
git commit -m "feat(desktop): spell hints, key table and terminals per dialect and model"
```

---

## Task 6: 設定画面で4メーカーを選べるようにする（＋「メーカーの既定に従う」）

**モデル: Opus**（`shared/ipc.ts` と `main/settings.ts` の MERGE と既定値の変更があるため）

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`（`DEFAULT_SETTINGS` の2値とコメント）
- Modify: `apps/desktop/src/main/settings.ts`（空の色・0 の列数を受ける）
- Modify: `apps/desktop/src/renderer/app/store.ts`（`applyLadderSettings` が 0 を素通しする）
- Modify: `apps/desktop/src/renderer/screens/Settings.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/settings.test.ts`（既定値の期待値と**移行の往復テスト**）・`settings-plc.test.tsx`（追記）

§16 Phase 4 受入基準①の入口である。`IMPLEMENTED_DIALECT_IDS` が4件になるので**選べるようになる仕組みは既にある**（前提#31）。ここで直すのは ①注記の文言 ②メーカー名の出どころ（`profile.displayName`）③通電色と表示列数の「メーカーの既定に従う」（決定表#8）である。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/settings-plc.test.tsx` に足す:

```tsx
describe('4メーカーの選択（§16 Phase 4 受入基準①）', () => {
  it('offers all four vendors, none disabled, named by the profile', async () => {
    render(<Settings />);
    const select = await screen.findByTestId('setting-vendor');
    const options = [...select.querySelectorAll('option')];
    expect(options).toHaveLength(4);
    for (const option of options) {
      expect(option, option.value).not.toBeDisabled();
      expect(option.textContent, option.value).toBe(getDialect(option.value as DialectId).displayName);
    }
    expect(screen.queryByText(/Phase 4 で対応/u)).toBeNull();
  });

  it('saves the chosen vendor as the default, without touching the open session (決定表#24)', async () => {
    act(() => {
      useStore.setState({ dialectId: 'jtekt' });
    });
    render(<Settings />);
    const select = await screen.findByTestId('setting-vendor');
    fireEvent.change(select, { target: { value: 'omron' } });
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ defaultVendor: 'omron' });
    });
    // 次に課題を開くときの既定だけが変わる。いま開いている方言は動かさない（前提#31b）
    expect(useStore.getState().defaultVendor).toBe('omron');
    expect(useStore.getState().dialectId).toBe('jtekt');
  });

  it('does not reset a restored dialect when an unrelated setting is saved (前提#31b)', async () => {
    act(() => {
      useStore.setState({ dialectId: 'sharp', defaultVendor: 'mitsubishi' });
    });
    render(<Settings />);
    fireEvent.click(await screen.findByTestId('setting-sound-enabled'));
    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(0);
    });
    expect(useStore.getState().dialectId).toBe('sharp');
  });
});

describe('「メーカーの既定に従う」（§10.6 / 決定表#8）', () => {
  it('defaults both the colour and the column count to the vendor default', () => {
    expect(DEFAULT_SETTINGS.monitorColor).toBe('');
    expect(DEFAULT_SETTINGS.ladderGridCols).toBe(0);
  });

  it('starts the colour override from the chosen vendor, not from the Mitsubishi blue', async () => {
    render(<Settings />);
    // 先に OMRON を選ぶ（この画面の色は `defaultVendor` に従う）
    fireEvent.change(await screen.findByTestId('setting-vendor'), { target: { value: 'omron' } });
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ defaultVendor: 'omron' });
    });
    const auto = await screen.findByTestId('setting-monitor-color-auto');
    // 既定は「メーカーの既定に従う」＝チェック済み
    expect(auto).toBeChecked();
    fireEvent.click(auto);
    await waitFor(() => {
      // **いま選んでいるメーカーの色**から上書きが始まる（三菱の青を押しつけない。レビュー B1）
      expect(saved.at(-1)).toEqual({ monitorColor: OMRON_CP1E.monitorColors.powered });
    });
    fireEvent.click(await screen.findByTestId('setting-monitor-color-auto'));
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ monitorColor: '' });
    });
  });

  it('turns the column override off by writing 0', async () => {
    render(<Settings />);
    const auto = await screen.findByTestId('setting-grid-cols-auto');
    expect(auto).toBeChecked();
    fireEvent.click(auto);
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ ladderGridCols: MITSUBISHI_FX5U.gridCols });
    });
  });

  it('keeps 0 and "" through the store (does not clamp 0 up to 8)', () => {
    act(() => {
      useStore.setState({ dialectId: 'jtekt' });
      useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    });
    expect(useStore.getState().ladderGridCols).toBe(0);
    expect(useStore.getState().monitorColor).toBe('');
    // 既定メーカーだけ。いまの方言は動かさない（決定表#24）
    expect(useStore.getState().defaultVendor).toBe('omron');
    expect(useStore.getState().dialectId).toBe('jtekt');
  });

  it('shows the current skin colour in the swatch while the override is off', async () => {
    act(() => {
      useStore.setState({ dialectId: 'omron' });
    });
    render(<Settings />);
    // 空文字は `<input type="color">` に入れられないので、いまのスキンの色を見せる
    expect(await screen.findByTestId('setting-monitor-color')).toHaveValue('#2fa02c');
    expect(screen.getByTestId('monitor-color-help')).toHaveTextContent('メーカーの既定');
  });

  it('writes "" and 0 when the group is reset', async () => {
    render(<Settings />);
    fireEvent.click(await screen.findByTestId('setting-plc-reset'));
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({
        defaultVendor: 'mitsubishi',
        ladderGridCols: 0,
        monitorColor: '',
      });
    });
  });

  it('shows the assumption note of the current skin', async () => {
    render(<Settings />);
    expect(await screen.findByTestId('skin-assumed')).toHaveTextContent('画面の配色');
  });
});

```

（import に `getDialect` / `MITSUBISHI_FX5U` / `OMRON_CP1E` / `type DialectId` を足す。
**`DEFAULT_MONITOR_COLOR` という定数は作らない**——上書きの初期色は、いま選んでいるメーカーの
`monitorColors.powered` である。レビュー B1）

**移行のテストは `settings-plc.test.tsx`（renderer・`saved[]` は模型）ではなく、実ファイルを
読み書きする main 側（`settings.test.ts`）に置く**（レビュー B1。模型の `saved[]` を見ても
「保存されて読み戻した値」は確かめられない）。`apps/desktop/test/settings.test.ts` に足す:

```ts
describe('旧い設定ファイルの移行（Plan 4B 決定表#8 / レビュー B1）', () => {
  it('turns the old Mitsubishi-blue default into "follow the skin", once', () => {
    // 旧既定（`#1E64FF`）のまま保存されていた設定ファイル（移行の印はまだ無い）
    writeFileSync(settingsPath(), JSON.stringify({ monitorColor: '#1E64FF' }), 'utf8');
    // 読み込む（＝main 側の読み手を実際に通す）と「スキンの既定色」になる
    expect(readSettings().monitorColor).toBe('');
    // 印がファイルに残るので、次からは走らない
    expect(onDisk()['monitorColorMigrated']).toBe(true);
    // 移行のあとで利用者が**改めて三菱の青を選んだ**ら、それは消さない
    expect(writeSettings({ monitorColor: '#1E64FF' }).monitorColor).toBe('#1E64FF');
    expect(readSettings().monitorColor).toBe('#1E64FF');
  });

  it('leaves a colour the trainee chose alone', () => {
    expect(writeSettings({ monitorColor: '#FF00AA' }).monitorColor).toBe('#FF00AA');
    expect(readSettings().monitorColor).toBe('#FF00AA');
  });
});
```

`apps/desktop/test/settings.test.ts` の `defaults and clamps the PLC settings (§10.6)` を差し替える:

```ts
  it('defaults and clamps the PLC settings (§10.6 / Plan 4B 決定表#8)', () => {
    expect(DEFAULT_SETTINGS.defaultVendor).toBe('mitsubishi');
    // 0 と '' は「メーカーの既定に従う」（Plan 4B 決定表#8）
    expect(DEFAULT_SETTINGS.ladderGridCols).toBe(0);
    expect(DEFAULT_SETTINGS.monitorColor).toBe('');
    expect(writeSettings({ ladderGridCols: 2 }).ladderGridCols).toBe(8);
    expect(writeSettings({ ladderGridCols: 99 }).ladderGridCols).toBe(15);
    expect(writeSettings({ ladderGridCols: 0 }).ladderGridCols).toBe(0);
    expect(writeSettings({ monitorColor: 'red' }).monitorColor).toBe('');
    expect(writeSettings({ monitorColor: '' }).monitorColor).toBe('');
    // Phase 4 で4メーカーすべてが選べる
    expect(writeSettings({ defaultVendor: 'omron' }).defaultVendor).toBe('omron');
    expect(writeSettings({ defaultVendor: 'nope' }).defaultVendor).toBe('omron');
  });
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/settings.test.ts test/settings-plc.test.tsx
```

Expected: 失敗。`expected '#1E64FF' to be ''`。

- [ ] **Step 3: `src/shared/ipc.ts` の既定値を直す**

**`defaultVendor: DialectId` と `import type { DialectId }` は landed 済み**（`shared/ipc.ts` L174 / 前提#31）
なので、ここで直すのは**注釈と `ladderGridCols` / `monitorColor` の意味づけ**、それと移行の印の欄である:

```ts
  /**
   * モードDの既定メーカー（Phase 4 で4社すべてが選べる）。§10.5 / §12.1
   * **「課題を開くときの初期値」**であって、いま開いているセッションの方言ではない（決定表#24）。
   * （型は landed 済み。コメントだけ書き足す）
   */
  defaultVendor: DialectId;
  /**
   * ラダーの表示列数（接点列。8〜15）。§10.6
   * **`0` は「メーカーの既定に従う」**（`profile.gridCols`）。Plan 4B 決定表#8
   */
  ladderGridCols: number;
  /**
   * モニタ中の通電表示色（`#rrggbb`）。§10.6
   * **空文字は「スキンの既定色」**（`profile.monitorColors.powered`）。Plan 4B 決定表#8
   */
  monitorColor: string;
  /**
   * 通電色の移行（`LEGACY_MONITOR_COLOR` → `''`）が済んだ印。Plan 4B 決定表#8 / レビュー B1
   * **画面はこの欄を読まない**（設定ファイルに一度きりの移行を記録するためだけの内部の印）。
   * 印を持たないと、移行のあとで利用者が改めて選び直した `#1E64FF` を毎回消してしまう。
   */
  monitorColorMigrated: boolean;
```

`DEFAULT_SETTINGS` の直前に、移行のための旧既定値を置く:

```ts
/**
 * Phase 3 の `monitorColor` の既定（三菱の青）。§10.6 / Plan 4B 決定表#8
 * この値のまま保存されている設定ファイルは、読込時に `''`（スキンの既定色）へ移行する。
 * 移行しないと OMRON・JTEKT・シャープを選んでも通電色が青のままになる（前提#24）。
 */
export const LEGACY_MONITOR_COLOR = '#1E64FF';
```

```ts
/** 設定の既定値。 */
export const DEFAULT_SETTINGS: AppSettings = {
  userContentDir: '',
  soundEnabled: true,
  soundVolume: 0.5,
  restorePrompt: true,
  defaultVendor: 'mitsubishi',
  // 0 / '' = メーカーの既定に従う（決定表#8）
  ladderGridCols: 0,
  monitorColor: '',
  // 新しい設定ファイルには移行すべき旧既定が入っていないので、最初から済み扱いでよい
  monitorColorMigrated: true,
};
```

> **`DEFAULT_MONITOR_COLOR` は作らない**（レビュー B1）。「上書きする」を選んだときの初期色は
> いま選んでいるメーカーの `monitorColors.powered` であって、三菱の青という固定値ではない。
> 固定値を置くと、OMRON を選んでいる利用者が上書きに切り替えた瞬間に青が入る。

- [ ] **Step 4: `src/main/settings.ts` に 0 と空文字を通す**

```ts
  const gridCols = source['ladderGridCols'];
  if (typeof gridCols === 'number' && Number.isFinite(gridCols)) {
    // 0 は「メーカーの既定に従う」（Plan 4B 決定表#8）。それ以外は 8〜15 に丸める
    next.ladderGridCols =
      gridCols === 0 ? 0 : Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(gridCols)));
  }
  const monitorColor = source['monitorColor'];
  // 空文字は「スキンの既定色」（決定表#8）。**ここでは移行しない**（下の `loadSettings()` が持つ）
  if (typeof monitorColor === 'string' && /^(#[0-9a-fA-F]{6})?$/.test(monitorColor)) {
    next.monitorColor = monitorColor;
  }
  // 移行の印（renderer からも来るが、`true` を消せるだけなので害はない）
  if (typeof source['monitorColorMigrated'] === 'boolean') {
    next.monitorColorMigrated = source['monitorColorMigrated'];
  }
```

移行そのものは**読込の経路にだけ**置く。`loadSettings()` の `sanitizePatch()` の直後（
`userContentDir` の解決の次）に足し、印をファイルへ書き戻す:

```ts
/**
 * 旧既定（三菱の青）の通電色を「スキンの既定色」へ**一度だけ**移行する。
 * Plan 4B 決定表#8 / レビュー B1
 *
 * `sanitizePatch()` に置いてはいけない。あの関数は `settings:set` の**保存でも通る**ので、
 * 移行のあとで利用者が設定画面から改めて選び直した `#1E64FF` まで毎回消してしまう。
 * 印（`monitorColorMigrated`）を設定ファイルに残し、二度と走らせない。
 *
 * @returns 印を新しく立てたら `true`（＝ファイルへ書き戻す価値がある）
 */
function migrateMonitorColor(settings: AppSettings): boolean {
  if (settings.monitorColorMigrated) return false;
  settings.monitorColorMigrated = true;
  if (settings.monitorColor.toUpperCase() !== LEGACY_MONITOR_COLOR) return true;
  /*
   * 移行しないと、Phase 4 で OMRON・JTEKT・シャープを選んでも通電色が青のままになる
   * （`LadderGrid` の「空ならプロファイルの色」という分岐が一度も通らない。前提#24）。
   * 三菱の青を意図して選んでいた利用者も1度だけ既定へ戻るが、設定画面で選び直せる。
   */
  settings.monitorColor = '';
  return true;
}
```

```ts
  const settings = sanitizePatch(DEFAULT_SETTINGS, raw);
  if (settings.userContentDir.length === 0) settings.userContentDir = defaultUserContentDir();
  // 壊れたファイルには書き戻さない（`writeSettings()` が控えを取る前に踏み潰さないため）
  if (!corrupt && migrateMonitorColor(settings)) {
    try {
      writeFileAtomic(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
    } catch {
      // 印を残せなくても読込は続ける（次の `writeSettings()` で残る）
    }
  }
  return { settings, corrupt };
```

> **確認だけ**: `defaultVendor` の分岐（`main/settings.ts` L68-75）は **landed 済みで、既に
> `isDialectId(vendor) && IMPLEMENTED_DIALECT_IDS.includes(vendor)` になっている**（前提#31 / I4）。
> `IMPLEMENTED_DIALECT_IDS` が 4A で4件になるので、コードは1行も変えなくてよい。読み直して
> そうなっていることを確かめるだけにする。

- [ ] **Step 5: `src/renderer/app/store.ts` の `applyLadderSettings` を直す**

`AppState` に**既定メーカー**の欄を足す（`dialectId` の直後）:

```ts
  /**
   * 設定画面の既定メーカー。§12.1 / 決定表#24
   * **課題を開くときの初期値**であって、いまのセッションの方言（`dialectId`）ではない。
   * 設定を保存するたびに `dialectId` を上書きすると、作業ファイルから復元した方言や
   * 表記切替で選んだ方言がセッションの途中で戻ってしまう（前提#31b）。
   */
  defaultVendor: DialectId;
```

初期値（`dialectId: 'mitsubishi',` の隣）に `defaultVendor: DEFAULT_SETTINGS.defaultVendor,` を足し、
実装を差し替える:

```ts
  applyLadderSettings: ({ gridCols, monitorColor, vendor }) => {
    // 0 は「スキンの既定列数」の印なのでそのまま持つ（丸めない。決定表#8）
    const clampedGridCols =
      gridCols === 0 ? 0 : Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(gridCols)));
    /*
     * 表示列数が縮んで、カーソルがいま見えない接点列を指していたら、見える最後の接点列へ詰める
     * （landed の挙動。3B レビュー指摘 #7）。**この詰めは残す**（レビュー I3）——落とすと
     * 15列から8列へ狭めた直後にカーソルが画面外を指し、`Enter` が見えないセルを編集する。
     * `0`（＝メーカーの既定に従う）のときは、いまの方言の既定列数で詰める。
     */
    const visibleCols =
      clampedGridCols === 0 ? getDialect(get().dialectId).gridCols : clampedGridCols;
    const cursor = get().ladderCursor;
    // コイル列（`COIL_COL`）はどの表示列数でも必ず見えているので動かさない
    const clampedCursor =
      cursor.col === COIL_COL || cursor.col < visibleCols
        ? cursor
        : { ...cursor, col: visibleCols - 1 };
    set({
      ladderGridCols: clampedGridCols,
      monitorColor,
      ladderCursor: clampedCursor,
      // **`dialectId` には触らない**（決定表#24）。効くのは次に課題を開くときである
      ...(isDialectId(vendor) && IMPLEMENTED_DIALECT_IDS.includes(vendor)
        ? { defaultVendor: vendor }
        : {}),
    });
  },
```

（`getDialect` を `@ojt/plc-dialects` の import に足す。`COIL_COL` / `MIN_GRID_COLS` /
`MAX_GRID_COLS` は landed の import のまま。）

> 既存の `test/settings-plc.test.tsx` L84-88（`applyLadderSettings(...) → dialectId === 'mitsubishi'`）は
> `defaultVendor` を見るように直す。`App.tsx` の起動時の呼び出しは**そのまま**でよい（起動直後は
> まだ課題を開いていないので、`defaultVendor` に入れば次の `openProblem()` で効く）。

- [ ] **Step 6: `Settings.tsx` を直す**

> **確認だけ**: `Settings.tsx` に `VENDOR_LABELS` という定数は**もう無い**（Plan 3B 最終修正で
> `JA.settings.vendorLabels`（`ja.ts` L122-127）へ移設済み。前提#31 / I4）。`isDialectId()` を
> 通してから `patch()` する形（L234-238）も landed 済みである。**消す定数は無い**ので、
> ここでやるのは import の差し替えと `<select>` の中身だけにする。

import を差し替える（`DIALECT_IDS` を落とし、`availableDialects` / `getDialect` を足す）:

```ts
import {
  availableDialects,
  getDialect,
  isDialectId,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
} from '@ojt/plc-dialects';
import { DEFAULT_SETTINGS, type AppSettings, type AppSettingsResponse } from '../../shared/ipc.js';
import { SKIN_THEMES } from '../ladder/skins/index.js';
```

（`IMPLEMENTED_DIALECT_IDS` は `availableDialects()` が代わりをするので、この画面からは落とす。
`JA.settings.vendorLabels` もメーカー名を `profile.displayName` から引くようになるので使わなくなるが、
**`ja.ts` からキーは消さない**（`vendorUnimplemented` と同じ理由。MERGE 注意 #1）。）

メーカーの `<select>` を差し替える:

```tsx
              <select
                id="setting-vendor"
                data-testid="setting-vendor"
                value={settings.defaultVendor}
                onChange={(event) => {
                  // landed と同じく `isDialectId()` で絞ってから渡す（型は `DialectId`）
                  if (isDialectId(event.target.value)) patch({ defaultVendor: event.target.value });
                }}
              >
                {availableDialects().map((profile) => (
                  <option key={profile.id} value={profile.id} data-testid={`vendor-option-${profile.id}`}>
                    {profile.displayName}
                  </option>
                ))}
              </select>
```

> `availableDialects()` は**実装済みのプロファイルだけ**を返す（4A Task 5 で4件）。`DIALECT_IDS` を
> 回して `disabled` を付ける必要はもう無い。未実装のIDが将来また増えたときは
> `availableDialects()` から落ちるだけなので、この画面は勝手に追随する。

注記の段落を差し替える:

```tsx
            <p className={styles.subtitle} data-testid="vendor-note">
              {JA.settings.vendorHelp}
            </p>
            <p className={styles.subtitle} data-testid="vendor-assumption">
              {ASSUMPTION_NOTICE}
            </p>
            {/* いま選んでいるスキンの見た目のうち、何が前提なのかを出す（§17.1 / 4A H-5） */}
            <ul className={styles.subtitle} data-testid="skin-assumed">
              {(isDialectId(settings.defaultVendor)
                ? SKIN_THEMES[settings.defaultVendor].assumed
                : []
              ).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
```

表示列数の欄に「メーカーの既定に従う」を足す（既存の `setting-grid-cols` の `<section>` の**前**）:

```tsx
            <section className={styles.settingRow}>
              <label htmlFor="setting-grid-cols-auto">{JA.settings.followVendor}</label>
              <input
                id="setting-grid-cols-auto"
                type="checkbox"
                checked={settings.ladderGridCols === 0}
                data-testid="setting-grid-cols-auto"
                onChange={(event) => {
                  // 外したときは「いまのメーカーの既定」から上書きを始める
                  const vendorCols = isDialectId(settings.defaultVendor)
                    ? getDialect(settings.defaultVendor).gridCols
                    : DEFAULT_SETTINGS.ladderGridCols;
                  patch({ ladderGridCols: event.target.checked ? 0 : vendorCols });
                }}
              />
            </section>
```

既存の数値欄は `disabled={settings.ladderGridCols === 0}` を足す。`commitGridCols()` も 0 を素通しするようにする:

```ts
  const commitGridCols = (): void => {
    if (settings === undefined) return;
    if (settings.ladderGridCols === 0) return; // メーカーの既定に従う
    const clamped = Math.min(
      MAX_GRID_COLS,
      Math.max(MIN_GRID_COLS, Math.round(settings.ladderGridCols)),
    );
    if (clamped !== settings.ladderGridCols) setSettings({ ...settings, ladderGridCols: clamped });
    patch({ ladderGridCols: clamped });
  };
```

通電色にも同じ対（`setting-monitor-color-auto`）を足す。**外したときの初期色は
「いま選んでいるメーカーの色」**にする（レビュー B1。三菱の青という固定値を置かない）:

```tsx
            <section className={styles.settingRow}>
              <label htmlFor="setting-monitor-color-auto">{JA.settings.followVendor}</label>
              <input
                id="setting-monitor-color-auto"
                type="checkbox"
                checked={settings.monitorColor.length === 0}
                data-testid="setting-monitor-color-auto"
                onChange={(event) => {
                  // 外したときは「いま選んでいるメーカーの通電色」から上書きを始める（B1）
                  const vendorColor = isDialectId(settings.defaultVendor)
                    ? getDialect(settings.defaultVendor).monitorColors.powered
                    : DEFAULT_SETTINGS.monitorColor;
                  patch({ monitorColor: event.target.checked ? '' : vendorColor });
                }}
              />
            </section>
```
**色見本は空文字を入れられない**（`<input type="color">` は `#rrggbb` しか受けない）ので、
空のときは**いま選んでいるスキンの色**を見せ、欄自体は `disabled` にする（決定表#8）:

```tsx
              <input
                id="setting-monitor-color"
                type="color"
                data-testid="setting-monitor-color"
                disabled={settings.monitorColor.length === 0}
                value={
                  settings.monitorColor.length > 0
                    ? settings.monitorColor
                    : // 空＝スキンの既定色。見本にはその色を出す（決定表#8）
                      (isDialectId(settings.defaultVendor)
                        ? getDialect(settings.defaultVendor).monitorColors.powered
                        : '#000000'
                      ).toLowerCase()
                }
                onChange={(event) => {
                  setSettings({ ...settings, monitorColor: event.target.value });
                }}
                onBlur={(event) => {
                  patch({ monitorColor: event.target.value });
                }}
              />
```

> `<input type="color">` は値を小文字に正規化するので、テストの期待値も小文字（`#2fa02c`）にする。

「既定に戻す」（`setting-plc-reset`）は `DEFAULT_SETTINGS` をそのまま書くので、**自動的に
`monitorColor: ''` / `ladderGridCols: 0` を書く**（既定値を変えたぶんだけで追加の変更は要らない）。

`JA.settings` に足す（`// --- /Plan 3B Task 16 ---` の直前）:

```ts
    // --- Plan 4B Task 6 ---
    /** 色・列数を方言の既定に任せる。決定表#8 */
    followVendor: 'メーカーの既定に従う',
    // --- /Plan 4B Task 6 ---
```

`JA.settings` の既存の3件を直す（前提#22。ツール名とキーを出さない）:

```ts
    vendorHelp: 'モードDの課題を開いたときに使う機種（メーカー）です。課題の機種もこのメーカーに合わせて開きます。',
    gridColsHelp: 'ラダー編集画面の接点列の数（8〜15）。メーカーの既定は 11 です。',
    monitorColorHelp:
      'モニタ中に通電しているセルへ塗る色です。「メーカーの既定に従う」のあいだは、選んでいるメーカーの色を使います。',
```

`vendorUnimplemented` は**使わなくなる**が、キーは消さずに文言だけ直す（将来また未実装のメーカーが出たときの受け皿。`settings-screen.test.tsx` が参照していたら追随させる）:

```ts
    /** 実装が無いメーカーに添える注記（Phase 4 で4社すべて実装済み）。 */
    vendorUnimplemented: 'このメーカーはまだ対応していません',
```

- [ ] **Step 7: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/settings.test.ts test/settings-plc.test.tsx test/settings-screen.test.tsx test/store.test.ts
pnpm --filter @ojt/desktop exec tsc -p tsconfig.json --noEmit
```

Expected: すべて通過。

```powershell
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/main/settings.ts apps/desktop/src/renderer apps/desktop/test
git commit -m "feat(desktop): offer all four vendors and follow the vendor defaults"
```

---

## Task 7: 課題を既定メーカーの機種で開く（＋作業ファイルの4方言往復）

**モデル: Opus**（`store.ts` の `openProblem()` の MERGE と、差し替えられない課題の扱いの判断があるため）

**Files:**
- Modify: `apps/desktop/src/renderer/app/store.ts`（`OpenProblemOptions` と `openProblem()`、`resetSession()`）
- Modify: `apps/desktop/src/renderer/session/work-file.ts`（復元時に保存された方言を渡す。1箇所）
- Modify: `apps/desktop/src/renderer/screens/PlcSession.tsx`（機種名の表示）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/store-plc.test.ts`（追記）
- Test: `apps/desktop/test/work-file-plc.test.ts`（追記）

§16 Phase 4 受入基準①③⑤の土台である。内蔵8題は全部 `mitsubishi` / `FX5U` なので（前提#32）、**開くときに既定メーカーの機種へ差し替える**（決定表#9）。差し替えた課題がそのまま盤・Worker・判定・作業ファイルへ流れるので、3Dのラック（受入基準③⑤）も画面に出る。

**方言を決めるのはこの1箇所だけにする**（決定表#24）。`openProblem(problem, { vendor })` の `vendor` を省くとストアの `defaultVendor`（設定画面の値）を使い、作業ファイルの復元だけが**保存されていた方言**を渡す。こうすると、セッションの途中で設定を触っても方言は動かない（前提#31b）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/store-plc.test.ts` に足す:

```ts
describe('既定メーカーの機種で開く（§7.6 / 決定表#9・#24）', () => {
  it('swaps the model of a mode D problem to the default vendor', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    expect(useStore.getState().openProblem(plcProblem)).toBe(true);
    expect(useStore.getState().dialectId).toBe('omron');
    const opened = useStore.getState().problem;
    expect(opened?.mode).toBe('plc');
    expect(isPlcProblem(opened!) ? opened.plc : undefined).toEqual({
      vendor: 'omron',
      model: 'CP1E',
    });
    // 盤も機種に追随する（3Dとワーカーが同じ端子名を見る。4A H-1）
    expect(boardForProblem(opened).terminals.map((t) => String(t.id))).toContain('PLC.0.00');
  });

  it('puts the TOYOPUC rack on the desk for the JTEKT default', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'jtekt' });
    useStore.getState().openProblem(plcProblem);
    const board = boardForProblem(useStore.getState().problem);
    expect(board.plcUnit?.form).toBe('rack');
    expect(board.plcUnit?.modules?.map((m) => m.model)).toEqual([
      'POWER1',
      'PC10G-1SP',
      'IN-12',
      'OUT-12',
    ]);
    expect(board.terminals.map((t) => String(t.id))).toContain('PLC.ICOM0');
  });

  it('keeps the original model when the vendor cannot host the assignment (決定表#10)', () => {
    const wide = {
      ...plcProblem,
      io: {
        ...plcProblem.io,
        mode: 'fixed' as const,
        inputs: [{ x: 0, pb: 'PB1' as const }],
        outputs: [{ y: 12, cr: 'CR1', pl: 'PL1' }],
      },
    };
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    expect(useStore.getState().openProblem(wide)).toBe(true);
    const opened = useStore.getState().problem;
    expect(isPlcProblem(opened!) ? opened.plc.model : undefined).toBe('FX5U');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('CP1E');
  });

  it('leaves the other modes alone', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'sharp' });
    useStore.getState().openProblem(assembleProblem);
    expect(useStore.getState().problem?.id).toBe(assembleProblem.id);
  });

  it('lets the caller pin a vendor (作業ファイルの復元。決定表#24)', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    useStore.getState().openProblem(plcProblem, { vendor: 'jtekt' });
    expect(useStore.getState().dialectId).toBe('jtekt');
    const opened = useStore.getState().problem;
    expect(isPlcProblem(opened!) ? opened.plc.model : undefined).toBe('PC10G-1SP');
    // 設定（既定メーカー）は動かない
    expect(useStore.getState().defaultVendor).toBe('omron');
  });

  it('keeps the session dialect through 「もう一度」 (MERGE 注意 #5 / 決定表#24)', () => {
    // 既定メーカーは三菱のまま、セッションだけ JTEKT にしてある状態
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'mitsubishi' });
    useStore.getState().openProblem(plcProblem, { vendor: 'jtekt' });
    expect(useStore.getState().dialectId).toBe('jtekt');
    useStore.getState().resetSession();
    // やり直しても既定メーカー（三菱）へ戻らない
    expect(useStore.getState().dialectId).toBe('jtekt');
    const again = useStore.getState().problem;
    expect(isPlcProblem(again!) ? again.plc.model : undefined).toBe('PC10G-1SP');
  });
});
```

`apps/desktop/test/work-file-plc.test.ts` に足す:

```ts
describe('4方言の作業ファイル往復（§12.3 / 4A H-2）', () => {
  it.each(['mitsubishi', 'jtekt', 'omron', 'sharp'] as const)(
    'round-trips the dialect id %s',
    async (vendor) => {
      useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor });
      useStore.getState().openProblem(problem);
      const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
      expect(file.dialectId).toBe(vendor);
      useStore.getState().abandonSession();
      // 既定メーカーが違っていても、保存された方言で戻る（決定表#24）
      useStore
        .getState()
        .applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'mitsubishi' });
      expect(await applyWorkFile(file)).toBe(true);
      expect(useStore.getState().dialectId).toBe(vendor);
      // 機種も戻る（作業ファイルには課題IDしか無いので、方言 → 機種の規則で引き直す）
      const opened = useStore.getState().problem;
      expect(isPlcProblem(opened!) ? opened.plc.vendor : undefined).toBe(vendor);
    },
  );

  it('keeps the restored dialect when an unrelated setting is saved afterwards (前提#31b)', async () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'sharp' });
    useStore.getState().openProblem(problem);
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
    useStore.getState().abandonSession();
    expect(await applyWorkFile(file)).toBe(true);
    // セッションの途中で既定メーカーを変えても、いまの方言は動かない
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    expect(useStore.getState().dialectId).toBe('sharp');
    expect(useStore.getState().defaultVendor).toBe('omron');
  });
});
```

（`problem` は `work-file-plc.test.ts` が既に持っている内蔵モードD課題のヘルパで、
`toWorkFile(problemId, session, elapsedMs, hazardCount)` は landed の署名そのまま
（`session/work-file.ts` L65-70）。既存ケースと同じ `toWorkFile(problem.id, useStore.getState().session!, 0, 0)`
の形で呼ぶ。`store-plc.test.ts` 側の `plcProblem` はそのファイルのヘルパ名である。）

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/store-plc.test.ts test/work-file-plc.test.ts
```

Expected: 失敗。`expected { vendor: 'mitsubishi', model: 'FX5U' } to equal { vendor: 'omron', model: 'CP1E' }`。

- [ ] **Step 3: `store.ts` の `openProblem()` に差し替えを入れる**

import に足す:

```ts
import { plcForVendor, plcUnitForVendor } from '../session/plc-skin.js';
```

`OpenProblemOptions` に足す:

```ts
  /**
   * この方言（＝機種）で開く。§10.5 / 決定表#24
   * 省くとストアの `defaultVendor`（設定画面の既定メーカー）を使う。作業ファイルの復元だけが
   * 保存されていた方言を渡す（`work-file.ts`）。
   */
  vendor?: DialectId;
```

`openProblem` の**先頭**（`let session: BoardSession;` の前）に足す:

```ts
    /*
     * モードDは**既定メーカーの機種**で開く（決定表#9）。内蔵8題は `mitsubishi` / `FX5U` だが、
     * 4A Task 14 が「`plc` だけ差し替えれば4機種すべてで成立する」ことを確かめているので、
     * ここで差し替えれば課題JSONを1文字も変えずに CP1E・TOYOPUC・JW300 の課題になる。
     * 差し替えた課題がそのまま盤・Worker・判定・作業ファイルへ流れるので、3Dの端子名と
     * ラダーのデバイス名が食い違わない（4A H-1）。
     *
     * **方言（`dialectId`）を決めるのはここだけ**である（決定表#24）。設定を保存するたびに
     * 上書きすると、復元した方言や表記切替で選んだ方言がセッションの途中で戻る（前提#31b）。
     */
    let vendor = options.vendor ?? get().defaultVendor;
    if (isPlcProblem(problem)) {
      const swapped = plcForVendor(problem, vendor);
      if (swapped === undefined) {
        // 割付がその機種に収まらない（CP1E の出力は12点。決定表#10）。元の機種のまま開く
        const model = plcUnitForVendor(vendor)?.model ?? vendor;
        get().toast(JA.plc.modelNotUsable(model, problem.plc.model), 'error');
        vendor = problem.plc.vendor;
      } else {
        problem = swapped;
      }
    }
```

最後の1回の `set({ … })` に `dialectId: vendor,` を足す（`...plcFields(problem)` の隣。
モードD以外でも入れてよい——次にモードDを開くまで誰も読まない）。

> `problem` は `openProblem: (problem, options = {}) => {` の引数なので、**再代入できるよう
> `let` にする**（引数の再代入は ESLint の `no-param-reassign` を設定していないので許される。
> 気になるなら `const target = swapped ?? problem;` として以降を `target` にしてもよいが、
> `problem` を使う箇所が20行以上あるため再代入のほうが差分が小さい）。

- [ ] **Step 4: `i18n/ja.ts` に文言を足す**

`JA.plc` の Plan 4B ブロックに足す:

```ts
    /** 既定メーカーの機種では開けない課題（決定表#10）。 */
    modelNotUsable: (wanted: string, used: string): string =>
      `この課題の入出力の割付は ${wanted} に収まらないため、${used} のまま開きました`,
    /** セッション画面に出す機種名（3Dの本体と同じ機種であることを見せる）。 */
    modelLabel: '機種',
```

- [ ] **Step 5: `work-file.ts` の復元で保存された方言を渡す（1箇所だけ）**

直すのは `restoreInspectState()` の**モードDの枝**である。landed の該当行は

```ts
    if (!store.openProblem(problem)) return false;   // session/work-file.ts L602
```

で、その直後（L603-614）に「開いてから `store.setDialect(state.dialectId)` する」ブロックがある。
機種の差し替えは `openProblem()` の**中**で起きるので、後から方言だけ入れ替えると「方言は OMRON
なのに盤は FX5U」という食い違いが残る。**L602 を下の形に差し替え、L603-614 のブロックは丸ごと
削除する**（`setDialect()` 自体は `switchDialect()`（Task 8）が使うので、ストアからは消さない）:

```ts
    /*
     * 保存されていた方言でそのまま開く（決定表#24）。`openProblem()` が方言 → 機種 → 盤の順に
     * 作り直すので、ここで渡さないと「ラダーは `0.00` 表記なのに盤の端子は `X0`」になる。
     * 未実装・見覚えの無いIDは黙って無視する（既定メーカーで開く。読込そのものは断らない）。
     */
    const savedDialect =
      typeof state.dialectId === 'string' &&
      isDialectId(state.dialectId) &&
      IMPLEMENTED_DIALECT_IDS.includes(state.dialectId)
        ? state.dialectId
        : undefined;
    if (!store.openProblem(problem, savedDialect === undefined ? {} : { vendor: savedDialect })) {
      return false;
    }
```

> **`restOptions` はここには要らない。** `resolvedFaults` / `faultSeed` を組み立てて
> `openProblem()` へ渡しているのは **C2（`isInspectRepairProblem`）の枝**（landed L619-628）で、
> モードDの枝（L598-617）は `openProblem(problem)` を引数なしで呼んでいる。C2 の枝は
> Phase 4 では**触らない**（`vendor` はモードDにしか効かない）。
>
> `isDialectId` / `IMPLEMENTED_DIALECT_IDS` の import は landed 済み（削除するブロックが
> 使っている）なので、そのまま使い回す。

- [ ] **Step 6: `resetSession()`（結果画面の「もう一度」）に方言を添える（MERGE 注意 #5）**

landed の `resetSession()`（`store.ts` L1158-1180）は

```ts
    const reopened = get().openProblem(problem, {
      resolvedFaults: state.resolvedFaults,
      faultSeed: state.faultSeed,
      keepLadder: isPlcProblem(problem),
    });
```

と呼ぶ。Step 3 で `vendor` を省くと `defaultVendor` を使うようにしたので、**このままだと
「表記切替で JTEKT にした → 結果画面で『もう一度』→ 三菱へ戻る」**が起きる（決定表#24）。
1行足す:

```ts
    const reopened = get().openProblem(problem, {
      resolvedFaults: state.resolvedFaults,
      faultSeed: state.faultSeed,
      keepLadder: isPlcProblem(problem),
      // いまのセッションの方言のまま作り直す（既定メーカーへ戻さない。MERGE 注意 #5 / 決定表#24）
      vendor: state.dialectId,
    });
```

> `restartSession()`（`store.ts` L1182-。WebGL が落ちたときの作り直し）は **`openProblem()` を
> 呼ばない**（`sessionForProblem()` で盤だけ作り直す）ので、方言を渡す場所が無い＝直すところが
> 無い。`dialectId` はそのまま残る。

- [ ] **Step 7: `PlcSession.tsx` に機種名を出す**

`ProblemPanel` の下（`JA.plc.outletNote` を出している並び）に足す:

```tsx
        <p className={styles.plcNote} data-testid="plc-model">
          {JA.plc.modelLabel}: {plcUnitFor(problem.plc.model)?.displayName ?? problem.plc.model}
        </p>
```

（`import { plcUnitFor } from '@ojt/board-model';` を足す。`styles.plcNote` が無ければ
`screens.module.css` の既存の注記クラスを使う。）

- [ ] **Step 8: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/store-plc.test.ts test/work-file-plc.test.ts test/plc-session-screen.test.tsx test/store.test.ts
```

Expected: すべて通過（`store-plc` に **6ケース**、`work-file-plc` に **5ケース**（`it.each` の4方言＋1）追加）。

```powershell
git add apps/desktop/src/renderer apps/desktop/test
git commit -m "feat(desktop): open mode D problems on the default vendor's model"
```

---

## Task 8: 表記切替ダイアログ（§10.7）

**モデル: Opus**（切替時に配線をどうするかの判断があるため）

**Files:**
- Create: `apps/desktop/src/renderer/ladder/NotationDialog.tsx`
- Modify: `apps/desktop/src/renderer/ladder/LadderWorkspace.tsx`（ツールバーの隣にボタン）
- Modify: `apps/desktop/src/renderer/ladder/ladder.module.css`（末尾追記）
- Modify: `apps/desktop/src/renderer/app/store.ts`（`switchDialect()`）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/notation-dialog.test.tsx`（新規）
- Test: `apps/desktop/test/skin-workspace.test.tsx` / `store-plc.test.ts`（追随。ツールバーに1つ増える／`switchDialect()`）

§16 Phase 4 受入基準②（三菱で組んだラダーを OMRON 表記に切り替えると `0.00` 形式になる）の本体である。**IRは書き換えない**（4A H-2 / 決定表#11）。機種も一緒に変わるので**配線はやり直しになる**ことを先に伝える（決定表#12）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/notation-dialog.test.tsx`:

```tsx
import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import {
  COIL_COL,
  endNetwork,
  hline,
  network,
  no,
  out,
  program,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { NotationDialog } from '../src/renderer/ladder/NotationDialog.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

/** 出力はコイル列（`COIL_COL` = 15）に置く（`compile()` が最終列以外の出力を弾く）。 */
function coilRow(contacts: readonly Cell[], output: Cell): Cell[] {
  const line: Cell[] = [...contacts];
  while (line.length < COIL_COL) line.push(hline());
  line.push(output);
  return line;
}

const selfHold = program(network('n1', [coilRow([no(X(8))], out(Y(1)))]), endNetwork());

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
    useStore.getState().setLadder(selfHold);
  });
});

function dialog(onClose = vi.fn()): typeof onClose {
  render(<NotationDialog profile={MITSUBISHI_FX5U} onClose={onClose} />);
  return onClose;
}

describe('表記切替（§10.7 / §16 Phase 4 受入基準②）', () => {
  it('lists every dialect but the current one', () => {
    dialog();
    expect(screen.queryByTestId('notation-to-mitsubishi')).toBeNull();
    for (const id of ['omron', 'jtekt', 'sharp']) {
      expect(screen.getByTestId(`notation-to-${id}`)).toBeInTheDocument();
    }
  });

  it('previews how every device will be spelled (受入基準②)', () => {
    dialog();
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-omron'));
    });
    const rows = screen.getAllByTestId(/^notation-change-/u).map((row) => row.textContent);
    expect(rows.some((text) => text?.includes('X10') === true && text.includes('0.08'))).toBe(true);
    expect(rows.some((text) => text?.includes('Y1') === true && text.includes('100.01'))).toBe(true);
  });

  it('warns that the wiring will be cleared before switching (決定表#12)', () => {
    dialog();
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-omron'));
    });
    expect(screen.getByTestId('notation-warning')).toHaveTextContent('配線');
    // 確定するまで方言は変わらない
    expect(useStore.getState().dialectId).toBe('mitsubishi');
  });

  it('switches the dialect and the model but keeps the ladder (4A H-2)', () => {
    const onClose = dialog();
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-omron'));
      fireEvent.click(screen.getByTestId('notation-apply'));
    });
    const state = useStore.getState();
    expect(state.dialectId).toBe('omron');
    expect(state.ladder).toEqual(selfHold);
    expect(state.converted).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows what the target dialect cannot spell', () => {
    // 内部リレーを機種の範囲外へ置いたラダー（OMRON の W は 0..W-1）
    act(() => {
      useStore.getState().setLadder(selfHold);
    });
    dialog();
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-sharp'));
    });
    // 表せない項目が無ければ一覧は空でよい（`errors` の欄そのものは必ずある）
    expect(screen.getByTestId('notation-errors')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/notation-dialog.test.tsx
```

Expected: 失敗。`Failed to load url ../src/renderer/ladder/NotationDialog.js`。

- [ ] **Step 3: `ladder/NotationDialog.tsx` を作る**

```tsx
import {
  availableDialects,
  switchNotation,
  type DialectId,
  type DialectProfile,
  type NotationSwitchResult,
} from '@ojt/plc-dialects';
import { useMemo, useState, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import styles from './ladder.module.css';

/**
 * 表記切替ダイアログ。設計仕様 §10.7 / §16 Phase 4 受入基準②。決定表#11・#12
 *
 * **IRは書き換えない**（4A H-2）。切り替えるのは「どの方言で表示するか」だけで、
 * プログラムも取り消しスタックもそのまま残る。ただし機種（3Dの本体と端子名）も一緒に
 * 変わるため、**盤の配線はやり直しになる**。それを先に伝えてから確定する。
 */
export function NotationDialog({
  profile,
  onClose,
}: {
  profile: DialectProfile;
  onClose: () => void;
}): JSX.Element {
  const program = useStore((s) => s.ladder);
  const [target, setTarget] = useState<DialectId | undefined>(undefined);
  const others = useMemo(
    () => availableDialects().filter((other) => other.id !== profile.id),
    [profile],
  );
  const preview: NotationSwitchResult | undefined = useMemo(() => {
    if (target === undefined || program === undefined) return undefined;
    const to = others.find((other) => other.id === target);
    return to === undefined ? undefined : switchNotation(program, profile, to);
  }, [others, profile, program, target]);

  return (
    <div className={styles.notation} role="dialog" aria-label={JA.ladder.notationTitle} data-testid="notation-dialog">
      <h2 className={styles.sideTitle}>{JA.ladder.notationTitle}</h2>
      <p className={styles.sideNote}>{JA.ladder.notationHelp}</p>
      <div className={styles.notationPicker}>
        {others.map((other) => (
          <button
            key={other.id}
            type="button"
            data-testid={`notation-to-${other.id}`}
            aria-pressed={target === other.id}
            onClick={() => {
              setTarget(other.id);
            }}
          >
            {other.displayName}
          </button>
        ))}
      </div>
      {preview === undefined ? null : (
        <>
          <p className={styles.notationWarn} data-testid="notation-warning">
            {JA.ladder.notationWarning}
          </p>
          <table className={styles.ioTable}>
            <thead>
              <tr>
                <th scope="col">{JA.ladder.notationFrom}</th>
                <th scope="col">{JA.ladder.notationTo}</th>
              </tr>
            </thead>
            <tbody>
              {preview.changes.length === 0 ? (
                <tr>
                  <td colSpan={2}>{JA.ladder.notationNoChange}</td>
                </tr>
              ) : null}
              {preview.changes.map((change, index) => (
                <tr key={`${change.from}-${String(index)}`} data-testid={`notation-change-${String(index)}`}>
                  <td>{change.from}</td>
                  <td>{change.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={styles.notationErrors} data-testid="notation-errors">
            {preview.errors.map((issue, index) => (
              <li key={`${issue.code}-${String(index)}`}>{issue.message}</li>
            ))}
          </ul>
          <div className={styles.notationActions}>
            <button
              type="button"
              data-testid="notation-apply"
              onClick={() => {
                useStore.getState().switchDialect(preview.to);
                onClose();
              }}
            >
              {JA.ladder.notationApply}
            </button>
            <button type="button" data-testid="notation-cancel" onClick={onClose}>
              {JA.inspectRepair.cancel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `store.ts` に `switchDialect()` を足す**

`AppState` のアクション宣言（`setDialect` の直後）:

```ts
  /**
   * 表記（メーカー）を切り替える。§10.7 / 決定表#12
   * 方言と課題の機種を差し替え、盤と履歴を作り直す。**ラダーとデバイスコメントは持ち越す。**
   * 機種が変わると端子名が変わるので、配線は残せない（盤に無い端子を指す電線ができる）。
   */
  switchDialect: (dialectId: DialectId) => void;
```

実装（`setDialect` の直後）:

```ts
  switchDialect: (dialectId) => {
    const { problem, ladder, ladderComments } = get();
    // 課題を開いていないときのために先に入れる（モードDなら下の `openProblem()` が入れ直す）
    set({ dialectId });
    if (problem === undefined || !isPlcProblem(problem)) return;
    const swapped = plcForVendor(problem, dialectId);
    if (swapped === undefined) {
      const model = plcUnitForVendor(dialectId)?.model ?? dialectId;
      get().toast(JA.plc.modelNotUsable(model, problem.plc.model), 'error');
      return;
    }
    /*
     * `openProblem()` が方言 → 機種 → 盤・履歴・ログ・計時を作り直す。**`vendor` を必ず渡す**
     * （渡さないと `defaultVendor` に戻され、切り替えたはずの方言が元へ戻る。決定表#24）。
     * ラダーとデバイスコメントだけ持ち越す（決定表#12）。
     */
    get().openProblem(swapped, { vendor: dialectId });
    set({ ladder, ladderComments, converted: false, convertIssues: NO_CONVERT_ISSUES });
    get().toast(JA.plc.notationSwitched(getDialect(dialectId).displayName));
  },
```

（`getDialect` を `@ojt/plc-dialects` の import に足す。）

- [ ] **Step 5: `LadderWorkspace.tsx` にボタンを足す**

ツールバーの `toolbarGap` の直後（回路ブロック操作の4ボタンの後ろ）に足す:

```tsx
        <button
          type="button"
          data-testid="toolbar-notation"
          onClick={() => {
            setNotationOpen(true);
          }}
        >
          {JA.ladder.notationTitle}
        </button>
```

`const [notationOpen, setNotationOpen] = useState(false);` を足し、`workspaceSide` の先頭に:

```tsx
          {notationOpen ? (
            <NotationDialog
              profile={profile}
              onClose={() => {
                setNotationOpen(false);
              }}
            />
          ) : null}
```

- [ ] **Step 6: `i18n/ja.ts` と `ladder.module.css` に足す**

`JA.ladder` の Plan 4B ブロック:

```ts
    /** 表記切替（§10.7）。 */
    notationTitle: '表記切替',
    notationHelp: '同じラダーを別メーカーの表記で表示します。プログラムは書き換わりません。',
    notationWarning:
      '機種も切り替わるため、盤の配線はやり直しになります（ラダーとデバイスコメントは残ります）。',
    notationFrom: 'いまの表記',
    notationTo: '切替後',
    notationNoChange: '表記が変わるデバイスはありません。',
    notationApply: 'この表記に切り替える',
```

`JA.plc` の Plan 4B ブロック:

```ts
    notationSwitched: (name: string): string => `${name} の表記に切り替えました`,
```

`ladder.module.css` の末尾:

```css
/* --- Plan 4B Task 8: 表記切替ダイアログ --- */
.notation {
  border: 1px solid rgb(0 0 0 / 20%);
  background: var(--skin-output, #fff);
  padding: 8px;
  margin-bottom: 8px;
}

.notationPicker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.notationWarn {
  font-size: 11px;
  color: #b34700;
  margin: 0 0 8px;
}

.notationErrors {
  font-size: 11px;
  color: var(--skin-error, #d14343);
  margin: 8px 0;
  padding-left: 16px;
}

.notationActions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 7: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/notation-dialog.test.tsx test/skin-workspace.test.tsx test/store-plc.test.ts
```

Expected: すべて通過（`notation-dialog` は 5 ケース）。

```powershell
git add apps/desktop/src/renderer apps/desktop/test
git commit -m "feat(desktop): add the notation switch dialog for mode D"
```

---

## Task 9: 命令語リストのエクスポート（§10.7 / 受入基準⑥）

**モデル: Opus**（IPCを1本増やす判断と main 側の検証があるため）

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`（`textfileSave` と型、`OjtApi`）
- Modify: `apps/desktop/src/shared/messages.ts`（`MSG.textFile`）
- Create: `apps/desktop/src/main/text-files.ts`
- Modify: `apps/desktop/src/main/ipc.ts` / `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/ladder/OutputWindow.tsx`（書き出しボタンと指摘欄）
- Modify: `apps/desktop/src/renderer/ladder/LadderWorkspace.tsx`（書き出しの実体）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/instruction-list-export.test.tsx`（新規）
- Test: `apps/desktop/test/text-files.test.ts`（新規・main 側）
- Test: `apps/desktop/test/output-window.test.tsx` / `runtime.test.ts`（追随。`onExport` / `exportIssues` と IPC 7本）

§10.7「命令語リストのエクスポート（テキスト、UTF-8、CRLF）。ファイル出力先は利用者が選ぶ」＝受入基準⑥である。**IPCを7本目にする**（決定表#13・意図的な差分 #1）。

- [ ] **Step 1: 失敗するテストを書く（main 側）**

`apps/desktop/test/text-files.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const showSaveDialog = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) as unknown },
}));

let dir = '';
const { MAX_TEXT_BYTES, saveTextFile } = await import('../src/main/text-files.js');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ojt-text-'));
  showSaveDialog.mockReset();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('saveTextFile（§10.7 / §13 #7）', () => {
  it('writes the text as UTF-8 exactly as given (CRLF は 4A が付けている)', async () => {
    const target = join(dir, 'il.txt');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const result = await saveTextFile(undefined, {
      defaultFileName: 'd-001_命令語リスト.txt',
      text: '0000  LD        X0\r\n0001  OUT       Y0\r\n',
    });
    expect(result).toEqual({ ok: true, path: target });
    expect(readFileSync(target, 'utf8')).toBe('0000  LD        X0\r\n0001  OUT       Y0\r\n');
    // BOM は付けない（§10.7 は UTF-8 とだけ定める）
    expect(readFileSync(target)[0]).not.toBe(0xef);
  });

  it('reports a cancel without writing anything', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    const result = await saveTextFile(undefined, { defaultFileName: 'a.txt', text: 'x' });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ canceled: true });
  });

  it('refuses a text that is too large (§13 #7 / 本プランの決定)', async () => {
    const result = await saveTextFile(undefined, {
      defaultFileName: 'a.txt',
      text: 'x'.repeat(MAX_TEXT_BYTES + 1),
    });
    expect(result.ok).toBe(false);
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('strips path separators from the suggested file name', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    await saveTextFile(undefined, { defaultFileName: '../../evil/name.txt', text: 'x' });
    const options = showSaveDialog.mock.calls[0]?.[0] as { defaultPath?: string } | undefined;
    expect(options?.defaultPath).not.toContain('..');
    expect(options?.defaultPath).toContain('name.txt');
  });
});
```

- [ ] **Step 2: 失敗するテストを書く（renderer 側）**

`apps/desktop/test/instruction-list-export.test.tsx`:

```tsx
import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import {
  COIL_COL,
  empty,
  endNetwork,
  hline,
  network,
  no,
  out,
  program,
  X,
  Y,
  type Cell,
  type LadderProgram,
} from '@ojt/ladder-core';
import { MITSUBISHI_FX5U, SHARP_JW300 } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

/**
 * 出力を**コイル列**（`COIL_COL` = 15）に置いた1行。
 * `compile()` は最終列以外の出力を `コイル・タイマ・カウンタ・MC/MCR は最終列（15）に置きます`
 * で弾く（`ladder-core/src/compile.ts` L326-332）ので、素の `[no(X(0)), hline(), out(Y(0))]`
 * は `compile-failed` になって命令語リストが1行も出ない。
 */
function coilRow(contacts: readonly Cell[], output: Cell): Cell[] {
  const line: Cell[] = [...contacts];
  while (line.length < COIL_COL) line.push(hline());
  line.push(output);
  return line;
}

const simple = program(network('n1', [coilRow([no(X(0))], out(Y(0)))]), endNetwork());
const saveTextFile = vi.fn();

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  saveTextFile.mockReset().mockResolvedValue({ ok: true, path: 'C:/tmp/il.txt' });
  (window as unknown as { ojt: unknown }).ojt = {
    listProblems: vi.fn(),
    readProblem: vi.fn(),
    saveWorkFile: vi.fn(),
    loadWorkFile: vi.fn(),
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    saveTextFile,
  };
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
    useStore.getState().setLadder(simple);
  });
});

describe('命令語リストの書き出し（§10.7 / §16 Phase 4 受入基準⑥）', () => {
  it('writes the mnemonics of the current dialect', async () => {
    render(
      <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(saveTextFile).toHaveBeenCalledTimes(1);
    });
    const request = saveTextFile.mock.calls[0]?.[0] as { defaultFileName: string; text: string };
    expect(request.text).toContain('LD');
    expect(request.text).toContain('OUT');
    expect(request.text.endsWith('\r\n')).toBe(true);
    expect(request.defaultFileName).toContain(problem.id);
  });

  it('writes the SHARP mnemonics when that skin is open (受入基準⑥)', async () => {
    render(
      <LadderWorkspace problem={problem} profile={SHARP_JW300} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(saveTextFile).toHaveBeenCalled();
    });
    const request = saveTextFile.mock.calls[0]?.[0] as { text: string };
    expect(request.text).toContain('STR');
    expect(request.text).not.toContain('LD ');
  });

  it('explains an output with no path from the left rail, instead of writing a file', async () => {
    // 直並列に分解できない回路（`not-series-parallel`。4A `instruction-list.ts` L445-455）
    act(() => {
      useStore.getState().setLadder(unreachableOutputProgram());
    });
    render(
      <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('il-issues')).toHaveTextContent('左母線');
    });
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  it('tells the trainee where the file went', async () => {
    render(
      <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(useStore.getState().toasts.at(-1)?.text).toContain('C:/tmp/il.txt');
    });
  });
});
```

同じファイルの末尾にヘルパを置く:

```ts
/**
 * `not-series-parallel` になるラダー。§10.7 / 4A `instruction-list.ts` L445-455
 *
 * 4A の `reduceToExpr()` は**渡り（縦線・横線）を先に縮約してから**直並列に潰すので、
 * いわゆるブリッジ回路は素直に分解できてしまう。実際に `not-series-parallel` が返るのは
 * **左母線から出力まで辿れる道が1本も残らないとき**である。コイルはコイル列（`COIL_COL`）に
 * 置きつつ、その左を空セルのままにすると、左母線から届く枝が無くなって分解に失敗する
 * （`compile()` はこれを通す——「左母線に繋がっていない回路」の診断が無いため。申し送り F-1）。
 */
function unreachableOutputProgram(): LadderProgram {
  const isolated: Cell[] = Array.from({ length: COIL_COL }, () => empty());
  return program(network('n1', [[...isolated, out(Y(0))]]), endNetwork());
}
```

> このテストが確かめたいのは**文言**（`not-series-parallel` の平易な説明が出て、保存しない）で
> あって、この形そのものではない。RED の段階で `instructionList()` の `errors` に
> `not-series-parallel` が入ることを確かめてから先へ進む（`compile-failed` が返ってきたら
> 形を作り直す）。

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/text-files.test.ts test/instruction-list-export.test.tsx
```

Expected: 失敗。`Failed to load url ../src/main/text-files.js` と `[data-testid="export-il"]` が無い。

- [ ] **Step 4: `shared/ipc.ts` に7本目を足す**

```ts
/**
 * IPCチャネル名。§4.3
 * Phase 4 で `file:saveText` を足して**7本**になった（Plan 4B 意図的な差分 #1）。
 * 命令語リストの保存（§10.7「ファイル出力先は利用者が選ぶ」）には保存ダイアログが要り、
 * renderer からはダイアログを開けないためである。preload はこの7本だけを公開する。
 */
export const IPC_CHANNELS = {
  contentList: 'content:list',
  contentRead: 'content:read',
  workfileSave: 'workfile:save',
  workfileLoad: 'workfile:load',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  textfileSave: 'file:saveText',
} as const;

/** テキストファイルの保存要求（命令語リスト）。§10.7 */
export interface SaveTextRequest {
  /** 保存ダイアログに出す既定のファイル名（パス区切りは main 側で落とす）。 */
  defaultFileName: string;
  /** 中身。改行は呼び出し側が整えてから渡す（`instructionList()` は CRLF 済み）。 */
  text: string;
}

/** 保存結果（`WorkFileSaveResult` と同じ形）。§13 #7 */
export type SaveTextResult =
  { ok: true; path: string } | { ok: false; canceled: boolean; message: string };
```

`OjtApi` に足す:

```ts
  /** テキストファイルを保存する（命令語リスト）。§10.7 */
  saveTextFile: (request: SaveTextRequest) => Promise<SaveTextResult>;
```

- [ ] **Step 5: `shared/messages.ts` に文言を足す**

```ts
  textFile: {
    saveTitle: '命令語リストを保存',
    filterName: 'テキストファイル',
    saveCanceled: '保存を取り消しました',
    /** 中身が大きすぎる（壊れた／作為的な要求）。§13 #8 */
    tooLarge: '書き出す内容が大きすぎます',
  },
```

- [ ] **Step 6: `main/text-files.ts` を作る**

```ts
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { SaveTextRequest, SaveTextResult } from '../shared/ipc.js';
import { MSG, saveFailedText } from '../shared/messages.js';

/**
 * テキストファイルの保存（命令語リスト）。設計仕様 §10.7 / §13 #7。
 * `work-files.ts` と同じ流儀で、**保存先は利用者が選ぶ**（`dialog.showSaveDialog`）。
 * 中身は呼び出し側（renderer）が作った文字列をそのまま UTF-8 で書く。BOM は付けない。
 */

/**
 * 書き出せるテキストの最大バイト数（命令語リストは大きくても数十KB）。
 * §13 #7（ファイルI/Oは main 側で大きさを確かめる）＋本プランの決定。§13 #8 は
 * 「黙って壊れた状態で開かない」の項で、上限の話ではない。
 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * 既定のファイル名を安全にする（renderer からの生入力を信用しない）。§13 #7
 *
 * **順番が肝**（レビュー B4）: 先に区切りを `_` へ置換してから `basename()` を通すと、
 * `'../../evil/name.txt'` が `'.._.._evil_name.txt'` になって `..` が残り、
 * `defaultPath` に `..` が出たままになる（テストが落ちる）。`basename()` を**先**に通して
 * ディレクトリ部を捨て、残った名前から Windows で使えない文字と先頭の `.` を落とす。
 *
 *   `'../../evil/name.txt'` → basename `'name.txt'` → `'name.txt'`
 *   `'..'`                  → basename `'..'`       → 先頭の `.` が消えて空 → `'export.txt'`
 */
function safeFileName(name: string): string {
  const base = basename(name)
    // Windows のファイル名に使えない文字（`/` `\` は `basename()` が既に落としている）
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    // 先頭の `.` は隠しファイル・`.`／`..` になるので落とす
    .replace(/^\.+/u, '')
    .trim();
  return base.length === 0 ? 'export.txt' : base;
}

/** テキストを保存する。 */
export async function saveTextFile(
  window: BrowserWindow | undefined,
  request: SaveTextRequest,
): Promise<SaveTextResult> {
  if (typeof request.text !== 'string' || Buffer.byteLength(request.text, 'utf8') > MAX_TEXT_BYTES) {
    return { ok: false, canceled: false, message: MSG.textFile.tooLarge };
  }
  const defaultPath = join(app.getPath('documents'), safeFileName(request.defaultFileName));
  const options = {
    title: MSG.textFile.saveTitle,
    defaultPath,
    filters: [{ name: MSG.textFile.filterName, extensions: ['txt'] }],
  };
  const picked =
    window === undefined
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(window, options);
  if (picked.canceled || picked.filePath === undefined) {
    return { ok: false, canceled: true, message: MSG.textFile.saveCanceled };
  }
  try {
    writeFileSync(picked.filePath, request.text, 'utf8');
    return { ok: true, path: picked.filePath };
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: saveFailedText(error instanceof Error ? error.message : String(error)),
    };
  }
}
```

> `app.getPath('documents')` はテストの `vi.mock('electron')` で差し替える（`getPath: () => dir`）。

- [ ] **Step 7: `main/ipc.ts` と `preload/index.ts` に7本目を足す**

`main/ipc.ts`（見出しコメントの「6チャネル」も「7チャネル」に直す）:

```ts
  ipcMain.handle(IPC_CHANNELS.textfileSave, async (event, request: SaveTextRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return saveTextFile(window, request);
  });
```

`preload/index.ts`:

```ts
  saveTextFile: (request: SaveTextRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.textfileSave, request) as Promise<SaveTextResult>,
```

- [ ] **Step 8: `OutputWindow.tsx` に書き出しボタンと指摘欄を足す**

props に足す:

```ts
  /** 命令語リストの書き出し（§10.7 / 決定表#14）。 */
  onExport: () => void;
  /** 書き出せなかった理由（`INSTRUCTION_LIST_MESSAGES` の文言＋平易な説明）。 */
  exportIssues: readonly string[];
```

ヘッダに足す（`convert-state` の隣）:

```tsx
        <button type="button" data-testid="export-il" onClick={onExport}>
          {JA.ladder.exportIl}
        </button>
```

一覧の下に足す:

```tsx
      {exportIssues.length === 0 ? null : (
        <ul className={styles.notationErrors} data-testid="il-issues">
          {exportIssues.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
```

- [ ] **Step 9: `LadderWorkspace.tsx` に書き出しの実体を足す**

```ts
import { instructionList, INSTRUCTION_LIST_MESSAGES } from '@ojt/plc-dialects';
import { ojtApi } from '../app/ojt-api.js';
// …
  const [exportIssues, setExportIssues] = useState<readonly string[]>([]);

  /**
   * 命令語リストを書き出す。§10.7 / 受入基準⑥
   * 文言は 4A の `INSTRUCTION_LIST_MESSAGES` を使い、直並列に分解できない回路
   * （`not-series-parallel` ＝ 左母線から出力まで辿れる道が無い）だけは**平易な直し方**を
   * 足して出す。
   */
  const exportIl = useCallback((): void => {
    const store = useStore.getState();
    const current = store.ladder;
    if (current === undefined) return;
    const list = instructionList(current, profile);
    if (list.errors.length > 0) {
      setExportIssues(
        list.errors.map((issue) => {
          /*
           * `INSTRUCTION_LIST_MESSAGES` は `Readonly<Record<string, string>>` で3キーしか入って
           * いない（landed `instruction-list.ts` L45-49 / 前提#11）。`issue.code` はただの
           * `string` なので、**必ず `??` で受ける**（`noUncheckedIndexedAccess` の下で
           * `string | undefined` になる。無い鍵を引いたら `issue.message` に倒す。レビュー I9）。
           */
          const base = INSTRUCTION_LIST_MESSAGES[issue.code] ?? issue.message;
          return issue.code === 'not-series-parallel'
            ? `${base} ${JA.ladder.ilNotSeriesParallel}`
            : base;
        }),
      );
      return;
    }
    setExportIssues([]);
    try {
      void ojtApi()
        .saveTextFile({ defaultFileName: `${problem.id}_命令語リスト.txt`, text: list.text })
        .then((result) => {
          const next = useStore.getState();
          if (result.ok) next.toast(JA.ladder.ilSaved(result.path));
          else if (!result.canceled) next.toast(result.message, 'error');
        });
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }, [problem, profile]);
```

`<OutputWindow … onExport={exportIl} exportIssues={exportIssues} />` を渡す。

- [ ] **Step 10: `i18n/ja.ts` に足す**

`JA.ladder` の Plan 4B ブロック:

```ts
    /** 命令語リストの書き出し（§10.7）。 */
    exportIl: '命令語リスト',
    ilSaved: (path: string): string => `命令語リストを保存しました: ${path}`,
    /**
     * `not-series-parallel` の平易な説明。§10.7
     * 4A の `reduceToExpr()` が分解に失敗するのは「左母線から出力まで辿れる道が無い」ときなので、
     * 訓練者にはその形で伝える（申し送り F-1 が同じ形の診断を `compile()` 側へ頼んでいる）。
     */
    ilNotSeriesParallel:
      'この回路は命令語リストに変換できません（左母線につながっていない出力があります）。出力の左に接点か横線を置いて、左母線までつないでください。',
```

- [ ] **Step 11: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/text-files.test.ts test/instruction-list-export.test.tsx test/output-window.test.tsx test/runtime.test.ts
pnpm --filter @ojt/desktop exec tsc -p tsconfig.json --noEmit
```

Expected: すべて通過（`text-files` 4 ケース、`instruction-list-export` 4 ケース）。`runtime.test.ts`（preload のチャネル一覧を見ているなら）の期待値を7本に直す。

```powershell
git add apps/desktop/src/shared apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer apps/desktop/test
git commit -m "feat(desktop): export the instruction list to a text file"
```

---

## Task 10: 3Dの `PlcUnit` を `PlcAppearance` から描く

**モデル: Opus**（正面座標 → 盤モデル座標の写像と、LEDが何を映すかの判断があるため）

**Files:**
- Create: `apps/desktop/src/renderer/three/appearance.ts`
- Modify: `apps/desktop/src/renderer/three/PlcUnit.tsx`（**4A H-7 が挙げた4定数を置き換える**）
- Modify: `apps/desktop/src/renderer/three/labels.ts`（**4A H-8**: `blockTerminalMark()` の `.` 分割）
- Test: `apps/desktop/test/plc-appearance-view.test.ts`（新規・純関数）
- Test: `apps/desktop/test/plc-scene.test.ts` / `test/materials.test.ts`（追随）

利用者要求「各メーカーのシーケンサーの外観を忠実に再現すること」の**描画側**である。色・寸法・面上の配置は**すべて 4A の `PlcAppearance` から**引き、`three/**` に hex も mm も書かない（決定表#15）。これで FX5U は濃灰（`#3A3D42`）の筐体＋明灰のヒンジ式端子カバー＋LED列＋RUN/STOP＋Ethernet／SD＋銘板になり（**現行の明灰 `#D8DBE0` から見た目が変わる**。4A H-7）、CP1E は明灰（アイボリー）の筐体＋黒の端子台になる。

あわせて **4A H-8** を直す: `three/labels.ts:267` の `blockTerminalMark()` は `terminal.id.split('.')` の2番目の断片を端子名にしているので、CP1E の `PLC.0.00` が `'0'`、JW300 の `PLC.COM.A` が `'COM'` になる。`parseTerminalId()`（`@ojt/circuit-sim`）の `.name` に差し替えないと、受入基準⑤（`PLC.COM.A` へ配線できる）の3D側が満たせない。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/plc-appearance-view.test.ts`:

```ts
import {
  JIPM_BOARD,
  PLC_UNIT_CP1E,
  PLC_UNIT_FX5U,
  PLC_UNIT_JW300,
  withPlcUnit,
} from '@ojt/board-model';
import { parseTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  faceRectToBoard,
  litLedKeys,
  PLC_BODY_Z_MM,
  type PlcLedState,
} from '../src/renderer/three/appearance.js';
import { blockTerminalMark } from '../src/renderer/three/labels.js';

const OFF: PlcLedState = { running: false, convertFailed: false, inputs: undefined, outputs: undefined };

describe('正面座標（左上原点・mm）→ 盤モデル座標（4A Task 9 / 決定表#15）', () => {
  it('puts a face rect at the unit position, measured from its top-left corner', () => {
    const unit = PLC_UNIT_FX5U;
    const rect = { x: 10, y: 20, w: 30, h: 6 };
    const box = faceRectToBoard(unit.pos, rect, 1);
    expect(box.cx).toBe(unit.pos.x + 10 + 15);
    expect(box.cy).toBe(unit.pos.y + 20 + 3);
    expect(box.z).toBe(1);
    expect(box.w).toBe(30);
    expect(box.h).toBe(6);
  });

  it('keeps the body a thin plate under the terminals (Plan 3B 意図的な差分 #1)', () => {
    expect(PLC_BODY_Z_MM).toBeGreaterThan(0);
    expect(PLC_BODY_Z_MM).toBeLessThan(PLC_UNIT_FX5U.sizeMm.depth);
  });
});

describe('LEDが映すもの（決定表#20）', () => {
  it('keeps POWER on and everything else off while the session is idle', () => {
    const lit = litLedKeys(PLC_UNIT_FX5U.appearance, OFF);
    expect(lit.has('status:PWR')).toBe(true);
    expect(lit.has('status:P.RUN')).toBe(false);
    expect(lit.has('status:ERR')).toBe(false);
    expect([...lit].every((key) => key.startsWith('status:'))).toBe(true);
  });

  it('lights RUN while the PLC runs and ERR after a failed convert', () => {
    expect(litLedKeys(PLC_UNIT_FX5U.appearance, { ...OFF, running: true }).has('status:P.RUN')).toBe(
      true,
    );
    expect(
      litLedKeys(PLC_UNIT_FX5U.appearance, { ...OFF, convertFailed: true }).has('status:ERR'),
    ).toBe(true);
  });

  it('lights the input and output lamps only from a monitor snapshot', () => {
    const lit = litLedKeys(PLC_UNIT_CP1E.appearance, {
      ...OFF,
      inputs: [true, false, true],
      outputs: [false, true],
    });
    const inputs = PLC_UNIT_CP1E.appearance.leds.filter((led) => led.group === 'input');
    const outputs = PLC_UNIT_CP1E.appearance.leds.filter((led) => led.group === 'output');
    expect(lit.has(`input:${inputs[0]?.name ?? ''}`)).toBe(true);
    expect(lit.has(`input:${inputs[1]?.name ?? ''}`)).toBe(false);
    expect(lit.has(`input:${inputs[2]?.name ?? ''}`)).toBe(true);
    expect(lit.has(`output:${outputs[1]?.name ?? ''}`)).toBe(true);
    // 点数より短いスナップショットでも落ちない
    expect(lit.has(`input:${inputs.at(-1)?.name ?? ''}`)).toBe(false);
  });

  it('never reads the AC wiring (決定表#20: 判定結果を漏らさない)', () => {
    // `PlcLedState` に配線の情報が無いことを型で縛る
    const keys = Object.keys(OFF).sort();
    expect(keys).toEqual(['convertFailed', 'inputs', 'outputs', 'running']);
  });
});

describe('端子名の名札（4A H-8）', () => {
  it('keeps a dotted terminal name whole (受入基準⑤)', () => {
    const comA = withPlcUnit(JIPM_BOARD, PLC_UNIT_JW300).terminals.find(
      (t) => String(t.id) === 'PLC.COM.A',
    );
    expect(blockTerminalMark(comA!)).toBe('COM.A');
    const cp1e = withPlcUnit(JIPM_BOARD, PLC_UNIT_CP1E).terminals.find(
      (t) => String(t.id) === 'PLC.0.00',
    );
    expect(blockTerminalMark(cp1e!)).toBe('0.00');
  });

  it('still names an ordinary board terminal the way Phase 1 did', () => {
    const chk = JIPM_BOARD.terminals.find((t) => String(t.id).startsWith('CHK.'));
    expect(blockTerminalMark(chk!)).toBe(parseTerminalId(chk!.id).name);
  });
});
```

（import は上のブロックに**すべて書いてある**。`labels.ts` は three を読み込まないので、
`happy-dom` でなくても（Node の環境でも）このテストは動く。）

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-appearance-view.test.ts
```

Expected: 失敗。`Failed to load url ../src/renderer/three/appearance.js`。

- [ ] **Step 3: `three/appearance.ts` を作る**

```ts
import type { PlcAppearance, PlcLedMark, Vec3 } from '@ojt/board-model';
// `labels.ts` も `FaceRect` を export している（別の形）。読み手が迷わないよう別名で読む（決定表#19）
import type { FaceRect as AppearanceRect } from '@ojt/board-model';

/**
 * PLC本体の外観（`PlcAppearance`）を3Dへ写す純関数。設計仕様 §10.1 / §17.1。決定表#15
 *
 * 色・寸法・面上の配置は**すべて `@ojt/board-model` の `PlcAppearance` が持つ**（4A 決定表#15）。
 * このファイルには hex も mm も書かない（厚みだけは 3D 固有の都合なのでここに置く）。
 * three を import しないので、`happy-dom` でも Node でも単体テストできる。
 *
 * 座標系: `PlcAppearance` は**正面の左上が原点・x が右・y が下・mm**。盤モデルも机上の面を
 * 同じ向きで見るので、本体の設置位置（`unit.pos` / `module.pos`）に足すだけで写る。
 */

/**
 * 筐体の厚み[mm]。
 * 実寸の奥行（FX5U は 83mm）まで出すと端子が谷底になってクリックしづらく、正面視でも端子列が
 * 見えなくなるので、薄い台として描く（Plan 3B 意図的な差分 #1 を踏襲）。
 */
export const PLC_BODY_Z_MM = 6;
/** ラックのモジュールの厚み[mm]（ベースより手前に出す）。 */
export const RACK_BODY_Z_MM = 8;
/** 端子カバー・造作を筐体から浮かせる高さ[mm]（Zファイティング避け）。 */
export const FACE_LIFT_MM = 0.4;
/** 端子の印字テクスチャの高さ[mm]。カバーより**手前**に置く（決定表#16）。 */
export const FACE_LABEL_LIFT_MM = 1.2;
/** LEDの高さ[mm]（印字よりさらに手前）。 */
export const FACE_LED_LIFT_MM = 1.6;

/** 盤モデル座標での箱（中心と大きさ）。 */
export interface FaceBox {
  cx: number;
  cy: number;
  z: number;
  w: number;
  h: number;
}

/**
 * 正面の矩形（左上原点・mm）を盤モデル座標の箱に直す。
 * @param origin 本体（ラックはモジュール）の左奥の角＝`unit.pos` / `module.pos`
 * @param zMm 盤面からの高さ[mm]
 */
export function faceRectToBoard(origin: Vec3, rect: AppearanceRect, zMm: number): FaceBox {
  return {
    cx: origin.x + rect.x + rect.w / 2,
    cy: origin.y + rect.y + rect.h / 2,
    z: zMm,
    w: rect.w,
    h: rect.h,
  };
}

/**
 * LEDが映す状態。決定表#20
 * **配線の情報は持たない**（`plcPowerIndependent` の判定結果を3Dから漏らさないため。
 * 3B 決定表#7）。本アプリのPLCはAC電源を電気的に解かないので、`POWER` は常時点灯である。
 */
export interface PlcLedState {
  /** RUN 中か。 */
  running: boolean;
  /** 直前の変換が失敗したか。 */
  convertFailed: boolean;
  /** モニタ中の入力（モニタでないときは `undefined`）。 */
  inputs: readonly boolean[] | undefined;
  /** モニタ中の出力。 */
  outputs: readonly boolean[] | undefined;
}

/** 本体表示LEDの名前 → 何を映すか。実機の印字は機種で違うので、名前で振り分ける。 */
function statusLit(name: string, state: PlcLedState): boolean {
  const upper = name.toUpperCase();
  if (upper === 'POWER' || upper === 'PWR') return true;
  if (upper === 'RUN' || upper === 'P.RUN') return state.running;
  if (upper === 'ERR' || upper === 'ERROR' || upper === 'FLT') return state.convertFailed;
  return false;
}

/**
 * 点灯しているLEDの鍵（`<group>:<name>`）。§10.1 / 決定表#20
 * 入出力表示灯は**モニタ中だけ**光る（`SimSnapshot.plc` はモニタ中しか載らない。3B 決定表#5）。
 */
export function litLedKeys(appearance: PlcAppearance, state: PlcLedState): Set<string> {
  const lit = new Set<string>();
  const counters: Record<PlcLedMark['group'], number> = { status: 0, input: 0, output: 0 };
  for (const led of appearance.leds) {
    const index = counters[led.group];
    counters[led.group] += 1;
    const on =
      led.group === 'status'
        ? statusLit(led.name, state)
        : led.group === 'input'
          ? (state.inputs?.[index] ?? false)
          : (state.outputs?.[index] ?? false);
    if (on) lit.add(`${led.group}:${led.name}`);
  }
  return lit;
}

/** 消灯しているLEDの色（点灯色を暗く見せる代わりに、共通の暗色を使う）。 */
export const LED_OFF_COLOR = '#4A4F58';
```

- [ ] **Step 4: `three/PlcUnit.tsx` を外観から描くように作り替える**

**前提#20b（H-7）の一覧と同じ7つ**を処理する。**削除する6つ**は `BODY_COLOR`（L21-22）・
`LED_D_MM`（L23-24）・`LED_LEFT_MM`（L25-26）・`LED_TOP_MM`（L27-33）・`BODY_Z_MM`（L35-40）・
`LABEL_LIFT_MM`（L48-49。`appearance.ts` の `FACE_LABEL_LIFT_MM` に置き換わる）で、
**残す2つ**は `PLC_LABEL_PAD_MM`（L42-47）と `plcFaceRect()`（L62）である。あわせて
`<PlcFace>` を切り出して export する（Task 11 の `PlcRack` が使う）:

```tsx
import type { BoardTerminal, PlcAppearance, PlcUnitDefinition, Vec3 } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import { useStore } from '../app/store.js';
import {
  faceRectToBoard,
  litLedKeys,
  FACE_LED_LIFT_MM,
  FACE_LIFT_MM,
  LED_OFF_COLOR,
  PLC_BODY_Z_MM,
  type PlcLedState,
} from './appearance.js';
// `faceRect()` は読まない（`plcFaceRect()` が landed のまま `labels.ts` の実装を包んでいる）
import { blockFaceTexture } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { TerminalHit, terminalTooltip } from './TerminalHit.js';
import { toScene } from './coords.js';

/**
 * 机上のPLC本体。設計仕様 §10.1 / §17。決定表#15
 *
 * 外形・色・端子カバー・LED・銘板・前面の造作はすべて `PlcAppearance`（`@ojt/board-model`）から
 * 引く。**このファイルに色も寸法も書かない**ので、実機と違うと分かったときの修正箇所は
 * `packages/board-model/src/plc-unit.ts` の `*_APPEARANCE` 1ファイルだけである（4A 決定表#15）。
 * **各社のロゴ・銘板画像・画面キャプチャは描かない**（§17 / PLC調査資料 §6）。銘板は
 * `appearance.nameplate`（型式の文字列だけ）を出す。
 */

/** ラベルは見せるだけ（drei の `Html` はラッパに `pointer-events: auto` を付ける）。 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** レイキャストを受けない（筐体が端子のクリックを奪わないように）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** いまのLEDの状態をストアから作る（決定表#20）。 */
export function useLedState(): PlcLedState {
  const running = useStore((s) => s.plcRunning);
  const convertFailed = useStore((s) => !s.converted && s.convertIssues.errors.length > 0);
  const inputs = useStore((s) => s.plcMonitor?.inputs);
  const outputs = useStore((s) => s.plcMonitor?.outputs);
  return useMemo(
    () => ({ running, convertFailed, inputs, outputs }),
    [running, convertFailed, inputs, outputs],
  );
}

/**
 * 外観1枚ぶん（本体、またはラックのモジュール1枚）の面を描く。
 * 筐体 → 端子カバー → 造作 → LED → 銘板の順に、盤面から少しずつ手前へ重ねる。
 */
export function PlcFace({
  origin,
  appearance,
  depthMm,
  ledState,
}: {
  /** 左奥の角（`unit.pos` / `module.pos`）。 */
  origin: Vec3;
  appearance: PlcAppearance;
  /** 筐体の厚み[mm]。 */
  depthMm: number;
  ledState: PlcLedState;
}): JSX.Element {
  const lit = useMemo(() => litLedKeys(appearance, ledState), [appearance, ledState]);
  const { width, height } = appearance.faceMm;
  return (
    <group name="plc-face">
      {/* 筐体。端子（z = 0）の**下**へ沈める（台の上に乗せると端子が埋まる） */}
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(appearance.bodyColor, { roughness: 0.65, metalness: 0.1 })}
        raycast={noPick}
        position={toScene({ x: origin.x + width / 2, y: origin.y + height / 2, z: -depthMm / 2 })}
        scale={[width, height, depthMm]}
      />
      {/* ヒンジ式の端子カバー（開いた状態で描く。決定表#16） */}
      {appearance.covers.map((cover) => {
        const box = faceRectToBoard(origin, cover.rect, -FACE_LIFT_MM);
        return (
          <mesh
            key={cover.id}
            geometry={UNIT_BOX}
            material={sharedMaterial(cover.color, { roughness: 0.8, metalness: 0 })}
            raycast={noPick}
            position={toScene({ x: box.cx, y: box.cy, z: box.z })}
            scale={[box.w, box.h, 1]}
          />
        );
      })}
      {/* 前面の造作（RUN/STOPスイッチ・コネクタ・スロット・固定ラッチ） */}
      {appearance.features.map((feature) => {
        const box = faceRectToBoard(origin, feature.rect, FACE_LIFT_MM);
        return (
          <mesh
            key={feature.id}
            geometry={UNIT_BOX}
            material={sharedMaterial(feature.color, { roughness: 0.7, metalness: 0.2 })}
            raycast={noPick}
            position={toScene({ x: box.cx, y: box.cy, z: box.z })}
            scale={[box.w, box.h, 1]}
          />
        );
      })}
      {/* LED。点灯色は `appearance` が持ち、消灯は共通の暗色にする（決定表#20） */}
      {appearance.leds.map((led) => {
        const box = faceRectToBoard(origin, led.rect, FACE_LED_LIFT_MM);
        const on = lit.has(`${led.group}:${led.name}`);
        return (
          <mesh
            key={`${led.group}:${led.name}`}
            geometry={UNIT_BOX}
            material={sharedMaterial(on ? led.color : LED_OFF_COLOR, {
              roughness: 0.3,
              metalness: 0,
            })}
            raycast={noPick}
            name={`led-${led.group}-${led.name}`}
            position={toScene({ x: box.cx, y: box.cy, z: box.z })}
            scale={[box.w, box.h, 0.8]}
          />
        );
      })}
      {/* 銘板は型式の文字だけ（ロゴ・ブランド名は描かない。§17 / 4A 前提#14） */}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={420}
        position={toScene({
          x: origin.x + appearance.nameplateRect.x + appearance.nameplateRect.w / 2,
          y: origin.y + appearance.nameplateRect.y + appearance.nameplateRect.h / 2,
          z: FACE_LED_LIFT_MM,
        })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{appearance.nameplate}</span>
      </Html>
    </group>
  );
}
```

`PlcUnit` の本体を差し替える（端子・印字・ツールチップは Phase 3 のまま）:

```tsx
export function PlcUnit({
  unit,
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
}: { /* props は Phase 3 のまま */ }): JSX.Element {
  const faceTexture = useMemo(() => blockFaceTexture(terminals, PLC_LABEL_PAD_MM), [terminals]);
  const face = useMemo(() => plcFaceRect(terminals), [terminals]);
  const ledState = useLedState();
  return (
    <group name="plc-unit">
      <PlcFace
        origin={unit.pos}
        appearance={unit.appearance}
        depthMm={PLC_BODY_Z_MM}
        ledState={ledState}
      />
      {/* 端子の印字は1枚のテクスチャ。**カバーより手前**に置く（決定表#16） */}
      {faceTexture === undefined || face === undefined ? null : (
        <mesh raycast={noPick} position={toScene({ x: face.cx, y: face.cy, z: FACE_LABEL_LIFT_MM })}>
          <planeGeometry args={[face.w, face.h]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      {terminals.map((terminal) => (
        <TerminalHit
          key={terminal.id}
          terminal={terminal}
          tooltip={terminalTooltip(terminal, terminal.label)}
          hovered={hoveredTerminal === terminal.id}
          pending={pendingTerminal === terminal.id}
          onHover={onHoverTerminal}
          onPick={onPickTerminal}
        />
      ))}
      {/* 機種名は本体の上に1枚（`displayName`。銘板とは別物） */}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={420}
        position={toScene({
          x: unit.pos.x + unit.sizeMm.width / 2,
          y: unit.pos.y + unit.sizeMm.height + 8,
          z: 0,
        })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{unit.displayName}</span>
      </Html>
    </group>
  );
}
```

（`plcFaceRect()` と `PLC_LABEL_PAD_MM` の既存の宣言は**そのまま残す**。`LABEL_LIFT_MM` だけは
`appearance.ts` の `FACE_LABEL_LIFT_MM` に置き換えて削除する。前提#20b の一覧と同じ。）

- [ ] **Step 5: `three/labels.ts` の端子名の切り出しを直す（4A H-8）**

`blockTerminalMark()` を差し替える（**`blockFaceTexture()` の本体と `ROLE_COLOR` は触らない**。
Plan 3B MERGE 注意 #15）:

```ts
/** 端子台の印字に使う短い名前（`PL1+` / `PB1c` / `P1` / `N1`）。§6.4 */
export function blockTerminalMark(terminal: BoardTerminal): string {
  /*
   * 端子名側は `.` を含んでよい（`PLC.0.00` / `PLC.COM.A`。§6.4 / 4A 前提#8）。
   * `split('.')` の2番目だけを取ると CP1E が `0`、JW300 が `COM` になり、機種を替えた
   * 瞬間に印字が壊れる（4A H-8）。**最初の `.` で割る `parseTerminalId()`** を使う。
   */
  const { part, name } = parseTerminalId(terminal.id);
  if (part === 'TB_PL') return `PL${name}`;
  if (part === 'TB_PB') return `PB${name}`;
  // 机上のPLC本体と壁コンセントは端子名そのものが印字（`X0` / `0.00` / `COM.A` / `L`）。§10.1
  if (part === PLC_PART_ID || part === OUTLET_ID) return name;
  return `${part}${name}`;
}
```

`import { parseTerminalId } from '@ojt/circuit-sim';` を足す（`labels.ts` は既に
`@ojt/circuit-sim` から `TerminalRole` を型 import しているので、依存は増えない）。

- [ ] **Step 6: `test/plc-scene.test.ts` を追随させる**

`BODY_COLOR` / `LED_TOP_MM` を参照しているケースを、`appearance` 由来の値に直す:

```ts
  it('paints the body in the colour the model describes (4A 決定表#15)', () => {
    expect(PLC_UNIT_FX5U.appearance.bodyColor).toBe('#3A3D42');
    expect(PLC_UNIT_CP1E.appearance.bodyColor).not.toBe(PLC_UNIT_FX5U.appearance.bodyColor);
  });
```

- [ ] **Step 7: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-appearance-view.test.ts test/plc-scene.test.ts test/scene.test.ts test/materials.test.ts
pnpm --filter @ojt/desktop exec tsc -p tsconfig.json --noEmit
```

Expected: すべて通過（`plc-appearance-view` は 4 describe / 9 ケース）。

```powershell
git add apps/desktop/src/renderer/three apps/desktop/test
git commit -m "feat(desktop): draw the PLC body from the model's appearance record"
```

---

## Task 11: ラック形の3D（`PlcRack.tsx`）と `BoardScene` の分岐

**モデル: Opus**（ベースとモジュールの重ね順・端子の持ち主の判断があるため）

**Files:**
- Create: `apps/desktop/src/renderer/three/PlcRack.tsx`
- Modify: `apps/desktop/src/renderer/three/BoardScene.tsx`（2箇所: import と分岐）
- Test: `apps/desktop/test/plc-rack-view.test.ts`（新規・純関数）
- Test: `apps/desktop/test/plc-scene.test.ts` / `desk-wires.test.tsx` / `board-scene.test.ts`（追記・追随）

§16 Phase 4 受入基準③（TOYOPUC のラックが3Dに出て `IN-12` のCOM端子へ配線できる）と⑤（JW300 のラックが出て `COM.A` へ配線できる）の本体である。**端子は `unit.terminals` の1本の配列のまま**（4A H-6 / 決定表#17）なので、配線操作は Phase 3 の仕組みがそのまま動く。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/plc-rack-view.test.ts`:

```ts
import { PLC_UNIT_JW300, PLC_UNIT_PC10G } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { RACK_BODY_Z_MM } from '../src/renderer/three/appearance.js';
import { rackModuleBoxes, rackTerminalsOf } from '../src/renderer/three/PlcRack.js';

describe('ラックの3D（§10.1 / §16 Phase 4 受入基準③⑤）', () => {
  it('lays the four TOYOPUC modules across the base, front of it', () => {
    const boxes = rackModuleBoxes(PLC_UNIT_PC10G);
    expect(boxes.map((box) => box.model)).toEqual(['POWER1', 'PC10G-1SP', 'IN-12', 'OUT-12']);
    for (const box of boxes) {
      expect(box.depthMm).toBe(RACK_BODY_Z_MM);
      // ベースの外形の内側に収まる
      expect(box.origin.x).toBeGreaterThanOrEqual(PLC_UNIT_PC10G.pos.x);
      expect(box.origin.x + box.appearance.faceMm.width).toBeLessThanOrEqual(
        PLC_UNIT_PC10G.pos.x + PLC_UNIT_PC10G.sizeMm.width,
      );
    }
    // 左から右へ、重ならずに並ぶ
    const xs = boxes.map((box) => box.origin.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('lays the four JW300 modules likewise', () => {
    expect(rackModuleBoxes(PLC_UNIT_JW300).map((box) => box.model)).toEqual([
      'JW-301PU',
      'JW-312CU',
      'JW-212NA',
      'JW-214SA',
    ]);
  });

  it('keeps every terminal on the rack, not on a module (4A H-6 / 決定表#17)', () => {
    const terminals = rackTerminalsOf(PLC_UNIT_PC10G);
    expect(terminals).toHaveLength(PLC_UNIT_PC10G.terminals.length);
    expect(terminals.map((t) => String(t.id))).toContain('PLC.ICOM0');
    // モジュール名は端子IDに入らない
    expect(terminals.every((t) => !String(t.id).includes('IN-12'))).toBe(true);
  });

  it('returns nothing for a one-piece unit', () => {
    /*
     * `modules: undefined` と**書かない**（レビュー I8）。`PlcUnitDefinition.modules` は
     * 任意の欄なので、`exactOptionalPropertyTypes` の下では `undefined` を明示的に代入できない。
     * 鍵ごと落とす。
     */
    const { modules: _modules, ...rest } = PLC_UNIT_PC10G;
    expect(rackModuleBoxes({ ...rest, form: 'unit' })).toEqual([]);
  });
});
```

`apps/desktop/test/plc-scene.test.ts` に足す:

```ts
  it('picks the rack drawing for a rack model and the body for a one-piece model', () => {
    expect(PLC_UNIT_PC10G.form).toBe('rack');
    expect(PLC_UNIT_JW300.form).toBe('rack');
    expect(PLC_UNIT_FX5U.form).toBe('unit');
    expect(PLC_UNIT_CP1E.form).toBe('unit');
  });
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-rack-view.test.ts
```

Expected: 失敗。`Failed to load url ../src/renderer/three/PlcRack.js`。

- [ ] **Step 3: `three/PlcRack.tsx` を作る**

```tsx
import type { BoardTerminal, PlcAppearance, PlcUnitDefinition, Vec3 } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import {
  FACE_LABEL_LIFT_MM,
  faceRectToBoard,
  PLC_BODY_Z_MM,
  RACK_BODY_Z_MM,
} from './appearance.js';
import { blockFaceTexture, faceRect } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { PlcFace, useLedState } from './PlcUnit.js';
import { TerminalHit, terminalTooltip } from './TerminalHit.js';
import { toScene } from './coords.js';

/**
 * ラック形のPLC（ベース＋モジュール）。設計仕様 §10.1 / §17 #21。決定表#17
 *
 * ベース1枚を薄い台として敷き、その手前に `unit.modules` の箱を並べる。**端子とその印字は
 * ここが1回だけ描く**（`unit.terminals` は平らな1本の配列で、端子IDにモジュール名は入らない。
 * 4A H-6）。これで Phase 3 の配線操作・経路生成・E2Eの射影がそのまま動く。
 * 色・寸法はすべて `PlcAppearance` から引く（4A 決定表#15）。
 */

/** ラベルは見せるだけ。 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

function noPick(): void {
  // 交差候補を積まない
}

/** 3Dが描くモジュール1枚ぶんの箱。 */
export interface RackModuleBox {
  model: string;
  displayName: string;
  origin: Vec3;
  appearance: PlcAppearance;
  depthMm: number;
}

/** ラックのモジュールを左から右へ（一体形は空配列）。 */
export function rackModuleBoxes(unit: PlcUnitDefinition): RackModuleBox[] {
  if (unit.form !== 'rack') return [];
  return [...(unit.modules ?? [])]
    .sort((a, b) => a.slot - b.slot)
    .map((module) => ({
      model: module.model,
      displayName: module.displayName,
      origin: module.pos,
      appearance: module.appearance,
      depthMm: RACK_BODY_Z_MM,
    }));
}

/** ラックの端子（機種の端子をそのまま。4A H-6）。 */
export function rackTerminalsOf(unit: PlcUnitDefinition): readonly BoardTerminal[] {
  return unit.terminals;
}

/** ラック形のPLC。 */
export function PlcRack({
  unit,
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
}: {
  unit: PlcUnitDefinition;
  terminals: readonly BoardTerminal[];
  hoveredTerminal: TerminalId | undefined;
  pendingTerminal: TerminalId | undefined;
  onHoverTerminal: (id: TerminalId | undefined) => void;
  onPickTerminal: (terminal: BoardTerminal) => void;
}): JSX.Element {
  const modules = useMemo(() => rackModuleBoxes(unit), [unit]);
  const ledState = useLedState();
  const faceTexture = useMemo(() => blockFaceTexture(terminals, RACK_LABEL_PAD_MM), [terminals]);
  const labelFace = useMemo(() => faceRect(terminals, RACK_LABEL_PAD_MM), [terminals]);
  const { width, height } = unit.sizeMm;
  return (
    <group name="plc-rack">
      {/* 基本ベース（モジュールより奥。`unit.appearance` が持つ色と `slot-rail`） */}
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(unit.appearance.bodyColor, { roughness: 0.75, metalness: 0.05 })}
        raycast={noPick}
        position={toScene({
          x: unit.pos.x + width / 2,
          y: unit.pos.y + height / 2,
          z: -(RACK_BODY_Z_MM + PLC_BODY_Z_MM) / 2,
        })}
        scale={[width, height, PLC_BODY_Z_MM]}
      />
      {modules.map((module) => (
        <group key={module.model} name={`rack-module-${module.model}`}>
          <PlcFace
            origin={module.origin}
            appearance={module.appearance}
            depthMm={module.depthMm}
            ledState={ledState}
          />
          {/* モジュール名はツールチップ代わりの名札（`displayName`。4A 引き渡し表） */}
          <Html
            center
            style={LABEL_STYLE}
            distanceFactor={520}
            position={toScene({
              x: module.origin.x + module.appearance.faceMm.width / 2,
              y: module.origin.y - 5,
              z: 0,
            })}
            zIndexRange={[10, 0]}
          >
            <span className="block-label">{module.displayName}</span>
          </Html>
        </group>
      ))}
      {/* 端子の印字はラック全体で1枚（モジュールごとに割らない。決定表#17） */}
      {faceTexture === undefined || labelFace === undefined ? null : (
        <mesh
          raycast={noPick}
          position={toScene({ x: labelFace.cx, y: labelFace.cy, z: FACE_LABEL_LIFT_MM })}
        >
          <planeGeometry args={[labelFace.w, labelFace.h]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      {terminals.map((terminal) => (
        <TerminalHit
          key={terminal.id}
          terminal={terminal}
          tooltip={terminalTooltip(terminal, terminal.label)}
          hovered={hoveredTerminal === terminal.id}
          pending={pendingTerminal === terminal.id}
          onHover={onHoverTerminal}
          onPick={onPickTerminal}
        />
      ))}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={420}
        position={toScene({ x: unit.pos.x + width / 2, y: unit.pos.y + height + 8, z: 0 })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{unit.displayName}</span>
      </Html>
    </group>
  );
}

/** ラックの端子の印字板の余白[mm]（`PlcUnit` と同じ理由で下端の列を切らない）。 */
const RACK_LABEL_PAD_MM = 6;
```

- [ ] **Step 4: `BoardScene.tsx` で描き分ける**

import に `import { PlcRack } from './PlcRack.js';` を足し、`board.plcUnit === undefined ? null : (` のブロックの `<PlcUnit …/>` を差し替える（**他の2部品（`Outlet` / `DeskWires`）と端子のメモ化は触らない**。MERGE 注意 #5）:

```tsx
            {board.plcUnit.form === 'rack' ? (
              <PlcRack
                unit={board.plcUnit}
                terminals={plcTerminals}
                hoveredTerminal={hoveredTerminal}
                pendingTerminal={pendingTerminal}
                onHoverTerminal={onHoverTerminal}
                onPickTerminal={onPickTerminal}
              />
            ) : (
              <PlcUnit
                unit={board.plcUnit}
                terminals={plcTerminals}
                hoveredTerminal={hoveredTerminal}
                pendingTerminal={pendingTerminal}
                onHoverTerminal={onHoverTerminal}
                onPickTerminal={onPickTerminal}
              />
            )}
```

（`plcTerminals` は既存の `useMemo` の名前に合わせる。`PlcUnit` へ渡していた props をそのまま使う。）

- [ ] **Step 5: 机上配線の確認（変更なしであることを確かめる）**

`DeskWires` は `deskWires(board, session)` が返す端子の座標をそのまま結ぶので、ラックでも**変更は要らない**（4A の `deskWires()` は機種に依らない。4A 前提#13）。`test/desk-wires.test.tsx` にラックのケースを1つ足して、それを固定する:

既存の `test/desk-wires.test.tsx` は `withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U)` の盤で
「`TB_PB.1a` → `PLC.X0` の机上ケーブルが1本描かれ、外すと `TubeGeometry` が解放される」ことを
固定している。**同じ主張をラックの盤でもう1ケース**足す（レビュー M11。壁コンセントの座標は
この主張と関係がないので触らない）:

```tsx
  it('routes the same desk cable when the PLC is a rack (受入基準③)', () => {
    // ラックの `IN-12` の端子は `X0`〜`XF`（4A 決定表#16）。端子IDにモジュール名は入らない（H-6）
    const rackBoard = withPlcUnit(JIPM_BOARD, PLC_UNIT_PC10G);
    const session = createSession(rackBoard, {
      roles: { S1: 'CR1', S7: 'CHK' },
      allowedColors: ['青'],
      extraParts: [],
      inventory: [],
    });
    const added = addWire(
      session,
      rackBoard,
      'TB_PB.1a' as TerminalId,
      'PLC.X0' as TerminalId,
      '青',
    );
    expect(added.ok).toBe(true);

    const disposeSpy = vi.spyOn(TubeGeometry.prototype, 'dispose');
    const { unmount } = render(<DeskWires board={rackBoard} session={session} />);
    expect(disposeSpy).not.toHaveBeenCalled();
    unmount();
    // 机上のケーブルがちょうど1本（＝`deskWires()` がラックの端子を FX5U と同じように引けている）
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });
```

（`PLC_UNIT_PC10G` を `@ojt/board-model` の import に足す。`createSession` / `addWire` /
`TerminalId` / `TubeGeometry` は既存の import のまま。）

- [ ] **Step 6: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-rack-view.test.ts test/plc-scene.test.ts test/desk-wires.test.tsx test/board-scene.test.ts
```

Expected: すべて通過（`plc-rack-view` は 4 ケース）。

```powershell
git add apps/desktop/src/renderer/three apps/desktop/test
git commit -m "feat(desktop): draw the TOYOPUC and JW300 racks in 3D"
```

---

## Task 12: カメラと射影を機種に追随させる

**モデル: Sonnet**（本書のコードをそのまま書き写せば通る）

**Files:**
- Modify: `apps/desktop/src/renderer/three/camera.ts`
- Modify: `apps/desktop/src/renderer/three/CameraPresets.tsx` / `navigation.ts`
- Modify: `apps/desktop/e2e/projection.ts`（**追記のみ**）
- Test: `apps/desktop/test/plc-camera.test.ts`（追記）
- Test: `apps/desktop/test/camera-presets.test.tsx` / `view-navigation.test.ts` / `scene.test.ts`（追随。`cameraPose()` の第2引数）

ラック（160 × 140mm）は FX5U（150 × 90mm）より大きいので、FX5U 基準の画角では下段の端子が切れる（前提#30）。`cameraPose(preset, options?)` の**第2引数**で機種を渡せるようにする（決定表#18。引数を省くと従来どおり FX5U）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/plc-camera.test.ts` に足す:

```ts
describe('機種ごとの「盤＋PLC」視点（決定表#18）', () => {
  it('keeps the FX5U rect as the default', () => {
    expect(plcViewRect(PLC_UNIT_FX5U)).toEqual(PLC_VIEW_RECT);
    expect(cameraPose('plc')).toEqual(cameraPose('plc', { plcUnit: PLC_UNIT_FX5U }));
  });

  it('widens the rect so a rack fits', () => {
    const rack = plcViewRect(PLC_UNIT_PC10G);
    expect(rack.w).toBeGreaterThanOrEqual(PLC_VIEW_RECT.w);
    expect(rack.h).toBeGreaterThanOrEqual(PLC_VIEW_RECT.h);
    // ラックの下端まで入る
    expect(rack.y + rack.h).toBeGreaterThanOrEqual(
      PLC_UNIT_PC10G.pos.y + PLC_UNIT_PC10G.sizeMm.height,
    );
  });

  it('stays inside the orbit distance limits for every model', () => {
    for (const unit of Object.values(PLC_UNITS)) {
      const rect = plcViewRect(unit);
      const distance = fitDistanceMm(rect.w, rect.h, PLC_VIEW_ASPECT);
      expect(distance, unit.model).toBeLessThanOrEqual(MAX_CAMERA_DISTANCE_MM);
      expect(distance, unit.model).toBeGreaterThanOrEqual(MIN_CAMERA_DISTANCE_MM);
    }
  });

  it('moves the target when the model changes', () => {
    expect(cameraPose('plc', { plcUnit: PLC_UNIT_JW300 }).target).not.toEqual(
      cameraPose('plc', { plcUnit: PLC_UNIT_FX5U }).target,
    );
    // 他のプリセットは機種で変わらない
    expect(cameraPose('front', { plcUnit: PLC_UNIT_JW300 })).toEqual(cameraPose('front'));
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-camera.test.ts
```

Expected: 失敗。`plcViewRect is not a function`。

- [ ] **Step 3: `camera.ts` を直す**

`PLC_VIEW_RECT` の IIFE を関数に切り出し、定数はその呼び出しにする:

```ts
/**
 * 「盤＋PLC」視点が収める矩形（盤モデル mm）。§10.1 / 3B 決定表#6 / 4B 決定表#18
 *
 * **盤・机上のPLC本体・壁コンセントを全部**入れる。機種によって本体の外形が違う
 * （FX5U 150×90 / CP1E 130×90 / ラック 160×140）ので、機種を引数に取る。
 * 数値は盤モデルの定義から求めるのでハードコードしない。
 */
export function plcViewRect(unit: PlcUnitDefinition): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = [
    0,
    BOARD_WIDTH_MM,
    unit.pos.x,
    unit.pos.x + unit.sizeMm.width,
    OUTLET_ORIGIN_MM.x,
    OUTLET_ORIGIN_MM.x + PLC_TERMINAL_PITCH_MM * 2,
  ];
  const ys = [
    0,
    BOARD_HEIGHT_MM,
    unit.pos.y,
    unit.pos.y + unit.sizeMm.height,
    OUTLET_ORIGIN_MM.y - PLC_TERMINAL_PITCH_MM,
    OUTLET_ORIGIN_MM.y + PLC_TERMINAL_PITCH_MM,
  ];
  // 以降は landed（`camera.ts` L136-143）と1文字も変えない
  const x = Math.min(...xs) - PLC_VIEW_MARGIN_MM;
  const y = Math.min(...ys) - PLC_VIEW_MARGIN_MM;
  return {
    x,
    y,
    w: Math.max(...xs) + PLC_VIEW_MARGIN_MM - x,
    h: Math.max(...ys) + PLC_VIEW_MARGIN_MM - y,
  };
}

/** 既定（FX5U）の矩形。既存の呼び出しと landed テストのために残す。 */
export const PLC_VIEW_RECT = plcViewRect(PLC_UNIT_FX5U);
```

`cameraPose` に任意の第2引数を足す:

```ts
/** 視点の付帯条件（いまは機種だけ）。 */
export interface CameraPoseOptions {
  /** モードDで机上に置いている本体。省くと FX5U（決定表#18）。 */
  plcUnit?: PlcUnitDefinition;
}

export function cameraPose(preset: CameraPreset, options: CameraPoseOptions = {}): CameraPose {
```

`case 'plc':` の中だけを差し替える:

```ts
    case 'plc': {
      // 机上のPLC本体と壁コンセントが収まるまで寄る（盤面の延長なので面直で見る）。§10.1
      const rect = plcViewRect(options.plcUnit ?? PLC_UNIT_FX5U);
      // ここから下は landed（`camera.ts` L244-254）と1文字も変えない
      const distance = fitDistanceMm(rect.w, rect.h, PLC_VIEW_ASPECT);
      const center: [number, number, number] = [
        rect.x + rect.w / 2 - w / 2,
        h / 2 - (rect.y + rect.h / 2),
        0,
      ];
      return {
        position: boardToWorld([center[0], center[1], distance]),
        target: boardToWorld(center),
        up: boardUp(),
      };
    }
```

`import type { PlcUnitDefinition } from '@ojt/board-model';` を足す（`PLC_UNIT_FX5U` の
値 import は landed 済み。`camera.ts` L7）。

- [ ] **Step 4: 呼び出し側から機種を渡す**

`three/CameraPresets.tsx`:

```ts
import { boardForProblem } from '../session/plc-session.js';
// …
  const plcUnit = useStore((s) => boardForProblem(s.problem).plcUnit);
  const to = cameraPose(preset, plcUnit === undefined ? {} : { plcUnit });
```

> `boardForProblem()` は `session/plc-session.ts` の純関数で、`three/**` から呼んでも循環しない
> （`plc-session.ts` は three を知らない）。`plcUnit` は課題が変わらない限り同じ参照なので、
> `useStore` の購読は増えても再描画は起きない。

`three/navigation.ts` の `cameraPose(preset)` も同じ形にする（`navigation.ts` は純関数なので、
**引数で受け取る**ようにして呼び出し側（`CameraPresets` / `useViewportShortcuts`）が渡す）:

```ts
export function poseForKey(
  preset: CameraPreset,
  options: CameraPoseOptions = {},
): CameraPose {
  return cameraPose(preset, options);
}
```

- [ ] **Step 5: `e2e/projection.ts` に機種を取る射影を足す（追記のみ）**

**既存の `PLC_BOARD` / `plcBoardPoint` / `plcTerminalPoint` は消さない**（MERGE 注意 #11）。下に足す:

```ts
/**
 * 機種を指定した机上の盤（Phase 4）。§10.1
 * 既定メーカーを変えると机上の本体が変わるので、E2Eも同じ機種で射影する必要がある。
 */
export function plcBoardFor(unit: PlcUnitDefinition): BoardDefinition {
  return withPlcUnit(JIPM_BOARD, unit);
}

/** 機種を指定した `plc` 視点の射影。 */
export function plcBoardPointFor(
  unit: PlcUnitDefinition,
  point: { x: number; y: number; z: number },
  box: CanvasBox,
): { x: number; y: number } {
  return projectToScreen(boardToWorld(toScene(point)), cameraPose('plc', { plcUnit: unit }), box);
}

/** 機種を指定した端子の射影（盤・PLC本体・壁コンセントのどれでも）。 */
export function plcTerminalPointFor(
  unit: PlcUnitDefinition,
  roles: SocketRoles,
  terminal: string,
  box: CanvasBox,
): { x: number; y: number } {
  const board = plcBoardFor(unit);
  const physical = toPhysicalTerminal(roles, terminal as TerminalId);
  const found = board.terminals.find((t) => t.id === physical);
  if (found === undefined) throw new Error(`端子が盤にありません: ${terminal}（${physical}）`);
  return plcBoardPointFor(unit, found.pos, box);
}
```

- [ ] **Step 6: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-camera.test.ts test/camera-presets.test.tsx test/view-navigation.test.ts test/scene.test.ts
pnpm --filter @ojt/desktop exec tsc -p tsconfig.json --noEmit
```

Expected: すべて通過（`plc-camera` に4ケース追加）。

```powershell
git add apps/desktop/src/renderer/three apps/desktop/e2e/projection.ts apps/desktop/test
git commit -m "feat(desktop): fit the plc view to whichever model is on the desk"
```

---

## Task 13: E2E（§16 Phase 4 受入基準①〜⑥）とスキンのスクリーンショット

**モデル: Opus**（待ち方と機種切替の後始末の判断があるため）

**Files:**
- Create: `apps/desktop/e2e/plc-vendors.spec.ts`
- Modify: `apps/desktop/e2e/projection.ts`（Task 12 で足した関数を使うだけ。**追記のみ**）
- 変更しない: `apps/desktop/e2e/plc.spec.ts`（Phase 3 の4本はそのまま。決定表#22）

§16 Phase 4 の受入基準①〜⑥を、**利用者と同じ道筋**（設定画面でメーカーを選んでから課題を開く）で確かめる。各テストの最後に**既定メーカーを三菱へ戻す**（設定は `userData` に永続化されるので、戻さないと `plc.spec.ts` が落ちる。決定表#21）。

| 受入基準 | 何を確かめるか | スクリーンショット |
|---|---|---|
| ① | 既定メーカーを OMRON にすると CX-Programmer風で開き、**「変換」ボタンが出ない** | `41-omron-skin` |
| ② | 三菱で組んだラダーを OMRON 表記へ切り替えると `0.00` 形式になる | `46-notation-dialog` |
| ③ | TOYOPUC のラック（`POWER1`＋CPU＋`IN-12`＋`OUT-12`）が3Dに出て `PLC.ICOM0` へ配線でき、`1X010` と `1Y010` を同時に使うとバリデータがエラーを出す | `42-jtekt-skin` / `44-jtekt-rack` |
| ④ | シャープでリレー番号に `8` を入れると8進エラーになる | `43-sharp-skin` |
| ⑤ | JW300 のラック（電源＋CU＋`JW-212NA`＋`JW-214SA`）が3Dに出て `PLC.COM.A` へ配線できる | `45-sharp-rack` |
| ⑥ | 命令語リストをテキストへ書き出すと方言どおりの命令名で出力される。変換できない回路（左母線につながっていない出力）のときは保存せず理由を出す | `47-instruction-list` |
| （基準外） | GX Works3風の画面（比較用） | `40-mitsubishi-skin` |

- [x] **Step 1: `e2e/plc-vendors.spec.ts` を書く**

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PLC_UNIT_JW300, PLC_UNIT_PC10G } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, toSocketRoles, type PlcProblem } from '@ojt/content';
import { COIL_COL } from '@ojt/ladder-core';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { plcTerminalPointFor, type CanvasBox } from './projection.js';

/**
 * 4メーカーのE2E（§16 Phase 4 受入基準①〜⑥）。
 * `plc.spec.ts`（Phase 3 の4本）は触らない（決定表#22）。文言は `src/renderer/i18n/ja.ts` と
 * 同じものを書き写している（E2E は成果物を外から触る）。
 *
 * **設定は `userData` に残る**ので、どのテストも最後に既定メーカーを三菱へ戻す（決定表#21）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');
const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
const WINDOW = { width: 1440, height: 900 } as const;

const PROBLEM: PlcProblem = (() => {
  const found = BUILTIN_PLC_PROBLEMS[0];
  if (found === undefined) throw new Error('内蔵モードD課題がありません');
  return found;
})();
const ROLES = toSocketRoles(PROBLEM.board.socketRoles);

async function shot(app: ElectronApplication, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(base64, 'base64'));
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    window.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
    window.show();
    window.focus();
  }, WINDOW);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('mode-plc')).toBeVisible({ timeout: 30_000 });
  const restore = page.getByTestId('restore-prompt');
  if ((await restore.count()) > 0) {
    await page.getByRole('button', { name: '復元しない' }).click();
  }
  return { app, page };
}

/** 設定画面で既定メーカーを選ぶ（＝利用者と同じ道筋。決定表#21）。 */
async function setVendor(page: Page, vendor: string): Promise<void> {
  // ホーム画面の設定ボタン（`screens/Home.tsx` L83。`polish.spec.ts` L68 と同じ名前）
  await page.getByTestId('open-settings').click();
  const select = page.getByTestId('setting-vendor');
  await expect(select).toBeVisible();
  await select.selectOption(vendor);
  await expect(page.getByTestId('toast').filter({ hasText: '設定を保存しました' })).toBeVisible();
  await page.getByRole('button', { name: '戻る' }).click();
  await expect(page.getByTestId('mode-plc')).toBeVisible();
}

/** ホーム → PLC → 課題を開く。 */
async function openPlcProblem(page: Page): Promise<void> {
  await page.getByTestId('mode-plc').click();
  await expect(page.getByTestId('problem-table')).toBeVisible();
  await page.getByTestId(`open-${PROBLEM.id}`).click();
  await expect(page.getByTestId('plc-session')).toBeVisible();
}

/** 3D盤だけを大きく出す（端子の当たり判定が 4mm しかないので画角を稼ぐ）。 */
async function showBoardOnly(page: Page): Promise<CanvasBox> {
  await page.getByTestId('view-board').click();
  await expect(page.getByTestId('plc-session')).toHaveAttribute('data-view', 'board');
  await page.waitForTimeout(900);
  await expect(page.getByTestId('viewport')).toBeVisible();
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toHaveCount(1, { timeout: 30_000 });
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

async function key(page: Page, name: string): Promise<void> {
  await page.getByTestId('ladder-editor').press(name);
}

async function commitDevice(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId('device-input')).toBeVisible();
  await page.getByTestId('device-text').fill(text);
  await page.getByTestId('device-commit').click();
  await expect(page.getByTestId('device-input')).toHaveCount(0);
}

/** そのメーカーで開いてから、片付けまでを1本で回す（設定を必ず戻す。決定表#21）。 */
async function withVendor(
  vendor: string,
  body: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const { app, page } = await launch();
  try {
    await setVendor(page, vendor);
    await body(page, app);
  } finally {
    try {
      if (!page.isClosed()) {
        await page.getByTestId('open-settings').click({ timeout: 5_000 }).catch(() => undefined);
        await page.getByTestId('setting-vendor').selectOption('mitsubishi').catch(() => undefined);
      }
    } finally {
      await app.close();
    }
  }
}

test.describe('Phase 4 受入基準（4メーカー）', () => {
  test('① OMRON を選ぶと CX-Programmer風で開き「変換」ボタンが出ない', async () => {
    await withVendor('omron', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'omron');
      await expect(page.getByTestId('skin-title')).toContainText('CX-Programmer 風');
      await expect(page.getByTestId('toolbar-convert')).toHaveCount(0);
      await expect(page.getByTestId('toolbar-download')).toContainText('転送［PC → PLC］');
      // 手順表からも「変換」が落ちている（決定表#3）
      await expect(page.getByTestId('plc-guide')).not.toContainText('変換');
      // 機種も CP1E になっている（決定表#9）
      await expect(page.getByTestId('plc-model')).toContainText('CP1E');
      await shot(app, '41-omron-skin');
    });
  });

  test('② 三菱のラダーを OMRON 表記へ切り替えると 0.00 形式になる', async () => {
    await withVendor('mitsubishi', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'mitsubishi');
      await shot(app, '40-mitsubishi-skin');
      // X10（＝ IRの X(8)）と Y1 を置く
      await key(page, 'F5');
      await commitDevice(page, 'X10');
      await page.getByTestId(`cell-n1:0:${String(COIL_COL)}`).click();
      await key(page, 'F7');
      await commitDevice(page, 'Y1');
      await expect(page.getByTestId('cell-n1:0:0')).toContainText('X10');
      // 表記切替
      await page.getByTestId('toolbar-notation').click();
      await page.getByTestId('notation-to-omron').click();
      await expect(page.getByTestId('notation-change-0')).toContainText('0.08');
      await expect(page.getByTestId('notation-warning')).toContainText('配線');
      await shot(app, '46-notation-dialog');
      await page.getByTestId('notation-apply').click();
      // グリッドの表示が OMRON 表記になる（受入基準②）
      await expect(page.getByTestId('cell-n1:0:0')).toContainText('0.08');
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'omron');
    });
  });

  test('③ TOYOPUC のラックが3Dに出て ICOM0 へ配線でき、同番号はエラーになる', async () => {
    await withVendor('jtekt', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'jtekt');
      await expect(page.getByTestId('skin-title')).toContainText('PCwin 風');
      await expect(page.getByTestId('plc-model')).toContainText('PC10G-1SP');
      await shot(app, '42-jtekt-skin');
      // 3D: ラックの `IN-12` のCOM端子（`PLC.ICOM0`）へ盤の P1 から1本張る
      const box = await showBoardOnly(page);
      const from = plcTerminalPointFor(PLC_UNIT_PC10G, ROLES, 'P.1', box);
      const to = plcTerminalPointFor(PLC_UNIT_PC10G, ROLES, 'PLC.ICOM0', box);
      await page.mouse.click(from.x, from.y);
      await page.mouse.click(to.x, to.y);
      await expect(page.getByTestId('operation-log')).toContainText('PLC.ICOM0');
      // ラックのモジュール4枚の名札がDOMに出ている（`PlcRack` の `<Html>`。受入基準③）
      for (const label of ['POWER1', 'PC10G-1SP', 'IN-12', 'OUT-12']) {
        await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
      }
      await shot(app, '44-jtekt-rack');
      // 同番号（`1X010` と `1Y010`）を使うとバリデータがエラーを出す（4A 決定表#16）
      await page.getByTestId('view-ladder').click();
      await key(page, 'F5');
      await commitDevice(page, '1X010');
      await page.getByTestId(`cell-n1:0:${String(COIL_COL)}`).click();
      await key(page, 'F7');
      await commitDevice(page, '1Y010');
      // PCwin風は自動変換（決定表#3）なので、押さずに出力ウィンドウへ出る
      await expect(page.getByTestId('output-window')).toContainText('機種エラー');
    });
  });

  test('④ シャープでリレー番号に 8 を入れると8進エラーになる', async () => {
    await withVendor('sharp', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('ladder-workspace')).toHaveAttribute('data-skin', 'sharp');
      await expect(page.getByTestId('skin-title')).toContainText('JW-300SP 風');
      await key(page, 'F5');
      await expect(page.getByTestId('device-text')).toHaveAttribute('placeholder', '000000');
      await page.getByTestId('device-text').fill('000008');
      await page.getByTestId('device-commit').click();
      await expect(page.getByTestId('device-error')).toContainText('8進');
      // 入力欄は開いたまま（確定していない）
      await expect(page.getByTestId('device-input')).toBeVisible();
      await shot(app, '43-sharp-skin');
    });
  });

  test('⑤ JW300 のラックが3Dに出て COM.A へ配線できる', async () => {
    await withVendor('sharp', async (page, app) => {
      await openPlcProblem(page);
      await expect(page.getByTestId('plc-model')).toContainText('JW-300');
      const box = await showBoardOnly(page);
      const from = plcTerminalPointFor(PLC_UNIT_JW300, ROLES, 'P.1', box);
      const to = plcTerminalPointFor(PLC_UNIT_JW300, ROLES, 'PLC.COM.A', box);
      await page.mouse.click(from.x, from.y);
      await page.mouse.click(to.x, to.y);
      // 端子名が `COM` に切れていないこと（4A H-8）
      await expect(page.getByTestId('operation-log')).toContainText('PLC.COM.A');
      // ラックのモジュール4枚の名札がDOMに出ている（受入基準⑤）
      for (const label of ['JW-301PU', 'JW-312CU', 'JW-212NA', 'JW-214SA']) {
        await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
      }
      await shot(app, '45-sharp-rack');
    });
  });

  test('⑥ 命令語リストが方言どおりの命令名でテキストに出る', async () => {
    const target = join(tmpdir(), `ojt-il-${String(Date.now())}.txt`);
    await withVendor('sharp', async (page, app) => {
      // 保存ダイアログを固定パスへ差し替える（`inspect.spec.ts` と同じ手法）
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      }, target);
      await openPlcProblem(page);
      await key(page, 'F5');
      await commitDevice(page, '000000');
      await page.getByTestId(`cell-n1:0:${String(COIL_COL)}`).click();
      await key(page, 'F7');
      await commitDevice(page, '000020');
      await page.getByTestId('export-il').click();
      await expect(page.getByTestId('toast').filter({ hasText: '命令語リストを保存しました' })).toBeVisible();
      await shot(app, '47-instruction-list');
      const text = readFileSync(target, 'utf8');
      // シャープの命令名（§10.5 / 4A Task 4）で、CRLF 終端の UTF-8
      expect(text).toContain('STR');
      expect(text).toContain('OUT');
      expect(text.endsWith('\r\n')).toBe(true);
      expect(text).not.toContain('LD ');
      rmSync(target, { force: true });
    });
  });
});
```

> ここで使う `data-testid` は**すべて landed 済み**である（2026-09-19 に実ソースで確認）:
> `open-settings`（`screens/Home.tsx` L83）/ `mode-plc`（`Home.tsx` L69 の `mode-${key}`）/
> `problem-table`・`open-<id>`（`screens/ProblemList.tsx` L149）/ `plc-session`・`plc-guide`・
> `view-board`・`view-ladder`（`screens/PlcSession.tsx` L561 の `view-${value}` と L736）/
> `operation-log`（`panels/LogPanel.tsx`）/ `restore-prompt`・`toast`（`app/App.tsx`）/
> `ladder-editor`（`ladder/LadderEditor.tsx`）/ `device-input`・`device-text`・`device-commit`
> （`ladder/DeviceInput.tsx`）/ `output-window`（`ladder/OutputWindow.tsx`）/ `viewport`。
> 本プランが新しく足すのは `ladder-workspace` の属性（`data-skin` / `data-output-pane`）・
> `skin-title` / `skin-status` / `status-*` / `toolbar-*` / `plc-model` / `toolbar-notation` /
> `notation-*` / `export-il` / `il-issues` / `setting-*-auto` / `skin-assumed` だけである。

- [x] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop exec playwright test e2e/plc-vendors.spec.ts
```

Expected: 6本すべて失敗（実装前なら `data-skin` が無い等）。Task 1〜12 が済んでいれば通る。

- [x] **Step 3: 通るまで直してコミットする**

```powershell
pnpm --filter @ojt/desktop exec playwright test
```

Expected: **29本**（既存23 ＋ 本ファイル6）すべて通る。**2回連続で通ること**（3D の待ちが安定していることの確認）。
Task 14 Step 3 が同じファイルに品質のテストを1本足すので、**最終的には30本**になる。

```powershell
# `apps/desktop/screenshots/` は .gitignore 済み。スクリーンショットは**生成物**なので
# リポジトリに入れない（`git add` に混ぜると `paths are ignored` で失敗する）
git add apps/desktop/e2e/plc-vendors.spec.ts
git commit -m "test(desktop): cover the Phase 4 acceptance criteria for all four vendors"
```

---

## Task 14: 全体検証と仕上げ

**モデル: Sonnet**

**Files:** なし（検証のみ。見つかった不備はその場で直す）

- [ ] **Step 1: 一式を走らせる**

```powershell
pnpm -r test
pnpm -r typecheck
pnpm lint
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop exec playwright test
```

Expected: 7プロジェクトのテストが通る／`tsc` と ESLint（`import-x/no-cycle` ＋ `react-hooks` 込み）が無警告／Prettier が `All matched files use Prettier code style!`／`out/main` `out/preload` `out/renderer` の3つが出る／**E2E 30本**（既存23 ＋ `plc-vendors.spec.ts` 6 ＋ 品質1）。

- [ ] **Step 2: 方言の値が画面に直書きされていないことを確かめる**

`Select-String -Path` のワイルドカードは**再帰しない**ので、`Get-ChildItem -Recurse` で集めてから渡す。

```powershell
# キー文字列（方言が決める）が部品に直書きされていないこと。`skins/` と `plc-skin.ts` は除く
$files = Get-ChildItem -Recurse apps/desktop/src/renderer/ladder, apps/desktop/src/renderer/screens -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch 'skins' }
Select-String -Path $files -Pattern "'F4'|'F5'|'F7'|'Shift\+F" | Where-Object { $_.Line -notmatch '\?\?' }
# 期待: 0件（`?? 'F4'` のフォールバックだけが残る）

# 色とセル寸法が `three/**` と `ladder/**`（`skins/` 以外）に直書きされていないこと
$style = Get-ChildItem -Recurse apps/desktop/src/renderer/three, apps/desktop/src/renderer/ladder -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch 'skins' }
Select-String -Path $style -Pattern '#[0-9A-Fa-f]{6}'
# 期待: `appearance.ts` の `LED_OFF_COLOR` 1件だけ（決定表#5・#15）

# ベンダーのロゴ・画像が1つも無いこと（§17）
Get-ChildItem -Recurse apps/desktop/src/renderer -Include *.png,*.jpg,*.svg,*.webp
Select-String -Path (Get-ChildItem -Recurse apps/desktop/src/renderer/ladder -Include *.ts,*.tsx) -Pattern 'base64|https?://'
# 期待: どちらも0件
```

- [ ] **Step 3: 画面の品質（利用者要求「各画面のクオリティも可能な限り向上する」）**

E2E の窓を 1280×800 と 1920×1080 に変えて `plc-vendors.spec.ts` を走らせ、**4スキンすべて**で確かめる:

| 見るもの | 合格の線 |
|---|---|
| はみ出し | `document.documentElement.scrollWidth <= clientWidth`（横スクロールが出ない）。`plc-session` の中に `scrollHeight > clientHeight` のまま隠れる操作要素が無い |
| 余白 | 新しく足した CSS の `padding` / `gap` / `margin` が 4 の倍数（8px 格子）である |
| フォーカス | ツールバー・ステータスバー・ダイアログのすべての `button` / `input` / `select` が `:focus-visible` で枠を持つ（`outline` を `none` にしたまま代わりを置いていない箇所が無い） |
| 文字の切れ | 日本語のラベルが `overflow: hidden` で切れていない（ツールバーの `転送［PC → PLC］` とステータスバーの `デバイス点数` が全文出る） |

確認は E2E に1本足して自動化する:

```ts
  test('どのスキンでも 1280×800 と 1920×1080 ではみ出さない（利用者要求: 画面の品質）', async () => {
    for (const vendor of ['mitsubishi', 'omron', 'jtekt', 'sharp']) {
      await withVendor(vendor, async (page, app) => {
        await openPlcProblem(page);
        for (const size of [
          { width: 1280, height: 800 },
          { width: 1920, height: 1080 },
        ]) {
          await app.evaluate(({ BrowserWindow }, bounds) => {
            BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
          }, size);
          await page.waitForTimeout(400);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `${vendor} ${size.width}x${size.height}`).toBeLessThanOrEqual(0);
          // ツールバーの項目が全部読める（文字が切れていない）
          const clipped = await page.evaluate(() =>
            [...document.querySelectorAll('[data-testid^="toolbar-"]')].filter(
              (el) => el.scrollWidth > el.clientWidth + 1,
            ).length,
          );
          expect(clipped, `${vendor} のツールバーの文字が切れている`).toBe(0);
        }
      });
    }
  });
```

- [ ] **Step 4: 受入基準を手で1回ずつ通す**

`## 完了条件` の6基準を、ビルド済みのアプリで順に確かめる。スクリーンショット8枚
（`40-` 〜 `47-`）が `apps/desktop/screenshots/` に出ていることも確かめる（**コミットしない**）。

- [ ] **Step 5: 仕上げのコミット**

```powershell
git add apps/desktop
git commit -m "chore(desktop): finish Phase 4B verification"
```

---

## タスクと仕様節の対応

| タスク | 主に実装する仕様節 |
|---|---|
| Task 1 | §10.6（スキン定義の振る舞い）、§17.1（修正箇所の区分）、§16 Phase 4 受入基準① |
| Task 2 | §10.6（画面構成・列数・通電色）、§17.1・§17 #19、利用者要求（実物に忠実な回路入力画面） |
| Task 3 | §10.6（操作フローと `convertStep`）、§12.1（画面の常設注記）、§16 Phase 4 受入基準① |
| Task 4 | §10.3・§10.6（セルグリッドと記号）、§17 #22（シャープの常時ONはb接点）、§17（図記号ビットマップを持たない）、利用者要求 |
| Task 5 | §10.5（デバイス表記とバリデータ）、§10.1（機種の端子名）、§16 Phase 4 受入基準④ |
| Task 6 | §12.1（設定画面）、§10.5（既定メーカー）、§10.6（列数・通電色）、§16 Phase 4 受入基準① |
| Task 7 | §7.6（モードD課題）、§12.3（作業ファイル）、§16 Phase 4 受入基準①③⑤ |
| Task 8 | §10.7（表記切替）、§16 Phase 4 受入基準② |
| Task 9 | §10.7（命令語リストのエクスポート）、§4.3（IPC）、§13 #7・#8、§16 Phase 4 受入基準⑥ |
| Task 10 | §10.1（機種の外観）、§17（ロゴ・画像を持たない）、利用者要求（3Dの外観の忠実な再現）、4A H-7・H-8 |
| Task 11 | §10.1（ラック形）、§8.2（端子のピック）、§16 Phase 4 受入基準③⑤ |
| Task 12 | §12.2（3Dカメラ）、§10.1（机上の本体）、§14.2（E2Eの射影） |
| Task 13 | §16 Phase 4 受入基準①〜⑥、§14.2 ③ |
| Task 14 | §14.3（開発プロセス規則）、§15（性能・文言の集約）、利用者要求（画面の品質） |

---

## 仕様との対応表（完了判定に使う）

| 仕様 | 要件 | 実装 | 検証 |
|---|---|---|---|
| §10.6 | 4スキンのツールバー項目が実機の項目名で並ぶ | `toolbarItems()` ＋ `TOOLBAR_ACTIONS_BY_DIALECT` | `test/plc-skin.test.ts` / `skin-workspace.test.tsx` |
| §10.6 | CX-Programmer風・PCwin風に「変換」が無い | `profile.convertStep` ＋ `autoConvert()` | `skin-workspace.test.tsx`、E2E ① |
| §10.6 | 画面構成（ツリー・編集・出力／ステータスバー）がスキンごとに変わる | `SkinTheme.layout` / `SkinFrame` | `skin-theme.test.ts` / `skin-workspace.test.tsx` |
| §10.6 | 接点11列・通電色が4スキンで違う | `skinGridCols()` / `skinMonitorColor()` / `--skin-powered` | `plc-skin.test.ts` / `skin-theme.test.ts` |
| §10.6 | キー割当表がスキンごとに切り替わる | `ShortcutHelp`（`profile.shortcuts`） | `ladder-panels.test.tsx` |
| §10.5 | デバイス入力が方言の綴りとエラーを出す | `DeviceInput`（`formatDevice` / `parseDevice`） | `device-input.test.tsx`、E2E ④ |
| §10.5・§17 #22 | シャープの常時ON（`007366`）をb接点で描く（4A H-4） | `symbolIdOf()`（`profile.specialInverted`） | `skin-grid.test.tsx` |
| §10.7 | 表記切替が対象方言で表せない項目を一覧で示す | `NotationDialog`（`switchNotation()`） | `notation-dialog.test.tsx`、E2E ② |
| §10.7 | 命令語リストをテキスト（UTF-8・CRLF）へ、出力先は利用者が選ぶ | `saveTextFile()` ＋ `export-il` | `text-files.test.ts` / `instruction-list-export.test.tsx`、E2E ⑥ |
| §10.1 | 機種の外観（筐体色・端子カバー・LED・銘板・造作）を3Dが描く | `PlcFace`（`PlcAppearance`） | `plc-appearance-view.test.ts`、スクリーンショット |
| §10.1 | ラック（ベース＋4モジュール）が3Dに出る | `PlcRack` | `plc-rack-view.test.ts`、E2E ③⑤ |
| §10.1 | 端子名に `.` を含む機種でも名札が壊れない | `blockTerminalMark()` ＋ `parseTerminalId()` | `plc-appearance-view.test.ts`、E2E ⑤ |
| §12.1 | 設定画面で4メーカーを選べる | `Settings`（`availableDialects()`） | `settings-plc.test.tsx`、E2E ① |
| §12.2 | 「盤＋PLC」視点が機種に追随する | `plcViewRect(unit)` / `cameraPose(preset, options)` | `plc-camera.test.ts` |
| §12.3 | 作業ファイルが4方言を往復する | `toWorkFile()` / `applyWorkFile()` | `work-file-plc.test.ts` |
| §7.6 | 内蔵8題が既定メーカーの機種で開く | `plcForVendor()` ＋ `openProblem()` | `store-plc.test.ts`、E2E ①③⑤ |
| §4.3 | IPCは最小限（7本目は保存ダイアログのためだけ） | `IPC_CHANNELS.textfileSave` | `runtime.test.ts` / `text-files.test.ts` |
| §15・§17 | ロゴ・アイコン・画面キャプチャ・図記号ビットマップを持たない | `skins/*.ts` / `symbols.ts` / `three/**` | Task 14 Step 2 の grep |
| §17.1 | 前提の項目が画面から辿れる | `SkinTheme.assumed` / `appearance.assumed` / `shortcuts[].confirmed` | `settings-plc.test.tsx` |
| 利用者要求 | 回路入力画面が各メーカーのソフト画面に近い | 「実物との対応」表の全項目 | `skin-theme.test.ts` ＋ スクリーンショット4枚 |
| 利用者要求 | 画面の品質（はみ出し・余白・フォーカス・文字切れ） | Task 14 Step 3 | E2E の品質テスト1本 |

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本プランの実装 | 理由 |
|---|---|---|---|
| 1 | §4.3 は IPC チャネルを「**6本のみ**」と定める | **7本**にする（`file:saveText` を足す） | §10.7 が「命令語リストのファイル出力先は利用者が選ぶ」と定めており、保存ダイアログ（`dialog.showSaveDialog`）は main にしか置けない。`workfile:save` に相乗りさせると作業ファイルの検証（`parseWorkFile`・`.ojtw`）を通ることになり型も拡張子も合わない（決定表#13）。preload はこの7本だけを公開し、8本目は作らない |
| 2 | §10.6 は「操作フローは `convertStep` で分岐する」とだけ書く | `convertStep: false` のスキンは**ラダーが変わるたびに自動で変換**し、失敗してもトーストを出さない（出力ウィンドウだけ更新） | 4A H-3 が「判定前に `convert()` は必ず走らせる」と定めているので、押す場所が無い以上どこかで走らせるしかない。編集のたびにトーストを出すと1文字打つごとに積み上がる（決定表#3） |
| 3 | §10.6 は PCwin風のツールバーに `JP1` `DGR` `MOB` `STP` `RDY` `RUN` `RES` を挙げる | `STP` / `RUN` / `RES` だけを動かし、残り4つは淡色の `vendor-only`（押すと理由を出す） | 本アプリには対応する機能が無い（PLC調査資料 J-10 未確認）。消すと §10.6 の画面構成が再現できず、黙っていると壊れて見える（決定表#4） |
| 4 | §16 Phase 4 受入基準①は「設定で既定メーカーをOMRONにすると…スキンで開き」とだけ書く | 既定メーカーは**スキンだけでなく課題の機種も**決める（`plcForVendor()`） | 内蔵8題は全部 `mitsubishi` / `FX5U` なので、スキンだけ替えるとラダーが `0.00` なのに3Dの端子が `X0` になり、受入基準③⑤（ラックが3Dに出る）も一度も満たせない。4A 決定表#14 が「JSONは変えず `plc` だけ差し替える」と決めているので同じ規則に揃えた（決定表#9） |
| 5 | §10.6 は「利用者も設定画面から接点列数と通電色を変更できる」と書く | 既定値を「**メーカーの既定に従う**」（列数 `0` / 色は空文字）にする | 既定が三菱の青のままだと、OMRON を選んでも通電色が変わらず §10.6 の「色のみ各社に寄せる」が画面に出ない（前提#24・決定表#8） |
| 6 | §10.7 は「同じIRを別スキンで表示する」とだけ書く | 表記を切り替えると**機種も変わり、盤の配線はやり直し**になる（ラダーとコメントは残す） | 機種が変わると端子名が変わる（`X0` → `0.00` → `A0`）。配線を残すと盤に無い端子を指す電線ができて `validateBoard()` が落ちる（決定表#12）。ダイアログで先に伝えてから確定する |
| 7 | §10.1 は機種の外形寸法・端子集合・LEDの種類を定める | 3Dの筐体は**実寸の奥行きではなく薄い台**（本体 6mm / モジュール 8mm）として描く | 実寸（FX5U 83mm）まで出すと端子が谷底になってクリックしづらく、正面視で端子列が見えない（Plan 3B 意図的な差分 #1 を踏襲） |
| 8 | §10.1 は端子カバーを「着脱式端子台のカバー」と書く | カバーは**開いた状態**で描く（`hinge` は開く辺の記述として持つ） | 閉じたまま描くと端子が隠れて配線操作（§8.2）ができない（決定表#16） |
| 9 | §10.1 は入出力表示LEDが点くと書く | 入出力表示灯は**モニタ中だけ**点灯し、`POWER` は常時点灯にする | `SimSnapshot.plc` はモニタ中しか載らない（3B 決定表#5）。`POWER` を配線の有無で点けると `plcPowerIndependent` の判定結果を漏らす（3B 決定表#7 の禁止事項。決定表#20） |
| 10 | §10.6 の「スキン」は画面構成と操作フローまでを定める | **配色・セル寸法・記号の線の太さ・タイトルバー・ステータスバー**まで `SkinTheme` に記述する | 利用者要求（2026-09-19）が「各メーカーのソフト画面に合わせた可能な限り実物に忠実な画面」である。実機の画面キャプチャは使えない（§17.1 / PLC調査資料 §6）ので、公知の画面構成と一般に知られた色調から**自前で作図**し、値を1ファイルに集めて「実物との対応」表で前提の範囲を明示した（決定表#5） |
| 11 | §10.6 は記号の描き方に触れない | 記号の**形**（接点2本の縦棒・コイルの丸括弧）は4スキン共通にし、**寸法と線の太さ**だけをスキンで変える | 形まで4通りに分けても一次資料の裏づけが無く、△（前提）を増やすだけになる。形は JIS C 0617 に沿った共通の描き方である（決定表#6） |
| 12 | 「実物との対応」表はツリーの幅を方言ごとに 220〜260px と定める（△） | 実装は4スキン共通で**140px**（1600px 未満は 116px）に抑える。`--ladder-tree-w`（`ladder.module.css` の `.tree`）が常に勝ち、`SkinLayout.treeWidthPx` は「実物との対応」表の値の記録として残すだけで CSS には反映しない | 2026-09-19 UXバッチB の判断: 折りたたみ列（ツリー）を実物の幅に寄せるより、格子（回路の編集領域）に幅を渡すことを優先し、狭いほうを採った。将来スキンが 140px より狭い幅を持ったときだけスキンに従う（レビュー I4） |

---

## 実装者への MERGE 注意

複数のタスクが同じファイルへ別々の箇所から手を入れる。「推奨バッチ」で並行させるときは次の13点を守ること。

1. **`i18n/ja.ts` への挿入は、挿入のたびにファイルを読み直してから行う。** Task 3・5・6・7・8・9・10・11 がそれぞれ別の位置へ追記する。本プランは「`JA.ladder` と `JA.plc` と `JA.settings` の各ブロックの末尾に `// --- Plan 4B Task N ---` で挟んで足す」とだけ決めている。**Task 3 は既存の3件（`readOnly` / `notConverted` / `monitorOff`）を関数に置き換える**ので、他のタスクと同時に走らせない。
2. **`ladder/LadderWorkspace.tsx` は Task 3 が作り替え、Task 8（表記切替ボタン）と Task 9（命令語リストの書き出し）が足す。** 3 → 8 → 9 の順に直列で実行する（同じ `return` の JSX に3回手を入れる）。
3. **`ladder/ladder.module.css` は Task 2 が既存の色・寸法を `var(--skin-*)` に置き換え、Task 2・3・4・8 が末尾へ追記する。** クラス名は重ならない（`.titleBar` / `.statusBar` / `.vendorTool` / `.outputCollapsed` = Task 2・3、`.gridScroll` の背景 = Task 4、`.notation*` = Task 8）が、**同じファイルの末尾へ同時に書くと片方が消える**。追記のたびに読み直す。
4. **`shared/ipc.ts` は Task 6 の1箇所（`DEFAULT_SETTINGS` と `AppSettings` のコメント、`monitorColorMigrated` の欄）と Task 9 の1箇所（`IPC_CHANNELS` の7本目と `SaveTextRequest` / `SaveTextResult` / `OjtApi`）だけ。** **6 → 9 の順に直列**（バッチ B → C の順がそのまま順序になる）。
5. **`app/store.ts` は Task 6 の2箇所（`defaultVendor` の欄と `applyLadderSettings`）・Task 7 の3箇所（`OpenProblemOptions.vendor` / `openProblem()` の先頭＋`set()` の1行 / `resetSession()` の `openProblem()` 呼び出し）・Task 8 の2箇所（`switchDialect` の宣言と実装）だけ。** `plcFields()` の中身は**触らない**（Plan 3B の決定がそのまま生きる）。結果画面の「もう一度」は **`resetSession()`（L1158-1180）**であり、その `openProblem()` 呼び出しに **`vendor: state.dialectId`** を添える——添えないと、表記切替や作業ファイルで選んだ方言が「もう一度」で既定メーカーへ戻る（決定表#24。Task 7 Step 6）。**`restartSession()`（L1182-。WebGL が落ちたときの作り直し）は `openProblem()` を呼ばない**ので直すところは無い。
5b. **`session/work-file.ts` は Task 7 の1箇所だけ**（`openProblem()` への `vendor` の受け渡しと、後ろの `setDialect()` の削除）。`toWorkFile()` の `dialectId: state.dialectId` は**そのまま**でよい。
6. **`screens/PlcSession.tsx` は Task 3 の2箇所（手順表・表示列数）と Task 7 の1箇所（機種名）と Task 12 の0箇所**（カメラは `CameraPresets` が持つ）。`useEffect` の依存配列と Hooks の順序を崩さない（早期 return より前にすべての Hook を置く既存の並びを守る）。
7. **`three/PlcUnit.tsx` は Task 10 だけが触る。** `plcFaceRect()`（＝ `labels.ts` の `faceRect()` の再輸出）は**残す**（4A H-7）。`PlcFace` と `useLedState` を export するのは Task 11 が使うためで、`PlcUnit` の props は Phase 3 のまま変えない。
8. **`three/labels.ts` は Task 10 の1箇所（`blockTerminalMark()`）だけ。** `blockFaceTexture()` の本体と `ROLE_COLOR` は触らない（Plan 3B MERGE 注意 #15 がそのまま生きる）。
9. **`three/BoardScene.tsx` は Task 11 の2箇所（import と `PlcUnit` / `PlcRack` の分岐）だけ。** `visualSignature()` と端子のメモ化・傾斜グループの構造は触らない（Plan 3B MERGE 注意 #5）。
10. **`three/camera.ts` は Task 12 の3箇所（`plcViewRect()` の切り出し・`CameraPoseOptions`・`case 'plc'`）だけ。** 他のプリセットの式・`SOCKET_VIEW_*`・`MAX_POLAR_ANGLE` は触らない。
11. **`e2e/projection.ts` は追記のみ**（Task 12）。既存の `PLC_BOARD` / `plcBoardPoint` / `plcTerminalPoint` / `SELF_HOLD_WIRES` を消さない（Plan 3B MERGE 注意 #11 と同じ）。`e2e/plc.spec.ts` は**1行も変えない**（決定表#22）。
12. **`ladder/symbols.ts` と `ladder/LadderGrid.tsx` は着手時に他のエージェントが編集中のことがある**（本プラン作成時点で作業ツリーに未コミットの変更があった）。Task 4 に入る前に `git pull --rebase origin main` して**必ず読み直し**、`CELL_W` / `CELL_H` / `symbolShape()` / `LEAD_*` の既存 export を消さずに `symbolMetrics()` を足すこと。

---

## 完了条件

**機能:**

- [ ] `pnpm --filter @ojt/desktop test --no-file-parallelism` が全て通る（着手時の84ファイル ＋ 本プランで足した9ファイル＝93ファイル。着手時に測り直す。前提#36）。
- [ ] `pnpm -r test` で7プロジェクトがすべて通る。
- [ ] `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` ＋ `react-hooks` 込み）が無警告で通る。
- [ ] `npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"` が `All matched files use Prettier code style!` を出す。
- [ ] `pnpm --filter @ojt/desktop build` が main / preload / renderer の3つを出力する。
- [ ] `pnpm --filter @ojt/desktop e2e` が **30本**（着手時の23 ＋ `plc-vendors.spec.ts` の受入基準6 ＋ 画面の品質1）すべて通る。**2回連続で通ること。**
- [ ] **§16 Phase 4 受入基準①**: 設定で既定メーカーを OMRON にすると、CX-Programmer風のスキン（`data-skin="omron"`・タイトルバー `CX-Programmer 風`）で開き、**「変換」ボタンが出ない**。手順表からも「変換」の段が落ちている。
- [ ] **§16 Phase 4 受入基準②**: 三菱で `X10` / `Y1` を組んだラダーを表記切替ダイアログで OMRON にすると、一覧に `X10 → 0.08` / `Y1 → 100.01` が出て、確定するとグリッドの表示が `0.08` になる。
- [ ] **§16 Phase 4 受入基準③**: 既定メーカーを JTEKT にすると TOYOPUC のラック（`POWER1`＋`PC10G-1SP`＋`IN-12`＋`OUT-12` の4枚）が3Dに出て、`PLC.ICOM0` へ配線できる。`1X010` と `1Y010` を同時に使うと出力ウィンドウに「機種エラー」（`device-conflict`）が出る。
- [ ] **§16 Phase 4 受入基準④**: シャープのスキンでデバイス入力欄に `000008` を入れると `8進` を含むエラーが出て確定できない。入力例（placeholder）が `000000` である。
- [ ] **§16 Phase 4 受入基準⑤**: 既定メーカーをシャープにすると JW300 のラック（`JW-301PU`＋`JW-312CU`＋`JW-212NA`＋`JW-214SA`）が3Dに出て、**`PLC.COM.A`**（名札も `COM.A` のまま）へ配線できる。
- [ ] **§16 Phase 4 受入基準⑥**: 出力ウィンドウの「命令語リスト」から保存すると、UTF-8・CRLF のテキストがその方言の命令名（シャープなら `STR` / `OUT`）で書き出される。**左母線につながっていない出力**があるときは保存せず、平易な日本語の説明（`左母線` を含む）が出る。
- [ ] 作業ファイルが4方言すべてを往復する（`dialectId` と機種が戻る）。Phase 1〜3 に保存した作業ファイル（モードDの項目が無いもの）も読める。
- [ ] 設定画面で4メーカーが選べ、どれも `disabled` になっていない。「Phase 4 で対応します」の文言が画面から消えている。
- [ ] 通電色・表示列数の「メーカーの既定に従う」が既定で、外すと**いま選んでいるメーカーの色**から上書きが始まる（`DEFAULT_MONITOR_COLOR` のような固定値の定数がコードに無い）。
- [ ] 旧既定（`#1E64FF`）のまま保存されていた設定ファイルは、**読み込むと**「スキンの既定色」に移行し、`settings.json` に `monitorColorMigrated: true` が残る。**移行のあとで利用者が改めて `#1E64FF` を選んだら、それは消えない**（移行は `sanitizePatch()` に無い）。
- [ ] **セッションの途中で設定を保存しても、いま開いている方言が変わらない**（作業ファイルから復元した方言・表記切替で選んだ方言・結果画面の「もう一度」（`resetSession()`）のいずれでも既定メーカーへ戻らない。決定表#24 / MERGE 注意 #5）。
- [ ] `session/ladder-cell.ts` にカウンタ設定値の頭字（`/^K/`）が**そのまま**残っていない（`parseCounterPreset()` / `counterPresetText()` の中のフォールバックにだけある。申し送り F-2）。
- [ ] `AppSettings.defaultVendor` の型が `DialectId` で、`string` を受ける箇所が残っていない。

**画面の品質（利用者要求 2026-09-19）:**

- [ ] 4スキンすべてで、**1280×800 と 1920×1080** のどちらでも横スクロールが出ない（`scrollWidth <= clientWidth`）。
- [ ] 4スキンすべてで、ツールバーの項目とステータスバーの項目の**日本語が切れていない**（`scrollWidth <= clientWidth + 1`）。`転送［PC → PLC］` と `デバイス点数` が全文読める。
- [ ] 本プランで足した CSS の `padding` / `gap` / `margin` がすべて **4の倍数**（8px 格子）である。
- [ ] ツールバー・ステータスバー・表記切替ダイアログ・設定画面の**すべての操作要素**が `:focus-visible` で見える枠を持つ（`outline: none` のまま代替を置いていない箇所が無い）。
- [ ] 4スキンのスクリーンショット（`40-mitsubishi-skin` 〜 `43-sharp-skin`）を並べて、**背景色・格子線・セル寸法・ステータスバーの項目が見て区別できる**。
- [ ] 3Dのスクリーンショット（`44-jtekt-rack` / `45-sharp-rack`）で、ラックのモジュール4枚・端子・表示灯・銘板が読める。FX5U の筐体が**濃灰**になっている（4A H-7 の見た目の変化）。

**規律:**

- [ ] `apps/desktop/src/renderer/ladder/skins/` と `session/plc-skin.ts` の外に、方言ごとの値（キー文字列・色・セル寸法・機種名）が**1つも無い**（Task 14 Step 2 の grep が0件）。
- [ ] `three/**` に hex の色が `LED_OFF_COLOR` の1件しか無い（外観は `PlcAppearance` から）。
- [ ] `apps/desktop/src/renderer/` に画像ファイルが1つも無く、`base64` も外部URLも含まれない（§17）。
- [ ] IPCチャネルは**7本**（`file:saveText` を足しただけ）で、preload もその7本だけを公開している。
- [ ] 画面の文言がすべて `src/renderer/i18n/ja.ts`（と `src/shared/messages.ts`）にある。
- [ ] `packages/` への変更が**1行も無い**（`git diff --stat origin/main -- packages/` が空。4A の担当）。
- [ ] `apps/desktop/package.json` の依存が Phase 3 から**1つも増えていない**。

---

## 4A / `packages` への申し送り（本プランでは実装しない）

本プランは `apps/desktop` しか触らない。実装中に見つけた**パッケージ側の課題**をここに残す。

| # | 事象 | なぜ 4B で直さないか | 直す場所 |
|---|---|---|---|
| F-1 | **「左母線に繋がっていない回路」の診断が無い。** `applyLadderCell()` は接点とコイルの間を横線で自動的に埋める（Plan 3B 決定表）ので、訓練者は「左母線から切れた接点の群れ」を作りやすい。いまは `compile()` がそれを黙って「常時OFF」として通すため、出力ウィンドウにも何も出ず、判定で初めて不合格になる | 診断は `compile()`（IRの構造検査）の仕事で、`packages/ladder-core/src/compile.ts` に新しい `CompileErrorCode`（例: `unreachable-branch`）を足す話になる。4B は `packages/` を1行も触らない（本プランの Goal）。画面側は `ConvertErrorLine` をそのまま並べるだけなので、**4A 側で足せば 4B の変更なしに出力ウィンドウへ出る**（`errorCellKeys()` が `networkId` / `row` / `col` から赤枠も描く） | `packages/ladder-core/src/compile.ts` ＋ `@ojt/plc-dialects` の `convert()` はそのまま（`source: 'structure'` の行として流れる） |
| F-2 | **【済: 4A Task 7 / d721b23 で landed】** `apps/desktop/src/renderer/session/ladder-cell.ts` は L46 で `COUNTER_PRESET_PREFIX = /^K/iu`（三菱の `K30` の `K`）を直書きしており、三菱以外では正しい綴りを受けられなかった。方言の綴りの持ち主は `DialectProfile`（§10.5 / 決定表#1）なので 4A へ頼み、**対で landed した** | — | `DialectProfile` の **`counterPresetText?(preset)`** / **`parseCounterPreset?(text)`**（`packages/plc-dialects/src/profile.ts` L155-164。タイマの `timerPreset` / `parseTimerPreset` と同じ対）。4方言とも実装済み。**4B は Task 5 Step 3 でこの対をそのまま使う**（フォールバックは要らない） |

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-19 | 初版。Phase 4 のうち `apps/desktop`（4B）を扱う。方言ごとに変わるものを「振る舞い（`session/plc-skin.ts`）」と「見た目（`ladder/skins/*.ts` の `SkinTheme`）」の2ファイルに集め、ツールバーの項目 → 操作の対応を方言IDの表にした（位置で対応させる現行実装は三菱でしか合わない）。`convertStep: false` のスキンは自動変換にし、手順表からも「変換」を落とす。通電色・表示列数の既定を「メーカーの既定に従う」にし、課題の機種は開くときに既定メーカーの機種へ差し替える（内蔵8題はJSON無改変のまま4機種で成立する）。表記切替はIRを書き換えず機種だけ差し替え、配線はやり直しになることを先に伝える。命令語リストの保存のために IPC を7本目まで増やした。3Dは `PlcAppearance` を読んで描くだけにし、ラックは `PlcRack` が「ベース＋モジュール4枚」を描く。カメラの画角を機種から導くようにした |
| 2026-09-19 | 利用者要求（「ソフト図の回路入力画面も各メーカーのソフト画面や仕様に合わせた可能な限り実物に忠実な画面にすること」「各画面のクオリティも可能な限り向上すること」）を反映: `SkinTheme`（配色・セル寸法・記号の寸法・ペインの並び・タイトルバー・ステータスバー）と CSS カスタムプロパティによる流し込み、`SkinFrame`（タイトルバー・ステータスバー）、`symbolMetrics()`（スキン別の記号寸法）、デバイスコメントの行数、「実物との対応」表（全項目の値と ◎/△ の区分）、4スキンのスクリーンショット、`## 完了条件` の「画面の品質」節（1280×800 / 1920×1080 ではみ出さない・8px 格子・フォーカス枠・日本語が切れない）を追加。タスクを14本に組み直した |
| 2026-09-19 | Plan 3B 最終レビューの決定2件を反映: ①`monitorColor` の空文字を「スキンの既定色」と定義し直し（既定値 `''`、`sanitizePatch()` は `''` と `#rrggbb` を受ける、「既定に戻す」は `''` を書く、色見本は空のときいまのスキンの色を見せる）、**旧既定 `#1E64FF` のまま保存されている設定ファイルを読込時に移行**する（`LEGACY_MONITOR_COLOR`）。②既定メーカーは**課題を開くときの初期値**であり、`applyLadderSettings()` は `dialectId` を触らず `defaultVendor` だけを更新する。方言を決めるのは `openProblem(problem, { vendor })` の1箇所にし、作業ファイルの復元・表記切替・「もう一度」はそれぞれ自分の方言を渡す（前提#31b / 決定表#24）。`AppSettings.defaultVendor` を `DialectId` に狭めた。あわせて `## 4A / @ojt/ladder-core への申し送り`（F-1: 左母線に繋がっていない回路の診断）を追加 |
| 2026-09-19 | **レビュー反映: B1〜B6、I1〜I13、M1〜M11。** 主な変更: ①通電色の移行を `sanitizePatch()` から外して**読込の経路だけ**に置き、`monitorColorMigrated` の印で一度きりにした。`DEFAULT_MONITOR_COLOR` は作らず、上書きの初期色は「いま選んでいるメーカーの色」にした。移行のテストは main 側の実ファイル往復（`settings.test.ts`）へ移した（B1）。②`symbolMetrics()` を landed の `symbols.ts` に合わせ直した（`END_MARK` は配列、`leadAcrossHidden(lastContactIndex, row)` は2引数、`LINK_DOWN` は左辺、`symbolShape()` は `undefined` を返さない）。置換表を「署名を変えない」形に書き直した（B2）。③`emptyCellForm()` の引数を `'contact' | 'output'` に直した（B3）。④`safeFileName()` を `basename()` 先行に直した（B4）。⑤E2E の設定ボタンを実在する `open-settings` にし、testid の一覧を実ソースで確かめた（B5）。⑥カウンタ設定値の綴りを申し送り **F-2** としてプロファイルへ出し、**4A Task 7（d721b23）が `counterPresetText?(n)` / `parseCounterPreset?(text)` の対を landed させた**ので、Task 5 Step 3 はそれをそのまま使う（フォールバック無し。F-2 は「済」の記録に改めた。節名も `## 4A / packages への申し送り` に改めた）。あわせて `not-series-parallel` は「左母線から出力まで辿れる道が無い」ときに返ることを実装で確かめ、文言と試験用ラダー（`unreachableOutputProgram()`）をその形に直した。出力をコイル列（`COIL_COL`）に置かないと `compile()` が弾くことも突き止め、Task 8・9 のラダー標本を直した（B6）。⑦三菱の入出力 radix を 8 に直し、前提B/C の行番号・`VENDOR_LABELS` / `defaultVendor: DialectId` / `isDialectId` の「landed 済み」を反映（I1・I4・M1・M2）。⑧`applyLadderSettings` のカーソル詰めを残し（I3）、作業ファイルの復元は L602 の実パッチにし（I5）、結果画面の「もう一度」は `resetSession()` であることを突き止めて手順とテストを足した（I6 / MERGE 注意 #5）。⑨未完成のコード片（`symbolIdOf()` / `toWorkFile()` / 命令語リストの試験用ラダー / `plcViewRect()` / `case 'plc'` / Task 10 の import）をすべて書き切った（I7）。⑩`SkinSymbolStyle` を廃して `SkinCell.coilRxPx` にまとめ（I10）、`skinCssVars()` の未使用引数を落とし（M8）、`--skin-output-h` を出力ウィンドウにも効かせ、`SkinLayout.tree` を削除した（I11）。⑪自動変換の `useEffect` が毎レンダー走らないよう `onPlc` を ref に持たせた（I12）。⑫E2E ③⑤でラックのモジュール4枚の名札を確かめる（I13）。⑬H-7 の定数一覧を1つに揃え（M9）、ケース数（Task 1=12 / 3=14 / 4=6）とE2E総数（30）、ファイル構成（新規テスト9・`work-file.ts` / `OutputWindow.tsx` / `LadderEditor.tsx`）を実数に直した（M3・M4・M5） |
| 2026-09-19 | Plan 4A の改訂（6c875a1）を反映: 前提に H-7（`three/PlcUnit.tsx` の FX5U 決め打ち定数と `FX5U_APPEARANCE.bodyColor = '#3A3D42'` による見た目の変化）・H-8（`three/labels.ts:267` の `split('.')` が `PLC.0.00` / `PLC.COM.A` で壊れる。`parseTerminalId()` に差し替える）・JTEKT のアドレス写像（`X(i)` → `1X000`＋i、`Y(i)` → `1Y010`＋i。`device-conflict` は `1X010` と `1Y010` のときだけ）・`IoTable.tsx` と `MonitorPanel.tsx` の2行は 4A が直す、を追加。Task 10 に `labels.ts` の修正手順、E2E ③ の期待値を `1X010` / `1Y010` に更新 |
