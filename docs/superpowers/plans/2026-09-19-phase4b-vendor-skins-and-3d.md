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
