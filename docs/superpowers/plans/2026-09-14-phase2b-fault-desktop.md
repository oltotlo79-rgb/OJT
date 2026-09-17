# Plan 2B: テスターUI・モードC1/C2 画面（apps/desktop のみ）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 の**画面側**を完成させる。すなわち `apps/desktop` に ①テスター（デジタル／アナログ）のパネルと3D盤上のプローブ配置、②`ohm-on-live` / `range-exceeded` の警告バナーとミス回数表示、③モードC1（部品点検）のセッション画面・マークシート・結果画面、④モードC2（回路点検・修復）の指摘・白線修復・部品交換・回路図連動ハイライト・結果画面、⑤C1/C2 を含む課題一覧とモードカード、⑥C1/C2 の作業ファイルを載せる。ライブラリ側（テスターの状態機械・故障適用・判定・ハイライト索引）はすべて **Plan 2A** が提供済みで、本プランは 2A の公開APIだけを使う。

**Architecture:** 3層に分ける。①**純粋層**（`src/renderer/session/*.ts`）＝「ピック結果 → 操作」「部品 → チェック用回路の load コマンド」「指摘の対象 → 選べる種別」を React も three も使わない純関数にする（§12.2 の `resolvePick` 方針をそのまま拡張する）。②**Worker 層**（`src/worker/*`）＝テスターの状態機械を `Simulation` と同じスレッドに置き、毎 tick `stepTester()` を呼んで読値と針角度をスナップショットに載せ、`range-exceeded` を `sim.events` から拾う。故障の注入（`injectPartFaults`）と C1/C2 の判定（`judgeInspectParts` / `judgeInspectRepair`）も Worker で行う。③**描画層**（`src/renderer/panels/*` / `screens/*` / `three/*` / `result/*`）＝ストアの狭いセレクタだけを購読し、`frameloop="demand"` を壊さない（§15）。

**テスターの操作モデル（依頼の DECIDE に対する回答）:** **ツールモードに `tester` を足し、プローブは黒 → 赤 の順に自動で進む**方式にする（§9.3「プローブは黒 → 赤 の順に端子をクリックして配置する」そのまま）。パネルに黒／赤のボタンを置き、押すと次に置くプローブを明示的に選べる（順番を崩したいときの逃げ道）。既に置いてあるプローブの端子をもう一度クリックするとそのプローブを外す。判断は `session/tester.ts` の純関数 `testerPickToAction()` 1つに閉じ込め、`pickToAction()`（Plan 1D1）と同じ形の `PickAction` を返すので、セッション画面の `runAction()` を分岐で汚さずに済む。理由: ①仕様が順序を明示しているので既定は順送りが正しい、②「黒を置いてから赤」は実機の作法（黒＝COM）で教育上も意味がある、③明示選択だけにすると2クリックが4クリックになり、C1 の「接点をON/OFFで何度も測る」手順が重くなる。ドラッグでの付け替え（§9.3）は**クリックで外す → クリックで置く**に置き換えた（意図的な差分 #3）。

**Tech Stack:** TypeScript（`strict` ＋ `noUncheckedIndexedAccess` ＋ `exactOptionalPropertyTypes`）、React 19.2.8、zustand 5.0.15、@react-three/fiber 9.7.0 ＋ drei 10.7.8、Vitest 5（happy-dom ＋ @testing-library/react 16.3.3）、Playwright 1.63.0（`_electron`）、Prettier（printWidth 100）。**依存の追加は無し**（`apps/desktop/package.json` は Phase 1 のまま）。

---

## 前提（このプランを始める前に満たしていること）

| # | 前提 | 確認方法 |
|---|---|---|
| 1 | Plan 1D1 / 1D2 が `main` に入っており、`pnpm --filter @ojt/desktop test` が 25ファイル / 414テスト通る | `pnpm --filter @ojt/desktop test` |
| 2 | **Plan 2A が `main` に入っている**（`packages/circuit-sim/src/tester.ts` と `packages/content` の C1/C2 一式）。本プランは 2A の公開APIを全面的に使うので、2A 未完了では Task 1 から通らない | `pnpm -r test` と下の API 表 |
| 3 | `pnpm -r typecheck` / `pnpm lint` が無警告 | 同左 |
| 4 | 内蔵課題が モードB 8題 ＋ C1 4セット ＋ C2 8題 の計20題（`BUILTIN_ALL_PROBLEMS`） | `BUILTIN_ALL_PROBLEMS.length` |

### 前提A: Plan 2A から使う公開API（**署名をそのまま引用**。食い違ったら 2A 側が正で、本プランを直す）

`@ojt/circuit-sim`（`src/tester.ts`。Plan 2A Task 1・2）:

```ts
export type TesterKind = 'digital' | 'analog';
export type TesterMode = 'off' | 'DCV' | 'ACV' | 'OHM' | 'CONT';
export const ANALOG_DCV_RANGES: readonly number[];              // [2.5, 10, 50, 250]
export const ANALOG_ACV_RANGES: readonly number[];              // [10, 50, 250]
export const ANALOG_OHM_RANGES: readonly [1, 10, 1000];
export type AnalogOhmRange = 1 | 10 | 1000;
export const ANALOG_OHM_INTERNAL_OHMS: Readonly<Record<AnalogOhmRange, number>>; // {1:12,10:120,1000:12000}
export const NEEDLE_FULL_SCALE_DEG: 90;
export const NEEDLE_TIME_CONSTANT_MS: 100;
export const ZERO_ADJUST_ERROR_RATIO: 0.05;
export const TESTER_OFF_DISPLAY: 'OFF';
export const TESTER_NO_PROBE_DISPLAY: '----';
export const DEFAULT_ANALOG_VOLT_RANGE: 50;
export const DEFAULT_ANALOG_OHM_RANGE: AnalogOhmRange;          // 10
export const TESTER_TICK_MS: number;                            // = TICK_MS = 10

export interface TesterState {
  kind: TesterKind;
  mode: TesterMode;
  voltRange: number;
  ohmRange: AnalogOhmRange;
  black: TerminalId | undefined;
  red: TerminalId | undefined;
  zeroAdjusted: boolean;
  needleDeg: number;
  rangeExceededReported: boolean;
}

export type TesterAction =
  | { type: 'set-kind'; kind: TesterKind }
  | { type: 'set-mode'; mode: TesterMode }
  | { type: 'set-volt-range'; range: number }
  | { type: 'set-ohm-range'; range: AnalogOhmRange }
  | { type: 'place-probe'; probe: 'black' | 'red'; terminal: TerminalId | undefined }
  | { type: 'zero-adjust' };

export interface TesterReading {
  kind: TesterKind;
  mode: TesterMode;
  value: number;      // 測定不能は NaN
  display: string;    // 'OFF' / '----' / 'OL' / '導通' / '−−−' / 数値
  targetDeg: number;
  overRange: boolean;
  live: boolean;
  conductive: boolean;
}

export function createTesterState(kind?: TesterKind): TesterState;
export function applyTesterAction(state: TesterState, action: TesterAction): TesterState;
export function readTester(sim: Simulation, state: TesterState): TesterReading;
export function stepTester(
  sim: Simulation, state: TesterState, dtMs?: number,
): { state: TesterState; reading: TesterReading };
export function voltRangesFor(mode: TesterMode): readonly number[];
export function voltNeedleDeg(volts: number, range: number): number;
export function ohmNeedleDeg(ohms: number, range: AnalogOhmRange): number;
export function withZeroAdjustError(ohms: number, zeroAdjusted: boolean): number;
```

`@ojt/content`（モードC1。Plan 2A Task 5・9・12・14）:

```ts
export const PART_TRUTHS: readonly ['normal','coil-open','coil-layer-short','a-open','a-weld','b-open','b-weld'];
export type PartTruth = (typeof PART_TRUTHS)[number];
export const PART_TRUTH_LABELS: Readonly<Record<PartTruth, string>>;
export interface InspectPartData { id: string; kind: MountableKind; truth: PartTruth; ratio?: number; group?: number }
export interface InspectPartsProblem { /* ProblemHeaderShape */ mode: 'inspect-parts'; parts: InspectPartData[]; seed: number }

export const CHECK_PART_ID: 'CHK';
export const CHECK_COIL_MINUS: TerminalId;   // 'CHK.13'
export const CHECK_COIL_PLUS: TerminalId;    // 'CHK.14'
export const CHECK_TIMER_PRESET_MS: 1000;
export function checkSettleMs(kind: MountableKind): number;         // timer: 1100 / relay: 100
export function checkContactTerminals(group: number): { com: TerminalId; no: TerminalId; nc: TerminalId };
export const LAYER_SHORT_JUDGE_RATIO: 0.85;
export function layerShortThresholdOhms(nominalOhms?: number): number;   // 552.5
export interface DiagnosisRow { situation: string; cause: PartTruth }
export const DIAGNOSIS_TABLE: readonly DiagnosisRow[];                   // 7行
export interface CheckCircuit { session: BoardSession; netlist: Netlist; group: number }
export type CheckCircuitResult = { ok: true; value: CheckCircuit } | { ok: false; errors: ProblemIssue[] };
export function buildCheckCircuit(
  problem: InspectPartsProblem, board: BoardDefinition, partId: string,
): CheckCircuitResult;
export function truthFault(problem: InspectPartsProblem, part: InspectPartData): FaultSpecData | undefined;
export function faultGroupOf(problem: InspectPartsProblem, part: InspectPartData): number;
export function expectedCheckReading(part: InspectPartData): ExpectedCheckReading;

export interface InspectPartAnswer { partId: string; answer: PartTruth }
export interface InspectPartScore { partId: string; truth: PartTruth; answer: PartTruth | undefined; correct: boolean }
export interface JudgeInspectPartsResult {
  mode: 'inspect-parts'; passed: boolean; correctCount: number; total: number;
  scores: InspectPartScore[]; hazardCount: number; hazardsByKind: HazardCounts; elapsedMs?: number;
}
export function judgeInspectParts(
  problem: InspectPartsProblem, answers: readonly InspectPartAnswer[], options?: JudgeOptions,
): JudgeInspectPartsResult;
```

`@ojt/content`（モードC2。Plan 2A Task 4・6・10・12・13・15・16）:

```ts
export interface InspectRepairProblem {
  /* ProblemHeaderShape */ mode: 'inspect-repair';
  schematic: SchematicDocument;
  physicalOverride?: Record<string, [string, string]>;  // zodのTerminalIdSchemaは素の正規表現stringなので推論型もstring。toPhysicalOverride()がTerminalIdへ直す
  faults: FaultsData; operations: OperationList; durationMs: number;
  judge: JudgeSettings; hints: { schematicVisible: boolean };
}

export const INITIAL_WIRE_COLOR: WireColor;  // '青'
export const REPAIR_WIRE_COLOR: WireColor;   // '白'
export type FaultReportKind = 'wire-open' | 'wire-missing' | 'wire-misrouted' | 'part-defect';
export interface FaultSite {
  kind: FaultKind; report: FaultReportKind;
  wireId: string | undefined; partId: string | undefined; terminals: readonly TerminalId[];
}
export interface AppliedFaults {
  wireFaults: readonly FaultSpecData[]; partFaults: readonly FaultSpecData[]; sites: readonly FaultSite[];
}
export interface FaultReport {
  target: { wireId: string } | { partId: string } | { terminalId: string };
  kind: FaultReportKind;
}
export interface RepairCircuit {
  session: BoardSession; applied: AppliedFaults;
  initialWireIds: readonly string[]; cells: readonly CellAssignment[];
}
export type RepairCircuitResult = { ok: true; value: RepairCircuit } | { ok: false; errors: ProblemIssue[] };
export function buildInspectRepairCircuit(
  problem: InspectRepairProblem, board: BoardDefinition,
  options?: ResolveFaultsOptions & { resolvedFaults?: readonly FaultSpecData[] },
): RepairCircuitResult;
export function repairNetlist(
  circuit: RepairCircuit, board: BoardDefinition,
): { netlist: Netlist; errors: ProblemIssue[] };
export function replacePart(circuit: RepairCircuit, partId: string): RepairCircuit;
export function addedWireIds(circuit: RepairCircuit, session: BoardSession): string[];
export function modificationWireIds(circuit: RepairCircuit, session: BoardSession): string[];
export function matchesSite(site: FaultSite, report: FaultReport): boolean;
export function scoreReports(
  sites: readonly FaultSite[], reports: readonly FaultReport[],
): InspectReportScore;
export interface InspectReportScore {
  matched: { site: FaultSite; report: FaultReport }[]; missed: FaultSite[]; extra: FaultReport[];
}
export interface JudgeInspectRepairResult {
  mode: 'inspect-repair'; passed: boolean; reports: InspectReportScore; mismatches: Mismatch[];
  staticChecks: StaticCheckResult[]; modifications: string[]; addedWires: string[];
  hazardCount: number; hazardsByKind: HazardCounts; chatter: ChatterEvent[]; elapsedMs?: number;
  charts: { expected: TimeChart; actual: TimeChart }; compareSignals: string[];
}
export type JudgeInspectRepairOutcome =
  { ok: true; value: JudgeInspectRepairResult } | { ok: false; errors: ProblemIssue[] };
export function judgeInspectRepair(
  problem: InspectRepairProblem, board: BoardDefinition, circuit: RepairCircuit,
  reports: readonly FaultReport[], options?: JudgeOptions,
): JudgeInspectRepairOutcome;
export type JudgeInspectResult = JudgeInspectPartsResult | JudgeInspectRepairResult;

export interface HighlightTarget {
  cellId: string; device: string; terminals: readonly TerminalId[]; wireIds: readonly string[];
}
export type HighlightIndex = ReadonlyMap<string, HighlightTarget>;
export function buildHighlightIndex(
  cells: readonly CellAssignment[], session: BoardSession,
): HighlightIndex;
export function highlightFor(index: HighlightIndex, cellId: string): HighlightTarget | undefined;
export function cellIdsAtTerminal(index: HighlightIndex, terminal: string): string[];
export function cellIdsOfWire(index: HighlightIndex, wireId: string): string[];
```

`@ojt/content`（共通。Plan 2A Task 3・4・7・8・17）:

```ts
export type SupportedProblem = AssembleProblem | InspectPartsProblem | InspectRepairProblem;
export function isAssembleProblem(p: SupportedProblem): p is AssembleProblem;
export function isInspectPartsProblem(p: SupportedProblem): p is InspectPartsProblem;
export function isInspectRepairProblem(p: SupportedProblem): p is InspectRepairProblem;
export const BUILTIN_ALL_PROBLEMS: readonly SupportedProblem[];               // 20題
export const BUILTIN_INSPECT_PARTS_PROBLEMS: readonly InspectPartsProblem[];  // 4題
export const BUILTIN_INSPECT_REPAIR_PROBLEMS: readonly InspectRepairProblem[]; // 8題
export function findBuiltinProblem(id: string): SupportedProblem | undefined;
export function countHazards(hazards: readonly HazardEvent[]): HazardCounts;
export interface FaultSpecData {
  target: { wireId: string } | { partId: string; elementIndex: number };
  kind: FaultKind; ohms?: number | undefined; ratio?: number | undefined; to?: string | undefined;  // exactOptionalPropertyTypes 下でのzod推論
}
export function injectPartFaults(netlist: Netlist, partFaults: readonly FaultSpecData[]): ProblemIssue[];
export interface ProblemIssue { path: string; message: string }
export interface ResolveFaultsOptions { seed?: number; maxAttempts?: number }
```

### 前提B: Plan 1D1 / 1D2 で実装が確定した `apps/desktop` のAPI（**本プランが触る分だけ**）

| ファイル | 使う・広げるもの |
|---|---|
| `src/worker/protocol.ts` | `SimCommand`（12種）／`SimSnapshot`（`tMs` `powered` `lamps` `relays` `timers` `logDelta` `hazardDelta` `chatterDelta` `droppedTicks` …）／`SimMessage`（`snapshot` / `judgeResult` / `error{message,fatal}`）／`SNAPSHOT_INTERVAL_MS = 33` |
| `src/worker/sim.worker.ts` | `load()` / `partFor()` / `buildSnapshot()` / `loop()` / `stopLoop()` / `resumeLoop()` / `handle()` / `self.onmessage`。装着・取外し・タイマ設定は差分API（`mountPart` / `unmountPart` / `setTimerPreset`）で当てる |
| `src/worker/runtime.ts` | `planTicks()` / `formatElapsed(ms)` → `'12:34.5'` |
| `src/renderer/app/store.ts` | `useStore` / `AppState` / `EMPTY_SNAPSHOT` / `sessionForProblem()` / `schematicPolicy(grade)` / `openProblem()` / `applySnapshot()` / `clearLive()` / `toast()` / `addLog()` / `setJudge()` / `resetSession()` / `restartSession()` / `abandonSession()` / `restoreProgress()` / `sessionEpoch` / `restoredHazardCount` / `TOAST_TTL_MS` / `LOG_LIMIT` |
| `src/renderer/app/store-types.ts` | `Route = 'home'\|'list'\|'session'\|'result'\|'settings'` / `CameraPreset` / `Toast` / `LogLine` |
| `src/renderer/app/routes.tsx` | `renderRoute(route)` |
| `src/renderer/session/interaction.ts` | `PickHit`（`terminal` / `wire` / `socket` / `pushbutton` / `empty`）／`ToolMode = 'wire' \| 'delete'`／`InteractionState`／`PickAction`／`pickToAction()` / `escapeToAction()` / `deleteKeyToAction()` / `shouldIgnoreShortcut()` / `LOCKED_WIRE_MESSAGE` / `NOT_WIRABLE_MESSAGE` |
| `src/renderer/session/commands.ts` | `cloneSession()` / `runAddWire()` / `runRemoveWire()` / `runPlug()` / `runUnplug()` / `runSetPreset()` / `emptyHistory()` / `undo()` / `redo()` / `CommandResult<T>` |
| `src/renderer/session/worker-bridge.ts` | `bridge`（`start(handlers)` / `send(command)` / `stop()`）。`BridgeHandlers` は `onSnapshot` / `onJudge` / `onError` |
| `src/renderer/session/work-file.ts` | `toWorkFile()` / `toSession()` / `applyWorkFile()` / `needsDiscardConfirm()` / `MAX_RESTORED_WIRES` |
| `src/renderer/three/BoardScene.tsx` | `BoardScene`（`onPick` / `onHover` / `onPress` / `onRelease`）／`safeRoutes()` / `visualSignature(state)` |
| `src/renderer/three/coords.ts` | `toScene(point)` |
| `src/renderer/three/materials.ts` | `sharedMaterial(color, options)` / `PICK_GEOMETRY` / `SCREW_GEOMETRY` / `LUG_GEOMETRY` / `INVISIBLE_MATERIAL` |
| `src/renderer/schematic/SchematicSvg.tsx` | `SchematicSvg({ document })`。`Shape.cellId` / `Shape.rungId`（`@ojt/schematic-core` の `layout()`） |
| `src/renderer/panels/*` | `Toolbar` / `PowerControls` / `PartsPanel` / `ProblemPanel` / `LogPanel` / `ElapsedTimer` / `TimeChartPanel` / `liveChart` / `TimeChartSvg` |
| `src/renderer/result/*` | `ResultView` / `ChartOverlay` / `MismatchList` / `StaticCheckList` / `HazardList` |
| `src/renderer/i18n/ja.ts` | `JA`（全文言）／`gradeLabel` / `minutesLabel` / `onOffLabel` / `elapsedSummaryText` / `referenceErrorText` / `failedLog` / `openedProblemLog` |
| `src/shared/ipc.ts` | `IPC_CHANNELS`（**6本のまま**）／`ProblemSummary` / `ProblemListPayload` / `WorkFile` / `WORK_FILE_FORMAT_VERSION = 1` / `OjtApi` / `toSummary()` |
| `src/main/content-loader.ts` | `LoadedContent`（`payload` / `byId`）／`loadContent()` / `builtinSet()` |
| `src/main/work-files.ts` | `parseWorkFile()` / `saveWorkFile()` / `loadWorkFile()` / `MAX_WORK_FILE_WIRES` |
| `e2e/projection.ts` | `terminalPoint(physicalId, box)` / `boardPoint(pointMm, box)` / `CanvasBox` / `SELF_HOLD_WIRES` |

### 前提C: 期待値の源（すべて Plan 2A の実測表から引く。本プランでは新しい数値を作らない）

| 量 | 値 | 出典 |
|---|---|---|
| 正常リレーのコイル抵抗 | `650.0`（実値 649.9995775…） | 2A 前提「確定させた実測値」 |
| レアショート（ratio 0.65）のコイル抵抗 | `422.5`（実値 422.4998215…） | 同上 |
| コイル断線のコイル抵抗 | `OL`（生値 ≒ 1.0e9 Ω） | 同上 |
| レアショート判定しきい値 | `552.5`（= 650 × 0.85） | 同上 / `layerShortThresholdOhms()` |
| 導通ありの実測抵抗 | `0.001`（`CLOSED_CONTACT_OHMS`）→ 表示 `導通` | 同上 |
| 導通なし | `Infinity` → 表示 `OL` | 同上 |
| 赤PBを離した状態の `CHK.13`–`CHK.14` 間電圧 | `0.00 V` | 同上 |
| 赤PBを押したままの同電圧 | `23.996…V`（表示 `24.00 V`）→ Ωレンジは `ohm-on-live` ＋ `display: '----'`（`readTester()` が通電中は生の `'OL'` を上書きして測定不能の表示にする。2A ハンドオフ注記 M-8） | 同上 |
| 針の時定数 | 100ms（10ms tick で α ≈ 0.0952） | 2A Task 2 |
| フルスケール角 | 90度 | `NEEDLE_FULL_SCALE_DEG` |
| タイマの点検待ち時間 | 1100ms（`CHECK_TIMER_PRESET_MS + 100`） | `checkSettleMs('timer-h3y4')` |

### 前提D: Worker の性能実測（Task 3 の tick 予算の判断に使う）

| 計測 | 値 | 出典 |
|---|---|---|
| 1tick（10ms）ぶんの回路更新（`Simulation.step()`） | 約0.3μs | 2A 実測 |
| `stepTester()`（Ω・無通電・死回路の測定） | 0.79ms | 2A 実測（実端子数156の実盤） |
| `stepTester()`（DCV・アナログ） | 0.50ms | 同上 |
| `stepTester()`（Ω・通電中・測定拒否＝`ohm-on-live`） | 0.37ms | 同上 |

Ω／導通の実測（`readTester()` 内部の回路解析）は1tickぶんの回路更新より**3桁重い**。Task 3 の Worker ループはこの非対称を前提に設計する（下記の決めたこと表を参照）。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/renderer/session/tester.ts` | **新規**。プローブ配置の純関数（`testerPickToAction` / `nextProbeAfter` / `probeSideAt`）とレンジ表示の文字列 |
| `src/renderer/session/interaction.ts` | **変更**。`ToolMode` に `tester` / `report` を足し、`PickAction` に `placeProbe` / `liftProbe` / `openReport` を足す |
| `src/renderer/session/inspect-parts.ts` | **新規**。C1 の純関数（`checkLoadFor` / `markSheetRows` / `answeredCount` / `probeTargets`） |
| `src/renderer/session/inspect-repair.ts` | **新規**。C2 の純関数（`reportKindsFor` / `hasReportFor` / `reportPickToAction` / `circuitForJudge`） |
| `src/worker/protocol.ts` | **変更**。テスターコマンド・故障付き `load`・C1/C2 判定コマンド・`SimSnapshot.tester`・`inspectResult` |
| `src/worker/sim.worker.ts` | **変更**。テスター状態と毎tickの `stepTester()`、`injectPartFaults()`、`judgeInspectParts()` / `judgeInspectRepair()` |
| `src/renderer/app/store.ts` | **変更**。`problem: SupportedProblem`、`tester`、`hazardBanner`、`answers`、`reports`、`circuit`、`checkPartId`、`highlight` |
| `src/renderer/app/store-types.ts` | **変更**。`ProbeSide` / `HazardBanner` / `HighlightSelection` |
| `src/renderer/panels/TesterPanel.tsx` | **新規**。つまみ・レンジ・プローブ・0Ω調整・表示器（§9.3） |
| `src/renderer/panels/AnalogMeter.tsx` | **新規**。アナログ針のSVG（目盛と針の純関数つき） |
| `src/renderer/panels/WarningBanner.tsx` | **新規**。`ohm-on-live` / `range-exceeded` などの警告バナーとミス回数（§5.6 / §13） |
| `src/renderer/panels/MarkSheetPanel.tsx` | **新規**。C1 のマークシート（部品 × 7択の排他選択） |
| `src/renderer/panels/DiagnosisHelp.tsx` | **新規**。C1 の判定表ヘルプ（折りたたみ） |
| `src/renderer/panels/CheckTrayPanel.tsx` | **新規**。C1 の部品トレイ（チェック用ソケットへ挿す／外す） |
| `src/renderer/panels/ReportPanel.tsx` | **新規**。C2 の指摘一覧と種別ポップオーバー |
| `src/renderer/panels/RepairPanel.tsx` | **新規**。C2 の白線・改造・部品交換の一覧 |
| `src/renderer/panels/tester.module.css` | **新規**。テスター・マークシート・指摘パネルの見た目 |
| `src/renderer/three/ProbeMarkers.tsx` | **新規**。3D盤に黒／赤プローブとハイライト端子を描く |
| `src/renderer/three/BoardScene.tsx` | **変更**。`ProbeMarkers` の組み込みと `visualSignature` の拡張 |
| `src/renderer/schematic/SchematicSvg.tsx` | **変更**。`highlightCellIds` と `onPickCell`（連動ハイライト） |
| `src/renderer/screens/SessionRoute.tsx` | **新規**。課題のモードでセッション画面を振り分ける |
| `src/renderer/screens/InspectPartsSession.tsx` | **新規**。C1 のセッション画面 |
| `src/renderer/screens/InspectRepairSession.tsx` | **新規**。C2 のセッション画面 |
| `src/renderer/screens/Session.tsx` | **変更**。モードBに限定（型の絞り込みだけ） |
| `src/renderer/screens/Home.tsx` | **変更**。C1/C2 のモードカードを有効にする |
| `src/renderer/screens/ProblemList.tsx` | **変更**。モードで絞り込む |
| `src/renderer/screens/Result.tsx` | **変更**。判定結果の `mode` で結果画面を振り分ける |
| `src/renderer/result/InspectPartsResult.tsx` | **新規**。C1 の結果（判定表の突き合わせ） |
| `src/renderer/result/InspectRepairResult.tsx` | **新規**。C2 の結果（指摘・見逃し・過剰・修復・改造） |
| `src/renderer/i18n/ja.ts` | **変更**。`JA.tester` / `JA.inspectParts` / `JA.inspectRepair` と関数を追加 |
| `src/renderer/audio/sounds.ts` | **変更**。テスターの導通ブザー（§15） |
| `src/shared/ipc.ts` | **変更**。`ProblemSummary.mode`、`WorkFile` の任意項目、`OjtApi.readProblem` の戻り型 |
| `src/main/content-loader.ts` | **変更**。`BUILTIN_ALL_PROBLEMS` と `SupportedProblem` |
| `src/main/work-files.ts` | **変更**。`parseWorkFile()` が任意項目を写す |
| `e2e/inspect.spec.ts` | **新規**。§16 Phase 2 受入基準①〜④のE2E |
| `e2e/projection.ts` | **変更**。チェック用ソケットの端子と部品の射影ヘルパ |

---

## Task 1: 課題の型をモードB以外へ広げる（IPC と main）

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/main/content-loader.ts`
- Modify: `apps/desktop/test/content-loader.test.ts`
- Test: `apps/desktop/test/problem-modes.test.ts`

Plan 2A Task 17 は「C1/C2 を開始できる画面が無い」という理由で `content-loader.ts` の一覧と `byId` を `isAssembleProblem` で**モードBに絞った**。本プランがその画面を作るので、この絞り込みを外して20題すべてを一覧に載せ、一覧行（`ProblemSummary`）に `mode` を持たせて画面側がモード別に分けられるようにする。

| 決めること | 本タスクの実装 | 理由 |
|---|---|---|
| 一覧に載せる課題 | `BUILTIN_ALL_PROBLEMS`（20題）＋ 利用者フォルダ | 2B で3モードとも開始できる |
| 行の型 | `ProblemSummary` に `mode: SessionMode` を足す | 画面がモードで絞れるようにする。チャネルは6本のまま（§4.3） |
| `readProblem` の戻り | `SupportedProblem \| null` | C1/C2 の課題も renderer へ渡す |
| モードの型 | `export type SessionMode = SupportedProblem['mode']` を `shared/ipc.ts` に置く | main も renderer も読める場所は `src/shared/` だけ（`ja.ts` は three を引くので main から読めない。1D1 の方針） |

- [x] **Step 1: 失敗するテストを書く**

`apps/desktop/test/problem-modes.test.ts`:

```ts
import {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { toSummary, type SessionMode } from '../src/shared/ipc.js';

/**
 * 課題一覧の行がモードを持つこと（Plan 2B Task 1）。設計仕様 §7.1 / §12.1。
 * Plan 2A が `SupportedProblem` へ広げた3モードすべてが、一覧行としてそのまま描ける形になる。
 */

describe('toSummary（§12.1）', () => {
  it('モードBの課題は mode: assemble の行になる', () => {
    const problem = BUILTIN_ASSEMBLE_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const row = toSummary(problem, 'builtin');
    expect(row.mode).toBe('assemble');
    expect(row.id).toBe(problem.id);
    expect(row.grade).toBe(problem.grade);
    expect(row.source).toBe('builtin');
  });

  it('モードC1の課題は mode: inspect-parts の行になる', () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    expect(toSummary(problem, 'builtin').mode).toBe('inspect-parts');
  });

  it('モードC2の課題は mode: inspect-repair の行になる', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    expect(toSummary(problem, 'user').mode).toBe('inspect-repair');
  });

  it('内蔵20題すべてが行にできる（§7.9）', () => {
    const rows = BUILTIN_ALL_PROBLEMS.map((p) => toSummary(p, 'builtin'));
    expect(rows).toHaveLength(20);
    const modes = new Set<SessionMode>(rows.map((r) => r.mode));
    expect([...modes].sort()).toEqual(['assemble', 'inspect-parts', 'inspect-repair']);
  });
});
```

- [x] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/problem-modes.test.ts
```

Expected: 失敗。`error TS2339: Property 'mode' does not exist on type 'ProblemSummary'` と `Argument of type 'InspectPartsProblem' is not assignable to parameter of type 'AssembleProblem'` で `Test Files  1 failed (1)`。

- [x] **Step 3: `src/shared/ipc.ts` を広げる**

`apps/desktop/src/shared/ipc.ts` の1行目を次に置き換える:

```ts
import type { ProblemLoadError, SupportedProblem } from '@ojt/content';
```

`export const IPC_CHANNELS = { … } as const;` の**直後**に次を挿入する:

```ts
/**
 * 開始できる課題のモード。§7.1 / §12.1
 * `@ojt/content` の `SupportedProblem` から引くので、モードが増えたら画面側が `tsc` で落ちる。
 * main も renderer も読める `src/shared/` に置く（`i18n/ja.ts` は three 由来の型を引くため
 * main から読み込めない。1D1 の方針）。
 */
export type SessionMode = SupportedProblem['mode'];
```

`ProblemSummary` を次に置き換える:

```ts
/** 課題一覧の1行（一覧画面がそのまま描ける形）。§12.1 */
export interface ProblemSummary {
  id: string;
  title: string;
  /** 課題のモード（一覧をモード別に分けるのに使う）。§12.1 */
  mode: SessionMode;
  grade: 1 | 2 | 3;
  /** 課題文の先頭（一覧の説明）。 */
  description: string;
  standardMin: number;
  cutoffMin: number;
  /** 利用者フォルダ由来か。§7.8 */
  source: 'builtin' | 'user';
}
```

`OjtApi` の `readProblem` の行を次に置き換える:

```ts
  readProblem: (id: string) => Promise<SupportedProblem | null>;
```

`toSummary()` を次に置き換える:

```ts
/** 課題を一覧行に直す。 */
export function toSummary(problem: SupportedProblem, source: 'builtin' | 'user'): ProblemSummary {
  return {
    id: problem.id,
    title: problem.title,
    mode: problem.mode,
    grade: problem.grade,
    description: problem.description,
    standardMin: problem.timeLimit.standardMin,
    cutoffMin: problem.timeLimit.cutoffMin,
    source,
  };
}
```

- [x] **Step 4: `src/main/content-loader.ts` の絞り込みを外す**

`apps/desktop/src/main/content-loader.ts` の `import { BUILTIN_PROBLEMS, isAssembleProblem, type AssembleProblem } from '@ojt/content';` を次に置き換える:

```ts
import { BUILTIN_ALL_PROBLEMS, type SupportedProblem } from '@ojt/content';
```

`LoadedContent` を次に置き換える:

```ts
/** 合流済みの課題（IDで引けるようにした一覧）。 */
export interface LoadedContent {
  payload: ProblemListPayload;
  byId: Map<string, SupportedProblem>;
}
```

`builtinSet()` の1行目（`const bundled: ProblemSet = { problems: [...BUILTIN_PROBLEMS], errors: [] };`）を次に置き換える:

```ts
  // Plan 2B: モードB 8題 ＋ C1 4セット ＋ C2 8題 の計20題すべてを一覧に載せる（§7.9）
  const bundled: ProblemSet = { problems: [...BUILTIN_ALL_PROBLEMS], errors: [] };
```

`readContent()` の中の `const merged = …` から `byId` の生成までを次に置き換える（Plan 2A Task 17 Step 3 が入れた `startable` の絞り込みを外す）:

```ts
  const merged = mergeProblemSets(builtin, user);
  const userIds = new Set(user.problems.map((p) => p.id));
  const byId = new Map(merged.problems.map((p) => [p.id, p] as const));
  return {
    payload: {
      problems: merged.problems.map((p) =>
        toSummary(p, userIds.has(p.id) || !builtinIds.has(p.id) ? 'user' : 'builtin'),
      ),
      errors: merged.errors.map(toErrorRow),
      userDir,
      userDirExists: exists,
    },
    byId,
  };
```

- [x] **Step 5: 既存テストを20題に合わせる**

`apps/desktop/test/content-loader.test.ts` の import 行 `import { BUILTIN_PROBLEMS } from '@ojt/content';` を次に置き換える:

```ts
import { BUILTIN_ALL_PROBLEMS } from '@ojt/content';
```

同ファイル中の `BUILTIN_PROBLEMS` を**すべて** `BUILTIN_ALL_PROBLEMS` に置き換える（6箇所）。さらに1つ目のテスト名を次に置き換える:

```ts
  it('開発時は焼き込みの内蔵課題20題を返す（§7.9）', () => {
    expect(builtinSet().problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    expect(builtinSet().errors).toHaveLength(0);
  });
```

`配布版は resources/content から同梱課題を読む（§7.8）` のテストは同梱課題をすべて `content/assemble/` に書き出しているが、`loadProblemsFromDir()` はフォルダを再帰的に辿るので**置き場所に関係なく読める**。`BUILTIN_ALL_PROBLEMS` に置き換えるだけで通る（20題が `content/assemble/` に並ぶだけで、モードは課題JSONの `mode` が決める）。

同ファイルの末尾に、内蔵課題の総数を直接固定するテストを足す（§7.9 / 前提#4）:

```ts
  it('内蔵課題は20題（モードB 8 / C1 4 / C2 8）', () => {
    expect(BUILTIN_ALL_PROBLEMS).toHaveLength(20);
  });
```

- [x] **Step 5a: `test/problem-list.test.tsx` の既存リテラルに `mode` を足す**

`ProblemSummary` に `mode` が増えたので（Step 3）、この型で書かれた既存のテストのリテラルが `pnpm --filter @ojt/desktop typecheck`（Step 7）で型エラーになる。`apps/desktop/test/problem-list.test.tsx` の `PAYLOAD` の中の課題オブジェクトの `source: 'builtin',` の**直前**に次を挿入する:

```ts
      mode: 'assemble',
```

同ファイルの「出所タグを列に出す（§7.8）」テストの `u-001` オブジェクトの `source: 'user',` の**直前**にも同じ行を挿入する:

```ts
              mode: 'assemble',
```

- [x] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/problem-modes.test.ts test/content-loader.test.ts test/problem-list.test.tsx --no-file-parallelism
```

Expected: `Test Files  3 passed (3)`。`problem-modes` 4件、`content-loader` は既存の件数＋1件、`problem-list` は既存の件数のまま全て通る。

- [x] **Step 6a: `ProblemList.tsx` に暫定のモード絞り込みを入れる**

`readProblem()` の戻りが `SupportedProblem` に広がったので、`openProblem(problem)`（引数は `AssembleProblem`）へそのまま渡すと型が合わなくなる。ストアを広げるのは Task 4 なので、ここでは**モードBだけ開く**暫定の絞り込みを入れる（Task 4 Step 10 で外す）。

`apps/desktop/src/renderer/screens/ProblemList.tsx` の `openProblem(problem);` の行を次に置き換える:

```ts
            if (problem.mode !== 'assemble') {
              // Task 4 でストアが `SupportedProblem` に広がるまでの暫定。C1/C2 はまだ開けない
              toast(`${JA.problemList.loadFailed}: ${id}`, 'error');
              return;
            }
            openProblem(problem);
```

- [x] **Step 7: 型検査を通す**

```powershell
pnpm --filter @ojt/desktop typecheck
```

Expected: 無出力。

- [x] **Step 8: コミットする**

```powershell
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/main/content-loader.ts apps/desktop/src/renderer/screens/ProblemList.tsx apps/desktop/test/content-loader.test.ts apps/desktop/test/problem-modes.test.ts apps/desktop/test/problem-list.test.tsx
git commit -m @'
feat(desktop): list all twenty builtin problems with their mode

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 2: プローブ配置の純関数（`session/tester.ts`）

**Files:**
- Create: `apps/desktop/src/renderer/session/tester.ts`
- Modify: `apps/desktop/src/renderer/session/interaction.ts`
- Modify: `apps/desktop/test/interaction.test.ts`
- Test: `apps/desktop/test/tester-ui.test.ts`

§9.3「プローブは黒 → 赤 の順に端子をクリックして配置する」を、3D も React も使わない純関数にする。判断の置き場所は `pickToAction()`（Plan 1D1）と同じ「ピック結果 → 操作」の一本道である。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| ツールモード | `ToolMode` に `'tester'` と `'report'` を足す（`'wire' \| 'delete' \| 'tester' \| 'report'`）。`'report'` は Task 13（C2の指摘）で使う | §8.1 のツールバーはモードの排他選択 |
| 置く順 | `next`（次に置くプローブ）が黒→赤→黒…と巡る。パネルのボタンで明示的に切り替えられる | §9.3 |
| 外す | プローブが載っている端子をもう一度クリックすると、そのプローブだけを外す（`next` はそのプローブになる） | §9.3 の「付け替え」をクリック2回で表す（意図的な差分 #3） |
| 配線できない端子 | テスターは**測るだけ**なので `wirable` を見ない（既設配線済みの本体側端子にも当てられる） | §9.1 測定2 は `CHK.9`–`CHK.5` など本体側の端子を測る |
| 電線・ソケット・押ボタン | テスターモードでは押ボタンだけ押せる（励磁して測るため）。電線とソケットは無視 | §9.1 の手順（赤PBを押しながら測る） |
| 空クリック | 両方のプローブを外す | §8.2 の Esc と同じ「取り消し」の作法 |

- [x] **Step 1: 失敗するテストを書く**

`apps/desktop/test/tester-ui.test.ts`:

```ts
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import type { PickHit } from '../src/renderer/session/interaction.js';
import {
  nextProbeAfter,
  probeSideAt,
  testerPickToAction,
  type TesterPickState,
} from '../src/renderer/session/tester.js';

/**
 * プローブ配置の純関数（Plan 2B Task 2）。設計仕様 §9.3 / §12.2。
 * 黒 → 赤 の順に置き、同じ端子をもう一度押したら外す。
 */

const S7_13 = toTerminalId('S7.13');
const S7_14 = toTerminalId('S7.14');
const S7_9 = toTerminalId('S7.9');

function state(overrides: Partial<TesterPickState> = {}): TesterPickState {
  return { black: undefined, red: undefined, next: 'black', ...overrides };
}

function terminal(id: string): PickHit {
  return { kind: 'terminal', id: toTerminalId(id), wirable: false, label: id };
}

describe('nextProbeAfter（§9.3 黒 → 赤）', () => {
  it('黒の次は赤', () => {
    expect(nextProbeAfter('black')).toBe('red');
  });

  it('赤の次は黒（巡回する）', () => {
    expect(nextProbeAfter('red')).toBe('black');
  });
});

describe('probeSideAt', () => {
  it('その端子にプローブが載っていれば側を返す', () => {
    const s = state({ black: S7_13, red: S7_14 });
    expect(probeSideAt(s, S7_13)).toBe('black');
    expect(probeSideAt(s, S7_14)).toBe('red');
  });

  it('載っていなければ undefined', () => {
    expect(probeSideAt(state(), S7_9)).toBeUndefined();
  });
});

describe('testerPickToAction（§9.3）', () => {
  it('最初の端子クリックは黒を置く', () => {
    expect(testerPickToAction(state(), terminal('S7.13'))).toEqual({
      type: 'placeProbe',
      probe: 'black',
      terminal: S7_13,
    });
  });

  it('2つ目の端子クリックは赤を置く', () => {
    const s = state({ black: S7_13, next: 'red' });
    expect(testerPickToAction(s, terminal('S7.14'))).toEqual({
      type: 'placeProbe',
      probe: 'red',
      terminal: S7_14,
    });
  });

  it('3つ目は黒に戻る（付け替え）', () => {
    const s = state({ black: S7_13, red: S7_14, next: 'black' });
    expect(testerPickToAction(s, terminal('S7.9'))).toEqual({
      type: 'placeProbe',
      probe: 'black',
      terminal: S7_9,
    });
  });

  it('載っているプローブの端子をもう一度押すと外す', () => {
    const s = state({ black: S7_13, red: S7_14, next: 'black' });
    expect(testerPickToAction(s, terminal('S7.14'))).toEqual({ type: 'liftProbe', probe: 'red' });
  });

  it('配線できない端子にも当てられる（本体側の既設配線済み端子を測る。§9.1 測定2）', () => {
    const hit: PickHit = { kind: 'terminal', id: S7_9, wirable: false, label: 'CHK ⑨ COM' };
    expect(testerPickToAction(state(), hit)).toEqual({
      type: 'placeProbe',
      probe: 'black',
      terminal: S7_9,
    });
  });

  it('押ボタンは押せる（赤PBで励磁しながら測る。§9.1）', () => {
    expect(testerPickToAction(state(), { kind: 'pushbutton', id: 'PB4' })).toEqual({
      type: 'pressButton',
      pbId: 'PB4',
    });
  });

  it('電線とソケットは無視する', () => {
    expect(testerPickToAction(state(), { kind: 'wire', id: 'w-1', locked: false })).toEqual({
      type: 'none',
    });
    expect(testerPickToAction(state(), { kind: 'socket', id: 'S1', occupied: false })).toEqual({
      type: 'none',
    });
  });

  it('空クリックは両方のプローブを外す', () => {
    const s = state({ black: S7_13, red: S7_14 });
    expect(testerPickToAction(s, { kind: 'empty' })).toEqual({ type: 'liftProbe', probe: 'both' });
  });

  it('プローブが1本も載っていなければ空クリックは何もしない', () => {
    expect(testerPickToAction(state(), { kind: 'empty' })).toEqual({ type: 'none' });
  });
});
```

- [x] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/tester-ui.test.ts
```

Expected: 失敗。`Failed to resolve import "../src/renderer/session/tester.js"` で `Test Files  1 failed (1)`。

- [x] **Step 3: `session/interaction.ts` を広げる**

`apps/desktop/src/renderer/session/interaction.ts` の `ToolMode` を次に置き換える:

```ts
/**
 * ツールバーのモード。§8.1 / §9.2 / §9.3
 * `tester` はプローブを端子に置くモード（C1/C2）、`report` は3D要素をクリックして
 * 故障を指摘するモード（C2）。どのモードでも押ボタンは押せる（励磁して測るため）。
 */
export type ToolMode = 'wire' | 'delete' | 'tester' | 'report';
```

`PickAction` の末尾（`| { type: 'pressButton'; pbId: string };` の直前）に3つの枝を挿入し、最後のセミコロンの位置を保つ:

```ts
  /** 押ボタンを押す。§8.2 */
  | { type: 'pressButton'; pbId: string }
  /** テスターのプローブを端子に置く。§9.3 */
  | { type: 'placeProbe'; probe: 'black' | 'red'; terminal: TerminalId }
  /** テスターのプローブを外す（`both` は両方）。§9.3 */
  | { type: 'liftProbe'; probe: 'black' | 'red' | 'both' }
  /** 故障の指摘先を選んだので種別ポップオーバーを出す。§9.2 */
  | { type: 'openReport'; target: ReportTarget };
```

同ファイルの `PickAction` の**直前**に、指摘の対象型を足す:

```ts
/**
 * 故障の指摘先。§9.2 / Plan 2A の `FaultReport['target']` と同じ形にする。
 * 未配線は盤に電線が無いので端子で指す（Plan 2A 意図的な差分 #6）。
 */
export type ReportTarget = { wireId: string } | { partId: string } | { terminalId: string };
```

`pickToAction()` の本体先頭（`if (state.mode === 'delete') {` の**直前**）に次を挿入する:

```ts
  if (state.mode === 'tester' || state.mode === 'report') {
    // テスター／指摘モードの判断は専用の純関数が持つ（`session/tester.ts` / `session/inspect-repair.ts`）
    return { type: 'none' };
  }
```

（`pickToAction()` は配線・削除の2モードだけを見る関数のままにし、新しい2モードは呼び出し側が別の関数へ振り分ける。`switch` の網羅性検査を壊さないため、ここで早期に返す。）

- [x] **Step 4: `session/tester.ts` を作る**

`apps/desktop/src/renderer/session/tester.ts`:

```ts
import type { TerminalId } from '@ojt/circuit-sim';
import type { PickAction, PickHit } from './interaction.js';

/**
 * テスターのプローブ配置。設計仕様 §9.3 / §12.2。
 * 3D も React も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 *
 * §9.3 は「プローブは黒 → 赤 の順に端子をクリックして配置する」と定める。ここでは
 * 「次に置く側」（`next`）を状態に持たせ、置くたびに黒→赤→黒…と巡らせることで
 * その順序を既定にしつつ、パネルのボタンで明示的に選び直せる逃げ道も残す。
 *
 * §9.3 の「配置済みプローブはドラッグで付け替える」は、**クリックで外す → クリックで置く**
 * に置き換えた。3Dビューポートでのドラッグは `OrbitControls` の回転と取り合いになり、
 * 端子1個（当たり判定4mm）を掴んだまま別の端子へ運ぶ操作は内蔵GPUの画面では現実的でない。
 */

/** プローブの側。 */
export type ProbeSide = 'black' | 'red';

/** プローブ配置の判断に要る状態だけを抜き出したもの。 */
export interface TesterPickState {
  /** 黒プローブを置いた端子（物理端子ID）。 */
  black: TerminalId | undefined;
  /** 赤プローブを置いた端子（物理端子ID）。 */
  red: TerminalId | undefined;
  /** 次に置くプローブ。 */
  next: ProbeSide;
}

/** 黒 → 赤 → 黒 … と巡る。§9.3 */
export function nextProbeAfter(probe: ProbeSide): ProbeSide {
  return probe === 'black' ? 'red' : 'black';
}

/** その端子にプローブが載っていれば側を返す。 */
export function probeSideAt(state: TesterPickState, terminal: TerminalId): ProbeSide | undefined {
  if (state.black === terminal) return 'black';
  if (state.red === terminal) return 'red';
  return undefined;
}

/**
 * ピック結果をテスターの操作に変換する。§9.3
 * - 端子: 既にプローブが載っていれば外し、載っていなければ `next` の側を置く
 * - 押ボタン: 押す（§9.1 は赤PBで励磁しながら測る手順を要求する）
 * - 空クリック: 置いてあるプローブを両方外す
 * - 電線・ソケット: 何もしない（テスターは測るだけで盤を変えない）
 *
 * **`terminal.wirable` は見ない。** 配線できない本体側の端子（`CHK.9` など既設配線済みの
 * ピン）こそ §9.1 測定2 が測る対象であり、そこにプローブを当てられなければ点検できない。
 */
export function testerPickToAction(state: TesterPickState, hit: PickHit): PickAction {
  switch (hit.kind) {
    case 'terminal': {
      const side = probeSideAt(state, hit.id);
      if (side !== undefined) return { type: 'liftProbe', probe: side };
      return { type: 'placeProbe', probe: state.next, terminal: hit.id };
    }
    case 'pushbutton':
      return { type: 'pressButton', pbId: hit.id };
    case 'empty':
      return state.black === undefined && state.red === undefined
        ? { type: 'none' }
        : { type: 'liftProbe', probe: 'both' };
    case 'wire':
    case 'socket':
      return { type: 'none' };
  }
}
```

- [x] **Step 5: `test/interaction.test.ts` に新モードの素通りを足す**

`apps/desktop/test/interaction.test.ts` の末尾に次を足す:

```ts
describe('新しいツールモード（Plan 2B Task 2）', () => {
  it('テスターモードと指摘モードでは pickToAction は判断しない（専用の純関数が持つ）', () => {
    const hit: PickHit = {
      kind: 'terminal',
      id: toTerminalId('S1.13'),
      wirable: true,
      label: 'CR1 ⑬ −',
    };
    for (const mode of ['tester', 'report'] as const) {
      expect(
        pickToAction(
          { mode, pendingTerminal: undefined, selectedWire: undefined, wireColor: '青' },
          hit,
        ),
      ).toEqual({ type: 'none' });
    }
  });
});
```

（`describe` / `it` / `expect` / `pickToAction` / `PickHit` / `toTerminalId` は既存の import で揃っている。足りなければ既存の import 行に追記する。）

- [x] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/tester-ui.test.ts test/interaction.test.ts --no-file-parallelism
```

Expected: `Test Files  2 passed (2)`。`tester-ui` 13件、`interaction` は既存＋1件。

- [x] **Step 7: コミットする**

```powershell
git add apps/desktop/src/renderer/session/tester.ts apps/desktop/src/renderer/session/interaction.ts apps/desktop/test/tester-ui.test.ts apps/desktop/test/interaction.test.ts
git commit -m @'
feat(desktop): resolve tester probe placement from picks

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 3: Worker プロトコルにテスターを載せる

**Files:**
- Modify: `apps/desktop/src/worker/protocol.ts`
- Modify: `apps/desktop/src/worker/sim.worker.ts`
- Test: `apps/desktop/test/sim-worker-tester.test.ts`

テスターの状態機械（Plan 2A の `applyTesterAction` / `stepTester`）を **Worker 側**に置き、毎 tick 進めて読値と針角度をスナップショットに載せる。`range-exceeded` は `stepTester()` が `sim.events` に流すので、既存の `hazardDelta` にそのまま乗る（renderer 側の配線は不要）。

| 決めたこと | 内容 | 理由 |
|---|---|---|
| コマンドは1本 | `{ type: 'tester'; action: TesterAction }`。つまみ・レンジ・プローブ・0Ω調整の4種を別コマンドにしない | リデューサ（`applyTesterAction`）が唯一の真実になり、renderer と Worker で状態がずれない。増やすほどコマンドの網羅漏れが起きる（意図的な差分 #1） |
| 針の積分 | Worker が `stepTester(sim, state, TICK_MS)` を**毎 tick** 呼ぶ | §9.3「読値は tick（10ms）ごとに更新する／針は時定数100msの指数移動平均」 |
| 読値の送出 | 約30fpsのスナップショットに `tester` を1個載せる | tick ごとに送ると1秒100通信になる。`SNAPSHOT_INTERVAL_MS = 33` の既存の間引きに乗せる |
| 端子ID | コマンドに載せるのは**役割ID**（`CHK.13`）。3Dが返す物理ID（`S7.13`）は renderer 側で `toNetlistTerminal()` が直す | ネットリストは役割IDで組まれている（§6.4。`runAddWire()` と同じ流儀） |
| つまみOFF | `mode === 'off'` のときも `stepTester()` は呼ぶ（針を0へ戻すため） | 実機のつまみを切っても針は戻りながら止まる |
| Ω／導通の実測頻度 | 毎tick律儀に呼ばない。①つまみOFFかプローブが片方でも未配置なら `stepTester()` を呼ばない、②それ以外は `SNAPSHOT_INTERVAL_MS`（33ms）ごと、またはプローブ位置を変えた直後だけ実測し直す | `stepTester()` の実測（`readTester()` 内部の回路解析）は1tickの回路更新の3桁重い（前提D）。renderer への描画もスナップショット（33ms間隔）でしか動かないので、実測を間引いても見た目は変わらない |
| 針の時定数の扱い | 実測を間引いても、`stepTester()` に渡す `dtMs` を「前回実測からの経過tick数 × TICK_MS」にすることで、指数移動平均の式そのものは経過時間どおりに進める | 一度にまとめて進めても、10msごとに3回進めるのと数学的に等価（指数減衰の合成則）。読値と針の再計算を1回にまとめ、余分な `readTester()` 呼び出しを避ける |
| 2A側のキャッシュ | 上記に加えて `readTester()` 自身も `Simulation` 単位でキャッシュ済み（tick・プローブ・レンジ種別が同じ間はフルの回路解析をやり直さない） | 2A 側で実装済み（2A Task 2 のレビュー反映①）。本プランはそのAPIをそのまま呼ぶだけで、キャッシュの実装は持たない |

- [x] **Step 1: 失敗するテストを書く**

`apps/desktop/test/sim-worker-tester.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import type { BoardSession } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_PROBLEMS, buildReferenceSession } from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * Worker のテスター（Plan 2B Task 3）。設計仕様 §9.3 / §5.5 / §5.6 #1 / §5.6 #2。
 * `sim-worker.test.ts` と同じ「偽の `self`」方式で、Worker を起こさず素のモジュールとして回す。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));

vi.setConfig({ testTimeout: 15_000 });

const B001 = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');

function referenceSession(): BoardSession {
  if (B001 === undefined) throw new Error('b-001 が見つかりません');
  const built = buildReferenceSession(B001, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路を作れませんでした');
  return built.value.session;
}

interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  errors: Array<Extract<SimMessage, { type: 'error' }>>;
  send: (command: SimCommand) => void;
  advance: (ms: number, stepMs?: number) => void;
}

async function boot(): Promise<Harness> {
  const posted: SimMessage[] = [];
  const fakeSelf = {
    postMessage: (message: SimMessage) => {
      posted.push(message);
    },
    onmessage: undefined as unknown as (event: { data: SimCommand }) => void,
  };
  Object.defineProperty(globalThis, 'self', {
    value: fakeSelf,
    configurable: true,
    writable: true,
  });
  clock.nowMs = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs);
  vi.resetModules();
  await import('../src/worker/sim.worker.js');
  return {
    posted,
    get snapshots() {
      return posted.filter((m) => m.type === 'snapshot').map((m) => m.snapshot);
    },
    get errors() {
      return posted.filter((m) => m.type === 'error');
    },
    send: (command) => {
      fakeSelf.onmessage({ data: command });
    },
    advance: (ms, stepMs = 4) => {
      let left = ms;
      while (left > 0) {
        const chunk = Math.min(stepMs, left);
        clock.nowMs += chunk;
        vi.advanceTimersByTime(chunk);
        left -= chunk;
      }
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 通電した b-001 の盤で1周ぶん進めて最後のスナップショットを得る。 */
async function powered(): Promise<Harness> {
  const h = await boot();
  h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
  h.advance(100);
  h.send({ type: 'breaker', on: true });
  h.send({ type: 'switch', on: true });
  h.advance(200);
  return h;
}

describe('テスターのスナップショット（§9.3）', () => {
  it('つまみOFFのときは OFF を出す', async () => {
    const h = await powered();
    expect(h.snapshots.at(-1)?.tester.display).toBe('OFF');
    expect(h.snapshots.at(-1)?.tester.mode).toBe('off');
  });

  it('DCVでプローブが片方だけなら ---- を出す', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.advance(100);
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
  });

  it('DCVで母線間を測ると 24.00 V になる（§5.5）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    h.advance(100);
    expect(h.snapshots.at(-1)?.tester.display).toBe('24.00 V');
    expect(h.snapshots.at(-1)?.tester.value).toBeCloseTo(24, 1);
  });

  it('アナログで 2.5V レンジに 24V を当てると range-exceeded が1回だけ出る（§5.6 #2）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-kind', kind: 'analog' } });
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({ type: 'tester', action: { type: 'set-volt-range', range: 2.5 } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    h.advance(400);

    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.filter((e) => e.kind === 'range-exceeded')).toHaveLength(1);
    expect(h.snapshots.at(-1)?.tester.overRange).toBe(true);
    // 振り切れているのでフルスケール（90度）へ寄っていく
    expect(h.snapshots.at(-1)?.tester.needleDeg).toBeGreaterThan(80);
  });

  it('アナログ針は目標角度へ徐々に寄る（時定数100ms。§9.3）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-kind', kind: 'analog' } });
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({ type: 'tester', action: { type: 'set-volt-range', range: 250 } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    // 24V / 250V レンジ → 目標は 90 × 24/250 = 8.64 度
    h.advance(40);
    const early = h.snapshots.at(-1)?.tester.needleDeg ?? 0;
    h.advance(600);
    const settled = h.snapshots.at(-1)?.tester.needleDeg ?? 0;
    expect(early).toBeLessThan(settled);
    expect(settled).toBeGreaterThan(8);
    expect(settled).toBeLessThan(8.7);
  });

  it('通電中にΩレンジを当てると ohm-on-live が出て ---- になる（§5.6 #1）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    h.advance(100);
    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.some((e) => e.kind === 'ohm-on-live')).toBe(true);
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
    expect(h.snapshots.at(-1)?.tester.live).toBe(true);
  });

  it('課題を読み込み直すとプローブは外れるが、つまみの位置は残る（§9.1 部品の挿し替え）', async () => {
    const h = await powered();
    h.send({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') },
    });
    h.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') },
    });
    h.advance(100);
    expect(h.snapshots.at(-1)?.tester.display).toBe('24.00 V');

    h.send({ type: 'load', problemId: 'b-001', session: referenceSession() });
    h.advance(100);
    // つまみは DCV のまま、プローブだけ外れて `----` になる
    expect(h.snapshots.at(-1)?.tester.mode).toBe('DCV');
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
    expect(h.errors).toEqual([]);
  });
});
```

- [x] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/sim-worker-tester.test.ts
```

Expected: 失敗。`Object literal may only specify known properties, and 'tester' does not exist in type` と `Property 'tester' does not exist on type 'SimSnapshot'` で `Test Files  1 failed (1)`。

- [x] **Step 3: `src/worker/protocol.ts` を広げる**

`apps/desktop/src/worker/protocol.ts` の import を次に置き換える:

```ts
import type { BoardSession, SocketId } from '@ojt/board-model';
import type {
  ChatterEvent,
  HazardEvent,
  LampLevel,
  LogEntry,
  TesterAction,
  TesterKind,
  TesterMode,
  Wire,
} from '@ojt/circuit-sim';
import type { AssembleProblem, JudgeAssembleResult } from '@ojt/content';
```

`SimCommand` の `judge` の枝（最後の枝）を次に置き換える:

```ts
  /** 判定する。模範回路と訓練者回路を worker 内で並走させる。§8.3 */
  | { type: 'judge'; problem: AssembleProblem; session: BoardSession; elapsedMs: number }
  /**
   * テスターを操作する。§9.3
   * つまみ・レンジ・プローブ・0Ω調整をまとめて **1本のコマンド**にし、中身は Plan 2A の
   * `TesterAction` をそのまま運ぶ。renderer も worker も同じ `applyTesterAction()` に通すので、
   * 画面のつまみの位置と worker が測っている状態がずれない（コマンドを種別ごとに分けると、
   * 片方だけ実装し忘れたときに静かにずれる）。
   */
  | { type: 'tester'; action: TesterAction };
```

`SimSnapshot` の `droppedTicks` の**直前**に次を挿入する:

```ts
  /** テスターの読値と針（約30fpsで送る。tick ごとの更新は worker の中で行う）。§9.3 */
  tester: TesterSnapshot;
```

`SimSnapshot` の**直前**に `TesterSnapshot` を足す:

```ts
/**
 * テスター1個の表示状態。§9.3
 * `TesterReading`（Plan 2A）に、worker が積分している針の現在角度 `needleDeg` を添えたもの。
 */
export interface TesterSnapshot {
  kind: TesterKind;
  mode: TesterMode;
  /** 読値の生値（DCV/ACVは[V]、Ω／導通は[Ω]）。測定できないときは NaN。 */
  value: number;
  /** 表示文字列（`OFF` / `----` / `OL` / `導通` / `−−−` / 数値）。 */
  display: string;
  /** 針の目標角度[度]。 */
  targetDeg: number;
  /** 針の現在角度[度]（時定数100msで目標へ寄る）。 */
  needleDeg: number;
  /** レンジ上限を超えた（振り切れ）。§5.6 #2 */
  overRange: boolean;
  /** 通電中にΩ／導通を当てた。§5.6 #1 */
  live: boolean;
  /** 導通レンジでブザーが鳴る（50Ω以下）。§5.5 */
  conductive: boolean;
}
```

- [x] **Step 4: `src/worker/sim.worker.ts` にテスターを組み込む**

`apps/desktop/src/worker/sim.worker.ts` の `@ojt/circuit-sim` の import を次に置き換える:

```ts
import {
  applyTesterAction,
  createRelay4c,
  createTesterState,
  createTimer4c,
  readTester,
  Simulation,
  stepTester,
  TESTER_NO_PROBE_DISPLAY,
  TESTER_OFF_DISPLAY,
  TICK_MS,
  type ChatterEvent,
  type HazardEvent,
  type LogEntry,
  type Part,
  type TesterReading,
  type TesterState,
} from '@ojt/circuit-sim';
```

`protocol.js` の import に `TesterSnapshot` を足す:

```ts
import {
  SNAPSHOT_INTERVAL_MS,
  type LampSnapshot,
  type RelaySnapshot,
  type SimCommand,
  type SimMessage,
  type SimSnapshot,
  type TesterSnapshot,
  type TimerSnapshot,
} from './protocol.js';
```

モジュール変数の並び（`let droppedTicks = 0;` の直後）に次を足す:

```ts
/** テスターの状態（つまみ・レンジ・プローブ・針）。§9.3 */
let tester: TesterState = createTesterState();
/** 直近の読値（スナップショットに載せる）。実測の間引きについては下記 `loop()` を参照（前提D）。 */
let testerReading: TesterReading = {
  kind: tester.kind,
  mode: tester.mode,
  value: Number.NaN,
  display: 'OFF',
  targetDeg: 0,
  overRange: false,
  live: false,
  conductive: false,
};
/** 直近の `stepTester()` 実測からの経過tick数。§9.3 / 前提D */
let ticksSinceTesterMeasure = 0;
/** つまみ・レンジ・プローブ・盤が変わって、次tickで即座に実測し直す必要があるか。 */
let testerDirty = true;
```

`load()` の末尾（`chatterCursor = 0;` の後ろ）に次を足す:

```ts
  /*
   * 盤を作り直したらプローブは外す（前の盤の端子IDは新しいネットリストに無いかもしれない）。
   * **つまみとレンジは残す。** テスターは盤ではなく計器であり、C1では部品を挿し替えるたびに
   * `load` を送り直すので、そのたびにΩレンジへ回し直させるのは実機の手順と食い違う（§9.1）。
   * 0Ω調整はプローブを動かしたらやり直す実機の作法に合わせて落ちる（`applyTesterAction`）。
   */
  tester = applyTesterAction(
    applyTesterAction(tester, { type: 'place-probe', probe: 'red', terminal: undefined }),
    { type: 'place-probe', probe: 'black', terminal: undefined },
  );
  testerReading = readTester(simulation, tester);
  ticksSinceTesterMeasure = 0;
  testerDirty = true;
```

`buildSnapshot()` の戻り値の `droppedTicks,` の**直前**に次を挿入する:

```ts
    tester: testerSnapshot(),
```

`buildSnapshot()` の**直前**に次を足す:

```ts
/** 直近の読値と針の角度をスナップショットの形にする。§9.3 */
function testerSnapshot(): TesterSnapshot {
  return {
    kind: testerReading.kind,
    mode: testerReading.mode,
    value: testerReading.value,
    display: testerReading.display,
    targetDeg: testerReading.targetDeg,
    needleDeg: tester.needleDeg,
    overRange: testerReading.overRange,
    live: testerReading.live,
    conductive: testerReading.conductive,
  };
}
```

`loop()` の `for (let i = 0; i < plan.ticks; i += 1) sim.step(TICK_MS);` を次に置き換える:

```ts
    /*
     * 1tick ＝「回路を進める」→「必要なら測る」の順。§9.3 / 前提D
     * `stepTester()`（内部で `readTester()` が回路解析を行う）は1tickの回路更新より3桁重い
     * （前提D。実端子数156の実盤でDCV/Ωいずれのモードでも0.4〜0.8ms）。renderer への描画も
     * スナップショット（`SNAPSHOT_INTERVAL_MS` = 33ms）でしか動かないので、実測を間引いても
     * 見た目は変わらない:
     * ① つまみOFF、またはプローブが片方でも未配置なら `stepTester()` を呼ばない
     *    （測る対象が無い。既定表示に戻すだけで、針は直近の位置のまま止まる）。
     * ② それ以外は `SNAPSHOT_INTERVAL_MS` ごと、またはつまみ・レンジ・プローブ・盤を
     *    変えた直後（`testerDirty`）だけ実測し直す。`stepTester()` に渡す `dtMs` を
     *    「前回実測からの経過tick数 × TICK_MS」にすることで、時定数100msの指数移動平均は
     *    経過時間どおりに進む（10msごとに3回進めるのと数学的に等価。指数減衰の合成則）。
     * `range-exceeded` は実測した tick の `sim.events` に流れる（`hazardDelta` にそのまま乗る）。
     */
    for (let i = 0; i < plan.ticks; i += 1) {
      sim.step(TICK_MS);
      ticksSinceTesterMeasure += 1;
      const measurable =
        tester.mode !== 'off' && tester.black !== undefined && tester.red !== undefined;
      if (!measurable) {
        testerReading = {
          ...testerReading,
          value: Number.NaN,
          targetDeg: 0,
          display: tester.mode === 'off' ? TESTER_OFF_DISPLAY : TESTER_NO_PROBE_DISPLAY,
        };
        // 測れない間は経過tickを積み増さない。再開後の最初の実測が古いdtで一気に収束しないように
        ticksSinceTesterMeasure = 0;
        continue;
      }
      if (testerDirty || ticksSinceTesterMeasure * TICK_MS >= SNAPSHOT_INTERVAL_MS) {
        const stepped = stepTester(sim, tester, ticksSinceTesterMeasure * TICK_MS);
        tester = stepped.state;
        testerReading = stepped.reading;
        ticksSinceTesterMeasure = 0;
        testerDirty = false;
      }
    }
```

`handle()` の `switch (command.type)` に次の枝を足す（`case 'resetTrip':` の**直後**、`case 'judge':` の**直前**）:

```ts
    case 'tester':
      /*
       * つまみ・レンジ・プローブ・0Ω調整。状態の更新は Plan 2A のリデューサ1本に任せる。
       * 読値の更新は次の tick の `loop()` が行うので、ここでは測らない
       * （ここで測ると1tickに2回測ることになり、`ohm-on-live` が二重に計上される）。
       * `testerDirty` を立てて、次tickで間引かずに即座に実測させる（前提D）。
       */
      tester = applyTesterAction(tester, command.action);
      testerDirty = true;
      break;
```

- [x] **Step 5: `EMPTY_SNAPSHOT` にテスターを足す**

`apps/desktop/src/renderer/app/store.ts` の `EMPTY_SNAPSHOT` の `droppedTicks: 0,` の**直前**に次を挿入する:

```ts
  tester: {
    kind: 'digital',
    mode: 'off',
    value: Number.NaN,
    display: 'OFF',
    targetDeg: 0,
    needleDeg: 0,
    overRange: false,
    live: false,
    conductive: false,
  },
```

- [x] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/sim-worker-tester.test.ts test/sim-worker.test.ts --no-file-parallelism
```

Expected: `Test Files  2 passed (2)` / `Tests  ... passed`。新規7件と既存の Worker テストが両方通る。

- [x] **Step 7: コミットする**

```powershell
git add apps/desktop/src/worker/protocol.ts apps/desktop/src/worker/sim.worker.ts apps/desktop/src/renderer/app/store.ts apps/desktop/test/sim-worker-tester.test.ts
git commit -m @'
feat(desktop): drive the tester state machine inside the simulation worker

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 4: ストアを3モードへ広げる

**Files:**
- Modify: `apps/desktop/src/renderer/app/store-types.ts`
- Modify: `apps/desktop/src/renderer/app/store.ts`
- Modify: `apps/desktop/src/renderer/screens/Session.tsx`
- Modify: `apps/desktop/src/renderer/screens/ProblemList.tsx`
- Test: `apps/desktop/test/store-inspect.test.ts`

ストアの `problem` を `SupportedProblem` に広げ、C1/C2 に要る状態（テスター・解答・指摘・故障入りの回路・連動ハイライト・警告バナー）を足す。

| 状態 | 型 | 使う場所 |
|---|---|---|
| `problem` | `SupportedProblem \| undefined` | 3モード共通 |
| `tester` | `TesterState`（Plan 2A） | テスターパネル・3Dのプローブ |
| `nextProbe` | `ProbeSide` | 次に置くプローブ（§9.3） |
| `hazardBanner` | `HazardBanner \| undefined` | 警告バナー（§5.6 / §13） |
| `answers` | `InspectPartAnswer[]` | C1 マークシート |
| `checkPartId` | `string \| undefined` | C1 でいまチェック用ソケットに挿している部品 |
| `reports` | `FaultReport[]` | C2 指摘一覧 |
| `circuit` | `RepairCircuit \| undefined` | C2 の故障入り初期盤（判定に渡す） |
| `faultSeed` | `number \| undefined` | C2 の故障の種（起動時に決め、作業ファイルへ残す。§5.2） |
| `highlight` | `HighlightSelection` | C2 の回路図 ⇄ 3D 連動 |
| `judge` | `AnyJudgeResult \| undefined` | 3モードの結果画面 |

**C2の回路図ヒントについて:** モードBは級で決まる（`schematicPolicy()`。§8.4）が、C2は**課題の `hints.schematicVisible`** が決める（§9.2: 2級形式は回路図あり、1級形式はタイムチャートのみ）。Plan 2A のスキーマが `hints.schematicVisible === (grade === 2)` を強制しているので、級と食い違うことはない。

- [x] **Step 1: 失敗するテストを書く**

`apps/desktop/test/store-inspect.test.ts`:

```ts
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
} from '@ojt/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { isInspectJudge, useStore } from '../src/renderer/app/store.js';
import { NO_HIGHLIGHT } from '../src/renderer/app/store-types.js';

/**
 * 3モードを開けるストア（Plan 2B Task 4）。設計仕様 §12.1 / §9.1 / §9.2。
 */

const B = BUILTIN_ASSEMBLE_PROBLEMS[0];
const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
const C2_GRADE2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);
const C2_GRADE1 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 1);

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', problems: undefined });
});

describe('openProblem（§12.1）', () => {
  it('モードBは従来どおり盤を作ってセッション画面へ進む', () => {
    expect(B).toBeDefined();
    if (B === undefined) return;
    useStore.getState().openProblem(B);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.problem?.mode).toBe('assemble');
    expect(state.session?.allowedColors).toEqual(['青']);
    expect(state.circuit).toBeUndefined();
  });

  it('モードC1は空のチェック用盤で開き、線色パレットが空になる（配線しない。§9.1）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    useStore.getState().openProblem(C1);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.problem?.mode).toBe('inspect-parts');
    expect(state.session?.allowedColors).toEqual([]);
    expect(state.session?.mounted).toEqual({});
    expect(state.checkPartId).toBeUndefined();
    expect(state.answers).toEqual([]);
  });

  it('モードC2は故障を注入した初期盤で開き、線色パレットが白のみになる（§8.1 / §9.2）', () => {
    expect(C2_GRADE2).toBeDefined();
    if (C2_GRADE2 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.circuit).toBeDefined();
    expect(state.session?.allowedColors).toEqual(['白']);
    expect(state.wireColor).toBe('白');
    // 故障が2箇所入っている（§17.2 #4）
    expect(state.circuit?.applied.sites).toHaveLength(2);
    expect(state.reports).toEqual([]);
  });

  it('C2の回路図ヒントは課題の hints が決める（2級は出す・1級は出さない。§9.2）', () => {
    expect(C2_GRADE2).toBeDefined();
    expect(C2_GRADE1).toBeDefined();
    if (C2_GRADE2 === undefined || C2_GRADE1 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    expect(useStore.getState().schematicVisible).toBe(true);
    useStore.getState().openProblem(C2_GRADE1);
    expect(useStore.getState().schematicVisible).toBe(false);
  });
});

describe('テスターの状態（§9.3）', () => {
  it('初期は デジタル・つまみOFF・次は黒', () => {
    const state = useStore.getState();
    expect(state.tester.kind).toBe('digital');
    expect(state.tester.mode).toBe('off');
    expect(state.nextProbe).toBe('black');
  });

  it('プローブを置くと次に置く側が入れ替わる', () => {
    const store = useStore.getState();
    store.applyTester({ type: 'place-probe', probe: 'black', terminal: undefined });
    expect(useStore.getState().nextProbe).toBe('red');
    useStore.getState().applyTester({ type: 'place-probe', probe: 'red', terminal: undefined });
    expect(useStore.getState().nextProbe).toBe('black');
  });

  it('プローブの側を明示的に選べる', () => {
    useStore.getState().setNextProbe('red');
    expect(useStore.getState().nextProbe).toBe('red');
  });

  it('clearProbes はプローブだけ外し、つまみは残す（§9.1 部品の挿し替え）', () => {
    const store = useStore.getState();
    store.applyTester({ type: 'set-mode', mode: 'OHM' });
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
    useStore.getState().clearProbes();
    const after = useStore.getState();
    expect(after.tester.black).toBeUndefined();
    expect(after.tester.red).toBeUndefined();
    expect(after.tester.zeroAdjusted).toBe(false);
    expect(after.nextProbe).toBe('black');
    expect(after.tester.mode).toBe('OHM');
  });

  it('課題を開き直すとテスターは初期状態に戻る', () => {
    expect(B).toBeDefined();
    if (B === undefined) return;
    useStore.getState().applyTester({ type: 'set-mode', mode: 'OHM' });
    useStore.getState().openProblem(B);
    expect(useStore.getState().tester.mode).toBe('off');
  });
});

describe('マークシートと指摘', () => {
  it('同じ部品の解答は上書きされる（排他選択。§17.2 #5）', () => {
    const store = useStore.getState();
    store.setAnswer('p1', 'normal');
    store.setAnswer('p2', 'coil-open');
    store.setAnswer('p1', 'coil-layer-short');
    expect(useStore.getState().answers).toEqual([
      { partId: 'p1', answer: 'coil-layer-short' },
      { partId: 'p2', answer: 'coil-open' },
    ]);
  });

  it('指摘は追加と取り消しができる（§9.2）', () => {
    const store = useStore.getState();
    store.addReport({ target: { wireId: 'sw-001' }, kind: 'wire-open' });
    store.addReport({ target: { terminalId: 'CR1.13' }, kind: 'wire-missing' });
    expect(useStore.getState().reports).toHaveLength(2);
    useStore.getState().removeReport(0);
    expect(useStore.getState().reports).toEqual([
      { target: { terminalId: 'CR1.13' }, kind: 'wire-missing' },
    ]);
  });
});

describe('警告バナーとハイライト', () => {
  it('危険操作が届くとバナーに最後の1件が載る（§5.6 / §13）', () => {
    useStore.getState().applySnapshot({
      ...useStore.getState().snapshot,
      hazardDelta: [
        { type: 'hazard', kind: 'ohm-on-live', tMs: 100, detail: 'CHK.13' },
        { type: 'hazard', kind: 'range-exceeded', tMs: 120, detail: 'DCV 2.5V レンジ' },
      ],
    });
    const state = useStore.getState();
    expect(state.hazardBanner?.kind).toBe('range-exceeded');
    expect(state.hazards).toHaveLength(2);
    useStore.getState().dismissHazard();
    expect(useStore.getState().hazardBanner).toBeUndefined();
  });

  it('ハイライトは設定と解除ができる（§9.2）', () => {
    useStore
      .getState()
      .setHighlight({ cellIds: ['c1'], terminals: ['CR1.13'], wireIds: ['sw-001'] });
    expect(useStore.getState().highlight.cellIds).toEqual(['c1']);
    useStore.getState().setHighlight(NO_HIGHLIGHT);
    expect(useStore.getState().highlight).toEqual(NO_HIGHLIGHT);
  });
});

describe('isInspectJudge', () => {
  it('mode を持つ結果だけが点検系', () => {
    expect(
      isInspectJudge({
        mode: 'inspect-parts',
        passed: true,
        correctCount: 2,
        total: 2,
        scores: [],
        hazardCount: 0,
        hazardsByKind: {
          'ohm-on-live': 0,
          'range-exceeded': 0,
          'short-circuit-power-on': 0,
          'power-sequence-violation': 0,
          'over-wires-per-terminal': 0,
          overcurrent: 0,
        },
      }),
    ).toBe(true);
  });
});
```

- [x] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/store-inspect.test.ts
```

Expected: 失敗。`Property 'applyTester' does not exist on type 'AppState'`（`setAnswer` / `addReport` / `setHighlight` / `dismissHazard` / `isInspectJudge` / `NO_HIGHLIGHT` も同様）で `Test Files  1 failed (1)`。

- [x] **Step 3: `store-types.ts` に値型を足す**

`apps/desktop/src/renderer/app/store-types.ts` の先頭に import を足す:

```ts
import type { HazardKind } from '@ojt/circuit-sim';
```

同ファイルの末尾に次を足す:

```ts
/** テスターのプローブの側。§9.3 */
export type ProbeSide = 'black' | 'red';

/**
 * 警告バナーに出す危険操作1件。§5.6 / §13
 *
 * トースト（§8.2）とは別に**画面上部の帯**で出す。危険操作は「やってしまったこと」であり、
 * 右下に4秒出て消えるだけでは気づかないまま回数だけが増える（§16 Phase 2 受入基準④は
 * 「警告が出て結果に回数が記録される」ことを求める）。
 */
export interface HazardBanner {
  kind: HazardKind;
  detail: string;
  /** これを過ぎたら自動で畳む時刻（`Date.now()` と同じ基準の[ms]）。 */
  expiresAt: number;
}

/** 回路図 ⇄ 3D盤の連動ハイライト。§9.2 / §11.4 */
export interface HighlightSelection {
  /** 光らせる回路図要素のID。 */
  cellIds: readonly string[];
  /** 光らせる盤の端子（役割ID）。 */
  terminals: readonly string[];
  /** 光らせる電線のID。 */
  wireIds: readonly string[];
}

/** 何も光っていない状態。 */
export const NO_HIGHLIGHT: HighlightSelection = { cellIds: [], terminals: [], wireIds: [] };
```

`apps/desktop/src/renderer/session/tester.ts`（Task 2）の `export type ProbeSide = 'black' | 'red';` を次に置き換える（`ProbeSide` の定義をここ1箇所に一本化する。`tester.ts` は Task 2 で先に作られるが、以後は `store-types.ts` 側が正になる）:

```ts
export type { ProbeSide } from '../app/store-types.js';
```

- [x] **Step 4: `store.ts` の import を広げる**

`apps/desktop/src/renderer/app/store.ts` の先頭4ブロックの import を次に置き換える:

```ts
import { createSession, JIPM_BOARD, type BoardSession, type SocketId } from '@ojt/board-model';
import {
  applyTesterAction,
  createTesterState,
  partId,
  type ChatterEvent,
  type HazardEvent,
  type TerminalId,
  type TesterAction,
  type TesterState,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  buildInspectRepairCircuit,
  defaultChartSignals,
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  REPAIR_WIRE_COLOR,
  resolveCompareSignals,
  toSocketRoles,
  type AssembleProblem,
  type FaultReport,
  type InspectPartAnswer,
  type InspectPartsProblem,
  type JudgeInspectResult,
  type JudgeResult,
  type PartTruth,
  type RepairCircuit,
  type SupportedProblem,
  type TimeChartSignalSpec,
} from '@ojt/content';
import { create } from 'zustand';
import type { ProblemListPayload, WorkFile } from '../../shared/ipc.js';
import type { SimSnapshot } from '../../worker/protocol.js';
import { droppedTicksLog, JA } from '../i18n/ja.js';
import {
  emptyHistory,
  pushCommand,
  type CommandHistory,
  type SessionCommand,
} from '../session/commands.js';
import type { ToolMode } from '../session/interaction.js';
import { nextProbeAfter } from '../session/tester.js';
import {
  NO_HIGHLIGHT,
  type CameraPreset,
  type HazardBanner,
  type HighlightSelection,
  type LogLine,
  type ProbeSide,
  type Route,
  type Toast,
} from './store-types.js';
```

同ファイルの再エクスポート行を次に置き換える:

```ts
export {
  NO_HIGHLIGHT,
  type CameraPreset,
  type HazardBanner,
  type HighlightSelection,
  type LogLine,
  type ProbeSide,
  type Route,
  type Toast,
} from './store-types.js';
```

- [x] **Step 5: `store.ts` に定数・判別子・盤の作り分けを足す**

`schematicPolicy()` の**直後**に次を足す:

```ts
/** 警告バナーを自動で畳むまでの時間[ms]。§5.6 */
export const HAZARD_BANNER_TTL_MS = 6000;

/** 判定結果（モードB／C1／C2）。§8.3 / §9.1 / §9.2 */
export type AnyJudgeResult = JudgeResult | JudgeInspectResult;

/**
 * 点検系（C1/C2）の判定結果か。§9.1 / §9.2
 * 3モードとも `mode` を持つ（Plan 2A I-3）ので、`'assemble'` かどうかで判別する。
 */
export function isInspectJudge(result: AnyJudgeResult): result is JudgeInspectResult {
  return result.mode !== 'assemble';
}

/**
 * モードC1の初期盤。§9.1
 * チェック用ソケット（`S7` = `CHK`）の既設配線3本だけが載った盤で、部品はまだ挿さっていない。
 * 訓練者は配線しないので線色パレットは空、在庫も空にする（トレイの中身は課題の `parts` が決める。
 * Plan 2A 意図的な差分 #13）。
 */
export function checkSessionFor(problem: InspectPartsProblem): BoardSession {
  return createSession(JIPM_BOARD, {
    roles: toSocketRoles(problem.board.socketRoles),
    allowedColors: [],
    extraParts: [],
    inventory: [],
  });
}
```

- [x] **Step 6: `AppState` に新しい欄と操作を足す**

`AppState` の `problem: AssembleProblem | undefined;` を次に置き換える:

```ts
  problem: SupportedProblem | undefined;
```

`AppState` の `judge: JudgeResult | undefined;` を次に置き換える:

```ts
  judge: AnyJudgeResult | undefined;
```

`AppState` の `pendingWorkFile: WorkFile | undefined;` の**直後**に次を挿入する:

```ts
  /** テスターの状態（つまみ・レンジ・プローブ・0Ω調整）。Worker と同じリデューサで動かす。§9.3 */
  tester: TesterState;
  /** 次に置くプローブ（黒 → 赤 の順に巡る）。§9.3 */
  nextProbe: ProbeSide;
  /** 画面上部に出している危険操作の警告（期限切れで畳む）。§5.6 / §13 */
  hazardBanner: HazardBanner | undefined;
  /** モードC1のマークシートの解答。§9.1 */
  answers: InspectPartAnswer[];
  /** モードC1でいまチェック用ソケットに挿している部品のID。§9.1 */
  checkPartId: string | undefined;
  /** モードC2の指摘一覧。§9.2 */
  reports: FaultReport[];
  /** モードC2の故障入り初期盤（判定にそのまま渡す）。§9.2 */
  circuit: RepairCircuit | undefined;
  /**
   * モードC2の故障の種。§5.2
   * 起動時に決め（課題が持たなければ `Date.now()`）、作業ファイルへ残す。復元は種からの
   * 再抽選ではなく `resolvedFaults`（解決済みの故障そのもの）を使うので、判定には使わない
   * デバッグ用の記録である（Plan 2A I-4）。
   */
  faultSeed: number | undefined;
  /** 回路図 ⇄ 3D盤の連動ハイライト。§9.2 */
  highlight: HighlightSelection;
```

`AppState` の `setPendingWorkFile` の**直後**に次を挿入する:

```ts
  /** テスターを操作する（Worker へ送るのは呼び出し側の責務）。§9.3 */
  applyTester: (action: TesterAction) => void;
  /** 次に置くプローブを選ぶ。§9.3 */
  setNextProbe: (probe: ProbeSide) => void;
  /**
   * プローブを両方外して「次は黒」に戻す。§9.1 / §9.3
   * 盤を作り直したとき（C1の部品の挿し替え）に、Worker 側の `load` と足並みを揃えるために使う。
   */
  clearProbes: () => void;
  /** 警告バナーを畳む。§5.6 */
  dismissHazard: (nowMs?: number) => void;
  /** マークシートの解答を1件入れる（同じ部品は上書き）。§9.1 */
  setAnswer: (partId: string, answer: PartTruth) => void;
  /** チェック用ソケットに挿している部品を記録する。§9.1 */
  setCheckPart: (partId: string | undefined) => void;
  /** 指摘を1件足す。§9.2 */
  addReport: (report: FaultReport) => void;
  /** 指摘を1件取り消す。§9.2 */
  removeReport: (index: number) => void;
  /** モードC2の回路を差し替える（部品交換のとき）。§9.2 */
  setCircuit: (circuit: RepairCircuit) => void;
  /** 連動ハイライトを設定する。§9.2 */
  setHighlight: (selection: HighlightSelection) => void;
```

- [x] **Step 7: 初期値と `openProblem` を書き換える**

`useStore` の初期値のうち `pendingWorkFile: undefined,` の**直後**に次を挿入する:

```ts
  tester: createTesterState(),
  nextProbe: 'black',
  hazardBanner: undefined,
  answers: [],
  checkPartId: undefined,
  reports: [],
  circuit: undefined,
  faultSeed: undefined,
  highlight: NO_HIGHLIGHT,
```

`openProblem` を丸ごと次に置き換える:

```ts
  openProblem: (problem) => {
    /*
     * モードごとに違うのは「初期の盤」「線色パレット」「回路図ヒントの初期状態」の3つだけ。
     * それ以外（ライブ記録・ログ・計時・履歴の初期化）は3モードで共通なので、
     * 先に盤を作れるか確かめてから1回の `set()` でまとめて入れる。
     *
     * C2は故障を注入した盤を作る（`buildInspectRepairCircuit`。Plan 2A）。課題データの誤りで
     * 作れないことがあるので、その場合は**画面を移らずに**理由を出す（§13 #2）。
     */
    let session: BoardSession;
    let circuit: RepairCircuit | undefined;
    let faultSeed: number | undefined;
    let wireColor: WireColor = '青';
    let schematicVisible = false;
    if (isInspectRepairProblem(problem)) {
      /*
       * ランダム故障の課題は起動時に種を決め、あとで作業ファイルへ残す（§5.2）。
       * 明示 `faults` 配列の課題（内蔵C2 8題）には使われない（`resolveFaults()` が無視する）。
       */
      faultSeed = Date.now();
      const built = buildInspectRepairCircuit(problem, JIPM_BOARD, { seed: faultSeed });
      if (!built.ok) {
        get().toast(
          referenceErrorText(built.errors.map((e) => `${e.path}: ${e.message}`)),
          'error',
        );
        return;
      }
      circuit = built.value;
      session = built.value.session;
      wireColor = REPAIR_WIRE_COLOR;
      // C2の回路図の出し方は課題の hints が決める（2級は出す・1級は出さない）。§9.2
      schematicVisible = problem.hints.schematicVisible;
    } else if (isInspectPartsProblem(problem)) {
      // C1は配線しないので線色パレットは空（`checkSessionFor()` が決める）。§9.1
      session = checkSessionFor(problem);
    } else {
      session = sessionForProblem(problem);
      // 回路図ヒントの出し方は級だけで決まる（§8.4）
      schematicVisible = schematicPolicy(problem.grade).shown;
    }
    set({
      problem,
      session,
      circuit,
      history: emptyHistory(),
      route: 'session',
      mode: isAssembleProblem(problem) ? 'wire' : 'tester',
      wireColor,
      pendingTerminal: undefined,
      hoveredTerminal: undefined,
      selectedWire: undefined,
      selectedSocket: undefined,
      snapshot: EMPTY_SNAPSHOT,
      hazards: [],
      chatters: [],
      // C1は波形を比べないのでライブチャートも要らない。モードBとC2は同じ式で信号を決める
      chartSpecs: isInspectPartsProblem(problem)
        ? []
        : defaultChartSignals(
            resolveCompareSignals(problem.judge, problem.board.extraParts ?? []),
          ),
      liveTransitions: {},
      logLines: [],
      judge: undefined,
      judging: false,
      fatalError: undefined,
      webglLost: false,
      reportedDroppedTicks: 0,
      schematicVisible,
      startedAtMs: Date.now(),
      elapsedMs: 0,
      restoredHazardCount: 0,
      restartAttempts: 0,
      pendingWorkFile: undefined,
      tester: createTesterState(get().tester.kind),
      nextProbe: 'black',
      hazardBanner: undefined,
      answers: [],
      checkPartId: undefined,
      reports: [],
      faultSeed,
      highlight: NO_HIGHLIGHT,
    });
  },
```

`store.ts` の import に `referenceErrorText` を足す（`import { droppedTicksLog, JA } from '../i18n/ja.js';` を次に置き換える）:

```ts
import { droppedTicksLog, JA, referenceErrorText } from '../i18n/ja.js';
```

- [x] **Step 8: `applySnapshot` に警告バナーを足し、新しい操作を実装する**

`applySnapshot` の `set({ … })` を次に置き換える:

```ts
    const lastHazard = snapshot.hazardDelta.at(-1);
    set({
      snapshot,
      liveTransitions,
      hazards:
        snapshot.hazardDelta.length === 0
          ? state.hazards
          : [...state.hazards, ...snapshot.hazardDelta],
      chatters:
        snapshot.chatterDelta.length === 0
          ? state.chatters
          : [...state.chatters, ...snapshot.chatterDelta],
      // 危険操作は帯で知らせる（§5.6 / §13）。同じtickに複数出たら最後の1件を出す
      ...(lastHazard === undefined
        ? {}
        : {
            hazardBanner: {
              kind: lastHazard.kind,
              detail: lastHazard.detail,
              expiresAt: Date.now() + HAZARD_BANNER_TTL_MS,
            },
          }),
    });
```

`setPendingWorkFile` の**直後**に次の実装を挿入する:

```ts
  applyTester: (action) => {
    // 状態の更新は Plan 2A のリデューサ1本に任せる（Worker 側も同じ関数を通る）
    const tester = applyTesterAction(get().tester, action);
    set({
      tester,
      // 置いたら次の側へ巡る（§9.3 黒 → 赤）。外したときはその側を次にする
      ...(action.type === 'place-probe'
        ? {
            nextProbe:
              action.terminal === undefined ? action.probe : nextProbeAfter(action.probe),
          }
        : {}),
    });
  },
  setNextProbe: (nextProbe) => {
    set({ nextProbe });
  },
  clearProbes: () => {
    const tester = get().tester;
    // 0Ω調整はプローブを動かしたらやり直す（実機の作法。`applyTesterAction` と揃える）
    set({
      tester: { ...tester, black: undefined, red: undefined, zeroAdjusted: false },
      nextProbe: 'black',
    });
  },
  dismissHazard: (nowMs) => {
    const banner = get().hazardBanner;
    if (banner === undefined) return;
    // 引数なしなら無条件に畳む。時刻を渡されたら期限切れのときだけ畳む（間引きタイマ用）
    if (nowMs !== undefined && banner.expiresAt > nowMs) return;
    set({ hazardBanner: undefined });
  },
  setAnswer: (partId, answer) => {
    const answers = get().answers;
    const index = answers.findIndex((a) => a.partId === partId);
    // 排他選択なので同じ部品の行は上書きする（§17.2 #5）。並びは最初に答えた順のまま
    set({
      answers:
        index < 0
          ? [...answers, { partId, answer }]
          : answers.map((a, i) => (i === index ? { partId, answer } : a)),
    });
  },
  setCheckPart: (checkPartId) => {
    set({ checkPartId });
  },
  addReport: (report) => {
    set({ reports: [...get().reports, report] });
  },
  removeReport: (index) => {
    set({ reports: get().reports.filter((_, i) => i !== index) });
  },
  setCircuit: (circuit) => {
    set({ circuit });
  },
  setHighlight: (highlight) => {
    set({ highlight });
  },
```

`abandonSession()` の `set({ … })` に次の8行を足す（`restoredHazardCount: 0,` の直後）:

```ts
      circuit: undefined,
      faultSeed: undefined,
      answers: [],
      reports: [],
      checkPartId: undefined,
      highlight: NO_HIGHLIGHT,
      tester: createTesterState(get().tester.kind),
      nextProbe: 'black',
```

`resetSession()` と `restartSession()` も同じ理由（C1/C2 の状態を残したまま次のセッションへ持ち越さない）で C1/C2 の欄をリセットする必要がある。`resetSession()` の `set({ … })` に次の6行を足す（同じく `restoredHazardCount: 0,` の直後。**`circuit` と `faultSeed` はここでは変えない**。「もう一度」は同じ故障のまま再挑戦するため）:

```ts
      answers: [],
      reports: [],
      checkPartId: undefined,
      highlight: NO_HIGHLIGHT,
      tester: createTesterState(get().tester.kind),
      nextProbe: 'black',
```

`restartSession()` の `set({ … })` には `abandonSession()` と同じ8行（`circuit: undefined,` / `faultSeed: undefined,` を含む）を、同じく `restoredHazardCount: 0,` の直後に足す。

（`resetSession()` は「もう一度」（結果画面からの再挑戦・同じ課題を同じ盤で続ける）に使うので `circuit` は保つ。`restartSession()` と `abandonSession()` は課題を離れる／作り直す操作なので `circuit` も手放す。）

- [x] **Step 9: `Session.tsx` をモードBに絞る**

`apps/desktop/src/renderer/screens/Session.tsx` の `const problem = useStore((s) => s.problem);` を次に置き換える:

```ts
  /*
   * この画面はモードB専用（C1/C2 は `InspectPartsSession` / `InspectRepairSession`）。
   * ストアの `problem` は3モードの共用体なので、ここで絞り込んでから使う。
   * 振り分けは `SessionRoute` が行うので、絞り込みに漏れたら「課題が選ばれていません」になる。
   */
  const problem = useStore((s) =>
    s.problem !== undefined && isAssembleProblem(s.problem) ? s.problem : undefined,
  );
```

同ファイルの `import { JIPM_BOARD, socketPartId } from '@ojt/board-model';` の**直後**に次を足す:

```ts
import { isAssembleProblem } from '@ojt/content';
```

- [x] **Step 10: `ProblemList.tsx` の暫定ガードを外す**

`apps/desktop/src/renderer/screens/ProblemList.tsx` の Task 1 Step 7 で入れた暫定ガード（`if (problem.mode !== 'assemble') { … }` の4行）を削除し、`openProblem(problem);` だけに戻す。

- [x] **Step 11: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/store-inspect.test.ts test/store.test.ts test/session.test.tsx --no-file-parallelism
```

Expected: `Test Files  3 passed (3)`。`store-inspect` 14件と既存のストア・セッションのテストが通る。

- [x] **Step 12: 型検査を通す**

```powershell
pnpm --filter @ojt/desktop typecheck
```

Expected: 無出力。

- [x] **Step 13: コミットする**

```powershell
git add apps/desktop/src/renderer/app/store.ts apps/desktop/src/renderer/app/store-types.ts apps/desktop/src/renderer/screens/Session.tsx apps/desktop/src/renderer/screens/ProblemList.tsx apps/desktop/test/store-inspect.test.ts
git commit -m @'
feat(desktop): hold tester, answers, reports and fault circuit in the store

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 5: テスターパネル（デジタル）と文言

**Files:**
- Create: `apps/desktop/src/renderer/panels/TesterPanel.tsx`
- Create: `apps/desktop/src/renderer/panels/tester.module.css`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/tester-panel.test.tsx`

§9.3 のテスターUI（右パネル）を作る。つまみ5位置・種別切替・レンジ・プローブ表示・0Ω調整・表示器。アナログの針は Task 6 で足す。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| つまみ | `OFF / DCV / ACV / Ω / 導通` の5ボタン（`aria-pressed`） | §9.3 デジタル欄 |
| レンジ | デジタルは**オートレンジ**なのでレンジ欄を出さない。アナログのときだけ出す | §9.3「デジタル … オートレンジ」 |
| レンジの中身 | DCV/ACV は `voltRangesFor(mode)`、Ω は `ANALOG_OHM_RANGES`（`×1 / ×10 / ×1k`） | §9.3 |
| 0Ω調整 | Ω／導通レンジのアナログのときだけ押せる。押すと `zeroAdjusted` が立ち、レンジを変えると落ちる | §9.3 |
| プローブ | 黒／赤のボタンが「いま何処に置いてあるか」を出し、押すと**次に置く側**になる。置いてあるときは「外す」も出す | §9.3 ＋ Task 2 の操作モデル |
| 表示器 | `snapshot.tester.display` をそのまま出す（整形は Plan 2A が済ませている） | §9.3 |
| 再描画 | パネルは `snapshot.tester` **だけ**を購読する専用の小さなコンポーネント（`TesterReadout`）に分ける | §15（`LivePanel` / `SoundEffects` と同じ方針） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/tester-panel.test.tsx`:

```tsx
import { toTerminalId } from '@ojt/circuit-sim';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { TesterPanel } from '../src/renderer/panels/TesterPanel.js';

/**
 * テスターパネル（Plan 2B Task 5）。設計仕様 §9.3。
 */

const sent: unknown[] = [];

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    send: (command: unknown) => {
      sent.push(command);
    },
  },
}));

beforeEach(() => {
  sent.length = 0;
  useStore.setState({
    tester: {
      kind: 'digital',
      mode: 'off',
      voltRange: 50,
      ohmRange: 10,
      black: undefined,
      red: undefined,
      zeroAdjusted: false,
      needleDeg: 0,
      rangeExceededReported: false,
    },
    nextProbe: 'black',
    snapshot: { ...useStore.getState().snapshot },
  });
});

afterEach(() => {
  cleanup();
});

describe('つまみ（§9.3）', () => {
  it('5位置を並べ、押すとストアと Worker の両方へ届く', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'DCV' }));
    expect(useStore.getState().tester.mode).toBe('DCV');
    expect(sent).toContainEqual({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    for (const label of ['OFF', 'DCV', 'ACV', 'Ω', '導通']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('選んでいるつまみに aria-pressed が付く', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    expect(screen.getByRole('button', { name: 'Ω' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'DCV' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('種別とレンジ（§9.3）', () => {
  it('デジタルはオートレンジなのでレンジ欄を出さない', () => {
    render(<TesterPanel />);
    expect(screen.queryByTestId('tester-ranges')).toBeNull();
    expect(screen.getByTestId('tester-autorange')).toBeTruthy();
  });

  it('アナログのDCVは 2.5 / 10 / 50 / 250 を出す', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'DCV' }));
    const ranges = screen.getByTestId('tester-ranges');
    expect(ranges.textContent).toContain('2.5');
    expect(ranges.textContent).toContain('250');
  });

  it('アナログのΩは ×1 / ×10 / ×1k を出し、0Ω調整が押せる', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    expect(screen.getByTestId('tester-ranges').textContent).toContain('×1k');
    const zero = screen.getByRole('button', { name: '0Ω ADJ' });
    expect(zero.hasAttribute('disabled')).toBe(false);
    fireEvent.click(zero);
    expect(useStore.getState().tester.zeroAdjusted).toBe(true);
    expect(sent).toContainEqual({ type: 'tester', action: { type: 'zero-adjust' } });
  });

  it('0Ω調整はレンジを変えるとやり直しになる（§9.3）', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    fireEvent.click(screen.getByRole('button', { name: '0Ω ADJ' }));
    fireEvent.click(screen.getByRole('button', { name: '×1k' }));
    expect(useStore.getState().tester.zeroAdjusted).toBe(false);
  });

  it('DCVでは0Ω調整を押せない', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'DCV' }));
    expect(screen.getByRole('button', { name: '0Ω ADJ' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('プローブ（§9.3）', () => {
  it('未配置なら「未配置」と出し、押すと次に置く側になる', () => {
    render(<TesterPanel />);
    expect(screen.getByTestId('probe-red').textContent).toContain('未配置');
    fireEvent.click(screen.getByTestId('probe-red'));
    expect(useStore.getState().nextProbe).toBe('red');
  });

  it('配置済みなら端子IDを出し、「外す」で外せる', () => {
    useStore.setState({
      tester: { ...useStore.getState().tester, black: toTerminalId('CHK.13') },
    });
    render(<TesterPanel />);
    expect(screen.getByTestId('probe-black').textContent).toContain('CHK.13');
    fireEvent.click(screen.getByTestId('lift-black'));
    expect(useStore.getState().tester.black).toBeUndefined();
    expect(sent).toContainEqual({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: undefined },
    });
  });
});

describe('表示器（§9.3）', () => {
  it('Worker の読値をそのまま出す', () => {
    useStore.setState({
      snapshot: {
        ...useStore.getState().snapshot,
        tester: {
          kind: 'digital',
          mode: 'OHM',
          value: 650,
          display: '650.0 Ω',
          targetDeg: 0,
          needleDeg: 0,
          overRange: false,
          live: false,
          conductive: false,
        },
      },
    });
    render(<TesterPanel />);
    expect(screen.getByTestId('tester-readout').textContent).toBe('650.0 Ω');
  });

  it('通電中のΩ測定は測定不能の理由を添える（§5.6 #1）', () => {
    useStore.setState({
      snapshot: {
        ...useStore.getState().snapshot,
        tester: {
          kind: 'digital',
          mode: 'OHM',
          value: Number.NaN,
          display: '----',
          targetDeg: 0,
          needleDeg: 0,
          overRange: false,
          live: true,
          conductive: false,
        },
      },
    });
    render(<TesterPanel />);
    expect(screen.getByTestId('tester-readout').textContent).toBe('----');
    expect(screen.getByTestId('tester-live-note')).toBeTruthy();
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/tester-panel.test.tsx
```

Expected: 失敗。`Failed to resolve import "../src/renderer/panels/TesterPanel.js"` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `i18n/ja.ts` にテスターの文言を足す**

`apps/desktop/src/renderer/i18n/ja.ts` の `session: { … },` の**直後**に次を挿入する:

```ts
  /** テスターUI。§9.3 */
  tester: {
    title: 'テスター',
    kindDigital: 'デジタル',
    kindAnalog: 'アナログ',
    modeOff: 'OFF',
    modeDcv: 'DCV',
    modeAcv: 'ACV',
    modeOhm: 'Ω',
    modeCont: '導通',
    range: 'レンジ',
    /** デジタルはレンジつまみを持たない（§9.3）。 */
    autoRange: 'オートレンジ',
    zeroAdjust: '0Ω ADJ',
    /** 0Ω調整が済んでいるか。§9.3 */
    zeroDone: '調整済',
    zeroTodo: '未調整（+5%）',
    probeBlack: '黒プローブ',
    probeRed: '赤プローブ',
    probeNone: '未配置',
    /** プローブを外す。 */
    lift: '外す',
    /** 次に置くプローブ。§9.3 */
    next: '次に置く',
    /** 3D盤の端子をクリックして置くことの案内。§9.3 */
    placeHint: '3D盤の端子をクリックするとプローブを置きます（黒 → 赤 の順）',
    /** 通電中にΩ／導通を当てたので測れない。§5.6 #1 */
    liveNote: '通電中はΩ／導通を測れません（無通電にしてから測ります）',
    /** 振り切れ。§5.6 #2 */
    overRangeNote: 'レンジを超えています（上のレンジへ切り替えます）',
    /** 導通ブザーが鳴っている。§5.5 */
    buzzing: '導通',
    /** テスターモードのツールバー表示。§8.1 */
    toolMode: 'テスター',
  },
```

同ファイルの `JA` の**外側**、`gradeLabel()` の直前に次を足す:

```ts
/** アナログのΩレンジの表示（`×1` / `×10` / `×1k`）。§9.3 */
export function ohmRangeLabel(range: number): string {
  return range >= 1000 ? `×${String(range / 1000)}k` : `×${String(range)}`;
}

/** アナログの電圧レンジの表示（`2.5V` / `250V`）。§9.3 */
export function voltRangeLabel(range: number): string {
  return `${String(range)}V`;
}

/** プローブの配置状況（`黒プローブ: CHK.13`）。§9.3 */
export function probeLabel(side: ProbeSide, terminal: string | undefined): string {
  const name = side === 'black' ? JA.tester.probeBlack : JA.tester.probeRed;
  return `${name}: ${terminal ?? JA.tester.probeNone}`;
}
```

`apps/desktop/src/renderer/i18n/ja.ts` の先頭の import に次を足す（`ProbeSide` の定義は `store-types.ts` に一本化している。Task 4 I4）:

```ts
import type { ProbeSide } from '../app/store-types.js';
```

- [ ] **Step 4: `panels/tester.module.css` を作る**

`apps/desktop/src/renderer/panels/tester.module.css`:

```css
/* テスター・マークシート・指摘パネル。設計仕様 §9.1 / §9.2 / §9.3。 */

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 8px 10px;
  margin-bottom: 8px;
}

.title {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  margin: 0 0 6px;
}

/* 表示器は等幅・右詰めの数字（実機の液晶に合わせる） */
.readout {
  background: #101c14;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: #7dffb2;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  padding: 6px 10px;
  text-align: right;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.label {
  color: var(--muted);
  font-size: 11px;
  min-width: 56px;
}

.note {
  color: var(--warn);
  font-size: 11px;
  margin: 4px 0 0;
}

.probeRow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

/* プローブのボタンは実物の色（黒／赤）で見分ける */
.probeBlack {
  border-left: 6px solid #1a1a1a;
  flex: 1;
  text-align: left;
}

.probeRed {
  border-left: 6px solid #d64545;
  flex: 1;
  text-align: left;
}

.hint {
  color: var(--muted);
  font-size: 11px;
  margin: 6px 0 0;
}

/* アナログ計器の枠 */
.meter {
  background: #f4f1e6;
  border: 1px solid var(--line);
  border-radius: 4px;
  width: 100%;
  height: auto;
}

/* マークシート（§9.1） */
.markTable {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
}

.markTable th,
.markTable td {
  border-bottom: 1px solid var(--line);
  padding: 3px 4px;
  text-align: left;
}

.markTable th {
  color: var(--muted);
  font-weight: 400;
}

.trayRow {
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--line);
  padding: 4px 0;
}

.trayName {
  flex: 1;
  font-size: 13px;
}

/* いまチェック用ソケットに挿している部品 */
.trayActive {
  background: rgba(57, 208, 255, 0.12);
}

/* 指摘一覧（§9.2） */
.reportRow {
  display: flex;
  align-items: baseline;
  gap: 6px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  padding: 3px 0;
}

.reportTarget {
  flex: 1;
  font-family: 'Consolas', 'Courier New', monospace;
}

/* 種別ポップオーバー（3D上のクリック直後に出す） */
.popover {
  background: var(--panel-2);
  border: 1px solid var(--accent);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
}

.popoverTitle {
  color: var(--muted);
  font-size: 11px;
}

/* 折りたたみヘルプ（判定表。§9.1） */
.help summary {
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
}

.helpTable {
  border-collapse: collapse;
  font-size: 11px;
  margin-top: 6px;
  width: 100%;
}

.helpTable th,
.helpTable td {
  border-bottom: 1px solid var(--line);
  padding: 3px 4px;
  text-align: left;
  vertical-align: top;
}
```

- [ ] **Step 5: `panels/TesterPanel.tsx` を作る**

`apps/desktop/src/renderer/panels/TesterPanel.tsx`:

```tsx
import {
  ANALOG_OHM_RANGES,
  voltRangesFor,
  type TesterAction,
  type TesterKind,
  type TesterMode,
} from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { useStore, type ProbeSide } from '../app/store.js';
import { JA, ohmRangeLabel, probeLabel, voltRangeLabel } from '../i18n/ja.js';
import { bridge } from '../session/worker-bridge.js';
import styles from './tester.module.css';

/**
 * テスターパネル。設計仕様 §9.3。
 *
 * 操作は**ストアと Worker の両方**へ流す。ストアの `tester` は画面（つまみの位置・プローブの
 * 端子）を描くため、Worker の `tester` は毎tick測って読値を返すために要る。どちらも
 * Plan 2A の `applyTesterAction()` を通るので、2つの複製がずれることはない。
 *
 * 読値は `snapshot.tester` に約30fpsで届く。パネル全体でそれを購読すると、つまみもレンジも
 * 毎秒30回描き直されるので、**表示器だけ**を専用の小さなコンポーネント（`TesterReadout`）に
 * 切り出す（`LivePanel` / `SoundEffects` と同じ方針。§15）。
 */

/** つまみの位置と表示名。§9.3 */
const MODES: ReadonlyArray<{ mode: TesterMode; label: string }> = [
  { mode: 'off', label: JA.tester.modeOff },
  { mode: 'DCV', label: JA.tester.modeDcv },
  { mode: 'ACV', label: JA.tester.modeAcv },
  { mode: 'OHM', label: JA.tester.modeOhm },
  { mode: 'CONT', label: JA.tester.modeCont },
];

/** 種別の切替。§9.3 */
const KINDS: ReadonlyArray<{ kind: TesterKind; label: string }> = [
  { kind: 'digital', label: JA.tester.kindDigital },
  { kind: 'analog', label: JA.tester.kindAnalog },
];

/** ストアと Worker の両方へテスター操作を流す。 */
export function dispatchTester(action: TesterAction): void {
  useStore.getState().applyTester(action);
  bridge.send({ type: 'tester', action });
}

/**
 * 表示器（読値）。`snapshot.tester` だけを購読する。§15
 * アナログの針は `AnalogMeter`（Task 6）が描く。ここは文字だけを出す。
 */
export function TesterReadout(): JSX.Element {
  const reading = useStore((s) => s.snapshot.tester);
  return (
    <>
      <div className={styles.readout} data-testid="tester-readout" role="status" aria-live="off">
        {reading.display}
      </div>
      {reading.live ? (
        <p className={styles.note} data-testid="tester-live-note">
          {JA.tester.liveNote}
        </p>
      ) : null}
      {reading.overRange ? (
        <p className={styles.note} data-testid="tester-over-note">
          {JA.tester.overRangeNote}
        </p>
      ) : null}
      {reading.conductive ? (
        <p className={styles.hint} data-testid="tester-buzz">
          {JA.tester.buzzing}
        </p>
      ) : null}
    </>
  );
}

/** プローブ1本ぶんの行。 */
function ProbeRow({ side }: { side: ProbeSide }): JSX.Element {
  const terminal = useStore((s) => (side === 'black' ? s.tester.black : s.tester.red));
  const next = useStore((s) => s.nextProbe);
  return (
    <div className={styles.probeRow}>
      <button
        type="button"
        className={side === 'black' ? styles.probeBlack : styles.probeRed}
        data-testid={`probe-${side}`}
        aria-pressed={next === side}
        onClick={() => {
          useStore.getState().setNextProbe(side);
        }}
      >
        {probeLabel(side, terminal)}
      </button>
      {terminal === undefined ? null : (
        <button
          type="button"
          data-testid={`lift-${side}`}
          onClick={() => {
            dispatchTester({ type: 'place-probe', probe: side, terminal: undefined });
          }}
        >
          {JA.tester.lift}
        </button>
      )}
    </div>
  );
}

/** テスターパネル本体。 */
export function TesterPanel({ children }: { children?: JSX.Element }): JSX.Element {
  const kind = useStore((s) => s.tester.kind);
  const mode = useStore((s) => s.tester.mode);
  const voltRange = useStore((s) => s.tester.voltRange);
  const ohmRange = useStore((s) => s.tester.ohmRange);
  const zeroAdjusted = useStore((s) => s.tester.zeroAdjusted);
  const isOhmSide = mode === 'OHM' || mode === 'CONT';
  // 0Ω調整はアナログのΩ／導通レンジでしか意味が無い（デジタルは自動で補正する）。§9.3
  const canZero = kind === 'analog' && isOhmSide;

  return (
    <section className={styles.panel} data-testid="tester-panel">
      <h2 className={styles.title}>{JA.tester.title}</h2>
      <TesterReadout />
      {children}
      <div className={styles.row}>
        {KINDS.map((item) => (
          <button
            key={item.kind}
            type="button"
            aria-pressed={kind === item.kind}
            onClick={() => {
              dispatchTester({ type: 'set-kind', kind: item.kind });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.row} data-testid="tester-modes">
        {MODES.map((item) => (
          <button
            key={item.mode}
            type="button"
            aria-pressed={mode === item.mode}
            onClick={() => {
              dispatchTester({ type: 'set-mode', mode: item.mode });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {kind === 'digital' ? (
        <p className={styles.hint} data-testid="tester-autorange">
          {JA.tester.autoRange}
        </p>
      ) : mode === 'off' ? null : (
        <div className={styles.row} data-testid="tester-ranges">
          <span className={styles.label}>{JA.tester.range}</span>
          {isOhmSide
            ? ANALOG_OHM_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={ohmRange === range}
                  onClick={() => {
                    dispatchTester({ type: 'set-ohm-range', range });
                  }}
                >
                  {ohmRangeLabel(range)}
                </button>
              ))
            : voltRangesFor(mode).map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={voltRange === range}
                  onClick={() => {
                    dispatchTester({ type: 'set-volt-range', range });
                  }}
                >
                  {voltRangeLabel(range)}
                </button>
              ))}
        </div>
      )}

      <div className={styles.row}>
        <button
          type="button"
          disabled={!canZero}
          onClick={() => {
            dispatchTester({ type: 'zero-adjust' });
          }}
        >
          {JA.tester.zeroAdjust}
        </button>
        {canZero ? (
          <span className={styles.label} data-testid="zero-state">
            {zeroAdjusted ? JA.tester.zeroDone : JA.tester.zeroTodo}
          </span>
        ) : null}
      </div>

      <ProbeRow side="black" />
      <ProbeRow side="red" />
      <p className={styles.hint}>{JA.tester.placeHint}</p>
    </section>
  );
}
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/tester-panel.test.tsx
```

Expected: `Test Files  1 passed (1)` / `Tests  11 passed (11)`。

- [ ] **Step 7: コミットする**

```powershell
git add apps/desktop/src/renderer/panels/TesterPanel.tsx apps/desktop/src/renderer/panels/tester.module.css apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test/tester-panel.test.tsx
git commit -m @'
feat(desktop): add the digital tester panel with knob, probes and readout

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 6: アナログ計器（SVGの針と目盛）

**Files:**
- Create: `apps/desktop/src/renderer/panels/AnalogMeter.tsx`
- Modify: `apps/desktop/src/renderer/panels/TesterPanel.tsx`
- Test: `apps/desktop/test/analog-meter.test.tsx`

§9.3 のアナログ表示を作る。針の角度は Worker が積分した `snapshot.tester.needleDeg` をそのまま使い、目盛は Plan 2A の `voltNeedleDeg()` / `ohmNeedleDeg()` から引く（同じ式で描くので針と目盛がずれない）。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| 針の可動範囲 | `0`（左端）〜 `NEEDLE_FULL_SCALE_DEG = 90`（右端）を、SVG 上では真上を中心に左右45度ずつの扇に写す | 実機の可動範囲は資料に無い（Plan 2A 意図的な差分 #10）。扇の**見かけの角度**は本アプリの意匠であり、`needleDeg` の値そのものは 2A の定義のまま |
| 電圧目盛 | 0 から レンジ値まで**等間隔5本**（線形。§9.3） | §9.3「目盛に対して線形」 |
| Ω目盛 | 右端が 0Ω、左端が ∞。刻みは `[0, 2, 5, 10, 20, 50, 100, 200, 1000] × 倍率` と `∞` | §9.3「中央目盛方式（非線形）。右端が0Ω、左端が∞」 |
| 導通レンジ | Ωと同じ目盛を使う（実機も同じ目盛板） | §9.3 |
| 純関数 | `needleTip()` / `voltScaleTicks()` / `ohmScaleTicks()` を export して単体テストする | §14.2 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/analog-meter.test.tsx`:

```tsx
import { NEEDLE_FULL_SCALE_DEG } from '@ojt/circuit-sim';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import {
  AnalogMeter,
  needleTip,
  ohmScaleTicks,
  voltScaleTicks,
} from '../src/renderer/panels/AnalogMeter.js';

/**
 * アナログ計器（Plan 2B Task 6）。設計仕様 §9.3。
 */

afterEach(() => {
  cleanup();
});

describe('needleTip（扇の写像）', () => {
  it('0度は左上、フルスケールは右上へ向く', () => {
    const left = needleTip(0, 100, 100, 50);
    const right = needleTip(NEEDLE_FULL_SCALE_DEG, 100, 100, 50);
    expect(left.x).toBeLessThan(100);
    expect(right.x).toBeGreaterThan(100);
    // SVG は y が下向きなので、上を向く針は y が中心より小さい
    expect(left.y).toBeLessThan(100);
    expect(right.y).toBeLessThan(100);
    // 左右対称
    expect(100 - left.x).toBeCloseTo(right.x - 100, 6);
    expect(left.y).toBeCloseTo(right.y, 6);
  });

  it('真ん中（45度）は真上を向く', () => {
    const middle = needleTip(NEEDLE_FULL_SCALE_DEG / 2, 100, 100, 50);
    expect(middle.x).toBeCloseTo(100, 6);
    expect(middle.y).toBeCloseTo(50, 6);
  });

  it('可動範囲の外は端で止まる', () => {
    expect(needleTip(-30, 100, 100, 50)).toEqual(needleTip(0, 100, 100, 50));
    expect(needleTip(200, 100, 100, 50)).toEqual(needleTip(NEEDLE_FULL_SCALE_DEG, 100, 100, 50));
  });
});

describe('voltScaleTicks（線形。§9.3）', () => {
  it('0 からレンジ値まで等間隔に5本並ぶ', () => {
    const ticks = voltScaleTicks(10);
    expect(ticks.map((t) => t.label)).toEqual(['0', '2.5', '5', '7.5', '10']);
    expect(ticks.map((t) => t.deg)).toEqual([0, 22.5, 45, 67.5, 90]);
  });

  it('2.5V レンジでも読める刻みになる', () => {
    expect(voltScaleTicks(2.5).map((t) => t.label)).toEqual(['0', '0.63', '1.3', '1.9', '2.5']);
  });
});

describe('ohmScaleTicks（中央目盛方式。§9.3）', () => {
  it('右端が0Ω・左端が∞になる', () => {
    const ticks = ohmScaleTicks(10);
    expect(ticks[0]?.label).toBe('0');
    expect(ticks[0]?.deg).toBe(NEEDLE_FULL_SCALE_DEG);
    expect(ticks.at(-1)?.label).toBe('∞');
    expect(ticks.at(-1)?.deg).toBe(0);
  });

  it('×10 レンジの 120Ω（内部抵抗と同値）が真ん中に来る', () => {
    const ticks = ohmScaleTicks(10);
    // 120Ω は刻みに無いので、式そのもので確かめる: 90 × 120/(120+120) = 45
    const hundred = ticks.find((t) => t.label === '100');
    const twoHundred = ticks.find((t) => t.label === '200');
    expect(hundred?.deg).toBeGreaterThan(45);
    expect(twoHundred?.deg).toBeLessThan(45);
  });

  it('倍率が変わると目盛の値も倍率ぶん動く', () => {
    expect(ohmScaleTicks(1).map((t) => t.label)).toContain('20');
    expect(ohmScaleTicks(1000).map((t) => t.label)).toContain('20000');
  });
});

describe('AnalogMeter の描画', () => {
  beforeEach(() => {
    useStore.setState({
      tester: { ...useStore.getState().tester, kind: 'analog', mode: 'DCV', voltRange: 50 },
      snapshot: {
        ...useStore.getState().snapshot,
        tester: {
          kind: 'analog',
          mode: 'DCV',
          value: 24,
          display: '24.00 V',
          targetDeg: 43.2,
          needleDeg: 43.2,
          overRange: false,
          live: false,
          conductive: false,
        },
      },
    });
  });

  it('針と目盛を描く', () => {
    render(<AnalogMeter />);
    const svg = screen.getByTestId('analog-meter');
    expect(svg.querySelector('[data-testid="analog-needle"]')).toBeTruthy();
    expect(svg.textContent).toContain('50');
  });

  it('針の角度を data 属性で出す（E2Eとテストが読めるように）', () => {
    render(<AnalogMeter />);
    expect(screen.getByTestId('analog-needle').getAttribute('data-deg')).toBe('43.20');
  });

  it('Ωレンジでは倍率つきの目盛になる', () => {
    useStore.setState({
      tester: { ...useStore.getState().tester, mode: 'OHM', ohmRange: 1000 },
    });
    render(<AnalogMeter />);
    expect(screen.getByTestId('analog-meter').textContent).toContain('∞');
    expect(screen.getByTestId('analog-meter').textContent).toContain('20000');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/analog-meter.test.tsx
```

Expected: 失敗。`Failed to resolve import "../src/renderer/panels/AnalogMeter.js"` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `panels/AnalogMeter.tsx` を作る**

`apps/desktop/src/renderer/panels/AnalogMeter.tsx`:

```tsx
import {
  NEEDLE_FULL_SCALE_DEG,
  ohmNeedleDeg,
  type AnalogOhmRange,
} from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import styles from './tester.module.css';

/**
 * アナログ計器の目盛板と針。設計仕様 §9.3。
 *
 * 針の角度（`needleDeg`）は Worker が時定数100msで積分した値をそのまま使う（Plan 2A の
 * `stepTester()`）。ここは**写像と描画だけ**を行い、計器の物理には手を入れない。
 *
 * 目盛は針とまったく同じ式（`ohmNeedleDeg()` / 線形比例）から角度を出すので、
 * レンジを変えても針と目盛がずれない。
 */

/** 目盛板の大きさ（論理単位。`viewBox` の座標）。 */
const WIDTH = 200;
const HEIGHT = 108;
/** 針の回転中心。 */
const PIVOT_X = WIDTH / 2;
const PIVOT_Y = 98;
/** 針の長さと、目盛の内側・外側の半径。 */
const NEEDLE_R = 78;
const TICK_OUTER_R = 82;
const TICK_INNER_R = 72;
const LABEL_R = 62;

/** 目盛1本。 */
export interface ScaleTick {
  /** 針の角度[度]（0＝左端、`NEEDLE_FULL_SCALE_DEG`＝右端）。 */
  deg: number;
  /** 目盛の数字。 */
  label: string;
}

/**
 * 針の角度[度]を目盛板の座標へ写す。
 * 可動範囲 `0`〜`NEEDLE_FULL_SCALE_DEG` を、真上を中心に左右45度ずつの扇に割り当てる
 * （左端＝0、真上＝半分、右端＝フルスケール）。SVG は y が下向きなので符号を反転する。
 */
export function needleTip(
  deg: number,
  cx: number,
  cy: number,
  r: number,
): { x: number; y: number } {
  const clamped = Math.min(Math.max(deg, 0), NEEDLE_FULL_SCALE_DEG);
  // 数学の慣習（+x から反時計回り）で 135度（左上）→ 45度（右上）へ向かう
  const theta = ((135 - clamped) * Math.PI) / 180;
  return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) };
}

/** 数字を目盛に載る短さへ丸める（有効数字2桁。整数はそのまま）。 */
function scaleNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(2)));
}

/** 電圧目盛（線形。0 からレンジ値まで等間隔に5本）。§9.3 */
export function voltScaleTicks(range: number): ScaleTick[] {
  const steps = 4;
  const out: ScaleTick[] = [];
  for (let i = 0; i <= steps; i += 1) {
    out.push({
      deg: (NEEDLE_FULL_SCALE_DEG * i) / steps,
      label: scaleNumber((range * i) / steps),
    });
  }
  return out;
}

/** Ω目盛の刻み（倍率×1のときの値）。実機の目盛板と同じ「右が詰まる」並びにする。§9.3 */
const OHM_SCALE_BASE: readonly number[] = [0, 2, 5, 10, 20, 50, 100, 200, 1000];

/**
 * Ω目盛（中央目盛方式。右端が0Ω・左端が∞）。§9.3
 * 角度は針と同じ `ohmNeedleDeg()` から引くので、内部抵抗（×1で12Ω・×10で120Ω・×1kで12kΩ）が
 * そのまま目盛の詰まり方に出る。
 */
export function ohmScaleTicks(range: AnalogOhmRange): ScaleTick[] {
  const out: ScaleTick[] = OHM_SCALE_BASE.map((base) => ({
    deg: ohmNeedleDeg(base * range, range),
    label: scaleNumber(base * range),
  }));
  // 左端（0度）は無限大。`ohmNeedleDeg(Infinity, …)` は 0 を返さない（有限性を要求する）ので直に置く
  out.push({ deg: 0, label: '∞' });
  return out;
}

/** 目盛1本ぶんの線と数字。 */
function Tick({ tick }: { tick: ScaleTick }): JSX.Element {
  const outer = needleTip(tick.deg, PIVOT_X, PIVOT_Y, TICK_OUTER_R);
  const inner = needleTip(tick.deg, PIVOT_X, PIVOT_Y, TICK_INNER_R);
  const label = needleTip(tick.deg, PIVOT_X, PIVOT_Y, LABEL_R);
  return (
    <g>
      <line x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke="#23262B" strokeWidth={1} />
      <text
        x={label.x}
        y={label.y}
        fill="#23262B"
        fontSize={7}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {tick.label}
      </text>
    </g>
  );
}

/** アナログ計器。 */
export function AnalogMeter(): JSX.Element {
  const mode = useStore((s) => s.tester.mode);
  const voltRange = useStore((s) => s.tester.voltRange);
  const ohmRange = useStore((s) => s.tester.ohmRange);
  const needleDeg = useStore((s) => s.snapshot.tester.needleDeg);
  const ticks =
    mode === 'OHM' || mode === 'CONT' ? ohmScaleTicks(ohmRange) : voltScaleTicks(voltRange);
  const tip = needleTip(needleDeg, PIVOT_X, PIVOT_Y, NEEDLE_R);
  const arcStart = needleTip(0, PIVOT_X, PIVOT_Y, TICK_OUTER_R);
  const arcEnd = needleTip(NEEDLE_FULL_SCALE_DEG, PIVOT_X, PIVOT_Y, TICK_OUTER_R);
  return (
    <svg
      className={styles.meter}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={JA_METER_LABEL}
      data-testid="analog-meter"
    >
      <path
        d={`M ${arcStart.x} ${arcStart.y} A ${TICK_OUTER_R} ${TICK_OUTER_R} 0 0 1 ${arcEnd.x} ${arcEnd.y}`}
        fill="none"
        stroke="#23262B"
        strokeWidth={1.2}
      />
      {ticks.map((tick) => (
        <Tick key={`${tick.label}-${String(tick.deg)}`} tick={tick} />
      ))}
      <line
        data-testid="analog-needle"
        data-deg={needleDeg.toFixed(2)}
        x1={PIVOT_X}
        y1={PIVOT_Y}
        x2={tip.x}
        y2={tip.y}
        stroke="#B4271F"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <circle cx={PIVOT_X} cy={PIVOT_Y} r={3.2} fill="#23262B" />
    </svg>
  );
}

/** 支援技術に読ませる計器の名前（文言は `ja.ts` が持つ。§15）。 */
const JA_METER_LABEL = 'アナログテスターの目盛';
```

`JA_METER_LABEL` は §15 の「全文言を1箇所に集約」に反するので、次の Step で `ja.ts` へ移す。

- [ ] **Step 4: 文言を `ja.ts` へ移す**

`apps/desktop/src/renderer/i18n/ja.ts` の `tester:` ブロックの `toolMode: 'テスター',` の**直前**に次を足す:

```ts
    /** アナログ計器の読み上げ名。§15 */
    meterLabel: 'アナログテスターの目盛',
```

`apps/desktop/src/renderer/panels/AnalogMeter.tsx` の末尾の `const JA_METER_LABEL = 'アナログテスターの目盛';` を削除し、`aria-label={JA_METER_LABEL}` を次に置き換える:

```tsx
      aria-label={JA.tester.meterLabel}
```

同ファイルの import に `ja.ts` を足す（`import { useStore } from '../app/store.js';` の直後）:

```ts
import { JA } from '../i18n/ja.js';
```

- [ ] **Step 5: `TesterPanel` に組み込む**

`apps/desktop/src/renderer/panels/TesterPanel.tsx` の `<TesterReadout />` の行を次に置き換える:

```tsx
      <TesterReadout />
      {kind === 'analog' ? <AnalogMeter /> : null}
```

同ファイルの import に次を足す（`import { useStore } from '../app/store.js';` の直前）:

```ts
import { AnalogMeter } from './AnalogMeter.js';
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/analog-meter.test.tsx test/tester-panel.test.tsx --no-file-parallelism
```

Expected: `Test Files  2 passed (2)`。`analog-meter` 11件、`tester-panel` 11件。

`needleDeg` は 2A 側で目標角との差が0.05度未満になると目標角へスナップする（2A レビュー反映③）。`data-deg` を `toFixed(2)` にしたのはこのスナップのおかげで指数移動平均が理論上ずっと収束しきらず（残差が0に漸近するだけで届かない）、生の浮動小数点値を文字列化すると再レンダーが止まらなくなる問題を避けるため。

- [ ] **Step 7: コミットする**

```powershell
git add apps/desktop/src/renderer/panels/AnalogMeter.tsx apps/desktop/src/renderer/panels/TesterPanel.tsx apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test/analog-meter.test.tsx
git commit -m @'
feat(desktop): draw the analog tester scale and needle

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 7: 3Dのプローブ表示・警告バナー・導通ブザー

**Files:**
- Create: `apps/desktop/src/renderer/three/ProbeMarkers.tsx`
- Create: `apps/desktop/src/renderer/panels/WarningBanner.tsx`
- Modify: `apps/desktop/src/renderer/three/BoardScene.tsx`
- Modify: `apps/desktop/src/renderer/session/colors.ts`
- Modify: `apps/desktop/src/renderer/audio/sounds.ts`
- Modify: `apps/desktop/src/renderer/app/App.tsx`
- Modify: `apps/desktop/src/renderer/screens/Session.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/probe-markers.test.ts`, `apps/desktop/test/warning-banner.test.tsx`

プローブが3D盤の何処に載っているかを見せ、危険操作を画面上部の帯で知らせ、導通ブザーを鳴らす。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| プローブの位置 | ストアは**役割ID**（`CHK.13`）で持つので、描くときに `toPhysicalTerminal()` で物理ID（`S7.13`）へ直してから `boardTerminalPos()` を引く | §6.4 |
| 見た目 | 端子の上に浮かぶ小さな円錐（黒／赤）。プローブは測るだけで盤を変えないのでレイキャストは受けない | §9.3 |
| ハイライト端子 | C2 の連動ハイライト（§9.2）で光らせる端子も同じ部品が描く（球を1つ置く） | §9.2 |
| ハイライト電線 | 既存の `Wire` の「選択中」表示を流用する（`selected` に混ぜる） | 電線の強調表示を二重に作らない |
| 再描画 | `visualSignature()` にプローブとハイライトを足す。足さないと `frameloop="demand"` で絵が更新されない | §15 |
| 警告バナー | 画面上部の帯。種別の日本語名・補足・**これまでのミス回数**を出し、6秒で自動的に畳む（`App` の間引きタイマが掃除する） | §5.6 / §13 / 利用者の決定「警告表示＋ミス回数記録」 |
| ミス回数 | `hazards.length + restoredHazardCount`。合否には影響しない（§17.2 #3） | §5.6 |
| 導通ブザー | `snapshot.tester.conductive` が偽→真に変わったら `buzzer` を鳴らす | §15「テスターの導通ブザー」 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/probe-markers.test.ts`:

```ts
import type { SocketRoles } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { probePositions } from '../src/renderer/three/ProbeMarkers.js';
import { visualSignature } from '../src/renderer/three/BoardScene.js';
import { useStore } from '../src/renderer/app/store.js';
import { NO_HIGHLIGHT } from '../src/renderer/app/store-types.js';

/**
 * 3Dのプローブ表示（Plan 2B Task 7）。設計仕様 §9.3 / §6.4 / §15。
 */

/** 既定の役割割当（`CHK` は `S7`。§6.3）。 */
const ROLES = {
  S1: 'CR1',
  S2: 'CR2',
  S3: 'CR3',
  S4: 'T1',
  S5: 'T2',
  S6: 'T3',
  S7: 'CHK',
  S8: undefined,
} as SocketRoles;

describe('probePositions（§6.4 役割ID → 物理端子）', () => {
  it('役割IDのプローブを物理端子の座標へ写す', () => {
    const positions = probePositions(
      { black: toTerminalId('CHK.13'), red: toTerminalId('CHK.14') },
      ROLES,
    );
    expect(positions).toHaveLength(2);
    expect(positions[0]?.side).toBe('black');
    expect(positions[1]?.side).toBe('red');
    // 隣り合うピン（⑬と⑭）なので近い
    const [a, b] = positions;
    if (a === undefined || b === undefined) return;
    expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])).toBeLessThan(40);
  });

  it('未配置のプローブは出さない', () => {
    expect(probePositions({ black: undefined, red: undefined }, ROLES)).toEqual([]);
  });

  it('盤に無い端子は黙って落とす（壊れた作業ファイルでも3Dが落ちない。§13 #8）', () => {
    expect(probePositions({ black: toTerminalId('NOPE.99'), red: undefined }, ROLES)).toEqual([]);
  });
});

describe('visualSignature（§15 再描画の引き金）', () => {
  it('プローブが動いたら署名が変わる', () => {
    const base = useStore.getState();
    const before = visualSignature(base);
    const after = visualSignature({
      ...base,
      tester: { ...base.tester, black: toTerminalId('CHK.13') },
    });
    expect(after).not.toBe(before);
  });

  it('ハイライトが変わったら署名が変わる', () => {
    const base = useStore.getState();
    const before = visualSignature({ ...base, highlight: NO_HIGHLIGHT });
    const after = visualSignature({
      ...base,
      highlight: { cellIds: ['c1'], terminals: ['CR1.13'], wireIds: ['sw-001'] },
    });
    expect(after).not.toBe(before);
  });

  it('読値の小数だけが動いても署名は変わらない（アイドル中に描き続けない）', () => {
    const base = useStore.getState();
    const before = visualSignature(base);
    const after = visualSignature({
      ...base,
      snapshot: {
        ...base.snapshot,
        tester: { ...base.snapshot.tester, value: 23.99, display: '23.99 V' },
      },
    });
    expect(after).toBe(before);
  });
});
```

`apps/desktop/test/warning-banner.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { WarningBanner } from '../src/renderer/panels/WarningBanner.js';

/**
 * 危険操作の警告バナー（Plan 2B Task 7）。設計仕様 §5.6 / §13 / §16 Phase 2 受入基準④。
 */

beforeEach(() => {
  useStore.setState({ hazardBanner: undefined, hazards: [], restoredHazardCount: 0 });
});

afterEach(() => {
  cleanup();
});

describe('WarningBanner', () => {
  it('危険操作が無ければ何も描かない', () => {
    render(<WarningBanner />);
    expect(screen.queryByTestId('hazard-banner')).toBeNull();
  });

  it('種別の日本語名・補足・ミス回数を出す（§5.6）', () => {
    useStore.setState({
      hazardBanner: { kind: 'ohm-on-live', detail: 'CHK.13 — CHK.14', expiresAt: Date.now() + 1000 },
      hazards: [
        { type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'a' },
        { type: 'hazard', kind: 'range-exceeded', tMs: 20, detail: 'b' },
      ],
    });
    render(<WarningBanner />);
    const banner = screen.getByTestId('hazard-banner');
    expect(banner.textContent).toContain('通電中のΩ／導通測定');
    expect(banner.textContent).toContain('CHK.13 — CHK.14');
    expect(screen.getByTestId('mistake-count').textContent).toContain('2');
  });

  it('復元した危険操作もミス回数に足す（§12.3）', () => {
    useStore.setState({
      hazardBanner: { kind: 'range-exceeded', detail: 'DCV 2.5V レンジ', expiresAt: Date.now() + 1000 },
      hazards: [{ type: 'hazard', kind: 'range-exceeded', tMs: 20, detail: 'b' }],
      restoredHazardCount: 3,
    });
    render(<WarningBanner />);
    expect(screen.getByTestId('mistake-count').textContent).toContain('4');
  });

  it('閉じるボタンで畳める', () => {
    useStore.setState({
      hazardBanner: { kind: 'ohm-on-live', detail: 'x', expiresAt: Date.now() + 1000 },
      hazards: [{ type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'x' }],
    });
    render(<WarningBanner />);
    fireEvent.click(screen.getByTestId('hazard-dismiss'));
    expect(useStore.getState().hazardBanner).toBeUndefined();
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/probe-markers.test.ts test/warning-banner.test.tsx --no-file-parallelism
```

Expected: 両方とも `Failed to resolve import` で失敗し、`Test Files  2 failed (2)`。

- [ ] **Step 3: 色を足す**

`apps/desktop/src/renderer/session/colors.ts` の `export const PANEL_HOLE_COLOR = '#14171B';` の**直後**に次を足す:

```ts
/** テスターのプローブの色（黒／赤）。§9.3 */
export const PROBE_COLORS: Readonly<Record<'black' | 'red', string>> = {
  black: '#15181C',
  red: '#D6262B',
};

/** 回路図と連動して光らせる端子の色（§9.2 の連動ハイライト）。 */
export const HIGHLIGHT_COLOR = '#FFE066';
```

- [ ] **Step 4: `three/ProbeMarkers.tsx` を作る**

`apps/desktop/src/renderer/three/ProbeMarkers.tsx`:

```tsx
import { boardTerminalPos, JIPM_BOARD, toPhysicalTerminal } from '@ojt/board-model';
import type { SocketRoles } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { HIGHLIGHT_COLOR, PROBE_COLORS } from '../session/colors.js';
import { toScene } from './coords.js';
import { sharedMaterial } from './materials.js';

/**
 * テスターのプローブと、回路図連動ハイライトの端子。設計仕様 §9.3 / §9.2。
 *
 * プローブは**測るだけ**で盤を変えないので、レイキャストを受けない（`raycast` を潰す）。
 * 受けてしまうと、置いたプローブが下の端子のクリックを奪い、付け替えができなくなる。
 *
 * ストアのプローブは**役割ID**（`CHK.13`）で持つ。3D盤は**物理端子**（`S7.13`）で描かれて
 * いるので、`toPhysicalTerminal()` で直してから座標を引く（§6.4）。壊れた作業ファイルなどで
 * 盤に無い端子が入っていても、例外を投げずに黙って落とす（§13 #8）。
 */

/** プローブが浮く高さ[mm]（端子の当たり判定球より手前に出す）。 */
const PROBE_LIFT_MM = 7;
/** プローブの円錐の半径・高さ[mm]。 */
const PROBE_RADIUS_MM = 1.8;
const PROBE_HEIGHT_MM = 9;
/** ハイライトの球の半径[mm]。 */
const HIGHLIGHT_RADIUS_MM = 3.6;

/** 描くプローブ1本。 */
export interface ProbePlacement {
  side: 'black' | 'red';
  pos: [number, number, number];
}

/** 端子（役割ID）の3D座標を引く。盤に無ければ undefined。 */
function scenePosOf(roles: SocketRoles, terminal: TerminalId): [number, number, number] | undefined {
  try {
    const physical = toPhysicalTerminal(roles, terminal);
    return toScene(boardTerminalPos(JIPM_BOARD, physical));
  } catch {
    // 盤に無い端子・形の壊れたIDは描かない（3Dシーンを落とさない）
    return undefined;
  }
}

/** プローブの置き場所を3D座標で返す（純粋関数。テストで固定する）。 */
export function probePositions(
  probes: { black: TerminalId | undefined; red: TerminalId | undefined },
  roles: SocketRoles,
): ProbePlacement[] {
  const out: ProbePlacement[] = [];
  for (const side of ['black', 'red'] as const) {
    const terminal = probes[side];
    if (terminal === undefined) continue;
    const pos = scenePosOf(roles, terminal);
    if (pos === undefined) continue;
    out.push({ side, pos });
  }
  return out;
}

/** ハイライトする端子の3D座標（純粋関数）。 */
export function highlightPositions(
  terminals: readonly string[],
  roles: SocketRoles,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const terminal of terminals) {
    const pos = scenePosOf(roles, terminal as TerminalId);
    if (pos !== undefined) out.push(pos);
  }
  return out;
}

/** レイキャストを受けない（下の端子のクリックを奪わない）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** プローブとハイライト端子。 */
export function ProbeMarkers({
  probes,
  highlightTerminals,
  roles,
}: {
  probes: { black: TerminalId | undefined; red: TerminalId | undefined };
  highlightTerminals: readonly string[];
  roles: SocketRoles;
}): JSX.Element {
  const placements = probePositions(probes, roles);
  const highlights = highlightPositions(highlightTerminals, roles);
  return (
    <group name="probe-markers">
      {placements.map((placement) => (
        <mesh
          key={placement.side}
          name={`probe-${placement.side}`}
          raycast={noPick}
          position={[
            placement.pos[0],
            placement.pos[1],
            placement.pos[2] + PROBE_LIFT_MM + PROBE_HEIGHT_MM / 2,
          ]}
          rotation={[Math.PI / 2, 0, 0]}
          material={sharedMaterial(PROBE_COLORS[placement.side], {
            metalness: 0.2,
            roughness: 0.5,
          })}
        >
          <coneGeometry args={[PROBE_RADIUS_MM, PROBE_HEIGHT_MM, 10]} />
        </mesh>
      ))}
      {highlights.map((pos, index) => (
        <mesh
          key={`hl-${String(index)}`}
          name="highlight-terminal"
          raycast={noPick}
          position={[pos[0], pos[1], pos[2] + 2]}
          material={sharedMaterial(HIGHLIGHT_COLOR, {
            metalness: 0.1,
            roughness: 0.9,
            opacity: 0.55,
            transparent: true,
          })}
        >
          <sphereGeometry args={[HIGHLIGHT_RADIUS_MM, 12, 10]} />
        </mesh>
      ))}
    </group>
  );
}
```

`apps/desktop/src/renderer/three/materials.ts` の `sharedMaterial()` の options 型に次の2つを足す:

```ts
  opacity?: number;
  transparent?: boolean;
```

`sharedMaterial()` の `key` の行を次に置き換える（`opacity` / `transparent` をキャッシュ鍵に混ぜないと、同じ色で不透明・半透明の両方を要求したときに先に作った方のマテリアルを使い回してしまう）:

```ts
  const key = `${color}|${options.metalness ?? 0.1}|${options.roughness ?? 0.7}|${options.emissive ?? ''}|${options.emissiveIntensity ?? 0}|${options.opacity ?? 1}|${options.transparent === true ? 1 : 0}`;
```

そして `new MeshStandardMaterial({ … })` に `opacity` / `transparent` を渡す（既定は `opacity: 1` / `transparent: false`）:

```ts
  const material = new MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.1,
    roughness: options.roughness ?? 0.7,
    ...(options.emissive === undefined ? {} : { emissive: options.emissive }),
    emissiveIntensity: options.emissiveIntensity ?? 0,
    opacity: options.opacity ?? 1,
    transparent: options.transparent ?? false,
  });
```

- [ ] **Step 5: `BoardScene.tsx` に組み込む**

`apps/desktop/src/renderer/three/BoardScene.tsx` の import に次を足す（`import { PushButton } from './PushButton.js';` の直前）:

```ts
import { ProbeMarkers } from './ProbeMarkers.js';
```

`visualSignature()` の `state.selectedWire ?? '',` の**直後**に次の3行を挿入する:

```ts
    // プローブの位置とハイライトは絵に効くので署名に入れる（§9.3 / §9.2）
    `${state.tester.black ?? ''}>${state.tester.red ?? ''}`,
    state.highlight.terminals.join(','),
    state.highlight.wireIds.join(','),
```

`BoardContents()` の `const selectedWire = useStore((s) => s.selectedWire);` の**直後**に次を足す:

```ts
  const probeBlack = useStore((s) => s.tester.black);
  const probeRed = useStore((s) => s.tester.red);
  const highlightTerminals = useStore((s) => s.highlight.terminals);
  const highlightWires = useStore((s) => s.highlight.wireIds);
```

`{routes.map((route) => { … })}` のブロックを次に置き換える:

```tsx
        {routes.map((route) => {
          const wire = session?.wires.find((w) => w.id === route.wireId);
          if (wire === undefined) return null;
          return (
            <Wire
              key={route.wireId}
              route={route}
              color={wire.color}
              locked={wire.locked}
              /*
               * 連動ハイライト（§9.2）は電線の「選択中」表示を流用する。強調の描き方を
               * 2つ持つと色の優先順位を `wireBodyColor()` の外で決めることになり、
               * どちらが勝つかがファイルをまたいで散らばる。
               */
              selected={selectedWire === route.wireId || highlightWires.includes(route.wireId)}
              pickable={mode === 'delete' || mode === 'report'}
              onPick={pickWire}
            />
          );
        })}

        {session === undefined ? null : (
          <ProbeMarkers
            probes={{ black: probeBlack, red: probeRed }}
            highlightTerminals={highlightTerminals}
            roles={session.socketRoles}
          />
        )}
```

（`pickable` に `'report'` を足すのは Task 13 で電線をクリックして指摘するため。ここで一緒に入れる。）

- [ ] **Step 6: `panels/WarningBanner.tsx` を作る**

`apps/desktop/src/renderer/panels/WarningBanner.tsx`:

```tsx
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA, mistakeCountText } from '../i18n/ja.js';
import styles from './tester.module.css';

/**
 * 危険操作の警告バナー。設計仕様 §5.6 / §13 / §16 Phase 2 受入基準④。
 *
 * トースト（§8.2）ではなく画面上部の帯にする。危険操作は「やってしまったこと」であり、
 * 右下に4秒だけ出て消えると気づかないまま回数が積み上がる。回数は**合否に影響しない**
 * （§17.2 #3）が、訓練者がその場で「いま危ないことをした」と分かる必要がある。
 *
 * 表示は6秒で自動的に畳む（`App` の間引きタイマが `dismissHazard(Date.now())` を呼ぶ）。
 * 回数は「今回の分 ＋ 作業ファイルから復元した分」（§12.3 / §5.6）。
 */
export function WarningBanner(): JSX.Element | null {
  const banner = useStore((s) => s.hazardBanner);
  const count = useStore((s) => s.hazards.length);
  const restored = useStore((s) => s.restoredHazardCount);
  if (banner === undefined) return null;
  return (
    <div className={styles.warnBanner} role="alert" data-testid="hazard-banner">
      <span className={styles.warnKind}>{JA.hazard[banner.kind]}</span>
      <span>{banner.detail}</span>
      <span className={styles.warnSpacer} />
      <span data-testid="mistake-count">{mistakeCountText(count + restored)}</span>
      <button
        type="button"
        data-testid="hazard-dismiss"
        onClick={() => {
          useStore.getState().dismissHazard();
        }}
      >
        {JA.session.warnDismiss}
      </button>
    </div>
  );
}
```

`apps/desktop/src/renderer/panels/tester.module.css` の末尾に次を足す:

```css
/* 危険操作の警告バナー（§5.6 / §13）。例外バナー（赤地）と区別できるよう琥珀の帯にする */
.warnBanner {
  background: rgba(232, 194, 42, 0.18);
  border-bottom: 2px solid var(--warn);
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
}

.warnKind {
  font-weight: 700;
}

.warnSpacer {
  flex: 1;
}
```

`apps/desktop/src/renderer/i18n/ja.ts` の `session:` ブロックの `warnings: '警告',` の**直後**に次を足す:

```ts
    /** 警告バナーを畳む。§5.6 */
    warnDismiss: '閉じる',
```

同ファイルの `restoredHazardsText()` の**直後**に次を足す:

```ts
/** 警告バナーのミス回数（`ミス 3 回`）。§5.6 / 利用者の決定「警告表示＋ミス回数記録」 */
export function mistakeCountText(count: number): string {
  return `${JA.result.mistakes} ${count} ${JA.result.times}`;
}
```

`JA.result` に `mistakes` を足す（`hazards: '危険操作',` の**直後**）:

```ts
    /** 危険操作の回数を訓練者向けに言い換えたもの（合否には影響しない。§17.2 #3）。 */
    mistakes: 'ミス',
```

- [ ] **Step 7: 導通ブザーを鳴らす**

`apps/desktop/src/renderer/audio/sounds.ts` の `SoundSnapshot` を次に置き換える:

```ts
/** `soundsForSnapshot()` が見るスナップショットの部分型。 */
export interface SoundSnapshot {
  relays: Readonly<Record<string, { contactsOn: boolean }>>;
  timers: Readonly<Record<string, { timedOut: boolean }>>;
  lamps: Readonly<Record<string, { level: string }>>;
  hazardDelta: readonly unknown[];
  /** テスターの導通レンジがブザーを鳴らしているか。§5.5 / §15 */
  tester: { conductive: boolean };
}
```

`soundsForSnapshot()` の `if (previous.lamps['BZ']?.level !== 'lit' && next.lamps['BZ']?.level === 'lit') { out.push('buzzer'); }` の**直後**に次を足す:

```ts
    // テスターの導通ブザー（§15）。鳴り始めた tick だけ鳴らす（導通が続く間ずっと鳴らさない）
    if (!previous.tester.conductive && next.tester.conductive) out.push('buzzer');
```

- [ ] **Step 8: `App` の間引きタイマで警告バナーも掃除する**

`apps/desktop/src/renderer/app/App.tsx` のトースト掃除の `setInterval` の中身を次に置き換える:

```ts
    const id = setInterval(() => {
      const store = useStore.getState();
      store.expireToasts();
      // 危険操作の帯も同じ間引きで畳む（§5.6。期限が来ていなければ何もしない）
      store.dismissHazard(Date.now());
    }, TOAST_SWEEP_MS);
```

- [ ] **Step 8a: `Session.tsx`（モードB）にも警告バナーを出す**

モードBにも危険操作はある（`over-wires-per-terminal` / `power-sequence-violation` / `short-circuit-power-on` / `overcurrent`。§5.6）。C1/C2 のセッション画面と同じバナーをモードBにも出す。

`apps/desktop/src/renderer/screens/Session.tsx` の `<SoundEffects />` の**直後**、`<Toolbar` の**直前**に次を挿入する:

```tsx
      <WarningBanner />
```

同ファイルの import に次を足す（`import { Toolbar } from '../panels/Toolbar.js';` の直前）:

```ts
import { WarningBanner } from '../panels/WarningBanner.js';
```

（`WarningBanner` は `hazardBanner` の種別を `JA.hazard[banner.kind]` でそのまま引くので、モードB固有の追加実装は要らない。）

- [ ] **Step 9: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/probe-markers.test.ts test/warning-banner.test.tsx test/sounds.test.ts test/board-scene.test.ts test/session.test.tsx --no-file-parallelism
```

Expected: `Test Files  5 passed (5)`。既存の `sounds.test.ts` は `SoundSnapshot` に `tester` が増えたぶんだけ型エラーになるので、テスト内の擬似スナップショットに `tester: { conductive: false }` を足して通す。既存の `session.test.tsx` は `WarningBanner` の import 追加だけなのでそのまま通る。

- [ ] **Step 10: コミットする**

```powershell
git add apps/desktop/src/renderer/three/ProbeMarkers.tsx apps/desktop/src/renderer/three/BoardScene.tsx apps/desktop/src/renderer/three/materials.ts apps/desktop/src/renderer/panels/WarningBanner.tsx apps/desktop/src/renderer/panels/tester.module.css apps/desktop/src/renderer/session/colors.ts apps/desktop/src/renderer/audio/sounds.ts apps/desktop/src/renderer/app/App.tsx apps/desktop/src/renderer/screens/Session.tsx apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test/probe-markers.test.ts apps/desktop/test/warning-banner.test.tsx apps/desktop/test/sounds.test.ts
git commit -m @'
feat(desktop): show probes on the board and warn on hazardous measurements

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 8: モードC1の Worker 連携（チェック用回路と判定）

**Files:**
- Create: `apps/desktop/src/renderer/session/inspect-parts.ts`
- Modify: `apps/desktop/src/worker/protocol.ts`
- Modify: `apps/desktop/src/worker/sim.worker.ts`
- Test: `apps/desktop/test/inspect-parts-session.test.ts`, `apps/desktop/test/sim-worker-inspect.test.ts`

チェック用ソケットに部品を1個挿した回路を Worker に読ませ、マークシートの採点を Worker で行う。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| 故障の運び方 | `load` コマンドに `partFaults?: FaultSpecData[]` を足し、Worker が `toNetlist()` の直後に `injectPartFaults()` する | 部品の故障は `MountedPart` に持たせる場所が無く、ネットリスト変換のたびに注入し直す必要がある（Plan 2A Task 4） |
| 部品の差し替え | 部品を替えるたびに**新しい `load`** を送る（差分 `plug` ではない） | C1 は1個ずつ点検する手順そのもので、盤も時計もやり直すのが自然（§9.1「部品を外して次へ」）。差分で当てると `mountPart()` が作る良品に故障を入れ直す必要が出て、ネットリストと故障の対応が2箇所に散る |
| 判定 | `{ type: 'judgeParts'; problem; answers; elapsedMs }` → `{ type: 'inspectResult'; result }` | 危険操作の回数は Worker の `sim.events.hazards()` にあるので、判定も Worker で行うのが一貫する（モードBの `judge` と同じ） |
| 待ち時間 | `checkSettleMs(kind)`（リレー100ms / タイマ1100ms）を renderer に返し、UIの「安定待ち」の目安に使う | §9.1 切り分け手順① |
| 組の秘匿 | プローブの置き場所ショートカットは**4組ぶん全部**出す（不良の組は出さない） | Plan 2A 意図的な差分 #14「UIは組を表示しない」 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/inspect-parts-session.test.ts`:

```ts
import { BUILTIN_INSPECT_PARTS_PROBLEMS, CHECK_COIL_MINUS, CHECK_COIL_PLUS } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import {
  answeredCount,
  checkLoadFor,
  markSheetRows,
  probeTargets,
} from '../src/renderer/session/inspect-parts.js';

/**
 * モードC1の純関数（Plan 2B Task 8）。設計仕様 §9.1。
 */

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

describe('checkLoadFor（§9.1）', () => {
  it('トレイの部品をチェック用ソケットに挿した盤と故障を返す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const part = C1.parts[0];
    expect(part).toBeDefined();
    if (part === undefined) return;
    const loaded = checkLoadFor(C1, part.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // チェック用ソケット（S7）に1個だけ挿さっている
    expect(Object.keys(loaded.session.mounted)).toEqual(['S7']);
    expect(loaded.session.mounted['S7']?.kind).toBe(part.kind);
    // 既設配線3本はそのまま（§6.3）
    expect(loaded.session.wires.filter((w) => w.locked)).toHaveLength(3);
    // 正常品なら故障は空、不良品なら1件
    expect(loaded.partFaults).toHaveLength(part.truth === 'normal' ? 0 : 1);
  });

  it('リレーは 100ms、タイマは 1100ms の安定待ちを返す（§9.1 手順①）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const relay = C1.parts.find((p) => p.kind === 'relay-my4n');
    expect(relay).toBeDefined();
    if (relay === undefined) return;
    const loaded = checkLoadFor(C1, relay.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.settleMs).toBe(100);
  });

  it('知らない部品IDは理由付きで断る（§13 #2）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const loaded = checkLoadFor(C1, 'no-such-part');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.errors[0]?.message).toContain('no-such-part');
  });
});

describe('markSheetRows / answeredCount（§9.1 回答）', () => {
  it('部品ごとに1行を作り、解答済みの行に答えが入る', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const rows = markSheetRows(C1, [{ partId: first.id, answer: 'coil-open' }]);
    expect(rows).toHaveLength(C1.parts.length);
    expect(rows[0]?.answer).toBe('coil-open');
    expect(rows[1]?.answer).toBeUndefined();
    // 本当の状態は行に入れない（答えが漏れる）
    expect(Object.keys(rows[0] ?? {})).toEqual(['partId', 'kind', 'answer']);
  });

  it('解答済みの件数を数える', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    expect(answeredCount(C1, [])).toBe(0);
    const ids = C1.parts.map((p) => p.id);
    expect(
      answeredCount(
        C1,
        ids.map((id) => ({ partId: id, answer: 'normal' as const })),
      ),
    ).toBe(C1.parts.length);
    // 課題に無い部品IDの解答は数えない
    expect(answeredCount(C1, [{ partId: 'ghost', answer: 'normal' }])).toBe(0);
  });
});

describe('probeTargets（§9.1 測定1・測定2）', () => {
  it('コイルと4組ぶんの a/b 接点を返す（不良の組は出さない。Plan 2A 差分 #14）', () => {
    const targets = probeTargets();
    expect(targets).toHaveLength(9);
    expect(targets[0]?.id).toBe('coil');
    expect(targets[0]?.black).toBe(CHECK_COIL_MINUS);
    expect(targets[0]?.red).toBe(CHECK_COIL_PLUS);
    expect(targets.filter((t) => t.id.startsWith('a'))).toHaveLength(4);
    expect(targets.filter((t) => t.id.startsWith('b'))).toHaveLength(4);
  });

  it('1組のa接点は CHK.9 – CHK.5（§6.2 / §9.1 測定2）', () => {
    const a1 = probeTargets().find((t) => t.id === 'a1');
    expect(a1?.black).toBe('CHK.9');
    expect(a1?.red).toBe('CHK.5');
  });

  it('1組のb接点は CHK.9 – CHK.1', () => {
    const b1 = probeTargets().find((t) => t.id === 'b1');
    expect(b1?.black).toBe('CHK.9');
    expect(b1?.red).toBe('CHK.1');
  });
});
```

`apps/desktop/test/sim-worker-inspect.test.ts`:

```ts
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_PARTS_PROBLEMS, truthFault } from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLoadFor } from '../src/renderer/session/inspect-parts.js';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * モードC1を Worker で回す（Plan 2B Task 8）。設計仕様 §9.1 / §16 Phase 2 受入基準①②④。
 * 期待値は Plan 2A の実測表（正常 650.0 / レアショート 422.5 / コイル断線 OL）から引く。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));

vi.setConfig({ testTimeout: 20_000 });

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  send: (command: SimCommand) => void;
  advance: (ms: number, stepMs?: number) => void;
}

async function boot(): Promise<Harness> {
  const posted: SimMessage[] = [];
  const fakeSelf = {
    postMessage: (message: SimMessage) => {
      posted.push(message);
    },
    onmessage: undefined as unknown as (event: { data: SimCommand }) => void,
  };
  Object.defineProperty(globalThis, 'self', {
    value: fakeSelf,
    configurable: true,
    writable: true,
  });
  clock.nowMs = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs);
  vi.resetModules();
  await import('../src/worker/sim.worker.js');
  return {
    posted,
    get snapshots() {
      return posted.filter((m) => m.type === 'snapshot').map((m) => m.snapshot);
    },
    send: (command) => {
      fakeSelf.onmessage({ data: command });
    },
    advance: (ms, stepMs = 4) => {
      let left = ms;
      while (left > 0) {
        const chunk = Math.min(stepMs, left);
        clock.nowMs += chunk;
        vi.advanceTimersByTime(chunk);
        left -= chunk;
      }
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 指定の `truth` を持つ部品を1つ選ぶ（内蔵C1課題から）。 */
function partWith(truth: string): { problemIndex: number; partId: string } | undefined {
  for (const [index, problem] of BUILTIN_INSPECT_PARTS_PROBLEMS.entries()) {
    const part = problem.parts.find((p) => p.truth === truth);
    if (part !== undefined) return { problemIndex: index, partId: part.id };
  }
  return undefined;
}

/** その部品をチェック用ソケットに挿して通電した Worker を返す。 */
async function checking(truth: string): Promise<Harness> {
  const found = partWith(truth);
  expect(found).toBeDefined();
  if (found === undefined) throw new Error(`${truth} の部品が内蔵課題にありません`);
  const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[found.problemIndex];
  if (problem === undefined) throw new Error('課題がありません');
  const loaded = checkLoadFor(problem, found.partId);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error('チェック用回路を作れませんでした');
  const h = await boot();
  h.send({
    type: 'load',
    problemId: problem.id,
    session: loaded.session,
    partFaults: loaded.partFaults,
  });
  h.advance(50);
  h.send({ type: 'breaker', on: true });
  h.send({ type: 'switch', on: true });
  h.advance(150);
  return h;
}

/** Ωレンジでコイル端子を測る。 */
function measureCoil(h: Harness): void {
  h.send({ type: 'tester', action: { type: 'set-mode', mode: 'OHM' } });
  h.send({
    type: 'tester',
    action: { type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') },
  });
  h.send({
    type: 'tester',
    action: { type: 'place-probe', probe: 'red', terminal: toTerminalId('CHK.14') },
  });
  h.advance(100);
}

describe('C1 のコイル抵抗（§9.1 測定1 / §16 Phase 2 受入基準①②）', () => {
  it('正常品は 650.0 Ω（Plan 2A 実測表）', async () => {
    const h = await checking('normal');
    measureCoil(h);
    expect(h.snapshots.at(-1)?.tester.display).toBe('650.0 Ω');
  });

  it('コイル断線は OL（Plan 2A 実測表）', async () => {
    const h = await checking('coil-open');
    measureCoil(h);
    expect(h.snapshots.at(-1)?.tester.display).toBe('OL');
  });

  it('レアショートは 422.5 Ω（正常の85%＝552.5Ω を下回る）', async () => {
    const h = await checking('coil-layer-short');
    measureCoil(h);
    expect(h.snapshots.at(-1)?.tester.display).toBe('422.5 Ω');
  });
});

describe('C1 の励磁（§9.1 手順①）', () => {
  it('正常品は赤PB（PB4）を押すと吸引する', async () => {
    const h = await checking('normal');
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(150);
    expect(h.snapshots.at(-1)?.relays['CHK']?.coilOn).toBe(true);
  });

  it('コイル断線は赤PBを押しても吸引しない', async () => {
    const h = await checking('coil-open');
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(150);
    expect(h.snapshots.at(-1)?.relays['CHK']?.coilOn).toBe(false);
  });

  it('レアショートは正常どおり吸引する（動作では見分けられない。§17.2 #7）', async () => {
    const h = await checking('coil-layer-short');
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(150);
    expect(h.snapshots.at(-1)?.relays['CHK']?.coilOn).toBe(true);
  });
});

describe('C1 の危険操作（§5.6 #1 / §16 Phase 2 受入基準④）', () => {
  it('赤PBを離していれば通電したままΩを測っても警告は出ない（§9.1 測定1）', async () => {
    const h = await checking('normal');
    measureCoil(h);
    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.filter((e) => e.kind === 'ohm-on-live')).toHaveLength(0);
  });

  it('赤PBを押したままΩを当てると ohm-on-live が出る', async () => {
    const h = await checking('normal');
    h.send({ type: 'press', pbId: 'PB4' });
    h.advance(100);
    measureCoil(h);
    const hazards = h.snapshots.flatMap((s) => s.hazardDelta);
    expect(hazards.some((e) => e.kind === 'ohm-on-live')).toBe(true);
    expect(h.snapshots.at(-1)?.tester.display).toBe('----');
  });
});

describe('C1 の判定（§9.1 判定）', () => {
  it('全問正解なら合格になり、危険操作の回数も返る', async () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    const loaded = checkLoadFor(C1, first.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C1.id,
      session: loaded.session,
      partFaults: loaded.partFaults,
    });
    h.advance(100);
    h.send({
      type: 'judgeParts',
      problem: C1,
      answers: C1.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      elapsedMs: 120_000,
    });
    h.advance(50);

    const message = h.posted.find((m) => m.type === 'inspectResult');
    expect(message).toBeDefined();
    if (message === undefined || message.type !== 'inspectResult') return;
    expect(message.result.ok).toBe(true);
    if (!message.result.ok) return;
    const value = message.result.value;
    expect(value.mode).toBe('inspect-parts');
    if (value.mode !== 'inspect-parts') return;
    expect(value.passed).toBe(true);
    expect(value.correctCount).toBe(C1.parts.length);
    expect(value.elapsedMs).toBe(120_000);
  });

  it('1問間違えると不合格で「n/m 正解」が出せる', async () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    const loaded = checkLoadFor(C1, first.id);
    if (!loaded.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C1.id,
      session: loaded.session,
      partFaults: loaded.partFaults,
    });
    h.advance(100);
    const answers = C1.parts.map((p, index) => ({
      partId: p.id,
      answer: index === 0 && p.truth !== 'normal' ? ('normal' as const) : p.truth,
    }));
    h.send({ type: 'judgeParts', problem: C1, answers, elapsedMs: 60_000 });
    h.advance(50);

    const message = h.posted.find((m) => m.type === 'inspectResult');
    if (message === undefined || message.type !== 'inspectResult') return;
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-parts') return;
    expect(value.total).toBe(C1.parts.length);
    expect(value.correctCount).toBeLessThanOrEqual(C1.parts.length);
  });
});

describe('truthFault との整合', () => {
  it('checkLoadFor が返す故障は truthFault と同じ', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    for (const part of C1.parts) {
      const loaded = checkLoadFor(C1, part.id);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) continue;
      const expected = truthFault(C1, part);
      expect(loaded.partFaults).toEqual(expected === undefined ? [] : [expected]);
    }
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-parts-session.test.ts test/sim-worker-inspect.test.ts --no-file-parallelism
```

Expected: 両方 `Failed to resolve import "../src/renderer/session/inspect-parts.js"` で `Test Files  2 failed (2)`。

- [ ] **Step 3: `src/renderer/session/inspect-parts.ts` を作る**

`apps/desktop/src/renderer/session/inspect-parts.ts`:

```ts
import { JIPM_BOARD, type BoardSession } from '@ojt/board-model';
import type { MountableKind } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  checkContactTerminals,
  checkSettleMs,
  truthFault,
  type FaultSpecData,
  type InspectPartAnswer,
  type InspectPartsProblem,
  type PartTruth,
  type ProblemIssue,
} from '@ojt/content';

/**
 * モードC1（部品点検）の純粋な下ごしらえ。設計仕様 §9.1。
 * React も three も使わないので Vitest だけで検証できる（§14.2）。
 *
 * 盤の組み立て（チェック用ソケットへ挿す・故障を決める）は Plan 2A の
 * `buildCheckCircuit()` / `truthFault()` が唯一の実装であり、ここはその結果を
 * Worker の `load` コマンドの形に詰め替えるだけである。
 */

/** チェック用回路を Worker に読ませるための材料。 */
export type CheckLoadResult =
  | {
      ok: true;
      /** チェック用ソケットに部品を1個挿した盤。 */
      session: BoardSession;
      /** ネットリスト変換のたびに注入する部品の故障（正常品なら空）。§5.4 */
      partFaults: FaultSpecData[];
      /** 接点の不良を入れた組（1〜4）。**画面には出さない**（Plan 2A 差分 #14）。 */
      group: number;
      /** 励磁が安定するまでの目安[ms]（リレー100 / タイマ1100）。§9.1 手順① */
      settleMs: number;
    }
  | { ok: false; errors: ProblemIssue[] };

/**
 * トレイの部品1個をチェック用ソケットに挿した回路を作る。§9.1
 * `buildCheckCircuit()` は故障注入済みのネットリストも返すが、Worker は自分で
 * `toNetlist()` するので、ここでは**盤と故障の指定**だけを渡す（同じ故障が二重に入らない）。
 */
export function checkLoadFor(problem: InspectPartsProblem, partId: string): CheckLoadResult {
  const built = buildCheckCircuit(problem, JIPM_BOARD, partId);
  if (!built.ok) return built;
  const part = problem.parts.find((p) => p.id === partId);
  if (part === undefined) {
    return { ok: false, errors: [{ path: 'parts', message: `部品が見つかりません: ${partId}` }] };
  }
  const fault = truthFault(problem, part);
  return {
    ok: true,
    session: built.value.session,
    partFaults: fault === undefined ? [] : [fault],
    group: built.value.group,
    settleMs: checkSettleMs(part.kind),
  };
}

/** マークシートの1行（**本当の状態は入れない**。答えが漏れる）。§9.1 回答 */
export interface MarkSheetRow {
  partId: string;
  kind: MountableKind;
  answer: PartTruth | undefined;
}

/** マークシートの行を作る。並びは課題の `parts` の順。§9.1 */
export function markSheetRows(
  problem: InspectPartsProblem,
  answers: readonly InspectPartAnswer[],
): MarkSheetRow[] {
  const byId = new Map(answers.map((a) => [a.partId, a.answer] as const));
  return problem.parts.map((part) => ({
    partId: part.id,
    kind: part.kind,
    answer: byId.get(part.id),
  }));
}

/** 解答済みの部品の数（課題に無い部品IDは数えない）。§9.1 */
export function answeredCount(
  problem: InspectPartsProblem,
  answers: readonly InspectPartAnswer[],
): number {
  const ids = new Set(problem.parts.map((p) => p.id));
  const answered = new Set<string>();
  for (const answer of answers) {
    if (ids.has(answer.partId)) answered.add(answer.partId);
  }
  return answered.size;
}

/** プローブの置き場所のショートカット1件。 */
export interface ProbeTarget {
  /** `coil` / `a1`〜`a4` / `b1`〜`b4`。 */
  id: string;
  black: TerminalId;
  red: TerminalId;
}

/**
 * §9.1 が測る端子の組（コイル＋4組ぶんの a接点・b接点）。
 *
 * **4組すべてを出す。** 不良を入れた組（`CheckLoadResult.group`）だけを出すと、
 * どの組が怪しいかが画面から漏れて点検にならない（Plan 2A 意図的な差分 #14）。
 * 訓練者は3D盤の端子を直接クリックしてもよく、これは「毎回8本の端子を探さずに済む」
 * ための補助にすぎない。
 */
export function probeTargets(): ProbeTarget[] {
  const out: ProbeTarget[] = [{ id: 'coil', black: CHECK_COIL_MINUS, red: CHECK_COIL_PLUS }];
  for (let group = 1; group <= 4; group += 1) {
    const pins = checkContactTerminals(group);
    out.push({ id: `a${String(group)}`, black: pins.com, red: pins.no });
    out.push({ id: `b${String(group)}`, black: pins.com, red: pins.nc });
  }
  return out;
}
```

- [ ] **Step 4: `worker/protocol.ts` に C1 のコマンドと結果を足す**

`apps/desktop/src/worker/protocol.ts` の import を次に置き換える:

```ts
import type {
  AssembleProblem,
  FaultSpecData,
  InspectPartAnswer,
  InspectPartsProblem,
  JudgeAssembleResult,
  JudgeInspectResult,
  ProblemIssue,
} from '@ojt/content';
```

`SimCommand` の `load` の枝を次に置き換える:

```ts
  /**
   * 課題を開く。ネットリストを作り直し、電源OFF・t=0 から回し始める。
   * `partFaults` があれば `toNetlist()` の直後に注入する（C1/C2。§5.4）。部品の故障は
   * `MountedPart` に持たせる場所が無いので、変換のたびに入れ直す必要がある。
   */
  | {
      type: 'load';
      problemId: string;
      session: BoardSession;
      partFaults?: readonly FaultSpecData[];
    }
```

`SimCommand` の末尾（`| { type: 'tester'; action: TesterAction };`）を次に置き換える:

```ts
  | { type: 'tester'; action: TesterAction }
  /** モードC1を判定する（マークシートの採点）。§9.1 */
  | {
      type: 'judgeParts';
      problem: InspectPartsProblem;
      answers: readonly InspectPartAnswer[];
      elapsedMs: number;
    };
```

`SimMessage` の `judgeResult` の**直後**に次を挿入する:

```ts
  | { type: 'inspectResult'; result: InspectOutcome }
```

`SimMessage` の**直前**に次を足す:

```ts
/**
 * C1/C2 の判定結果。§9.1 / §9.2 / §13 #2
 * `ok: false` は「課題データの誤りで判定できなかった」ことを表す（C1では起きないが、
 * C2の模範回路が作れない場合があるので、結果画面へ行かず理由を出せるようにしておく）。
 */
export type InspectOutcome =
  | { ok: true; value: JudgeInspectResult }
  | { ok: false; errors: ProblemIssue[] };
```

- [ ] **Step 5: `worker/sim.worker.ts` に故障注入と C1 判定を足す**

`apps/desktop/src/worker/sim.worker.ts` の `@ojt/content` の import を次に置き換える:

```ts
import { injectPartFaults, judgeAssemble, judgeInspectParts } from '@ojt/content';
import type { FaultSpecData } from '@ojt/content';
```

`load()` の宣言を次に置き換える（`session` と `partFaults` を受ける形にする）:

```ts
/**
 * 課題を開く。ネットリストを作り直し、電源OFF・t=0 から回し始める。
 * 部品の故障（C1/C2）はここで注入する。以後 `addWire` などの差分コマンドはネットリストの
 * 同じ実体に当たるので、故障は入れ直さなくてよい（`plug` だけは新しい部品を作る＝良品に
 * 差し替えるのと同じで、それが §9.2 の「部品交換」そのものになる）。
 */
function load(next: BoardSession, partFaults: readonly FaultSpecData[] = []): void {
  session = next;
  const netlist = toNetlist(next, JIPM_BOARD);
  const issues = injectPartFaults(netlist, partFaults);
  if (issues.length > 0) {
    throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join(' / '));
  }
  simulation = new Simulation(netlist, { tickMs: TICK_MS });
  logCursor = 0;
  hazardCursor = 0;
  chatterCursor = 0;
  // プローブだけ外し、つまみとレンジは残す（Task 3 の判断。§9.1 の部品の挿し替え）
  tester = applyTesterAction(
    applyTesterAction(tester, { type: 'place-probe', probe: 'red', terminal: undefined }),
    { type: 'place-probe', probe: 'black', terminal: undefined },
  );
  testerReading = readTester(simulation, tester);
}
```

`handle()` の `load` の分岐を次に置き換える:

```ts
  if (command.type === 'load') {
    load(command.session, command.partFaults ?? []);
    start();
    return;
  }
```

`handle()` の `case 'judge':` ブロックの**直後**（`}` の後ろ、`switch` の閉じ括弧の直前）に次を足す:

```ts
    case 'judgeParts': {
      /*
       * C1の採点は解答の突き合わせだけなので速いが、危険操作の回数（§5.6）は
       * `sim.events.hazards()` にしか無いので Worker で判定する（モードBと同じ流儀）。
       */
      const result = judgeInspectParts(command.problem, command.answers, {
        elapsedMs: command.elapsedMs,
        sessionHazards: sim.events.hazards(),
      });
      post({ type: 'inspectResult', result: { ok: true, value: result } });
      break;
    }
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-parts-session.test.ts test/sim-worker-inspect.test.ts test/sim-worker.test.ts test/sim-worker-tester.test.ts --no-file-parallelism
```

Expected: `Test Files  4 passed (4)`。`inspect-parts-session` 8件、`sim-worker-inspect` 11件、既存の Worker テストもそのまま通る。

- [ ] **Step 7: コミットする**

```powershell
git add apps/desktop/src/renderer/session/inspect-parts.ts apps/desktop/src/worker/protocol.ts apps/desktop/src/worker/sim.worker.ts apps/desktop/test/inspect-parts-session.test.ts apps/desktop/test/sim-worker-inspect.test.ts
git commit -m @'
feat(desktop): load faulted check circuits and judge mode C1 in the worker

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 9: C1 のマークシート・トレイ・判定表ヘルプ

**Files:**
- Create: `apps/desktop/src/renderer/panels/MarkSheetPanel.tsx`
- Create: `apps/desktop/src/renderer/panels/CheckTrayPanel.tsx`
- Create: `apps/desktop/src/renderer/panels/DiagnosisHelp.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/mark-sheet.test.tsx`

§9.1 の右パネル3点（部品トレイ／マークシート／判定表ヘルプ）を作る。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| トレイ | 部品IDと種別（リレー／タイマ）を並べ、「挿す」で `onSelect(partId)`、挿している部品には「外す」を出す | §9.1「部品をチェック用ソケットに挿す … 部品を外して次へ」 |
| マークシート | 部品 × 7択の**ラジオボタン**（同じ `name` で排他） | §9.1 回答 / §17.2 #5 |
| 7択の並び | `PART_TRUTHS` の順（正常・コイル断線・レアショート・a導通不良・a溶着・b導通不良・b溶着） | Plan 2A の `PART_TRUTH_LABELS` |
| ヘルプ | `DIAGNOSIS_TABLE` の7行＋レアショートの補足＋しきい値（`552.5Ω`）を `<details>` で折りたたむ | §9.1 ヘルプ |
| 未解答 | 「n/m 解答済み」を出し、判定ボタンは未解答があっても押せる（未解答は不正解として数える。Plan 2A `judgeInspectParts`） | §9.1 判定「n/m 正解」 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/mark-sheet.test.tsx`:

```tsx
import { BUILTIN_INSPECT_PARTS_PROBLEMS, PART_TRUTHS } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckTrayPanel } from '../src/renderer/panels/CheckTrayPanel.js';
import { DiagnosisHelp } from '../src/renderer/panels/DiagnosisHelp.js';
import { MarkSheetPanel } from '../src/renderer/panels/MarkSheetPanel.js';

/**
 * モードC1の右パネル（Plan 2B Task 9）。設計仕様 §9.1 / §17.2 #5。
 */

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

afterEach(() => {
  cleanup();
});

describe('CheckTrayPanel（§9.1 トレイ）', () => {
  it('部品を並べ、「挿す」で選べる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const onSelect = vi.fn();
    render(
      <CheckTrayPanel
        problem={C1}
        checkPartId={undefined}
        onSelect={onSelect}
        onEject={vi.fn()}
      />,
    );
    const first = C1.parts[0];
    if (first === undefined) return;
    expect(screen.getByTestId(`tray-${first.id}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId(`plug-${first.id}`));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });

  it('挿している部品には「外す」が出る', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    const onEject = vi.fn();
    render(
      <CheckTrayPanel
        problem={C1}
        checkPartId={first.id}
        onSelect={vi.fn()}
        onEject={onEject}
      />,
    );
    fireEvent.click(screen.getByTestId(`eject-${first.id}`));
    expect(onEject).toHaveBeenCalledTimes(1);
  });

  it('本当の状態は画面に出さない（答えが漏れない）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <CheckTrayPanel problem={C1} checkPartId={undefined} onSelect={vi.fn()} onEject={vi.fn()} />,
    );
    const text = screen.getByTestId('check-tray').textContent ?? '';
    expect(text).not.toContain('レアショート');
    expect(text).not.toContain('コイル断線');
  });
});

describe('MarkSheetPanel（§9.1 回答 / §17.2 #5）', () => {
  it('部品ごとに7択のラジオを出す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(<MarkSheetPanel problem={C1} answers={[]} onAnswer={vi.fn()} />);
    const first = C1.parts[0];
    if (first === undefined) return;
    for (const truth of PART_TRUTHS) {
      expect(screen.getByTestId(`answer-${first.id}-${truth}`)).toBeTruthy();
    }
  });

  it('選ぶと onAnswer が呼ばれる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const onAnswer = vi.fn();
    render(<MarkSheetPanel problem={C1} answers={[]} onAnswer={onAnswer} />);
    const first = C1.parts[0];
    if (first === undefined) return;
    fireEvent.click(screen.getByTestId(`answer-${first.id}-coil-open`));
    expect(onAnswer).toHaveBeenCalledWith(first.id, 'coil-open');
  });

  it('同じ部品の選択は排他になる（radio の name が部品ごと）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(
      <MarkSheetPanel
        problem={C1}
        answers={[{ partId: first.id, answer: 'a-weld' }]}
        onAnswer={vi.fn()}
      />,
    );
    const checked = screen.getByTestId(`answer-${first.id}-a-weld`) as HTMLInputElement;
    const other = screen.getByTestId(`answer-${first.id}-normal`) as HTMLInputElement;
    expect(checked.checked).toBe(true);
    expect(other.checked).toBe(false);
    expect(checked.name).toBe(other.name);
  });

  it('解答済みの件数を出す（§9.1 判定の n/m）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(
      <MarkSheetPanel
        problem={C1}
        answers={[{ partId: first.id, answer: 'normal' }]}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByTestId('answered-count').textContent).toContain(
      `1 / ${String(C1.parts.length)}`,
    );
  });
});

describe('DiagnosisHelp（§9.1 ヘルプ）', () => {
  it('判定表の7行としきい値を出す', () => {
    render(<DiagnosisHelp />);
    const table = screen.getByTestId('diagnosis-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(screen.getByTestId('diagnosis-note').textContent).toContain('552.5');
  });

  it('既定では折りたたまれている', () => {
    render(<DiagnosisHelp />);
    expect((screen.getByTestId('diagnosis-help') as HTMLDetailsElement).open).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/mark-sheet.test.tsx
```

Expected: 失敗。`Failed to resolve import "../src/renderer/panels/CheckTrayPanel.js"` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `i18n/ja.ts` に C1 の文言を足す**

`apps/desktop/src/renderer/i18n/ja.ts` の `tester: { … },` の**直後**に次を挿入する:

```ts
  /** モードC1（部品点検）。§9.1 */
  inspectParts: {
    tray: '部品トレイ',
    plug: 'チェック用ソケットに挿す',
    eject: '外す',
    /** いま挿している部品。 */
    mounted: '点検中',
    markSheet: 'マークシート（不良原因を選ぶ）',
    part: '部品',
    cause: '不良原因',
    answered: '解答済み',
    /** 判定表ヘルプの見出し。§9.1 */
    help: '判定表（切り分けの手順）',
    situation: 'チェック状況',
    /** 判定表の補足（レアショートは動作では見分けられない）。§9.1 補足 */
    layerShortNote:
      'レアショートのコイルは通常どおり励磁・復帰し、接点も正常に開閉します。動作を見るだけでは' +
      '正常品と区別できないため、正常に見えた部品も必ずコイル抵抗を測ります。' +
      '判定のしきい値は正常値 650Ω の85%（＝552.5Ω）で、これ以下をレアショートとします。',
    /** 測定手順の要約（パネル上部に出す）。§9.1 切り分け手順 */
    steps:
      '①赤PB（PB4）を押して吸引するか見る ②励磁ON/OFFで a接点・b接点の導通を測る ' +
      '③正常に見えてもコイル抵抗（CHK.13–CHK.14）を必ず測る',
    /** プローブの置き場所ショートカットの見出し。§9.1 */
    probeShortcut: 'プローブを当てる',
    coil: 'コイル',
    /** 赤PBを押したままΩを当てると危険操作になる、の注意。§9.1 測定1 */
    ohmSafeNote: '赤PB（PB4）を離していれば、通電したままでもコイル抵抗を安全に測れます',
  },
```

同ファイルの `mistakeCountText()` の**直後**に次を足す:

```ts
/** 接点の組のプローブ位置の表示（`1組 a接点`）。§9.1 */
export function contactProbeLabel(group: number, contact: 'a' | 'b'): string {
  return `${String(group)}組 ${contact}接点`;
}

/** 解答済みの件数（`3 / 6`）。§9.1 */
export function answeredText(answered: number, total: number): string {
  return `${JA.inspectParts.answered} ${String(answered)} / ${String(total)}`;
}

/** 部品トレイの1行（`p1（リレー）`）。§9.1 */
export function trayPartLabel(partId: string, isTimer: boolean): string {
  return `${partId}（${isTimer ? JA.session.timer : JA.session.relay}）`;
}
```

- [ ] **Step 4: `panels/CheckTrayPanel.tsx` を作る**

`apps/desktop/src/renderer/panels/CheckTrayPanel.tsx`:

```tsx
import type { InspectPartsProblem } from '@ojt/content';
import type { JSX } from 'react';
import { JA, trayPartLabel } from '../i18n/ja.js';
import styles from './tester.module.css';

/**
 * モードC1の部品トレイ。設計仕様 §9.1。
 * トレイに並ぶのは課題の `parts`。**本当の状態（`truth`）は決して描かない**（答えが漏れる）。
 * 挿す・外すは1個ずつで、挿すたびに盤とシミュレーションを作り直す（§9.1「部品を外して次へ」）。
 */
export function CheckTrayPanel({
  problem,
  checkPartId,
  onSelect,
  onEject,
}: {
  problem: InspectPartsProblem;
  /** いまチェック用ソケットに挿している部品のID。 */
  checkPartId: string | undefined;
  onSelect: (partId: string) => void;
  onEject: () => void;
}): JSX.Element {
  return (
    <section className={styles.panel} data-testid="check-tray">
      <h2 className={styles.title}>{JA.inspectParts.tray}</h2>
      <p className={styles.hint}>{JA.inspectParts.steps}</p>
      {problem.parts.map((part) => {
        const active = part.id === checkPartId;
        return (
          <div
            key={part.id}
            className={`${styles.trayRow} ${active ? styles.trayActive : ''}`}
            data-testid={`tray-${part.id}`}
          >
            <span className={styles.trayName}>
              {trayPartLabel(part.id, part.kind === 'timer-h3y4')}
            </span>
            {active ? (
              <>
                <span className={styles.label}>{JA.inspectParts.mounted}</span>
                <button type="button" data-testid={`eject-${part.id}`} onClick={onEject}>
                  {JA.inspectParts.eject}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid={`plug-${part.id}`}
                onClick={() => {
                  onSelect(part.id);
                }}
              >
                {JA.inspectParts.plug}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 5: `panels/MarkSheetPanel.tsx` を作る**

`apps/desktop/src/renderer/panels/MarkSheetPanel.tsx`:

```tsx
import {
  PART_TRUTH_LABELS,
  PART_TRUTHS,
  type InspectPartAnswer,
  type InspectPartsProblem,
  type PartTruth,
} from '@ojt/content';
import type { JSX } from 'react';
import { answeredText, JA, trayPartLabel } from '../i18n/ja.js';
import { answeredCount, markSheetRows } from '../session/inspect-parts.js';
import styles from './tester.module.css';

/**
 * モードC1のマークシート。設計仕様 §9.1 / §17.2 #5。
 * 部品 × ｛正常 ＋ 不良原因6種｝の**排他選択**（radio。同じ部品の選択肢が同じ `name` を持つ）。
 * 未解答のまま判定してもよい（未解答は不正解として数える。Plan 2A `judgeInspectParts`）。
 */
export function MarkSheetPanel({
  problem,
  answers,
  onAnswer,
}: {
  problem: InspectPartsProblem;
  answers: readonly InspectPartAnswer[];
  onAnswer: (partId: string, answer: PartTruth) => void;
}): JSX.Element {
  const rows = markSheetRows(problem, answers);
  return (
    <section className={styles.panel} data-testid="mark-sheet">
      <h2 className={styles.title}>{JA.inspectParts.markSheet}</h2>
      <p className={styles.label} data-testid="answered-count">
        {answeredText(answeredCount(problem, answers), problem.parts.length)}
      </p>
      <table className={styles.markTable}>
        <thead>
          <tr>
            <th>{JA.inspectParts.part}</th>
            <th>{JA.inspectParts.cause}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.partId}>
              <td>{trayPartLabel(row.partId, row.kind === 'timer-h3y4')}</td>
              <td>
                {PART_TRUTHS.map((truth) => (
                  <label key={truth} style={{ display: 'block' }}>
                    <input
                      type="radio"
                      name={`mark-${row.partId}`}
                      data-testid={`answer-${row.partId}-${truth}`}
                      checked={row.answer === truth}
                      onChange={() => {
                        onAnswer(row.partId, truth);
                      }}
                    />{' '}
                    {PART_TRUTH_LABELS[truth]}
                  </label>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 6: `panels/DiagnosisHelp.tsx` を作る**

`apps/desktop/src/renderer/panels/DiagnosisHelp.tsx`:

```tsx
import { DIAGNOSIS_TABLE, layerShortThresholdOhms, PART_TRUTH_LABELS } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './tester.module.css';

/**
 * モードC1の判定表ヘルプ。設計仕様 §9.1（ヘルプ）。
 * 表そのものは Plan 2A の `DIAGNOSIS_TABLE`（7行）が唯一の源で、ここは折りたたんで描くだけ。
 * しきい値も `layerShortThresholdOhms()` から引くので、コイル抵抗の前提が変われば表示も動く。
 */
export function DiagnosisHelp(): JSX.Element {
  return (
    <details className={`${styles.panel} ${styles.help}`} data-testid="diagnosis-help">
      <summary>{JA.inspectParts.help}</summary>
      <table className={styles.helpTable} data-testid="diagnosis-table">
        <thead>
          <tr>
            <th>{JA.inspectParts.situation}</th>
            <th>{JA.inspectParts.cause}</th>
          </tr>
        </thead>
        <tbody>
          {DIAGNOSIS_TABLE.map((row) => (
            <tr key={`${row.cause}-${row.situation}`}>
              <td>{row.situation}</td>
              <td>{PART_TRUTH_LABELS[row.cause]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.hint} data-testid="diagnosis-note">
        {JA.inspectParts.layerShortNote}（{layerShortThresholdOhms().toFixed(1)} Ω）
      </p>
      <p className={styles.hint}>{JA.inspectParts.ohmSafeNote}</p>
    </details>
  );
}
```

- [ ] **Step 7: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/mark-sheet.test.tsx
```

Expected: `Test Files  1 passed (1)` / `Tests  9 passed (9)`。

- [ ] **Step 8: コミットする**

```powershell
git add apps/desktop/src/renderer/panels/CheckTrayPanel.tsx apps/desktop/src/renderer/panels/MarkSheetPanel.tsx apps/desktop/src/renderer/panels/DiagnosisHelp.tsx apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test/mark-sheet.test.tsx
git commit -m @'
feat(desktop): add the mode C1 tray, mark sheet and diagnosis help

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 10: モードC1 のセッション画面

**Files:**
- Create: `apps/desktop/src/renderer/screens/InspectPartsSession.tsx`
- Create: `apps/desktop/src/renderer/screens/SessionRoute.tsx`
- Modify: `apps/desktop/src/renderer/session/tester.ts`
- Modify: `apps/desktop/src/renderer/session/worker-bridge.ts`
- Modify: `apps/desktop/src/renderer/panels/Toolbar.tsx`
- Modify: `apps/desktop/src/renderer/panels/ProblemPanel.tsx`
- Modify: `apps/desktop/src/renderer/panels/TesterPanel.tsx`
- Modify: `apps/desktop/src/renderer/app/routes.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/inspect-parts-screen.test.tsx`

§9.1 の画面を組み上げる。3Dで端子をクリックしてプローブを置き、赤PBで励磁し、テスターで測り、マークシートに答えて判定する。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| 画面の振り分け | `renderRoute('session')` が `SessionRoute` を返し、そこで `problem.mode` を見て3画面へ分ける | §12.1。`Session.tsx`（モードB）は名前も中身もそのまま残す |
| ツールバー | 既存の `Toolbar` に `showWireTools?: boolean`（既定 true）と `extraTools?` を足して使い回す | 「戻る／視点／保存／読込／判定」は3モード共通。画面ごとにツールバーを作ると文言と `data-testid` が3重になる |
| 部品の挿抜 | `checkPartId` が変わったら `checkLoadFor()` → `load` を送り直す | §9.1（Task 8 の決定） |
| プローブ | 3D端子クリック（物理ID）→ `toNetlistTerminal()` で役割IDへ → `testerPickToAction()` → `dispatchTester()` | §6.4 / §9.3 |
| ショートカット | `T`＝テスターモード、`B`/`R`＝次に置くプローブ、`0`＝0Ω調整、`Esc`＝プローブを両方外す、`1`/`2`/`3`＝視点 | §8.2 のキーボード操作を踏襲（§15 アクセシビリティ） |
| 判定 | `judgeParts` を送り、`inspectResult` を受けて結果画面へ | §9.1 判定 |

- [ ] **Step 1: 失敗するテストを書く**

`Session.tsx` の非 assemble ガード（Batch 1 修正）は SessionRoute 導入後も安全網として残す。

`apps/desktop/test/inspect-parts-screen.test.tsx`:

```tsx
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_PARTS_PROBLEMS } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { InspectPartsSession } from '../src/renderer/screens/InspectPartsSession.js';
import { testerShortcut } from '../src/renderer/session/tester.js';

/**
 * モードC1のセッション画面（Plan 2B Task 10）。設計仕様 §9.1 / §9.3 / §12.1。
 * 3D（`BoardScene`）は WebGL を要るので差し替え、`onPick` だけを取り出して検証する。
 */

const sent: Array<Record<string, unknown>> = [];
const picks: Array<(hit: unknown) => void> = [];

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    start: () => undefined,
    stop: () => undefined,
    send: (command: Record<string, unknown>) => {
      sent.push(command);
    },
  },
}));

vi.mock('../src/renderer/three/BoardScene.js', () => ({
  BoardScene: ({ onPick }: { onPick: (hit: unknown) => void }) => {
    picks.push(onPick);
    return <div data-testid="board-canvas" />;
  },
  safeRoutes: () => ({ routes: [], errors: [] }),
}));

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

beforeEach(() => {
  sent.length = 0;
  picks.length = 0;
  if (C1 !== undefined) useStore.getState().openProblem(C1);
});

afterEach(() => {
  cleanup();
});

describe('画面の骨格（§9.1）', () => {
  it('トレイ・テスター・マークシート・判定表ヘルプを並べる', () => {
    render(<InspectPartsSession />);
    expect(screen.getByTestId('check-tray')).toBeTruthy();
    expect(screen.getByTestId('tester-panel')).toBeTruthy();
    expect(screen.getByTestId('mark-sheet')).toBeTruthy();
    expect(screen.getByTestId('diagnosis-help')).toBeTruthy();
  });

  it('配線の道具は出さない（C1は配線しない）', () => {
    render(<InspectPartsSession />);
    expect(screen.queryByRole('button', { name: '削除モード' })).toBeNull();
  });
});

describe('部品の挿抜（§9.1）', () => {
  it('「挿す」で load を送り直し、ストアに記録する', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId(`plug-${first.id}`));
    expect(useStore.getState().checkPartId).toBe(first.id);
    const load = sent.filter((c) => c['type'] === 'load').at(-1);
    expect(load).toBeDefined();
    expect((load?.['session'] as { mounted: Record<string, unknown> }).mounted['S7']).toBeDefined();
  });

  it('「外す」で空のチェック用盤に戻る', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId(`plug-${first.id}`));
    fireEvent.click(screen.getByTestId(`eject-${first.id}`));
    expect(useStore.getState().checkPartId).toBeUndefined();
    const load = sent.filter((c) => c['type'] === 'load').at(-1);
    expect((load?.['session'] as { mounted: Record<string, unknown> }).mounted).toEqual({});
  });
});

describe('プローブの配置（§9.3）', () => {
  it('3Dの端子クリックは役割IDに直して Worker へ送る（§6.4）', () => {
    render(<InspectPartsSession />);
    const onPick = picks.at(-1);
    expect(onPick).toBeDefined();
    if (onPick === undefined) return;
    // 3D盤が返すのは物理端子ID（S7.13）。ネットリストは役割ID（CHK.13）で組まれている
    onPick({ kind: 'terminal', id: toTerminalId('S7.13'), wirable: false, label: 'CHK ⑬ −' });
    expect(useStore.getState().tester.black).toBe('CHK.13');
    expect(sent).toContainEqual({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: 'CHK.13' },
    });
    expect(useStore.getState().nextProbe).toBe('red');
  });

  it('2本目は赤になり、同じ端子をもう一度押すと外れる', () => {
    render(<InspectPartsSession />);
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    onPick({ kind: 'terminal', id: toTerminalId('S7.13'), wirable: false, label: 'a' });
    onPick({ kind: 'terminal', id: toTerminalId('S7.14'), wirable: false, label: 'b' });
    expect(useStore.getState().tester.red).toBe('CHK.14');
    onPick({ kind: 'terminal', id: toTerminalId('S7.14'), wirable: false, label: 'b' });
    expect(useStore.getState().tester.red).toBeUndefined();
  });

  it('押ボタンは押せる（赤PBで励磁しながら測る。§9.1）', () => {
    render(<InspectPartsSession />);
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    onPick({ kind: 'pushbutton', id: 'PB4' });
    expect(sent).toContainEqual({ type: 'press', pbId: 'PB4' });
  });

  it('プローブのショートカットボタンで2本まとめて置ける', () => {
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId('probe-target-coil'));
    expect(useStore.getState().tester.black).toBe('CHK.13');
    expect(useStore.getState().tester.red).toBe('CHK.14');
  });
});

describe('testerShortcut（§8.2 キーボード）', () => {
  it('0 は0Ω調整', () => {
    expect(testerShortcut('0')).toEqual({ type: 'zero-adjust' });
  });

  it('知らないキーは undefined', () => {
    expect(testerShortcut('q')).toBeUndefined();
  });

  it('大文字小文字を問わない', () => {
    expect(testerShortcut('B')).toEqual({ type: 'next-probe', probe: 'black' });
    expect(testerShortcut('r')).toEqual({ type: 'next-probe', probe: 'red' });
  });
});

describe('判定（§9.1）', () => {
  it('判定ボタンで judgeParts を送る', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(<InspectPartsSession />);
    const first = C1.parts[0];
    if (first === undefined) return;
    fireEvent.click(screen.getByTestId(`answer-${first.id}-normal`));
    fireEvent.click(screen.getByTestId('judge-button'));
    const judge = sent.find((c) => c['type'] === 'judgeParts');
    expect(judge).toBeDefined();
    expect((judge?.['answers'] as unknown[]).length).toBe(1);
    expect(useStore.getState().judging).toBe(true);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-parts-screen.test.tsx
```

Expected: 失敗。`Failed to resolve import "../src/renderer/screens/InspectPartsSession.js"` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `session/tester.ts` にキーボードの割当を足す**

`apps/desktop/src/renderer/session/tester.ts` の末尾に次を足す:

```ts
/** キーボードでできるテスター操作。§8.2 / §9.3 */
export type TesterShortcut =
  | { type: 'zero-adjust' }
  | { type: 'next-probe'; probe: ProbeSide }
  | { type: 'lift-both' };

/**
 * キー1つをテスター操作に直す（知らないキーは undefined）。§8.2 / §15 アクセシビリティ
 *
 * 割当: `b`＝次は黒プローブ、`r`＝次は赤プローブ、`0`＝0Ω調整、`Escape`＝両方外す。
 * 視点（`1`/`2`/`3`）と削除（`Delete`）は盤側の割当（Plan 1D1）なのでここでは扱わない。
 */
export function testerShortcut(key: string): TesterShortcut | undefined {
  switch (key.toLowerCase()) {
    case 'b':
      return { type: 'next-probe', probe: 'black' };
    case 'r':
      return { type: 'next-probe', probe: 'red' };
    case '0':
      return { type: 'zero-adjust' };
    case 'escape':
      return { type: 'lift-both' };
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: `worker-bridge.ts` に C1/C2 判定の配送を足す**

`apps/desktop/src/renderer/session/worker-bridge.ts` の `BridgeHandlers` を次に置き換える:

```ts
/** ブリッジの購読先。 */
export interface BridgeHandlers {
  onSnapshot: (snapshot: SimSnapshot) => void;
  onJudge: (message: Extract<SimMessage, { type: 'judgeResult' }>) => void;
  /**
   * モードC1/C2の判定結果。§9.1 / §9.2
   * モードBの画面は渡さないので任意にする（届いても何も起きない）。
   */
  onInspect?: (message: Extract<SimMessage, { type: 'inspectResult' }>) => void;
  /**
   * エラー。`fatal` が真なら追従ループが止まっている（Worker の異常終了も含む）。
   * 呼び出し側は例外バナーを出して立て直せるようにする。§13 #6
   */
  onError: (message: string, fatal: boolean) => void;
}
```

`worker.onmessage` の中身を次に置き換える:

```ts
    worker.onmessage = (event: MessageEvent<SimMessage>) => {
      const message = event.data;
      if (message.type === 'snapshot') handlers.onSnapshot(message.snapshot);
      else if (message.type === 'judgeResult') handlers.onJudge(message);
      else if (message.type === 'inspectResult') handlers.onInspect?.(message);
      else handlers.onError(message.message, message.fatal);
    };
```

- [ ] **Step 5: `Toolbar` を3モードで使い回せるようにする**

`apps/desktop/src/renderer/panels/Toolbar.tsx` の props の `allowedColors: readonly WireColor[];` の**直後**に次を足す:

```ts
  /**
   * 配線の道具（線色・削除モード）を出すか。§8.1 / §9.1
   * モードC1は盤に配線しないので出さない（既定は出す）。
   */
  showWireTools?: boolean;
  /** モード固有の道具（テスター／指摘モードの切替など）を差し込む枠。§9.2 / §9.3 */
  extraTools?: JSX.Element;
```

関数の引数リストの `allowedColors,` の**直後**に次を足す:

```ts
  showWireTools = true,
  extraTools,
```

`<div className={styles.toolGroup}>` で始まる線色のグループ全体（`{JA.session.deleteMode}` を含む `</div>` まで）を次に置き換える:

```tsx
      {showWireTools ? (
        <div className={styles.toolGroup}>
          <span className={styles.toolLabel}>{JA.session.wireColor}</span>
          {allowedColors.map((color) => (
            <button
              key={color}
              type="button"
              aria-pressed={mode === 'wire' && wireColor === color}
              onClick={() => {
                onWireColor(color);
                onMode('wire');
              }}
            >
              {color}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={mode === 'delete'}
            onClick={() => {
              onMode(mode === 'delete' ? 'wire' : 'delete');
            }}
          >
            {JA.session.deleteMode}
          </button>
        </div>
      ) : null}
      {extraTools === undefined ? null : <div className={styles.toolGroup}>{extraTools}</div>}
```

- [ ] **Step 6: `ProblemPanel` を3モード共通にする**

`apps/desktop/src/renderer/panels/ProblemPanel.tsx` の `import type { AssembleProblem } from '@ojt/content';` を次に置き換える:

```ts
import type { SupportedProblem } from '@ojt/content';
```

同ファイルの関数の引数型を次に置き換える:

```ts
export function ProblemPanel({ problem }: { problem: SupportedProblem }): JSX.Element {
```

- [ ] **Step 7: `TesterPanel` の差し込み位置を直す**

`apps/desktop/src/renderer/panels/TesterPanel.tsx` の `{children}` の行を削除し、`<p className={styles.hint}>{JA.tester.placeHint}</p>` の**直前**に `{children}` を置く（プローブのショートカットはプローブ欄の隣に出したい）。

- [ ] **Step 8: `screens/InspectPartsSession.tsx` を作る**

`apps/desktop/src/renderer/screens/InspectPartsSession.tsx`:

```tsx
import { toNetlistTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { isInspectPartsProblem } from '@ojt/content';
import { useCallback, useEffect, useRef, type JSX } from 'react';
import { ojtApi } from '../app/ojt-api.js';
import { checkSessionFor, useStore } from '../app/store.js';
import { sounds, soundsForSnapshot } from '../audio/sounds.js';
import {
  contactProbeLabel,
  JA,
  openedProblemLog,
  powerLog,
  referenceErrorText,
  workFileSavedText,
} from '../i18n/ja.js';
import { CheckTrayPanel } from '../panels/CheckTrayPanel.js';
import { DiagnosisHelp } from '../panels/DiagnosisHelp.js';
import { ElapsedTimer } from '../panels/ElapsedTimer.js';
import { LogPanel } from '../panels/LogPanel.js';
import { MarkSheetPanel } from '../panels/MarkSheetPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { dispatchTester, TesterPanel } from '../panels/TesterPanel.js';
import { Toolbar } from '../panels/Toolbar.js';
import { WarningBanner } from '../panels/WarningBanner.js';
import { cloneSession } from '../session/commands.js';
import { shouldIgnoreShortcut, type PickHit } from '../session/interaction.js';
import { checkLoadFor, probeTargets } from '../session/inspect-parts.js';
import { testerPickToAction, testerShortcut } from '../session/tester.js';
import { applyWorkFile, toWorkFile } from '../session/work-file.js';
import { bridge } from '../session/worker-bridge.js';
import { BoardScene } from '../three/BoardScene.js';
import styles from './screens.module.css';

/**
 * モードC1（部品点検）のセッション画面。設計仕様 §9.1 / §9.3 / §12.2。
 *
 * モードBとの違いは3つだけである。①盤には**配線しない**（線色パレットも削除モードも出さない）、
 * ②部品はチェック用ソケットに1個ずつ挿し、挿し替えるたびに Worker へ `load` を送り直す、
 * ③3Dの端子クリックは配線ではなく**テスターのプローブ配置**になる。
 *
 * 3Dへ渡すハンドラはすべて `useCallback` で安定させる（§15。毎レンダーで作り直すと
 * `frameloop="demand"` が実質常時描画になる）。
 */

/** 経過時間の更新間隔[ms]。 */
const ELAPSED_INTERVAL_MS = 200;

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * スナップショットの差分から効果音を鳴らす。§15
 * `Session`（モードB）と同じ理由で専用の小さなコンポーネントに切り出す。
 */
function SoundEffects(): null {
  const snapshot = useStore((s) => s.snapshot);
  const previous = useRef<typeof snapshot | undefined>(undefined);
  useEffect(() => {
    for (const kind of soundsForSnapshot(previous.current, snapshot)) sounds.play(kind);
    previous.current = snapshot;
  }, [snapshot]);
  return null;
}

/** プローブの置き場所ショートカット（コイル＋4組ぶんの a/b 接点）。§9.1 */
function ProbeShortcuts(): JSX.Element {
  return (
    <div data-testid="probe-shortcuts">
      <p className={styles.subtitle} style={{ margin: '6px 0 2px', fontSize: 11 }}>
        {JA.inspectParts.probeShortcut}
      </p>
      {probeTargets().map((target) => {
        const label =
          target.id === 'coil'
            ? JA.inspectParts.coil
            : contactProbeLabel(Number(target.id.slice(1)), target.id.startsWith('a') ? 'a' : 'b');
        return (
          <button
            key={target.id}
            type="button"
            data-testid={`probe-target-${target.id}`}
            onClick={() => {
              // 2本まとめて置く（黒＝COM側・赤＝測る側）。§9.1 測定1・測定2
              dispatchTester({ type: 'place-probe', probe: 'black', terminal: target.black });
              dispatchTester({ type: 'place-probe', probe: 'red', terminal: target.red });
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** モードC1のセッション画面。 */
export function InspectPartsSession(): JSX.Element {
  const problem = useStore((s) =>
    s.problem !== undefined && isInspectPartsProblem(s.problem) ? s.problem : undefined,
  );
  const session = useStore((s) => s.session);
  const answers = useStore((s) => s.answers);
  const checkPartId = useStore((s) => s.checkPartId);
  const mode = useStore((s) => s.mode);
  const camera = useStore((s) => s.camera);
  const powered = useStore((s) => s.snapshot.powered);
  const tripped = useStore((s) => s.snapshot.tripped);
  const breakerOn = useStore((s) => s.snapshot.breakerOn);
  const switchOn = useStore((s) => s.snapshot.switchOn);
  const hazards = useStore((s) => s.hazards);
  const chatters = useStore((s) => s.chatters);
  const logLines = useStore((s) => s.logLines);
  const judging = useStore((s) => s.judging);
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const problemId = problem?.id;
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  /*
   * Worker を起こして購読する。モードBと同じく `[problemId, sessionEpoch]` で張り直す。
   * 盤そのものの送信（`load`）は下の効果が `checkPartId` も見て行う。
   */
  useEffect(() => {
    const store = useStore.getState();
    if (store.problem === undefined) return;
    bridge.start({
      onSnapshot: (next) => {
        useStore.getState().applySnapshot(next);
      },
      onJudge: () => {
        // モードC1では届かない（モードBの判定結果）
      },
      onInspect: (message) => {
        const state = useStore.getState();
        state.setJudging(false);
        if (message.result.ok) {
          state.setJudge(message.result.value);
          state.setRoute('result');
        } else {
          state.toast(referenceErrorText(message.result.errors.map((e) => e.message)), 'error');
        }
      },
      onError: (text, fatal) => {
        const state = useStore.getState();
        state.setJudging(false);
        const line = `${JA.error.workerError}: ${text}`;
        if (fatal) state.setFatalError(line);
        else state.toast(line, 'error');
        state.addLog(line);
      },
    });
    store.addLog(openedProblemLog(store.problem.title));
    return () => {
      bridge.stop();
    };
  }, [problemId, sessionEpoch]);

  /*
   * チェック用ソケットの中身が変わるたびに盤を作り直して `load` を送る。§9.1
   * 差分の `plug` / `unplug` ではなく `load` にするのは、部品の故障がネットリスト変換のたびに
   * 入れ直される必要があるためである（§5.4。Task 8 の決定）。
   */
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    if (current === undefined || !isInspectPartsProblem(current)) return;
    /*
     * 盤を作り直すとプローブの端子は新しいネットリストに無いかもしれないので、
     * 画面側でも外す（Worker 側の `load` も同じことをする。Task 3）。つまみとレンジは残すので、
     * Ωレンジに回したまま次の部品を挿して測り続けられる（§9.1 の手順）。
     */
    store.clearProbes();
    if (checkPartId === undefined) {
      const empty = checkSessionFor(current);
      store.setSession(empty);
      bridge.send({ type: 'load', problemId: current.id, session: cloneSession(empty) });
      return;
    }
    const loaded = checkLoadFor(current, checkPartId);
    if (!loaded.ok) {
      store.toast(referenceErrorText(loaded.errors.map((e) => e.message)), 'error');
      store.setCheckPart(undefined);
      return;
    }
    store.setSession(loaded.session);
    bridge.send({
      type: 'load',
      problemId: current.id,
      session: cloneSession(loaded.session),
      partFaults: loaded.partFaults,
    });
    store.addLog(`${JA.inspectParts.mounted}: ${checkPartId}`);
  }, [problemId, sessionEpoch, checkPartId]);

  // 経過時間を定期更新する（§8.1）
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickElapsed();
    }, ELAPSED_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  const onHover = useCallback((id: TerminalId | undefined) => {
    useStore.getState().setHovered(id);
  }, []);
  const onPress = useCallback((pbId: string) => {
    bridge.send({ type: 'press', pbId });
  }, []);
  const onRelease = useCallback((pbId: string) => {
    bridge.send({ type: 'release', pbId });
  }, []);

  /**
   * 3Dのピック → テスター操作。§9.3
   * 3D盤が返すのは**物理端子ID**（`S7.13`）。ネットリストは**役割ID**（`CHK.13`）で組まれて
   * いるので、`toNetlistTerminal()` で直してからプローブの置き場所にする（§6.4。`runAddWire()`
   * と同じ変換をここでも1箇所だけ行う）。
   */
  const onPick = useCallback((hit: PickHit): void => {
    const store = useStore.getState();
    const current = store.session;
    if (current === undefined) return;
    const mapped: PickHit =
      hit.kind === 'terminal'
        ? { ...hit, id: toNetlistTerminal(current.socketRoles, hit.id) }
        : hit;
    const action = testerPickToAction(
      { black: store.tester.black, red: store.tester.red, next: store.nextProbe },
      mapped,
    );
    switch (action.type) {
      case 'placeProbe':
        dispatchTester({ type: 'place-probe', probe: action.probe, terminal: action.terminal });
        break;
      case 'liftProbe':
        if (action.probe === 'both') {
          dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
          dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
          // 空クリックのあとは必ず「次は黒」に戻す（2回の place-probe の順序に依存しない。M-5）
          useStore.getState().setNextProbe('black');
        } else {
          dispatchTester({ type: 'place-probe', probe: action.probe, terminal: undefined });
        }
        break;
      case 'pressButton':
        bridge.send({ type: 'press', pbId: action.pbId });
        break;
      default:
        break;
    }
  }, []);

  // キーボード操作（§8.2 / §9.3）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (shouldIgnoreShortcut(event)) return;
      const store = useStore.getState();
      if (event.key === '1') {
        store.setCamera('front');
        return;
      }
      if (event.key === '2') {
        store.setCamera('top');
        return;
      }
      if (event.key === '3') {
        store.setCamera('socket');
        return;
      }
      // 3種とも明示的に分岐する（`testerShortcut()` は未知のキーを既に上で弾いている）
      const shortcut = testerShortcut(event.key);
      if (shortcut === undefined) return;
      if (shortcut.type === 'next-probe') store.setNextProbe(shortcut.probe);
      else if (shortcut.type === 'zero-adjust') dispatchTester({ type: 'zero-adjust' });
      else if (shortcut.type === 'lift-both') {
        dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
        dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
        // 空クリックと同じく「次は黒」に戻す（§9.1 / §9.3。M-5）
        store.setNextProbe('black');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (problem === undefined || session === undefined) {
    return <div className={styles.center}>{JA.session.noProblem}</div>;
  }

  return (
    <>
      <SoundEffects />
      <WarningBanner />
      <Toolbar
        mode={mode}
        wireColor="青"
        allowedColors={[]}
        showWireTools={false}
        camera={camera}
        canUndo={false}
        canRedo={false}
        onMode={() => undefined}
        onWireColor={() => undefined}
        onCamera={(preset) => {
          useStore.getState().setCamera(preset);
        }}
        onUndo={() => undefined}
        onRedo={() => undefined}
        judging={judging}
        onJudge={() => {
          if (useStore.getState().judging) return;
          useStore.getState().setJudging(true);
          bridge.send({
            type: 'judgeParts',
            problem,
            answers: useStore.getState().answers,
            elapsedMs: useStore.getState().elapsedMs,
          });
        }}
        onBack={() => {
          useStore.getState().setRoute('list');
        }}
        onSave={() => {
          const store = useStore.getState();
          let api: ReturnType<typeof ojtApi>;
          try {
            api = ojtApi();
          } catch (error) {
            store.toast(reasonOf(error), 'error');
            return;
          }
          void api
            .saveWorkFile({
              kind: 'manual',
              file: toWorkFile(problem.id, session, store.elapsedMs, store.hazards.length),
            })
            .then((result) => {
              store.toast(
                result.ok ? workFileSavedText(result.path) : result.message,
                result.ok ? 'info' : 'error',
              );
            });
        }}
        onLoad={() => {
          let api: ReturnType<typeof ojtApi>;
          try {
            api = ojtApi();
          } catch (error) {
            useStore.getState().toast(reasonOf(error), 'error');
            return;
          }
          void api.loadWorkFile({ kind: 'manual' }).then((result) => {
            if (!result.ok) {
              if (!result.canceled) useStore.getState().toast(result.message, 'error');
              return;
            }
            void applyWorkFile(result.file);
          });
        }}
        schematicVisible={false}
        onToggleSchematic={undefined}
      >
        <PowerControls
          breakerOn={breakerOn}
          switchOn={switchOn}
          powered={powered}
          tripped={tripped}
          onBreaker={(on) => {
            bridge.send({ type: 'breaker', on });
            useStore.getState().addLog(powerLog(JA.session.breaker, on));
          }}
          onSwitch={(on) => {
            bridge.send({ type: 'switch', on });
            useStore.getState().addLog(powerLog(JA.session.switch, on));
          }}
          onResetTrip={() => {
            bridge.send({ type: 'resetTrip' });
            useStore.getState().addLog(JA.session.resetTripLog);
          }}
        />
      </Toolbar>

      <div className={styles.sessionLayout}>
        <div className={styles.viewport} data-testid="viewport">
          <BoardScene onPick={onPick} onHover={onHover} onPress={onPress} onRelease={onRelease} />
          <div className={styles.statusOverlay} data-testid="status-overlay">
            {powered ? JA.session.powered : JA.session.unpowered} /{' '}
            {checkPartId === undefined ? JA.inspectParts.tray : `${JA.inspectParts.mounted}: ${checkPartId}`}
            {tripped ? ` / ${JA.session.tripped}` : ''}
          </div>
        </div>

        <div className={styles.rightPanel}>
          <ProblemPanel problem={problem} />
          <CheckTrayPanel
            problem={problem}
            checkPartId={checkPartId}
            onSelect={(partId) => {
              useStore.getState().setCheckPart(partId);
            }}
            onEject={() => {
              useStore.getState().setCheckPart(undefined);
            }}
          />
          <TesterPanel>
            <ProbeShortcuts />
          </TesterPanel>
          <MarkSheetPanel
            problem={problem}
            answers={answers}
            onAnswer={(partId, answer) => {
              useStore.getState().setAnswer(partId, answer);
            }}
          />
          <DiagnosisHelp />
        </div>

        <div className={styles.bottomPanel}>
          <LogPanel
            lines={logLines}
            hazards={hazards}
            chatters={chatters}
            restoredHazardCount={restoredHazardCount}
          />
          <ElapsedTimer limit={problem.timeLimit} />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 9: `screens/SessionRoute.tsx` を作り、`routes.tsx` を差し替える**

`apps/desktop/src/renderer/screens/SessionRoute.tsx`:

```tsx
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { InspectPartsSession } from './InspectPartsSession.js';
import { Session } from './Session.js';
import styles from './screens.module.css';

/**
 * セッション画面の振り分け。設計仕様 §12.1。
 * 課題のモードで画面を選ぶ。モードごとに右パネルの中身も操作の意味（3Dクリック＝配線／
 * プローブ／指摘）も違うので、1画面に条件分岐を積むのではなく画面そのものを分ける。
 */
export function SessionRoute(): JSX.Element {
  const mode = useStore((s) => s.problem?.mode);
  switch (mode) {
    case 'assemble':
      return <Session />;
    case 'inspect-parts':
      return <InspectPartsSession />;
    default:
      return <div className={styles.center}>{JA.session.noProblem}</div>;
  }
}
```

`apps/desktop/src/renderer/app/routes.tsx` の `import { Session } from '../screens/Session.js';` を次に置き換える:

```ts
import { SessionRoute } from '../screens/SessionRoute.js';
```

同ファイルの `case 'session': return <Session />;` を次に置き換える:

```tsx
    case 'session':
      return <SessionRoute />;
```

- [ ] **Step 9a: 視点ショートカットを `useViewportShortcuts()` に揃える**

Blender風の視点ショートカット（上段 1/2/3、テンキー 1/3/7、Ctrl で反対側、Home で全体。§12.2）は、並行して進む視点操作タスク（VIEW-NAV）が `src/renderer/session/viewport-keys.ts` の `useViewportShortcuts({ enabled })` フックへ切り出し、`Session.tsx`（モードB）は既にこれを呼んでいる。`InspectPartsSession.tsx` はまだ独自の `'1'/'2'/'3'` だけの簡易分岐を持っているので、同じフックに揃える。

`apps/desktop/src/renderer/screens/InspectPartsSession.tsx` のキーボード操作の `useEffect` から、視点の3行（`if (event.key === '1') { … } if (event.key === '2') { … } if (event.key === '3') { … }`）を削除し、代わりにコンポーネント先頭（他の `useEffect` の直前）に次を足す:

```ts
  // 視点のショートカットは Session と共通のフックに任せる（§12.2）
  useViewportShortcuts({ enabled: session !== undefined });
```

import に次を足す:

```ts
import { useViewportShortcuts } from '../session/viewport-keys.js';
```

（`viewport-keys.ts` 自体は VIEW-NAV タスクが作る。無ければこのステップは失敗するので、実装順は VIEW-NAV → このステップとする。）

- [ ] **Step 10: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-parts-screen.test.tsx test/routing.test.ts test/app.test.tsx --no-file-parallelism
```

Expected: `Test Files  3 passed (3)`。`inspect-parts-screen` 12件。既存の `routing.test.ts` が `renderRoute('session')` の戻りをコンポーネント名で見ている場合は `SessionRoute` に直す。

- [ ] **Step 11: コミットする**

```powershell
git add apps/desktop/src/renderer/screens/InspectPartsSession.tsx apps/desktop/src/renderer/screens/SessionRoute.tsx apps/desktop/src/renderer/app/routes.tsx apps/desktop/src/renderer/session/tester.ts apps/desktop/src/renderer/session/worker-bridge.ts apps/desktop/src/renderer/panels/Toolbar.tsx apps/desktop/src/renderer/panels/ProblemPanel.tsx apps/desktop/src/renderer/panels/TesterPanel.tsx apps/desktop/test/inspect-parts-screen.test.tsx
git commit -m @'
feat(desktop): add the mode C1 session screen with probe picking

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 11: モードC1 の結果画面

**Files:**
- Create: `apps/desktop/src/renderer/result/InspectPartsResult.tsx`
- Modify: `apps/desktop/src/renderer/screens/Result.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/inspect-parts-result.test.tsx`

§9.1 判定の結果画面（「n/m 正解」と判定表の突き合わせ）を作り、結果画面のルートを `mode` で振り分ける。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| 合否 | 全部品の解答一致で合格。行ごとに◯×を出す | §9.1 判定 |
| 表 | 部品 × ｛あなたの解答／正解｝。未解答は `—` | §9.1 |
| 危険操作 | 既存の `HazardList` を再利用（種別ごとの回数＋合計） | §5.6 / §8.3 |
| 所要時間 | 既存の `elapsedSummaryText()` を再利用 | §8.3 |
| 合否に効かないもの | 危険操作回数・所要時間は参考表示 | §17.2 #3 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/inspect-parts-result.test.tsx`:

```tsx
import { BUILTIN_INSPECT_PARTS_PROBLEMS, type JudgeInspectPartsResult } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectPartsResult } from '../src/renderer/result/InspectPartsResult.js';

/**
 * モードC1の結果画面（Plan 2B Task 11）。設計仕様 §9.1 / §8.3。
 */

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

const NO_HAZARDS = {
  'ohm-on-live': 0,
  'range-exceeded': 0,
  'short-circuit-power-on': 0,
  'power-sequence-violation': 0,
  'over-wires-per-terminal': 0,
  overcurrent: 0,
} as const;

function result(overrides: Partial<JudgeInspectPartsResult> = {}): JudgeInspectPartsResult {
  return {
    mode: 'inspect-parts',
    passed: true,
    correctCount: 2,
    total: 2,
    scores: [
      { partId: 'p1', truth: 'normal', answer: 'normal', correct: true },
      { partId: 'p2', truth: 'coil-open', answer: 'coil-open', correct: true },
    ],
    hazardCount: 0,
    hazardsByKind: { ...NO_HAZARDS },
    elapsedMs: 300_000,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('InspectPartsResult（§9.1 判定）', () => {
  it('全問正解なら合格を出す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result()}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.getByTestId('correct-count').textContent).toContain('2 / 2');
  });

  it('間違いがあれば不合格で、行に正解と解答を並べる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({
          passed: false,
          correctCount: 1,
          scores: [
            { partId: 'p1', truth: 'coil-layer-short', answer: 'normal', correct: false },
            { partId: 'p2', truth: 'coil-open', answer: 'coil-open', correct: true },
          ],
        })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('不合格');
    const table = screen.getByTestId('mark-result-table');
    expect(table.textContent).toContain('レアショート');
    expect(table.textContent).toContain('正常');
    expect(screen.getByTestId('correct-count').textContent).toContain('1 / 2');
  });

  it('未解答は「—」で出す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({
          passed: false,
          correctCount: 1,
          scores: [
            { partId: 'p1', truth: 'normal', answer: undefined, correct: false },
            { partId: 'p2', truth: 'coil-open', answer: 'coil-open', correct: true },
          ],
        })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('answer-p1').textContent).toBe('—');
  });

  it('危険操作の回数を出す（復元分を足す。§5.6 / §12.3）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({
          hazardCount: 2,
          hazardsByKind: { ...NO_HAZARDS, 'ohm-on-live': 2 },
        })}
        restoredHazardCount={1}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('hazard-table').textContent).toContain('通電中のΩ／導通測定');
    expect(screen.getByText(/危険操作（3）/)).toBeTruthy();
  });

  it('「もう一度」「課題一覧へ」が押せる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const onRetry = vi.fn();
    const onBackToList = vi.fn();
    render(
      <InspectPartsResult
        problem={C1}
        result={result()}
        restoredHazardCount={0}
        onRetry={onRetry}
        onBackToList={onBackToList}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
    fireEvent.click(screen.getByRole('button', { name: '課題一覧へ' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onBackToList).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-parts-result.test.tsx
```

Expected: 失敗。`Failed to resolve import "../src/renderer/result/InspectPartsResult.js"` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `i18n/ja.ts` に結果の文言を足す**

`apps/desktop/src/renderer/i18n/ja.ts` の `result:` ブロックの `mistakes: 'ミス',` の**直後**に次を足す:

```ts
    /** モードC1の正解数（§9.1 判定の「n/m 正解」）。 */
    correct: '正解',
    /** 訓練者の解答。§9.1 */
    yourAnswer: 'あなたの解答',
    /** 本当の状態。§9.1 */
    truth: '正解',
    /** マークシートの採点表の見出し。§9.1 */
    markSheet: 'マークシート採点',
    /** 未解答。 */
    unanswered: '—',
```

`apps/desktop/src/renderer/i18n/ja.ts` の `answeredText()` の**直後**に次を足す:

```ts
/** モードC1の正解数（`2 / 6 正解`）。§9.1 判定 */
export function correctCountText(correct: number, total: number): string {
  return `${String(correct)} / ${String(total)} ${JA.result.correct}`;
}
```

- [ ] **Step 4: `result/InspectPartsResult.tsx` を作る**

`apps/desktop/src/renderer/result/InspectPartsResult.tsx`:

```tsx
import {
  PART_TRUTH_LABELS,
  type InspectPartsProblem,
  type JudgeInspectPartsResult,
} from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { correctCountText, elapsedSummaryText, JA, trayPartLabel } from '../i18n/ja.js';
import { HazardList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * モードC1の結果画面。設計仕様 §9.1 判定 / §8.3。
 * 合否は「全部品の解答一致」だけで決まる。危険操作の回数と所要時間は**参考表示**であり、
 * 合否には影響しない（§17.2 #3）。
 */
export function InspectPartsResult({
  problem,
  result,
  restoredHazardCount = 0,
  onRetry,
  onBackToList,
}: {
  problem: InspectPartsProblem;
  result: JudgeInspectPartsResult;
  /** 作業ファイルから復元した危険操作の回数（種別の内訳は復元できないので合計だけ足す）。§12.3 */
  restoredHazardCount?: number;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  const kindOf = new Map(problem.parts.map((p) => [p.id, p.kind] as const));
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span
          className={`${styles.verdict} ${result.passed ? styles.passed : styles.failed}`}
          data-testid="verdict"
          role="status"
          aria-live="polite"
        >
          {result.passed ? JA.result.passed : JA.result.failed}
        </span>
        <h1 className={styles.title}>
          {JA.result.title}: {problem.title}
        </h1>
        <span data-testid="correct-count">
          {correctCountText(result.correctCount, result.total)}
        </span>
        <span data-testid="result-elapsed">
          {JA.result.elapsed} {formatElapsed(elapsedMs)}（
          {elapsedSummaryText(
            elapsedMs,
            problem.timeLimit.standardMin,
            problem.timeLimit.cutoffMin,
          )}
          ）
        </span>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>{JA.result.markSheet}</h2>
          <table className={styles.table} data-testid="mark-result-table">
            <thead>
              <tr>
                <th />
                <th>{JA.inspectParts.part}</th>
                <th>{JA.result.yourAnswer}</th>
                <th>{JA.result.truth}</th>
              </tr>
            </thead>
            <tbody>
              {result.scores.map((score) => (
                <tr key={score.partId}>
                  <td>
                    <span className={score.correct ? styles.badgeOk : styles.badgeNg}>
                      {score.correct ? JA.result.ok : JA.result.ng}
                    </span>
                  </td>
                  <td>
                    {trayPartLabel(score.partId, kindOf.get(score.partId) === 'timer-h3y4')}
                  </td>
                  <td data-testid={`answer-${score.partId}`}>
                    {score.answer === undefined
                      ? JA.result.unanswered
                      : PART_TRUTH_LABELS[score.answer]}
                  </td>
                  <td>{PART_TRUTH_LABELS[score.truth]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <HazardList
          counts={result.hazardsByKind}
          total={result.hazardCount + restoredHazardCount}
        />
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={onRetry}>
          {JA.result.retry}
        </button>
        <button type="button" onClick={onBackToList}>
          {JA.result.toList}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `screens/Result.tsx` を振り分ける**

`apps/desktop/src/renderer/screens/Result.tsx` の import に次を足す（`import { ResultView } from '../result/ResultView.js';` の直前）:

```ts
import { isAssembleProblem, isInspectPartsProblem } from '@ojt/content';
import { InspectPartsResult } from '../result/InspectPartsResult.js';
```

`import { useStore } from '../app/store.js';` を次に置き換える:

```ts
import { isInspectJudge, useStore } from '../app/store.js';
```

`return ( <ResultView … /> );` のブロックを次に置き換える:

```tsx
  /*
   * 判定結果のモードで結果画面を選ぶ。3モードとも `mode` を持つ（Plan 2A I-3）ので、
   * `isInspectJudge()` は `mode` が `'assemble'` 以外かどうかで振り分ける（`store.ts`）。
   * 課題と結果のモードが食い違っている（保存データの取り違え等）ときは、判定が無いのと
   * 同じ扱いにして一覧へ戻せるようにする。
   */
  if (isInspectJudge(judge)) {
    if (judge.mode === 'inspect-parts' && isInspectPartsProblem(problem)) {
      return (
        <InspectPartsResult
          problem={problem}
          result={judge}
          restoredHazardCount={restoredHazardCount}
          onRetry={() => {
            resetSession();
          }}
          onBackToList={() => {
            setRoute('list');
          }}
        />
      );
    }
    return (
      <div className={styles.center}>
        <p>{JA.result.noResult}</p>
        <button
          type="button"
          onClick={() => {
            setRoute('list');
          }}
        >
          {JA.result.toList}
        </button>
      </div>
    );
  }

  if (!isAssembleProblem(problem)) {
    return (
      <div className={styles.center}>
        <p>{JA.result.noResult}</p>
        <button
          type="button"
          onClick={() => {
            setRoute('list');
          }}
        >
          {JA.result.toList}
        </button>
      </div>
    );
  }

  return (
    <ResultView
      problem={problem}
      result={judge}
      restoredHazardCount={restoredHazardCount}
      onRetry={() => {
        resetSession();
      }}
      onBackToList={() => {
        setRoute('list');
      }}
    />
  );
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-parts-result.test.tsx test/result-view.test.tsx --no-file-parallelism
```

Expected: `Test Files  2 passed (2)`。`inspect-parts-result` 5件と既存の結果画面テスト。

- [ ] **Step 7: 全体を確認してコミットする**

```powershell
pnpm --filter @ojt/desktop typecheck
pnpm --filter @ojt/desktop test --no-file-parallelism
```

Expected: `typecheck` は無出力。`test` は全ファイル通る。

```powershell
git add apps/desktop/src/renderer/result/InspectPartsResult.tsx apps/desktop/src/renderer/screens/Result.tsx apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test/inspect-parts-result.test.tsx
git commit -m @'
feat(desktop): show the mode C1 mark sheet result

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 12: モードC2 の Worker 連携（故障入りの盤と判定）

**Files:**
- Create: `apps/desktop/src/renderer/session/inspect-repair.ts`
- Modify: `apps/desktop/src/worker/protocol.ts`
- Modify: `apps/desktop/src/worker/sim.worker.ts`
- Test: `apps/desktop/test/inspect-repair-session.test.ts`, `apps/desktop/test/sim-worker-repair.test.ts`

故障を注入した盤で C2 を回し、指摘と修復を判定する。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| 盤の送り方 | `openProblem()` が作った `RepairCircuit.session` を `load` で送り、`partFaults` に `circuit.applied.partFaults` を載せる | Task 8 と同じ仕組み。`RepairCircuit` は素のJSONなので構造化複製でそのまま Worker へ渡せる |
| 判定 | `{ type: 'judgeRepair'; problem; circuit; reports; elapsedMs }` → `{ type: 'inspectResult'; result }` | §9.2 判定①〜⑤ |
| 判定に渡す盤 | `circuit.session` を**提出時の盤**に差し替えて送る（`judgeInspectRepair()` は `circuit.session` を訓練者の盤として読む） | Plan 2A の `judgeInspectRepair()` の契約 |
| 判定中の一時停止 | モードBの `judge` と同じく `stopLoop()` → `resumeLoop()` | §8.3。模範と訓練者を並走させるので 240〜440ms かかる |
| 部品交換 | 3Dで部品を抜いて挿し直す＝`unplug`＋`plug`。renderer 側で `replacePart()` を通して `circuit` を差し替える | §9.2 部品交換。`plug` は Worker で新しい部品インスタンスを作る＝良品に差し替えるのと同じ |
| 指摘の重複 | 同じ対象・同じ種別の指摘は2件目を受け付けない（トーストで断る） | `scoreReports()` は1つの指摘を1つの故障にしか使わないので、重複はそのまま「過剰指摘」に数えられてしまう。操作ミスを不合格の原因にしない |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/inspect-repair-session.test.ts`:

```ts
import { BUILTIN_INSPECT_REPAIR_PROBLEMS, buildInspectRepairCircuit } from '@ojt/content';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import type { PickHit } from '../src/renderer/session/interaction.js';
import {
  circuitForJudge,
  hasReportFor,
  reportKindsFor,
  reportPickToAction,
} from '../src/renderer/session/inspect-repair.js';

/**
 * モードC2の純関数（Plan 2B Task 12）。設計仕様 §9.2。
 */

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];

/** ソケットID → 役割ID（既定の割当）。 */
function partIdOf(socketId: string): string {
  const table: Record<string, string> = {
    S1: 'CR1',
    S2: 'CR2',
    S3: 'CR3',
    S4: 'T1',
    S5: 'T2',
    S6: 'T3',
    S7: 'CHK',
  };
  return table[socketId] ?? socketId;
}

describe('reportKindsFor（§9.2 指摘の種別）', () => {
  it('電線は 断線 と 誤配線', () => {
    expect(reportKindsFor({ wireId: 'sw-001' })).toEqual(['wire-open', 'wire-misrouted']);
  });

  it('端子は 未配線 だけ（電線が無いので端子で指す。Plan 2A 差分 #6）', () => {
    expect(reportKindsFor({ terminalId: 'CR1.13' })).toEqual(['wire-missing']);
  });

  it('部品は 部品不良 だけ', () => {
    expect(reportKindsFor({ partId: 'CR1' })).toEqual(['part-defect']);
  });
});

describe('reportPickToAction（§9.2）', () => {
  it('電線をクリックすると種別ポップオーバーを開く', () => {
    const hit: PickHit = { kind: 'wire', id: 'sw-003', locked: false };
    expect(reportPickToAction(hit, partIdOf)).toEqual({
      type: 'openReport',
      target: { wireId: 'sw-003' },
    });
  });

  it('既設配線（チェック用回路）は指摘できない', () => {
    const hit: PickHit = { kind: 'wire', id: 'fw-chk-1', locked: true };
    const action = reportPickToAction(hit, partIdOf);
    expect(action.type).toBe('reject');
  });

  it('端子をクリックすると未配線の指摘を開く', () => {
    const hit: PickHit = {
      kind: 'terminal',
      id: toTerminalId('CR1.13'),
      wirable: true,
      label: 'CR1 ⑬ −',
    };
    expect(reportPickToAction(hit, partIdOf)).toEqual({
      type: 'openReport',
      target: { terminalId: 'CR1.13' },
    });
  });

  it('装着済みのソケットをクリックすると部品不良の指摘を開く（役割IDで指す）', () => {
    const hit: PickHit = { kind: 'socket', id: 'S1', occupied: true };
    expect(reportPickToAction(hit, partIdOf)).toEqual({
      type: 'openReport',
      target: { partId: 'CR1' },
    });
  });

  it('空のソケットは指摘できない（部品が無いので不良も無い）', () => {
    const hit: PickHit = { kind: 'socket', id: 'S8', occupied: false };
    expect(reportPickToAction(hit, partIdOf)).toEqual({ type: 'none' });
  });

  it('押ボタンは押せる（動作を確かめながら探す。§9.2）', () => {
    expect(reportPickToAction({ kind: 'pushbutton', id: 'PB1' }, partIdOf)).toEqual({
      type: 'pressButton',
      pbId: 'PB1',
    });
  });

  it('空クリックは何もしない', () => {
    expect(reportPickToAction({ kind: 'empty' }, partIdOf)).toEqual({ type: 'none' });
  });
});

describe('hasReportFor（重複の抑止）', () => {
  it('同じ対象・同じ種別は2件目を弾く', () => {
    const reports = [{ target: { wireId: 'sw-001' }, kind: 'wire-open' as const }];
    expect(hasReportFor(reports, { wireId: 'sw-001' }, 'wire-open')).toBe(true);
    expect(hasReportFor(reports, { wireId: 'sw-001' }, 'wire-misrouted')).toBe(false);
    expect(hasReportFor(reports, { wireId: 'sw-002' }, 'wire-open')).toBe(false);
  });

  it('対象の種類が違えば別物', () => {
    const reports = [{ target: { terminalId: 'CR1.13' }, kind: 'wire-missing' as const }];
    expect(hasReportFor(reports, { partId: 'CR1.13' }, 'wire-missing')).toBe(false);
  });
});

describe('circuitForJudge（§9.2 判定に渡す盤）', () => {
  it('提出時の盤に差し替えた回路を返す（元の回路は変えない）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const circuit = built.value;
    const submitted = { ...circuit.session, wires: circuit.session.wires.slice(0, 1) };
    const forJudge = circuitForJudge(circuit, submitted);
    expect(forJudge.session.wires).toHaveLength(1);
    expect(forJudge.applied).toBe(circuit.applied);
    expect(forJudge.initialWireIds).toBe(circuit.initialWireIds);
    // 元の回路は触らない
    expect(circuit.session.wires.length).toBeGreaterThan(1);
  });
});
```

`apps/desktop/test/sim-worker-repair.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS, buildInspectRepairCircuit } from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { circuitForJudge } from '../src/renderer/session/inspect-repair.js';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * モードC2を Worker で判定する（Plan 2B Task 12）。設計仕様 §9.2 / §16 Phase 2 受入基準③。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));

vi.setConfig({ testTimeout: 30_000 });

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];

interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  send: (command: SimCommand) => void;
  advance: (ms: number, stepMs?: number) => void;
}

async function boot(): Promise<Harness> {
  const posted: SimMessage[] = [];
  const fakeSelf = {
    postMessage: (message: SimMessage) => {
      posted.push(message);
    },
    onmessage: undefined as unknown as (event: { data: SimCommand }) => void,
  };
  Object.defineProperty(globalThis, 'self', {
    value: fakeSelf,
    configurable: true,
    writable: true,
  });
  clock.nowMs = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs);
  vi.resetModules();
  await import('../src/worker/sim.worker.js');
  return {
    posted,
    get snapshots() {
      return posted.filter((m) => m.type === 'snapshot').map((m) => m.snapshot);
    },
    send: (command) => {
      fakeSelf.onmessage({ data: command });
    },
    advance: (ms, stepMs = 4) => {
      let left = ms;
      while (left > 0) {
        const chunk = Math.min(stepMs, left);
        clock.nowMs += chunk;
        vi.advanceTimersByTime(chunk);
        left -= chunk;
      }
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('C2 の盤（§9.2）', () => {
  it('故障入りの盤を load できて回り続ける', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2.id,
      session: built.value.session,
      partFaults: built.value.applied.partFaults,
    });
    h.advance(100);
    h.send({ type: 'breaker', on: true });
    h.send({ type: 'switch', on: true });
    h.advance(200);
    expect(h.snapshots.at(-1)?.powered).toBe(true);
    expect(h.posted.filter((m) => m.type === 'error')).toEqual([]);
  });
});

describe('C2 の判定（§9.2 / §16 Phase 2 受入基準③）', () => {
  it('修復も指摘もしなければ不合格になる', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2.id,
      session: built.value.session,
      partFaults: built.value.applied.partFaults,
    });
    h.advance(100);
    h.send({
      type: 'judgeRepair',
      problem: C2,
      circuit: circuitForJudge(built.value, built.value.session),
      reports: [],
      elapsedMs: 60_000,
    });
    h.advance(50);

    const message = h.posted.find((m) => m.type === 'inspectResult');
    expect(message).toBeDefined();
    if (message === undefined || message.type !== 'inspectResult') return;
    expect(message.result.ok).toBe(true);
    if (!message.result.ok) return;
    const value = message.result.value;
    expect(value.mode).toBe('inspect-repair');
    if (value.mode !== 'inspect-repair') return;
    expect(value.passed).toBe(false);
    // 故障2箇所を1つも指摘していない（§17.2 #4）
    expect(value.reports.missed).toHaveLength(2);
    expect(value.reports.extra).toHaveLength(0);
  });

  it('指摘だけ正しくても修復しなければ不合格（動作が模範と食い違う。§9.2 判定②）', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const reports = built.value.applied.sites.map((site) =>
      site.wireId !== undefined && site.kind !== 'wire-missing'
        ? { target: { wireId: site.wireId }, kind: site.report }
        : site.partId !== undefined
          ? { target: { partId: site.partId }, kind: site.report }
          : { target: { terminalId: String(site.terminals[0]) }, kind: site.report },
    );
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2.id,
      session: built.value.session,
      partFaults: built.value.applied.partFaults,
    });
    h.advance(100);
    h.send({
      type: 'judgeRepair',
      problem: C2,
      circuit: circuitForJudge(built.value, built.value.session),
      reports,
      elapsedMs: 60_000,
    });
    h.advance(50);

    const message = h.posted.find((m) => m.type === 'inspectResult');
    if (message === undefined || message.type !== 'inspectResult') return;
    if (!message.result.ok) return;
    const value = message.result.value;
    if (value.mode !== 'inspect-repair') return;
    expect(value.reports.missed).toHaveLength(0);
    expect(value.reports.extra).toHaveLength(0);
    expect(value.passed).toBe(false);
    expect(value.mismatches.length).toBeGreaterThan(0);
  });

  it('判定中もループは1本のまま（§8.3）', async () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const h = await boot();
    h.send({
      type: 'load',
      problemId: C2.id,
      session: built.value.session,
      partFaults: built.value.applied.partFaults,
    });
    h.advance(200);
    h.send({
      type: 'judgeRepair',
      problem: C2,
      circuit: circuitForJudge(built.value, built.value.session),
      reports: [],
      elapsedMs: 1000,
    });
    h.advance(200);
    expect(vi.getTimerCount()).toBe(1);
    expect(h.snapshots.at(-1)?.droppedTicks).toBe(0);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-repair-session.test.ts test/sim-worker-repair.test.ts --no-file-parallelism
```

Expected: 両方 `Failed to resolve import "../src/renderer/session/inspect-repair.js"` で `Test Files  2 failed (2)`。

- [ ] **Step 3: `src/renderer/session/inspect-repair.ts` を作る**

`apps/desktop/src/renderer/session/inspect-repair.ts`:

```ts
import type { BoardSession, SocketId } from '@ojt/board-model';
import type { FaultReport, FaultReportKind, RepairCircuit } from '@ojt/content';
import { LOCKED_WIRE_MESSAGE, type PickAction, type PickHit, type ReportTarget } from './interaction.js';

/**
 * モードC2（回路点検・修復）の純粋な下ごしらえ。設計仕様 §9.2。
 * React も three も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 */

/**
 * その対象で選べる指摘の種別。§9.2 / Plan 2A 意図的な差分 #6
 * - **電線**: 見えているので断線・誤配線を指せる
 * - **端子**: 未配線（電線そのものが無い）はここでしか指せない
 * - **部品**: 部品不良（どの要素かは問わない）
 */
export function reportKindsFor(target: ReportTarget): FaultReportKind[] {
  if ('wireId' in target) return ['wire-open', 'wire-misrouted'];
  if ('terminalId' in target) return ['wire-missing'];
  return ['part-defect'];
}

/** 2つの対象が同じ場所を指しているか。 */
function sameTarget(a: ReportTarget, b: ReportTarget): boolean {
  if ('wireId' in a) return 'wireId' in b && a.wireId === b.wireId;
  if ('terminalId' in a) return 'terminalId' in b && a.terminalId === b.terminalId;
  return 'partId' in b && a.partId === b.partId;
}

/**
 * 同じ対象・同じ種別の指摘が既にあるか。§9.2
 * `scoreReports()`（Plan 2A）は1つの指摘を1つの故障にしか使わないので、同じ指摘を2回出すと
 * 2件目がそのまま「過剰指摘」になって不合格になる。**操作の取りこぼしで落とさない**ために、
 * 登録の時点で断る。
 */
export function hasReportFor(
  reports: readonly FaultReport[],
  target: ReportTarget,
  kind: FaultReportKind,
): boolean {
  return reports.some((report) => report.kind === kind && sameTarget(report.target, target));
}

/**
 * 指摘モードのピック結果を操作に変換する。§9.2
 * - 電線: 種別ポップオーバーを開く（既設配線＝チェック用回路の3本は指摘できない）
 * - 端子: 未配線の指摘を開く
 * - ソケット: 装着済みなら部品不良の指摘を開く（**役割ID**で指す。§6.4）
 * - 押ボタン: 押す（動作を見ながら故障を探すため）
 */
export function reportPickToAction(
  hit: PickHit,
  partIdOf: (socketId: SocketId) => string,
): PickAction {
  switch (hit.kind) {
    case 'wire':
      return hit.locked
        ? { type: 'reject', message: LOCKED_WIRE_MESSAGE }
        : { type: 'openReport', target: { wireId: hit.id } };
    case 'terminal':
      return { type: 'openReport', target: { terminalId: hit.id } };
    case 'socket':
      return hit.occupied
        ? { type: 'openReport', target: { partId: partIdOf(hit.id) } }
        : { type: 'none' };
    case 'pushbutton':
      return { type: 'pressButton', pbId: hit.id };
    case 'empty':
      return { type: 'none' };
  }
}

/**
 * 判定に渡す回路を作る。§9.2
 * `judgeInspectRepair()`（Plan 2A）は `circuit.session` を**訓練者が提出した盤**として読むので、
 * 開始時の盤ではなく「いまの盤」を差し替えて渡す。`applied` / `initialWireIds` / `cells` は
 * 開始時のまま（故障の在処と改造の基準が変わってはいけない）。
 */
export function circuitForJudge(circuit: RepairCircuit, session: BoardSession): RepairCircuit {
  return {
    session,
    applied: circuit.applied,
    initialWireIds: circuit.initialWireIds,
    cells: circuit.cells,
  };
}
```

- [ ] **Step 4: `worker/protocol.ts` に C2 のコマンドを足す**

`apps/desktop/src/worker/protocol.ts` の `@ojt/content` の import を次に置き換える:

```ts
import type {
  AssembleProblem,
  FaultReport,
  FaultSpecData,
  InspectPartAnswer,
  InspectPartsProblem,
  InspectRepairProblem,
  JudgeAssembleResult,
  JudgeInspectResult,
  ProblemIssue,
  RepairCircuit,
} from '@ojt/content';
```

`SimCommand` の `judgeParts` の枝の**直後**（最後のセミコロンの前）に次を挿入する:

```ts
  /**
   * モードC2を判定する。§9.2
   * `circuit` は開始時の `RepairCircuit` の `session` を**提出時の盤**に差し替えたもの
   * （`circuitForJudge()`）。素のJSONなので構造化複製でそのまま渡せる。
   */
  | {
      type: 'judgeRepair';
      problem: InspectRepairProblem;
      circuit: RepairCircuit;
      reports: readonly FaultReport[];
      elapsedMs: number;
    };
```

- [ ] **Step 5: `worker/sim.worker.ts` に C2 判定を足す**

`apps/desktop/src/worker/sim.worker.ts` の `@ojt/content` の import を次に置き換える:

```ts
import {
  injectPartFaults,
  judgeAssemble,
  judgeInspectParts,
  judgeInspectRepair,
} from '@ojt/content';
import type { FaultSpecData } from '@ojt/content';
```

`handle()` の `case 'judgeParts':` ブロックの**直後**に次を足す:

```ts
    case 'judgeRepair': {
      /*
       * C2の判定は模範回路と訓練者の盤を並走させるので 240〜440ms かかる（§8.3）。
       * モードBの `judge` と同じく、その間は追従ループを止めて「捨てた tick」を
       * 誤って計上しないようにする。
       */
      stopLoop();
      try {
        const outcome = judgeInspectRepair(
          command.problem,
          JIPM_BOARD,
          command.circuit,
          command.reports,
          { elapsedMs: command.elapsedMs, sessionHazards: sim.events.hazards() },
        );
        post({
          type: 'inspectResult',
          result: outcome.ok ? { ok: true, value: outcome.value } : { ok: false, errors: outcome.errors },
        });
      } finally {
        resumeLoop();
      }
      break;
    }
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-repair-session.test.ts test/sim-worker-repair.test.ts --no-file-parallelism
```

Expected: `Test Files  2 passed (2)`。`inspect-repair-session` 13件、`sim-worker-repair` 4件。

- [ ] **Step 7: コミットする**

```powershell
git add apps/desktop/src/renderer/session/inspect-repair.ts apps/desktop/src/worker/protocol.ts apps/desktop/src/worker/sim.worker.ts apps/desktop/test/inspect-repair-session.test.ts apps/desktop/test/sim-worker-repair.test.ts
git commit -m @'
feat(desktop): judge mode C2 repairs in the worker

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 13: C2 の指摘パネルと種別ポップオーバー

**Files:**
- Create: `apps/desktop/src/renderer/panels/ReportPanel.tsx`
- Create: `apps/desktop/src/renderer/panels/RepairPanel.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/report-panel.test.tsx`

§9.2 の「3D上で電線・端子・部品をクリック → 故障種別を選んで指摘を登録する」の右パネル側を作る。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| ポップオーバー | 3Dの対象を選んだ直後に右パネルの上端へ出す（3Dの上に浮かせない） | 3Dの上に出すと `OrbitControls` のドラッグと取り合いになり、内蔵GPUの環境では押しにくい。右パネルなら位置が安定し、E2E からも `data-testid` で押せる |
| 種別 | `reportKindsFor(target)` の並び（電線＝断線／誤配線、端子＝未配線、部品＝部品不良） | §9.2 |
| 正誤の表示 | **出さない**。登録した指摘はそのまま並べるだけ | §9.2「削除の可否をその場で判定すると答えが漏れる」と同じ理屈。過剰指摘・見逃しは結果画面で初めて出す（§9.2 判定①） |
| 取り消し | 各行に「取消」。登録し直せる | §8.2 の操作のやり直しと同じ |
| 修復パネル | 追加した白線（`addedWireIds`）と、外した青線（`modificationWireIds`）を出す。**改造かどうかの判定は出さない** | §9.2「警告は出さず、判定時に計上する」 |
| 部品交換 | 装着済み部品ごとに「交換」ボタン。押すと `replacePart()` した回路に差し替わる | §9.2 部品交換 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/report-panel.test.tsx`:

```tsx
import type { FaultReport } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepairPanel } from '../src/renderer/panels/RepairPanel.js';
import { ReportPanel } from '../src/renderer/panels/ReportPanel.js';

/**
 * モードC2の指摘・修復パネル（Plan 2B Task 13）。設計仕様 §9.2。
 */

afterEach(() => {
  cleanup();
});

const REPORTS: FaultReport[] = [
  { target: { wireId: 'sw-003' }, kind: 'wire-open' },
  { target: { terminalId: 'CR1.13' }, kind: 'wire-missing' },
  { target: { partId: 'CR2' }, kind: 'part-defect' },
];

describe('ReportPanel（§9.2 指摘一覧）', () => {
  it('登録した指摘を並べ、取消せる', () => {
    const onRemove = vi.fn();
    render(
      <ReportPanel
        reports={REPORTS}
        pending={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        onRemove={onRemove}
      />,
    );
    const list = screen.getByTestId('report-list');
    expect(list.textContent).toContain('sw-003');
    expect(list.textContent).toContain('CR1.13');
    expect(list.textContent).toContain('CR2');
    expect(list.textContent).toContain('断線');
    expect(list.textContent).toContain('未配線');
    expect(list.textContent).toContain('部品不良');
    fireEvent.click(screen.getByTestId('remove-report-1'));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('正誤は出さない（答えが漏れない。§9.2）', () => {
    render(
      <ReportPanel
        reports={REPORTS}
        pending={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const text = screen.getByTestId('report-panel').textContent ?? '';
    expect(text).not.toContain('正解');
    expect(text).not.toContain('見逃し');
    expect(text).not.toContain('過剰');
  });

  it('件数を出す', () => {
    render(
      <ReportPanel
        reports={REPORTS}
        pending={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-count').textContent).toContain('3');
  });
});

describe('種別ポップオーバー（§9.2）', () => {
  it('電線を選んだら 断線 と 誤配線 を出す', () => {
    const onPick = vi.fn();
    render(
      <ReportPanel
        reports={[]}
        pending={{ wireId: 'sw-003' }}
        onPick={onPick}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-popover').textContent).toContain('sw-003');
    fireEvent.click(screen.getByTestId('report-kind-wire-misrouted'));
    expect(onPick).toHaveBeenCalledWith('wire-misrouted');
    expect(screen.queryByTestId('report-kind-part-defect')).toBeNull();
  });

  it('端子を選んだら 未配線 だけを出す', () => {
    render(
      <ReportPanel
        reports={[]}
        pending={{ terminalId: 'CR1.13' }}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-kind-wire-missing')).toBeTruthy();
    expect(screen.queryByTestId('report-kind-wire-open')).toBeNull();
  });

  it('取消でポップオーバーを閉じる', () => {
    const onCancel = vi.fn();
    render(
      <ReportPanel
        reports={[]}
        pending={{ partId: 'CR2' }}
        onPick={vi.fn()}
        onCancel={onCancel}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('report-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('RepairPanel（§9.2 修復）', () => {
  it('追加した白線と外した青線を並べる', () => {
    render(
      <RepairPanel
        addedWires={['w-101']}
        removedWires={['sw-002']}
        mountedParts={[]}
        onReplacePart={vi.fn()}
      />,
    );
    expect(screen.getByTestId('added-wires').textContent).toContain('w-101');
    expect(screen.getByTestId('removed-wires').textContent).toContain('sw-002');
  });

  it('改造かどうかは出さない（判定時に計上する。§9.2）', () => {
    const text =
      render(
        <RepairPanel
          addedWires={[]}
          removedWires={['sw-002']}
          mountedParts={[]}
          onReplacePart={vi.fn()}
        />,
      ).container.textContent ?? '';
    expect(text).not.toContain('改造');
  });

  it('装着済み部品を交換できる', () => {
    const onReplacePart = vi.fn();
    render(
      <RepairPanel
        addedWires={[]}
        removedWires={[]}
        mountedParts={[{ socketId: 'S1', partId: 'CR1', isTimer: false }]}
        onReplacePart={onReplacePart}
      />,
    );
    fireEvent.click(screen.getByTestId('replace-CR1'));
    expect(onReplacePart).toHaveBeenCalledWith('S1', 'CR1');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/report-panel.test.tsx
```

Expected: 失敗。`Failed to resolve import "../src/renderer/panels/RepairPanel.js"` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `i18n/ja.ts` に C2 の文言を足す**

`apps/desktop/src/renderer/i18n/ja.ts` の `inspectParts: { … },` の**直後**に次を挿入する:

```ts
  /** モードC2（回路点検・修復）。§9.2 */
  inspectRepair: {
    reports: '指摘一覧',
    reportCount: '指摘',
    /** 指摘の登録を促す案内。§9.2 */
    pickHint: '3D盤の電線・端子・部品をクリックして故障の種別を選びます',
    /** 種別ポップオーバーの見出し。 */
    chooseKind: '故障の種別を選ぶ',
    cancel: '取消',
    remove: '取消',
    repair: '修復',
    addedWires: '追加した白線',
    removedWires: '外した青線',
    /** 部品交換。§9.2 */
    replace: '交換',
    replaced: '交換しました',
    parts: '装着部品',
    none: 'なし',
    /** ツールバーのモード。§8.1 */
    toolMode: '指摘',
    /** 指摘が重複したとき。 */
    duplicate: '同じ指摘が既に登録されています',
    /** 結果画面の見出し。§9.2 判定① */
    matched: '言い当てた故障',
    missed: '見逃し',
    extra: '過剰指摘',
    modifications: '改造（故障箇所でない青線の削除）',
    noModification: '改造はありません。',
    site: '故障箇所',
    reportKind: '指摘した種別',
  },
```

`apps/desktop/src/renderer/i18n/ja.ts` の `mismatchReason: { … },` の**直後**に次を挿入する:

```ts
  /** 指摘の種別（`FaultReportKind`）。§9.2 */
  reportKind: {
    'wire-open': '断線',
    'wire-missing': '未配線',
    'wire-misrouted': '誤配線',
    'part-defect': '部品不良',
  } satisfies Record<FaultReportKind, string>,
```

同ファイルの先頭の import に次を足す:

```ts
import type { FaultReportKind } from '@ojt/content';
```

同ファイルの `correctCountText()` の**直後**に次を足す:

```ts
/** 指摘の対象の表示（`電線 sw-003` / `端子 CR1.13` / `部品 CR2`）。§9.2 */
export function reportTargetLabel(
  target: { wireId: string } | { partId: string } | { terminalId: string },
): string {
  if ('wireId' in target) return `${JA.session.wires} ${target.wireId}`;
  if ('terminalId' in target) return `${JA.inspectRepair.terminal} ${target.terminalId}`;
  return `${JA.session.parts} ${target.partId}`;
}
```

`JA.inspectRepair` に `terminal` を足す（`site: '故障箇所',` の**直前**）:

```ts
    terminal: '端子',
```

- [ ] **Step 4: `panels/ReportPanel.tsx` を作る**

`apps/desktop/src/renderer/panels/ReportPanel.tsx`:

```tsx
import type { FaultReport, FaultReportKind } from '@ojt/content';
import type { JSX } from 'react';
import { JA, reportTargetLabel } from '../i18n/ja.js';
import { reportKindsFor } from '../session/inspect-repair.js';
import type { ReportTarget } from '../session/interaction.js';
import styles from './tester.module.css';

/**
 * モードC2の指摘一覧と種別ポップオーバー。設計仕様 §9.2。
 *
 * **正誤は決して出さない。** §9.2 は「削除の可否をその場で判定すると答えが漏れる」と定めて
 * おり、指摘についても同じである。過不足（見逃し・過剰指摘）は判定を押したあとの結果画面で
 * 初めて出す（§9.2 判定①）。
 *
 * 種別の選択は3Dの上に浮かせず**右パネルの上端**に出す。3Dの上だと `OrbitControls` の
 * ドラッグとクリックが取り合いになり、内蔵GPUの環境では押しづらい。
 */
export function ReportPanel({
  reports,
  pending,
  onPick,
  onCancel,
  onRemove,
}: {
  reports: readonly FaultReport[];
  /** 3Dで選んだ直後の対象（種別を選ぶ前）。 */
  pending: ReportTarget | undefined;
  onPick: (kind: FaultReportKind) => void;
  onCancel: () => void;
  onRemove: (index: number) => void;
}): JSX.Element {
  return (
    <section className={styles.panel} data-testid="report-panel">
      <h2 className={styles.title}>
        {JA.inspectRepair.reports}（<span data-testid="report-count">{reports.length}</span>）
      </h2>
      {pending === undefined ? null : (
        <div className={styles.popover} data-testid="report-popover">
          <span className={styles.popoverTitle}>
            {JA.inspectRepair.chooseKind}: {reportTargetLabel(pending)}
          </span>
          {reportKindsFor(pending).map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`report-kind-${kind}`}
              onClick={() => {
                onPick(kind);
              }}
            >
              {JA.reportKind[kind]}
            </button>
          ))}
          <button type="button" data-testid="report-cancel" onClick={onCancel}>
            {JA.inspectRepair.cancel}
          </button>
        </div>
      )}
      <div data-testid="report-list">
        {reports.length === 0 ? (
          <p className={styles.hint}>{JA.inspectRepair.pickHint}</p>
        ) : (
          reports.map((report, index) => (
            <div key={`${String(index)}-${report.kind}`} className={styles.reportRow}>
              <span className={styles.reportTarget}>{reportTargetLabel(report.target)}</span>
              <span>{JA.reportKind[report.kind]}</span>
              <button
                type="button"
                data-testid={`remove-report-${String(index)}`}
                onClick={() => {
                  onRemove(index);
                }}
              >
                {JA.inspectRepair.remove}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: `panels/RepairPanel.tsx` を作る**

`apps/desktop/src/renderer/panels/RepairPanel.tsx`:

```tsx
import type { SocketId } from '@ojt/board-model';
import type { JSX } from 'react';
import { JA, mountedPartLabel } from '../i18n/ja.js';
import styles from './tester.module.css';

/** 装着済み部品1個（交換の対象）。 */
export interface MountedPartRow {
  socketId: SocketId;
  /** 役割ID（`CR1` 等）。指摘と部品交換はこのIDで指す。§6.4 */
  partId: string;
  isTimer: boolean;
}

/**
 * モードC2の修復パネル。設計仕様 §9.2。
 *
 * 追加した白線と外した青線を**事実として**並べるだけで、「その削除は改造か」は出さない。
 * §9.2 が「削除の可否をその場で判定すると答えが漏れるため警告は出さず、判定時に
 * 『故障箇所でない青線を削除した本数』を改造として結果に計上する」と定めているためである。
 */
export function RepairPanel({
  addedWires,
  removedWires,
  mountedParts,
  onReplacePart,
}: {
  addedWires: readonly string[];
  removedWires: readonly string[];
  mountedParts: readonly MountedPartRow[];
  onReplacePart: (socketId: SocketId, partId: string) => void;
}): JSX.Element {
  return (
    <section className={styles.panel} data-testid="repair-panel">
      <h2 className={styles.title}>{JA.inspectRepair.repair}</h2>
      <p className={styles.label}>{JA.inspectRepair.addedWires}</p>
      <p className={styles.reportTarget} data-testid="added-wires">
        {addedWires.length === 0 ? JA.inspectRepair.none : addedWires.join(' / ')}
      </p>
      <p className={styles.label}>{JA.inspectRepair.removedWires}</p>
      <p className={styles.reportTarget} data-testid="removed-wires">
        {removedWires.length === 0 ? JA.inspectRepair.none : removedWires.join(' / ')}
      </p>
      <p className={styles.label}>{JA.inspectRepair.parts}</p>
      {mountedParts.map((part) => (
        <div key={part.partId} className={styles.trayRow}>
          <span className={styles.trayName}>{mountedPartLabel(part.partId, part.isTimer)}</span>
          <button
            type="button"
            data-testid={`replace-${part.partId}`}
            onClick={() => {
              onReplacePart(part.socketId, part.partId);
            }}
          >
            {JA.inspectRepair.replace}
          </button>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/report-panel.test.tsx
```

Expected: `Test Files  1 passed (1)` / `Tests  9 passed (9)`。

- [ ] **Step 7: コミットする**

```powershell
git add apps/desktop/src/renderer/panels/ReportPanel.tsx apps/desktop/src/renderer/panels/RepairPanel.tsx apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test/report-panel.test.tsx
git commit -m @'
feat(desktop): add the mode C2 fault report and repair panels

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 14: モードC2 のセッション画面（指摘・白線修復・部品交換）

**Files:**
- Create: `apps/desktop/src/renderer/screens/InspectRepairSession.tsx`
- Modify: `apps/desktop/src/renderer/screens/SessionRoute.tsx`
- Modify: `apps/desktop/src/renderer/app/store-types.ts`
- Modify: `apps/desktop/src/renderer/app/store.ts`
- Modify: `apps/desktop/src/renderer/session/spec-chart.ts`
- Modify: `apps/desktop/src/renderer/session/commands.ts`
- Test: `apps/desktop/test/inspect-repair-screen.test.tsx`

§9.2 の画面を組み上げる。故障入りの盤を「見たまま」描き、テスターで測り、指摘を登録し、白線で修復し、部品を交換して判定する。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| ツールモード | `wire`（白線を張る）／`delete`（青線・白線を外す）／`tester`（測る）／`report`（指摘） の4つ | §9.2 |
| 線色 | `session.allowedColors` は `['白']`（`buildInspectRepairCircuit()` が差し替え済み） | §8.1 / §9.2 |
| 指摘の登録 | 3Dクリック → `pendingReport` にため → ポップオーバーで種別 → `addReport()` | §9.2 |
| 部品交換 | `unplug` → `plug` を Worker へ送り、`replacePart(circuit, partId)` で回路を差し替える | §9.2 部品交換。Worker 側では `mountPart()` が新しい良品を作る |
| 故障の可視性 | 故障は**見えない**。`wire-open` は電線が見えたまま導通しないだけ、`wire-missing` は電線が無いだけ | §9.2 初期状態 / §5.4 |
| 判定 | `judgeRepair` を送り、`inspectResult` で結果画面へ | §9.2 判定 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/inspect-repair-screen.test.tsx`:

```tsx
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { InspectRepairSession } from '../src/renderer/screens/InspectRepairSession.js';

/**
 * モードC2のセッション画面（Plan 2B Task 14）。設計仕様 §9.2。
 */

const sent: Array<Record<string, unknown>> = [];
const picks: Array<(hit: unknown) => void> = [];

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    start: () => undefined,
    stop: () => undefined,
    send: (command: Record<string, unknown>) => {
      sent.push(command);
    },
  },
}));

vi.mock('../src/renderer/three/BoardScene.js', () => ({
  BoardScene: ({ onPick }: { onPick: (hit: unknown) => void }) => {
    picks.push(onPick);
    return <div data-testid="board-canvas" />;
  },
  safeRoutes: () => ({ routes: [], errors: [] }),
}));

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);

beforeEach(() => {
  sent.length = 0;
  picks.length = 0;
  if (C2 !== undefined) useStore.getState().openProblem(C2);
});

afterEach(() => {
  cleanup();
});

describe('画面の骨格（§9.2）', () => {
  it('指摘パネル・修復パネル・テスターを並べ、線色は白だけを出す', () => {
    render(<InspectRepairSession />);
    expect(screen.getByTestId('report-panel')).toBeTruthy();
    expect(screen.getByTestId('repair-panel')).toBeTruthy();
    expect(screen.getByTestId('tester-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: '白' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '青' })).toBeNull();
  });

  it('2級形式は回路図を出す（§9.2 提示情報）', () => {
    render(<InspectRepairSession />);
    expect(screen.getByTestId('schematic-hint')).toBeTruthy();
  });

  it('開始時に故障入りの盤を load する', () => {
    render(<InspectRepairSession />);
    const load = sent.filter((c) => c['type'] === 'load').at(-1);
    expect(load).toBeDefined();
    expect(load?.['partFaults']).toBeDefined();
  });
});

describe('指摘（§9.2）', () => {
  it('電線をクリックすると種別ポップオーバーが出て、選ぶと登録される', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    expect(onPick).toBeDefined();
    if (onPick === undefined) return;
    onPick({ kind: 'wire', id: 'sw-003', locked: false });
    expect(screen.getByTestId('report-popover')).toBeTruthy();
    fireEvent.click(screen.getByTestId('report-kind-wire-open'));
    expect(useStore.getState().reports).toEqual([
      { target: { wireId: 'sw-003' }, kind: 'wire-open' },
    ]);
  });

  it('同じ指摘を2回登録しない（§9.2）', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    for (let i = 0; i < 2; i += 1) {
      onPick({ kind: 'wire', id: 'sw-003', locked: false });
      fireEvent.click(screen.getByTestId('report-kind-wire-open'));
    }
    expect(useStore.getState().reports).toHaveLength(1);
  });

  it('端子をクリックすると未配線の指摘になる', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    onPick({ kind: 'terminal', id: toTerminalId('S1.13'), wirable: true, label: 'CR1 ⑬ −' });
    fireEvent.click(screen.getByTestId('report-kind-wire-missing'));
    expect(useStore.getState().reports).toEqual([
      { target: { terminalId: 'CR1.13' }, kind: 'wire-missing' },
    ]);
  });

  it('取消で指摘を消せる', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    onPick({ kind: 'wire', id: 'sw-003', locked: false });
    fireEvent.click(screen.getByTestId('report-kind-wire-open'));
    fireEvent.click(screen.getByTestId('remove-report-0'));
    expect(useStore.getState().reports).toEqual([]);
  });
});

describe('部品交換（§9.2）', () => {
  it('交換すると unplug と plug を送り、回路から部品の故障が消える', () => {
    render(<InspectRepairSession />);
    const before = useStore.getState().circuit;
    expect(before).toBeDefined();
    if (before === undefined) return;
    const row = screen.queryByTestId('replace-CR1');
    if (row === null) return; // この課題に CR1 が無ければ何もしない
    fireEvent.click(row);
    expect(sent.some((c) => c['type'] === 'unplug')).toBe(true);
    expect(sent.some((c) => c['type'] === 'plug')).toBe(true);
    const after = useStore.getState().circuit;
    expect(after?.applied.partFaults.some((f) => 'partId' in f.target && f.target.partId === 'CR1')).toBe(
      false,
    );
    // 指摘の対象（sites）は残る（Plan 2A 差分 #7）
    expect(after?.applied.sites).toHaveLength(before.applied.sites.length);
  });
});

describe('判定（§9.2）', () => {
  it('判定ボタンで judgeRepair を送る', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('judge-button'));
    const judge = sent.find((c) => c['type'] === 'judgeRepair');
    expect(judge).toBeDefined();
    expect(judge?.['circuit']).toBeDefined();
    expect(useStore.getState().judging).toBe(true);
  });
});

describe('元に戻す・やり直し（§8.2 / §9.2。I-11）', () => {
  it('白線を張ってから元に戻すと配線前の本数に戻る', () => {
    render(<InspectRepairSession />);
    const before = useStore.getState().session?.wires.length ?? 0;
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    fireEvent.click(screen.getByRole('button', { name: '白', exact: true }));
    onPick({ kind: 'terminal', id: toTerminalId('S1.13'), wirable: true, label: 'a' });
    onPick({ kind: 'terminal', id: toTerminalId('S1.14'), wirable: true, label: 'b' });
    expect(useStore.getState().session?.wires.length).toBe(before + 1);
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    expect(useStore.getState().session?.wires.length).toBe(before);
  });

  it('元に戻したあとやり直すと配線後の本数に戻る', () => {
    render(<InspectRepairSession />);
    const before = useStore.getState().session?.wires.length ?? 0;
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    fireEvent.click(screen.getByRole('button', { name: '白', exact: true }));
    onPick({ kind: 'terminal', id: toTerminalId('S1.13'), wirable: true, label: 'a' });
    onPick({ kind: 'terminal', id: toTerminalId('S1.14'), wirable: true, label: 'b' });
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    fireEvent.click(screen.getByRole('button', { name: JA.session.redo }));
    expect(useStore.getState().session?.wires.length).toBe(before + 1);
  });

  it('部品交換を元に戻すと故障が復活する（sites は変わらない。§9.2）', () => {
    render(<InspectRepairSession />);
    const before = useStore.getState().circuit;
    if (before === undefined) return;
    const row = screen.queryByTestId('replace-CR1');
    if (row === null) return; // この課題に CR1 が無ければ何もしない
    fireEvent.click(row);
    const replaced = useStore.getState().circuit;
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    const restored = useStore.getState().circuit;
    expect(restored?.applied.partFaults).toEqual(before.applied.partFaults);
    expect(restored?.applied.sites).toEqual(replaced?.applied.sites);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-repair-screen.test.tsx
```

Expected: 失敗。`Failed to resolve import "../src/renderer/screens/InspectRepairSession.js"` で `Test Files  1 failed (1)`。

- [ ] **Step 3: ストアに「種別を選ぶ前の指摘」を足す**

`apps/desktop/src/renderer/app/store-types.ts` の `HighlightSelection` の**直前**に次を足す:

```ts
/**
 * 3Dで選んだ直後の指摘の対象（種別を選ぶ前）。§9.2
 * `session/interaction.ts` の `ReportTarget` と同じ形だが、ストアの値型は three にも React にも
 * 依存しないこのファイルに置く（`interaction.ts` からはこの型を再エクスポートする）。
 */
export type PendingReport = { wireId: string } | { partId: string } | { terminalId: string };
```

`apps/desktop/src/renderer/session/interaction.ts` の `ReportTarget` の定義を次に置き換える:

```ts
export type { PendingReport as ReportTarget } from '../app/store-types.js';
```

`apps/desktop/src/renderer/app/store.ts` の `AppState` の `highlight: HighlightSelection;` の**直前**に次を足す:

```ts
  /** 3Dで選んだ直後の指摘の対象（種別を選ぶ前）。§9.2 */
  pendingReport: PendingReport | undefined;
```

`AppState` の `setHighlight` の**直前**に次を足す:

```ts
  /** 指摘の対象を選んだ（種別ポップオーバーを出す）。§9.2 */
  setPendingReport: (target: PendingReport | undefined) => void;
```

初期値の `highlight: NO_HIGHLIGHT,` の**直前**に `pendingReport: undefined,` を足し、`setHighlight` の実装の**直前**に次を足す:

```ts
  setPendingReport: (pendingReport) => {
    set({ pendingReport });
  },
```

`openProblem()` の `highlight: NO_HIGHLIGHT,` の**直前**と `abandonSession()` の `highlight: NO_HIGHLIGHT,` の**直前**に、それぞれ `pendingReport: undefined,` を足す。

`store.ts` の `store-types.js` からの import と再エクスポートに `PendingReport` を足す（`type LogLine,` の直後に `type PendingReport,`）。

- [ ] **Step 3a: `session/spec-chart.ts` を `SchematicProblem` へ広げる**

C2は模範回路のタイムチャートをモードBと共有する（§9.2 は2級形式でタイムチャートも見せる。Task 14 Step 4 の `buildSpecChart(problem)` 呼び出しを参照）。`apps/desktop/src/renderer/session/spec-chart.ts` の import を次に置き換える:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import {
  buildReferenceSession,
  buildTimeChart,
  defaultChartSignals,
  resolveCompareSignals,
  runOperations,
  timerMarkers,
  type SchematicProblem,
  type TimeChart,
} from '@ojt/content';
```

同ファイルの `cacheKey()` / `isSpecChartCached()` / `buildSpecChart()` / `computeSpecChart()` の引数型 `AssembleProblem` を**すべて** `SchematicProblem` に置き換える（4関数）。`buildReferenceSession()` は Plan 2A で `SchematicProblem`（`AssembleProblem | InspectRepairProblem`）を受けるよう広がっているので、関数の中身は変えなくてよい。

`test/spec-chart.test.ts` はモードBの課題（`AssembleProblem`）だけを渡しているので、型が広がっても引数はそのまま渡せる。**GREENのまま**で通る（新しいテストは要らない）。

- [ ] **Step 4: `screens/InspectRepairSession.tsx` を作る**

`apps/desktop/src/renderer/screens/InspectRepairSession.tsx`:

```tsx
import { JIPM_BOARD, socketPartId, SOCKET_IDS, toNetlistTerminal } from '@ojt/board-model';
import type { SocketId } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  addedWireIds,
  isInspectRepairProblem,
  modificationWireIds,
  replacePart,
} from '@ojt/content';
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { sounds, soundsForSnapshot } from '../audio/sounds.js';
import {
  failedLog,
  JA,
  openedProblemLog,
  powerLog,
  referenceErrorText,
  routeFailedLog,
  workFileSavedText,
} from '../i18n/ja.js';
import { ElapsedTimer } from '../panels/ElapsedTimer.js';
import { LogPanel } from '../panels/LogPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { RepairPanel, type MountedPartRow } from '../panels/RepairPanel.js';
import { ReportPanel } from '../panels/ReportPanel.js';
import { dispatchTester, TesterPanel } from '../panels/TesterPanel.js';
import { TimeChartPanel } from '../panels/TimeChartPanel.js';
import { Toolbar } from '../panels/Toolbar.js';
import { WarningBanner } from '../panels/WarningBanner.js';
import { SchematicSvg } from '../schematic/SchematicSvg.js';
import { cloneSession, runAddWire, runRemoveWire } from '../session/commands.js';
import { circuitForJudge, hasReportFor, reportPickToAction } from '../session/inspect-repair.js';
import {
  deleteKeyToAction,
  escapeToAction,
  pickToAction,
  shouldIgnoreShortcut,
  type PickAction,
  type PickHit,
} from '../session/interaction.js';
import { buildSpecChart } from '../session/spec-chart.js';
import { testerPickToAction, testerShortcut } from '../session/tester.js';
import { useViewportShortcuts } from '../session/viewport-keys.js';
import { applyWorkFile, toWorkFile } from '../session/work-file.js';
import { bridge } from '../session/worker-bridge.js';
import { BoardScene, safeRoutes } from '../three/BoardScene.js';
import styles from './screens.module.css';

/**
 * モードC2（回路点検・修復）のセッション画面。設計仕様 §9.2 / §9.3 / §12.2。
 *
 * 盤は**故障が注入された状態で、見たまま**描かれる（断線した電線は見えるが導通しない、
 * 未配線の電線は存在しない）。訓練者はテスターで測って故障を突き止め、指摘を登録し、
 * 白線で修復し、必要なら部品を交換して判定する。
 *
 * 3Dのクリックの意味はツールモードで変わる: `wire`＝白線を張る、`delete`＝電線を外す、
 * `tester`＝プローブを置く、`report`＝故障を指摘する。判断はそれぞれ純関数
 * （`pickToAction` / `testerPickToAction` / `reportPickToAction`）が持つ。
 */

const ELAPSED_INTERVAL_MS = 200;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** スナップショットの差分から効果音を鳴らす。§15 */
function SoundEffects(): null {
  const snapshot = useStore((s) => s.snapshot);
  const previous = useRef<typeof snapshot | undefined>(undefined);
  useEffect(() => {
    for (const kind of soundsForSnapshot(previous.current, snapshot)) sounds.play(kind);
    previous.current = snapshot;
  }, [snapshot]);
  return null;
}

/** モードC2のセッション画面。 */
export function InspectRepairSession(): JSX.Element {
  const problem = useStore((s) =>
    s.problem !== undefined && isInspectRepairProblem(s.problem) ? s.problem : undefined,
  );
  const session = useStore((s) => s.session);
  const circuit = useStore((s) => s.circuit);
  const reports = useStore((s) => s.reports);
  const pendingReport = useStore((s) => s.pendingReport);
  const mode = useStore((s) => s.mode);
  const wireColor = useStore((s) => s.wireColor);
  const camera = useStore((s) => s.camera);
  const powered = useStore((s) => s.snapshot.powered);
  const tripped = useStore((s) => s.snapshot.tripped);
  const breakerOn = useStore((s) => s.snapshot.breakerOn);
  const switchOn = useStore((s) => s.snapshot.switchOn);
  const hazards = useStore((s) => s.hazards);
  const chatters = useStore((s) => s.chatters);
  const logLines = useStore((s) => s.logLines);
  const judging = useStore((s) => s.judging);
  const schematicVisible = useStore((s) => s.schematicVisible);
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const problemId = problem?.id;
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  // 視点のショートカットは Session / InspectPartsSession と共通のフックに任せる（§12.2）
  useViewportShortcuts({ enabled: session !== undefined });

  /* Worker を起こし、故障入りの盤を読ませる。§9.2 */
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    const currentCircuit = store.circuit;
    if (current === undefined || currentCircuit === undefined) return;
    bridge.start({
      onSnapshot: (next) => {
        useStore.getState().applySnapshot(next);
      },
      onJudge: () => {
        // モードC2では届かない
      },
      onInspect: (message) => {
        const state = useStore.getState();
        state.setJudging(false);
        if (message.result.ok) {
          state.setJudge(message.result.value);
          state.setRoute('result');
        } else {
          state.toast(referenceErrorText(message.result.errors.map((e) => e.message)), 'error');
        }
      },
      onError: (text, fatal) => {
        const state = useStore.getState();
        state.setJudging(false);
        const line = `${JA.error.workerError}: ${text}`;
        if (fatal) state.setFatalError(line);
        else state.toast(line, 'error');
        state.addLog(line);
      },
    });
    bridge.send({
      type: 'load',
      problemId: current.id,
      session: cloneSession(currentCircuit.session),
      partFaults: currentCircuit.applied.partFaults,
    });
    store.addLog(openedProblemLog(current.title));
    return () => {
      bridge.stop();
    };
  }, [problemId, sessionEpoch]);

  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickElapsed();
    }, ELAPSED_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  /** 盤操作の結果を反映する（`Session` と同じ流儀）。§8.2 */
  const apply = useCallback((result: ReturnType<typeof runAddWire>, after: () => void): void => {
    const store = useStore.getState();
    if (!result.ok) {
      store.toast(result.message, 'error');
      store.addLog(failedLog(result.message));
      if (result.code === 'terminal-overload' && result.wire !== undefined) {
        bridge.send({ type: 'addWire', wire: result.wire });
      }
      return;
    }
    const current = store.session;
    if (current !== undefined) store.setSession(cloneSession(current));
    store.pushHistory(result.command);
    store.addLog(result.command.label);
    after();
  }, []);

  const runAction = useCallback(
    (action: PickAction): void => {
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      switch (action.type) {
        case 'beginWire':
          store.setPending(action.from);
          break;
        case 'cancelWire':
          store.setPending(undefined);
          store.addLog(JA.session.cancelWire);
          break;
        case 'completeWire':
          store.setPending(undefined);
          apply(runAddWire(current, action.from, action.to, action.color), () => {
            const next = useStore.getState();
            const wire = next.session?.wires.at(-1);
            const board = next.session;
            if (wire === undefined || board === undefined) return;
            bridge.send({ type: 'addWire', wire });
            const failed = safeRoutes(JIPM_BOARD, board).errors.find((e) => e.wireId === wire.id);
            if (failed !== undefined) {
              next.toast(`${JA.session.routeFailed}（${JA.routeReason[failed.reason]}）`, 'error');
              next.addLog(routeFailedLog(wire.id, JA.routeReason[failed.reason]));
            }
          });
          break;
        case 'selectWire':
          store.setSelectedWire(action.wireId);
          break;
        case 'removeWire':
          apply(runRemoveWire(current, action.wireId), () => {
            useStore.getState().setSelectedWire(undefined);
            bridge.send({ type: 'removeWire', wireId: action.wireId });
          });
          break;
        case 'reject':
          store.toast(action.message, 'error');
          break;
        case 'selectSocket':
        case 'selectMounted':
          store.setSelectedSocket(action.socketId);
          break;
        case 'pressButton':
          bridge.send({ type: 'press', pbId: action.pbId });
          break;
        case 'placeProbe':
          dispatchTester({ type: 'place-probe', probe: action.probe, terminal: action.terminal });
          break;
        case 'liftProbe':
          if (action.probe === 'both') {
            dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
            dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
            // 空クリックのあとは必ず「次は黒」に戻す（2回の place-probe の順序に依存しない。M-5）
            store.setNextProbe('black');
          } else {
            dispatchTester({ type: 'place-probe', probe: action.probe, terminal: undefined });
          }
          break;
        case 'openReport':
          store.setPendingReport(action.target);
          break;
        case 'none':
          break;
      }
    },
    [apply],
  );

  const onHover = useCallback((id: TerminalId | undefined) => {
    useStore.getState().setHovered(id);
  }, []);
  const onPress = useCallback((pbId: string) => {
    bridge.send({ type: 'press', pbId });
  }, []);
  const onRelease = useCallback((pbId: string) => {
    bridge.send({ type: 'release', pbId });
  }, []);

  /**
   * 3Dのピック → 操作。ツールモードで判断する純関数を選ぶ。§9.2 / §9.3
   * 端子IDは3Dが物理ID（`S1.13`）を返すので、ネットリスト・指摘・プローブが使う役割ID
   * （`CR1.13`）へ直してから渡す（§6.4）。
   */
  const onPick = useCallback(
    (hit: PickHit): void => {
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      const mapped: PickHit =
        hit.kind === 'terminal'
          ? { ...hit, id: toNetlistTerminal(current.socketRoles, hit.id) }
          : hit;
      if (store.mode === 'tester') {
        runAction(
          testerPickToAction(
            { black: store.tester.black, red: store.tester.red, next: store.nextProbe },
            mapped,
          ),
        );
        return;
      }
      if (store.mode === 'report') {
        runAction(
          reportPickToAction(mapped, (socketId) => socketPartId(current.socketRoles, socketId)),
        );
        return;
      }
      runAction(
        pickToAction(
          {
            mode: store.mode,
            pendingTerminal: store.pendingTerminal,
            selectedWire: store.selectedWire,
            wireColor: store.wireColor,
          },
          mapped,
        ),
      );
    },
    [runAction],
  );

  // キーボード操作（§8.2 / §9.3）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (shouldIgnoreShortcut(event)) return;
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      const state = {
        mode: store.mode,
        pendingTerminal: store.pendingTerminal,
        selectedWire: store.selectedWire,
        wireColor: store.wireColor,
      };
      if (event.key === 'Delete') {
        runAction(
          deleteKeyToAction(
            state,
            current.wires.filter((w) => w.locked).map((w) => w.id),
          ),
        );
        return;
      }
      if (store.mode === 'tester' || store.mode === 'report') {
        // 3種とも明示的に分岐する（`testerShortcut()` は未知のキーを既に上で弾いている）
        const shortcut = testerShortcut(event.key);
        if (shortcut === undefined) return;
        if (shortcut.type === 'next-probe') store.setNextProbe(shortcut.probe);
        else if (shortcut.type === 'zero-adjust') dispatchTester({ type: 'zero-adjust' });
        else if (shortcut.type === 'lift-both') {
          dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
          dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
          // 空クリックと同じく「次は黒」に戻す（§9.1 / §9.3。M-5）
          store.setNextProbe('black');
        }
        return;
      }
      if (event.key === 'Escape') runAction(escapeToAction(state));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [runAction]);

  const spec = useMemo(
    () => (problem === undefined ? undefined : buildSpecChart(problem)),
    [problem],
  );

  /** 装着済みの部品（交換の対象）。 */
  const mountedParts = useMemo<MountedPartRow[]>(() => {
    if (session === undefined) return [];
    const out: MountedPartRow[] = [];
    for (const socketId of SOCKET_IDS) {
      const mounted = session.mounted[socketId];
      if (mounted === undefined) continue;
      out.push({
        socketId,
        partId: socketPartId(session.socketRoles, socketId),
        isTimer: mounted.kind === 'timer-h3y4',
      });
    }
    return out;
  }, [session]);

  if (problem === undefined || session === undefined || circuit === undefined) {
    return <div className={styles.center}>{JA.session.noProblem}</div>;
  }

  /**
   * 部品を良品に交換する。§9.2
   * 盤の上ではソケットから抜いて挿し直すだけなので、Worker には `unplug` → `plug` を送る
   * （`mountPart()` が新しい部品インスタンスを作るので、故障は入っていない）。判定側では
   * `replacePart()` で `partFaults` からその部品を落とす。**`sites` は残る**ので、
   * 交換しても指摘しなければ合格しない（Plan 2A 意図的な差分 #7）。
   */
  const onReplacePart = (socketId: SocketId, partId: string): void => {
    const store = useStore.getState();
    const next = cloneSession(session);
    bridge.send({ type: 'unplug', partId, session: next });
    bridge.send({ type: 'plug', socketId, session: next });
    store.setCircuit(replacePart(circuit, partId));
    store.addLog(`${JA.inspectRepair.replaced}: ${partId}`);
  };

  return (
    <>
      <SoundEffects />
      <WarningBanner />
      <Toolbar
        mode={mode}
        wireColor={wireColor}
        allowedColors={session.allowedColors}
        camera={camera}
        canUndo={false}
        canRedo={false}
        extraTools={
          <>
            <button
              type="button"
              data-testid="tool-tester"
              aria-pressed={mode === 'tester'}
              onClick={() => {
                useStore.getState().setMode('tester');
              }}
            >
              {JA.tester.toolMode}
            </button>
            <button
              type="button"
              data-testid="tool-report"
              aria-pressed={mode === 'report'}
              onClick={() => {
                useStore.getState().setMode('report');
              }}
            >
              {JA.inspectRepair.toolMode}
            </button>
          </>
        }
        onMode={(next) => {
          useStore.getState().setMode(next);
        }}
        onWireColor={(color) => {
          useStore.getState().setWireColor(color);
        }}
        onCamera={(preset) => {
          useStore.getState().setCamera(preset);
        }}
        onUndo={() => undefined}
        onRedo={() => undefined}
        judging={judging}
        onJudge={() => {
          const store = useStore.getState();
          if (store.judging) return;
          store.setJudging(true);
          bridge.send({
            type: 'judgeRepair',
            problem,
            circuit: circuitForJudge(circuit, cloneSession(session)),
            reports: store.reports,
            elapsedMs: store.elapsedMs,
          });
        }}
        onBack={() => {
          useStore.getState().setRoute('list');
        }}
        onSave={() => {
          const store = useStore.getState();
          let api: ReturnType<typeof ojtApi>;
          try {
            api = ojtApi();
          } catch (error) {
            store.toast(reasonOf(error), 'error');
            return;
          }
          void api
            .saveWorkFile({
              kind: 'manual',
              file: toWorkFile(problem.id, session, store.elapsedMs, store.hazards.length),
            })
            .then((result) => {
              store.toast(
                result.ok ? workFileSavedText(result.path) : result.message,
                result.ok ? 'info' : 'error',
              );
            });
        }}
        onLoad={() => {
          let api: ReturnType<typeof ojtApi>;
          try {
            api = ojtApi();
          } catch (error) {
            useStore.getState().toast(reasonOf(error), 'error');
            return;
          }
          void api.loadWorkFile({ kind: 'manual' }).then((result) => {
            if (!result.ok) {
              if (!result.canceled) useStore.getState().toast(result.message, 'error');
              return;
            }
            void applyWorkFile(result.file);
          });
        }}
        schematicVisible={schematicVisible}
        onToggleSchematic={undefined}
      >
        <PowerControls
          breakerOn={breakerOn}
          switchOn={switchOn}
          powered={powered}
          tripped={tripped}
          onBreaker={(on) => {
            bridge.send({ type: 'breaker', on });
            useStore.getState().addLog(powerLog(JA.session.breaker, on));
          }}
          onSwitch={(on) => {
            bridge.send({ type: 'switch', on });
            useStore.getState().addLog(powerLog(JA.session.switch, on));
          }}
          onResetTrip={() => {
            bridge.send({ type: 'resetTrip' });
            useStore.getState().addLog(JA.session.resetTripLog);
          }}
        />
      </Toolbar>

      <div className={styles.sessionLayout}>
        <div className={styles.viewport} data-testid="viewport">
          <BoardScene onPick={onPick} onHover={onHover} onPress={onPress} onRelease={onRelease} />
          <div className={styles.statusOverlay} data-testid="status-overlay">
            {powered ? JA.session.powered : JA.session.unpowered} / {JA.session.wires}{' '}
            {session.wires.length} {JA.session.wiresUnit} / {JA.inspectRepair.reportCount}{' '}
            {reports.length}
            {tripped ? ` / ${JA.session.tripped}` : ''}
          </div>
        </div>

        <div className={styles.rightPanel}>
          <ProblemPanel problem={problem} />
          <ReportPanel
            reports={reports}
            pending={pendingReport}
            onPick={(kind) => {
              const store = useStore.getState();
              const target = store.pendingReport;
              if (target === undefined) return;
              store.setPendingReport(undefined);
              if (hasReportFor(store.reports, target, kind)) {
                store.toast(JA.inspectRepair.duplicate, 'error');
                return;
              }
              store.addReport({ target, kind });
              store.addLog(`${JA.inspectRepair.reportCount}: ${JA.reportKind[kind]}`);
            }}
            onCancel={() => {
              useStore.getState().setPendingReport(undefined);
            }}
            onRemove={(index) => {
              useStore.getState().removeReport(index);
            }}
          />
          <TesterPanel />
          <RepairPanel
            addedWires={addedWireIds(circuit, session)}
            removedWires={modificationWireIds(circuit, session)}
            mountedParts={mountedParts}
            onReplacePart={onReplacePart}
          />
          {spec !== undefined && spec.ok ? <TimeChartPanel chart={spec.chart} /> : null}
          {schematicVisible ? (
            <section className={styles.panelLive} data-testid="schematic-hint">
              <h2 className={styles.liveTitle}>{JA.session.schematicHint}</h2>
              <div className={styles.schematicBox}>
                <SchematicSvg document={problem.schematic} />
              </div>
            </section>
          ) : null}
        </div>

        <div className={styles.bottomPanel}>
          <LogPanel
            lines={logLines}
            hazards={hazards}
            chatters={chatters}
            restoredHazardCount={restoredHazardCount}
          />
          <ElapsedTimer limit={problem.timeLimit} />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4a: 元に戻す・やり直しを実装する（I-11）**

C2 も白線の追加・青線の削除・部品交換を `history`（既存の `session/commands.ts`）で元に戻せるようにする。配線コマンドは Task 14 Step 4 の `apply()` が既に `store.pushHistory()` を呼んでいるので、残るのは①部品交換もコマンドとして記録すること、②`Toolbar` の `canUndo`/`canRedo`/`onUndo`/`onRedo` を実際につなぐことの2点。

`apps/desktop/src/renderer/session/commands.ts` の `SessionCommand` を次に置き換える（部品交換は盤（`BoardSession`）を変えないので、交換前後の `RepairCircuit` を別に持たせる）:

```ts
export interface SessionCommand {
  kind: 'addWire' | 'removeWire' | 'plug' | 'unplug' | 'setPreset' | 'replacePart';
  label: string;
  before: BoardSession;
  after: BoardSession;
  /** モードC2の部品交換のときだけ持つ、交換前後の回路（故障を含む）。undo/redo で使う。§9.2 */
  circuitBefore?: RepairCircuit;
  circuitAfter?: RepairCircuit;
}
```

同ファイルの import に次を足す:

```ts
import type { RepairCircuit } from '@ojt/content';
```

`apps/desktop/src/renderer/screens/InspectRepairSession.tsx` の `commands.js` の import を次に置き換える（`cloneSession, runAddWire, runRemoveWire` に4つ足す）:

```ts
import {
  cloneSession,
  redo as redoHistory,
  runAddWire,
  runRemoveWire,
  undo as undoHistory,
  type CommandHistory,
  type SessionCommand,
} from '../session/commands.js';
```

`@ojt/content` の import に `type RepairCircuit` を足す（`replacePart,` の直後）。

コンポーネント先頭の購読（`const pendingReport = useStore((s) => s.pendingReport);` の**直後**）に次を足す:

```ts
  const history = useStore((s) => s.history);
```

`onReplacePart` を次に置き換える（部品交換もコマンドとして履歴に積む）:

```ts
  const onReplacePart = (socketId: SocketId, partId: string): void => {
    const store = useStore.getState();
    const cloned = cloneSession(session);
    const nextCircuit = replacePart(circuit, partId);
    const command: SessionCommand = {
      kind: 'replacePart',
      label: `${JA.inspectRepair.replaced}: ${partId}`,
      before: cloned,
      after: cloned,
      circuitBefore: circuit,
      circuitAfter: nextCircuit,
    };
    bridge.send({ type: 'unplug', partId, session: cloned });
    bridge.send({ type: 'plug', socketId, session: cloned });
    store.setCircuit(nextCircuit);
    store.pushHistory(command);
    store.addLog(command.label);
  };
```

`onReplacePart` の**直前**に、元に戻す／やり直しの実装を足す:

```ts
  /**
   * 元に戻す／やり直し。§8.2 / §9.2
   * 部品交換の取り消しは、Worker の `plug` がそのたびに新しい良品を作ってしまうため
   * `unplug`/`plug` の送り直しでは元の故障を戻せない。**`load` をやり直す**ことで、
   * コマンドが持つ交換前後の `circuit`（故障つき `applied`）を丸ごと当て直す。
   * `applied.sites`（指摘すべき対象）は `replacePart()` で変わらないので、元に戻しても・
   * やり直しても指摘の要不要には影響しない（`sites` の義務は不変）。
   */
  const restore = (
    step: { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined,
    verb: string,
    circuitFor: (command: SessionCommand) => RepairCircuit | undefined,
  ): void => {
    if (step === undefined) return;
    const store = useStore.getState();
    store.setHistory(step.history);
    store.setSession(step.session);
    store.setSelectedWire(undefined);
    const nextCircuit = circuitFor(step.command) ?? store.circuit;
    if (nextCircuit !== undefined) store.setCircuit(nextCircuit);
    store.addLog(historyLog(verb, step.command.label));
    bridge.send({
      type: 'load',
      problemId: problem.id,
      session: cloneSession(step.session),
      ...(nextCircuit === undefined ? {} : { partFaults: nextCircuit.applied.partFaults }),
    });
  };
```

`ja.js` の import に `historyLog` を足す（`failedLog,` の直後）。

`<Toolbar` の `canUndo={false}` / `canRedo={false}` / `onUndo={() => undefined}` / `onRedo={() => undefined}` の4行を次に置き換える:

```tsx
        canUndo={history.done.length > 0}
        canRedo={history.undone.length > 0}
```

```tsx
        onUndo={() => {
          restore(undoHistory(history), JA.session.undo, (c) => c.circuitBefore);
        }}
        onRedo={() => {
          restore(redoHistory(history), JA.session.redo, (c) => c.circuitAfter);
        }}
```

- [ ] **Step 5: `SessionRoute` に C2 を足す**

`apps/desktop/src/renderer/screens/SessionRoute.tsx` の import に次を足す:

```ts
import { InspectRepairSession } from './InspectRepairSession.js';
```

`switch` に次の枝を足す（`case 'inspect-parts':` の**直後**）:

```tsx
    case 'inspect-repair':
      return <InspectRepairSession />;
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-repair-screen.test.tsx test/store-inspect.test.ts --no-file-parallelism
```

Expected: `Test Files  2 passed (2)`。`inspect-repair-screen` 12件。

- [ ] **Step 7: コミットする**

```powershell
git add apps/desktop/src/renderer/screens/InspectRepairSession.tsx apps/desktop/src/renderer/screens/SessionRoute.tsx apps/desktop/src/renderer/app/store.ts apps/desktop/src/renderer/app/store-types.ts apps/desktop/src/renderer/session/interaction.ts apps/desktop/src/renderer/session/spec-chart.ts apps/desktop/src/renderer/session/commands.ts apps/desktop/test/inspect-repair-screen.test.tsx
git commit -m @'
feat(desktop): add the mode C2 session screen with reports and repairs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 15: C2 の回路図連動ハイライト

**Files:**
- Modify: `apps/desktop/src/renderer/schematic/SchematicSvg.tsx`
- Modify: `apps/desktop/src/renderer/screens/InspectRepairSession.tsx`
- Test: `apps/desktop/test/highlight-link.test.tsx`

§9.2「回路図の要素をクリックすると3D盤の対応端子がハイライトされる」を、`buildHighlightIndex()`（Plan 2A）を鍵に双方向でつなぐ。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| 索引 | `buildHighlightIndex(circuit.cells, session)` を `useMemo` で作る（盤が変わったときだけ組み直す） | §15 |
| 回路図 → 盤 | SVGの図形の `cellId` をクリック → `highlightFor()` → 端子と電線を光らせる | §9.2 |
| 盤 → 回路図 | 3Dで端子にホバー → `cellIdsAtTerminal()` → 回路図の該当要素を太く描く | §9.2「およびその逆」 |
| 図形のクリック | `SchematicSvg` に `onPickCell?` を足す。図形に `cellId` が無い（母線など）ときは解除 | §11.2 の `Shape.cellId` |
| 見た目 | ハイライトされた図形は色を `HIGHLIGHT_STROKE` に変え線幅を1.8倍にする | 回路図は白地なので琥珀では読めない。3Dと同じ色にはしない（意図的な差分 #6） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/highlight-link.test.tsx`:

```tsx
import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildHighlightIndex,
  buildInspectRepairCircuit,
  cellIdsAtTerminal,
  highlightFor,
} from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchematicSvg } from '../src/renderer/schematic/SchematicSvg.js';

/**
 * 回路図 ⇄ 3D盤の連動ハイライト（Plan 2B Task 15）。設計仕様 §9.2 / §11.4。
 */

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);

afterEach(() => {
  cleanup();
});

describe('索引（Plan 2A の buildHighlightIndex）', () => {
  it('回路図の要素から盤の端子と電線を引ける', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const index = buildHighlightIndex(built.value.cells, built.value.session);
    const first = built.value.cells[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const target = highlightFor(index, first.cellId);
    expect(target?.terminals).toHaveLength(2);
    // 逆引きも通る
    const back = cellIdsAtTerminal(index, String(target?.terminals[0]));
    expect(back).toContain(first.cellId);
  });
});

describe('SchematicSvg のハイライト（§9.2）', () => {
  it('指定した要素の図形に data-highlight が付く', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const cellId = built.value.cells[0]?.cellId;
    expect(cellId).toBeDefined();
    if (cellId === undefined) return;
    render(<SchematicSvg document={C2.schematic} highlightCellIds={[cellId]} />);
    const svg = screen.getByTestId('schematic-svg');
    expect(svg.querySelectorAll('[data-highlight="true"]').length).toBeGreaterThan(0);
  });

  it('要素をクリックすると cellId が返る', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    if (!built.ok) return;
    const cellId = built.value.cells[0]?.cellId;
    if (cellId === undefined) return;
    const onPickCell = vi.fn();
    render(
      <SchematicSvg document={C2.schematic} highlightCellIds={[]} onPickCell={onPickCell} />,
    );
    const shape = screen.getByTestId('schematic-svg').querySelector(`[data-cell="${cellId}"]`);
    expect(shape).toBeTruthy();
    if (shape === null) return;
    fireEvent.click(shape);
    expect(onPickCell).toHaveBeenCalledWith(cellId);
  });

  it('母線など cellId を持たない図形をクリックすると undefined が返る（解除）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const onPickCell = vi.fn();
    render(
      <SchematicSvg document={C2.schematic} highlightCellIds={[]} onPickCell={onPickCell} />,
    );
    fireEvent.click(screen.getByTestId('schematic-svg'));
    expect(onPickCell).toHaveBeenCalledWith(undefined);
  });

  it('ハイライトを渡さなくても従来どおり描ける（モードBの回路図ヒント）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(<SchematicSvg document={C2.schematic} />);
    expect(screen.getByTestId('schematic-svg')).toBeTruthy();
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/highlight-link.test.tsx
```

Expected: 失敗。`Property 'highlightCellIds' does not exist on type` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `SchematicSvg.tsx` にハイライトとクリックを足す**

`apps/desktop/src/renderer/schematic/SchematicSvg.tsx` の `LABEL_FONT_SIZE` の**直後**に次を足す:

```ts
/** 連動ハイライトの線色と線幅の倍率。§9.2 */
const HIGHLIGHT_STROKE = '#C2410C';
const HIGHLIGHT_WIDTH_SCALE = 1.8;
```

`renderShape()` の宣言を次に置き換える（引数に `highlighted` と共通属性を足す）:

```tsx
/**
 * 図形プリミティブ1つを SVG 要素にする。
 * `highlighted` は §9.2 の連動ハイライト。白地の回路図では琥珀が読めないので、
 * 3D側（`HIGHLIGHT_COLOR`）とは別に濃い橙を使い、線幅も太らせて見分けられるようにする。
 * `data-cell` は「どの要素の図形か」を DOM に残すもので、クリックの受け口にもテストの
 * 手がかりにもなる（`Shape.cellId`。Plan 1B）。
 */
function renderShape(shape: Shape, index: number, highlighted: boolean): JSX.Element | null {
  const base = STROKE[shape.role];
  const style = highlighted
    ? { color: HIGHLIGHT_STROKE, width: base.width * HIGHLIGHT_WIDTH_SCALE }
    : base;
  const common = {
    ...(shape.cellId === undefined ? {} : { 'data-cell': shape.cellId }),
    ...(highlighted ? { 'data-highlight': 'true' } : {}),
  };
  switch (shape.kind) {
    case 'line':
      return (
        <line
          key={index}
          {...common}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={style.color}
          strokeWidth={style.width}
          strokeLinecap="round"
        />
      );
    case 'circle':
      return (
        <circle
          key={index}
          {...common}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill={shape.fill ?? (shape.role === 'junction' ? style.color : 'none')}
          stroke={style.color}
          strokeWidth={shape.role === 'junction' ? 0 : style.width}
        />
      );
    case 'arc': {
      const [x1, y1] = arcPoint(shape.cx, shape.cy, shape.r, shape.startDeg);
      const [x2, y2] = arcPoint(shape.cx, shape.cy, shape.r, shape.endDeg);
      const large = Math.abs(shape.endDeg - shape.startDeg) > 180 ? 1 : 0;
      return (
        <path
          key={index}
          {...common}
          d={`M ${x1} ${y1} A ${shape.r} ${shape.r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke={style.color}
          strokeWidth={style.width}
        />
      );
    }
    case 'text':
      return (
        <text
          key={index}
          {...common}
          x={shape.x}
          y={shape.y}
          fill={style.color}
          fontSize={LABEL_FONT_SIZE}
          textAnchor={shape.anchor}
          dominantBaseline="middle"
        >
          {shape.text}
        </text>
      );
  }
}
```

`SchematicSvg` を次に置き換える:

```tsx
/**
 * 回路図の SVG。§11.2
 * `highlightCellIds` と `onPickCell` はモードC2の連動ハイライト（§9.2）で使う。省略すると
 * 従来どおりの読取専用レンダラとして動く（モードBの回路図ヒント）。
 */
export function SchematicSvg({
  document: doc,
  highlightCellIds,
  onPickCell,
}: {
  document: SchematicDocument;
  highlightCellIds?: readonly string[];
  onPickCell?: (cellId: string | undefined) => void;
}): JSX.Element {
  const result = useMemo(() => layout(doc, LAYOUT), [doc]);
  const highlighted = useMemo(() => new Set(highlightCellIds ?? []), [highlightCellIds]);
  return (
    <svg
      viewBox={`0 0 ${result.width} ${result.height}`}
      role="img"
      aria-label={doc.title}
      data-testid="schematic-svg"
      style={{ width: '100%', background: '#F7F7F4', borderRadius: 4 }}
      onClick={(event) => {
        if (onPickCell === undefined) return;
        // クリックされた図形の `data-cell` を読む。母線やラベルには無いので解除になる
        const target = event.target as { getAttribute?: (name: string) => string | null };
        const cellId = target.getAttribute?.('data-cell') ?? undefined;
        onPickCell(cellId);
      }}
    >
      {result.shapes.map((shape, index) =>
        renderShape(
          shape,
          index,
          shape.cellId !== undefined && highlighted.has(shape.cellId),
        ),
      )}
    </svg>
  );
}
```

- [ ] **Step 4: `InspectRepairSession.tsx` で双方向につなぐ**

`apps/desktop/src/renderer/screens/InspectRepairSession.tsx` の `@ojt/content` の import に次を足す:

```ts
  buildHighlightIndex,
  cellIdsAtTerminal,
  highlightFor,
```

`store-types.js` の import を足す:

```ts
import { NO_HIGHLIGHT } from '../app/store-types.js';
```

`mountedParts` の `useMemo` はそのままの位置に残す。`onHover` の**直前**（`runAction` の `useCallback` の直後あたり）に、回路図索引とそれを安定して読むための参照をまとめて足す。**`onHover` より前に置くこと。** 索引を使う `onHover` の後ろに置くと、`latestIndex.current = highlightIndex;` が宣言前の `highlightIndex` を読もうとして TDZ（Temporal Dead Zone）エラーになる（B-6）:

```ts
  /**
   * 回路図要素 ⇄ 盤の索引。§9.2
   * 電線は**いまの盤**から引くので、故障で取り除かれた電線（未配線）は出てこない
   * （Plan 2A `buildHighlightIndex()`）。盤が変わるたびに組み直す。
   */
  const highlightIndex = useMemo(
    () =>
      circuit === undefined || session === undefined
        ? undefined
        : buildHighlightIndex(circuit.cells, session),
    [circuit, session],
  );
  /** 最新の索引（`onHover` は `useCallback([])` なので ref 経由で読む。§15） */
  const latestIndex = useRef(highlightIndex);
  latestIndex.current = highlightIndex;
```

`onHover` を次に置き換える（盤 → 回路図の逆引き）:

```ts
  /**
   * 端子のホバー。§9.2
   * 盤の端子から回路図の要素を逆引きして光らせる（連動ハイライトの「およびその逆」）。
   * 3Dが返すのは物理端子IDなので、索引が持つ役割IDへ直してから引く（§6.4）。
   *
   * 2点ガードする（I-8）: ①1級（`schematicVisible === false`）は回路図を出さないので
   * 逆引きしても無駄な `set` になるだけで、毎フレームのホバーのたびにストアを揺らさない。
   * ②同じ結果（`cellIds` の並びが同じ）なら `setHighlight()` を呼ばない。ホバーは
   * マウス移動のたびに飛んでくるので、同一端子の上に留まっている間の再描画を防ぐ。
   */
  const onHover = useCallback((id: TerminalId | undefined) => {
    const store = useStore.getState();
    store.setHovered(id);
    if (!store.schematicVisible) return;
    const current = store.session;
    const index = latestIndex.current;
    if (index === undefined || current === undefined || id === undefined) {
      if (store.highlight.cellIds.length > 0) store.setHighlight(NO_HIGHLIGHT);
      return;
    }
    const role = toNetlistTerminal(current.socketRoles, id);
    const cellIds = cellIdsAtTerminal(index, role);
    const next = cellIds.join(',');
    if (next === store.highlight.cellIds.join(',')) return;
    store.setHighlight(
      cellIds.length === 0 ? NO_HIGHLIGHT : { cellIds, terminals: [role], wireIds: [] },
    );
  }, []);
```

`SchematicSvg` の呼び出しを次に置き換える:

```tsx
                <SchematicSvg
                  document={problem.schematic}
                  highlightCellIds={useStore.getState().highlight.cellIds}
                  onPickCell={(cellId) => {
                    const store = useStore.getState();
                    const index = latestIndex.current;
                    if (cellId === undefined || index === undefined) {
                      store.setHighlight(NO_HIGHLIGHT);
                      return;
                    }
                    const target = highlightFor(index, cellId);
                    store.setHighlight(
                      target === undefined
                        ? NO_HIGHLIGHT
                        : {
                            cellIds: [cellId],
                            terminals: target.terminals.map((t) => String(t)),
                            wireIds: [...target.wireIds],
                          },
                    );
                  }}
                />
```

`useStore.getState().highlight.cellIds` を描画中に読むと再描画の引き金にならないので、コンポーネント先頭の購読に次を足し、`highlightCellIds={highlightCells}` に差し替える:

```ts
  const highlightCells = useStore((s) => s.highlight.cellIds);
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/highlight-link.test.tsx test/inspect-repair-screen.test.tsx test/polish.test.ts --no-file-parallelism
```

Expected: `Test Files  3 passed (3)`。`highlight-link` 5件。既存の回路図テストもそのまま通る（新しい props は任意）。

- [ ] **Step 6: コミットする**

```powershell
git add apps/desktop/src/renderer/schematic/SchematicSvg.tsx apps/desktop/src/renderer/screens/InspectRepairSession.tsx apps/desktop/test/highlight-link.test.tsx
git commit -m @'
feat(desktop): link the schematic and the board with two-way highlighting

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 16: モードC2 の結果画面

**Files:**
- Create: `apps/desktop/src/renderer/result/InspectRepairResult.tsx`
- Modify: `apps/desktop/src/renderer/screens/Result.tsx`
- Test: `apps/desktop/test/inspect-repair-result.test.tsx`

§9.2 判定①〜⑤（指摘の正誤／修復後の動作比較／白線ルールと改造／危険操作／所要時間）を1画面に出す。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| 指摘 | 「言い当てた故障」「見逃し」「過剰指摘」の3表 | §9.2 判定① |
| 動作比較 | 既存の `ChartOverlay` と `MismatchList` を再利用 | §9.2 判定② |
| 白線ルール・改造 | 既存の `StaticCheckList` ＋ 改造した電線IDの一覧 | §9.2 判定③ |
| 危険操作・時間 | 既存の `HazardList` ＋ `elapsedSummaryText()` | §9.2 判定④⑤ |
| 合否 | `result.passed` をそのまま出す（判定は Plan 2A が行う） | §9.2 合格条件 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/inspect-repair-result.test.tsx`:

```tsx
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  type JudgeInspectRepairResult,
} from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectRepairResult } from '../src/renderer/result/InspectRepairResult.js';

/**
 * モードC2の結果画面（Plan 2B Task 16）。設計仕様 §9.2 判定。
 */

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];

const NO_HAZARDS = {
  'ohm-on-live': 0,
  'range-exceeded': 0,
  'short-circuit-power-on': 0,
  'power-sequence-violation': 0,
  'over-wires-per-terminal': 0,
  overcurrent: 0,
} as const;

const EMPTY_CHART: JudgeInspectRepairResult['charts']['expected'] = {
  durationMs: 1000,
  signals: [],
  markers: [],
};

function result(overrides: Partial<JudgeInspectRepairResult> = {}): JudgeInspectRepairResult {
  return {
    mode: 'inspect-repair',
    passed: true,
    reports: { matched: [], missed: [], extra: [] },
    mismatches: [],
    staticChecks: [],
    modifications: [],
    addedWires: ['w-101'],
    hazardCount: 0,
    hazardsByKind: { ...NO_HAZARDS },
    chatter: [],
    elapsedMs: 600_000,
    charts: {
      expected: EMPTY_CHART,
      actual: EMPTY_CHART,
    },
    compareSignals: ['PL1'],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('InspectRepairResult（§9.2 判定）', () => {
  it('過不足なく指摘して修復すれば合格を出す', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result()}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.getByTestId('missed-list').textContent).toContain('なし');
    expect(screen.getByTestId('extra-list').textContent).toContain('なし');
  });

  it('見逃しと過剰指摘を並べる（§9.2 判定①）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result({
          passed: false,
          reports: {
            matched: [],
            missed: [
              {
                kind: 'wire-open',
                report: 'wire-open',
                wireId: 'sw-004',
                partId: undefined,
                terminals: [],
              },
            ],
            extra: [{ target: { wireId: 'sw-009' }, kind: 'wire-misrouted' }],
          },
        })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('不合格');
    expect(screen.getByTestId('missed-list').textContent).toContain('sw-004');
    expect(screen.getByTestId('extra-list').textContent).toContain('sw-009');
  });

  it('改造した電線を並べる（§9.2 判定③）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result({ passed: false, modifications: ['sw-002', 'sw-006'] })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    const list = screen.getByTestId('modification-list');
    expect(list.textContent).toContain('sw-002');
    expect(list.textContent).toContain('sw-006');
  });

  it('危険操作の回数に復元分を足す（§5.6 / §12.3）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result({ hazardCount: 1, hazardsByKind: { ...NO_HAZARDS, 'range-exceeded': 1 } })}
        restoredHazardCount={2}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByText(/危険操作（3）/)).toBeTruthy();
  });

  it('所要時間を出す（§9.2 判定⑤）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result()}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('result-elapsed').textContent).toContain('10:00.0');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-repair-result.test.tsx
```

Expected: 失敗。`Failed to resolve import "../src/renderer/result/InspectRepairResult.js"` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `result/InspectRepairResult.tsx` を作る**

`apps/desktop/src/renderer/result/InspectRepairResult.tsx`:

```tsx
import type { FaultSite, InspectRepairProblem, JudgeInspectRepairResult } from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { elapsedSummaryText, JA, reportTargetLabel } from '../i18n/ja.js';
import { ChartOverlay } from './ChartOverlay.js';
import { MismatchList } from './MismatchList.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * モードC2の結果画面。設計仕様 §9.2 判定①〜⑤。
 * 合格条件は「全故障を過不足なく指摘し、修復後の動作が模範と一致し、白線ルール違反と改造が
 * いずれも0」。危険操作の回数と所要時間は**参考表示**で合否には影響しない（§17.2 #3）。
 */

/** 故障の在処を1行の文字列にする（見逃しの一覧に出す）。 */
function siteLabel(site: FaultSite): string {
  const where =
    site.wireId !== undefined
      ? `${JA.session.wires} ${site.wireId}`
      : site.partId !== undefined
        ? `${JA.session.parts} ${site.partId}`
        : `${JA.inspectRepair.terminal} ${site.terminals.map((t) => String(t)).join(' / ')}`;
  return `${where} — ${JA.reportKind[site.report]}`;
}

/** モードC2の結果。 */
export function InspectRepairResult({
  problem,
  result,
  restoredHazardCount = 0,
  onRetry,
  onBackToList,
}: {
  problem: InspectRepairProblem;
  result: JudgeInspectRepairResult;
  restoredHazardCount?: number;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span
          className={`${styles.verdict} ${result.passed ? styles.passed : styles.failed}`}
          data-testid="verdict"
          role="status"
          aria-live="polite"
        >
          {result.passed ? JA.result.passed : JA.result.failed}
        </span>
        <h1 className={styles.title}>
          {JA.result.title}: {problem.title}
        </h1>
        <span data-testid="result-elapsed">
          {JA.result.elapsed} {formatElapsed(elapsedMs)}（
          {elapsedSummaryText(
            elapsedMs,
            problem.timeLimit.standardMin,
            problem.timeLimit.cutoffMin,
          )}
          ）
        </span>
      </div>

      {result.chatter.length === 0 ? null : (
        <p className={styles.forbidden} data-testid="forbidden-warning">
          {JA.result.forbidden}
        </p>
      )}

      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>{JA.inspectRepair.reports}</h2>
          <p className={styles.detail}>{JA.inspectRepair.matched}</p>
          <ul data-testid="matched-list">
            {result.reports.matched.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.reports.matched.map((hit, index) => (
                <li key={`m-${String(index)}`}>{siteLabel(hit.site)}</li>
              ))
            )}
          </ul>
          <p className={styles.detail}>{JA.inspectRepair.missed}</p>
          <ul data-testid="missed-list">
            {result.reports.missed.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.reports.missed.map((site, index) => (
                <li key={`x-${String(index)}`}>{siteLabel(site)}</li>
              ))
            )}
          </ul>
          <p className={styles.detail}>{JA.inspectRepair.extra}</p>
          <ul data-testid="extra-list">
            {result.reports.extra.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.reports.extra.map((report, index) => (
                <li key={`e-${String(index)}`}>
                  {reportTargetLabel(report.target)} — {JA.reportKind[report.kind]}
                </li>
              ))
            )}
          </ul>
        </div>

        <ChartOverlay expected={result.charts.expected} actual={result.charts.actual} />
        <MismatchList mismatches={result.mismatches} />
        <StaticCheckList checks={result.staticChecks} />

        <div className={styles.card}>
          <h2>{JA.inspectRepair.modifications}</h2>
          <ul data-testid="modification-list">
            {result.modifications.length === 0 ? (
              <li>{JA.inspectRepair.noModification}</li>
            ) : (
              result.modifications.map((wireId) => <li key={wireId}>{wireId}</li>)
            )}
          </ul>
          <p className={styles.detail}>{JA.inspectRepair.addedWires}</p>
          <ul data-testid="added-wire-list">
            {result.addedWires.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.addedWires.map((wireId) => <li key={wireId}>{wireId}</li>)
            )}
          </ul>
        </div>

        <HazardList
          counts={result.hazardsByKind}
          total={result.hazardCount + restoredHazardCount}
        />
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={onRetry}>
          {JA.result.retry}
        </button>
        <button type="button" onClick={onBackToList}>
          {JA.result.toList}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `Result.tsx` に C2 の枝を足す**

`apps/desktop/src/renderer/screens/Result.tsx` の import に次を足す:

```ts
import { isInspectRepairProblem } from '@ojt/content';
import { InspectRepairResult } from '../result/InspectRepairResult.js';
```

`if (isInspectJudge(judge)) { … }` のブロックの中、C1の枝の**直後**に次を挿入する:

```tsx
    if (judge.mode === 'inspect-repair' && isInspectRepairProblem(problem)) {
      return (
        <InspectRepairResult
          problem={problem}
          result={judge}
          restoredHazardCount={restoredHazardCount}
          onRetry={() => {
            resetSession();
          }}
          onBackToList={() => {
            setRoute('list');
          }}
        />
      );
    }
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/inspect-repair-result.test.tsx test/inspect-parts-result.test.tsx test/result-view.test.tsx --no-file-parallelism
```

Expected: `Test Files  3 passed (3)`。`inspect-repair-result` 5件。

- [ ] **Step 6: コミットする**

```powershell
git add apps/desktop/src/renderer/result/InspectRepairResult.tsx apps/desktop/src/renderer/screens/Result.tsx apps/desktop/test/inspect-repair-result.test.tsx
git commit -m @'
feat(desktop): show the mode C2 report, repair and modification result

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 17: ホーム・課題一覧のモード分けと C1/C2 の作業ファイル

**Files:**
- Modify: `apps/desktop/src/renderer/screens/Home.tsx`
- Modify: `apps/desktop/src/renderer/screens/ProblemList.tsx`
- Modify: `apps/desktop/src/renderer/app/store.ts`
- Modify: `apps/desktop/src/renderer/app/store-types.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/main/work-files.ts`
- Modify: `apps/desktop/src/renderer/session/work-file.ts`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Modify: `apps/desktop/test/problem-list.test.tsx`
- Test: `apps/desktop/test/work-file-inspect.test.ts`

§12.1 のモード選択から C1/C2 を開けるようにし、§12.3 の作業ファイルにテスター状態・解答・指摘を載せる。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| モードカード | 回路組立／部品点検／回路点検・修復 の3つを押せるようにする（PLC は「準備中」のまま） | §16 Phase 2「モードB・C1・C2 が動くアプリ」 |
| 一覧の絞り込み | ホームで選んだモードを `listMode` に持ち、一覧はそれで絞る（「すべて」も選べる） | §12.1 |
| 作業ファイル | `formatVersion` は **1 のまま**にし、`mode` / `tester` / `answers` / `reports` / `checkPartId` / `faults` / `initialWireIds` / `cells` を**任意**の項目として足す | §13 #8 は「未知のバージョンは読み込まない」。上げると Phase 1 に保存した作業ファイルが読めなくなり、§13 の「作業保持の原則」に反する（意図的な差分 #7） |
| C2 の復元 | `faults` / `initialWireIds` / `cells` を保存しておき、ランダム故障の課題でも**同じ故障**で復元する | §5.2 の決定論 / §12.3 |
| 復元できないとき | 任意の項目が欠けていたら、その課題を**最初から**開く（黙って壊れた状態で開かない） | §13 #8 |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/work-file-inspect.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildInspectRepairCircuit,
} from '@ojt/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { toInspectWorkFile, restoreInspectState } from '../src/renderer/session/work-file.js';

/**
 * C1/C2 の作業ファイル（Plan 2B Task 17）。設計仕様 §12.3 / §13 #8。
 */

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];

beforeEach(() => {
  useStore.getState().abandonSession();
});

describe('toInspectWorkFile（§12.3）', () => {
  it('C1はテスター状態・解答・点検中の部品を載せる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    useStore.getState().openProblem(C1);
    const first = C1.parts[0];
    if (first === undefined) return;
    useStore.getState().setCheckPart(first.id);
    useStore.getState().setAnswer(first.id, 'coil-open');
    useStore.getState().applyTester({ type: 'set-mode', mode: 'OHM' });
    const file = toInspectWorkFile();
    expect(file).toBeDefined();
    if (file === undefined) return;
    expect(file.formatVersion).toBe(1);
    expect(file.mode).toBe('inspect-parts');
    expect(file.checkPartId).toBe(first.id);
    expect(file.answers).toEqual([{ partId: first.id, answer: 'coil-open' }]);
    expect((file.tester as { mode: string }).mode).toBe('OHM');
  });

  it('C2は指摘・故障の種・解決済みの故障を載せる（§5.2 / Plan 2A I-4）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    useStore.getState().openProblem(C2);
    useStore.getState().addReport({ target: { wireId: 'sw-001' }, kind: 'wire-open' });
    const file = toInspectWorkFile();
    expect(file).toBeDefined();
    if (file === undefined) return;
    expect(file.mode).toBe('inspect-repair');
    expect(file.reports).toHaveLength(1);
    expect(typeof file.faultSeed).toBe('number');
    expect(Array.isArray(file.resolvedFaults)).toBe(true);
    expect((file.resolvedFaults as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('restoreInspectState（§12.3 / §13 #8）', () => {
  it('C1の解答とテスター状態を戻す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    useStore.getState().openProblem(C1);
    const first = C1.parts[0];
    if (first === undefined) return;
    const ok = restoreInspectState(C1, {
      mode: 'inspect-parts',
      checkPartId: first.id,
      answers: [{ partId: first.id, answer: 'a-weld' }],
      tester: { ...useStore.getState().tester, mode: 'CONT', black: toTerminalId('CHK.9') },
    });
    expect(ok).toBe(true);
    expect(useStore.getState().answers).toEqual([{ partId: first.id, answer: 'a-weld' }]);
    expect(useStore.getState().tester.mode).toBe('CONT');
    expect(useStore.getState().checkPartId).toBe(first.id);
  });

  it('C2は保存した解決済みの故障で回路を組み直す（ランダム故障でも同じ盤になる。§5.2 / Plan 2A I-4）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    useStore.getState().openProblem(C2);
    const resolvedFaults = [...built.value.applied.wireFaults, ...built.value.applied.partFaults];
    const ok = restoreInspectState(C2, {
      mode: 'inspect-repair',
      reports: [{ target: { wireId: 'sw-001' }, kind: 'wire-open' }],
      resolvedFaults,
    });
    expect(ok).toBe(true);
    expect(useStore.getState().reports).toHaveLength(1);
    expect(useStore.getState().circuit?.applied.sites).toEqual(built.value.applied.sites);
  });

  it('C2で故障が欠けていたら復元しない（§13 #8）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    useStore.getState().openProblem(C2);
    expect(restoreInspectState(C2, { mode: 'inspect-repair', reports: [] })).toBe(false);
  });

  it('モードが課題と食い違っていたら復元しない', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    useStore.getState().openProblem(C1);
    expect(restoreInspectState(C1, { mode: 'inspect-repair', reports: [] })).toBe(false);
  });

  it('何も無ければ（Phase 1 の作業ファイル）そのまま受け入れる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    useStore.getState().openProblem(C1);
    expect(restoreInspectState(C1, {})).toBe(true);
  });
});
```

`apps/desktop/test/problem-list.test.tsx` の末尾に次を足す（既存の import と道具立てをそのまま使う。B-4: 元のテストは `listProblems` を一切モックしておらず、`window.ojt` が無いまま `problem-table` を探すので必ずタイムアウトしていた。3モードの課題を持つ専用のモックデータを用意する）:

```tsx
/** 3モードそれぞれ1件ずつのモックデータ（絞り込みの確認用）。§12.1 */
const THREE_MODE_PAYLOAD: ProblemListPayload = {
  problems: [
    {
      id: 'b-001',
      title: '自己保持回路',
      mode: 'assemble',
      grade: 3,
      description: '起動と停止',
      standardMin: 30,
      cutoffMin: 50,
      source: 'builtin',
    },
    {
      id: 'c1-001',
      title: '部品点検セット1',
      mode: 'inspect-parts',
      grade: 2,
      description: 'リレー・タイマの点検',
      standardMin: 20,
      cutoffMin: 30,
      source: 'builtin',
    },
    {
      id: 'c2-001',
      title: '回路点検・修復1',
      mode: 'inspect-repair',
      grade: 2,
      description: '故障の指摘と白線修復',
      standardMin: 40,
      cutoffMin: 60,
      source: 'builtin',
    },
  ],
  errors: [],
  userDir: 'C:/dummy',
  userDirExists: true,
};

describe('モードで絞る（Plan 2B Task 17。§12.1）', () => {
  it('「すべて」なら3モードの3行が並ぶ', async () => {
    setApi({ listProblems: () => Promise.resolve(THREE_MODE_PAYLOAD) });
    useStore.setState({ listMode: undefined });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    expect(screen.getByTestId('problem-table').querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('ホームで選んだモードだけに絞ると1行になる（3行 → 絞ると1行）', async () => {
    setApi({ listProblems: () => Promise.resolve(THREE_MODE_PAYLOAD) });
    useStore.setState({ listMode: 'inspect-parts' });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    const rows = screen.getByTestId('problem-table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId('problem-table').textContent).not.toContain('自己保持回路');
    expect(screen.getByTestId('problem-table').textContent).toContain('部品点検セット1');
  });
});
```

内蔵20題すべてが一覧行にできることは `test/content-loader.test.ts`（Task 1）の `BUILTIN_ALL_PROBLEMS` 直接テストで確かめ済みなので、ここでは3モードの絞り込みだけを見ればよい（実際の20題を使うUIテストは `listMode` の組合せごとに遅く壊れやすい）。

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/work-file-inspect.test.ts test/problem-list.test.tsx --no-file-parallelism
```

Expected: 失敗。`toInspectWorkFile is not exported` と `Property 'listMode' does not exist` で `Test Files  2 failed (2)`。

- [ ] **Step 3: `shared/ipc.ts` の `WorkFile` に任意の項目を足す**

`apps/desktop/src/shared/ipc.ts` の `WorkFile` を次に置き換える:

```ts
/**
 * 作業ファイルの中身。§12.3
 *
 * `formatVersion` は **1 のまま**にし、C1/C2 の項目はすべて**任意**にする。上げてしまうと
 * Phase 1 に保存した作業ファイルが「新しいバージョン」扱いで読めなくなり（§13 #8）、
 * §13 の「作業保持の原則」に反するためである。読み手（`applyWorkFile()`）は欠けていたら
 * 課題を最初から開く。
 */
export interface WorkFile {
  formatVersion: number;
  problemId: string;
  /** `BoardSession` をそのまま JSON にしたもの。 */
  session: unknown;
  elapsedMs: number;
  hazardCount: number;
  savedAt: string;
  /** 課題のモード（無ければ `assemble` とみなす）。§12.1 */
  mode?: SessionMode;
  /** テスターの状態（`TesterState` をそのまま JSON にしたもの）。§12.3 */
  tester?: unknown;
  /** モードC1のマークシートの解答（`InspectPartAnswer[]`）。§9.1 */
  answers?: unknown;
  /** モードC1で点検中の部品ID。§9.1 */
  checkPartId?: string;
  /** モードC2の指摘（`FaultReport[]`）。§9.2 */
  reports?: unknown;
  /**
   * モードC2の故障の種（起動時に決めた・課題が持たない場合は生成した値）。§5.2
   * `resolvedFaults` と対にして残す。デバッグ用の記録であり、復元には使わない
   * （`seed` だけから `resolveFaults()` を呼び直すと、`random.seed` の無い課題は内部で
   * `Date.now()` を使うため初回と別の故障になってしまう）。
   */
  faultSeed?: number;
  /**
   * モードC2の解決済みの故障（`FaultSpecData[]`）。§5.2 / Plan 2A I-4
   * 復元時は `buildInspectRepairCircuit(problem, board, { resolvedFaults })` へそのまま渡し、
   * `resolveFaults()` を呼び直させない。`initialWireIds` / `cells` は同じ入力（課題・盤・
   * この配列）から毎回同じ値になるので、別項目としては保存しない。
   */
  resolvedFaults?: unknown;
}
```

- [ ] **Step 4: `main/work-files.ts` が任意の項目を写すようにする**

`apps/desktop/src/main/work-files.ts` の `parseWorkFile()` の `return { ok: true, file: { … } };` を次に置き換える:

```ts
  /*
   * C1/C2 の項目（Plan 2B）は**任意**なので、あれば写し、無ければ付けない
   * （`exactOptionalPropertyTypes` の下では `undefined` を代入できない）。
   * 中身の妥当性は renderer が課題と突き合わせて確かめる（main は盤の定義を知らない）。
   */
  const optional: Partial<WorkFile> = {};
  const mode = source['mode'];
  if (mode === 'assemble' || mode === 'inspect-parts' || mode === 'inspect-repair') {
    optional.mode = mode;
  }
  if (typeof source['checkPartId'] === 'string') optional.checkPartId = source['checkPartId'];
  if (typeof source['faultSeed'] === 'number') optional.faultSeed = source['faultSeed'];
  for (const key of ['tester', 'answers', 'reports', 'resolvedFaults'] as const) {
    if (source[key] !== undefined) optional[key] = source[key];
  }
  return {
    ok: true,
    file: {
      formatVersion: version,
      problemId: source['problemId'],
      session: source['session'],
      elapsedMs: typeof source['elapsedMs'] === 'number' ? source['elapsedMs'] : 0,
      hazardCount: typeof source['hazardCount'] === 'number' ? source['hazardCount'] : 0,
      savedAt: typeof source['savedAt'] === 'string' ? source['savedAt'] : '',
      ...optional,
    },
  };
```

- [ ] **Step 5: `session/work-file.ts` に C1/C2 の保存と復元を足す**

`apps/desktop/src/renderer/session/work-file.ts` の import を次に置き換える:

```ts
import {
  JIPM_BOARD,
  MOUNTABLE_KINDS,
  SOCKET_IDS,
  toPhysicalTerminal,
  validateSocketRoles,
  type BoardSession,
} from '@ojt/board-model';
import type { TerminalId, TesterState, WireColor } from '@ojt/circuit-sim';
import {
  buildInspectRepairCircuit,
  isInspectPartsProblem,
  isInspectRepairProblem,
  type FaultReport,
  type FaultSpecData,
  type InspectPartAnswer,
  type SupportedProblem,
} from '@ojt/content';
import { WORK_FILE_FORMAT_VERSION, type WorkFile } from '../../shared/ipc.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { JA, workFileProblemMissingText, workFileRestoredLog } from '../i18n/ja.js';
import { cloneSession } from './commands.js';
import { bridge } from './worker-bridge.js';
```

同ファイルの `toWorkFile()` の**直後**に次を足す:

```ts
/**
 * いまのモード固有の状態を足した作業ファイルを作る。§12.3
 * モードBのときは `toWorkFile()` と同じものを返す（追加の項目が付かないだけ）。
 * 課題も盤も無ければ `undefined`（保存できる状態にない）。
 */
export function toInspectWorkFile(): WorkFile | undefined {
  const {
    problem,
    session,
    elapsedMs,
    hazards,
    tester,
    answers,
    reports,
    circuit,
    checkPartId,
    faultSeed,
  } = useStore.getState();
  if (problem === undefined || session === undefined) return undefined;
  const base = toWorkFile(problem.id, session, elapsedMs, hazards.length);
  if (isInspectPartsProblem(problem)) {
    return {
      ...base,
      mode: 'inspect-parts',
      tester,
      answers: [...answers],
      ...(checkPartId === undefined ? {} : { checkPartId }),
    };
  }
  if (isInspectRepairProblem(problem)) {
    if (circuit === undefined) return { ...base, mode: 'inspect-repair' };
    return {
      ...base,
      mode: 'inspect-repair',
      tester,
      reports: [...reports],
      ...(faultSeed === undefined ? {} : { faultSeed }),
      resolvedFaults: [...circuit.applied.wireFaults, ...circuit.applied.partFaults],
    };
  }
  return { ...base, mode: 'assemble' };
}

/** 作業ファイルのモード固有の部分（読み手が受け取る形）。 */
export interface InspectWorkState {
  mode?: WorkFile['mode'];
  tester?: unknown;
  answers?: unknown;
  checkPartId?: string;
  reports?: unknown;
  faultSeed?: number;
  resolvedFaults?: unknown;
}

/** `TesterState` として読めるか（つまみとレンジだけ確かめる。§13 #8） */
function isTesterState(value: unknown): value is TesterState {
  if (!isRecord(value)) return false;
  const mode = value['mode'];
  const kind = value['kind'];
  if (kind !== 'digital' && kind !== 'analog') return false;
  return (
    mode === 'off' || mode === 'DCV' || mode === 'ACV' || mode === 'OHM' || mode === 'CONT'
  );
}

/**
 * モード固有の状態を戻す。§12.3 / §13 #8
 *
 * 戻せたら `true`、戻せなかったら `false`（呼び出し側は課題を最初から開いた状態のままにする）。
 * **黙って壊れた状態で開かない**ことを優先する。とくにC2は故障の在処（`applied`）が無いと
 * 「どこが故障か」を判定できないので、欠けていたら復元しない。
 */
export function restoreInspectState(
  problem: SupportedProblem,
  state: InspectWorkState,
): boolean {
  const store = useStore.getState();
  if (state.mode !== undefined && state.mode !== problem.mode) return false;
  if (isTesterState(state.tester)) {
    store.setTester(state.tester);
    /*
     * Worker側の `tester` はストアとは別の複製（Task 3）なので、`load` の直後は
     * つまみOFF・レンジ既定へ戻っている。4つの操作を送り直して同じ状態に揃える
     * （新しいコマンドは増やさず、既存の `TesterAction` をそのまま使う。I-3）。
     * プローブは `load` のたびに外れる仕様（Task 3）なので送り直さない。
     */
    const t = state.tester;
    bridge.send({ type: 'tester', action: { type: 'set-kind', kind: t.kind } });
    bridge.send({ type: 'tester', action: { type: 'set-mode', mode: t.mode } });
    bridge.send({ type: 'tester', action: { type: 'set-volt-range', range: t.voltRange } });
    bridge.send({ type: 'tester', action: { type: 'set-ohm-range', range: t.ohmRange } });
  }

  if (isInspectPartsProblem(problem)) {
    if (Array.isArray(state.answers)) {
      const ids = new Set(problem.parts.map((p) => p.id));
      for (const answer of state.answers as InspectPartAnswer[]) {
        if (!isRecord(answer)) continue;
        if (typeof answer.partId !== 'string' || !ids.has(answer.partId)) continue;
        if (typeof answer.answer !== 'string') continue;
        store.setAnswer(answer.partId, answer.answer);
      }
    }
    if (state.checkPartId !== undefined && problem.parts.some((p) => p.id === state.checkPartId)) {
      store.setCheckPart(state.checkPartId);
    }
    return true;
  }

  if (isInspectRepairProblem(problem)) {
    if (state.mode === undefined) return true; // Phase 1 の作業ファイル（モードB用）
    if (!Array.isArray(state.resolvedFaults)) return false;
    /*
     * 保存しておいた解決済みの故障をそのまま渡し、`resolveFaults()` を呼び直させない
     * （Plan 2A I-4）。`seed` だけを保存して引き直すと、`random.seed` の無い課題は
     * 内部で `Date.now()` を使うため初回と別の故障になってしまう。
     * `buildInspectRepairCircuit()` を通すので、壊れた・古い保存内容は理由付きで断れる（§13 #8）。
     */
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD, {
      resolvedFaults: state.resolvedFaults as FaultSpecData[],
    });
    if (!built.ok) return false;
    store.setCircuit(built.value);
    if (Array.isArray(state.reports)) {
      for (const report of state.reports as FaultReport[]) {
        if (isRecord(report) && isRecord(report.target) && typeof report.kind === 'string') {
          store.addReport(report);
        }
      }
    }
    return true;
  }
  return true;
}
```

`applyWorkFile()` の `store.restoreProgress(file.elapsedMs, file.hazardCount);` の**直前**に次を挿入する:

```ts
  // モード固有の状態（テスター・解答・指摘・故障）を戻す。戻せなければ最初から開いた状態で続ける
  if (!restoreInspectState(problem, file)) {
    store.toast(JA.session.badSession, 'error');
  }
```

`applyWorkFile()` が C2 のとき `bridge.send({ type:'load', … })` に故障を載せるよう、その行を次に置き換える:

```ts
  const circuit = useStore.getState().circuit;
  bridge.send({
    type: 'load',
    problemId: problem.id,
    session: cloneSession(session),
    ...(circuit === undefined ? {} : { partFaults: circuit.applied.partFaults }),
  });
```

`store.ts` の `AppState` に `setTester` を足す（`applyTester` の**直後**）:

```ts
  /** テスターの状態をまるごと差し替える（作業ファイルからの復元）。§12.3 */
  setTester: (tester: TesterState) => void;
```

実装（`applyTester` の**直後**）:

```ts
  setTester: (tester) => {
    set({ tester });
  },
```

`App.tsx` の一時保存（30秒ごと）を `toInspectWorkFile()` に差し替える:

```ts
      const file = toInspectWorkFile();
      if (file === undefined) return;
      void api.saveWorkFile({ kind: 'autosave', file });
```

（`App.tsx` の import を `import { applyWorkFile, toInspectWorkFile } from '../session/work-file.js';` に直し、`state.route !== 'session'` の判定は残す。）

同じ差し替えを `Session.tsx` / `InspectPartsSession.tsx` / `InspectRepairSession.tsx` の「作業を保存」でも行う（`toWorkFile(problem.id, session, …)` を `toInspectWorkFile()` に置き換え、`undefined` なら何もしない）。

- [ ] **Step 6: ホームと課題一覧をモードで分ける**

`apps/desktop/src/renderer/app/store-types.ts` の先頭の import に `type SessionMode` を足す（`import type { HazardKind } from '@ojt/circuit-sim';` の直後）:

```ts
import type { SessionMode } from '../../shared/ipc.js';
```

同ファイルの末尾に次を足す（`SessionMode` は Task 1 で `shared/ipc.ts` に置いた `SupportedProblem['mode']` を再利用する。同じ3値のユニオンを2箇所に書かない）:

```ts
/** 課題一覧の絞り込み（`undefined` は「すべて」）。§12.1 */
export type ListMode = SessionMode | undefined;
```

`apps/desktop/src/renderer/app/store.ts` の `AppState` の `problems` の**直後**に次を足す:

```ts
  /** 課題一覧の絞り込み（ホームで選んだモード。`undefined` は「すべて」）。§12.1 */
  listMode: ListMode;
```

`AppState` の `setProblems` の**直後**に次を足す:

```ts
  /** 課題一覧の絞り込みを変える。§12.1 */
  setListMode: (mode: ListMode) => void;
```

初期値（`problems: undefined,` の直後）に `listMode: undefined,` を足し、`setProblems` の実装の**直後**に次を足す:

```ts
  setListMode: (listMode) => {
    set({ listMode });
  },
```

`store.ts` の `store-types.js` の import と再エクスポートに `type ListMode` を足す。

`apps/desktop/src/renderer/screens/Home.tsx` の `MODES` と `Home()` を次に置き換える:

```tsx
/** モードの並び。§12.1 / §16 Phase 2（B・C1・C2 が動く） */
const MODES: ReadonlyArray<{
  key: string;
  mode: ListMode;
  name: string;
  desc: string;
  enabled: boolean;
}> = [
  {
    key: 'assemble',
    mode: 'assemble',
    name: JA.home.assemble,
    desc: JA.home.assembleDesc,
    enabled: true,
  },
  {
    key: 'inspect-parts',
    mode: 'inspect-parts',
    name: JA.home.inspectParts,
    desc: JA.home.inspectPartsDesc,
    enabled: true,
  },
  {
    key: 'inspect-repair',
    mode: 'inspect-repair',
    name: JA.home.inspectRepair,
    desc: JA.home.inspectRepairDesc,
    enabled: true,
  },
  { key: 'plc', mode: undefined, name: JA.home.plc, desc: JA.home.comingSoon, enabled: false },
];

/** ホーム画面。 */
export function Home(): JSX.Element {
  const setRoute = useStore((s) => s.setRoute);
  const setListMode = useStore((s) => s.setListMode);
  return (
    <div className={styles.center}>
      <h1 className={styles.title}>{JA.app.name}</h1>
      <p className={styles.subtitle}>{JA.app.subtitle}</p>
      <h2 className={styles.title} style={{ fontSize: 18 }}>
        {JA.home.title}
      </h2>
      <div className={styles.modeGrid}>
        {MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            className={styles.modeCard}
            disabled={!mode.enabled}
            data-testid={`mode-${mode.key}`}
            onClick={() => {
              setListMode(mode.mode);
              setRoute('list');
            }}
          >
            <span className={styles.modeName}>{mode.name}</span>
            <span className={styles.modeDesc}>{mode.desc}</span>
          </button>
        ))}
      </div>
      <p style={{ marginTop: 24 }}>
        <button
          type="button"
          data-testid="open-settings"
          onClick={() => {
            setRoute('settings');
          }}
        >
          {JA.home.settings}
        </button>
      </p>
    </div>
  );
}
```

`Home.tsx` の import に `import type { ListMode } from '../app/store.js';` を足す。

`apps/desktop/src/renderer/i18n/ja.ts` の `home:` ブロックの `inspectRepair: '回路点検・修復',` の**直後**に次を足す:

```ts
    inspectPartsDesc: '不良のリレー・タイマをチェック用ソケットで点検する（モードC1）',
    inspectRepairDesc: '故障が入った盤を点検し、白線で修復する（モードC2）',
```

`apps/desktop/src/renderer/screens/ProblemList.tsx` の `const problems = useStore((s) => s.problems);` の**直後**に次を足す:

```ts
  const listMode = useStore((s) => s.listMode);
  const setListMode = useStore((s) => s.setListMode);
```

`<tbody>` の中の `problems.problems.map(...)` を次に置き換える:

```tsx
            {problems.problems
              .filter((problem) => listMode === undefined || problem.mode === listMode)
              .map((problem) => (
```

（閉じ括弧は `))}` のまま。）

`<table className={styles.problemTable} …>` の**直前**に絞り込みの切替を足す:

```tsx
      <div className={styles.modeFilter} data-testid="mode-filter">
        {(
          [
            [undefined, JA.problemList.allModes],
            ['assemble', JA.home.assemble],
            ['inspect-parts', JA.home.inspectParts],
            ['inspect-repair', JA.home.inspectRepair],
          ] as ReadonlyArray<readonly [ListMode, string]>
        ).map(([mode, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={listMode === mode}
            onClick={() => {
              setListMode(mode);
            }}
          >
            {label}
          </button>
        ))}
      </div>
```

`ProblemList.tsx` の import に `import type { ListMode } from '../app/store.js';` を足し、`ja.ts` の `problemList:` に次を足す（`empty:` の直後）:

```ts
    /** 絞り込みの「すべて」。§12.1 */
    allModes: 'すべて',
```

`screens.module.css` の末尾に次を足す:

```css
/* 課題一覧のモード絞り込み。§12.1 */
.modeFilter {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
```

- [ ] **Step 7: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/work-file-inspect.test.ts test/problem-list.test.tsx test/work-file.test.ts test/work-files.test.ts test/app.test.tsx --no-file-parallelism
```

Expected: `Test Files  5 passed (5)`。`work-file-inspect` 7件、`problem-list` は既存＋2件。

- [ ] **Step 8: コミットする**

```powershell
git add apps/desktop/src/renderer/screens/Home.tsx apps/desktop/src/renderer/screens/ProblemList.tsx apps/desktop/src/renderer/screens/screens.module.css apps/desktop/src/renderer/app/store.ts apps/desktop/src/renderer/app/store-types.ts apps/desktop/src/renderer/app/App.tsx apps/desktop/src/renderer/session/work-file.ts apps/desktop/src/renderer/screens/Session.tsx apps/desktop/src/renderer/screens/InspectPartsSession.tsx apps/desktop/src/renderer/screens/InspectRepairSession.tsx apps/desktop/src/shared/ipc.ts apps/desktop/src/main/work-files.ts apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test/work-file-inspect.test.ts apps/desktop/test/problem-list.test.tsx
git commit -m @'
feat(desktop): open C1 and C2 from home and save their work files

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 18: E2E（§16 Phase 2 受入基準①〜④）と全体検証

**Files:**
- Create: `apps/desktop/e2e/inspect.spec.ts`
- Modify: `apps/desktop/e2e/projection.ts`

§16 Phase 2 の受入基準①〜④を、**ビルドしたアプリ**の上で自動操作して確かめ、スクリーンショットを残す。

| 受入基準 | E2E での確認 |
|---|---|
| ① C1でチェック用ソケットに不良リレーを挿し、赤PBで励磁しテスターで測ると判定表どおりの読値になる | 正常品 `650.0 Ω` / コイル断線 `OL` / レアショート `422.5 Ω`（Plan 2A 実測表）。**赤PBでの吸引の有無**（コイル断線は吸引しない／レアショートは吸引する）は3Dの押ボタンを押す必要があるため、E2Eではなく Worker テスト（`test/sim-worker-inspect.test.ts`）で固定する。押ボタンは3Dオブジェクトしか無く、盤ローカル座標の押し込み判定を E2E に持ち込むと、筐体の寸法を変えるたびにテストが壊れるため |
| ② コイル断線は吸引せず `OL`、レアショートは正常に吸引して約420Ω。マークシートで選ぶと正解 | 全問正解 → `合格` |
| ③ C2で故障2箇所を指摘し白線で修復すると合格する | 指摘2件＋白線修復 → `合格` |
| ④ 電源ONのままΩレンジを当てると警告が出て結果に回数が記録される | 赤PBを押したままΩ → 警告バナー → 結果画面の危険操作に回数 |

- [ ] **Step 1: `e2e/projection.ts` に役割IDの射影を足す**

`apps/desktop/e2e/projection.ts` の**既存の import に追記する**（I-6: 「置き換える」と読んで先頭の import 節ごと差し替えると、既存の `import type { TerminalId } from '@ojt/circuit-sim';` を消してしまい、`terminalPoint()` の型が壊れる）。`import { boardTerminalPos, JIPM_BOARD } from '@ojt/board-model';` の1行だけを次に置き換え、`SocketRoles` の型 import を新たに1行足す。`import type { TerminalId } from '@ojt/circuit-sim';` は既存のまま変えない:

```ts
import { boardTerminalPos, JIPM_BOARD, toPhysicalTerminal } from '@ojt/board-model';
import type { SocketRoles } from '@ojt/board-model';
```

`terminalPoint()` の**直後**に次を足す:

```ts
/**
 * 盤の**役割**端子ID（`CHK.13` / `CR1.9`）が来るページ座標（正面視プリセット前提）。
 * 3D盤は物理端子（`S7.13`）で描かれているので、割当表で直してから射影する（§6.4）。
 */
export function roleTerminalPoint(
  roles: SocketRoles,
  terminal: string,
  box: CanvasBox,
): { x: number; y: number } {
  return terminalPoint(toPhysicalTerminal(roles, terminal as TerminalId), box);
}
```

- [ ] **Step 2: `e2e/inspect.spec.ts` を書く**

`apps/desktop/e2e/inspect.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import type { BoardSession } from '@ojt/board-model';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildInspectRepairCircuit,
  buildReferenceSession,
  toSocketRoles,
  type FaultSite,
  type InspectPartsProblem,
} from '@ojt/content';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { roleTerminalPoint, type CanvasBox } from './projection.js';

/**
 * モードC1/C2 のE2E（§14.2 / §16 Phase 2 受入基準①〜④）。
 * `smoke.spec.ts` と同じ流儀で、ビルド済みの Electron を起こして自動操作する。
 * 期待する読値は Plan 2A の実測表（正常 650.0 / レアショート 422.5 / コイル断線 OL）から引く。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

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

async function canvasBox(page: Page): Promise<CanvasBox> {
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/** 内蔵C1課題から、その `truth` を持つ部品を1つ選ぶ。 */
function partWith(problem: InspectPartsProblem, truth: string): string | undefined {
  return problem.parts.find((p) => p.truth === truth)?.id;
}

/** 通電する（ブレーカ → 電源スイッチ。§5.3.5）。 */
async function powerOn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'ブレーカ' }).click();
  await page.getByRole('button', { name: '電源スイッチ' }).click();
  await expect(page.getByTestId('status-overlay')).toContainText('通電中');
}

/**
 * `dialog.showSaveDialog` / `showOpenDialog` を固定パスへ差し替える（§16 Phase 2 受入基準⑤）。
 * 手動保存・読込は実物のOSダイアログを開くので、E2Eでは自動化できない。同じファイルパスを
 * 常に返すよう Electron 側を書き換え、ダイアログを介さず保存・読込のIPC往復だけを確かめる。
 */
async function stubFileDialogs(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (() =>
      Promise.resolve({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (() =>
      Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, filePath);
}

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];

// 2本目のテストが1本目の結果画面（「もう一度」）から続けるので、同じ worker で順番に走らせる（I-7）
test.describe.serial('モードC1 部品点検（§16 Phase 2 受入基準①②④）', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      window.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1500);
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('不良リレーの読値が判定表どおりになり、マークシートで正解すると合格する', async () => {
    test.skip(C1 === undefined, '内蔵C1課題がありません');
    if (C1 === undefined) return;

    // ① ホーム → 部品点検 → 課題一覧
    await page.getByTestId('mode-inspect-parts').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await expect(page.getByTestId(`open-${C1.id}`)).toBeVisible();
    await shot(app, '10-c1-problem-list');

    // ② 課題を開く
    await page.getByTestId(`open-${C1.id}`).click();
    await expect(page.getByTestId('check-tray')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);
    await powerOn(page);
    await shot(app, '11-c1-board');

    const box = await canvasBox(page);
    /*
     * 役割割当は課題が決める（§7.1）。アプリの中を覗くのではなく、**同じ関数**（`toSocketRoles`）で
     * テスト側でも組み立てる。これで役割IDの端子（`CHK.13`）を物理端子（`S7.13`）へ直せる（§6.4）。
     */
    const socketRoles = toSocketRoles(C1.board.socketRoles);

    /** チェック用ソケットのコイル端子をΩレンジで測る。 */
    const measureCoil = async (): Promise<string> => {
      await page.getByRole('button', { name: 'Ω', exact: true }).click();
      await page.mouse.click(
        roleTerminalPoint(socketRoles, 'CHK.13', box).x,
        roleTerminalPoint(socketRoles, 'CHK.13', box).y,
      );
      await page.mouse.click(
        roleTerminalPoint(socketRoles, 'CHK.14', box).x,
        roleTerminalPoint(socketRoles, 'CHK.14', box).y,
      );
      await page.waitForTimeout(400);
      return (await page.getByTestId('tester-readout').textContent()) ?? '';
    };

    // ③ 正常品は 650.0 Ω（Plan 2A 実測表）
    const normalId = partWith(C1, 'normal');
    if (normalId !== undefined) {
      await page.getByTestId(`plug-${normalId}`).click();
      await page.waitForTimeout(600);
      expect(await measureCoil()).toContain('650.0');
      await page.getByTestId(`eject-${normalId}`).click();
      await page.waitForTimeout(400);
    }

    // ④ コイル断線は赤PBで吸引せず、コイル抵抗が OL
    const openId = partWith(C1, 'coil-open');
    if (openId !== undefined) {
      await page.getByTestId(`plug-${openId}`).click();
      await page.waitForTimeout(600);
      expect(await measureCoil()).toContain('OL');
      await shot(app, '12-c1-coil-open');
      await page.getByTestId(`eject-${openId}`).click();
      await page.waitForTimeout(400);
    }

    // ⑤ レアショートは正常に吸引するのに 422.5 Ω（§16 Phase 2 受入基準②）
    const shortId = partWith(C1, 'coil-layer-short');
    if (shortId !== undefined) {
      await page.getByTestId(`plug-${shortId}`).click();
      await page.waitForTimeout(600);
      expect(await measureCoil()).toContain('422.5');
      await shot(app, '13-c1-layer-short');
      await page.getByTestId(`eject-${shortId}`).click();
      await page.waitForTimeout(400);
    }

    // ⑥ マークシートに正解を入れて判定 → 合格（§9.1 判定）
    for (const part of C1.parts) {
      await page.getByTestId(`answer-${part.id}-${part.truth}`).click();
    }
    await shot(app, '14-c1-mark-sheet');
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('correct-count')).toContainText(
      `${String(C1.parts.length)} / ${String(C1.parts.length)}`,
    );
    await shot(app, '15-c1-result-pass');
  });

  test('通電中にΩレンジを当てると警告が出て、結果に回数が記録される（受入基準④）', async () => {
    test.skip(C1 === undefined, '内蔵C1課題がありません');
    if (C1 === undefined) return;

    // 結果画面から「もう一度」で開き直す
    await page.getByRole('button', { name: 'もう一度' }).click();
    await expect(page.getByTestId('check-tray')).toBeVisible();
    await page.waitForTimeout(1200);
    await powerOn(page);

    const box = await canvasBox(page);
    const socketRoles = toSocketRoles(C1.board.socketRoles);

    const first = C1.parts[0];
    if (first === undefined) return;
    await page.getByTestId(`plug-${first.id}`).click();
    await page.waitForTimeout(600);

    /*
     * 通電したまま**母線間**（`P.1`–`N.1`）にΩレンジを当てる（§16 Phase 2 受入基準④）。
     * プローブ間に24Vが出るので `measureResistance()` が測定を断り、`ohm-on-live` が1件出る
     * （§5.5 / §5.6 #1）。コイル端子（`CHK.13`–`CHK.14`）は赤PBを離していれば 0.00V で
     * 危険操作にならない（§9.1 測定1）ので、ここでは母線を使う。
     */
    await page.getByRole('button', { name: 'Ω', exact: true }).click();
    await page.mouse.click(
      roleTerminalPoint(socketRoles, 'N.1', box).x,
      roleTerminalPoint(socketRoles, 'N.1', box).y,
    );
    await page.mouse.click(
      roleTerminalPoint(socketRoles, 'P.1', box).x,
      roleTerminalPoint(socketRoles, 'P.1', box).y,
    );
    await page.waitForTimeout(600);

    await expect(page.getByTestId('hazard-banner')).toBeVisible();
    await expect(page.getByTestId('mistake-count')).toContainText('ミス');
    await shot(app, '16-c1-hazard-banner');

    // 判定へ進むと結果画面の危険操作に回数が載る（§5.6 / §8.3）
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    await expect(page.getByTestId('hazard-table')).toContainText('通電中のΩ／導通測定');
    await shot(app, '17-c1-result-hazard');
  });
});

// 2本目のテストが1本目の後に保存・再起動するので、同じ worker で順番に走らせる（I-7）
test.describe.serial('モードC2 回路点検・修復（§16 Phase 2 受入基準③）', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      window.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1500);
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('故障2箇所を指摘し白線で修復すると合格する', async () => {
    test.skip(C2 === undefined, '内蔵C2課題がありません');
    if (C2 === undefined) return;

    /*
     * 「どこが故障か」と「正しい配線は何か」は、アプリと同じライブラリ（Plan 2A）で
     * テストプロセス側でも組み立てて求める。UIを通して読み取るのではなく、**同じ入力から
     * 同じ答えが出る**ことを利用する（内蔵C2 8題は明示 `faults` 配列なので決定論。§5.2）。
     */
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const reference = buildReferenceSession(C2, JIPM_BOARD);
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    const correct: BoardSession = reference.value.session;
    const sites: readonly FaultSite[] = built.value.applied.sites;
    expect(sites).toHaveLength(2);

    await page.getByTestId('mode-inspect-repair').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await page.getByTestId(`open-${C2.id}`).click();
    await expect(page.getByTestId('report-panel')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);
    await shot(app, '20-c2-board');

    const box = await canvasBox(page);
    const socketRoles = built.value.session.socketRoles;

    /** 役割端子IDをクリックする。 */
    const clickTerminal = async (terminal: string): Promise<void> => {
      const point = roleTerminalPoint(socketRoles, terminal, box);
      await page.mouse.click(point.x, point.y);
    };

    // ① 指摘を2件登録する（§9.2）。対象は3Dではなく指摘パネル経由で確実に押す
    await page.getByTestId('tool-report').click();
    for (const site of sites) {
      if (site.kind === 'wire-missing') {
        const terminal = site.terminals[0];
        if (terminal === undefined) continue;
        await clickTerminal(String(terminal));
        await page.getByTestId('report-kind-wire-missing').click();
        continue;
      }
      if (site.wireId !== undefined) {
        // 電線は3Dの経路上をクリックする。端点の中間あたりが確実に当たる
        const wire = built.value.session.wires.find((w) => w.id === site.wireId);
        if (wire === undefined) continue;
        const from = roleTerminalPoint(socketRoles, String(wire.from), box);
        const to = roleTerminalPoint(socketRoles, String(wire.to), box);
        await page.mouse.click((from.x + to.x) / 2, (from.y + to.y) / 2);
        const kind = site.kind === 'wire-misrouted' ? 'wire-misrouted' : 'wire-open';
        await page.getByTestId(`report-kind-${kind}`).click();
        continue;
      }
      if (site.partId !== undefined) {
        await page.getByTestId(`replace-${site.partId}`).click();
      }
    }
    await expect(page.getByTestId('report-count')).toHaveText('2');
    await shot(app, '21-c2-reports');

    // ② 白線で修復する（§9.2）。故障した電線を外し、正しい両端へ白線を張り直す
    for (const site of sites) {
      const original = correct.wires.find((w) => w.id === site.wireId);
      if (original === undefined) continue;
      if (site.kind !== 'wire-missing') {
        // 削除モードで該当の電線を選んで Delete
        await page.getByRole('button', { name: '削除モード' }).click();
        const faulted = built.value.session.wires.find((w) => w.id === site.wireId);
        if (faulted !== undefined) {
          const from = roleTerminalPoint(socketRoles, String(faulted.from), box);
          const to = roleTerminalPoint(socketRoles, String(faulted.to), box);
          await page.mouse.click((from.x + to.x) / 2, (from.y + to.y) / 2);
          await page.keyboard.press('Delete');
        }
      }
      // 白線を張る（パレットは白だけ。§8.1）
      await page.getByRole('button', { name: '白', exact: true }).click();
      await clickTerminal(String(original.from));
      await clickTerminal(String(original.to));
    }
    await shot(app, '22-c2-repaired');

    // ③ 判定 → 合格（§16 Phase 2 受入基準③）
    await page.getByTestId('judge-button').click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('missed-list')).toContainText('なし');
    await expect(page.getByTestId('extra-list')).toContainText('なし');
    await expect(page.getByTestId('modification-list')).toContainText('改造はありません');
    await shot(app, '23-c2-result-pass');
  });

  test('白線を張って保存し、閉じて開き直して読込むと本数が復元される（§16 Phase 2 受入基準⑤）', async () => {
    test.skip(C2 === undefined, '内蔵C2課題がありません');
    if (C2 === undefined) return;
    const workFilePath = join(APP_ROOT, 'e2e-tmp', 'c2-worksave.json');
    mkdirSync(dirname(workFilePath), { recursive: true });

    // ① C2を開き、白線を1本張って盤の電線を1本増やす（§9.2）
    await page.getByTestId('mode-inspect-repair').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await page.getByTestId(`open-${C2.id}`).click();
    await expect(page.getByTestId('report-panel')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), {
        timeout: 30_000,
      })
      .toBe(1);
    await page.waitForTimeout(1500);

    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const socketRoles = built.value.session.socketRoles;
    const box = await canvasBox(page);
    const before = built.value.session.wires.length;

    await page.getByRole('button', { name: '白', exact: true }).click();
    await page.mouse.click(
      roleTerminalPoint(socketRoles, 'CR1.13', box).x,
      roleTerminalPoint(socketRoles, 'CR1.13', box).y,
    );
    await page.mouse.click(
      roleTerminalPoint(socketRoles, 'CR1.9', box).x,
      roleTerminalPoint(socketRoles, 'CR1.9', box).y,
    );
    await expect(page.getByTestId('status-overlay')).toContainText(`${before + 1} 本`);

    // ② 保存する（ダイアログは固定パスへスタブする）
    await stubFileDialogs(app, workFilePath);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByTestId('toast')).toContainText('保存しました');

    // ③ 閉じて開き直す（作業ファイルはプロセスを跨いで残る）
    await app.close();
    app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      window.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1500);
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }

    // ④ C2を（故障入りの初期状態で）開き直してから、保存した作業ファイルを読み込む
    await page.getByTestId('mode-inspect-repair').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await page.getByTestId(`open-${C2.id}`).click();
    await expect(page.getByTestId('report-panel')).toBeVisible();
    await page.waitForTimeout(1000);
    await stubFileDialogs(app, workFilePath);
    await page.getByRole('button', { name: '読込' }).click();
    await expect(page.getByTestId('status-overlay')).toContainText(`${before + 1} 本`);
  });
});
```

- [ ] **Step 3: ビルドして E2E を流す**

```powershell
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop e2e
```

Expected: `smoke.spec.ts` 1本・`polish.spec.ts` の既存本数・`inspect.spec.ts` 4本（C1の2本＋C2の2本）がすべて `passed`。`apps/desktop/screenshots/` に `10-c1-problem-list.png` 〜 `23-c2-result-pass.png` の12枚が増える。

- [ ] **Step 4: 全体を検証する**

```powershell
pnpm -r test
pnpm -r typecheck
pnpm lint
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"
```

Expected: `pnpm -r test` は5プロジェクトすべて通る。`typecheck` と `lint` は無出力。`prettier` は `All matched files use Prettier code style!`。

- [ ] **Step 5: コミットする**

```powershell
git add apps/desktop/e2e/inspect.spec.ts apps/desktop/e2e/projection.ts
git commit -m @'
test(desktop): add e2e for mode C1 readings and mode C2 repair

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## タスクと仕様節の対応

| タスク | 主に実装する仕様節 |
|---|---|
| Task 1 | §7.1・§7.8（課題一覧の行）、§12.1（モード） |
| Task 2 | §9.3（プローブの配置順）、§12.2（`resolvePick` の純粋関数化） |
| Task 3 | §9.3（tick ごとの更新・針の追従）、§5.6 #2（`range-exceeded`）、§4.3（Worker プロトコル） |
| Task 4 | §12.1（画面状態）、§9.1・§9.2（モード別の初期状態）、§8.4 / §9.2（回路図の出し方） |
| Task 5 | §9.3（つまみ・レンジ・プローブ・0Ω調整・表示器）、§15（文言の集約） |
| Task 6 | §9.3（アナログの目盛と針） |
| Task 7 | §9.3（プローブの可視化）、§5.6（警告バナーとミス回数）、§15（導通ブザー）、§9.2（連動ハイライトの3D側） |
| Task 8 | §9.1（チェック用回路・切り分け手順）、§5.4（故障の注入）、§16 受入基準①②④ |
| Task 9 | §9.1（トレイ・マークシート・判定表ヘルプ）、§17.2 #5 |
| Task 10 | §9.1（セッション画面）、§12.1（画面の振り分け）、§8.2（キーボード） |
| Task 11 | §9.1 判定、§8.3（結果画面） |
| Task 12 | §9.2（故障入りの盤・判定）、§5.4、§8.3（判定中の一時停止） |
| Task 13 | §9.2（指摘・修復・部品交換の右パネル） |
| Task 14 | §9.2（セッション画面）、§8.1（線色パレット） |
| Task 15 | §9.2 連動ハイライト、§11.4 |
| Task 16 | §9.2 判定①〜⑤ |
| Task 17 | §12.1（モード選択と一覧）、§12.3（作業ファイル）、§13 #8 |
| Task 18 | §14.2（E2E）、§16 Phase 2 受入基準①〜④ |

---

## 仕様との対応表（完了判定に使う）

| 仕様 | 要件 | 実装 | 検証 |
|---|---|---|---|
| §4.3 | IPCチャネルは6本のまま | `IPC_CHANNELS` を変えない（`WorkFile` に項目を足すだけ） | `test/work-files.test.ts` / `test/settings.test.ts`（既存）/ Task 17 |
| §4.3 | renderer ⇄ Worker のプロトコル | `SimCommand` に `tester` / `judgeParts` / `judgeRepair`、`load` に `partFaults` | `test/sim-worker-tester.test.ts` / `test/sim-worker-inspect.test.ts` / `test/sim-worker-repair.test.ts` |
| §5.4 | 故障の適用（部品の故障は変換のたびに注入） | Worker の `load()` が `injectPartFaults()` を通す | `test/sim-worker-inspect.test.ts` |
| §5.5 | テスター測定API（DCV/ACV/Ω/導通・`OL`） | `stepTester()` の読値を `snapshot.tester` に載せる | `test/sim-worker-tester.test.ts` |
| §5.6 #1 | `ohm-on-live`（通電中のΩ／導通） | `readTester()` の `live` → 表示 `----` ＋ 警告バナー | `test/sim-worker-inspect.test.ts` / `test/warning-banner.test.tsx` / E2E |
| §5.6 #2 | `range-exceeded`（アナログの振り切れ） | `stepTester()` が発行 → `hazardDelta` → バナー | `test/sim-worker-tester.test.ts` |
| §5.6 | 危険操作は回数記録のみで合否に影響しない | 警告バナーのミス回数と結果画面の `HazardList`。`passed` の式には入れない | `test/warning-banner.test.tsx` / `test/inspect-parts-result.test.tsx` |
| §7.8 | 課題一覧（内蔵＋利用者・読込エラー） | `content-loader.ts` が `BUILTIN_ALL_PROBLEMS` を使う | `test/content-loader.test.ts` |
| §8.1 | 線色パレット（C2は白のみ） | `session.allowedColors = ['白']`（Plan 2A）＋ `Toolbar` | `test/inspect-repair-screen.test.tsx` |
| §8.2 | キーボード操作（Esc / Delete / 1・2・3 ＋ テスター） | `testerShortcut()` と各画面の `keydown` | `test/inspect-parts-screen.test.tsx` |
| §8.3 | 判定中は追従ループを止める | `judgeRepair` の `stopLoop()` / `resumeLoop()` | `test/sim-worker-repair.test.ts` |
| §8.4 | 回路図ヒントは級で決まる（モードB） | `schematicPolicy()`（Plan 1D2 のまま） | `test/session.test.tsx`（既存） |
| §9.1 | チェック用ソケットの点検手順 | `checkLoadFor()` ＋ `CheckTrayPanel` ＋ `probeTargets()` | `test/inspect-parts-session.test.ts` / `test/inspect-parts-screen.test.tsx` |
| §9.1 | 判定表どおりの読値（650.0 / OL / 422.5） | Worker の `stepTester()` ＋ Plan 2A の故障 | `test/sim-worker-inspect.test.ts` / E2E |
| §9.1 | マークシート（部品 × 7択の排他選択） | `MarkSheetPanel`（radio） | `test/mark-sheet.test.tsx` |
| §9.1 | 判定は「n/m 正解」 | `InspectPartsResult` の `correctCountText()` | `test/inspect-parts-result.test.tsx` |
| §9.1 | ヘルプに判定表を出す | `DiagnosisHelp`（`DIAGNOSIS_TABLE` 7行＋しきい値 552.5Ω） | `test/mark-sheet.test.tsx` |
| §9.2 | 青線の盤に故障が入った状態で開始 | `openProblem()` が `buildInspectRepairCircuit()` を呼ぶ | `test/store-inspect.test.ts` |
| §9.2 | 2級は回路図＋タイムチャート、1級はタイムチャートのみ | `problem.hints.schematicVisible` | `test/store-inspect.test.ts` |
| §9.2 | 指摘（電線・端子・部品 → 種別） | `reportPickToAction()` ＋ `ReportPanel` | `test/inspect-repair-session.test.ts` / `test/report-panel.test.tsx` |
| §9.2 | 修復は白線のみ・改造は判定時に計上 | `RepairPanel`（事実だけ出す）＋ `judgeInspectRepair()` | `test/report-panel.test.tsx` / `test/inspect-repair-result.test.tsx` |
| §9.2 | 部品交換 | `replacePart()` ＋ `unplug`/`plug` | `test/inspect-repair-screen.test.tsx` |
| §9.2 | 合格条件（過不足0・動作一致・白線・改造0） | `judgeInspectRepair()` の `passed` をそのまま出す | `test/sim-worker-repair.test.ts` / E2E |
| §9.2 | 回路図の連動ハイライト（双方向） | `buildHighlightIndex()` ＋ `SchematicSvg` ＋ `ProbeMarkers` | `test/highlight-link.test.tsx` |
| §9.3 | デジタル／アナログの切替・レンジ・表示 | `TesterPanel` ＋ `AnalogMeter` | `test/tester-panel.test.tsx` / `test/analog-meter.test.tsx` |
| §9.3 | プローブは黒 → 赤 の順 | `testerPickToAction()` / `nextProbeAfter()` | `test/tester-ui.test.ts` |
| §9.3 | 0Ω調整（未実施は +5%、レンジ変更でやり直し） | `applyTesterAction()`（Plan 2A）＋ パネルの表示 | `test/tester-panel.test.tsx` |
| §9.3 | 読値は tick ごと、針は時定数100ms | Worker が毎tick `stepTester()` | `test/sim-worker-tester.test.ts` |
| §11.4 | 回路図要素 ⇄ 盤の対応 | `Shape.cellId` → `HighlightIndex` → 端子・電線 | `test/highlight-link.test.tsx` |
| §12.1 | ホームから3モードを開ける | `Home` のモードカード＋ `listMode` | `test/problem-list.test.tsx` |
| §12.1 | 画面遷移（ホーム → 一覧 → セッション → 結果） | `SessionRoute` / `Result` の振り分け | `test/routing.test.ts` / `test/inspect-parts-screen.test.tsx` |
| §12.2 | ピック結果 → 操作は純関数 | `pickToAction` / `testerPickToAction` / `reportPickToAction` | `test/tester-ui.test.ts` / `test/inspect-repair-session.test.ts` |
| §12.3 | 作業ファイルにテスター状態を持つ | `toInspectWorkFile()` / `restoreInspectState()` | `test/work-file-inspect.test.ts` |
| §13 #2 | 課題データの誤りは理由付きで、アプリを落とさない | `openProblem()` の C2 失敗・`checkLoadFor()` の `ok:false` | `test/inspect-parts-session.test.ts` |
| §13 #5 | 例外バナーから立て直せる | 既存の `ErrorBoundary` / `restartSession()` をそのまま使う | `test/app.test.tsx`（既存） |
| §13 #8 | 未知の作業ファイルは読まない／壊れた項目は使わない | `parseWorkFile()` ＋ `restoreInspectState()` の `false` | `test/work-file-inspect.test.ts` |
| §14.2 | E2E で受入基準を確認 | `e2e/inspect.spec.ts` 3本 | Task 18 |
| §15 | 全文言を `ja.ts` に集約 | `JA.tester` / `JA.inspectParts` / `JA.inspectRepair` / `JA.reportKind` | `pnpm lint` ＋ 目視 |
| §15 | 効果音は WebAudio の合成音のみ（導通ブザー） | `soundsForSnapshot()` の `tester.conductive` | `test/sounds.test.ts` |
| §15 | 内蔵GPUで60fps（`frameloop="demand"`） | `visualSignature()` にプローブとハイライトだけを足す（読値の小数は入れない） | `test/probe-markers.test.ts` |
| §16 Phase 2 ① | C1で判定表どおりの読値 | `e2e/inspect.spec.ts` | Task 18 |
| §16 Phase 2 ② | コイル断線＝`OL`／レアショート＝約420Ωで正解になる | 同上 | Task 18 |
| §16 Phase 2 ③ | C2で故障2箇所を指摘し白線で修復すると合格 | 同上 | Task 18 |
| §16 Phase 2 ④ | 通電中のΩで警告＋結果に回数 | 同上 | Task 18 |
| §16 Phase 2 ⑤ | 作業の保存・再起動後の復元 | Plan 1D2 で実装済み。本プランは C1/C2 の項目を足す | `test/work-file-inspect.test.ts` / `e2e/inspect.spec.ts`（C2・白線1本・保存→再起動→読込） |
| §17.2 #3 | 定量減点は実装しない | 危険操作・所要時間は参考表示 | `test/inspect-parts-result.test.tsx` |
| §17.2 #5 | マークシートは排他選択 | radio（同じ `name`） | `test/mark-sheet.test.tsx` |

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本プランの実装 | 理由 |
|---|---|---|---|
| 1 | 依頼の Worker コマンド案は `tester:set-mode` / `set-range` / `set-probe` / `zero` の4本 | **1本**（`{ type: 'tester'; action: TesterAction }`）にした | 中身は Plan 2A の `TesterAction`（6種）そのままで、renderer も Worker も同じ `applyTesterAction()` に通す。コマンドを種別ごとに分けると、片方だけ実装し忘れたときにつまみの位置と測定状態が静かにずれる |
| 2 | §9.3 テスターUIは「右パネルのテスター部」 | パネル本体に加えて、読値だけを `TesterReadout` という別コンポーネントに切り出した | `snapshot.tester` は毎秒約30回変わる。パネル全体で購読するとつまみもレンジも毎秒30回描き直され、`frameloop="demand"` の3Dも巻き添えになる（§15）。`LivePanel` / `SoundEffects` と同じ方針 |
| 3 | §9.3「配置済みプローブはドラッグで付け替える」 | **クリックで外す → クリックで置く**に置き換えた | 3Dビューポートでのドラッグは `OrbitControls` の回転と取り合いになる。当たり判定4mmの端子を掴んだまま別の端子へ運ぶ操作は、ソフトウェアラスタライザの環境では実用にならない。付け替えの回数（2クリック）は変わらない |
| 4 | §9.3 の針の可動範囲に具体値の記載が無い | 目盛板では「真上を中心に左右45度ずつの扇」に写した | Plan 2A が `NEEDLE_FULL_SCALE_DEG = 90` を前提として置いた（2A 差分 #10）。本プランは**その値の見せ方**だけを決めており、実測値が判明したら `needleTip()` の写像だけを差し替えれば済む |
| 5 | 依頼「wrong reports にミス回数を数える」 | 指摘の正誤は**セッション中には出さず**、結果画面で `extra`（過剰指摘）として出す。セッション中のミス回数は**危険操作の回数**（§5.6）だけを数える | §9.2 が「削除の可否をその場で判定すると答えが漏れるため警告は出さず、判定時に計上する」と定めている。指摘の正誤も同じで、その場で「違います」と出したら残りの故障を総当たりで探せてしまう。重複した指摘だけは操作ミスなので登録時に断る（合否に響かせない） |
| 6 | §9.2 連動ハイライト | 回路図側は濃い橙（`#C2410C`）、3D側は琥珀（`#FFE066`）と**別の色**にした | 回路図は白地（`#F7F7F4`）で琥珀は読めず、3Dは暗い盤面（`#141820`）で濃い橙は沈む。同じ「光っている」ことが伝わればよく、色そのものを揃える必要はない |
| 7 | §13 #8 の `formatVersion` | C1/C2 の項目を足しても **1 のまま**にし、すべて任意にした | 上げると Phase 1 に保存した作業ファイルが「新しいバージョンで作成されています」で読めなくなる。§13 の「作業保持の原則」に反する。読み手は欠けていたら課題を最初から開く |
| 8 | §9.1「部品を外して次へ」 | 部品の挿抜は差分（`plug`/`unplug`）ではなく**`load` を送り直す** | 部品の故障はネットリスト変換のたびに注入し直す必要がある（§5.4）。差分で当てると「`mountPart()` が作った良品に、あとから故障を入れ直す」経路が要り、故障とネットリストの対応が2箇所に散る。C1は1個ずつ点検する手順そのものなので、盤も時計もやり直すのが自然 |
| 9 | §9.2 部品交換 | 交換は `unplug` → `plug` を Worker へ送り、renderer 側で `replacePart()` する | Worker の `plug` は `mountPart()` で**新しい部品インスタンス**を作るので、それ自体が「良品に差し替える」ことになる。判定側の `partFaults` からその部品を落とすのが `replacePart()` の役目で、`sites` は残る（交換しても指摘しなければ合格しない。Plan 2A 差分 #7） |
| 10 | §12.1 の画面遷移図は「セッション画面」1つ | モードごとに3つの画面（`Session` / `InspectPartsSession` / `InspectRepairSession`）に分け、`SessionRoute` が振り分ける | 3Dクリックの意味（配線／プローブ／指摘）も右パネルの中身も違う。1つの画面に条件分岐を積むと、モードBの回帰を起こさずにC1/C2を直すことが難しくなる。共通部分（ツールバー・電源・ログ・経過時間・3D・テスター）はコンポーネントとして共有している |
| 11 | §9.1 は測定端子を文章で示す | プローブの置き場所ショートカット（コイル＋4組ぶんの a/b 接点＝9個）をパネルに出した | 端子の当たり判定は4mmで、正面視では数ピクセルしかない。§9.1 は「ON/OFFで何度も測る」手順を求めるので、毎回8本の端子を狙わせると手順の練習にならない。**4組すべて**出すので不良の組は漏れない（Plan 2A 差分 #14） |
| 12 | §9.3 のレンジはデジタルにも一覧がある（オートレンジ） | デジタルではレンジ欄を出さず「オートレンジ」とだけ表示する | §9.3 が「デジタル … **オートレンジ**」と定めているので、選べるつまみを描くと実機と食い違う |
| 13 | §5.6 の危険操作表示は Phase 1 になし | Phase 1 の警告経路（トースト・`LogPanel` の危険操作一覧・トリップLED）はそのまま残し、`WarningBanner`（画面上部の帯）を**その上に追加**する。置き換えではない | トーストは4秒で消えて気づかないまま回数だけ増える（§13 #4 の指摘と同じ理屈）。ログとLEDは「何が起きたか」の記録として引き続き要る。帯は「いま気づく」ための追加チャネルであり、既存の経路を壊さない |

---

## 実装者への MERGE 注意

複数のタスクが同じファイルへ別々の箇所から手を入れる。下記「推奨バッチ」で複数を並行して走らせるときは、次の9点を守ること（レビューで指摘された衝突しやすい箇所）。

1. **`BoardScene.tsx` は Task 7 Step 5 の4箇所の編集だけ**（import の追加・`visualSignature()` への3行・`BoardContents()` の4つの購読・`routes.map` ブロックの置き換え）。他のタスクがこのファイルへさらに手を入れる場合も、この4箇所の外側だけに追記する。
2. **`Session.tsx` は Task 4 Step 9（モードB絞り込みの2箇所）＋ Task 7 Step 8a（`<WarningBanner />` の1行）だけ**。この5箇所以外は Phase 1 のまま変えない。
3. **`Toolbar.tsx` は Task 10 Step 5 の1ブロックだけ**（`showWireTools?` / `extraTools?` の追加と、線色グループの `showWireTools` 条件化）。Task 14 は `Toolbar` の**呼び出し側**（props の渡し方）しか変えないので、`Toolbar.tsx` 自体を二重に編集しない。
4. **`App.tsx` の `setInterval` は2つ**（Task 7 Step 8 のトースト掃除＋危険操作バナーの間引き、Task 17 Step 5 の自動保存を `toInspectWorkFile()` に差し替え）。別々の `useEffect` を新たに増やさず、既存の2つのタイマーの中身を書き換える形にする。
5. **`sim.worker.ts` の `load()` は Task 3 と Task 8 の2回に分けて触られる。重複させない。** Task 3 Step 4 でプローブ解除（`applyTesterAction` の2回呼び出し）を末尾に足し、Task 8 Step 5 は `load()` の**宣言そのもの**（引数に `partFaults` を足す）を置き換える形で示してある。Task 8 を適用するときは、Task 3 で足した末尾の3行を消さずに新しい `load()` の中へ持っていくこと。
6. **`store.ts` の `EMPTY_SNAPSHOT` は `SimSnapshot` の変更（`tester` フィールド追加）と同じコミットに入れる**（Task 3 Step 5）。片方だけ先に入ると `EMPTY_SNAPSHOT` が `SimSnapshot` を満たさず型検査が落ちる。
7. **`ja.ts` への挿入は、挿入のたびにファイルを読み直してから行う。** 複数のタスク（5・7・9・11・13・17 など）がそれぞれ別の挿入位置を「〇〇の直後」で指定しており、先のタスクの挿入で行番号がずれるため、古い内容を前提に次を挿し込むと挿入先を見失うか、片方の追記が失われる。
8. **Task 1 と Task 4 は同じバッチで直列に実行する。** Task 4 Step 10 が Task 1 Step 6a で入れた暫定ガード（モードB以外を弾く分岐）を外す前提になっており、Task 1 だけ済んで Task 4 が別バッチに回ると C1/C2 が一時的に開けないまま放置される。
9. **`e2e/projection.ts` の import は置き換えでなく追記する（I-6）。** 既存の `import type { TerminalId } from '@ojt/circuit-sim';` を消さないこと。

## 推奨バッチ

タスクの依存関係（ストア → 3画面の土台 → 各モードの右パネル → 結果画面 → 一覧・作業ファイル → E2E）に沿って6つのバッチに分ける。同じバッチ内で複数タスクを並行させる場合は上記「MERGE 注意」を必ず確認する。

| バッチ | タスク | 実行順 | モデル |
|---|---|---|---|
| 1 | Task 1 → Task 2 → Task 3 → Task 4 | 直列（Task 1・4 は同じバッチで。MERGE 注意 #8） | Opus |
| 2 | Task 5＋6（直列）／ Task 9 ／ Task 13 ／ Task 7 | 3系統（5+6・9・13）を並列、Task 7 も同時並行 | Sonnet（Task 7 のみ Opus） |
| 3 | Task 8 → Task 10 → Task 11 | 直列 | Opus |
| 4 | Task 12 → Task 14 → Task 15 → Task 16 | 直列 | Opus |
| 5 | Task 17 | 単独 | Sonnet |
| 6 | Task 18 | 単独（バッチ1〜5がすべて完了してから） | Opus |

バッチ1の完了後にバッチ2〜4を並行して始められる（Task 4 がストアと3モードの土台を作り終えているため）。バッチ2はテスターパネル（5・6）と3D・警告バナー（7）、C1/C2の右パネル（9・13）が互いに独立なので同時に走らせられる。バッチ5（Task 17）はホーム・一覧・作業ファイルを触るので、バッチ2〜4が触った画面が揃ってから始める。バッチ6（Task 18 の E2E）は全バッチの完了後、ビルドしたアプリの上で行う。

---

## 完了条件

- [ ] `pnpm --filter @ojt/desktop test --no-file-parallelism` が全て通る（Phase 1 の17ファイル ＋ 本プランで足した14ファイル）。
- [ ] `pnpm -r test` で5プロジェクト（`circuit-sim` / `board-model` / `schematic-core` / `content` / `desktop`）がすべて通る。
- [ ] `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` ＋ `react-hooks` 込み）が無警告で通る。
- [ ] `npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"` が `All matched files use Prettier code style!` を出す。
- [ ] `pnpm --filter @ojt/desktop build` が main / preload / renderer の3つを出力する。
- [ ] `pnpm --filter @ojt/desktop e2e` が `smoke.spec.ts` ＋ `polish.spec.ts` ＋ `inspect.spec.ts`（3本）すべて通る。
- [ ] **§16 Phase 2 受入基準①**: C1課題を開いてチェック用ソケットに不良リレーを挿し、赤PBで励磁してテスターで測ると、正常品 `650.0 Ω` / コイル断線 `OL` / レアショート `422.5 Ω` と読める（`e2e/inspect.spec.ts`）。
- [ ] **§16 Phase 2 受入基準②**: コイル断線のリレーは赤PBで吸引せずコイル抵抗が `OL`、レアショートのリレーは正常に吸引するのに約420Ω。マークシートでそれぞれ「コイル断線」「レアショート」を選ぶと正解になり、全問正解で `合格` が出る。
- [ ] **§16 Phase 2 受入基準③**: C2課題で故障2箇所を指摘し、白線で修復すると `合格` が出て、見逃し・過剰指摘・改造がいずれも「なし」になる。
- [ ] **§16 Phase 2 受入基準④**: 電源ONのまま（赤PBを押したまま）Ωレンジを当てると画面上部に警告バナーとミス回数が出て、結果画面の危険操作に「通電中のΩ／導通測定」の回数が載る。
- [ ] ホームから3モード（回路組立／部品点検／回路点検・修復）を開ける。PLC は「準備中」で押せないまま。
- [ ] 課題一覧に内蔵20題（モードB 8題・C1 4セット・C2 8題）が出て、モードで絞り込める。
- [ ] 3D盤に黒／赤のプローブが載り、テスターのつまみ・レンジ・0Ω調整・針が §9.3 のとおり動く。
- [ ] C2の2級課題で、回路図の要素をクリックすると3D盤の対応端子と電線が光り、3Dの端子にホバーすると回路図の対応要素が光る。
- [ ] 作業ファイルにテスター状態・マークシートの解答・指摘・故障が載り、読み込むと同じ状態から続けられる。Phase 1 に保存した作業ファイル（追加項目が無いもの）も読める。
- [ ] `apps/desktop/screenshots/` に C1/C2 のスクリーンショット12枚（`10-` 〜 `23-`）が出ている。
- [ ] `apps/desktop/package.json` の依存が Phase 1 から増えていない。
- [ ] IPCチャネルは6本のまま（`IPC_CHANNELS` が変わっていない）。
- [ ] 画面の文言がすべて `src/renderer/i18n/ja.ts`（と `src/shared/messages.ts`）にある。

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-14 | 初版。Plan 2（Phase 2）のうち `apps/desktop`（2B）を扱う。テスターの操作モデルを「ツールモード `tester` ＋ 黒→赤の順送り（明示選択つき）」に決定。Worker のテスターコマンドは `TesterAction` を運ぶ1本に統一。C1の部品挿抜は `load` の送り直し、C2の部品交換は `unplug`＋`plug`＋`replacePart()`。期待読値（正常 650.0 / レアショート 422.5 / コイル断線 OL / しきい値 552.5）はすべて Plan 2A の実測表から引いており、本プランでは新しい数値を作っていない |
| 2026-09-14 | レビュー反映: B1〜B7、I1〜I16、M1〜M13、MERGE 注意、推奨バッチ。主な内容: `isInspectJudge` を `mode !== 'assemble'` 判別に修正（Plan 2A I-3 で3モードとも `mode` を持つようになったため）。C2の作業ファイルを `applied`/`cells`/`initialWireIds` の保存から `faultSeed`＋`resolvedFaults`（Plan 2A I-4 の `buildInspectRepairCircuit({ resolvedFaults })`）へ作り直し、復元時に再抽選しないようにした。C2に元に戻す／やり直し（白線・部品交換）を追加。C1/C2 のリストテストを3モードのモックで書き直し、内蔵20題の確認は `content-loader.test.ts` 側に寄せた。Worker のテスター実測を間引く設計を追加（つまみOFF・プローブ未配置ではスキップ、それ以外は33msごとかプローブ変更時だけ実測。前提D）。モードBにも警告バナーを追加。`sharedMaterial()` のキャッシュ鍵に `opacity`/`transparent` を追加。回路図の連動ハイライトの TDZ バグとホバーの間引きを修正。作業ファイルの保存→再起動→読込の E2E を追加。前提Cの「通電中のΩ測定」表示を `OL` から `----` に訂正し、`physicalOverride` / `FaultSpecData` の型を2A実装に合わせた |
| 2026-09-18 | Batch 1 レビュー反映: 非モードB課題の戻り導線と Worker 起動抑止、テスター kind/mode の鮮度、0Ω調整の保持、再挑戦時の故障維持、テスト追加 |

