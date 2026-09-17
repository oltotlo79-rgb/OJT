# Plan 3B: GX Works3風ラダーエディタ・PLCの3D・モードD画面（apps/desktop のみ）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3（モードD＝PLC課題）の **`apps/desktop` 側**を完成させる。すなわち GX Works3風スキンのラダーエディタ（F5/F6/F7/F9 のセル入力、`F4` 変換、`F3` モニタ、出力ウィンドウ、デバイスコメント欄、I/Oテーブル）、机上のPLC本体 FX5U ＋ 壁コンセント ＋ 机上配線の3D、モードDのセッション画面（ラダー ⇄ 3D盤の分割表示）、Worker のモードD連携（1 tick ＝ 1 スキャン、判定は Worker 内）、モードDの結果画面（`twoStage` / `plcPowerIndependent` / `ioAssignment` の3チェックを含む）、モードDの作業ファイル、ホーム・課題一覧・設定画面のモードD対応、そして §16 Phase 3 受入基準①〜⑤の E2E である。ライブラリ側（`@ojt/ladder-core` / `@ojt/plc-dialects` / `@ojt/circuit-sim` のPLC部品 / `@ojt/board-model` の FX5U / `@ojt/content` のモードD課題・判定）は **Plan 3A** が作る。本プランは 3A の公開APIだけを使い、`packages/` には一切手を入れない。

**Architecture:** 画面を3層に切る。①**純粋層**（`renderer/session/ladder.ts`）＝「キー入力 → 編集操作」「セルカーソル」「取り消し／やり直し」を React も three も知らない純関数にする。編集の実体は `@ojt/ladder-core` の `edit.ts`（`setCell` / `insertRow` / …）で、本プランはその**呼び出し順**しか持たない。②**表示層**（`renderer/ladder/*.tsx`）＝ SVG のセルグリッド、出力ウィンドウ、デバイスコメント欄、I/Oテーブル、プロジェクトツリー。記号の線画は `DialectProfile.symbols` の識別子から自前の `<path>` を引く（**ベンダーの画像は一切持たない**。§17 / PLC調査資料 §6）。③**結合層**（`renderer/screens/PlcSession.tsx` ＋ `worker/sim.worker.ts`）＝ 盤とラダーを1画面に置き、Worker に「盤」と「ラダー」を別々のコマンドで渡す。

**モニタとスキャンの置き場所（依頼の DECIDE に対する回答）:** セッション中のスキャンは **Worker の中だけ**で回る。renderer は `PlcRuntime` を持たない。Worker は `load` で `withPlcUnit()` 済みの盤からネットリストを作り、`loadLadder` で受け取った `LadderProgram` を `compile()` し、`createPlcCoupling()`（Plan 3A Task 15）の `beforeTick` を追従ループの各 tick の先頭で呼ぶ。モニタ表示（`PlcSnapshot.poweredCells`）は **33ms のスナップショット**に相乗りさせ、しかも「モニタ中（`F3`）のときだけ」載せる。判定（`judgePlc`）は Plan 2B の `judgeRepair` と同じく**追従ループを止めてから** Worker 内で実行する（3A ハンドオフ注記 H-4）。

**Tech Stack:** Electron 44 / electron-vite 5 / React 19.2.8 / three 0.186 / @react-three/fiber 9.7 / @react-three/drei 10.7 / zustand 5 / CSS Modules / Web Worker（`SimCommand` / `SimMessage`、33ms スナップショット）/ Playwright（Electron）/ TypeScript ~6（`strict` ＋ `exactOptionalPropertyTypes` ＋ `noUncheckedIndexedAccess` ＋ `verbatimModuleSyntax`、`.js` 拡張子つき相対 import）/ Vitest ＋ Testing Library / ESLint flat config（`react-hooks` ＋ `import-x/no-cycle`）/ Prettier（printWidth 100）。**新しい依存は1つも増やさない。** 画面の文言はすべて `apps/desktop/src/renderer/i18n/ja.ts`（main プロセス側は `src/shared/messages.ts`）に置く。

---

## 前提（このプランを始める前に満たしていること）

| # | 前提 | 確認方法 |
|---|---|---|
| 1 | Plan 1A〜1D・2A・2B が `main` に入っており、`pnpm -r test` が5プロジェクト（`circuit-sim` / `board-model` / `schematic-core` / `content` / `desktop`）すべて通る。`desktop` のベースラインは 32ファイル / 541テスト、E2E 11本 | `pnpm -r test` / `pnpm --filter @ojt/desktop e2e` |
| 2 | **Plan 3A が `main` に入っている。** 本プランは 3A の公開APIを全面的に使うので、3A 未完了では Task 1 から通らない。とくに `@ojt/content` の `judgePlc` / `createPlcCoupling` / `plcBoardFor` と `UNSUPPORTED_MODES` の削除（3A Task 13）が無いと Task 2 以降が書けない | `pnpm -r test`（7プロジェクト）と下の 前提A〜E |
| 3 | 内蔵課題が28題（モードB 8・C1 4セット・C2 8・**D 8**）になっている | `BUILTIN_ALL_PROBLEMS.length === 28` |
| 4 | `pnpm -r typecheck` / `pnpm lint` が無警告、`npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"` が通る | 同左 |
| 5 | `apps/desktop` の IPCチャネルは6本のまま（`IPC_CHANNELS`）。本プランでも**増やさない**（§4.3） | `src/shared/ipc.ts` |

**着手時にやること:** `git pull --rebase origin main` してから、下の 前提A〜D の署名を**実際のソース**（`packages/*/src/index.ts`）と突き合わせる。食い違ったら **3A 側が正**で、本プランのコードを直す。

### 前提A: `@ojt/ladder-core`（**landed**。`packages/ladder-core/src/` の実装を確認済み）

Plan 3A Task 1 / 1b / 2 / 3 は既に `main` にある（`7fa8fed` / `a58ebb4` / `f261fe4` ＋ `runtime.ts`）。下記は**実際のソースから引いた署名**である。

```ts
// ir.ts
export const IR_COLS = 16;
export const COIL_COL = 15;
export const MAX_ROWS = 12;
export const SPECIAL_ALWAYS_ON = 0;
export const SPECIAL_FIRST_SCAN = 1;
export const SPECIAL_CLOCK_1S = 2;
export const SPECIAL_INDEXES: readonly number[];
export const DEVICE_PREFIX: Readonly<Record<DeviceKind, string>>; // input:'X' output:'Y' internal:'M' timer:'T' counter:'C' special:'SP'
export class LadderError extends Error {}

export type DeviceKind = 'input' | 'output' | 'internal' | 'timer' | 'counter' | 'special';
export interface Device { kind: DeviceKind; index: number }
export type ContactType = 'NO' | 'NC' | 'P' | 'F';
export type CoilType = 'OUT' | 'SET' | 'RST';
export type Cell =
  | { kind: 'contact'; type: ContactType; device: Device }
  | { kind: 'coil'; type: CoilType; device: Device }
  | { kind: 'timer'; type: 'TON'; device: Device; presetMs: number }
  | { kind: 'counter'; type: 'CTU'; device: Device; preset: number; resetDevice: Device }
  | { kind: 'mc'; device: Device }
  | { kind: 'mcr'; device: Device }
  | { kind: 'end' } | { kind: 'hline' } | { kind: 'vline' } | { kind: 'empty' };
export type OutputCell = Extract<Cell, { kind: 'coil' | 'timer' | 'counter' | 'mc' | 'mcr' }>;
export interface Network { id: string; comment?: string; rows: number; cols: number; cells: Cell[][] }
export interface LadderProgram { networks: Network[] }
export interface NetworkOptions { comment?: string }

export function device(kind: DeviceKind, index: number): Device;   // 範囲外は LadderError
export function X(i: number): Device; // Y / M / T / C / SP も同じ形
export function deviceLabel(d: Device): string;                    // 'X0' / 'T1' / 'SP2'（ベンダー中立）
export function deviceKey(d: Device): string;                      // 'input:0'
export function sameDevice(a: Device, b: Device): boolean;
export function no(d): Cell; nc(d); rise(d); fall(d);
export function out(d): Cell; set(d); rst(d);
export function ton(d: Device, presetMs: number): Cell;
export function ctu(d: Device, preset: number, resetDevice: Device): Cell;
export function mc(d): Cell; mcr(d); end(); hline(); vline(); empty();
export function isOutputCell(cell: Cell): cell is OutputCell;
export function network(id: string, rows: readonly (readonly Cell[])[], options?: NetworkOptions): Network;
export function endNetwork(id?: string): Network;                  // 既定 id は 'end'
export function cellAt(net: Network, row: number, col: number): Cell; // 範囲外は LadderError
export function program(...networks: Network[]): LadderProgram;    // ID重複は LadderError

// edit.ts（すべて純粋関数。引数を書き換えず新しい LadderProgram を返す）
export function setCell(p: LadderProgram, networkId: string, row: number, col: number, cell: Cell): LadderProgram;
export function clearCell(p: LadderProgram, networkId: string, row: number, col: number): LadderProgram;
export function setVerticalLink(p: LadderProgram, networkId: string, row: number, col: number, on: boolean): LadderProgram;
export function insertRow(p: LadderProgram, networkId: string, atRow: number): LadderProgram;
export function deleteRow(p: LadderProgram, networkId: string, atRow: number): LadderProgram;
export function insertNetwork(p: LadderProgram, atIndex: number, net: Network): LadderProgram;
export function deleteNetwork(p: LadderProgram, networkId: string): LadderProgram;

// compile.ts
export const TIMER_STEP_MS = 10;
export const MAX_TIMER_PRESET_MS = 3_600_000;
export const MAX_COUNTER_PRESET = 32_767;
export type CompileErrorCode =
  | 'empty-program' | 'grid-shape' | 'missing-end' | 'after-end' | 'coil-column'
  | 'contact-in-coil-column' | 'no-output' | 'dangling-vline' | 'timer-preset'
  | 'counter-preset' | 'mc-unmatched';
export interface CompileError { code: CompileErrorCode; networkId: string; row?: number; col?: number; message: string }
export interface CompileWarning { code: 'double-coil'; networkId: string; row: number; col: number; device: Device; message: string }
export interface CompiledOutput { row: number; col: number; cell: OutputCell }
export interface CompiledNetwork { id: string; rows: number; cols: number; cells: readonly (readonly Cell[])[]; outputs: readonly CompiledOutput[]; isEnd: boolean }
export interface DeviceUsage { reads: readonly Device[]; writes: readonly Device[] }
export interface CompiledProgram { networks: readonly CompiledNetwork[]; endNetworkIndex: number; usage: DeviceUsage; inputCount: number; outputCount: number; source: LadderProgram }
export type CompileResult =
  | { ok: true; program: CompiledProgram; warnings: CompileWarning[] }
  | { ok: false; errors: CompileError[]; warnings: CompileWarning[] };
export function compile(source: LadderProgram): CompileResult;

// runtime.ts
export const SCAN_MS = 10;
export const CLOCK_PERIOD_MS = 1000;
export interface PlcIoPort { readInputs(): readonly boolean[]; writeOutputs(values: readonly boolean[]): void }
export interface PlcTimerState { elapsedMs: number; on: boolean }
export interface PlcCounterState { value: number; on: boolean }
export interface PlcSnapshot {
  scanCount: number; tMs: number; inputs: boolean[]; outputs: boolean[];
  internals: Record<number, boolean>;
  timers: Record<number, PlcTimerState>;
  counters: Record<number, PlcCounterState>;
  /** キーは `${networkId}:${row}:${col}`。値は「そのセルの**左端**が左母線と繋がっているか」。ENDネットワークは入らない */
  poweredCells: Record<string, boolean>;
}
export interface PlcRuntimeOptions { io: PlcIoPort; scanMs?: number; outputCount?: number }
export interface PlcRuntime {
  readonly program: CompiledProgram; readonly tMs: number; readonly scanCount: number;
  scan(): void; reset(): void; bit(device: Device): boolean; state(): PlcSnapshot;
}
export function createPlcRuntime(program: CompiledProgram, options: PlcRuntimeOptions): PlcRuntime;
```

**本プランが使う上での要点（実装を読んで確かめた事実）:**

- `network()` は行を `IR_COLS` まで `empty()` で詰める。`Network.cols` は常に 16。
- `setVerticalLink()` は **空セル・横線・縦線の上にだけ**引ける。接点やコイルの上へ引こうとすると `LadderError` を投げる。最終行の下へも引けない。エディタは**投げさせずに事前に判定する**のではなく、投げられた `LadderError.message` をそのままトーストに出す（文言はライブラリが日本語で持っている）。
- `deleteRow()` は最後の1行を消せない。`deleteNetwork()` は最後のネットワークでも消せる（＝プログラムが空になりうる）。空になると `compile()` が `empty-program` を返すので、変換で気づける。
- `vline()` は**そのセル自身も横線として導通する**（`runtime.ts` の `solve()`）。エディタの描画も「縦線＋横線」で描く。
- `PlcSnapshot.poweredCells` の `col` は **0〜15**（`IR_COLS` ぶん全部）。コイルの通電は `col === COIL_COL` の値。

### 前提B: `@ojt/plc-dialects`（`profile.ts` は landed、`mitsubishi.ts` / `convert.ts` は **Plan 3A Task 9・10 のプラン本文から引用**）

`packages/plc-dialects/src/profile.ts` と `index.ts` は `1966785` で `main` に入っている（下記の型は実ソースから引いた）。`mitsubishi.ts` と `convert.ts` は**まだ無い**ので、下記は Plan 3A Task 9（L5050〜）/ Task 10（L5274〜）の本文からの引用である。着手時に実ソースと突き合わせること。

```ts
// profile.ts（landed）
export type DialectId = 'mitsubishi' | 'jtekt' | 'omron' | 'sharp';
export const DIALECT_IDS: readonly DialectId[];            // 上の4つ
export const IMPLEMENTED_DIALECT_IDS: readonly DialectId[]; // Phase 3 は ['mitsubishi']
export const MIN_GRID_COLS = 8;
export const MAX_GRID_COLS = 15;
export function isDialectId(value: string): value is DialectId;
export interface DeviceRange { radix: 8 | 10 | 16; prefix: string; min: number; max: number }
export interface DialectError { code: string; message: string; device?: Device; networkId?: string; row?: number; col?: number }
export type InstructionKey = 'ld'|'ldi'|'and'|'ani'|'or'|'ori'|'out'|'set'|'rst'|'pulseUp'|'pulseDown'|'timer'|'counter';
export interface ShortcutEntry { action: string; keys: string; label: string; confirmed: boolean; enabled?: boolean; note?: string }
export type ShortcutTable = readonly ShortcutEntry[];
export interface SymbolDrawing { no: string; nc: string; rise: string; fall: string; coil: string; set: string; rst: string; timer: string; counter: string }
export interface MonitorColors { powered: string; idle: string }
export interface PanelLayout { tree: string; editor: string; output: string; toolbar: readonly string[] }
export interface TimerPresetText { text: string; device: Device }
export interface DialectProfile {
  id: DialectId; displayName: string;
  formatDevice(device: Device): string;
  parseDevice(text: string): Device | Error;     // 投げない
  deviceRanges: Readonly<Record<DeviceKind, DeviceRange>>;
  timerPreset(ms: number, device: Device): TimerPresetText | Error;
  parseTimerPreset(text: string, device: Device): number | Error;
  instructionNames: Readonly<Record<InstructionKey, string>>;
  specialDevices: Readonly<Record<number, string>>;
  symbols: SymbolDrawing;
  gridCols: number;          // 三菱は 11（接点列数。コイル列を含まない）
  shortcuts: ShortcutTable;
  convertStep: boolean;      // 三菱は true
  monitorColors: MonitorColors;
  panels: PanelLayout;
  validate(program: LadderProgram): DialectError[];
  errorMessages: Readonly<Record<string, string>>;
}
export class UnknownDialectError extends Error {}

// index.ts（landed）
export function availableDialects(): DialectProfile[];
export function getDialect(id: DialectId): DialectProfile;  // 未実装は UnknownDialectError を投げる

// mitsubishi.ts（Plan 3A Task 9・10。まだ landed していない）
export const MITSUBISHI_FX5U: DialectProfile;   // id 'mitsubishi' / displayName '三菱電機 MELSEC iQ-F FX5U（GX Works3風）'
export function timerBaseMs(timer: Device): number;          // index>=256→1 / >=200→10 / それ以外→100
export function roundTimerPreset(ms: number, baseMs: number): number;

// convert.ts（Plan 3A Task 10。まだ landed していない）
export interface ConvertError { source: 'structure' | 'dialect'; code: string; message: string; networkId?: string; row?: number; col?: number }
export type ConvertResult =
  | { ok: true; program: CompiledProgram; errors: readonly ConvertError[]; warnings: CompileWarning[] }
  | { ok: false; errors: ConvertError[]; warnings: CompileWarning[] };
export function convert(source: LadderProgram, profile: DialectProfile): ConvertResult;
```

**三菱スキンの `SHORTCUTS`（Plan 3A Task 10 Step 3 の定義をそのまま引用。本プランのキー割当表の唯一の情報源）:**

| `action` | `keys` | `label` | `confirmed` | `enabled` | 備考 |
|---|---|---|---|---|---|
| `contact-no` | `F5` | a接点 | ◎ true | — | |
| `contact-nc` | `F6` | b接点 | △ false | — | |
| `or-contact-no` | `Shift+F5` | OR a接点 | △ false | — | |
| `or-contact-nc` | `Shift+F6` | OR b接点 | △ false | — | |
| `coil` | `F7` | コイル | ◎ true | — | |
| `application` | `F8` | 応用命令 | ◎ true | **false** | `note`: 「Phase 3 のIRには応用命令に対応するセル種別がありません（§10.3）。Phase 4 で追加します」 |
| `hline` | `F9` | 横線 | △ false | — | |
| `vline` | `Shift+F9` | 縦線 | △ false | — | |
| `rule-line` | `Ctrl+←↑↓→` | 罫線（縦線・横線の作図） | ◎ true | — | `note` に `setVerticalLink()` / `setCell()` への対応が書いてある |
| `convert` | `F4` | 変換 | △ false | — | |
| `toggle-no-nc` | `/` | a接点・b接点の切換 | ◎ true | — | |
| `toggle-pulse` | `Alt+/` | 微分・SET/RST の切換 | ◎ true | — | |
| `write-mode` | `F2` | 書込みモード | ◎ true | — | |
| `read-mode` | `Shift+F2` | 読出しモード | ◎ true | — | |
| `monitor` | `F3` | モニタ | ◎ true | — | |
| `monitor-write` | `Shift+F3` | モニタ（書込み） | ◎ true | — | |
| `insert-toggle` | `Ins` | 挿入・上書きの切換 | ◎ true | — | |
| `next-symbol` | `Tab` | 次の回路記号 | ◎ true | — | |
| `help` | `F1` | ヘルプ | ◎ true | — | |

`MONITOR_COLORS = { powered: '#1E64FF', idle: '#6B7280' }`、`gridCols = 11`、`convertStep = true`、`PANELS = { tree: 'ナビゲーションウィンドウ（プロジェクトツリー）', editor: 'ラダーエディタ', output: '出力ウィンドウ', toolbar: ['変換','全変換','書込みモード','読出しモード','オンライン','シーケンサへの書込み','モニタ開始','モニタ停止'] }`、`SYMBOLS = { no:'contact-no', nc:'contact-nc', rise:'contact-rise', fall:'contact-fall', coil:'coil-round', set:'coil-set', rst:'coil-reset', timer:'coil-timer', counter:'coil-counter' }`。

### 前提C: `@ojt/circuit-sim` と `@ojt/board-model` のPLC部分（**landed**。実ソースを確認済み）

```ts
// @ojt/circuit-sim（packages/circuit-sim/src/plc.ts ＋ simulation.ts。landed）
export const PLC_INPUT_ON_AMPS = 0.003;
export const PLC_INPUT_OFF_AMPS = 0.0015;
export const PLC_INPUT_OHMS = 4700;
export interface PlcOutputSpec { name: string; com: string }
export interface PlcUnitSpec {
  model: string; power: readonly string[]; inputCommon: string; service?: readonly string[];
  inputs: readonly string[]; commons: readonly string[]; outputs: readonly PlcOutputSpec[];
  inputOhms?: number; onAmps?: number; offAmps?: number;
}
export class PlcUnitError extends Error {}
export function createPlcUnit(id: PartId | string, spec: PlcUnitSpec): Part;
export function plcMetaOf(part: Part): Extract<PartMeta, { kind: 'plc' }> | undefined;
export interface PlcUnitRuntime { inputs: boolean[]; outputs: boolean[]; inputAmps: number[] }
// Simulation:
//   plcInputs(partId: string): boolean[]
//   setPlcOutputs(partId: string, values: readonly boolean[]): void
//   state().plcs: Record<string, PlcUnitRuntime>
// 信号ログ: 'PLC.X0' / 'PLC.Y0'（boolean）と 'PLC.X0.mA'（数値）

// @ojt/board-model（packages/board-model/src/plc-unit.ts ＋ board-jipm.ts ＋ routing.ts。landed）
export const PLC_PART_ID = 'PLC';
export const OUTLET_ID = 'OUTLET';
export function isOffBoardTerminal(id: TerminalId | string): boolean;   // 'PLC.' / 'OUTLET.' 始まり
export interface PlcUnitDefinition {
  id: string; model: string; vendor: string; displayName: string;
  sizeMm: { width: number; height: number; depth: number };
  pos: Vec3; spec: PlcUnitSpec; terminals: readonly BoardTerminal[]; leds: readonly string[];
}
export interface BoardDefinition { /* … */ plcUnit?: PlcUnitDefinition }
export const PLC_TERMINAL_PITCH_MM = 9;
export const PLC_ROW_GAP_MM = 9;
export const PLC_STAGGER_MM = 4.5;
export const PLC_ORIGIN_MM: Vec3;       // vec3(390, 18, 0)
export const OUTLET_ORIGIN_MM: Vec3;    // vec3(395, 190, 0)
export const FX5U_INPUT_OHMS = 4500;
export const FX5U_ON_AMPS = 0.0035;
export const FX5U_OFF_AMPS = 0.0015;
export const FX5U_POINTS_PER_COMMON = 4;
export function octalNames(prefix: string, count: number): string[];   // X0..X7, X10..X17
export const FX5U_SPEC: PlcUnitSpec;
export const PLC_UNIT_FX5U: PlcUnitDefinition;   // sizeMm 150×90×83、leds ['PWR','ERR','P.RUN','BAT','CARD']
export const PLC_UNITS: Readonly<Record<string, PlcUnitDefinition>>;   // { FX5U: PLC_UNIT_FX5U }
export function plcUnitFor(model: string): PlcUnitDefinition | undefined;
export const OUTLET_TERMINALS: readonly BoardTerminal[];   // OUTLET.L / OUTLET.N
export function withPlcUnit(board: BoardDefinition, unit: PlcUnitDefinition): BoardDefinition;
export interface DeskWire { id: string; from: TerminalId; to: TerminalId; fromPos: Vec3; toPos: Vec3 }
export function deskWires(board: BoardDefinition, session: BoardSession): DeskWire[];
// TerminalRole に 'x' | 'y' | 'ss' | 'plc-com' | 'ac-l' | 'ac-n' が増えている
// roleLabel(): 'ss'→'S/S'、'plc-com'→'COM'、'ac-l'→'L'、'ac-n'→'N'
// routeSession() は机上端子に繋がる電線を**含まない**（deskWires() が返す）
// validateBoard() は机上端子を「盤の外」判定から外す
```

**本プランが使う上での要点:**

- `withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U)` の戻りは **`id` が `'board-jipm-std'` のまま**。`BoardSession.boardId` の照合はそのまま通る。
- `PLC_UNIT_FX5U.terminals` は入力側（`L` `PE` `N` `SS` `24V` `0V` `X0`〜`X17`）が `PLC_ORIGIN_MM + (6, 6)` から、出力側（`COM0` `Y0`〜`Y3` `COM1` `Y4`〜…）が `PLC_ORIGIN_MM + (6, 72)` から、いずれも**千鳥2列**（偶数番が奥列、奇数番が手前列、列ピッチ9mm、段間9mm、ずらし4.5mm）で並ぶ。3Dはこの `pos` をそのまま `toScene()` に通す。
- `OUTLET_TERMINALS` は `OUTLET_ORIGIN_MM` と `+9mm` の2点。
- **盤の座標系の外に出る。** `toScene()` は `x - BOARD_WIDTH_MM/2`（330/2 = 165）なので、PLC本体は x ≈ +231〜+381、コンセントは y ≈ −(190 − 110) = −80 の位置に描かれる。既存の視点プリセットでは画角に入らないので、Task 10 で `'plc'` プリセットを足す。

### 前提D: `@ojt/content` のモードD API（**Plan 3A のプラン本文からの引用**。着手時に実ソースで検算する）

```ts
// 課題
export const BUILTIN_PLC_PROBLEMS: readonly PlcProblem[];        // 8題
export const BUILTIN_ALL_PROBLEMS: readonly SupportedProblem[];  // 28題
export function findBuiltinProblem(id: string): SupportedProblem | undefined;
export function isPlcProblem(problem: SupportedProblem): problem is PlcProblem;
export type PlcProblem = /* z.infer<typeof PlcProblemSchema> */;
export const PlcProblemSchema: ZodType;
export type SupportedProblem = AssembleProblem | InspectPartsProblem | InspectRepairProblem | PlcProblem;

// I/O割付
export interface PlcInputMapData { x: number; pb: 'PB1' | 'PB2' | 'PB3' }
export interface PlcOutputMapData { y: number; cr: 'CR1'|'CR2'|'CR3'|'CR4'; pl: 'PL1'|'PL2'|'PL3'|'PL4' }
export const DEFAULT_PLC_IO: { inputs: readonly PlcInputMapData[]; outputs: readonly PlcOutputMapData[] };
export interface ResolvedPlcIo { mode: 'fixed' | 'free'; wiring: 'sink' | 'source'; inputs: readonly PlcInputMapData[]; outputs: readonly PlcOutputMapData[] }
export function resolvePlcIo(io: PlcProblem['io']): ResolvedPlcIo;

// 盤と模範回路
export function plcBoardFor(problem: PlcProblem, board: BoardDefinition): BoardDefinition | undefined;
export interface PlcWireSpec { from: TerminalId; to: TerminalId }
export function plcWiringPlan(io: ResolvedPlcIo, unit: PlcUnitDefinition | undefined): PlcWireSpec[];
export const PLC_WIRE_COLOR: WireColor;   // '青'
export interface PlcReferenceCircuit { session: BoardSession; netlist: Netlist; board: BoardDefinition; unit: PlcUnitDefinition; io: ResolvedPlcIo; program: CompiledProgram }
export type PlcReferenceResult = { ok: true; value: PlcReferenceCircuit } | { ok: false; errors: ProblemIssue[] };
export function buildPlcReferenceSession(problem: PlcProblem, board: BoardDefinition): PlcReferenceResult;

// スキャンと tick の結合
export interface PlcCouplingOptions { partId?: string; outputCount?: number; scanMs?: number }
export interface PlcCoupling { runtime: PlcRuntime; beforeTick: (simulation: Simulation, tMs: number) => void }
export function createPlcCoupling(sim: Simulation, program: CompiledProgram, options?: PlcCouplingOptions): PlcCoupling;
export function createSimulationIoPort(sim: Simulation, partId?: string): PlcIoPort;
export interface PlcRunResult extends RunResult { runtime: PlcRuntime }
export function runPlcOperations(netlist, program, operations, options): PlcRunResult;

// 静的チェック
export interface PlcCheckContext { unit: PlcUnitDefinition; io: ResolvedPlcIo; roles: SocketRoles }
export function checkTwoStage(input: StaticCheckInput): StaticCheckResult;
export function checkPlcPowerIndependent(input: StaticCheckInput): StaticCheckResult;
export function checkIoAssignment(input: StaticCheckInput): StaticCheckResult;
export function detectPlcWiring(nets: Nets, unit: PlcUnitDefinition): 'sink' | 'source' | undefined;
// STATIC_CHECK_IDS は9件になる（既存6 ＋ 'twoStage' / 'plcPowerIndependent' / 'ioAssignment'）

// 判定
export interface JudgePlcResult {
  mode: 'plc'; passed: boolean; mismatches: Mismatch[]; staticChecks: StaticCheckResult[];
  hazardCount: number; hazardsByKind: HazardCounts; chatter: ChatterEvent[]; elapsedMs?: number;
  charts: { expected: TimeChart; actual: TimeChart }; compareSignals: string[];
  ladderErrors: CompileError[]; ladderWarnings: CompileWarning[];
}
export type JudgePlcOutcome = { ok: true; value: JudgePlcResult } | { ok: false; errors: ProblemIssue[] };
export function judgePlc(problem: PlcProblem, board: BoardDefinition, traineeSession: BoardSession, traineeLadder: LadderProgram, options?: { elapsedMs?: number; sessionHazards?: readonly HazardEvent[] }): JudgePlcOutcome;
export function judgePlcReference(problem: PlcProblem, board: BoardDefinition): JudgePlcOutcome;
export function plcTimerMarkers(program: CompiledProgram): TimeChartMarker[];

// 作業ファイル用のラダー
export const MAX_DEVICE_COMMENT_LENGTH = 32;
export const MAX_DEVICE_COMMENTS = 200;
export const DeviceCommentsSchema: ZodType;        // キーは /^(X|Y|M|T|C|SP)\d+$/
export type DeviceCommentsData = Record<string, string>;
export const LadderProgramSchema: ZodType;         // networks 1〜64
export interface LadderProgramData extends LadderProgram { comments?: DeviceCommentsData }
export const LADDER_COIL_COL: number;              // = COIL_COL
```

**3A のハンドオフ注記（本プランが必ず守るもの）:**

| 注記 | 本プランでの扱い |
|---|---|
| H-1 訓練者のラダーは「変換」を通ったものだけを判定に出す | Task 6 で `converted` フラグを持ち、Task 12 の「判定」ボタンは未変換なら**押せない**（`disabled` ＋ 理由のツールチップ）。それでも `judgePlc()` は落ちたラダーを `ladderErrors` 付きで不合格にするので二重に安全（Task 13 で表示する） |
| H-2 セッション中のスキャンと判定のスキャンは別物 | 判定後にセッションへ戻ることはない（結果画面へ移る）。RUN/STOP（Task 9）で `plcRun` を送ったときだけ Worker が `runtime.reset()` を呼ぶ |
| H-3 作業ファイルに残すもの | Task 14（課題ID・盤セッション・ラダーIR・方言ID・変換済みか・経過時間・危険操作） |
| H-4 `judgePlc()` は 0.3〜1 秒かかる | Task 3 で Worker 内に置き、`judgeRepair` と同じく**追従ループを止めて**実行する |
| H-5 `plcPowerIndependent` の2つの文言 | Task 13。`details` の中身で「盤から取っている」と「壁コンセントに未配線」を見分け、**さらに**「シミュレートされるPLCは L/N が未配線でも動く」旨の説明を常に添える |

### 前提E: `apps/desktop` の既存API（**本プランが触る分だけ**。実ソースを確認済み）

```ts
// src/shared/ipc.ts
export const IPC_CHANNELS: { contentList; contentRead; workfileSave; workfileLoad; settingsGet; settingsSet };
export type SessionMode = SupportedProblem['mode'];        // 3A Task 13 で 'plc' が自動で増える
export interface ProblemSummary { id; title; mode: SessionMode; grade; description; standardMin; cutoffMin; source }
export const WORK_FILE_FORMAT_VERSION = 1;
export interface WorkFile { formatVersion; problemId; session: unknown; elapsedMs; hazardCount; savedAt;
  mode?: SessionMode; tester?: unknown; answers?: unknown; checkPartId?: string; reports?: unknown;
  faultSeed?: number; resolvedFaults?: unknown; replacedPartIds?: unknown }
export interface AppSettings { userContentDir: string; soundEnabled: boolean; soundVolume: number; restorePrompt: boolean }
export const DEFAULT_SETTINGS: AppSettings;

// src/main/work-files.ts
export const MAX_WORK_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_WORK_FILE_WIRES = 200;
export const MAX_WORK_FILE_ENTRIES = 200;
export function parseWorkFile(raw: unknown): { ok: true; file: WorkFile } | { ok: false; message: string };
//   ※ 現在 `mode` は 'assemble' | 'inspect-parts' | 'inspect-repair' の3値しか通さない（Task 14 で 'plc' を足す）

// src/worker/protocol.ts
export const SNAPSHOT_INTERVAL_MS = 33;
export const MAX_CATCHUP_TICKS = 20;
export type SimCommand = { type: 'load'; problemId; session; partFaults? } | { type: 'addWire' … } | …
export interface SimSnapshot { tMs; breakerOn; switchOn; powered; tripped; sourceAmps; buttons; lamps; relays; timers; logDelta; hazardDelta; chatterDelta; tester; droppedTicks }
export type InspectOutcome = { ok: true; value: JudgeInspectResult } | { ok: false; errors: ProblemIssue[] };
export type SimMessage = { type: 'snapshot'; snapshot } | { type: 'judgeResult'; result } | { type: 'inspectResult'; result } | { type: 'error'; message; fatal };

// src/renderer/app/store.ts / store-types.ts
export type Route = 'home' | 'list' | 'session' | 'result' | 'settings';
export type ListMode = SessionMode | undefined;
export type CameraPreset = 'front' | 'top' | 'socket' | 'back' | 'left' | 'right' | 'bottom';
export const EMPTY_SNAPSHOT: SimSnapshot;
export const TOAST_TTL_MS = 4000; TOAST_LIMIT = 5; LOG_LIMIT = 200; HAZARD_BANNER_TTL_MS = 6000;
export const RESTART_FALLBACK_ATTEMPTS = 2;
export type AnyJudgeResult = JudgeResult | JudgeInspectResult;
export function isInspectJudge(result: AnyJudgeResult): result is JudgeInspectResult;  // mode !== 'assemble'
export function sessionForProblem(problem: SupportedProblem): BoardSession;
export interface OpenProblemOptions { resolvedFaults?; faultSeed? }
export interface AppState { /* route, problem, session, history, sessionEpoch, mode, wireColor, camera, cameraNonce,
  snapshot, hazards, chatters, chartSpecs, liveTransitions, logLines, toasts, startedAtMs, elapsedMs,
  restoredHazardCount, judge, fatalError, webglLost, judging, …  ＋ 40 個ほどのアクション */ }
export const useStore: StoreApi<AppState>;

// src/renderer/session/*
export function cloneSession(session: BoardSession): BoardSession;
export function emptyHistory(): CommandHistory;
export function pushCommand(h, c): CommandHistory; undo(h); redo(h);
export const HISTORY_LIMIT = 50;
export function runAddWire(session, from, to, color): CommandResult<Wire>;   // ← 盤は JIPM_BOARD 決め打ち（Task 11 で引数化）
export function runRemoveWire(session, wireId): CommandResult<Wire>;
export type ToolMode = 'wire' | 'delete' | 'tester' | 'report';
export type PickHit = { kind:'terminal'; id; wirable; label } | { kind:'wire'; id; locked } | { kind:'socket'; id; occupied } | { kind:'pushbutton'; id } | { kind:'empty' };
export function pickToAction(state, hit): PickAction;
export function escapeToAction(state): PickAction;
export function deleteKeyToAction(state, lockedWireIds): PickAction;
export function shouldIgnoreShortcut(event): boolean;         // isModalOpen() || isComposing || isTypingTarget
export function pushModalLayer(): { depth: number; release: () => void };
export function isModalOpen(): boolean; topModalLayer(): number;
export function useViewportShortcuts(options?: { enabled?: boolean }): void;
export function viewKeyAction(event): CameraPreset | undefined;
export const bridge: WorkerBridge;  // start(handlers) / send(command) / stop() / running
export function toWorkFile(problemId, session, elapsedMs, hazardCount): WorkFile;
export function toInspectWorkFile(): WorkFile | undefined;
export function toSession(raw: unknown): BoardSession | undefined;
export function applyWorkFile(file, options?): Promise<boolean>;
export function restoreInspectState(problem, state): boolean;
export const MAX_RESTORED_WIRES = 200; MAX_RESTORED_ENTRIES = 200;

// src/renderer/three/*
export function toScene(v: Vec3): [number, number, number];
export const BOARD_TILT_RAD: number;
export function boardToWorld(v, tiltRad?): [number, number, number];
export function cameraPose(preset: CameraPreset): CameraPose;
export function fitDistanceMm(widthMm, heightMm, aspect): number;
export const CAMERA_FOV_DEG = 38; MIN_CAMERA_DISTANCE_MM = 90; MAX_CAMERA_DISTANCE_MM = 1200; MAX_POLAR_ANGLE = Math.PI * 0.48;
export function safeRoutes(board, session): { routes: WireRoute[]; errors: RoutingError[] };
export function visualSignature(state: AppState): string;
export const BoardScene: React.MemoExoticComponent<…>;   // ← board を JIPM_BOARD で決め打ち（Task 10 で引数化）
export function TerminalHit(props): JSX.Element;
export function Fixture(props): JSX.Element;

// src/renderer/panels/*
export function Toolbar(props): JSX.Element;        // showWireTools? / extraTools? / children
export function TimeChartPanel({ chart }): JSX.Element;
export function EnlargeableChart(…);                // panels/TimeChartView.tsx
export function WarningBanner(): JSX.Element;
export function LogPanel(props); ElapsedTimer(props); PowerControls(props); ProblemPanel(props);
```

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `apps/desktop/src/renderer/session/ladder.ts` | **純粋層。** セルカーソル・選択・「キー入力 → 編集操作」・取り消し／やり直しスタック。`@ojt/ladder-core` の `edit.ts` だけを呼ぶ（新規・Task 1） |
| `apps/desktop/src/renderer/session/ladder-errors.ts` | 変換エラー／警告 → セル位置・出力ウィンドウ行への写像（新規・Task 6） |
| `apps/desktop/src/renderer/session/plc-session.ts` | モードD専用の純関数（初期ラダー・盤の派生・端子の役割表示・判定を送れるか）（新規・Task 2/11） |
| `apps/desktop/src/renderer/app/store-types.ts` | `CameraPreset` に `'plc'`、`LadderCursor` / `LadderViewMode` / `PlcMonitorMode` を足す（変更・Task 2/10） |
| `apps/desktop/src/renderer/app/store.ts` | モードDの状態（ラダー・方言・変換結果・モニタ・表示分割・エディタフォーカス）とアクション（変更・Task 2） |
| `apps/desktop/src/worker/protocol.ts` | `load` に `plcModel?`、`loadLadder` / `plcRun` / `judgePlc` コマンド、`SimSnapshot.plc`、`plcResult` メッセージ（変更・Task 3） |
| `apps/desktop/src/worker/sim.worker.ts` | モードDの盤（`withPlcUnit`）・スキャン結合・モニタ送出・`judgePlc`（変更・Task 3） |
| `apps/desktop/src/renderer/ladder/ladder.module.css` | ラダーエディタ・出力ウィンドウ・コメント欄・I/Oテーブルの CSS Modules（新規・Task 4） |
| `apps/desktop/src/renderer/ladder/symbols.ts` | `SymbolDrawing` の識別子 → 自前の SVG パス（**ベンダーの画像は持たない**。§17）（新規・Task 4） |
| `apps/desktop/src/renderer/ladder/LadderGrid.tsx` | セルグリッドの SVG 描画（カーソル・選択・モニタ通電色）（新規・Task 4） |
| `apps/desktop/src/renderer/ladder/DeviceInput.tsx` | デバイス入力欄（`parseDevice` / `timerPreset` / 丸め確認）（新規・Task 5） |
| `apps/desktop/src/renderer/ladder/LadderEditor.tsx` | キー操作の窓口＋グリッド＋入力欄の結線（新規・Task 5） |
| `apps/desktop/src/renderer/ladder/OutputWindow.tsx` | 出力ウィンドウ（変換エラー・警告・使用デバイス一覧）（新規・Task 6） |
| `apps/desktop/src/renderer/ladder/CommentPanel.tsx` | デバイスコメント欄（新規・Task 7） |
| `apps/desktop/src/renderer/ladder/IoTable.tsx` | I/O割付表（新規・Task 7） |
| `apps/desktop/src/renderer/ladder/ProjectTree.tsx` | ナビゲーションウィンドウ（プロジェクトツリー）（新規・Task 8） |
| `apps/desktop/src/renderer/ladder/ShortcutHelp.tsx` | キー割当表（`confirmed` / `enabled` の注記つき）（新規・Task 8） |
| `apps/desktop/src/renderer/ladder/LadderWorkspace.tsx` | GX Works3風の枠（ツリー＋エディタ＋出力ウィンドウ＋ツールバー）（新規・Task 8） |
| `apps/desktop/src/renderer/ladder/MonitorPanel.tsx` | モニタのデバイス一覧（X/Y/M/T/C の現在値）（新規・Task 9） |
| `apps/desktop/src/renderer/three/PlcUnit.tsx` | FX5U 本体の3D（筐体・LED・端子・銘板）（新規・Task 10） |
| `apps/desktop/src/renderer/three/Outlet.tsx` | 壁コンセントの3D（新規・Task 10） |
| `apps/desktop/src/renderer/three/DeskWires.tsx` | 机上へ渡るケーブルの3D（`deskWires()` の直線）（新規・Task 10） |
| `apps/desktop/src/renderer/three/camera.ts` | `'plc'` プリセットと `PLC_VIEW_RECT`（変更・Task 10） |
| `apps/desktop/src/renderer/three/BoardScene.tsx` | 盤を props で受け取り、PLC・コンセント・机上配線を描く（変更・Task 10） |
| `apps/desktop/src/renderer/session/commands.ts` | `runAddWire` / `runRemoveWire` に盤を渡せるようにする（変更・Task 11） |
| `apps/desktop/src/renderer/screens/PlcSession.tsx` | モードDのセッション画面（新規・Task 12） |
| `apps/desktop/src/renderer/screens/SessionRoute.tsx` | `case 'plc'`（変更・Task 12） |
| `apps/desktop/src/renderer/result/PlcResult.tsx` | モードDの結果画面（新規・Task 13） |
| `apps/desktop/src/renderer/result/LadderIssueList.tsx` | 変換エラー・警告の一覧（結果画面用）（新規・Task 13） |
| `apps/desktop/src/renderer/screens/Result.tsx` | モードDの分岐（変更・Task 13） |
| `apps/desktop/src/renderer/session/work-file.ts` | モードDの保存・復元（変更・Task 14） |
| `apps/desktop/src/shared/ipc.ts` | `WorkFile` にモードDの項目、`AppSettings` に `defaultVendor` / `ladderGridCols` / `monitorColor`（変更・Task 14/16） |
| `apps/desktop/src/main/work-files.ts` | モードDの検証と上限（変更・Task 14） |
| `apps/desktop/src/renderer/screens/Home.tsx` | モードDのカードを押せるようにする（変更・Task 15） |
| `apps/desktop/src/renderer/screens/ProblemList.tsx` | 絞り込みに PLC を足す（変更・Task 15） |
| `apps/desktop/src/renderer/screens/Settings.tsx` | 既定メーカー・ラダーの表示列数・通電色（変更・Task 16） |
| `apps/desktop/src/renderer/i18n/ja.ts` | モードDの文言一式（変更・全タスク。**MERGE 注意 #1**） |
| `apps/desktop/e2e/plc.spec.ts` | §16 Phase 3 受入基準①〜⑤（新規・Task 17） |
| `apps/desktop/e2e/projection.ts` | 机上端子の射影（追記・Task 17） |
| `apps/desktop/test/ladder-*.test.ts(x)` ほか | 各タスクのテスト（新規） |

---

## 設計判断（レビューで確認する決定表）

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| 1 | **ラダーエディタの描画方式** | **SVG のセルグリッド1枚**（`<svg>` の中に `<g data-testid="cell-n1-0-0">` を敷き詰める）。1セル = 48×36 px、接点列は `profile.gridCols`（11）＋コイル列1の計12列を表示し、IR の16列のうち表示しない列は**横スクロール**で出す | ①キーボード先行の操作（カーソル・選択・F5/F7）は DOM のフォーカスが1つで済む SVG が最も素直で、`<svg tabIndex={0}>` 1つにキーを張れば済む。②セルの罫線・分岐の縦線・微分接点の斜線は**線画**なので、`<table>` では CSS の border を使った擬似表現になり、`vline` が「そのセル自身も導通する」という意味（前提A）を描き分けられない。③canvas は速いが DOM が無く、Testing Library からセルを引けない（本リポジトリの UI テストはすべて `getByTestId` で書かれている）。④既に `TimeChartView.tsx` が SVG ＋ ポータルの流儀で書かれており、拡大表示・カーソル線の実装を流用できる |
| 2 | **編集操作の実体と取り消し** | 編集は `@ojt/ladder-core` の `edit.ts` の7関数だけ。取り消し／やり直しは **`LadderProgram` のスナップショットを積む**（`LadderHistory = { done: LadderProgram[]; undone: LadderProgram[] }`、上限 `HISTORY_LIMIT`（50）と同じ）。**盤の `CommandHistory` とは別スタック** | `edit.ts` は純粋関数で、戻り値がそのままスナップショットになる（3A の引渡し表がそう明記している）。逆操作を自前で組むと `insertRow` → `deleteRow` の往復で行の中身が失われる。盤と同じスタックに混ぜない理由は、盤の取り消しは Worker へ `load` を送り直す重い操作で、ラダーの取り消しは `loadLadder` だけで済むため。**どちらを取り消すかはフォーカスで決める**（下の#3） |
| 3 | **`Ctrl+Z` の宛先** | ラダーエディタにフォーカスがある間（`ladderFocused`）は**ラダー**、それ以外は**盤**。`ladderFocused` はストアが持ち、`LadderEditor` の `onFocus` / `onBlur` で切り替える。視点のショートカット（テンキー・`1`/`2`/`3`）と `Delete`／`Esc` も `ladderFocused` の間は盤へ通さない | 1画面に取り消しの対象が2つある以上、どちらかを選ぶ規則が要る。「最後に触ったほう」は状態が見えず説明できない。フォーカスなら枠線で見えるので、訓練者が「いまどちらを編集しているか」を目で確認できる。`useViewportShortcuts({ enabled: !ladderFocused })` の1行で済み、既存のフックを壊さない |
| 4 | **変換エラー → セルの写像** | `CompileError` / `ConvertError` の `networkId` / `row` / `col` をそのまま使う。`col` が無い（`no-output` など）ものは**そのネットワークの見出し行**、`networkId` が空文字（`missing-end` / `mc-unmatched` のプログラム全体版）のものは**出力ウィンドウの先頭**に置き、クリックしてもカーソルは動かさない。行をクリックするとカーソルが該当セルへ飛び、そのセルが赤枠になる | `compile()` が既に位置を持っている（前提A）ので、UI 側で位置を推定しない。推定すると `grid-shape` のようにセルに紐づかない誤りで嘘の場所を指す |
| 5 | **モニタの更新頻度と再描画** | Worker が**モニタ中だけ** `SimSnapshot.plc` を載せる。`poweredCells`（最大 16×12×64 個の boolean）は**そのまま渡さず**、ネットワークごとに `'0110…'` の行文字列へ畳んだ `powered: Record<string, string>` にする。グリッドは `useStore((s) => s.plcMonitor?.powered[net.id] ?? '')` という**ネットワーク1本ぶんの文字列**を購読し、文字列が同じなら React が再描画しない | テスター読値（Plan 2B 前提D）と同じ考え方。boolean の `Record` をそのまま渡すと、33ms ごとに 1,536 個の比較と新しいオブジェクトが生まれ、`useShallow` でも毎回「変わった」と判定される（キーの数が同じでも参照が違う）。行文字列なら比較は文字列1本で、ネットワークを跨いだ再描画も起きない。**送出は 33ms のスナップショットに相乗り**させ、コマンドもメッセージも増やさない |
| 6 | **3Dの視点** | `CameraPreset` に **`'plc'`** を足す（ツールバー4つ目のボタン、`data-testid="view-plc"`）。画角は `PLC_ORIGIN_MM` / `sizeMm` / `OUTLET_ORIGIN_MM` から求めた `PLC_VIEW_RECT` を `fitDistanceMm()` で収める。**テンキーとビューキューブの割当は変えない**（盤の6面のまま） | 机上のPLCは盤座標の外（x ≈ 390mm）にあり、既存の7プリセットではどれも画角に入らない。テンキーに足すと Blender の 1/3/7 の意味（面直視）が崩れる（§12.2 の割当表がそのまま使えなくなる）。ツールバーのボタンなら §12.2 の「ツールバーは前の3種」に1つ足すだけで、既存のキー表を触らない |
| 7 | **配線ルールの UI と判定の切り分け** | UI が断るのは**盤のルールだけ**（1端子2本・盤に無い端子・既設配線・線色パレット＝青のみ）。`twoStage` / `plcPowerIndependent` / `ioAssignment` は**判定時のみ**。セッション中に「いまの配線の診断」は**出さない** | Plan 2B の C2 で「外した青線」を判定用の集計で出したら故障箇所が漏れた（`removedWires` の修正）のと同じ構図。`Y0` をランプへ直結した瞬間に「2段結線になっていません」と出すと、受入基準④（`twoStage` エラー）が体験として成立しない。I/Oテーブル（Task 7）が出すのは**課題が与えた割付**（＝課題文）だけで、配線できているかどうかは出さない |
| 8 | **作業ファイルの形** | `formatVersion` は **1 のまま**。モードDの項目はすべて任意: `mode: 'plc'` / `ladder`（`LadderProgramData` の JSON。`comments` を含む）/ `dialectId` / `converted`（boolean）。読み手は `toLadderProgram()`（`toSession()` と同じ流儀の自前検証）で断る。上限はネットワーク64・行12・列16・コメント200件×32文字 | §13 #8 の「バージョンを上げると古いファイルが読めなくなる」を Plan 2B が既に決めている。`@ojt/content` の `LadderProgramSchema` を renderer から呼べば zod で検証できるが、**呼ばない**: 保存データの検証は「盤に載せる前に断る」ためのもので、課題スキーマの読込パス（zod の ja locale・`ProblemIssue`）とは目的が違い、`toSession()` と同じ層に揃えたほうが読み手が1箇所になる |
| 9 | **Worker の `load` がモードDで要るもの** | `load` に **`plcModel?: string`** を足すだけにする。Worker は `plcUnitFor(model)` → `withPlcUnit(JIPM_BOARD, unit)` で盤を派生させ、`toNetlist()` に渡す。ラダーは**別コマンド** `loadLadder { program }`、RUN/STOP は `plcRun { on }` | 盤とラダーは寿命が違う。ラダーは変換のたびに送り直すが盤はそのままで、盤は配線のたびに差分コマンド（`addWire`）で当たるがラダーは丸ごと入れ替わる。1つの `load` にまとめると、ラダーを1文字直すたびに `new Simulation()` が走って `tMs`・信号ログ・危険操作が切れる（Plan 2B が `plug` で避けたのと同じ失敗） |
| 10 | **画面の分割** | 既定は **左右分割**（左＝ラダーワークスペース、右＝3D盤）。ツールバーの3ボタン（`ラダー` / `分割` / `盤`）で切り替える。`viewMode` はストアが持つ。分割比は CSS の `grid-template-columns: minmax(520px, 1fr) minmax(420px, 1fr)` 固定で、ドラッグでの可変分割は入れない | §16 Phase 3 の受入基準①〜③が「ラダーを組む」→「配線する」→「判定」と行き来するので、既定で両方見えているのが自然。可変分割（スプリッタ）は 3D の `Canvas` をリサイズし続けることになり、`frameloop="demand"` の前提（§15）が崩れる。1280px 幅では左520px＋右660px 程度で、ラダーの12列（48px × 12 = 576px）は横スクロール1画面ぶんに収まる |
| 11 | **`F2` / `Shift+F2`（書込み／読出しモード）と `F3`（モニタ）の意味** | `editorMode: 'write' \| 'read' \| 'monitor'` の3値。`write` は編集可、`read` は編集不可（セルの選択と移動だけ）、`monitor` は編集不可＋通電表示。`Shift+F3`（モニタ書込み）は **Phase 3 では `monitor` と同じ**にし、キー割当表に「Phase 3 ではモニタと同じ動作です」の注記を出す | GX Works3 の「モニタ（書込み）」はオンラインでのプログラム変更で、本アプリには「シーケンサへ書き込む」という実体が無い（`loadLadder` が即反映される）。`enabled: false` にしてしまうと `SHORTCUTS` を書き換えることになり、方言プロファイルは 3A の所有物なので触れない。**注記で差を説明する**のが §17.1 の流儀に合う |
| 12 | **キー割当表は誰のものか** | 画面は `profile.shortcuts` を**表として描くだけ**で、キーの文字列を1つもハードコードしない。「キー文字列 → `action`」の照合は `session/ladder.ts` の `matchShortcut()` が行い、`action` 文字列に対して振る舞いを決める | Phase 4 で `getDialect('omron')` に差し替えるだけでキー割当が変わる（§17.1 の「修正箇所は方言プロファイルのみ」）。`event.key === 'F5'` と書いた瞬間にこの性質が壊れる。テストは「`MITSUBISHI_FX5U.shortcuts` から作った表で `F5` が `contact-no` になる」ことと「架空のプロファイルで `F5` を別の action に割り当てたら振る舞いも変わる」ことの両方を見る |
| 13 | **設定画面のメーカー選択** | `AppSettings.defaultVendor: DialectId`（既定 `'mitsubishi'`）。選択肢は `availableDialects()` が返すものだけ（Phase 3 は三菱1件）。未実装の3社は**淡色で並べて押せない**ようにし、「Phase 4 で追加します」の注記を添える | §16 Phase 4 の受入基準①が「設定で既定メーカーをOMRONにすると…」なので、Phase 3 で入れ物を作っておくと Phase 4 は選択肢を増やすだけになる。並べずに隠すと「4社対応」という約束（§10.5）が画面から消える |
| 14 | **セッション開始時のラダー** | **空のラダー**（`program(network('n1', [[empty()]]), endNetwork())`）から始める。課題の `referenceLadder` は**絶対に出さない** | 模範ラダーは答えそのものである。§8.4 のヒント方針（回路図は級で出し分け）はモードDには適用しない（§7.6 が `referenceLadder` をヒントとして挙げていない） |
| 15 | **新規ネットワークの ID** | `n1` / `n2` / … の通し番号を、**既存の最大番号＋1**で採る（`deleteNetwork` のあとに番号が飛んでもよい）。END ネットワークの ID は `'end'` 固定 | `program()` と `insertNetwork()` が ID 重複で投げる（前提A）ので、一意さが要る。番号を詰め直すと、変換エラーの `networkId` と出力ウィンドウの行が編集のたびにずれる |

---

## 実装バッチ（推奨）

依存関係にもとづく6バッチ。バッチ内の `/` 区切りは並行可、`→` は直列。モデルは「判断（設計の分岐・MERGE・回路や判定の意味）を要するか」で選ぶ。

| バッチ | タスク | 対象 | モデル | 依存 |
|---|---|---|---|---|
| 1 | 1 → 2 → 3 | 純粋層・ストア・Worker プロトコル | 1=Sonnet（そのまま写す） / 2=**Opus**（`store.ts` MERGE） / 3=**Opus**（`sim.worker.ts` MERGE） | なし |
| 2 | 4 → 5 → 6 ／ 7 ／ 10 | ラダーエディタ本体 ／ コメント欄・I/O表 ／ 3D | 4=**Opus** / 5=**Opus** / 6=Sonnet ／ 7=Sonnet ／ 10=**Opus**（`BoardScene.tsx` MERGE） | 1・2（10 は 2 のみ） |
| 3 | 8 ／ 9 ／ 11 | GX Works3風の枠 ／ モニタ ／ 配線操作 | 8=Sonnet / 9=**Opus** / 11=**Opus** | 2（4〜7・10 が揃っていること） |
| 4 | 12 → 13 | セッション画面 → 結果画面 | どちらも **Opus** | 1〜3 すべて |
| 5 | 14 ／ 15 ／ 16 | 作業ファイル ／ ホーム・一覧 ／ 設定 | すべて Sonnet | 12 |
| 6 | 17 → 18 | E2E・スクリーンショット → 全体検証 | 17=**Opus** / 18=Sonnet | 1〜5 すべて |

進め方: **1** → **2（3系統を並行）** → **3（3系統を並行）** → **4** → **5（3系統を並行）** → **6**。並行の上限は3系統までにする（`ja.ts` の追記が衝突するため。MERGE 注意 #1）。

「そのまま写す（Sonnet-verbatim）」と書いたタスクは、本プランのコードとテストをそのまま書き写せば通る。**どのタスクも、後のタスクが作るファイルを import しない**ことを各タスクの Files 欄で確認すること。

<!-- CHUNK -->
