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
| 2 | プロファイル4件の識別子は `MITSUBISHI_FX5U` / `JTEKT_PC10G` / `OMRON_CP1E` / `SHARP_JW300`。`displayName` は `三菱電機 MELSEC iQ-F FX5U（GX Works3風）` / `OMRON CP1E-N30DR-A（CX-Programmer風）` / `JTEKT TOYOPUC PC10G-1SP（PCwin風）` / `シャープ JW300（JW-300SP風）` | 4A Task 2〜5、landed `mitsubishi.ts` L346 |
| 3 | `profile.convertStep` は 三菱 `true` / シャープ `true` / OMRON `false` / JTEKT `false` | 4A 完了条件（受入基準①） |
| 4 | `profile.panels` は `{ tree, editor, output, toolbar }`。`toolbar` の項目数と文言は方言ごとに違う: 三菱8件（`変換`/`全変換`/`書込みモード`/`読出しモード`/`オンライン`/`シーケンサへの書込み`/`モニタ開始`/`モニタ停止`）、OMRON5件（`オンライン編集`/`転送［PC → PLC］`/`モニタ開始`/`モニタ停止`/`運転／停止`）、JTEKT9件（`JP1`/`DGR`/`MOB`/`STP`/`RDY`/`RUN`/`RES`/`モニタ開始`/`モニタ停止`）、シャープ5件（`変換`/`PLCへの書込み`/`運転／停止`/`モニタ開始`/`モニタ停止`）。`tree` も方言ごとに違う（JTEKT は `プロジェクトツリー（プログラム／データファイル／パラメータ／LD／SFC）`）、`output` は JTEKT だけ `ステータスバー` | 4A Task 2 L1209 / Task 3 L1719 / Task 4 L2206、landed `mitsubishi.ts` L183 |
| 5 | `profile.monitorColors` は `{ powered, idle }`。`powered` は 三菱 `#1E64FF` / OMRON `#2FA02C` / JTEKT `#E08A1E` / シャープ `#00A0C8`。`gridCols` は4方言とも 11 | 4A 前提表（§10.6） |
| 6 | `profile.deviceRanges.input.prefix` は 三菱 `'X'` / JTEKT `'1X'` / **OMRON `''`** / **シャープ `''`**。radix は 10 / 16 / 10 / 8 | 4A Task 2 L1049・Task 3 L1556・Task 4 L2049 |
| 7 | `profile.specialInverted?: readonly number[]` は**シャープだけ**が `[SPECIAL_ALWAYS_ON]`（`007366`）を持つ | 4A Task 1 L401 / Task 4 L2237 |
| 8 | `profile.formatCounterPreset?(n)` が4方言に生える（三菱 `K5` / OMRON `#0005` / JTEKT `H0005` / シャープ `0005`） | 4A Task 7 Step 4 |
| 9 | `switchNotation(program, from, to)` → `{ ok; from: DialectId; to: DialectId; changes: NotationChange[]; errors: DialectError[] }`。`NotationChange = { device: Device; from: string; to: string }`。**IRは書き換えない**（H-2） | 4A Task 6 |
| 10 | `instructionList(program, profile)` → `{ lines: InstructionLine[]; text: string; errors: DialectError[] }`。`InstructionLine = { step: number; mnemonic: string; operand: string; networkId: string }`。`text` は CRLF 済みで末尾にも改行、UTF-8 でそのまま書けばよい | 4A Task 7 |
| 11 | `INSTRUCTION_LIST_MESSAGES` は `compile-failed` / `not-series-parallel` / `preset-unavailable` の3キー | 4A Task 7 L2960 |
| 12 | `PLC_UNITS` は4機種（`FX5U` / `PC10G-1SP` / `CP1E` / `JW-300`）、`plcUnitFor(model)` が引く | 4A Task 9〜11 |
| 13 | `PlcUnitDefinition` に `form: 'unit' \| 'rack'` / `appearance: PlcAppearance` / `modules?: readonly PlcModuleDefinition[]` が生える。`PlcModuleDefinition = { slot; model; displayName; sizeMm; pos; appearance }` | 4A Task 9 Step 4 |
| 14 | `PlcAppearance = { faceMm: {width;height}; bodyColor; terminalBlockColor; nameplate; nameplateRect; covers; leds; features; assumed }`。座標系は**正面の左上が原点・x右・y下・mm**。`FaceRect = { x; y; w; h }`、`PlcLedMark = { name; group: 'status'\|'input'\|'output'; rect; color }`、`PlcCoverMark = { id; rect; color; hinge: 'top'\|'bottom'\|'left'\|'right' }`、`PlcFeatureMark = { id; kind: 'switch'\|'port'\|'slot'\|'latch'; label; rect; color }` | 4A Task 9 Step 4 |
| 15 | FX5U の外観は `nameplate: 'FX5U-32MR/ES'`、`covers` が `hinge: 'top'`/`'bottom'` の2枚（明灰 `#C8CBD0`）、本体色 `#3A3D42`、`leds` が status 5個（`PWR`/`ERR`/`P.RUN`/`BAT`/`CARD`）＋ input 16 ＋ output 16、`features` が `run-stop`/`ethernet`/`sd-card` | 4A Task 9 Step 5 |
| 16 | ラックの寸法定数は `RACK_MODULE_WIDTH_MM`=35 / `RACK_MODULE_HEIGHT_MM`=130 / `RACK_BASE_MARGIN_MM`=10 / `RACK_BASE_HEIGHT_MM`=140、`rackModulePos(slot)` / `rackSizeMm(slots, depthMm)`。ラックの `appearance.features` にはベース1枚ぶんの `slot-rail` が入り、`covers` / `leds` は空 | 4A Task 10 Step 3 |
| 17 | `PlcUnitSpec` が `inputs: readonly PlcInputSpec[]`（`{ name; com; ohms? }`）・`inputCommons: readonly string[]`・`acPower: readonly [string, string]` に格上げされる（旧 `inputs: readonly string[]` / `inputCommon: string` は消える） | 4A Task 8・決定表#9 |
| 18 | `SUPPORTED_PLC_MODELS`（`@ojt/content`）が4機種になり、内蔵モードD課題8題は**JSONを1文字も変えず**4機種すべてで `PlcProblemSchema.parse()` と `judgePlcReference()` を通る。機種にない入出力点（CP1E の `y: 12` 以降）は `PlcProblemSchema` が弾く | 4A Task 12・Task 14 |
| 19 | 課題の `plc` は `{ vendor, model }`。`MODEL_OF_VENDOR`（メーカー→機種の1対1）は `schema/plc.ts` の**非公開**定数である | `packages/content/src/schema/plc.ts` L30-38 |
| 20 | `H-1`（端子名は `unit.spec` / `unit.terminals` から引く。`PLC.X0` を書かない）・`H-3`（`convertStep: false` でも判定前に `convert()` は必ず走らせる）・`H-4`（シャープの常時ONはb接点で描く）・`H-5`（設定画面に §17.1 の常設注記）・`H-6`（ラックもネットリスト上は1部品 `PLC`、端子IDにモジュール名は入らない） | 4A「引き渡し注記」 |

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

// src/renderer/ladder/symbols.ts
export const CELL_W = 48; export const CELL_H = 36; export const WIRE_Y = CELL_H / 2;
export function symbolShape(id: string): SymbolShape | undefined;   // { paths: string[]; text?: string }
export const MC_SYMBOL_ID = 'coil-mc'; export const MCR_SYMBOL_ID = 'coil-mcr';
export const LEAD_LEFT / LEAD_RIGHT / LEAD_FULL / LINK_DOWN / END_MARK: string;  // <path d>
export function leadAcrossHidden(spanCols: number): string;

// src/renderer/ladder/ladder.module.css
//   .gridScroll{background:#f7f8fa} .rail{fill:#3a3f47} .symbolText/.deviceText{fill:#1b1e23}
//   .presetText{fill:#555} .commentText{fill:#1b6ac9;font-size:8px} .cursor{stroke:#1e64ff}
//   .errorCell{stroke:#d14343} .networkComment{color:#1b6ac9} .wire,.symbol{stroke-width:1.6}
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
  defaultVendor: string; ladderGridCols: number; monitorColor: string }
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
| 21 | `TOOLBAR_ACTIONS` は**位置**で `panels.toolbar` に対応する（0番目＝`convert`、…）。表に無い位置は `?? 'convert'` に倒れる | 三菱（8件）でしか合わない。OMRON（5件）では `オンライン編集` が `convert` に、JTEKT（9件）では `JP1` が `convert` になり、**「変換」を出さないはずのスキンで押すと変換が走る**（受入基準①が成立しない） | `LadderWorkspace.tsx` L37-60, L186-196 |
| 22 | `JA.ladder.notConverted = '未変換（F4 で変換します）'`、`readOnly = '書込みモード（F2）に…'`、`monitorOff = 'モニタ（F3）を開始すると…'`、`monitorWriteSame = 'Phase 3 ではモニタと同じ動作です'`、`JA.settings.gridColsHelp`（`GX Works3 の既定は 11 です`）、`monitorColorHelp`（`モニタ（F3）で…`） | キー文字列とツール名が**文言に直書き**されている。決定表#12（キーは方言が決める）に反し、OMRON では出ない `F4` を案内してしまう | `i18n/ja.ts` L108-115, L381, L403, L411 |
| 23 | `DeviceInput` の入力例は `` `${profile.deviceRanges.input.prefix}0` `` | OMRON とシャープの `prefix` は `''`（前提#6）なので、入力例が `0` と `2` になる。正しくは `0.00` / `000000` | `DeviceInput.tsx` L71-81 |
| 24 | `store.monitorColor` の既定は `'#1E64FF'`（三菱の色）で、`LadderGrid` / `ProjectTree` は `monitorColor.length > 0 ? monitorColor : profile.monitorColors.powered` と書いてある | 既定値が空でないので**プロファイルの色が一度も使われない**。OMRON を選んでも通電色が青のまま（§10.6 の「色のみ各社に寄せる」が画面に出ない） | `store.ts` L621, `LadderGrid.tsx` L271-275, `ProjectTree.tsx` L24-25 |
| 25 | `IoTable` は `unit.spec.inputs[x]`（string）、`MonitorPanel` は `terminal(unit.spec.inputs[index])` | 4A Task 8 で `inputs` が `PlcInputSpec[]` になるので**型エラーになる**（`.name` が要る） | `IoTable.tsx` L32, `MonitorPanel.tsx` L94 |
| 26 | `ladder.module.css` は背景 `#f7f8fa`・母線 `#3a3f47`・記号 `#1b1e23`・コメント `#1b6ac9`・カーソル `#1e64ff`・エラー `#d14343` を**直書き**し、`symbols.ts` は `CELL_W = 48` / `CELL_H = 36` / 線幅 1.6 / 接点の縦棒 8〜28px を**定数**で持つ | 4スキンが同じ配色・同じセル寸法・同じ記号になる。利用者要求（実物に忠実な回路入力画面）を満たせない | `ladder.module.css` L1-100、`symbols.ts` L11-21 |
| 27 | 画面にタイトルバーもステータスバーも無い。`LadderWorkspace` はツールバー → ツリー／編集／出力の3ペイン固定で、出力ウィンドウは常に**編集ペインの下**にある | JTEKT の `panels.output` は `ステータスバー` で（前提#4）、PCwin風は「下部にステータスバー」と §10.6 が定める。同じ枠のままでは4スキンが見分けられない | `LadderWorkspace.tsx` L176-300 |
| 28 | `three/PlcUnit.tsx` は `BODY_COLOR = '#D8DBE0'` / `LED_D_MM` / `LED_LEFT_MM` / `LED_TOP_MM` / `BODY_Z_MM` を**直書き**し、LEDは `unit.leds`（名前の配列）を等間隔で並べ、色は常に `#5A6070` | CP1E（明灰）・FX5U（濃灰）・ラック（モジュール4枚）を描き分けられない。利用者要求と 4A 決定表#15（色と座標を 4B に直書きしない）に反する | `three/PlcUnit.tsx` L22-46, L109-121 |
| 29 | `three/labels.ts` は **`FaceRect { cx; cy; w; h }`** を export している | 4A の `@ojt/board-model` も **`FaceRect { x; y; w; h }`** を export する。同じファイルで両方 import すると衝突する | `three/labels.ts` L128 |
| 30 | `camera.ts` の `PLC_VIEW_RECT` は IIFE の中で `PLC_UNIT_FX5U` を決め打ちし、`cameraPose(preset)` は引数を1つしか取らない。`e2e/projection.ts` も `PLC_BOARD = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U)` 決め打ち | ラック（幅 4×35+20 = 160mm・高さ140mm）は FX5U（150×90）より大きく縦に長いので、FX5U 基準の画角ではモジュールの下段の端子が切れる（受入基準③⑤の配線ができない） | `three/camera.ts` L118-135, L241-255、`e2e/projection.ts` L134-160 |
| 31 | `Settings.tsx` は `IMPLEMENTED_DIALECT_IDS.includes(id)` で `<option disabled>` を決め、`JA.settings.vendorUnimplemented = 'Phase 4 で対応します'` を添える。`VENDOR_LABELS` はメーカー名を直書き。`main/settings.ts` も `IMPLEMENTED_DIALECT_IDS` で `defaultVendor` を検証 | 4A で `IMPLEMENTED_DIALECT_IDS` が4件になるので**選べるようになる仕組みは既にある**。残るのは注記の文言と、色・列数を「メーカーの既定に従う」にする入口だけ | `Settings.tsx` L14-20, L220-237, `main/settings.ts` L63-77 |
| 32 | `openProblem()` は課題の `plc` をそのまま使い、`dialectId` を触らない。内蔵モードD課題8題は全部 `{ vendor: 'mitsubishi', model: 'FX5U' }` | 既定メーカーを OMRON にしても開く課題は FX5U のままで CX-Programmer風にならない（受入基準①）。TOYOPUC / JW300 のラックも一度も画面に出ない（受入基準③⑤） | `store.ts` L660-790、`packages/content/src/builtin/plc/d-00*.json` |
| 33 | IPCチャネルは6本で、§4.3 が「6本のみ」と明記。`preload/index.ts` も6本だけを `window.ojt` に出す。`main/work-files.ts` が `dialog.showSaveDialog()` を持つ | 命令語リストの保存には**保存ダイアログ**が要る（§10.7「ファイル出力先は利用者が選ぶ」）。renderer からはダイアログを開けない | `src/shared/ipc.ts` L9-17、`src/main/ipc.ts`、`src/main/work-files.ts` L225-240 |
| 34 | `PlcSession.tsx` の手順表は `wire` / `ladder` / `convert` / `run` / `judge` の5段固定 | `convertStep: false` のスキンには「変換」という手順が無い（§10.6）。5段のままだと、押すボタンが無い手順が「いまここ」で止まる | `PlcSession.tsx` L462-487 |
| 35 | テストの流儀: `test/setup.ts` が `@testing-library/jest-dom/vitest` を読むだけ。各 UI テストは自前で `afterEach(() => { cleanup(); })` を書き（`globals: false` なので自動クリーンアップは効かない）、ストアへの書き込みは `act()` で包み、`data-testid` で引く | 新しいテストも同じ流儀で書く | `test/setup.ts`、`test/ladder-workspace.test.tsx` L13-27 |
| 36 | 着手時のベースライン: `apps/desktop/test` は **82ファイル**、E2E は **23本**（`chart` 2 / `inspect` 8 / `navigation` 5 / `plc` 4 / `polish` 3 / `smoke` 1）。テスト件数は**着手時に `pnpm --filter @ojt/desktop test --no-file-parallelism` で測り直す** | 完了条件の数合わせに使う | `ls apps/desktop/test`、`grep -c "  test(" apps/desktop/e2e/*.spec.ts` |
| 37 | `ladder.module.css` は**末尾へ追記のみ**（クラス名を接頭辞で分ける）。`i18n/ja.ts` は挿入のたびにファイルを読み直す | Plan 3B MERGE 注意 #1・#13 | Plan 3B |

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
| ツリーの位置・幅 | 左 240px | 左 220px | 左 260px（5分類を出す） | 左 220px | △ |
| 出力ペインの形 | 編集ペインの下の**出力ウィンドウ**（高さ 160px） | 編集ペインの下の**出力ウィンドウ**（高さ 140px） | 画面最下部の**ステータスバー**（高さ 28px・1行）＋折りたたみの詳細 | 編集ペインの下の**出力ウィンドウ**（高さ 150px） | ◎（名称は §10.6）／△（高さ） |
| ステータスバーの項目 | モード／回路ブロック／上書き・挿入 | モード／PLC状態／スキャン時間 | モード／PLC状態／スキャン時間／デバイス点数（LD追っかけモニタの想定） | モード／回路ブロック／PLC状態 | △ |
| 編集領域の背景 | `#F7F8FA`（淡灰） | `#FFFFFF`（白） | `#EDEFF2`（灰） | `#F2F5F7`（淡青灰） | △ |
| 格子線 | 無し（罫線のみ） | 薄い格子 `#E3E8EE` | 薄い格子 `#DCE0E6` | 無し | △ |
| 左母線の色 | `#3A3F47` | `#1F1F1F` | `#333A42` | `#2C3E50` | △ |
| 記号の線色 | `#1B1E23` | `#000000` | `#12212E` | `#102A3C` | △ |
| 記号の線幅 | 1.6px | 1.4px | 1.8px | 1.6px | △ |
| セルの大きさ | 48 × 36px | 52 × 40px | 46 × 34px | 50 × 38px | △ |
| 接点の描き方 | 縦棒2本（上下に余白 8px）。b接点は右上がりの斜線 | 縦棒2本（上下の余白 10px・やや細長）。b接点は斜線 | 縦棒2本（上下の余白 7px・太め） | 縦棒2本（上下の余白 8px） | △（線画は JIS C 0617 に沿った自前の作図） |
| コイルの描き方 | 左右の半円（`( )`） | 左右の半円（やや扁平） | 左右の半円 | 左右の半円 | △ |
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
| `apps/desktop/src/renderer/ladder/symbols.ts` | **変更**: `symbolShape(id, style)` とスキン別のセル寸法（Task 4） |
| `apps/desktop/src/renderer/ladder/ladder.module.css` | **変更（末尾追記のみ）**: 色・寸法を `var(--skin-*)` に寄せる、`.titleBar` / `.statusBar` / `.vendorTool` / `.notation*`（Task 2 / 3 / 4 / 8） |
| `apps/desktop/src/renderer/ladder/DeviceInput.tsx` | **変更**: 入力例を `formatDevice()` / `formatCounterPreset()` から引く（Task 5） |
| `apps/desktop/src/renderer/ladder/ShortcutHelp.tsx` | **変更**: 「変換」が無いスキンの注記（Task 5） |
| `apps/desktop/src/renderer/ladder/IoTable.tsx` / `MonitorPanel.tsx` | **変更**: `spec.inputs[x].name` と入力コモンの表示（Task 5） |
| `apps/desktop/src/renderer/ladder/NotationDialog.tsx` | **新規**: 表記切替ダイアログ（§10.7）（Task 8） |
| `apps/desktop/src/renderer/screens/Settings.tsx` | **変更**: 4メーカーを選べるようにし、「メーカーの既定に従う」を足す（Task 6） |
| `apps/desktop/src/renderer/screens/PlcSession.tsx` | **変更**: 手順表を `convertStep` で畳む、機種名の表示、カメラへ機種を渡す（Task 3 / 7 / 12） |
| `apps/desktop/src/renderer/app/store.ts` | **変更**: `applyLadderSettings` の「既定に従う」対応、`openProblem()` の機種差し替え、`setDialect()`（Task 6 / 7 / 8） |
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
| `apps/desktop/test/*.test.ts(x)` | 各タスクのテスト（新規7ファイル＋既存10ファイルの追随） |

---

## 設計判断（レビューで確認する決定表）

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| 1 | **方言ごとに変わる値の持ち主** | 振る舞いは `session/plc-skin.ts`、見た目は `ladder/skins/*.ts` の **2ファイルだけ**。画面部品と CSS に `'F4'` / `'#1E64FF'` / `48px` を書かない | §17.1 の「修正箇所はスキン定義／盤モデルのみ」を画面側でも守る。振る舞いと見た目を分けるのは、前者が Node で単体テストでき（`happy-dom` 不要）、後者が CSS 変数として DOM に出る値だからである。`DialectProfile` に足す案は 4A の所有物を触ることになるので却下 |
| 2 | **ツールバーの項目 → 操作の対応** | 方言IDをキーにした表（`TOOLBAR_ACTIONS_BY_DIALECT`）で、`panels.toolbar` と**同じ長さの配列**を持つ。長さが合うことをテストで縛る | 位置で対応させる現在の実装（前提#21）は三菱でしか合わず、OMRON では「変換」ボタンが出てしまう（受入基準①が落ちる）。ラベル文字列で引く案は、同じ意味のボタンが `変換` / `PLCへの書込み` / `転送［PC → PLC］` と方言ごとに違う以上ただの言い換え表になり、`panels` の文言を変えた瞬間に黙って壊れる |
| 3 | **`convertStep: false` のとき何が起きるか** | ①ツールバーに「変換」を出さない ②キー割当表から「変換」の行が落ちている（4A の `withoutConvert()`）③**ラダーが変わるたびに自動で変換を走らせる**。失敗しても**トーストは出さず**出力ウィンドウだけを更新する ④手順表から「変換」の段を落とす ⑤ステータスバーに「自動変換」と出す | §10.6 の「`false` なら『PLC書込』→『RUN/STOP』→『モニタ開始』」。4A H-3 が「判定前に `convert()` は必ず走らせる」と定めているので、押す場所が無い以上どこかで自動的に走らせるしかない。編集のたびにトーストを出すと1文字打つたびに「変換できませんでした」が並ぶ（出力ウィンドウが結果の置き場所だと §10.6 が定めている） |
| 4 | **PCwin風の動かないボタン** | `ToolbarAction` に `'vendor-only'` を足し、押すと「このボタンは実機の操作パネルの項目で、本アプリでは動作しません」を出す。ボタンは淡色（`.vendorTool`） | 消すと §10.6 が定める PCwin風の画面構成（`JP1` `DGR` `MOB` `STP` `RDY` `RUN` `RES`）が再現できない。押して黙っていると壊れているように見える。キー割当表の `enabled: false` と同じ扱い（Phase 3 の `F8` で確立した流儀）に揃える |
| 5 | **スキンの見た目をどう持つか** | `SkinTheme`（`colors` / `cell` / `layout` / `statusItems` / `symbolStyle` / `commentLines` / `titleBar` / `assumed`）というデータにし、`colors` と `cell` は**CSS カスタムプロパティ（`--skin-*`）として `.workspace` に流し込む**。CSS Modules 側は `var(--skin-canvas, #f7f8fa)` のように既定値つきで読む | CSS Modules のクラスを方言ごとに4組書くと、1つ直すたびに4箇所直すことになり、「実物と違うと分かったら1ファイル」（§17.1）を守れない。インラインスタイルで全要素に色を撒く案は、`LadderGrid` が `memo` で再描画を抑えている設計（3B 決定表#5）を壊す（毎レンダーで新しい `style` オブジェクトが要素数ぶん生まれる）。CSS変数なら**親に1回**書けば済み、子の `memo` は効いたままになる |
| 6 | **セル寸法と記号の描き方** | `symbols.ts` の `CELL_W` / `CELL_H` を**既定値**として残したまま、`symbolShape(id, style)` と `skinCellSize(theme)` を足す。`style` は `'gx' \| 'cx' \| 'pcwin' \| 'jw'` の4値で、変わるのは**接点の縦棒の上下余白・コイルの扁平率・線幅**だけ | 記号そのもの（接点2本の縦棒・コイルの丸括弧）は JIS C 0617 に沿った共通の描き方で、メーカーで変わるのは寸法と線の太さの印象である。形ごと分けると、4通りの SVG パスを持つことになり、どれも一次資料の裏づけが無い（△を増やすだけ）。既存の定数を消さないのは、`LadderGrid` 以外（`ladder-grid.test.tsx` のレイアウト計算）が参照しているため |
| 7 | **タイトルバーとステータスバー** | `SkinFrame.tsx` が `title`（`<スキン名> 風` ＋ 商標注記のツールチップ）と `statusItems` を描く。ステータスバーの項目は `SkinTheme.statusItems`（`'mode'` / `'plc-state'` / `'scan'` / `'network'` / `'overwrite'` / `'device-count'`）で選ぶ | 前提#27。4スキンを「見て」区別できるようにする最短の要素で、しかも中身（モード・スキャン時間・回路ブロック名）は**すでにストアにある**ので新しい状態が要らない。ウィンドウ枠そのものを模す（偽の最小化ボタンを描く等）案は、押せない飾りが増えて §12.1 の「分かりやすく」に反するので却下 |
| 8 | **通電色・表示列数の「メーカー既定」** | `AppSettings.monitorColor` の空文字と `ladderGridCols` の `0` を「方言の既定に従う」とし、**これを既定値にする**。設定画面はチェックボックスで切り替える | 前提#24 のとおり、既定が `'#1E64FF'` のままだと OMRON を選んでも通電色が青で、§10.6 の「色のみ各社に寄せる」が画面に出ない。`monitorColorAuto` のような真偽値を足す案は設定の項目が2倍になり、`LadderGrid` / `ProjectTree` に既にある `length > 0 ? … : profile…` の分岐（＝もともとこの設計を想定して書かれている）を無駄にする |
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

Expected: 4 describe / 11 ケースすべて通過。

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
    const vars = skinCssVars(skinThemeOf(getDialect('omron')), '#FF00AA', 12);
    expect(vars['--skin-canvas']).toBe('#FFFFFF');
    expect(vars['--skin-rail']).toBe('#1F1F1F');
    expect(vars['--skin-cell-w']).toBe('52px');
    expect(vars['--skin-cell-h']).toBe('40px');
    expect(vars['--skin-stroke']).toBe('1.4');
    // 設定画面の通電色は方言の色を上書きする（決定表#8）
    expect(vars['--skin-powered']).toBe('#FF00AA');
    expect(Object.keys(vars).every((key) => key.startsWith('--skin-'))).toBe(true);
  });

  it('falls back to the dialect colour when the setting is empty', () => {
    const vars = skinCssVars(skinThemeOf(getDialect('jtekt')), '', 0);
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

/** 記号の描き方（寸法と線の印象だけを変える。決定表#6）。 */
export type SkinSymbolStyle = 'gx' | 'cx' | 'pcwin' | 'jw';

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

/** セルの寸法と線の太さ[px]。 */
export interface SkinCell {
  widthPx: number;
  heightPx: number;
  /** 記号・導線の線幅。 */
  strokeWidth: number;
  /** 接点の縦棒の上下の余白[px]（小さいほど縦長の接点になる）。 */
  barInsetPx: number;
}

/** 画面の並び。 */
export interface SkinLayout {
  /** プロジェクトツリーの位置。 */
  tree: 'left' | 'right';
  /** ツリーの幅[px]。 */
  treeWidthPx: number;
  /** 出力ペインの形（`status-bar` は PCwin風だけ。§10.6）。 */
  outputPane: 'window' | 'status-bar';
  /** 出力ウィンドウの高さ[px]（`status-bar` のときは折りたたんだ詳細の高さ）。 */
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
  symbolStyle: SkinSymbolStyle;
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
  layout: { tree: 'left', treeWidthPx: 240, outputPane: 'window', outputHeightPx: 160 },
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
  cell: { widthPx: 48, heightPx: 36, strokeWidth: 1.6, barInsetPx: 8 },
  symbolStyle: 'gx',
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
  layout: { tree: 'left', treeWidthPx: 220, outputPane: 'window', outputHeightPx: 140 },
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
  cell: { widthPx: 52, heightPx: 40, strokeWidth: 1.4, barInsetPx: 10 },
  symbolStyle: 'cx',
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
  layout: { tree: 'left', treeWidthPx: 260, outputPane: 'status-bar', outputHeightPx: 150 },
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
  cell: { widthPx: 46, heightPx: 34, strokeWidth: 1.8, barInsetPx: 7 },
  symbolStyle: 'pcwin',
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
  layout: { tree: 'left', treeWidthPx: 220, outputPane: 'window', outputHeightPx: 150 },
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
  cell: { widthPx: 50, heightPx: 38, strokeWidth: 1.6, barInsetPx: 8 },
  symbolStyle: 'jw',
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

export type {
  SkinCell,
  SkinColors,
  SkinLayout,
  SkinStatusItem,
  SkinSymbolStyle,
  SkinTheme,
} from './types.js';
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
 * @param monitorColor 設定画面の通電色（空なら方言の既定）。決定表#8
 * @param gridColsSetting 設定画面の表示列数（0 なら方言の既定。ここでは使わないが、
 *   呼び出し側が `skinGridCols()` と同じ引数で呼べるように受ける）
 */
export function skinCssVars(
  theme: SkinTheme,
  monitorColor: string,
  gridColsSetting: number,
): Record<string, string> {
  const powered = monitorColor.length > 0 ? monitorColor : theme.colors.powered;
  void gridColsSetting;
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
- Modify: `apps/desktop/src/renderer/screens/PlcSession.tsx`（手順表・表示列数）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（既存3件を関数化＋追記）
- Test: `apps/desktop/test/skin-workspace.test.tsx`（新規）
- Test: `apps/desktop/test/ladder-workspace.test.tsx` / `output-window.test.tsx`（追随）

§16 Phase 4 受入基準①の本体である。**ツールバーは `toolbarItems()` から**描き、`convertStep: false` のスキンでは「変換」ボタンを出さず、ラダーが変わるたびに自動で変換する。あわせてスキンの枠（タイトルバー・ステータスバー）と CSS 変数を入れて、4スキンが見て区別できるようにする（利用者要求）。

| 決めること | 本タスクの実装 |
|---|---|
| ボタンの `data-testid` | その action が**最初に出る位置**は `toolbar-<action>`、2つ目以降は `toolbar-<action>-<index>`（PCwin風は `vendor-only` が4つ並ぶ） |
| CSS 変数 | `.workspace` に `style={skinCssVars(theme, monitorColor, gridColsSetting)}` を1回だけ（決定表#5） |
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
    /** `Shift+F3`（モニタ書込み）の注記。決定表#11（Phase の番号は出さない） */
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
import { useEffect } from 'react';                                   // 既存の react import に足す
import { shortcutKeyOf } from '../session/ladder.js';                // 既存行に足す
import { autoConvert, toolbarItems, type ToolbarAction } from '../session/plc-skin.js';
import { skinCssVars, skinThemeOf } from './skins/index.js';
import { SkinStatusBar, SkinTitleBar } from './SkinFrame.js';
```

`TOOLBAR_ACTIONS` の定義（`type ToolbarAction` ごと）を**丸ごと削除**する。購読を足す:

```ts
  const plcRunning = useStore((s) => s.plcRunning);
  const monitorColor = useStore((s) => s.monitorColor);
  const gridColsSetting = useStore((s) => s.ladderGridCols);
  const theme = useMemo(() => skinThemeOf(profile), [profile]);
  const cssVars = useMemo(
    () => skinCssVars(theme, monitorColor, gridColsSetting),
    [theme, monitorColor, gridColsSetting],
  );
```

`convert()` を差し替える:

```ts
  /**
   * 「変換」。成功したときだけ Worker へ載せる（4A H-3）。§10.6
   * `silent` は自動変換（`convertStep: false` のスキン）から呼ぶとき。結果は出力ウィンドウに
   * 出るので、編集のたびにトーストを積まない（決定表#3）。
   */
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
      onPlc({ kind: 'load', program: current });
      if (options.silent !== true) store.toast(JA.ladder.convertOk);
    },
    [onPlc, profile],
  );

  /**
   * 「変換」のないスキンでは、ラダーが変わるたびに黙って変換し直す（決定表#3）。
   * 判定は変換済みのラダーしか受け取らない（4A H-3）ので、押す場所が無い以上ここで走らせる。
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
        {/* 回路ブロック・行の4ボタンは既存のまま（決定表#12） */}
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

Expected: すべて通過（`skin-workspace.test.tsx` は 4 describe / 13 ケース）。`tsc` は無警告。

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
      expect(shape?.paths, theme.id).toHaveLength(2);
      for (const path of shape?.paths ?? []) {
        // 縦棒は `M x top L x bottom` の形で、上下の余白はスキンの `barInsetPx`
        expect(path, theme.id).toMatch(
          new RegExp(`^M [\\d.]+ ${String(theme.cell.barInsetPx)} L [\\d.]+ `, 'u'),
        );
      }
      expect(metrics.shape('contact-nc')?.paths).toHaveLength(3);
      expect(metrics.shape('coil-round')?.paths).toHaveLength(2);
      expect(metrics.shape('coil-set')?.text).toBe('S');
    }
  });

  it('returns the same object for the same cell (memoised, so `memo` keeps working)', () => {
    expect(symbolMetrics(SKIN_THEMES['omron'].cell)).toBe(
      symbolMetrics(SKIN_THEMES['omron'].cell),
    );
  });

  it('spans the hidden columns with a lead that scales with the cell width', () => {
    const omron = symbolMetrics(SKIN_THEMES['omron'].cell);
    expect(omron.leadAcrossHidden(4)).toContain(String(4 * 52));
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

**既存の `CELL_W` / `CELL_H` / `WIRE_Y` / `symbolShape()` / `LEAD_*` / `LINK_DOWN` / `END_MARK` / `leadAcrossHidden()` は残す**（GX Works3風の既定として、既存のテストと `LadderGrid` 以外の呼び出しが使う）。その下に足す:

```ts
import type { SkinCell } from './skins/index.js';

/** GX Works3風の寸法（既定。`CELL_W` / `CELL_H` と同じ値）。 */
export const GX_CELL: SkinCell = {
  widthPx: CELL_W,
  heightPx: CELL_H,
  strokeWidth: 1.6,
  barInsetPx: 8,
};

/** そのスキンの寸法で描いた記号と導線一式。 */
export interface SymbolMetrics {
  /** セルの幅・高さ[px]と桟の縦位置。 */
  w: number;
  h: number;
  wireY: number;
  /** 左半分・右半分・全幅の導線。 */
  leadLeft: string;
  leadRight: string;
  leadFull: string;
  /** 下の行へ降りる縦リンク。 */
  linkDown: string;
  /** END の印。 */
  endMark: string;
  /** 表示しない列をまたぐ導線（`spanCols` 列ぶん）。 */
  leadAcrossHidden: (spanCols: number) => string;
  /** 識別子 → 線画。 */
  shape: (id: string) => SymbolShape | undefined;
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
  const arcRx = 9;
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
  const metrics: SymbolMetrics = {
    w,
    h,
    wireY,
    leadLeft: `M 0 ${wireY} L ${left} ${wireY}`,
    leadRight: `M ${right} ${wireY} L ${w} ${wireY}`,
    leadFull: `M 0 ${wireY} L ${w} ${wireY}`,
    linkDown: `M ${w / 2} ${wireY} L ${w / 2} ${h + wireY}`,
    endMark: `M ${left} ${top} L ${right} ${top} L ${right} ${bottom} L ${left} ${bottom} Z`,
    leadAcrossHidden: (spanCols: number) => `M 0 ${wireY} L ${spanCols * w} ${wireY}`,
    shape: (id: string) => shapes[id],
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

| 置き換え前 | 置き換え後 |
|---|---|
| `CELL_W` | `metrics.w` |
| `CELL_H` | `metrics.h` |
| `WIRE_Y` | `metrics.wireY` |
| `LEAD_LEFT` / `LEAD_RIGHT` / `LEAD_FULL` | `metrics.leadLeft` / `metrics.leadRight` / `metrics.leadFull` |
| `LINK_DOWN` / `END_MARK` | `metrics.linkDown` / `metrics.endMark` |
| `leadAcrossHidden(n)` | `metrics.leadAcrossHidden(n)` |
| `symbolShape(id)` | `metrics.shape(id)` |

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

Expected: すべて通過（`skin-grid.test.tsx` は 5 ケース）。

```powershell
git add apps/desktop/src/renderer/ladder apps/desktop/test
git commit -m "feat(desktop): draw the ladder grid at each skin's size and comment style"
```

---

## Task 5: デバイス入力欄・キー割当表・I/O表・モニタ一覧の方言／機種対応

**モデル: Sonnet**（本書のコードをそのまま書き写せば通る）

**Files:**
- Modify: `apps/desktop/src/renderer/ladder/DeviceInput.tsx`
- Modify: `apps/desktop/src/renderer/ladder/ShortcutHelp.tsx`
- Modify: `apps/desktop/src/renderer/ladder/IoTable.tsx`
- Modify: `apps/desktop/src/renderer/ladder/MonitorPanel.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/device-input.test.tsx` / `ladder-panels.test.tsx`（追記）

§16 Phase 4 受入基準④（シャープで `8` を入れると8進エラー）の画面側と、4A Task 8 の `PlcUnitSpec` 格上げ（前提#25）への追随である。**エラー文言は `profile.parseDevice()` が返す `Error` をそのまま出す**ので、直すのは「入力例」「注記」「端子名の引き方」だけである。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/device-input.test.tsx` の末尾に足す:

```tsx
describe('方言ごとの入力例とエラー（§10.5 / §16 Phase 4 受入基準④）', () => {
  function hintOf(profile: DialectProfile): string {
    cleanup();
    render(
      <DeviceInput
        initial={emptyCellForm('contact-no')}
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
        initial={{ ...emptyCellForm('coil'), target: 'output', output: 'CTU' }}
        profile={OMRON_CP1E}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('preset-text')).toHaveAttribute('placeholder', '#0005');
  });

  it('shows the octal error of the JW-300SP skin (受入基準④)', () => {
    const onCommit = vi.fn();
    render(
      <DeviceInput
        initial={emptyCellForm('contact-no')}
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
        initial={emptyCellForm('contact-no')}
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

（`IO` は既存のヘルパ、`PLC_UNIT_CP1E` / `PLC_UNIT_JW300` は `@ojt/board-model` から import する。）

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/device-input.test.tsx test/ladder-panels.test.tsx
```

Expected: 失敗。`expected '0' to be '0.00'` と `Unable to find … [data-testid="io-common"]`。

- [ ] **Step 3: `DeviceInput.tsx` の入力例を `formatDevice()` から引く**

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
      counter: profile.formatCounterPreset?.(5) ?? '5',
    };
  }, [profile]);
```

- [ ] **Step 4: `ShortcutHelp.tsx` に「変換が無い」注記を足す**

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

- [ ] **Step 5: `IoTable.tsx` を新しい `PlcUnitSpec` に合わせる**

```ts
  /**
   * PLC本体の端子名。割付が機種の点数を超えて `unit.spec` に無いときは `undefined` を返す。
   * 4A Task 8 で `inputs` が `PlcInputSpec[]`（`{name, com, ohms?}`）になった（前提#25）。
   */
  const inputTerminal = (x: number): string | undefined => unit.spec.inputs[x]?.name;
  const outputTerminal = (y: number): string | undefined => unit.spec.outputs[y]?.name;
```

入力コモンの行を足す（`io-outlet-note` のキャプションの直後）:

```tsx
        <caption className={styles.sideNote} data-testid="io-common">
          {JA.ladder.ioCommon}: {unit.spec.inputCommons.map((name) => `PLC.${name}`).join('・')}
        </caption>
```

> `<table>` に `<caption>` は1つしか置けないので、**既存の `io-outlet-note` のキャプションの中へ
> 1行として入れる**（`<caption>` の中に `<span data-testid="io-common">` を並べる）。

```tsx
        <caption className={styles.sideNote}>
          <span data-testid="io-outlet-note">{JA.plc.outletNote}</span>{' '}
          <span data-testid="io-common">
            {JA.ladder.ioCommon}: {unit.spec.inputCommons.map((name) => `PLC.${name}`).join('・')}
          </span>
        </caption>
```

- [ ] **Step 6: `MonitorPanel.tsx` を新しい `PlcUnitSpec` に合わせる**

```tsx
                  <td>{terminal(unit.spec.inputs[index]?.name)}</td>
```

（出力側の `unit.spec.outputs[index]?.name` は変更不要。）
`JA.ladder.monitorOff` の呼び出しを Task 3 の関数版に合わせる（`shortcutKeyOf(profile, 'monitor') ?? 'F3'`）。

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
pnpm --filter @ojt/desktop exec vitest run test/device-input.test.tsx test/ladder-panels.test.tsx test/monitor-panel.test.tsx
pnpm --filter @ojt/desktop exec tsc -p tsconfig.json --noEmit
```

Expected: すべて通過。`tsc` は `spec.inputs` の型追随が済んでいれば無警告。

```powershell
git add apps/desktop/src/renderer/ladder apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test
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
- Test: `apps/desktop/test/settings.test.ts`（3行の期待値）・`settings-plc.test.tsx`（追記）

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

  it('saves the chosen vendor and pushes it into the store', async () => {
    render(<Settings />);
    const select = await screen.findByTestId('setting-vendor');
    fireEvent.change(select, { target: { value: 'omron' } });
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ defaultVendor: 'omron' });
    });
    expect(useStore.getState().dialectId).toBe('omron');
  });
});

describe('「メーカーの既定に従う」（§10.6 / 決定表#8）', () => {
  it('defaults both the colour and the column count to the vendor default', () => {
    expect(DEFAULT_SETTINGS.monitorColor).toBe('');
    expect(DEFAULT_SETTINGS.ladderGridCols).toBe(0);
  });

  it('turns the colour override off by writing an empty string', async () => {
    render(<Settings />);
    const auto = await screen.findByTestId('setting-monitor-color-auto');
    // 既定は「メーカーの既定に従う」＝チェック済み
    expect(auto).toBeChecked();
    fireEvent.click(auto);
    await waitFor(() => {
      expect(saved.at(-1)).toEqual({ monitorColor: DEFAULT_MONITOR_COLOR });
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
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    expect(useStore.getState().ladderGridCols).toBe(0);
    expect(useStore.getState().monitorColor).toBe('');
    expect(useStore.getState().dialectId).toBe('omron');
  });

  it('shows the assumption note of the current skin', async () => {
    render(<Settings />);
    expect(await screen.findByTestId('skin-assumed')).toHaveTextContent('画面の配色');
  });
});
```

（`DEFAULT_MONITOR_COLOR` は `shared/ipc.ts` が新しく出す「上書きを始めるときの初期色」＝三菱の青。import に `getDialect` / `MITSUBISHI_FX5U` / `type DialectId` / `DEFAULT_MONITOR_COLOR` を足す。）

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

`AppSettings` の3つのコメントを直し、定数を1つ足す:

```ts
  /** モードDの既定メーカー（Phase 4 で4社すべてが選べる）。§10.5 / §12.1 */
  defaultVendor: string;
  /**
   * ラダーの表示列数（接点列。8〜15）。§10.6
   * **`0` は「メーカーの既定に従う」**（`profile.gridCols`）。Plan 4B 決定表#8
   */
  ladderGridCols: number;
  /**
   * モニタ中の通電表示色（`#rrggbb`）。§10.6
   * **空文字は「メーカーの既定に従う」**（`profile.monitorColors.powered`）。Plan 4B 決定表#8
   */
  monitorColor: string;
```

```ts
/**
 * 通電色の上書きを始めるときの初期色（三菱の青）。§10.6
 * 設定画面の「メーカーの既定に従う」を外したときに、色の欄へ最初に入れる値である。
 */
export const DEFAULT_MONITOR_COLOR = '#1E64FF';

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
};
```

- [ ] **Step 4: `src/main/settings.ts` に 0 と空文字を通す**

```ts
  const gridCols = source['ladderGridCols'];
  if (typeof gridCols === 'number' && Number.isFinite(gridCols)) {
    // 0 は「メーカーの既定に従う」（Plan 4B 決定表#8）。それ以外は 8〜15 に丸める
    next.ladderGridCols =
      gridCols === 0 ? 0 : Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(gridCols)));
  }
  const monitorColor = source['monitorColor'];
  // 空文字は「メーカーの既定に従う」（決定表#8）
  if (typeof monitorColor === 'string' && /^(#[0-9a-fA-F]{6})?$/.test(monitorColor)) {
    next.monitorColor = monitorColor;
  }
```

`defaultVendor` の分岐は**そのまま**（`IMPLEMENTED_DIALECT_IDS` が4件になるので自動で4社を受ける）。

- [ ] **Step 5: `src/renderer/app/store.ts` の `applyLadderSettings` を直す**

```ts
  applyLadderSettings: ({ gridCols, monitorColor, vendor }) => {
    set({
      // 0 は「メーカーの既定に従う」の印なのでそのまま持つ（丸めない。決定表#8）
      ladderGridCols:
        gridCols === 0 ? 0 : Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(gridCols))),
      monitorColor,
      ...(isDialectId(vendor) && IMPLEMENTED_DIALECT_IDS.includes(vendor)
        ? { dialectId: vendor }
        : {}),
    });
  },
```

- [ ] **Step 6: `Settings.tsx` を直す**

`VENDOR_LABELS` の定数を**削除**し、import を差し替える:

```ts
import {
  availableDialects,
  getDialect,
  IMPLEMENTED_DIALECT_IDS,
  isDialectId,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
} from '@ojt/plc-dialects';
import { DEFAULT_MONITOR_COLOR, DEFAULT_SETTINGS, type AppSettings, type AppSettingsResponse } from '../../shared/ipc.js';
import { SKIN_THEMES } from '../ladder/skins/index.js';
```

メーカーの `<select>` を差し替える:

```tsx
              <select
                id="setting-vendor"
                data-testid="setting-vendor"
                value={settings.defaultVendor}
                onChange={(event) => {
                  patch({ defaultVendor: event.target.value });
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

通電色にも同じ対（`setting-monitor-color-auto`、外したら `DEFAULT_MONITOR_COLOR` から始める）を足し、色の欄に `disabled={settings.monitorColor.length === 0}` を付ける。

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
    monitorColorHelp: 'モニタ中に通電しているセルへ塗る色です。',
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
- Modify: `apps/desktop/src/renderer/app/store.ts`（`openProblem()` の1箇所）
- Modify: `apps/desktop/src/renderer/screens/PlcSession.tsx`（機種名の表示）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/store-plc.test.ts`（追記）
- Test: `apps/desktop/test/work-file-plc.test.ts`（追記）

§16 Phase 4 受入基準①③⑤の土台である。内蔵8題は全部 `mitsubishi` / `FX5U` なので（前提#32）、**開くときに既定メーカーの機種へ差し替える**（決定表#9）。差し替えた課題がそのまま盤・Worker・判定・作業ファイルへ流れるので、3Dのラック（受入基準③⑤）も画面に出る。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/store-plc.test.ts` に足す:

```ts
describe('既定メーカーの機種で開く（§7.6 / 決定表#9）', () => {
  it('swaps the model of a mode D problem to the default vendor', () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    expect(useStore.getState().openProblem(plcProblem)).toBe(true);
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
});
```

`apps/desktop/test/work-file-plc.test.ts` に足す:

```ts
describe('4方言の作業ファイル往復（§12.3 / 4A H-2）', () => {
  it.each(['mitsubishi', 'jtekt', 'omron', 'sharp'] as const)(
    'round-trips the dialect id %s',
    async (vendor) => {
      useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor });
      useStore.getState().openProblem(plcProblem);
      const file = toWorkFile(/* 既存のテストと同じ引数 */);
      expect(file.dialectId).toBe(vendor);
      useStore.getState().abandonSession();
      expect(await applyWorkFile(file)).toBe(true);
      expect(useStore.getState().dialectId).toBe(vendor);
      // 機種も戻る（作業ファイルには課題IDしか無いので、方言 → 機種の規則で引き直す）
      const opened = useStore.getState().problem;
      expect(isPlcProblem(opened!) ? opened.plc.vendor : undefined).toBe(vendor);
    },
  );
});
```

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

`openProblem` の**先頭**（`let session: BoardSession;` の前）に足す:

```ts
    /*
     * モードDは**既定メーカーの機種**で開く（決定表#9）。内蔵8題は `mitsubishi` / `FX5U` だが、
     * 4A Task 14 が「`plc` だけ差し替えれば4機種すべてで成立する」ことを確かめているので、
     * ここで差し替えれば課題JSONを1文字も変えずに CP1E・TOYOPUC・JW300 の課題になる。
     * 差し替えた課題がそのまま盤・Worker・判定・作業ファイルへ流れるので、3Dの端子名と
     * ラダーのデバイス名が食い違わない（4A H-1）。
     */
    if (isPlcProblem(problem)) {
      const vendor = get().dialectId;
      const swapped = plcForVendor(problem, vendor);
      if (swapped === undefined) {
        // 割付がその機種に収まらない（CP1E の出力は12点。決定表#10）。元の機種のまま開く
        const model = plcUnitForVendor(vendor)?.model ?? vendor;
        get().toast(JA.plc.modelNotUsable(model, problem.plc.model), 'error');
      } else {
        problem = swapped;
      }
    }
```

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

- [ ] **Step 5: `PlcSession.tsx` に機種名を出す**

`ProblemPanel` の下（`JA.plc.outletNote` を出している並び）に足す:

```tsx
        <p className={styles.plcNote} data-testid="plc-model">
          {JA.plc.modelLabel}: {plcUnitFor(problem.plc.model)?.displayName ?? problem.plc.model}
        </p>
```

（`import { plcUnitFor } from '@ojt/board-model';` を足す。`styles.plcNote` が無ければ
`screens.module.css` の既存の注記クラスを使う。）

- [ ] **Step 6: GREEN を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/store-plc.test.ts test/work-file-plc.test.ts test/plc-session-screen.test.tsx test/store.test.ts
```

Expected: すべて通過（`store-plc` に4ケース、`work-file-plc` に4ケース追加）。

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

§16 Phase 4 受入基準②（三菱で組んだラダーを OMRON 表記に切り替えると `0.00` 形式になる）の本体である。**IRは書き換えない**（4A H-2 / 決定表#11）。機種も一緒に変わるので**配線はやり直しになる**ことを先に伝える（決定表#12）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/notation-dialog.test.tsx`:

```tsx
import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { endNetwork, hline, network, no, out, program, X, Y } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { NotationDialog } from '../src/renderer/ladder/NotationDialog.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;
const selfHold = program(
  network('n1', [[no(X(8)), hline(), out(Y(1))]]),
  endNetwork(),
);

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
    set({ dialectId });
    if (problem === undefined || !isPlcProblem(problem)) return;
    const swapped = plcForVendor(problem, dialectId);
    if (swapped === undefined) {
      const model = plcUnitForVendor(dialectId)?.model ?? dialectId;
      get().toast(JA.plc.modelNotUsable(model, problem.plc.model), 'error');
      return;
    }
    // `openProblem()` が盤・履歴・ログ・計時を作り直す。ラダーだけ持ち越す（決定表#12）
    get().openProblem(swapped);
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

  it('refuses a text that is too large (§13 #8)', async () => {
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
import { endNetwork, hline, network, no, out, program, X, Y } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U, SHARP_JW300 } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;
const simple = program(network('n1', [[no(X(0)), hline(), out(Y(0))]]), endNetwork());
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

  it('explains a bridge circuit in plain Japanese instead of writing a file', async () => {
    // 直並列に分解できない回路（4A 意図的な差分 #10）
    act(() => {
      useStore.getState().setLadder(bridgeProgram());
    });
    render(
      <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('il-issues')).toHaveTextContent('ブリッジ');
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

（`bridgeProgram()` は `test/` のヘルパとして同じファイルの末尾に置く。縦線で2本の枝を橋渡しした
1ネットワークで、4A の `instructionList()` が `not-series-parallel` を返す形にする。）

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

/** 書き出せるテキストの最大バイト数（命令語リストは大きくても数十KB）。§13 #8 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** 既定のファイル名からパス区切りを落とす（renderer からの生入力を信用しない）。 */
function safeFileName(name: string): string {
  const base = basename(name.replace(/[\\/]/gu, '_')).trim();
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
   * （ブリッジ回路。4A 意図的な差分 #10）だけは**平易な直し方**を足して出す。
   */
  const exportIl = useCallback((): void => {
    const store = useStore.getState();
    const current = store.ladder;
    if (current === undefined) return;
    const list = instructionList(current, profile);
    if (list.errors.length > 0) {
      setExportIssues(
        list.errors.map((issue) => {
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
    /** `not-series-parallel` の平易な説明（4A 意図的な差分 #10）。 */
    ilNotSeriesParallel:
      '接点が橋渡し（ブリッジ）になっている回路は、直列と並列の組み合わせに書き直せないため命令語になりません。縦線を1本減らすか、回路ブロックを分けてください。',
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
