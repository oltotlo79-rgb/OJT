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
- **`poweredCells` は「どの行でも0列目は必ず `true`」になる**（`Rails` の構築時に全行の0列目を左母線へ union するため。3A レビュー指摘）。空セルの0列目まで青く塗ると、何も書いていない行が光って見える。**モニタは `empty` のセルを塗らない**こと（Task 4）。3A 側でランタイムが「空セルの0列目は `false`」を返すよう直る可能性があるので、**どちらでも正しく見えるように**書く（＝UI 側で `empty` を弾く）。
- **`deleteNetwork()` は END ネットワークも消せる**（仕様どおり）。消すと `compile()` が `missing-end` を返すので、出力ウィンドウで気づける。エディタは END の削除を止めない。
- **今後 3A 側で増える検査**: `setVerticalLink()` がコイル列を拒否するようになる／`compile()` が「X・SP への OUT/SET/RST」「T・C への OUT」を新しい構造エラーコードで拒否するようになる。したがって **`CompileErrorCode` を画面側で網羅しない**こと（`ConvertErrorLine.code` は `string` のまま扱い、`message` をそのまま出す）。`buildCell()`（Task 5）の許可表がこれらを先に弾くので、通常は出ない。
- **3B が使ってよい追加の公開名**: `PlcRuntimeOptions` / `CLOCK_PERIOD_MS` / `TIMER_STEP_MS` / `MAX_TIMER_PRESET_MS` / `MAX_COUNTER_PRESET` / `DEVICE_PREFIX` / `NetworkOptions` / `CompiledNetwork` / `CompiledOutput` / `DeviceUsage` / `PlcRuntime`。
- **性能（3A 実測）**: 1スキャン **0.06ms**、`judgePlc()` は 6 秒の課題で **約 72ms**。H-4 の「0.3〜1 秒」は見積もりで、実測はこれより軽い。それでも `judgeRepair` と同じく追従ループを止める（1級の 8 秒課題や将来の長い課題で `MAX_CATCHUP_TICKS`（200ms相当）に近づくため。余白を残す）。

### 前提B: `@ojt/plc-dialects`（**landed**。`profile.ts` / `mitsubishi.ts` / `convert.ts` の実装を確認済み）

Plan 3A Task 8 / 9 / 10 は `main` にある（`1966785` / `a650bfa` / `0d114af`）。パッケージのテストは **37件**（`profile` / `mitsubishi-devices` / `mitsubishi-validate` / `convert` / `skin` の5ファイル）。`@ojt/ladder-core` は **68件**（`ir` / `edit` / `compile` / `runtime` / `golden-ladder` の5ファイル）。下記は実ソースから引いた署名である。

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

// mitsubishi.ts（landed）
export const MITSUBISHI_FX5U: DialectProfile;   // id 'mitsubishi' / displayName '三菱電機 MELSEC iQ-F FX5U（GX Works3風）'
export function timerBaseMs(timer: Device): number;          // index>=256→1 / >=200→10 / それ以外→100
export function roundTimerPreset(ms: number, baseMs: number): number;
// validate() のコード: 'device-range' / 'timer-unit' / 'counter-range' / 'special-unsupported'

// convert.ts（landed）
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

表は **19行**で、`enabled: false` は `application`（`F8`）**1件だけ**である（`skin.test.ts` が本数を固定している）。

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
- **画面に出す入力仕様は `@ojt/board-model` の FX5U の値を使う**（3A レビュー指摘）。`FX5U_INPUT_OHMS`(4500) / `FX5U_ON_AMPS`(0.0035) / `FX5U_OFF_AMPS`(0.0015)。`@ojt/circuit-sim` の `PLC_INPUT_OHMS`(4700) / `PLC_INPUT_ON_AMPS`(0.003) / `PLC_INPUT_OFF_AMPS`(0.0015) は**機種を指定しなかったときの既定値**であり、画面に出すと実機と違う数字になる。`FX5U_SPEC` から引くか `plcMetaOf(part)` の `onAmps` / `offAmps` を使うこと（Task 9 のモニタ表示）。
- **IR のデバイス番号は10進、FX5U の端子名は8進。** `Y(8)` の端子は **`PLC.Y10`**、`X(10)` の端子は **`PLC.X12`** である。`deviceLabel()`（`Y8`）を端子名として使ってはならない。端子名は必ず `unit.spec.outputs[y].name` / `unit.spec.inputs[x]`（または `plcMetaOf(part).outputs[i].name`）から引く。三菱のスキンでは `profile.formatDevice(Y(8))` も `'Y10'` を返すので**画面上は一致する**が、根拠が違う（片方は方言の表示規則、片方は機種の端子名）ので、**端子を指すときは必ず機種側**から取る（決定表#16）。
- **端子の印字色は既に揃っている。** `apps/desktop/src/renderer/three/labels.ts` の役割色表は `x` / `y` / `ss` / `plc-com` / `ac-l` / `ac-n` を**既に持っている**（`ac-l` は赤 `#D14343`、`ac-n` は青 `#2E6BD6`）。Task 10 はこの表をそのまま使い、色を足さない。
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
| 1 | **ラダーエディタの描画方式** | **SVG のセルグリッド1枚**（`<svg>` の中に `<g data-testid="cell-n1:0:0">` を敷き詰める）。1セル = 48×36 px、接点列は `profile.gridCols`（11）＋コイル列1の計12列を表示する。IR の中間列（11〜14）は**描かない**。そこに中身がある場合は見出しに警告を出し、設定画面の「ラダーの表示列数」（§10.6 が定める 8〜15）で広げてもらう | ①キーボード先行の操作（カーソル・選択・F5/F7）は DOM のフォーカスが1つで済む SVG が最も素直で、`<svg tabIndex={0}>` 1つにキーを張れば済む。②セルの罫線・分岐の縦線・微分接点の斜線は**線画**なので、`<table>` では CSS の border を使った擬似表現になり、`vline` が「そのセル自身も導通する」という意味（前提A）を描き分けられない。③canvas は速いが DOM が無く、Testing Library からセルを引けない（本リポジトリの UI テストはすべて `getByTestId` で書かれている）。④既に `TimeChartView.tsx` が SVG ＋ ポータルの流儀で書かれており、拡大表示・カーソル線の実装を流用できる |
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
| 16 | **端子名（8進）とIRのデバイス番号（10進）を混ぜない** | **端子を指す文字列は必ず機種側から取る**（`unit.spec.inputs[x]` / `unit.spec.outputs[y].name` / `plcMetaOf(part)`）。**ラダーの中に出るデバイス名は必ず方言側から取る**（`profile.formatDevice(device)`）。`deviceLabel()`（ベンダー中立の10進表記）は**デバイスコメントの鍵**にだけ使う | IR の `Device.index` は0起点の通し番号（3A 決定表#5）で、FX5U の端子名は8進なので `Y(8)` の端子は `PLC.Y10` である。三菱スキンでは `formatDevice()` も8進なので画面上は一致するが、Phase 4 の OMRON は端子名 `100.00`・デバイス表記 `100.00`、TOYOPUC は16進で、**根拠の違う2つの文字列**になる。ここを混ぜると Phase 4 で「3Dの端子は見つかるのにラダーの表示が合わない」類の不具合が出る |
| 15b | **未使用デバイスの扱い**（§10.8） | `CompiledProgram.usage`（`reads` / `writes`）から「宣言・配置したが使われていないデバイス」を出力ウィンドウに**表示するだけ**にし、**合否には一切効かせない**（2026-09-18 の利用者決定） | 未使用デバイスは実機でも警告どまりで、動作が正しければ検定の減点にはならない。判定は `judgePlc()`（3A）が持っており、そこに未使用デバイスの項目は無い。UI 側で勝手に不合格要素を足すと、3A の判定と画面の合否が食い違う |
| 15c | **PLC電源が壁コンセントへ未配線のとき** | **エラー**（`plcPowerIndependent` の不合格）とし、盤から取っているときとは**別の文言**を出す。さらに「シミュレートされるPLCは `PLC.L` / `PLC.N` が未配線でも動きます」という説明を**常に**添える（2026-09-18 の利用者決定 ＋ 3A H-5） | §10.1 は「PLC電源は壁コンセント（AC100V）へ配線する」と定めており、未配線は手順の欠落である。ただし本アプリのPLCは電気的に解かない端子（3A 決定表#3）なので未配線でも動いてしまい、訓練者からは「動いているのにチェックだけ赤い」ように見える。理由を書かない限り不親切な不合格になる |
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

## Task 1: ラダー編集の純粋層（`session/ladder.ts`）

**Files:**
- Create: `apps/desktop/src/renderer/session/ladder.ts`
- Test: `apps/desktop/test/ladder-model.test.ts`

3D も React も使わない層に「セルカーソル」「キー入力 → 編集操作」「取り消し／やり直し」を閉じ込める（決定表#1・#2・#12）。編集の実体は `@ojt/ladder-core` の `edit.ts` だけで、ここが持つのは**呼び出し順**である。

| 決めること | 本タスクの実装 |
|---|---|
| カーソル | `{ networkId, row, col }`。左右はネットワーク内で 0〜`COIL_COL` に丸め、上端でさらに上へ行くと前のネットワークの最終行、下端で下へ行くと次のネットワークの0行目へ移る |
| キー照合 | `matchShortcut(profile.shortcuts, event)`。`keys` の文字列（`Shift+F5` / `Ctrl+←↑↓→` / `Alt+/`）を展開して照合する。**キー文字列をこのファイルに書かない** |
| OR接点（`Shift+F5` / `Shift+F6`） | 1行下に接点を置き、右側は `setVerticalLink(row, col+1, true)`、左側は `col > 0` のとき `setVerticalLink(row, col-1, true)` ＋ 1行下の同じ列に `hline()`。`col === 0` は左母線が既に全行を繋いでいるので左側の罫線は要らない |
| 取り消し | `LadderProgram` のスナップショットスタック。上限は盤と同じ `HISTORY_LIMIT`（50） |
| 失敗 | `edit.ts` が投げる `LadderError` は**そのまま文言として返す**（ライブラリが日本語で持っている） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/ladder-model.test.ts`:

```ts
import {
  COIL_COL,
  cellAt,
  empty,
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  X,
  Y,
  type LadderProgram,
} from '@ojt/ladder-core';
import type { ShortcutTable } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  applyLadderCell,
  applyOrContact,
  clearLadderCell,
  emptyLadderHistory,
  initialLadder,
  keyChord,
  ladderKeyToAction,
  LADDER_HISTORY_LIMIT,
  matchShortcut,
  moveCursor,
  nextNetworkId,
  pushLadder,
  redoLadder,
  togglePulseAt,
  toggleNoNcAt,
  undoLadder,
  type LadderCursor,
} from '../src/renderer/session/ladder.js';

/** 本物のプロファイルに依存しない最小のショートカット表（決定表#12 の入替可能性を見る）。 */
const TABLE: ShortcutTable = [
  { action: 'contact-no', keys: 'F5', label: 'a接点', confirmed: true },
  { action: 'contact-nc', keys: 'F6', label: 'b接点', confirmed: false },
  { action: 'or-contact-no', keys: 'Shift+F5', label: 'OR a接点', confirmed: false },
  { action: 'coil', keys: 'F7', label: 'コイル', confirmed: true },
  { action: 'application', keys: 'F8', label: '応用命令', confirmed: true, enabled: false, note: 'Phase 4' },
  { action: 'hline', keys: 'F9', label: '横線', confirmed: false },
  { action: 'rule-line', keys: 'Ctrl+←↑↓→', label: '罫線', confirmed: true },
  { action: 'convert', keys: 'F4', label: '変換', confirmed: false },
  { action: 'toggle-no-nc', keys: '/', label: '切換', confirmed: true },
  { action: 'toggle-pulse', keys: 'Alt+/', label: '微分切換', confirmed: true },
  { action: 'monitor', keys: 'F3', label: 'モニタ', confirmed: true },
];

function twoRungs(): LadderProgram {
  return program(
    network('n1', [[no(X(0)), hline(), out(Y(0))]]),
    network('n2', [[no(X(1)), out(Y(1))]]),
    endNetwork(),
  );
}

const at = (networkId: string, row: number, col: number): LadderCursor => ({ networkId, row, col });

describe('initialLadder（決定表#14: 模範ラダーは出さない）', () => {
  it('starts from one empty network plus END', () => {
    const p = initialLadder();
    expect(p.networks.map((n) => n.id)).toEqual(['n1', 'end']);
    expect(cellAt(p.networks[0]!, 0, 0)).toEqual(empty());
    expect(p.networks[0]!.cols).toBe(IR_COLS);
  });

  it('numbers a new network above the highest existing one (決定表#15)', () => {
    expect(nextNetworkId(twoRungs())).toBe('n3');
    expect(nextNetworkId(initialLadder())).toBe('n2');
  });
});

describe('keyChord / matchShortcut（決定表#12）', () => {
  it('builds the chord text the shortcut table uses', () => {
    expect(keyChord({ key: 'F5' })).toBe('F5');
    expect(keyChord({ key: 'F5', shiftKey: true })).toBe('Shift+F5');
    expect(keyChord({ key: '/', altKey: true })).toBe('Alt+/');
    expect(keyChord({ key: 'ArrowLeft', ctrlKey: true })).toBe('Ctrl+ArrowLeft');
  });

  it('matches plain and modified function keys', () => {
    expect(matchShortcut(TABLE, { key: 'F5' })?.action).toBe('contact-no');
    expect(matchShortcut(TABLE, { key: 'F5', shiftKey: true })?.action).toBe('or-contact-no');
    expect(matchShortcut(TABLE, { key: 'F5', ctrlKey: true })).toBeUndefined();
  });

  it('expands the arrow set of the rule-line entry', () => {
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight']) {
      expect(matchShortcut(TABLE, { key, ctrlKey: true })?.action).toBe('rule-line');
    }
  });

  it('is driven by the table, not by hard-coded keys', () => {
    const swapped: ShortcutTable = [{ action: 'coil', keys: 'F5', label: 'コイル', confirmed: false }];
    expect(matchShortcut(swapped, { key: 'F5' })?.action).toBe('coil');
  });
});

describe('ladderKeyToAction', () => {
  const state = { cursor: at('n1', 0, 0), mode: 'write' as const };

  it('turns the table entries into actions', () => {
    expect(ladderKeyToAction(TABLE, { key: 'F5' }, state)).toEqual({
      type: 'place',
      kind: 'contact-no',
    });
    expect(ladderKeyToAction(TABLE, { key: 'F7' }, state)).toEqual({ type: 'place', kind: 'coil' });
    expect(ladderKeyToAction(TABLE, { key: 'F4' }, state)).toEqual({ type: 'convert' });
    expect(ladderKeyToAction(TABLE, { key: 'F3' }, state)).toEqual({
      type: 'setMode',
      mode: 'monitor',
    });
    expect(ladderKeyToAction(TABLE, { key: 'ArrowRight', ctrlKey: true }, state)).toEqual({
      type: 'ruleLine',
      direction: 'right',
    });
  });

  it('reports a disabled entry instead of doing nothing silently (F8)', () => {
    const action = ladderKeyToAction(TABLE, { key: 'F8' }, state);
    expect(action.type).toBe('disabled');
    if (action.type !== 'disabled') return;
    expect(action.entry.note).toContain('Phase 4');
  });

  it('moves with the bare arrow keys and Tab', () => {
    expect(ladderKeyToAction(TABLE, { key: 'ArrowRight' }, state)).toEqual({
      type: 'move',
      dRow: 0,
      dCol: 1,
    });
    expect(ladderKeyToAction(TABLE, { key: 'Tab' }, state)).toEqual({ type: 'move', dRow: 0, dCol: 1 });
    expect(ladderKeyToAction(TABLE, { key: 'Tab', shiftKey: true }, state)).toEqual({
      type: 'move',
      dRow: 0,
      dCol: -1,
    });
  });

  it('opens the device input on Enter and clears on Delete', () => {
    expect(ladderKeyToAction(TABLE, { key: 'Enter' }, state)).toEqual({ type: 'edit' });
    expect(ladderKeyToAction(TABLE, { key: 'Delete' }, state)).toEqual({ type: 'delete' });
    expect(ladderKeyToAction(TABLE, { key: 'Backspace' }, state)).toEqual({ type: 'delete' });
  });

  it('routes Ctrl+Z / Ctrl+Y to the ladder history (決定表#3)', () => {
    expect(ladderKeyToAction(TABLE, { key: 'z', ctrlKey: true }, state)).toEqual({ type: 'undo' });
    expect(ladderKeyToAction(TABLE, { key: 'y', ctrlKey: true }, state)).toEqual({ type: 'redo' });
    expect(ladderKeyToAction(TABLE, { key: 'Z', ctrlKey: true, shiftKey: true }, state)).toEqual({
      type: 'redo',
    });
  });

  it('refuses every edit while the editor is in read or monitor mode (決定表#11)', () => {
    for (const mode of ['read', 'monitor'] as const) {
      const readonlyState = { cursor: at('n1', 0, 0), mode };
      expect(ladderKeyToAction(TABLE, { key: 'F5' }, readonlyState)).toEqual({ type: 'readOnly' });
      expect(ladderKeyToAction(TABLE, { key: 'Delete' }, readonlyState)).toEqual({ type: 'readOnly' });
      // 移動と変換とモード切替は読出し中でも通す
      expect(ladderKeyToAction(TABLE, { key: 'ArrowDown' }, readonlyState)).toEqual({
        type: 'move',
        dRow: 1,
        dCol: 0,
      });
      expect(ladderKeyToAction(TABLE, { key: 'F4' }, readonlyState)).toEqual({ type: 'convert' });
    }
  });
});

describe('moveCursor', () => {
  const p = twoRungs();

  it('clamps inside the row', () => {
    expect(moveCursor(p, at('n1', 0, 0), 0, -1)).toEqual(at('n1', 0, 0));
    expect(moveCursor(p, at('n1', 0, COIL_COL), 0, 1)).toEqual(at('n1', 0, COIL_COL));
  });

  it('walks to the neighbouring network at the top and bottom edges', () => {
    expect(moveCursor(p, at('n2', 0, 3), -1, 0)).toEqual(at('n1', 0, 3));
    expect(moveCursor(p, at('n1', 0, 3), 1, 0)).toEqual(at('n2', 0, 3));
    // 先頭より上・末尾より下へは出ない（END ネットワークも行き先になる）
    expect(moveCursor(p, at('n1', 0, 3), -1, 0)).toEqual(at('n1', 0, 3));
    expect(moveCursor(p, at('end', 0, 0), 1, 0)).toEqual(at('end', 0, 0));
  });

  it('keeps the column inside the shorter network', () => {
    expect(moveCursor(p, at('n1', 0, COIL_COL), 1, 0)).toEqual(at('n2', 0, COIL_COL));
  });
});

describe('applyLadderCell / clearLadderCell', () => {
  it('places a cell and leaves the original program untouched', () => {
    const before = twoRungs();
    const result = applyLadderCell(before, at('n1', 0, 1), no(X(2)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(cellAt(result.program.networks[0]!, 0, 1)).toEqual(no(X(2)));
    expect(cellAt(before.networks[0]!, 0, 1)).toEqual(hline());
  });

  it('returns the LadderError message instead of throwing', () => {
    const result = applyLadderCell(twoRungs(), at('n1', 9, 0), no(X(0)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('行 9');
  });

  it('clears a cell', () => {
    const result = clearLadderCell(twoRungs(), at('n1', 0, 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(cellAt(result.program.networks[0]!, 0, 0)).toEqual(empty());
  });
});

describe('applyOrContact（並列分岐）', () => {
  it('branches from the left rail when the contact is in column 0', () => {
    const result = applyOrContact(twoRungs(), at('n1', 0, 0), no(Y(0)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const net = result.program.networks[0]!;
    expect(net.rows).toBe(2);
    expect(cellAt(net, 1, 0)).toEqual(no(Y(0)));
    // 右側だけ罫線を引く（左は0列目の左母線が全行を繋いでいる）
    expect(cellAt(net, 0, 1).kind).toBe('vline');
  });

  it('draws both rule lines when the contact is not in column 0', () => {
    const base = program(network('n1', [[hline(), no(X(0)), hline(), out(Y(0))]]), endNetwork());
    const result = applyOrContact(base, at('n1', 0, 1), no(Y(0)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const net = result.program.networks[0]!;
    expect(cellAt(net, 0, 0).kind).toBe('vline');
    expect(cellAt(net, 1, 0).kind).toBe('hline');
    expect(cellAt(net, 1, 1)).toEqual(no(Y(0)));
    expect(cellAt(net, 0, 2).kind).toBe('vline');
  });

  it('refuses to branch where the left neighbour is a contact', () => {
    const base = program(network('n1', [[no(X(0)), no(X(1)), out(Y(0))]]), endNetwork());
    const result = applyOrContact(base, at('n1', 0, 1), no(Y(0)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('罫線');
  });

  it('refuses to branch in the column just before the coil column', () => {
    const result = applyOrContact(twoRungs(), at('n1', 0, COIL_COL - 1), no(Y(0)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('コイル列');
  });
});

describe('toggleNoNcAt / togglePulseAt', () => {
  it('swaps a and b contacts', () => {
    const toggled = toggleNoNcAt(twoRungs(), at('n1', 0, 0));
    expect(toggled.ok).toBe(true);
    if (!toggled.ok) return;
    expect(cellAt(toggled.program.networks[0]!, 0, 0)).toMatchObject({ type: 'NC' });
  });

  it('cycles the differential and SET/RST forms', () => {
    let p = twoRungs();
    const step = (cursor: LadderCursor): string => {
      const result = togglePulseAt(p, cursor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      p = result.program;
      const cell = cellAt(p.networks[0]!, cursor.row, cursor.col);
      return 'type' in cell ? cell.type : cell.kind;
    };
    expect(step(at('n1', 0, 0))).toBe('P');
    expect(step(at('n1', 0, 0))).toBe('NO');
    expect(step(at('n1', 0, 2))).toBe('SET');
    expect(step(at('n1', 0, 2))).toBe('RST');
    expect(step(at('n1', 0, 2))).toBe('OUT');
  });

  it('says why nothing happens on a blank cell', () => {
    const result = toggleNoNcAt(twoRungs(), at('n1', 0, 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('接点');
  });
});

describe('ラダーの取り消し／やり直し（決定表#2）', () => {
  it('walks back and forward through the snapshots', () => {
    const first = twoRungs();
    const edited = applyLadderCell(first, at('n1', 0, 1), no(X(5)));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const history = pushLadder(emptyLadderHistory(), first);
    const back = undoLadder(history, edited.program);
    expect(back?.program).toBe(first);
    const forward = redoLadder(back!.history, first);
    expect(forward?.program).toBe(edited.program);
  });

  it('drops the oldest snapshot past the limit and clears the redo列', () => {
    let history = emptyLadderHistory();
    for (let i = 0; i < LADDER_HISTORY_LIMIT + 5; i += 1) history = pushLadder(history, twoRungs());
    expect(history.done).toHaveLength(LADDER_HISTORY_LIMIT);
    expect(history.undone).toEqual([]);
  });

  it('returns undefined when there is nothing to undo', () => {
    expect(undoLadder(emptyLadderHistory(), twoRungs())).toBeUndefined();
    expect(redoLadder(emptyLadderHistory(), twoRungs())).toBeUndefined();
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-model.test.ts
```

Expected: 失敗（`Failed to resolve import "../src/renderer/session/ladder.js"`）。

- [ ] **Step 3: `src/renderer/session/ladder.ts` を書く**

```ts
import {
  cellAt,
  clearCell,
  COIL_COL,
  empty,
  endNetwork,
  hline,
  insertRow,
  LadderError,
  nc,
  no,
  program as makeProgram,
  network,
  rst,
  set,
  setCell,
  setVerticalLink,
  type Cell,
  type LadderProgram,
  type Network,
} from '@ojt/ladder-core';
import type { ShortcutEntry, ShortcutTable } from '@ojt/plc-dialects';

/**
 * ラダー編集の純粋層。設計仕様 §10.3 / §10.6 / §10.7。
 *
 * React も three も `@ojt/plc-dialects` の実装（プロファイルの中身）も知らない。編集の実体は
 * `@ojt/ladder-core` の `edit.ts`（純粋関数）で、このファイルが持つのは**呼び出し順**と
 * 「キー入力 → 操作」の対応だけである。キーの文字列は1つも書かない（決定表#12）。
 */

/** ラダーの取り消しで遡れる手数の上限（盤の `HISTORY_LIMIT` と同じ）。§8.2 */
export const LADDER_HISTORY_LIMIT = 50;

/** セルカーソル。 */
export interface LadderCursor {
  networkId: string;
  row: number;
  col: number;
}

/** エディタのモード。§10.6（`F2` / `Shift+F2` / `F3`）。決定表#11 */
export type LadderEditorMode = 'write' | 'read' | 'monitor';

/** 取り消し／やり直しのスタック（`LadderProgram` のスナップショット）。決定表#2 */
export interface LadderHistory {
  done: LadderProgram[];
  undone: LadderProgram[];
}

/** 編集の結果（失敗は理由つき。`LadderError` の文言をそのまま返す）。 */
export type LadderEditResult =
  | { ok: true; program: LadderProgram }
  | { ok: false; message: string };

/** デバイス入力欄を開くセルの種別（`ShortcutEntry.action` と同じ語彙）。§10.6 */
export type PlaceKind =
  | 'contact-no'
  | 'contact-nc'
  | 'or-contact-no'
  | 'or-contact-nc'
  | 'coil'
  | 'hline'
  | 'vline';

/** キー入力から決まる操作。 */
export type LadderAction =
  | { type: 'none' }
  /** カーソルを相対移動する。 */
  | { type: 'move'; dRow: number; dCol: number }
  /** セルを置く（デバイスが要る種別はデバイス入力欄を開く）。 */
  | { type: 'place'; kind: PlaceKind }
  /** 罫線（`Ctrl+←↑↓→`）。 */
  | { type: 'ruleLine'; direction: 'left' | 'up' | 'down' | 'right' }
  | { type: 'toggleNoNc' }
  | { type: 'togglePulse' }
  | { type: 'convert' }
  | { type: 'setMode'; mode: LadderEditorMode }
  | { type: 'toggleInsert' }
  | { type: 'help' }
  /** カーソル位置のセルを編集する（デバイス入力欄を開く）。 */
  | { type: 'edit' }
  | { type: 'delete' }
  | { type: 'undo' }
  | { type: 'redo' }
  /** 表には載っているが Phase 3 では押せない項目（`enabled: false`）。 */
  | { type: 'disabled'; entry: ShortcutEntry }
  /** 読出し・モニタ中に編集操作を押した。 */
  | { type: 'readOnly' };

/** キー入力のうちこの層が見る部分（DOM の型に依存させない）。 */
export interface LadderKeyEvent {
  key?: string | undefined;
  ctrlKey?: boolean | undefined;
  shiftKey?: boolean | undefined;
  altKey?: boolean | undefined;
  metaKey?: boolean | undefined;
}

/** 矢印の記号 → `KeyboardEvent.key`。方言表（`Ctrl+←↑↓→`）の展開に使う。 */
const ARROW_KEYS: Readonly<Record<string, string>> = {
  '←': 'ArrowLeft',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '→': 'ArrowRight',
};

/** 矢印キー → 罫線の向き。 */
const ARROW_DIRECTION: Readonly<Record<string, 'left' | 'up' | 'down' | 'right'>> = {
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowRight: 'right',
};

/** 矢印キー → カーソルの相対移動。 */
const ARROW_MOVE: Readonly<Record<string, { dRow: number; dCol: number }>> = {
  ArrowLeft: { dRow: 0, dCol: -1 },
  ArrowRight: { dRow: 0, dCol: 1 },
  ArrowUp: { dRow: -1, dCol: 0 },
  ArrowDown: { dRow: 1, dCol: 0 },
};

/** `action` → 置くセルの種別。表に無い `action` は `undefined`（押しても何もしない）。 */
const PLACE_KINDS: Readonly<Record<string, PlaceKind>> = {
  'contact-no': 'contact-no',
  'contact-nc': 'contact-nc',
  'or-contact-no': 'or-contact-no',
  'or-contact-nc': 'or-contact-nc',
  coil: 'coil',
  hline: 'hline',
  vline: 'vline',
};

/** `action` → エディタのモード。`monitor-write` は Phase 3 では `monitor` と同じ（決定表#11）。 */
const MODE_ACTIONS: Readonly<Record<string, LadderEditorMode>> = {
  'write-mode': 'write',
  'read-mode': 'read',
  monitor: 'monitor',
  'monitor-write': 'monitor',
};

/** 押されたキーを、ショートカット表と同じ書式の文字列にする。 */
export function keyChord(event: LadderKeyEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey === true || event.metaKey === true) parts.push('Ctrl');
  if (event.shiftKey === true) parts.push('Shift');
  if (event.altKey === true) parts.push('Alt');
  parts.push(event.key ?? '');
  return parts.join('+');
}

/** `keys` の文字列を照合できる形の一覧に展開する（`Ctrl+←↑↓→` → 4件）。 */
function expandKeys(keys: string): string[] {
  const plus = keys.lastIndexOf('+');
  const prefix = plus < 0 ? '' : keys.slice(0, plus + 1);
  const tail = plus < 0 ? keys : keys.slice(plus + 1);
  const arrows = [...tail].filter((char) => ARROW_KEYS[char] !== undefined);
  if (arrows.length === 0) return [keys];
  return arrows.map((char) => `${prefix}${ARROW_KEYS[char] ?? char}`);
}

/** キー入力に対応するショートカット表の行を探す。決定表#12 */
export function matchShortcut(
  table: ShortcutTable,
  event: LadderKeyEvent,
): ShortcutEntry | undefined {
  const chord = keyChord(event);
  return table.find((entry) => expandKeys(entry.keys).includes(chord));
}

/** `ladderKeyToAction` が見る画面状態。 */
export interface LadderKeyState {
  cursor: LadderCursor;
  mode: LadderEditorMode;
}

/** 編集を伴う操作か（読出し・モニタ中に断るもの）。 */
function isEditing(action: LadderAction): boolean {
  return (
    action.type === 'place' ||
    action.type === 'ruleLine' ||
    action.type === 'toggleNoNc' ||
    action.type === 'togglePulse' ||
    action.type === 'edit' ||
    action.type === 'delete' ||
    action.type === 'undo' ||
    action.type === 'redo' ||
    action.type === 'toggleInsert'
  );
}

/** ショートカット表に無いキー（矢印・Tab・Enter・Delete・Ctrl+Z/Y）の扱い。 */
function builtinAction(event: LadderKeyEvent): LadderAction {
  const key = event.key ?? '';
  const ctrl = event.ctrlKey === true || event.metaKey === true;
  if (ctrl && (key === 'z' || key === 'Z')) {
    return event.shiftKey === true ? { type: 'redo' } : { type: 'undo' };
  }
  if (ctrl && (key === 'y' || key === 'Y')) return { type: 'redo' };
  if (ctrl) return { type: 'none' };
  const move = ARROW_MOVE[key];
  if (move !== undefined) return { type: 'move', ...move };
  if (key === 'Tab') return { type: 'move', dRow: 0, dCol: event.shiftKey === true ? -1 : 1 };
  if (key === 'Enter') return { type: 'edit' };
  if (key === 'Delete' || key === 'Backspace') return { type: 'delete' };
  return { type: 'none' };
}

/** キー入力 → 操作。§10.6 */
export function ladderKeyToAction(
  table: ShortcutTable,
  event: LadderKeyEvent,
  state: LadderKeyState,
): LadderAction {
  const entry = matchShortcut(table, event);
  let action: LadderAction;
  if (entry === undefined) {
    action = builtinAction(event);
  } else if (entry.enabled === false) {
    return { type: 'disabled', entry };
  } else {
    const place = PLACE_KINDS[entry.action];
    const mode = MODE_ACTIONS[entry.action];
    if (place !== undefined) action = { type: 'place', kind: place };
    else if (mode !== undefined) action = { type: 'setMode', mode };
    else if (entry.action === 'rule-line') {
      const direction = ARROW_DIRECTION[event.key ?? ''];
      action = direction === undefined ? { type: 'none' } : { type: 'ruleLine', direction };
    } else if (entry.action === 'toggle-no-nc') action = { type: 'toggleNoNc' };
    else if (entry.action === 'toggle-pulse') action = { type: 'togglePulse' };
    else if (entry.action === 'convert') action = { type: 'convert' };
    else if (entry.action === 'insert-toggle') action = { type: 'toggleInsert' };
    else if (entry.action === 'help') action = { type: 'help' };
    else if (entry.action === 'next-symbol') action = { type: 'move', dRow: 0, dCol: 1 };
    else action = { type: 'none' };
  }
  if (state.mode !== 'write' && isEditing(action)) return { type: 'readOnly' };
  return action;
}

/** ネットワークを引く（無ければ undefined）。 */
function findNetwork(program: LadderProgram, networkId: string): Network | undefined {
  return program.networks.find((net) => net.id === networkId);
}

/** カーソルを動かす。上下の端では隣のネットワークへ移る。 */
export function moveCursor(
  program: LadderProgram,
  cursor: LadderCursor,
  dRow: number,
  dCol: number,
): LadderCursor {
  const index = program.networks.findIndex((net) => net.id === cursor.networkId);
  const net = program.networks[index];
  if (net === undefined) return cursor;
  const col = Math.min(COIL_COL, Math.max(0, cursor.col + dCol));
  const row = cursor.row + dRow;
  if (row >= 0 && row < net.rows) return { networkId: net.id, row, col };
  const nextIndex = row < 0 ? index - 1 : index + 1;
  const next = program.networks[nextIndex];
  if (next === undefined) return { networkId: net.id, row: cursor.row, col };
  return { networkId: next.id, row: row < 0 ? next.rows - 1 : 0, col };
}

/** `LadderError` を投げさせずに文言へ畳む。 */
function guard(run: () => LadderProgram): LadderEditResult {
  try {
    return { ok: true, program: run() };
  } catch (error) {
    if (error instanceof LadderError) return { ok: false, message: error.message };
    throw error;
  }
}

/** セルを置く。 */
export function applyLadderCell(
  program: LadderProgram,
  cursor: LadderCursor,
  cell: Cell,
): LadderEditResult {
  return guard(() => setCell(program, cursor.networkId, cursor.row, cursor.col, cell));
}

/** セルを空にする。 */
export function clearLadderCell(program: LadderProgram, cursor: LadderCursor): LadderEditResult {
  return guard(() => clearCell(program, cursor.networkId, cursor.row, cursor.col));
}

/** 罫線を引く／消す（`Ctrl+↓` で下へ、`Ctrl+↑` で上の行から、左右は横線）。§10.3 */
export function applyRuleLine(
  program: LadderProgram,
  cursor: LadderCursor,
  direction: 'left' | 'up' | 'down' | 'right',
): LadderEditResult {
  if (direction === 'left' || direction === 'right') {
    const col = direction === 'right' ? cursor.col : cursor.col - 1;
    if (col < 0) return { ok: false, message: '左母線より左には横線を引けません' };
    return guard(() => setCell(program, cursor.networkId, cursor.row, col, hline()));
  }
  const row = direction === 'down' ? cursor.row : cursor.row - 1;
  if (row < 0) return { ok: false, message: '先頭行より上には縦線を引けません' };
  return guard(() => setVerticalLink(program, cursor.networkId, row, cursor.col, true));
}

/**
 * OR接点（並列分岐）を1行下に置く。§10.3
 *
 * 縦線（`vline`）はセルの**左辺**で下の行と繋ぐので、分岐の左側は「1つ左の列に縦線 ＋ 下の行の
 * 同じ列に横線」、右側は「1つ右の列に縦線」で閉じる（`runtime.ts` の `solve()` の規則）。
 * 0列目は左母線が全行を繋いでいるので左側の罫線が要らない。
 */
export function applyOrContact(
  program: LadderProgram,
  cursor: LadderCursor,
  cell: Cell,
): LadderEditResult {
  const net = findNetwork(program, cursor.networkId);
  if (net === undefined) return { ok: false, message: `ネットワークがありません: ${cursor.networkId}` };
  if (cursor.col + 1 > COIL_COL - 1) {
    return { ok: false, message: 'OR接点はコイル列の1つ手前より右には置けません' };
  }
  return guard(() => {
    let next = program;
    if (cursor.row + 1 >= net.rows) next = insertRow(next, net.id, cursor.row + 1);
    next = setCell(next, net.id, cursor.row + 1, cursor.col, cell);
    if (cursor.col > 0) {
      next = setVerticalLink(next, net.id, cursor.row, cursor.col - 1, true);
      const below = cellAt(findNetwork(next, net.id) ?? net, cursor.row + 1, cursor.col - 1);
      if (below.kind === 'empty') next = setCell(next, net.id, cursor.row + 1, cursor.col - 1, hline());
    }
    next = setVerticalLink(next, net.id, cursor.row, cursor.col + 1, true);
    return next;
  });
}

/** a接点 ⇄ b接点（`/`）。§10.6 */
export function toggleNoNcAt(program: LadderProgram, cursor: LadderCursor): LadderEditResult {
  const net = findNetwork(program, cursor.networkId);
  if (net === undefined) return { ok: false, message: `ネットワークがありません: ${cursor.networkId}` };
  return guard(() => {
    const cell = cellAt(net, cursor.row, cursor.col);
    if (cell.kind !== 'contact') throw new LadderError('接点の上でだけ切り換えられます');
    const flip: Record<string, Cell> = {
      NO: nc(cell.device),
      NC: no(cell.device),
      P: { kind: 'contact', type: 'F', device: cell.device },
      F: { kind: 'contact', type: 'P', device: cell.device },
    };
    return setCell(program, net.id, cursor.row, cursor.col, flip[cell.type] ?? cell);
  });
}

/** 微分接点 ⇄ 通常接点、OUT → SET → RST → OUT（`Alt+/`）。§10.6 */
export function togglePulseAt(program: LadderProgram, cursor: LadderCursor): LadderEditResult {
  const net = findNetwork(program, cursor.networkId);
  if (net === undefined) return { ok: false, message: `ネットワークがありません: ${cursor.networkId}` };
  return guard(() => {
    const cell = cellAt(net, cursor.row, cursor.col);
    if (cell.kind === 'contact') {
      const cycle: Record<string, Cell> = {
        NO: { kind: 'contact', type: 'P', device: cell.device },
        P: no(cell.device),
        NC: { kind: 'contact', type: 'F', device: cell.device },
        F: nc(cell.device),
      };
      return setCell(program, net.id, cursor.row, cursor.col, cycle[cell.type] ?? cell);
    }
    if (cell.kind === 'coil') {
      const cycle: Record<string, Cell> = {
        OUT: set(cell.device),
        SET: rst(cell.device),
        RST: { kind: 'coil', type: 'OUT', device: cell.device },
      };
      return setCell(program, net.id, cursor.row, cursor.col, cycle[cell.type] ?? cell);
    }
    throw new LadderError('接点またはコイルの上でだけ切り換えられます');
  });
}

/** 空のラダー（セッションの開始点）。決定表#14 */
export function initialLadder(): LadderProgram {
  return makeProgram(network('n1', [[empty()]]), endNetwork());
}

/** 次に作るネットワークのID（既存の最大番号＋1）。決定表#15 */
export function nextNetworkId(program: LadderProgram): string {
  let max = 0;
  for (const net of program.networks) {
    const matched = /^n(\d+)$/u.exec(net.id);
    const value = matched?.[1];
    if (value !== undefined) max = Math.max(max, Number(value));
  }
  return `n${max + 1}`;
}

/** 空の履歴。 */
export function emptyLadderHistory(): LadderHistory {
  return { done: [], undone: [] };
}

/** 編集の**前**の状態を積む（やり直し列は捨てる）。 */
export function pushLadder(history: LadderHistory, before: LadderProgram): LadderHistory {
  const done = [...history.done, before];
  return { done: done.slice(Math.max(0, done.length - LADDER_HISTORY_LIMIT)), undone: [] };
}

/** 1手戻す。 */
export function undoLadder(
  history: LadderHistory,
  current: LadderProgram,
): { history: LadderHistory; program: LadderProgram } | undefined {
  const previous = history.done[history.done.length - 1];
  if (previous === undefined) return undefined;
  return {
    history: { done: history.done.slice(0, -1), undone: [...history.undone, current] },
    program: previous,
  };
}

/** 1手やり直す。 */
export function redoLadder(
  history: LadderHistory,
  current: LadderProgram,
): { history: LadderHistory; program: LadderProgram } | undefined {
  const next = history.undone[history.undone.length - 1];
  if (next === undefined) return undefined;
  return {
    history: { done: [...history.done, current], undone: history.undone.slice(0, -1) },
    program: next,
  };
}
```

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-model.test.ts
pnpm --filter @ojt/desktop typecheck
```

Expected: `Tests  29 passed (29)`。

- [ ] **Step 5: コミットする**

```powershell
npx prettier --write "apps/desktop/src/renderer/session/ladder.ts" "apps/desktop/test/ladder-model.test.ts"
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"
git add apps/desktop/src/renderer/session/ladder.ts apps/desktop/test/ladder-model.test.ts
git commit -m "feat(desktop): add the pure ladder editing model"
```

---

## Task 2: ストアにモードDの状態を足す

**Files:**
- Modify: `apps/desktop/src/renderer/app/store-types.ts`
- Modify: `apps/desktop/src/renderer/app/store.ts`
- Create: `apps/desktop/src/renderer/session/plc-session.ts`
- Test: `apps/desktop/test/store-plc.test.ts`

モードDの画面が要る状態を1箇所に集める。**`openProblem()` の分岐**と**`resetSession()` / `restartSession()` / `abandonSession()` の後始末**が MERGE の要点である（Plan 2B Batch 1 レビュー B4 と同じ規則: 課題を離れるときはモード固有の状態を必ず手放す）。

| 追加する状態 | 型 | 意味 |
|---|---|---|
| `ladder` | `LadderProgram \| undefined` | 訓練者のラダー。モードD以外は `undefined` |
| `ladderComments` | `Record<string, string>` | デバイスコメント（キーは `deviceLabel()` の形）。§10.7 |
| `ladderHistory` | `LadderHistory` | ラダー専用の取り消しスタック（決定表#2） |
| `ladderCursor` | `LadderCursor` | セルカーソル |
| `ladderMode` | `LadderEditorMode` | `write` / `read` / `monitor`（決定表#11） |
| `ladderFocused` | `boolean` | エディタにフォーカスがあるか（決定表#3） |
| `ladderView` | `'ladder' \| 'split' \| 'board'` | 画面の分割（決定表#10） |
| `dialectId` | `DialectId` | いま使っている方言（Phase 3 は常に `'mitsubishi'`） |
| `converted` | `boolean` | 最後の編集のあと「変換」を通したか（H-1） |
| `convertIssues` | `ConvertIssues` | 出力ウィンドウに並べるもの（`errors` / `warnings` / `usage`） |
| `plcMonitor` | `PlcMonitorSnapshot \| undefined` | モニタ中の通電状況（決定表#5） |
| `plcRunning` | `boolean` | RUN/STOP |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/store-plc.test.ts`:

```ts
import { BUILTIN_PLC_PROBLEMS, isPlcProblem } from '@ojt/content';
import { COIL_COL, no, out, X, Y } from '@ojt/ladder-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { applyLadderCell, initialLadder } from '../src/renderer/session/ladder.js';
import { plcBoardOf } from '../src/renderer/session/plc-session.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', problems: undefined });
});

describe('openProblem（モードD）', () => {
  it('opens a PLC problem with an empty ladder and the board that carries the PLC unit', () => {
    expect(isPlcProblem(problem)).toBe(true);
    expect(useStore.getState().openProblem(problem)).toBe(true);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.mode).toBe('wire');
    expect(state.wireColor).toBe('青');
    expect(state.session?.allowedColors).toEqual(['青']);
    expect(state.ladder?.networks.map((n) => n.id)).toEqual(['n1', 'end']);
    expect(state.ladderCursor).toEqual({ networkId: 'n1', row: 0, col: 0 });
    expect(state.ladderMode).toBe('write');
    expect(state.ladderView).toBe('split');
    expect(state.dialectId).toBe('mitsubishi');
    expect(state.converted).toBe(false);
    expect(state.plcRunning).toBe(false);
    expect(state.schematicVisible).toBe(false);
  });

  it('never seeds the trainee ladder from referenceLadder (決定表#14)', () => {
    useStore.getState().openProblem(problem);
    const ladder = useStore.getState().ladder;
    expect(ladder).toBeDefined();
    const cells = ladder!.networks.flatMap((net) => net.cells.flat());
    expect(cells.filter((c) => c.kind === 'contact')).toHaveLength(0);
    expect(cells.filter((c) => c.kind === 'coil')).toHaveLength(0);
  });

  it('derives the board with the PLC unit and the wall outlet', () => {
    useStore.getState().openProblem(problem);
    const board = plcBoardOf(useStore.getState().problem!);
    expect(board?.plcUnit?.model).toBe('FX5U');
    expect(board?.terminals.some((t) => t.id === 'PLC.X0')).toBe(true);
    expect(board?.terminals.some((t) => t.id === 'OUTLET.L')).toBe(true);
    expect(board?.id).toBe('board-jipm-std');
  });
});

describe('ラダーの編集と履歴', () => {
  beforeEach(() => {
    useStore.getState().openProblem(problem);
  });

  it('records the previous program and clears the converted flag', () => {
    const store = useStore.getState();
    store.setConverted(true, { errors: [], warnings: [], usage: undefined });
    const before = useStore.getState().ladder!;
    const edited = applyLadderCell(before, { networkId: 'n1', row: 0, col: 0 }, no(X(0)));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    store.setLadder(edited.program);
    const state = useStore.getState();
    expect(state.ladderHistory.done).toEqual([before]);
    expect(state.converted).toBe(false);
    expect(state.convertIssues.errors).toEqual([]);
  });

  it('undoes and redoes through the ladder stack only', () => {
    const store = useStore.getState();
    const before = useStore.getState().ladder!;
    const edited = applyLadderCell(before, { networkId: 'n1', row: 0, col: COIL_COL }, out(Y(0)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    expect(useStore.getState().undoLadderEdit()).toBe(true);
    expect(useStore.getState().ladder).toBe(before);
    // 盤の履歴は動かない
    expect(useStore.getState().history.done).toEqual([]);
    expect(useStore.getState().redoLadderEdit()).toBe(true);
    expect(useStore.getState().ladder).toBe(edited.program);
    expect(useStore.getState().redoLadderEdit()).toBe(false);
  });

  it('keeps device comments inside the caps (§10.7)', () => {
    const store = useStore.getState();
    store.setDeviceComment('X0', '運転押ボタン');
    expect(useStore.getState().ladderComments['X0']).toBe('運転押ボタン');
    store.setDeviceComment('X0', '');
    expect(useStore.getState().ladderComments['X0']).toBeUndefined();
    store.setDeviceComment('Y0', 'あ'.repeat(40));
    expect(useStore.getState().ladderComments['Y0']).toHaveLength(32);
  });
});

describe('モードDの状態を持ち越さない（Plan 2B Batch 1 B4 と同じ規則）', () => {
  it('drops the ladder when the session is abandoned', () => {
    useStore.getState().openProblem(problem);
    useStore.getState().setPlcRunning(true);
    useStore.getState().abandonSession();
    const state = useStore.getState();
    expect(state.ladder).toBeUndefined();
    expect(state.ladderHistory.done).toEqual([]);
    expect(state.plcMonitor).toBeUndefined();
    expect(state.plcRunning).toBe(false);
    expect(state.converted).toBe(false);
  });

  it('starts a retry from an empty ladder again', () => {
    useStore.getState().openProblem(problem);
    const seeded = applyLadderCell(useStore.getState().ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(1)));
    if (!seeded.ok) throw new Error(seeded.message);
    useStore.getState().setLadder(seeded.program);
    useStore.getState().resetSession();
    expect(useStore.getState().ladder).toEqual(initialLadder());
    expect(useStore.getState().ladderHistory.done).toEqual([]);
  });

  it('bumps the session epoch on a retry so the worker reloads', () => {
    useStore.getState().openProblem(problem);
    const epoch = useStore.getState().sessionEpoch;
    useStore.getState().resetSession();
    expect(useStore.getState().sessionEpoch).toBe(epoch + 1);
  });
});

describe('画面の分割とフォーカス（決定表#3 / #10）', () => {
  it('switches the split view', () => {
    useStore.getState().openProblem(problem);
    useStore.getState().setLadderView('board');
    expect(useStore.getState().ladderView).toBe('board');
  });

  it('remembers which pane has the keyboard', () => {
    useStore.getState().openProblem(problem);
    useStore.getState().setLadderFocused(true);
    expect(useStore.getState().ladderFocused).toBe(true);
    useStore.getState().setLadderFocused(false);
    expect(useStore.getState().ladderFocused).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/store-plc.test.ts
```

Expected: 失敗（`plc-session.js` が無い、`setLadder` が無い）。

- [ ] **Step 3: `src/renderer/session/plc-session.ts` を書く**

```ts
import { JIPM_BOARD, type BoardDefinition } from '@ojt/board-model';
import { isPlcProblem, plcBoardFor, resolvePlcIo, type ResolvedPlcIo, type SupportedProblem } from '@ojt/content';

/**
 * モードD専用の小さな純関数。設計仕様 §7.6 / §10.1。
 * 「この課題の盤（PLC本体つき）」と「この課題のI/O割付」を、画面のどこからでも同じ形で引けるようにする。
 */

/**
 * 課題が使う盤。モードDは**必ず `withPlcUnit()` 済みの派生盤**を使う（3A 引渡し表）。
 * モードD以外・未対応機種は `undefined`。
 */
export function plcBoardOf(problem: SupportedProblem): BoardDefinition | undefined {
  if (!isPlcProblem(problem)) return undefined;
  return plcBoardFor(problem, JIPM_BOARD);
}

/**
 * 画面が使う盤。モードDなら派生盤、それ以外は素の `JIPM_BOARD`。
 * 3Dシーン・経路生成・`addWire()` はすべてこの1本から盤を取る（Task 10 / 11）。
 */
export function boardForProblem(problem: SupportedProblem | undefined): BoardDefinition {
  if (problem === undefined) return JIPM_BOARD;
  return plcBoardOf(problem) ?? JIPM_BOARD;
}

/** 課題のI/O割付（既定割付の穴埋め済み）。モードD以外は `undefined`。§7.6 */
export function plcIoOf(problem: SupportedProblem | undefined): ResolvedPlcIo | undefined {
  if (problem === undefined || !isPlcProblem(problem)) return undefined;
  return resolvePlcIo(problem.io);
}
```

- [ ] **Step 4: `store-types.ts` に値型を足す**

`CameraPreset` に `'plc'` を足し（決定表#6。Task 10 で `cameraPose()` が実装する）、モニタとコメントの値型を置く。**既存の型は消さない。**

```ts
/**
 * 視点プリセット。§12.2
 * …（既存のコメント）…
 * `plc` は机上のPLC本体と壁コンセントを画角に収める視点で、**モードDだけ**ツールバーに出る
 * （テンキーとビューキューブの割当は変えない。決定表#6）。
 */
export type CameraPreset =
  | 'front'
  | 'top'
  | 'socket'
  | 'back'
  | 'left'
  | 'right'
  | 'bottom'
  | 'plc';

/**
 * モニタ（`F3`）の通電状況。§10.7 / 決定表#5
 *
 * `PlcSnapshot.poweredCells` の `Record<string, boolean>` をそのまま運ぶと、33ms ごとに
 * 千数百個の真偽値が新しいオブジェクトで届き、セレクタの比較も毎回その数だけ走る。
 * ネットワーク1本＝行を連ねた `'0110…'` の**文字列1本**に畳むと、比較も購読も文字列1本で済む。
 */
export interface PlcMonitorSnapshot {
  scanCount: number;
  tMs: number;
  /** ネットワークID → 「行 × 16列」を連ねた `'0'`/`'1'` の文字列。ENDネットワークは入らない。 */
  powered: Record<string, string>;
  inputs: boolean[];
  outputs: boolean[];
  internals: Record<number, boolean>;
  timers: Record<number, { elapsedMs: number; on: boolean }>;
  counters: Record<number, { value: number; on: boolean }>;
}

/** 出力ウィンドウに並べるもの。§10.6 */
export interface ConvertIssues {
  errors: ConvertErrorLine[];
  warnings: ConvertWarningLine[];
  /** 変換が通ったときの使用デバイス一覧（`CompiledProgram.usage`）。§10.8 */
  usage: { reads: string[]; writes: string[] } | undefined;
}

/** 出力ウィンドウの1行（`ConvertError` を画面の語彙に直したもの）。 */
export interface ConvertErrorLine {
  source: 'structure' | 'dialect';
  code: string;
  message: string;
  networkId?: string;
  row?: number;
  col?: number;
}

/** 変換警告の1行（二重コイル）。 */
export interface ConvertWarningLine {
  code: string;
  message: string;
  networkId: string;
  row: number;
  col: number;
}

/** 空の変換結果（課題を開いた直後・編集した直後）。 */
export const NO_CONVERT_ISSUES: ConvertIssues = { errors: [], warnings: [], usage: undefined };
```

> **注意:** `ConvertErrorLine` / `ConvertWarningLine` は `@ojt/plc-dialects` の `ConvertError` / `@ojt/ladder-core` の `CompileWarning` を**構造的に写した**型である。`store-types.ts` は「React にも three にも依存しない値型」を置く場所で、`Device` のようなライブラリの型を持ち込むとストアの値が構造化複製できるかどうかが読めなくなる（Worker と作業ファイルの両方を通る）。写すのは3〜6個のプリミティブだけなので、写像は Task 6 の `session/ladder-errors.ts` が1箇所で持つ。

- [ ] **Step 5: `store.ts` にモードDの状態を足す（**MERGE 注意 #2**）**

`store.ts` への追記は**次の5箇所だけ**である。

**(a) import の追加**（先頭のブロック）:

```ts
import { isPlcProblem, type SupportedProblem } from '@ojt/content';      // ← isPlcProblem を足す
import type { LadderProgram } from '@ojt/ladder-core';
import type { DialectId } from '@ojt/plc-dialects';
import {
  emptyLadderHistory,
  initialLadder,
  redoLadder,
  undoLadder,
  type LadderCursor,
  type LadderEditorMode,
  type LadderHistory,
} from '../session/ladder.js';
import {
  NO_CONVERT_ISSUES,
  type ConvertIssues,
  type PlcMonitorSnapshot,
} from './store-types.js';                                              // ← 既存の import に足す
```

**(b) 定数**（`HAZARD_BANNER_TTL_MS` の直後）:

```ts
/** デバイスコメント1件の長さの上限（`@ojt/content` の `MAX_DEVICE_COMMENT_LENGTH` と同じ値）。§10.7 */
export const DEVICE_COMMENT_LIMIT = 32;

/** デバイスコメントの件数の上限（`@ojt/content` の `MAX_DEVICE_COMMENTS` と同じ値）。§10.7 */
export const DEVICE_COMMENT_COUNT_LIMIT = 200;

/** 画面の分割。決定表#10 */
export type LadderViewMode = 'ladder' | 'split' | 'board';

/** モードDの判定結果も持てるようにする。§10.8 */
export type AnyJudgeResult = JudgeResult | JudgeInspectResult | JudgePlcResult;

/** 点検系（C1/C2）の判定結果か。§9.1 / §9.2 */
export function isInspectJudge(result: AnyJudgeResult): result is JudgeInspectResult {
  return result.mode === 'inspect-parts' || result.mode === 'inspect-repair';
}

/** モードDの判定結果か。§10.8 */
export function isPlcJudge(result: AnyJudgeResult): result is JudgePlcResult {
  return result.mode === 'plc';
}
```

> `isInspectJudge()` は **`mode !== 'assemble'` から明示の2値判定へ変える**。モードDが増えた以上「組立でなければ点検」は成り立たない（`Result.tsx` が C1/C2 の画面にモードDの結果を流し込んでしまう）。`JudgeResult` / `JudgeInspectResult` / `JudgePlcResult` の3つとも `mode` を持つ（Plan 2A I-3 ＋ 3A）ので、判別は安全である。

**(c) `AppState` のフィールド**（`highlight: HighlightSelection;` の直後）:

```ts
  /** 訓練者のラダー（モードDのみ）。§10.3 */
  ladder: LadderProgram | undefined;
  /** デバイスコメント（キーは `deviceLabel()` の形）。§10.7 */
  ladderComments: Record<string, string>;
  /** ラダー専用の取り消しスタック（盤の `history` とは別。決定表#2） */
  ladderHistory: LadderHistory;
  /** セルカーソル。§10.7 */
  ladderCursor: LadderCursor;
  /** 書込み／読出し／モニタ。§10.6 */
  ladderMode: LadderEditorMode;
  /** ラダーエディタにフォーカスがあるか（キーの宛先を決める。決定表#3） */
  ladderFocused: boolean;
  /** 画面の分割。決定表#10 */
  ladderView: LadderViewMode;
  /** いま使っている方言（Phase 3 は常に `mitsubishi`）。§10.5 */
  dialectId: DialectId;
  /** 最後の編集のあと「変換」を通したか。§10.6 / 3A H-1 */
  converted: boolean;
  /** 出力ウィンドウの中身。§10.6 */
  convertIssues: ConvertIssues;
  /** モニタ中の通電状況（モニタでないときは undefined）。決定表#5 */
  plcMonitor: PlcMonitorSnapshot | undefined;
  /** PLCが RUN 中か。§10.6 */
  plcRunning: boolean;
```

**(d) アクションの宣言**（`setHighlight` の直後）:

```ts
  /** ラダーを差し替える（前の状態を履歴に積み、変換済みフラグを落とす）。§10.6 */
  setLadder: (program: LadderProgram) => void;
  /** ラダーを履歴を積まずに差し替える（作業ファイルからの復元）。§12.3 */
  restoreLadder: (program: LadderProgram, comments?: Record<string, string>) => void;
  /** セルカーソルを動かす。 */
  setLadderCursor: (cursor: LadderCursor) => void;
  /** 書込み／読出し／モニタを切り替える。§10.6 */
  setLadderMode: (mode: LadderEditorMode) => void;
  /** ラダーエディタのフォーカス。決定表#3 */
  setLadderFocused: (focused: boolean) => void;
  /** 画面の分割。決定表#10 */
  setLadderView: (view: LadderViewMode) => void;
  /** デバイスコメントを1件入れる（空文字で削除、32文字で切り詰め、200件まで）。§10.7 */
  setDeviceComment: (device: string, text: string) => void;
  /** 「変換」の結果を入れる。§10.6 */
  setConverted: (converted: boolean, issues: ConvertIssues) => void;
  /** モニタのスナップショット。決定表#5 */
  setPlcMonitor: (monitor: PlcMonitorSnapshot | undefined) => void;
  /** RUN/STOP。§10.6 */
  setPlcRunning: (running: boolean) => void;
  /** ラダーを1手戻す（戻せたら true）。決定表#2 */
  undoLadderEdit: () => boolean;
  /** ラダーを1手やり直す（やり直せたら true）。決定表#2 */
  redoLadderEdit: () => boolean;
```

**(e) 実装**。初期値は既定値の並びへ、アクションは `setHighlight` の実装の直後へ入れる。そして **`openProblem()` / `resetSession()` / `restartSession()` / `abandonSession()` の `set()` に下の `plcFields()` を混ぜる**。

```ts
/** モードDの状態の初期値（課題を開く・離れるときに必ずここへ戻す）。 */
function plcFields(problem?: SupportedProblem): Pick<
  AppState,
  | 'ladder'
  | 'ladderComments'
  | 'ladderHistory'
  | 'ladderCursor'
  | 'ladderMode'
  | 'ladderFocused'
  | 'ladderView'
  | 'converted'
  | 'convertIssues'
  | 'plcMonitor'
  | 'plcRunning'
> {
  const isPlc = problem !== undefined && isPlcProblem(problem);
  return {
    // モードD以外では `undefined`（3Dだけの画面がラダーを持たない）
    ladder: isPlc ? initialLadder() : undefined,
    ladderComments: {},
    ladderHistory: emptyLadderHistory(),
    ladderCursor: { networkId: 'n1', row: 0, col: 0 },
    ladderMode: 'write',
    ladderFocused: false,
    ladderView: 'split',
    converted: false,
    convertIssues: NO_CONVERT_ISSUES,
    plcMonitor: undefined,
    plcRunning: false,
  };
}
```

初期値（`create<AppState>((set, get) => ({ … })` の中）:

```ts
  ...plcFields(),
  dialectId: 'mitsubishi',
```

`openProblem()` の `set({ … })` の中（`highlight: NO_HIGHLIGHT,` の直後）:

```ts
      ...plcFields(problem),
```

`resetSession()` は `openProblem()` を呼び直すので**追加の後始末は要らない**（`plcFields(problem)` が走る）。`restartSession()` と `abandonSession()` の `set({ … })` にはそれぞれ:

```ts
      ...plcFields(),
```

を足す（課題を離れる／作り直すので空に戻す。Plan 2B Task 4 Step 8 と同じ規則）。

アクションの実装:

```ts
  setLadder: (program) => {
    const current = get().ladder;
    set({
      ladder: program,
      // 編集したら変換済みではなくなる（H-1: 判定は変換を通ったものだけ）
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      ...(current === undefined ? {} : { ladderHistory: pushLadder(get().ladderHistory, current) }),
    });
  },
  restoreLadder: (program, comments) => {
    set({
      ladder: program,
      ladderHistory: emptyLadderHistory(),
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      ...(comments === undefined ? {} : { ladderComments: { ...comments } }),
    });
  },
  setLadderCursor: (ladderCursor) => {
    set({ ladderCursor });
  },
  setLadderMode: (ladderMode) => {
    set({ ladderMode });
  },
  setLadderFocused: (ladderFocused) => {
    set({ ladderFocused });
  },
  setLadderView: (ladderView) => {
    set({ ladderView });
  },
  setDeviceComment: (device, text) => {
    const comments = { ...get().ladderComments };
    const trimmed = text.trim();
    if (trimmed.length === 0) delete comments[device];
    else if (Object.hasOwn(comments, device) || Object.keys(comments).length < DEVICE_COMMENT_COUNT_LIMIT) {
      comments[device] = trimmed.slice(0, DEVICE_COMMENT_LIMIT);
    }
    set({ ladderComments: comments });
  },
  setConverted: (converted, convertIssues) => {
    set({ converted, convertIssues });
  },
  setPlcMonitor: (plcMonitor) => {
    set({ plcMonitor });
  },
  setPlcRunning: (plcRunning) => {
    set({ plcRunning });
  },
  undoLadderEdit: () => {
    const { ladder, ladderHistory } = get();
    if (ladder === undefined) return false;
    const step = undoLadder(ladderHistory, ladder);
    if (step === undefined) return false;
    set({
      ladder: step.program,
      ladderHistory: step.history,
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
    });
    return true;
  },
  redoLadderEdit: () => {
    const { ladder, ladderHistory } = get();
    if (ladder === undefined) return false;
    const step = redoLadder(ladderHistory, ladder);
    if (step === undefined) return false;
    set({
      ladder: step.program,
      ladderHistory: step.history,
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
    });
    return true;
  },
```

`pushLadder` を import に足すのを忘れないこと。

**(f) `sessionForProblem()` の盤**: モードDは `withPlcUnit()` 済みの盤でセッションを作る。

```ts
export function sessionForProblem(problem: SupportedProblem): BoardSession {
  // モードDは机上のPLC本体と壁コンセントを持つ派生盤で作る（3A 引渡し表）。`id` は同じなので
  // `boardId` の照合も作業ファイルの読み戻しもそのまま通る
  return createSession(boardForProblem(problem), {
    roles: toSocketRoles(problem.board.socketRoles),
    allowedColors: ['青'],
    extraParts: (problem.board.extraParts ?? []).map((name) => partId(name)),
    inventory: problem.inventory,
  });
}
```

`boardForProblem` は `../session/plc-session.js` から import する。**`createSession()` の第1引数を `JIPM_BOARD` から差し替えるだけ**で、モードB/C1/C2 では `boardForProblem()` が `JIPM_BOARD` を返すので挙動は変わらない。

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/store-plc.test.ts test/store.test.ts test/store-inspect.test.ts
pnpm --filter @ojt/desktop typecheck
```

Expected: `store-plc` が `Tests  11 passed (11)`。既存の `store.test.ts` / `store-inspect.test.ts` も通る（`isInspectJudge()` の判定を変えたので、モードB/C1/C2 の分岐が変わっていないことをここで確認する）。

- [ ] **Step 7: コミットする**

```powershell
npx prettier --write "apps/desktop/src/renderer/app/*.ts" "apps/desktop/src/renderer/session/plc-session.ts" "apps/desktop/test/store-plc.test.ts"
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"
git add apps/desktop/src/renderer/app apps/desktop/src/renderer/session/plc-session.ts apps/desktop/test/store-plc.test.ts
git commit -m "feat(desktop): widen the store to mode D (ladder, dialect, monitor)"
```

---

## Task 3: Worker プロトコルにモードDを載せる

**Files:**
- Modify: `apps/desktop/src/worker/protocol.ts`
- Modify: `apps/desktop/src/worker/sim.worker.ts`
- Test: `apps/desktop/test/sim-worker-plc.test.ts`

セッション中のスキャンと判定を Worker へ移す。**新しいコマンドは2本だけ**（`plc` と `judgePlc`）で、盤の読込は既存の `load` に `plcModel?` を足して済ませる（決定表#9）。

| 決めること | 本タスクの実装 |
|---|---|
| 盤 | `load` の `plcModel` があれば `withPlcUnit(JIPM_BOARD, plcUnitFor(model))` を `toNetlist()` に渡す。無ければ従来どおり `JIPM_BOARD` |
| ラダー | `plc { action: { kind:'load', program } }`。Worker は `compile()` して `createPlcCoupling()` を作る。**変換は renderer が済ませてから送る**（H-1）ので、ここで落ちたら `error`（`fatal: false`）を返して前のラダーを残す |
| スキャン | 追従ループの各 tick で `sim.step()` の**前**に `coupling.beforeTick(sim, tMs)` を呼ぶ。1 tick ＝ 1 スキャン（3A 決定表#4） |
| RUN/STOP | `plc { action: { kind:'run', on } }`。`on: false` で `runtime.reset()`（出力が落ちてY接点が開く。3A 引渡し表）＋ `sim.step()` を1回 |
| モニタ | `plc { action: { kind:'monitor', on } }`。`on` のときだけスナップショットに `plc` を載せる（決定表#5） |
| 判定 | `judgePlc`。`judgeRepair` と同じく**追従ループを止めて**から実行し、`finally` で再開する（H-4） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/sim-worker-plc.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import type { BoardSession } from '@ojt/board-model';
import {
  BUILTIN_PLC_PROBLEMS,
  buildPlcReferenceSession,
  isPlcProblem,
  type PlcProblem,
} from '@ojt/content';
import {
  COIL_COL,
  empty,
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
  type LadderProgram,
} from '@ojt/ladder-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand, SimMessage, SimSnapshot } from '../src/worker/protocol.js';

/**
 * モードDの Worker 連携（§10.4 / §10.8 / 3A 引渡し注記 H-2・H-4）。
 * 偽の `self` を置いてモジュールとして動かす流儀は `sim-worker.test.ts` と同じ。
 */

const clock = vi.hoisted(() => ({ nowMs: 0 }));
vi.setConfig({ testTimeout: 20_000 });

const D001 = BUILTIN_PLC_PROBLEMS[0];

function plcProblem(): PlcProblem {
  if (D001 === undefined || !isPlcProblem(D001)) throw new Error('モードD課題がありません');
  return D001;
}

/** 模範配線の盤（PLC本体・コンセントへの配線を含む）。 */
function referenceSession(): BoardSession {
  const built = buildPlcReferenceSession(plcProblem(), JIPM_BOARD);
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join(' / '));
  return built.value.session;
}

/** 1行ぶんのセル（コイル列まで横線で詰める）。 */
function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** X0 で Y0 を出すだけのラダー。 */
function simpleLadder(): LadderProgram {
  return program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork());
}

interface Harness {
  posted: SimMessage[];
  snapshots: SimSnapshot[];
  errors: Array<Extract<SimMessage, { type: 'error' }>>;
  plcResults: Array<Extract<SimMessage, { type: 'plcResult' }>>;
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
  Object.defineProperty(globalThis, 'self', { value: fakeSelf, configurable: true, writable: true });
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
    get plcResults() {
      return posted.filter((m) => m.type === 'plcResult');
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

/** 盤を読み、ラダーを載せ、RUN にして通電まで済ませる。 */
async function running(ladder: LadderProgram = simpleLadder()): Promise<Harness> {
  const h = await boot();
  h.send({
    type: 'load',
    problemId: plcProblem().id,
    session: referenceSession(),
    plcModel: 'FX5U',
  });
  h.send({ type: 'plc', action: { kind: 'load', program: ladder } });
  h.send({ type: 'plc', action: { kind: 'run', on: true } });
  h.send({ type: 'breaker', on: true });
  h.send({ type: 'switch', on: true });
  h.advance(200);
  return h;
}

describe('モードDの盤とスキャン（§10.1 / §10.4）', () => {
  it('loads the derived board so PLC.* terminals exist', async () => {
    const h = await running();
    expect(h.errors).toEqual([]);
    expect(h.snapshots.at(-1)?.powered).toBe(true);
  });

  it('runs one scan per tick and drives the lamp through the relay (受入基準③の中身)', async () => {
    const h = await running();
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');
    h.send({ type: 'press', pbId: 'PB1' });
    // 入力は1スキャン遅れ、Y接点が閉じてから盤のリレーが動くまでさらに1tick（合計 20〜30ms）
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
    h.send({ type: 'release', pbId: 'PB1' });
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');
  });

  it('does not scan while the PLC is stopped', async () => {
    const h = await running();
    h.send({ type: 'plc', action: { kind: 'run', on: false } });
    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(300);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');
    // RUN に戻せば動く
    h.send({ type: 'plc', action: { kind: 'run', on: true } });
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
  });

  it('opens the Y contacts when the PLC stops（3A 引渡し表: reset() は writeOutputs も呼ぶ）', async () => {
    const h = await running();
    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
    h.send({ type: 'plc', action: { kind: 'run', on: false } });
    h.advance(100);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('off');
  });

  it('keeps the board when the ladder is replaced（tMs も信号ログも切れない。決定表#9）', async () => {
    const h = await running();
    h.advance(300);
    const before = h.snapshots.at(-1)?.tMs ?? 0;
    expect(before).toBeGreaterThan(0);
    h.send({ type: 'plc', action: { kind: 'load', program: simpleLadder() } });
    h.advance(100);
    expect(h.snapshots.at(-1)?.tMs).toBeGreaterThan(before);
  });

  it('reports a ladder that cannot be compiled without killing the loop (H-1 の保険)', async () => {
    const h = await running();
    h.send({
      type: 'plc',
      action: { kind: 'load', program: program(network('n1', [[empty()]])) },
    });
    h.advance(100);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.fatal).toBe(false);
    expect(h.errors[0]?.message).toContain('END');
    // 前のラダーはそのまま動き続ける
    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(200);
    expect(h.snapshots.at(-1)?.lamps['PL1']?.level).toBe('lit');
  });
});

describe('モニタのスナップショット（決定表#5）', () => {
  it('carries no PLC payload until monitoring starts', async () => {
    const h = await running();
    expect(h.snapshots.at(-1)?.plc).toBeUndefined();
    h.send({ type: 'plc', action: { kind: 'monitor', on: true } });
    h.advance(100);
    expect(h.snapshots.at(-1)?.plc).toBeDefined();
    h.send({ type: 'plc', action: { kind: 'monitor', on: false } });
    h.advance(100);
    expect(h.snapshots.at(-1)?.plc).toBeUndefined();
  });

  it('encodes the powered cells as one string per network', async () => {
    const h = await running();
    h.send({ type: 'plc', action: { kind: 'monitor', on: true } });
    h.advance(100);
    const before = h.snapshots.at(-1)?.plc;
    expect(before).toBeDefined();
    const row = before?.powered['n1'];
    expect(row).toHaveLength(IR_COLS); // 1行 × 16列
    // X0 が OFF なら接点の右側（列1以降）は通電していない
    expect(row?.[0]).toBe('1');
    expect(row?.[1]).toBe('0');
    expect(before?.powered['end']).toBeUndefined();

    h.send({ type: 'press', pbId: 'PB1' });
    h.advance(200);
    const after = h.snapshots.at(-1)?.plc;
    expect(after?.powered['n1']?.[COIL_COL]).toBe('1');
    expect(after?.outputs[0]).toBe(true);
    expect(after?.inputs[0]).toBe(true);
    expect(after?.scanCount).toBeGreaterThan(0);
  });
});

describe('モードDの判定（§10.8 / H-4）', () => {
  it('stops the catch-up loop while judging and posts the verdict', async () => {
    const h = await running();
    h.advance(200);
    const judgingFrom = h.snapshots.length;
    h.send({
      type: 'judgePlc',
      problem: plcProblem(),
      session: referenceSession(),
      ladder: plcProblem().referenceLadder,
      elapsedMs: 123_000,
    });
    expect(h.plcResults).toHaveLength(1);
    const result = h.plcResults[0]?.result;
    expect(result?.ok).toBe(true);
    if (result === undefined || !result.ok) return;
    expect(result.value.mode).toBe('plc');
    expect(result.value.passed).toBe(true);
    expect(result.value.elapsedMs).toBe(123_000);
    expect(result.value.ladderErrors).toEqual([]);
    // 判定のあともループは回り続ける
    h.advance(200);
    expect(h.snapshots.length).toBeGreaterThan(judgingFrom);
    expect(h.errors).toEqual([]);
  });

  it('fails a ladder that does not match the reference', async () => {
    const h = await running();
    const wrong = program(network('n1', [rung(no(X(1)), out(Y(0)))]), endNetwork());
    h.send({
      type: 'judgePlc',
      problem: plcProblem(),
      session: referenceSession(),
      ladder: wrong,
      elapsedMs: 0,
    });
    const result = h.plcResults[0]?.result;
    expect(result?.ok).toBe(true);
    if (result === undefined || !result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.mismatches.length).toBeGreaterThan(0);
  });

  it('carries the session hazards into the verdict', async () => {
    const h = await running();
    // 1端子に3本目を繋ぐ（`over-wires-per-terminal`。§5.6 #5）
    const session = referenceSession();
    const first = session.wires[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    h.send({
      type: 'addWire',
      wire: { id: 'extra', from: first.from, to: first.to, color: '青' },
    });
    h.send({
      type: 'addWire',
      wire: { id: 'extra2', from: first.from, to: first.to, color: '青' },
    });
    h.advance(100);
    h.send({
      type: 'judgePlc',
      problem: plcProblem(),
      session,
      ladder: plcProblem().referenceLadder,
      elapsedMs: 0,
    });
    const result = h.plcResults[0]?.result;
    if (result === undefined || !result.ok) return;
    expect(result.value.hazardCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/sim-worker-plc.test.ts
```

Expected: 型エラー（`plcModel` / `plc` / `judgePlc` が `SimCommand` に無い）で失敗する。

- [ ] **Step 3: `src/worker/protocol.ts` に足す（**MERGE 注意 #3**）**

import に足す:

```ts
import type { LadderProgram } from '@ojt/ladder-core';
import type { JudgePlcResult, PlcProblem } from '@ojt/content';   // 既存の content の import に混ぜる
import type { PlcMonitorSnapshot } from '../renderer/app/store-types.js';
```

> `store-types.ts` は React にも three にも依存しない値型だけを置く場所なので、Worker から読んでも依存は増えない（`SessionMode` を `shared/ipc.ts` から読んでいるのと同じ扱い）。

`load` の分岐に1行足し（**既存のコメントは残す**）、コマンドを2本足す:

```ts
  | {
      type: 'load';
      problemId: string;
      session: BoardSession;
      partFaults?: readonly FaultSpecData[];
      /**
       * モードDのPLC機種（`FX5U`）。§10.1
       * 渡されたときだけ `withPlcUnit()` 済みの派生盤からネットリストを作る。盤の `id` は
       * 変わらないので、`BoardSession` の照合も既存のコマンドもそのまま通る。
       */
      plcModel?: string;
    }
```

```ts
  /**
   * PLCの操作。§10.4 / §10.6
   *
   * テスター（`tester`）と同じく**1本のコマンド**にまとめる。ラダーの載せ替え・RUN/STOP・
   * モニタの開始停止・リセットはどれも「PLC本体に対する操作」で、種別ごとにコマンドを
   * 分けると片方だけ実装し忘れたときに静かにずれる。
   */
  | { type: 'plc'; action: PlcCommandAction }
  /**
   * モードDを判定する。§10.8
   * `ladder` は**変換を通った**ラダー（H-1）。`judgePlc()` は模範と訓練者の2回ぶんを
   * 10ms tick で最後まで回すので 0.3〜1 秒かかる（H-4）。`judgeRepair` と同じく
   * 追従ループを止めてから実行する。
   */
  | {
      type: 'judgePlc';
      problem: PlcProblem;
      session: BoardSession;
      ladder: LadderProgram;
      elapsedMs: number;
    };

/** `plc` コマンドの中身。 */
export type PlcCommandAction =
  /** 変換済みのラダーを載せる（`compile()` は Worker 側で行う）。 */
  | { kind: 'load'; program: LadderProgram }
  /** RUN/STOP。`false` で `runtime.reset()` を呼び、Y接点を開く。 */
  | { kind: 'run'; on: boolean }
  /** モニタ（`F3`）の開始・停止。`true` の間だけスナップショットに `plc` が載る。 */
  | { kind: 'monitor'; on: boolean }
  /** デバイスを初期化する（RUN は保ったまま）。 */
  | { kind: 'reset' };
```

`SimSnapshot` に1つ足す:

```ts
  /**
   * モニタ中のPLCの状態。§10.7 / 決定表#5
   * **モニタしていないときは `undefined`**（毎フレームの構造化複製と比較を避ける）。
   */
  plc?: PlcMonitorSnapshot;
```

メッセージを1つ足す:

```ts
/** モードDの判定結果。§10.8 / §13 #2 */
export type PlcOutcome =
  | { ok: true; value: JudgePlcResult }
  | { ok: false; errors: ProblemIssue[] };
```

```ts
  | { type: 'plcResult'; result: PlcOutcome }
```

- [ ] **Step 4: `src/worker/sim.worker.ts` を書き換える（**MERGE 注意 #4**）**

追記は**次の6箇所だけ**である。

**(a) import**:

```ts
import {
  JIPM_BOARD,
  plcUnitFor,
  socketPartId,
  toNetlist,
  withPlcUnit,
  type BoardDefinition,
  type BoardSession,
  type SocketId,
} from '@ojt/board-model';
import {
  createPlcCoupling,
  injectPartFaults,
  judgeAssemble,
  judgeInspectParts,
  judgeInspectRepair,
  judgePlc,
  type FaultSpecData,
  type PlcCoupling,
} from '@ojt/content';
import { compile, IR_COLS, type LadderProgram } from '@ojt/ladder-core';
import type { PlcMonitorSnapshot } from '../renderer/app/store-types.js';
```

**(b) モジュール変数**（`let tester: TesterState = …` の直後）:

```ts
/** いま読んでいる盤（モードDは `withPlcUnit()` 済みの派生盤）。§10.1 */
let board: BoardDefinition = JIPM_BOARD;
/** スキャンとtickの結合（モードDでラダーを載せている間だけ存在する）。§10.4 */
let plcCoupling: PlcCoupling | undefined;
/** PLCが RUN 中か。STOP の間はスキャンを回さない。§10.6 */
let plcRunning = false;
/** モニタ（`F3`）中か。true の間だけスナップショットに `plc` を載せる。決定表#5 */
let plcMonitoring = false;
```

**(c) `load()` の差し替え**（Plan 2B Task 3 で足したプローブ解除の3行を**消さずに**新しい `load()` の中へ持っていく。MERGE 注意 #4）:

```ts
function load(
  next: BoardSession,
  partFaults: readonly FaultSpecData[] = [],
  plcModel?: string,
): void {
  session = next;
  /*
   * モードDは机上のPLC本体と壁コンセントを持つ派生盤で解く（§10.1）。`withPlcUnit()` は
   * `id` を変えないので、`BoardSession.boardId` の照合も既存の差分コマンドもそのまま通る。
   * 未対応の機種はここで断る（renderer は課題の `plc.model` をそのまま送ってくる）。
   */
  if (plcModel === undefined) {
    board = JIPM_BOARD;
  } else {
    const unit = plcUnitFor(plcModel);
    if (unit === undefined) throw new Error(`未対応のPLC機種です: ${plcModel}`);
    board = withPlcUnit(JIPM_BOARD, unit);
  }
  const netlist = toNetlist(next, board);
  const issues = injectPartFaults(netlist, partFaults);
  if (issues.length > 0) {
    throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join(' / '));
  }
  carriedHazards =
    simulation === undefined ? [] : [...carriedHazards, ...simulation.events.hazards()];
  simulation = new Simulation(netlist, { tickMs: TICK_MS });
  logCursor = 0;
  hazardCursor = 0;
  chatterCursor = 0;
  // 盤を作り直したらラダーの結合も捨てる（新しい `Simulation` を指していないため）。§10.4
  plcCoupling = undefined;
  plcRunning = false;
  plcMonitoring = false;
  /* …（Plan 2B のプローブ解除・テスター再測の5行はそのまま）… */
}
```

`handle()` の `load` 分岐も1行変える:

```ts
  if (command.type === 'load') {
    load(command.session, command.partFaults ?? [], command.plcModel);
    start();
    return;
  }
```

**(d) ラダーの載せ替えとスナップショットの畳み込み**（`testerSnapshot()` の直後）:

```ts
/**
 * ラダーを載せる。§10.4
 * 変換は renderer が済ませてから送ってくる（H-1）が、保険としてここでも `compile()` を通し、
 * 落ちたら**前のラダーを残したまま**理由だけ返す（ループは回り続けるので `fatal: false`）。
 */
function loadLadder(sim: Simulation, source: LadderProgram): void {
  const compiled = compile(source);
  if (!compiled.ok) {
    throw new Error(compiled.errors.map((e) => e.message).join(' / '));
  }
  plcCoupling = createPlcCoupling(sim, compiled.program);
}

/**
 * モニタのスナップショット。決定表#5
 * `poweredCells` の `Record<string, boolean>`（最大1,536件）を、ネットワーク1本＝
 * 「行 × 16列」を連ねた `'0110…'` の**文字列1本**へ畳む。renderer はこの文字列を
 * ネットワーク単位で購読するので、比較も再描画の判定も文字列1本で済む。
 */
function plcSnapshot(coupling: PlcCoupling): PlcMonitorSnapshot {
  const state = coupling.runtime.state();
  const powered: Record<string, string> = {};
  for (const net of coupling.runtime.program.networks) {
    if (net.isEnd) continue;
    let bits = '';
    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < IR_COLS; col += 1) {
        bits += state.poweredCells[`${net.id}:${row}:${col}`] === true ? '1' : '0';
      }
    }
    powered[net.id] = bits;
  }
  return {
    scanCount: state.scanCount,
    tMs: state.tMs,
    powered,
    inputs: [...state.inputs],
    outputs: [...state.outputs],
    internals: { ...state.internals },
    timers: Object.fromEntries(
      Object.entries(state.timers).map(([index, value]) => [index, { ...value }]),
    ),
    counters: Object.fromEntries(
      Object.entries(state.counters).map(([index, value]) => [index, { ...value }]),
    ),
  };
}
```

**(e) `buildSnapshot()` の末尾に1項目**:

```ts
    tester: testerSnapshot(),
    // モニタ中だけ載せる（決定表#5）
    ...(plcMonitoring && plcCoupling !== undefined ? { plc: plcSnapshot(plcCoupling) } : {}),
    droppedTicks,
```

**(f) 追従ループの1tick**（`for (let i = 0; i < plan.ticks; i += 1) {` の**直後の行**）:

```ts
    for (let i = 0; i < plan.ticks; i += 1) {
      /*
       * 1 tick ＝ 1 スキャン（§10.4 / 3A 決定表#4）。順序は
       * 「①`runtime.scan()` が `sim.plcInputs()` で入力を読む（＝直前のtickの解）
       *  →②ネットワークを上から順に実行 →③`sim.setPlcOutputs()` でY接点を書く」
       * のあとに `sim.step()` が今tickの回路を解く。実機と同じく入力は1スキャンぶん遅れる。
       */
      if (plcRunning && plcCoupling !== undefined) plcCoupling.beforeTick(sim, sim.state().tMs);
      sim.step(TICK_MS);
      /* …（既存のテスター間引き処理はそのまま）… */
    }
```

**(g) `handle()` に分岐を2つ**（`case 'tester':` の直後）:

```ts
    case 'plc': {
      const action = command.action;
      if (action.kind === 'load') {
        loadLadder(sim, action.program);
        break;
      }
      if (action.kind === 'run') {
        plcRunning = action.on;
        if (!action.on) {
          /*
           * STOP はPLCのデバイスを初期化する。`runtime.reset()` は `io.writeOutputs()` も
           * 呼ぶので（3A 引渡し表）Y接点が開く。盤に反映するために1tick進める。
           */
          plcCoupling?.runtime.reset();
          sim.step(TICK_MS);
        }
        break;
      }
      if (action.kind === 'monitor') {
        plcMonitoring = action.on;
        break;
      }
      plcCoupling?.runtime.reset();
      sim.step(TICK_MS);
      break;
    }
    case 'judgePlc': {
      /*
       * 模範と訓練者の2回ぶんを最後まで回すので 0.3〜1 秒かかる（H-4）。判定中にループを
       * 回したままにすると `MAX_CATCHUP_TICKS`（200ms相当）の窓を超え、訓練者が何もして
       * いないのに「捨てた tick」が計上される。`judgeRepair` と同じ扱いにする。
       */
      stopLoop();
      try {
        const outcome = judgePlc(command.problem, JIPM_BOARD, command.session, command.ladder, {
          elapsedMs: command.elapsedMs,
          sessionHazards: [...carriedHazards, ...sim.events.hazards()],
        });
        post({
          type: 'plcResult',
          result: outcome.ok
            ? { ok: true, value: outcome.value }
            : { ok: false, errors: outcome.errors },
        });
      } finally {
        resumeLoop();
      }
      break;
    }
```

`case 'reset':` にも1行足す（デバイスも初期化する）:

```ts
    case 'reset':
      sim.reset();
      plcCoupling?.runtime.reset();
      logCursor = 0;
      /* …（以下そのまま）… */
```

> `judgePlc()` に渡すのは**素の `JIPM_BOARD`**である（3A 引渡し表: 「`board` は素の `JIPM_BOARD` を渡してよい（内部で `withPlcUnit` する）」）。Worker が持っている派生盤 `board` を渡しても同じ結果になるが、3A の署名が想定している呼び方に合わせておくと、機種が増えたときに `judgePlc()` 側の1箇所で切り替わる。

- [ ] **Step 5: `session/worker-bridge.ts` に受け口を足す**

```ts
  /**
   * モードDの判定結果。§10.8
   * モードB/C の画面は渡さないので任意にする（届いても何も起きない）。
   */
  onPlc?: (message: Extract<SimMessage, { type: 'plcResult' }>) => void;
```

`start()` の配送に1行:

```ts
      else if (message.type === 'plcResult') handlers.onPlc?.(message);
```

- [ ] **Step 6: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/sim-worker-plc.test.ts
pnpm --filter @ojt/desktop exec vitest run --no-file-parallelism
pnpm --filter @ojt/desktop typecheck
```

Expected: `sim-worker-plc` が `Tests  11 passed (11)`。既存の Worker テスト8本（`sim-worker*.test.ts`）もすべて通る（`load()` の差し替えで盤が `JIPM_BOARD` のままであることを確認する）。

- [ ] **Step 7: コミットする**

```powershell
npx prettier --write "apps/desktop/src/worker/*.ts" "apps/desktop/src/renderer/session/worker-bridge.ts" "apps/desktop/test/sim-worker-plc.test.ts"
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"
git add apps/desktop/src/worker apps/desktop/src/renderer/session/worker-bridge.ts apps/desktop/test/sim-worker-plc.test.ts
git commit -m "feat(desktop): run the PLC scan and the mode D judge inside the worker"
```

---

## Task 4: ラダーのセルグリッド（SVG）

**Files:**
- Create: `apps/desktop/src/renderer/ladder/symbols.ts`
- Create: `apps/desktop/src/renderer/ladder/LadderGrid.tsx`
- Create: `apps/desktop/src/renderer/ladder/ladder.module.css`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（**MERGE 注意 #1**）
- Test: `apps/desktop/test/ladder-symbols.test.ts`
- Test: `apps/desktop/test/ladder-grid.test.tsx`

決定表#1 のとおり **SVG 1枚**でセルグリッドを描く。記号の線画は `DialectProfile.symbols` の識別子から自前の `<path>` を引く（**ベンダーの画像・図記号ビットマップは持たない**。§17 / PLC調査資料 §6）。

| 決めること | 本タスクの実装 |
|---|---|
| セル寸法 | 48 × 36 px、桟（導線）は上下中央 `y = 18`。左母線は幅4pxの縦帯 |
| 表示列 | 接点列 `profile.gridCols`（三菱は11）＋**コイル列1**の計12列。IR の 11〜14 列目は**描かない**。そこに中身がある場合はネットワーク見出しに警告を出し、設定画面の「ラダーの表示列数」（§10.6。8〜15）で広げてもらう |
| 通電表示 | セルの左リードは `powered[networkId][row * IR_COLS + col]`、右リードは `…[col + 1]` の色。記号の本体は「右リードと同じ色」（＝導通している接点だけ光る）。色は `profile.monitorColors` |
| デバイス表示 | 記号の上に `profile.formatDevice(cell.device)`、下にデバイスコメント（`ladderComments`）。タイマ・カウンタは設定値（`profile.timerPreset()` の `text`。`Error` が返ったら ms をそのまま出す） |
| 変換エラー | `errorCells`（`Set<"net:row:col">`）に入っているセルを赤枠にする |
| カーソル | `cursor` のセルに青い枠（`aria-selected`）。クリックでも動く |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/ladder-symbols.test.ts`:

```ts
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import { CELL_H, CELL_W, symbolShape, WIRE_Y } from '../src/renderer/ladder/symbols.js';

describe('記号の線画（§10.6 / §17: ベンダーの画像は持たない）', () => {
  it('draws every symbol the Mitsubishi profile names', () => {
    for (const id of Object.values(MITSUBISHI_FX5U.symbols)) {
      const shape = symbolShape(id);
      expect(shape.paths.length).toBeGreaterThan(0);
    }
  });

  it('keeps the drawings local (no urls, no image references)', () => {
    for (const id of Object.values(MITSUBISHI_FX5U.symbols)) {
      for (const path of symbolShape(id).paths) {
        expect(path).not.toMatch(/https?:|url\(|\.png|\.svg/iu);
        expect(path).toMatch(/^[MLAmlazZ0-9\s,.-]+$/u);
      }
    }
  });

  it('falls back to a question mark for an unknown identifier', () => {
    const shape = symbolShape('contact-quantum');
    expect(shape.text).toBe('?');
    expect(shape.paths.length).toBeGreaterThan(0);
  });

  it('keeps the rung on the vertical middle of the cell', () => {
    expect(WIRE_Y).toBe(CELL_H / 2);
    expect(CELL_W).toBeGreaterThan(CELL_H);
  });
});
```

`apps/desktop/test/ladder-grid.test.tsx`:

```tsx
import {
  COIL_COL,
  endNetwork,
  hline,
  IR_COLS,
  nc,
  network,
  no,
  out,
  program,
  ton,
  T,
  X,
  Y,
  type LadderProgram,
} from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LadderGrid } from '../src/renderer/ladder/LadderGrid.js';

function sample(): LadderProgram {
  return program(
    network('n1', [[no(X(0)), hline(), ...Array.from({ length: 13 }, () => hline()), out(Y(0))]], {
      comment: '運転',
    }),
    network('n2', [[nc(X(1)), ton(T(0), 3000)]]),
    endNetwork(),
  );
}

/** 1ネットワークぶんの通電文字列（全セル非通電）。 */
function offBits(rows: number): string {
  return '0'.repeat(rows * IR_COLS);
}

const base = {
  profile: MITSUBISHI_FX5U,
  cursor: { networkId: 'n1', row: 0, col: 0 },
  mode: 'write' as const,
  powered: undefined,
  comments: {},
  errorCells: new Set<string>(),
  gridCols: MITSUBISHI_FX5U.gridCols,
  onPickCell: () => undefined,
};

describe('LadderGrid（§10.7）', () => {
  it('draws every network with its id, comment and END', () => {
    render(<LadderGrid program={sample()} {...base} />);
    expect(screen.getByTestId('network-n1')).toHaveTextContent('n1');
    expect(screen.getByTestId('network-n1')).toHaveTextContent('運転');
    expect(screen.getByTestId('network-end')).toBeInTheDocument();
    expect(screen.getByTestId('cell-end:0:0')).toBeInTheDocument();
  });

  it('shows the contact columns of the skin plus one coil column (§10.6)', () => {
    render(<LadderGrid program={sample()} {...base} />);
    expect(screen.getByTestId(`cell-n1:0:${String(MITSUBISHI_FX5U.gridCols - 1)}`)).toBeInTheDocument();
    // 表示しない中間列（11〜14）は描かない
    expect(screen.queryByTestId(`cell-n1:0:${String(MITSUBISHI_FX5U.gridCols)}`)).toBeNull();
    // コイル列は必ず最後に出る
    expect(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toBeInTheDocument();
  });

  it('warns when a cell sits in a column the skin does not show', () => {
    const wide = program(
      network('n1', [
        [no(X(0)), ...Array.from({ length: 11 }, () => hline()), no(X(1)), hline(), hline(), out(Y(0))],
      ]),
      endNetwork(),
    );
    render(<LadderGrid program={wide} {...base} />);
    expect(screen.getByTestId('hidden-cells-n1')).toHaveTextContent('表示列数');
  });

  it('writes the dialect device name and the preset', () => {
    render(<LadderGrid program={sample()} {...base} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveTextContent('X0');
    expect(screen.getByTestId(`cell-n2:0:${String(COIL_COL)}`)).toHaveTextContent('T0');
    // 三菱の T0 帯は 100ms 単位なので 3000ms は K30
    expect(screen.getByTestId(`cell-n2:0:${String(COIL_COL)}`)).toHaveTextContent('K30');
  });

  it('writes the device comment under the symbol (§10.7)', () => {
    render(<LadderGrid program={sample()} {...base} comments={{ X0: '運転押ボタン' }} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveTextContent('運転押ボタン');
  });

  it('marks the cursor cell and moves it on click', () => {
    const onPickCell = vi.fn();
    render(<LadderGrid program={sample()} {...base} onPickCell={onPickCell} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByTestId('cell-n1:0:1'));
    expect(onPickCell).toHaveBeenCalledWith({ networkId: 'n1', row: 0, col: 1 });
  });

  it('outlines the cells a conversion error points at', () => {
    render(<LadderGrid program={sample()} {...base} errorCells={new Set(['n1:0:0'])} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-error', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('data-error', 'false');
  });

  it('paints the energised leads while monitoring (決定表#5)', () => {
    const bits = offBits(1).split('');
    bits[0] = '1'; // X0 の左（左母線）は常に通電
    bits[1] = '1'; // X0 が閉じているので右も通電
    render(
      <LadderGrid
        program={sample()}
        {...base}
        mode="monitor"
        powered={{ n1: bits.join(''), n2: offBits(1) }}
      />,
    );
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n2:0:0')).toHaveAttribute('data-powered', 'false');
  });

  it('never paints an empty cell even though column 0 reports powered (3A レビュー指摘)', () => {
    const blank = program(network('n1', [[no(X(0))]]), endNetwork());
    // すべてのセルが通電しているという最悪の入力を渡す
    render(
      <LadderGrid
        program={blank}
        {...base}
        mode="monitor"
        powered={{ n1: '1'.repeat(IR_COLS) }}
      />,
    );
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('data-powered', 'false');
    expect(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toHaveAttribute(
      'data-powered',
      'false',
    );
  });

  it('does not paint anything while not monitoring', () => {
    render(<LadderGrid program={sample()} {...base} powered={{ n1: '1'.repeat(IR_COLS) }} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'false');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-symbols.test.ts test/ladder-grid.test.tsx
```

Expected: 解決できない import で失敗。

- [ ] **Step 3: `src/renderer/ladder/symbols.ts` を書く**

```ts
/**
 * ラダー記号の線画。設計仕様 §10.6 / §17。
 *
 * `DialectProfile.symbols` が持つのは**識別子だけ**（`'contact-no'` など）で、実際の絵はここが
 * 自前の SVG パスとして持つ。**各社のロゴ・アイコン・画面キャプチャ・図記号ビットマップは
 * 一切複製しない**（§17 / PLC調査資料 §6）。JIS C 0617 のシーケンス図記号に沿った、
 * 直線と円弧だけの一般的な描き方である。
 */

/** セル1つの幅[px]。 */
export const CELL_W = 48;
/** セル1つの高さ[px]。 */
export const CELL_H = 36;
/** 桟（導線）の縦位置[px]。 */
export const WIRE_Y = CELL_H / 2;
/** 記号の左端・右端[px]（左右はリード線）。 */
const LEFT = 15;
const RIGHT = 33;
/** 接点の縦棒の上端・下端[px]。 */
const TOP = 8;
const BOTTOM = 28;

/** 記号1つの線画。 */
export interface SymbolShape {
  /** `<path d>` にそのまま入る文字列。 */
  paths: readonly string[];
  /** 記号の中に描く1文字（`S` / `R` / `T` / `C` / `↑` / `↓`）。 */
  text?: string;
}

/** 接点の2本の縦棒。 */
const CONTACT_BARS = [
  `M ${LEFT} ${TOP} L ${LEFT} ${BOTTOM}`,
  `M ${RIGHT} ${TOP} L ${RIGHT} ${BOTTOM}`,
];

/** コイルの丸括弧（左右の半円）。 */
const COIL_ARCS = [
  `M ${LEFT + 2} ${TOP} A 9 10 0 0 0 ${LEFT + 2} ${BOTTOM}`,
  `M ${RIGHT - 2} ${TOP} A 9 10 0 0 1 ${RIGHT - 2} ${BOTTOM}`,
];

/** 識別子 → 線画。`DialectProfile.symbols` の値をキーにする。 */
const SHAPES: Readonly<Record<string, SymbolShape>> = {
  'contact-no': { paths: CONTACT_BARS },
  'contact-nc': { paths: [...CONTACT_BARS, `M ${LEFT} ${BOTTOM} L ${RIGHT} ${TOP}`] },
  'contact-rise': { paths: CONTACT_BARS, text: '↑' },
  'contact-fall': { paths: CONTACT_BARS, text: '↓' },
  'coil-round': { paths: COIL_ARCS },
  'coil-set': { paths: COIL_ARCS, text: 'S' },
  'coil-reset': { paths: COIL_ARCS, text: 'R' },
  'coil-timer': { paths: COIL_ARCS, text: 'T' },
  'coil-counter': { paths: COIL_ARCS, text: 'C' },
};

/** 未知の識別子（Phase 4 で足された記号など）に出す暫定の絵。 */
const UNKNOWN: SymbolShape = { paths: CONTACT_BARS, text: '?' };

/** 識別子から線画を引く。知らない識別子は「?」付きの接点で描く。 */
export function symbolShape(id: string): SymbolShape {
  return SHAPES[id] ?? UNKNOWN;
}

/** 左のリード線（セルの左端から記号の左端まで）。 */
export const LEAD_LEFT = `M 0 ${WIRE_Y} L ${LEFT} ${WIRE_Y}`;
/** 右のリード線（記号の右端からセルの右端まで）。 */
export const LEAD_RIGHT = `M ${RIGHT} ${WIRE_Y} L ${CELL_W} ${WIRE_Y}`;
/** セルを丸ごと横断する導線（`hline` / `vline`）。 */
export const LEAD_FULL = `M 0 ${WIRE_Y} L ${CELL_W} ${WIRE_Y}`;
/** 縦線（セルの左辺で下の行と繋ぐ渡り）。§10.3 */
export const LINK_DOWN = `M 0 ${WIRE_Y} L 0 ${CELL_H}`;
/** END の記号（二重線）。 */
export const END_MARK = [`M 12 ${TOP} L 12 ${BOTTOM}`, `M 18 ${TOP} L 18 ${BOTTOM}`];
```

- [ ] **Step 4: `src/renderer/ladder/LadderGrid.tsx` を書く**

```tsx
import {
  cellAt,
  COIL_COL,
  deviceLabel,
  IR_COLS,
  type Cell,
  type LadderProgram,
  type Network,
} from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { memo, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { LadderCursor, LadderEditorMode } from '../session/ladder.js';
import {
  CELL_H,
  CELL_W,
  END_MARK,
  LEAD_FULL,
  LEAD_LEFT,
  LEAD_RIGHT,
  LINK_DOWN,
  symbolShape,
  WIRE_Y,
} from './symbols.js';
import styles from './ladder.module.css';

/**
 * ラダーのセルグリッド（SVG）。設計仕様 §10.3 / §10.6 / §10.7。決定表#1
 *
 * 表示するのは「スキンの接点列数（`profile.gridCols`）＋ コイル列1」だけで、IR の中間列
 * （11〜14）は描かない。そこに中身がある場合は見出しに警告を出し、設定画面の
 * 「ラダーの表示列数」で広げてもらう（§10.6 が 8〜15 の範囲で変更できると定めている）。
 *
 * この部品は**描くだけ**で、キー入力も編集も持たない（`LadderEditor` の役目）。
 */

/** 左母線の幅[px]。 */
const RAIL_W = 6;
/** ネットワーク見出しの高さ[px]。 */
const HEADER_H = 22;

/** 表示する列（IRの列番号）の並び。最後は必ずコイル列。 */
export function displayColumns(gridCols: number): number[] {
  const contacts = Math.min(Math.max(gridCols, 1), COIL_COL);
  return [...Array.from({ length: contacts }, (_unused, i) => i), COIL_COL];
}

/** 表示しない列に中身があるか（`empty` 以外が置かれているか）。 */
export function hasHiddenCells(net: Network, gridCols: number): boolean {
  for (let row = 0; row < net.rows; row += 1) {
    for (let col = gridCols; col < COIL_COL; col += 1) {
      if (cellAt(net, row, col).kind !== 'empty') return true;
    }
  }
  return false;
}

/** セルの見出し文字（デバイス名）と副文字（設定値）。 */
function cellText(cell: Cell, profile: DialectProfile): { top: string; bottom: string } {
  if (cell.kind === 'contact' || cell.kind === 'coil' || cell.kind === 'mc' || cell.kind === 'mcr') {
    return { top: profile.formatDevice(cell.device), bottom: '' };
  }
  if (cell.kind === 'timer') {
    const preset = profile.timerPreset(cell.presetMs, cell.device);
    return {
      top: profile.formatDevice(cell.device),
      bottom: preset instanceof Error ? `${String(cell.presetMs)}ms` : preset.text,
    };
  }
  if (cell.kind === 'counter') {
    return { top: profile.formatDevice(cell.device), bottom: `K${String(cell.preset)}` };
  }
  return { top: '', bottom: '' };
}

/** セルの記号（`SymbolDrawing` の識別子）。線画を持たないセルは `undefined`。 */
function symbolIdOf(cell: Cell, profile: DialectProfile): string | undefined {
  const symbols = profile.symbols;
  switch (cell.kind) {
    case 'contact':
      return cell.type === 'NO'
        ? symbols.no
        : cell.type === 'NC'
          ? symbols.nc
          : cell.type === 'P'
            ? symbols.rise
            : symbols.fall;
    case 'coil':
      return cell.type === 'OUT' ? symbols.coil : cell.type === 'SET' ? symbols.set : symbols.rst;
    case 'timer':
      return symbols.timer;
    case 'counter':
      return symbols.counter;
    default:
      return undefined;
  }
}

/** 1セルぶんの描画。 */
function GridCell({
  cell,
  cursorKey,
  cellKey,
  cell9,
  profile,
  comment,
  leftOn,
  rightOn,
  colors,
  error,
  hasLinkBelow,
  onPick,
}: {
  cell: Cell;
  cellKey: string;
  cursorKey: string;
  cell9: { row: number; col: number; networkId: string };
  profile: DialectProfile;
  comment: string | undefined;
  leftOn: boolean;
  rightOn: boolean;
  colors: { powered: string; idle: string };
  error: boolean;
  hasLinkBelow: boolean;
  onPick: (cursor: LadderCursor) => void;
}): JSX.Element {
  const selected = cellKey === cursorKey;
  const leftColor = leftOn ? colors.powered : colors.idle;
  const rightColor = rightOn ? colors.powered : colors.idle;
  const symbolId = symbolIdOf(cell, profile);
  const shape = symbolId === undefined ? undefined : symbolShape(symbolId);
  const text = cellText(cell, profile);
  const conducting = cell.kind === 'hline' || cell.kind === 'vline';
  return (
    <g
      data-testid={`cell-${cellKey}`}
      role="gridcell"
      aria-selected={selected}
      data-error={error}
      data-powered={leftOn}
      className={styles.cell}
      transform={`translate(${String(cell9.col * CELL_W)} ${String(cell9.row * CELL_H)})`}
      onClick={() => {
        onPick({ networkId: cell9.networkId, row: cell9.row, col: cell9.col });
      }}
    >
      {/* 当たり判定（透明の矩形。線だけだとクリックしづらい） */}
      <rect width={CELL_W} height={CELL_H} className={styles.cellHit} />
      {conducting ? (
        <path d={LEAD_FULL} stroke={leftColor} className={styles.wire} />
      ) : shape === undefined ? null : (
        <>
          <path d={LEAD_LEFT} stroke={leftColor} className={styles.wire} />
          <path d={LEAD_RIGHT} stroke={rightColor} className={styles.wire} />
        </>
      )}
      {cell.kind === 'vline' && hasLinkBelow ? (
        <path d={LINK_DOWN} stroke={leftColor} className={styles.wire} />
      ) : null}
      {cell.kind === 'end'
        ? END_MARK.map((d) => <path key={d} d={d} stroke={colors.idle} className={styles.wire} />)
        : null}
      {shape?.paths.map((d) => (
        <path key={d} d={d} stroke={rightColor} className={styles.symbol} />
      ))}
      {shape?.text === undefined ? null : (
        <text x={CELL_W / 2} y={WIRE_Y + 4} className={styles.symbolText}>
          {shape.text}
        </text>
      )}
      {text.top === '' ? null : (
        <text x={CELL_W / 2} y={9} className={styles.deviceText}>
          {text.top}
        </text>
      )}
      {text.bottom === '' ? null : (
        <text x={CELL_W / 2} y={CELL_H - 9} className={styles.presetText}>
          {text.bottom}
        </text>
      )}
      {comment === undefined ? null : (
        <text x={CELL_W / 2} y={CELL_H - 1} className={styles.commentText}>
          {comment}
        </text>
      )}
      {selected ? <rect width={CELL_W} height={CELL_H} className={styles.cursor} /> : null}
      {error ? <rect width={CELL_W} height={CELL_H} className={styles.errorCell} /> : null}
    </g>
  );
}

/** ラダーのセルグリッド。 */
function LadderGridImpl({
  program,
  profile,
  cursor,
  mode,
  powered,
  comments,
  errorCells,
  gridCols,
  onPickCell,
}: {
  program: LadderProgram;
  profile: DialectProfile;
  cursor: LadderCursor;
  mode: LadderEditorMode;
  /** ネットワークID → 「行 × 16列」を連ねた通電文字列。モニタ中だけ渡す。決定表#5 */
  powered: Record<string, string> | undefined;
  /** デバイスコメント（キーは `deviceLabel()` の形）。§10.7 */
  comments: Record<string, string>;
  /** 変換エラーが指すセル（`"net:row:col"`）。 */
  errorCells: ReadonlySet<string>;
  /** 表示する接点列数（設定で変えられる。§10.6） */
  gridCols: number;
  onPickCell: (cursor: LadderCursor) => void;
}): JSX.Element {
  const columns = displayColumns(gridCols);
  const width = RAIL_W + columns.length * CELL_W;
  const cursorKey = `${cursor.networkId}:${String(cursor.row)}:${String(cursor.col)}`;
  const monitoring = mode === 'monitor' && powered !== undefined;
  return (
    <div className={styles.gridScroll} data-testid="ladder-grid">
      {program.networks.map((net) => {
        const bits = monitoring ? (powered[net.id] ?? '') : '';
        const on = (row: number, col: number): boolean =>
          bits.charAt(row * IR_COLS + col) === '1';
        return (
          <section key={net.id} className={styles.network} data-testid={`network-${net.id}`}>
            <header className={styles.networkHeader}>
              <span className={styles.networkId}>{net.id}</span>
              {net.comment === undefined ? null : (
                <span className={styles.networkComment}>{net.comment}</span>
              )}
              {hasHiddenCells(net, gridCols) ? (
                <span className={styles.hiddenWarn} data-testid={`hidden-cells-${net.id}`}>
                  {JA.ladder.hiddenCells}
                </span>
              ) : null}
            </header>
            <svg
              className={styles.grid}
              width={width}
              height={net.rows * CELL_H}
              viewBox={`0 0 ${String(width)} ${String(net.rows * CELL_H)}`}
              role="grid"
              aria-label={`${JA.ladder.network} ${net.id}`}
            >
              {/* 左母線（全行を繋ぐ。§10.3） */}
              <rect
                width={RAIL_W}
                height={net.rows * CELL_H}
                className={styles.rail}
                data-testid={`rail-${net.id}`}
              />
              <g transform={`translate(${String(RAIL_W)} 0)`}>
                {Array.from({ length: net.rows }, (_unused, row) =>
                  columns.map((col, index) => {
                    const cell = cellAt(net, row, col);
                    const key = `${net.id}:${String(row)}:${String(col)}`;
                    const deviceComment =
                      'device' in cell ? comments[deviceLabel(cell.device)] : undefined;
                    return (
                      <GridCell
                        key={key}
                        cellKey={key}
                        cursorKey={cursorKey}
                        cell={cell}
                        cell9={{ networkId: net.id, row, col: index }}
                        profile={profile}
                        comment={deviceComment}
                        /*
                         * 空セルは塗らない。`poweredCells` は「どの行でも0列目は左母線と
                         * 繋がっている」ので真になり（3A `Rails` の構築）、何も書いていない
                         * 行の先頭まで青く光ってしまう。3A 側で `false` を返すよう直っても
                         * この判定はそのまま正しい。
                         */
                        leftOn={cell.kind !== 'empty' && on(row, col)}
                        rightOn={
                          cell.kind !== 'empty' &&
                          (col < COIL_COL ? on(row, col + 1) : on(row, col))
                        }
                        colors={profile.monitorColors}
                        error={errorCells.has(key)}
                        hasLinkBelow={row + 1 < net.rows}
                        onPick={(picked) => {
                          onPickCell({ ...picked, col });
                        }}
                      />
                    );
                  }),
                )}
              </g>
            </svg>
          </section>
        );
      })}
    </div>
  );
}

/**
 * ラダーのセルグリッド。親（`LadderEditor`）はキー入力のたびに再描画されるので `memo` する。§15
 */
export const LadderGrid = memo(LadderGridImpl);
```

> **`cell9` の意味:** `GridCell` は **表示上の列番号**で位置を決め、`onPick` で **IR の列番号**を返す。その2つを混ぜないために、`GridCell` へ渡す `cell9.col` は表示上の番号（`index`）にし、`onPickCell` の直前で IR の番号（`col`）に差し替える。テストは `cell-n1:0:15`（IR の番号）で引けることを確かめている。

- [ ] **Step 5: `ladder.module.css` を書く**

```css
/* ラダーエディタの見た目。設計仕様 §10.6（GX Works3“風”。ベンダーの画面の複製ではない）。 */

.gridScroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  background: #f7f8fa;
  padding: 6px 8px 24px;
}

.network {
  margin-bottom: 10px;
}

.networkHeader {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 11px;
  color: #444;
  border-bottom: 1px solid #d5d8de;
  padding: 2px 4px;
}

.networkId {
  font-weight: 700;
}

.networkComment {
  color: #1b6ac9;
}

.hiddenWarn {
  color: #b34700;
}

.grid {
  display: block;
}

.rail {
  fill: #3a3f47;
}

.cell {
  cursor: pointer;
}

.cellHit {
  fill: transparent;
}

.wire,
.symbol {
  fill: none;
  stroke-width: 1.6;
  stroke-linecap: square;
}

.symbolText,
.deviceText,
.presetText,
.commentText {
  text-anchor: middle;
  fill: #1b1e23;
  font-family: inherit;
}

.symbolText {
  font-size: 11px;
  font-weight: 700;
}

.deviceText {
  font-size: 10px;
}

.presetText {
  font-size: 9px;
  fill: #555;
}

.commentText {
  font-size: 8px;
  fill: #1b6ac9;
}

.cursor {
  fill: none;
  stroke: #1e64ff;
  stroke-width: 2;
}

.errorCell {
  fill: none;
  stroke: #d14343;
  stroke-width: 2;
  stroke-dasharray: 3 2;
}
```

- [ ] **Step 6: `ja.ts` に `ladder` ブロックを足す（**MERGE 注意 #1**）**

`JA.timeChart` の**直後**に足す（挿入のたびにファイルを読み直すこと）:

```ts
  /** ラダーエディタ（GX Works3風スキン）。§10.6 / §10.7 */
  ladder: {
    title: 'ラダーエディタ',
    network: '回路ブロック',
    /** 表示列数を超えた位置にセルがある。§10.6 */
    hiddenCells: '表示列数の外にセルがあります（設定でラダーの表示列数を増やしてください）',
  },
```

- [ ] **Step 7: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-symbols.test.ts test/ladder-grid.test.tsx
pnpm --filter @ojt/desktop typecheck
```

Expected: `Tests  14 passed (14)`（記号4件＋グリッド10件）。

- [ ] **Step 8: コミットする**

```powershell
npx prettier --write "apps/desktop/src/renderer/ladder/**/*.{ts,tsx,css}" "apps/desktop/src/renderer/i18n/ja.ts" "apps/desktop/test/ladder-*.test.*"
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"
git add apps/desktop/src/renderer/ladder apps/desktop/src/renderer/i18n/ja.ts apps/desktop/test
git commit -m "feat(desktop): draw the ladder grid with our own symbol line art"
```

---

## Task 5: キー操作とデバイス入力欄（F5/F6/F7/F9 と `Shift+F5` / `Alt+/`）

**Files:**
- Create: `apps/desktop/src/renderer/session/ladder-cell.ts`
- Create: `apps/desktop/src/renderer/ladder/DeviceInput.tsx`
- Create: `apps/desktop/src/renderer/ladder/LadderEditor.tsx`
- Modify: `apps/desktop/src/renderer/ladder/ladder.module.css`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（**MERGE 注意 #1**）
- Test: `apps/desktop/test/ladder-cell.test.ts`
- Test: `apps/desktop/test/ladder-editor.test.tsx`

`session/ladder.ts`（Task 1）が返す `LadderAction` を、ストアと `LadderGrid` に繋ぐ。デバイスが要るセル（接点・コイル・タイマ・カウンタ・MC/MCR）は**入力欄を開いてから**置く。

| 決めること | 本タスクの実装 |
|---|---|
| 入力欄の中身 | 接点は「種別（a/b/立上り/立下り）＋デバイス」、出力は「種別（OUT/SET/RST/TON/CTU/MC/MCR）＋デバイス＋設定値（＋CTUのリセットデバイス）」。`IR` が持つセル種別を**過不足なく**覆う |
| デバイスの読み | `profile.parseDevice(text)`。`Error` が返ったらその文言を欄の下に出して確定させない |
| タイマ設定値 | `K30` の方言表記（`profile.parseTimerPreset`）と、素の ms 値（`3000`）の両方を受ける。ms がその番号帯で表せないときは §10.5 の文言（「`3050ms` は `T0` では指定できません。100ms 刻みに丸めますか？」）を出し、「はい」で `roundTimerPreset()` を当てる |
| 罫線と横線 | `F9`（横線）と `Shift+F9`（縦線）、`Ctrl+←↑↓→`（罫線）は**入力欄を開かずに**その場で置く |
| 読出し・モニタ中 | `readOnly` アクションが返るので、トーストで理由を出して何もしない（決定表#11） |
| `F8`（応用命令） | `disabled` アクション。`entry.note` をそのままトーストに出す（§17.1 の注記） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/ladder-cell.test.ts`:

```ts
import { C, M, T, X, Y, type Cell } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  buildCell,
  emptyCellForm,
  formForCell,
  roundSuggestionFor,
  timerPresetMs,
  type CellForm,
} from '../src/renderer/session/ladder-cell.js';

const profile = MITSUBISHI_FX5U;

function form(overrides: Partial<CellForm>): CellForm {
  return { ...emptyCellForm('contact'), ...overrides };
}

describe('buildCell（入力欄 → セル）', () => {
  it('builds the four contact types', () => {
    for (const [contact, type] of [
      ['NO', 'NO'],
      ['NC', 'NC'],
      ['P', 'P'],
      ['F', 'F'],
    ] as const) {
      const cell = buildCell(form({ contact, deviceText: 'X0' }), profile);
      expect(cell).toMatchObject({ kind: 'contact', type, device: X(0) });
    }
  });

  it('reads the Mitsubishi octal notation (X10 = index 8)', () => {
    expect(buildCell(form({ deviceText: 'X10' }), profile)).toMatchObject({ device: X(8) });
    const bad = buildCell(form({ deviceText: 'X8' }), profile);
    expect(bad).toBeInstanceOf(Error);
    if (!(bad instanceof Error)) return;
    expect(bad.message).toContain('8進');
  });

  it('builds the output cells the IR supports', () => {
    const output = (overrides: Partial<CellForm>): Cell | Error =>
      buildCell({ ...emptyCellForm('output'), ...overrides }, profile);
    expect(output({ output: 'OUT', deviceText: 'Y0' })).toMatchObject({ kind: 'coil', type: 'OUT' });
    expect(output({ output: 'SET', deviceText: 'M1' })).toMatchObject({ kind: 'coil', type: 'SET' });
    expect(output({ output: 'RST', deviceText: 'M1' })).toMatchObject({ kind: 'coil', type: 'RST' });
    expect(output({ output: 'TON', deviceText: 'T0', presetText: 'K30' })).toMatchObject({
      kind: 'timer',
      presetMs: 3000,
    });
    expect(
      output({ output: 'CTU', deviceText: 'C0', presetText: '5', resetText: 'X2' }),
    ).toMatchObject({ kind: 'counter', preset: 5, resetDevice: X(2) });
    expect(output({ output: 'MC', deviceText: 'M0' })).toMatchObject({ kind: 'mc' });
    expect(output({ output: 'MCR', deviceText: 'M0' })).toMatchObject({ kind: 'mcr' });
  });

  it('refuses a device of the wrong kind', () => {
    const cell = buildCell({ ...emptyCellForm('output'), output: 'TON', deviceText: 'Y0', presetText: 'K30' }, profile);
    expect(cell).toBeInstanceOf(Error);
    if (!(cell instanceof Error)) return;
    expect(cell.message).toContain('タイマ');
  });

  it('round-trips an existing cell into the form', () => {
    expect(formForCell({ kind: 'contact', type: 'NC', device: X(1) }, profile)).toMatchObject({
      target: 'contact',
      contact: 'NC',
      deviceText: 'X1',
    });
    expect(
      formForCell({ kind: 'timer', type: 'TON', device: T(0), presetMs: 3000 }, profile),
    ).toMatchObject({ target: 'output', output: 'TON', deviceText: 'T0', presetText: 'K30' });
    expect(
      formForCell({ kind: 'counter', type: 'CTU', device: C(0), preset: 5, resetDevice: M(3) }, profile),
    ).toMatchObject({ output: 'CTU', presetText: '5', resetText: 'M3' });
  });
});

describe('timerPresetMs / roundSuggestionFor（§10.5）', () => {
  it('accepts the dialect notation and plain milliseconds', () => {
    expect(timerPresetMs('K30', T(0), profile)).toBe(3000);
    expect(timerPresetMs('3000', T(0), profile)).toBe(3000);
    expect(timerPresetMs('K30', T(200), profile)).toBe(300);
  });

  it('refuses text that is neither', () => {
    expect(timerPresetMs('三十', T(0), profile)).toBeInstanceOf(Error);
    expect(timerPresetMs('', T(0), profile)).toBeInstanceOf(Error);
    expect(timerPresetMs('-100', T(0), profile)).toBeInstanceOf(Error);
  });

  it('offers the 100ms rounding the spec asks for', () => {
    const suggestion = roundSuggestionFor(3050, T(0), profile);
    expect(suggestion).toEqual({ ms: 3050, baseMs: 100, rounded: 3000 });
    // T200 帯は 10ms 単位なので 3050ms はそのまま置ける
    expect(roundSuggestionFor(3050, T(200), profile)).toBeUndefined();
  });

  it('never rounds down to zero', () => {
    expect(roundSuggestionFor(30, T(0), profile)?.rounded).toBe(100);
  });
});
```

`apps/desktop/test/ladder-editor.test.tsx`:

```tsx
import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { cellAt, COIL_COL, X, Y } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderEditor } from '../src/renderer/ladder/LadderEditor.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

function editor(props: Partial<Parameters<typeof LadderEditor>[0]> = {}) {
  return render(
    <LadderEditor
      profile={MITSUBISHI_FX5U}
      gridCols={MITSUBISHI_FX5U.gridCols}
      onConvert={props.onConvert ?? (() => undefined)}
      onModeChange={props.onModeChange ?? (() => undefined)}
    />,
  );
}

function grid(): HTMLElement {
  return screen.getByTestId('ladder-editor');
}

function net1(): ReturnType<typeof cellAt> {
  const program = useStore.getState().ladder!;
  const net = program.networks.find((n) => n.id === 'n1')!;
  return cellAt(net, 0, 0);
}

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.getState().openProblem(problem);
});

describe('キー操作（§10.6 の割当表から引く）', () => {
  it('opens the device input on F5 and places an a-contact', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(net1()).toMatchObject({ kind: 'contact', type: 'NO', device: X(0) });
    expect(screen.queryByTestId('device-input')).toBeNull();
  });

  it('places a coil on F7 at the coil column', () => {
    editor();
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: COIL_COL });
    fireEvent.keyDown(grid(), { key: 'F7' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(cellAt(net, 0, COIL_COL)).toMatchObject({ kind: 'coil', type: 'OUT', device: Y(0) });
  });

  it('places a horizontal line on F9 without opening the input', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F9' });
    expect(screen.queryByTestId('device-input')).toBeNull();
    expect(net1().kind).toBe('hline');
  });

  it('refuses a device the dialect cannot read and keeps the input open', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X9' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(screen.getByTestId('device-error')).toHaveTextContent('8進');
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
  });

  it('offers the 100ms rounding for a timer preset the band cannot express (§10.5)', () => {
    editor();
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: COIL_COL });
    fireEvent.keyDown(grid(), { key: 'F7' });
    fireEvent.change(screen.getByTestId('output-kind'), { target: { value: 'TON' } });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'T0' } });
    fireEvent.change(screen.getByTestId('preset-text'), { target: { value: '3050' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(screen.getByTestId('round-prompt')).toHaveTextContent('100ms');
    fireEvent.click(screen.getByTestId('round-yes'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(cellAt(net, 0, COIL_COL)).toMatchObject({ kind: 'timer', presetMs: 3000 });
  });

  it('toggles a/b with / and the pulse form with Alt+/', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    fireEvent.keyDown(grid(), { key: '/' });
    expect(net1()).toMatchObject({ type: 'NC' });
    fireEvent.keyDown(grid(), { key: '/', altKey: true });
    expect(net1()).toMatchObject({ type: 'F' });
  });

  it('branches with Shift+F5 (OR contact)', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    fireEvent.keyDown(grid(), { key: 'F5', shiftKey: true });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(net.rows).toBe(2);
    expect(cellAt(net, 1, 0)).toMatchObject({ device: Y(0) });
    expect(cellAt(net, 0, 1).kind).toBe('vline');
  });

  it('clears the cell on Delete and walks the history with Ctrl+Z / Ctrl+Y', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F9' });
    expect(net1().kind).toBe('hline');
    fireEvent.keyDown(grid(), { key: 'Delete' });
    expect(net1().kind).toBe('empty');
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    expect(net1().kind).toBe('hline');
    fireEvent.keyDown(grid(), { key: 'y', ctrlKey: true });
    expect(net1().kind).toBe('empty');
  });

  it('asks the parent to convert on F4', () => {
    const onConvert = vi.fn();
    editor({ onConvert });
    fireEvent.keyDown(grid(), { key: 'F4' });
    expect(onConvert).toHaveBeenCalledTimes(1);
  });

  it('switches to monitor on F3 and tells the parent (決定表#11)', () => {
    const onModeChange = vi.fn();
    editor({ onModeChange });
    fireEvent.keyDown(grid(), { key: 'F3' });
    expect(useStore.getState().ladderMode).toBe('monitor');
    expect(onModeChange).toHaveBeenCalledWith('monitor');
    // モニタ中は編集できない
    fireEvent.keyDown(grid(), { key: 'F9' });
    expect(net1().kind).toBe('empty');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('書込みモード');
  });

  it('explains why F8 does nothing (§17.1)', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F8' });
    expect(useStore.getState().toasts.at(-1)?.text).toContain('Phase 4');
  });

  it('owns the keyboard only while focused (決定表#3)', () => {
    editor();
    expect(useStore.getState().ladderFocused).toBe(false);
    fireEvent.focus(grid());
    expect(useStore.getState().ladderFocused).toBe(true);
    fireEvent.blur(grid());
    expect(useStore.getState().ladderFocused).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-cell.test.ts test/ladder-editor.test.tsx
```

- [ ] **Step 3: `src/renderer/session/ladder-cell.ts` を書く**

```ts
import {
  ctu,
  mc,
  mcr,
  nc,
  no,
  out,
  rst,
  set,
  ton,
  type Cell,
  type Device,
  type DeviceKind,
} from '@ojt/ladder-core';
import { roundTimerPreset, timerBaseMs, type DialectProfile } from '@ojt/plc-dialects';

/**
 * デバイス入力欄の中身 ⇄ セル。設計仕様 §10.3 / §10.5。
 * React を知らない純粋層で、方言の読み書き（`parseDevice` / `parseTimerPreset`）は
 * すべて `DialectProfile` に任せる（Phase 4 でメーカーが増えてもここは変わらない）。
 */

/** 接点の種別。 */
export type ContactForm = 'NO' | 'NC' | 'P' | 'F';

/** 出力（コイル列）に置けるものの種別。IR のセル種別を過不足なく覆う。§10.3 */
export type OutputForm = 'OUT' | 'SET' | 'RST' | 'TON' | 'CTU' | 'MC' | 'MCR';

/** 入力欄の中身。 */
export interface CellForm {
  target: 'contact' | 'output';
  contact: ContactForm;
  output: OutputForm;
  deviceText: string;
  presetText: string;
  /** CTU のリセットデバイス。 */
  resetText: string;
}

/** 空の入力欄。 */
export function emptyCellForm(target: CellForm['target']): CellForm {
  return { target, contact: 'NO', output: 'OUT', deviceText: '', presetText: '', resetText: '' };
}

/** 種別ごとに許すデバイス種別（`kind`）。 */
const ALLOWED: Readonly<Record<OutputForm, readonly DeviceKind[]>> = {
  OUT: ['output', 'internal'],
  SET: ['output', 'internal', 'timer', 'counter'],
  RST: ['output', 'internal', 'timer', 'counter'],
  TON: ['timer'],
  CTU: ['counter'],
  MC: ['internal'],
  MCR: ['internal'],
};

/** デバイス種別の日本語名（エラー文言に使う）。 */
const KIND_LABEL: Readonly<Record<DeviceKind, string>> = {
  input: '入力',
  output: '出力',
  internal: '内部リレー',
  timer: 'タイマ',
  counter: 'カウンタ',
  special: '特殊デバイス',
};

/** デバイス欄を読む。 */
function readDevice(text: string, profile: DialectProfile): Device | Error {
  if (text.trim().length === 0) return new Error('デバイスを入力してください');
  return profile.parseDevice(text);
}

/**
 * タイマ設定値を ms にする。§10.5
 * 方言表記（`K30`）と素のミリ秒（`3000`）の両方を受ける。
 */
export function timerPresetMs(
  text: string,
  device: Device,
  profile: DialectProfile,
): number | Error {
  const trimmed = text.trim();
  if (trimmed.length === 0) return new Error('設定値を入力してください');
  if (/^[0-9]+$/u.test(trimmed)) {
    const ms = Number(trimmed);
    if (ms <= 0) return new Error('設定値は1以上にしてください');
    return ms;
  }
  return profile.parseTimerPreset(trimmed, device);
}

/** 丸めの提案（§10.5 の「100ms 刻みに丸めますか？」）。丸めが要らなければ undefined。 */
export interface RoundSuggestion {
  ms: number;
  baseMs: number;
  rounded: number;
}

/** その番号帯で表せない ms に対して、丸め先を提案する。 */
export function roundSuggestionFor(
  ms: number,
  device: Device,
  profile: DialectProfile,
): RoundSuggestion | undefined {
  if (!(profile.timerPreset(ms, device) instanceof Error)) return undefined;
  const baseMs = timerBaseMs(device);
  return { ms, baseMs, rounded: roundTimerPreset(ms, baseMs) };
}

/** 入力欄からセルを作る。読めない値は `Error`（投げない）。 */
export function buildCell(form: CellForm, profile: DialectProfile): Cell | Error {
  const device = readDevice(form.deviceText, profile);
  if (device instanceof Error) return device;
  if (form.target === 'contact') {
    if (form.contact === 'NO') return no(device);
    if (form.contact === 'NC') return nc(device);
    return { kind: 'contact', type: form.contact, device };
  }
  const allowed = ALLOWED[form.output];
  if (!allowed.includes(device.kind)) {
    return new Error(
      `${form.output} には ${allowed.map((kind) => KIND_LABEL[kind]).join('・')}のデバイスを指定します`,
    );
  }
  if (form.output === 'OUT') return out(device);
  if (form.output === 'SET') return set(device);
  if (form.output === 'RST') return rst(device);
  if (form.output === 'MC') return mc(device);
  if (form.output === 'MCR') return mcr(device);
  if (form.output === 'TON') {
    const ms = timerPresetMs(form.presetText, device, profile);
    if (ms instanceof Error) return ms;
    const preset = profile.timerPreset(ms, device);
    if (preset instanceof Error) return preset;
    return ton(device, ms);
  }
  const preset = Number(form.presetText.trim().replace(/^K/iu, ''));
  if (!Number.isInteger(preset) || preset < 1) {
    return new Error('カウンタの設定値は1以上の整数にします');
  }
  const reset = readDevice(form.resetText, profile);
  if (reset instanceof Error) return reset;
  return ctu(device, preset, reset);
}

/** 既存のセルを入力欄の形にする（`Enter` での編集）。 */
export function formForCell(cell: Cell, profile: DialectProfile): CellForm {
  if (cell.kind === 'contact') {
    return {
      ...emptyCellForm('contact'),
      contact: cell.type,
      deviceText: profile.formatDevice(cell.device),
    };
  }
  const base = emptyCellForm('output');
  if (cell.kind === 'coil') {
    return { ...base, output: cell.type, deviceText: profile.formatDevice(cell.device) };
  }
  if (cell.kind === 'timer') {
    const preset = profile.timerPreset(cell.presetMs, cell.device);
    return {
      ...base,
      output: 'TON',
      deviceText: profile.formatDevice(cell.device),
      presetText: preset instanceof Error ? String(cell.presetMs) : preset.text,
    };
  }
  if (cell.kind === 'counter') {
    return {
      ...base,
      output: 'CTU',
      deviceText: profile.formatDevice(cell.device),
      presetText: String(cell.preset),
      resetText: profile.formatDevice(cell.resetDevice),
    };
  }
  if (cell.kind === 'mc' || cell.kind === 'mcr') {
    return {
      ...base,
      output: cell.kind === 'mc' ? 'MC' : 'MCR',
      deviceText: profile.formatDevice(cell.device),
    };
  }
  return base;
}
```

- [ ] **Step 4: `src/renderer/ladder/DeviceInput.tsx` を書く**

```tsx
import type { DialectProfile } from '@ojt/plc-dialects';
import { useEffect, useRef, useState, type JSX } from 'react';
import { JA, timerRoundPrompt } from '../i18n/ja.js';
import {
  buildCell,
  roundSuggestionFor,
  timerPresetMs,
  type CellForm,
  type ContactForm,
  type OutputForm,
} from '../session/ladder-cell.js';
import styles from './ladder.module.css';

/**
 * デバイス入力欄。設計仕様 §10.5 / §10.7。
 * 方言の読み書きは `DialectProfile` に任せるので、Phase 4 でメーカーが増えてもここは変わらない。
 */

const CONTACTS: ReadonlyArray<{ value: ContactForm; label: string }> = [
  { value: 'NO', label: JA.ladder.contactNo },
  { value: 'NC', label: JA.ladder.contactNc },
  { value: 'P', label: JA.ladder.contactRise },
  { value: 'F', label: JA.ladder.contactFall },
];

const OUTPUTS: ReadonlyArray<{ value: OutputForm; label: string }> = [
  { value: 'OUT', label: JA.ladder.coilOut },
  { value: 'SET', label: JA.ladder.coilSet },
  { value: 'RST', label: JA.ladder.coilRst },
  { value: 'TON', label: JA.ladder.timer },
  { value: 'CTU', label: JA.ladder.counter },
  { value: 'MC', label: JA.ladder.mc },
  { value: 'MCR', label: JA.ladder.mcr },
];

/** デバイス入力欄。確定できたら `onCommit(cell)`。 */
export function DeviceInput({
  initial,
  profile,
  onCommit,
  onCancel,
}: {
  initial: CellForm;
  profile: DialectProfile;
  onCommit: (cell: ReturnType<typeof buildCell>) => void;
  onCancel: () => void;
}): JSX.Element {
  const [form, setForm] = useState<CellForm>(initial);
  const [error, setError] = useState<string | undefined>(undefined);
  const [round, setRound] = useState<{ rounded: number; baseMs: number } | undefined>(undefined);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const commit = (presetOverrideMs?: number): void => {
    const next =
      presetOverrideMs === undefined ? form : { ...form, presetText: String(presetOverrideMs) };
    /*
     * タイマは「この機種では表せない ms」のときだけ §10.5 の丸め確認を出す。
     * 丸めに「はい」と答えられたら `roundTimerPreset()` の結果で作り直す。
     */
    if (next.target === 'output' && next.output === 'TON' && presetOverrideMs === undefined) {
      const device = profile.parseDevice(next.deviceText);
      if (!(device instanceof Error)) {
        const ms = timerPresetMs(next.presetText, device, profile);
        if (!(ms instanceof Error)) {
          const suggestion = roundSuggestionFor(ms, device, profile);
          if (suggestion !== undefined) {
            setRound({ rounded: suggestion.rounded, baseMs: suggestion.baseMs });
            setError(timerRoundPrompt(suggestion.ms, profile.formatDevice(device), suggestion.baseMs));
            return;
          }
        }
      }
    }
    const cell = buildCell(next, profile);
    if (cell instanceof Error) {
      setError(cell.message);
      setRound(undefined);
      return;
    }
    onCommit(cell);
  };

  return (
    <div className={styles.inputBox} data-testid="device-input" role="dialog" aria-label={JA.ladder.inputTitle}>
      <div className={styles.inputRow}>
        {form.target === 'contact' ? (
          <select
            data-testid="contact-kind"
            aria-label={JA.ladder.contactKind}
            value={form.contact}
            onChange={(event) => {
              setForm({ ...form, contact: event.target.value as ContactForm });
            }}
          >
            {CONTACTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        ) : (
          <select
            data-testid="output-kind"
            aria-label={JA.ladder.outputKind}
            value={form.output}
            onChange={(event) => {
              setForm({ ...form, output: event.target.value as OutputForm });
            }}
          >
            {OUTPUTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        <input
          ref={firstRef}
          data-testid="device-text"
          aria-label={JA.ladder.device}
          value={form.deviceText}
          placeholder={profile.deviceRanges.input.prefix + '0'}
          onChange={(event) => {
            setForm({ ...form, deviceText: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') onCancel();
          }}
        />
        {form.target === 'output' && (form.output === 'TON' || form.output === 'CTU') ? (
          <input
            data-testid="preset-text"
            aria-label={JA.ladder.preset}
            value={form.presetText}
            placeholder={form.output === 'TON' ? 'K30' : '5'}
            onChange={(event) => {
              setForm({ ...form, presetText: event.target.value });
            }}
          />
        ) : null}
        {form.target === 'output' && form.output === 'CTU' ? (
          <input
            data-testid="reset-text"
            aria-label={JA.ladder.resetDevice}
            value={form.resetText}
            placeholder="X2"
            onChange={(event) => {
              setForm({ ...form, resetText: event.target.value });
            }}
          />
        ) : null}
        <button type="button" data-testid="device-commit" onClick={() => { commit(); }}>
          {JA.ladder.commit}
        </button>
        <button type="button" data-testid="device-cancel" onClick={onCancel}>
          {JA.inspectRepair.cancel}
        </button>
      </div>
      {error === undefined ? null : (
        <p className={styles.inputError} data-testid="device-error">
          {error}
        </p>
      )}
      {round === undefined ? null : (
        <p className={styles.inputRound} data-testid="round-prompt">
          {error}
          <button
            type="button"
            data-testid="round-yes"
            onClick={() => {
              const rounded = round.rounded;
              setRound(undefined);
              setError(undefined);
              setForm({ ...form, presetText: String(rounded) });
              commit(rounded);
            }}
          >
            {JA.ladder.roundYes}
          </button>
          <button
            type="button"
            data-testid="round-no"
            onClick={() => {
              setRound(undefined);
            }}
          >
            {JA.ladder.roundNo}
          </button>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `src/renderer/ladder/LadderEditor.tsx` を書く**

```tsx
import { cellAt, hline, vline, type Cell } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { useCallback, useState, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { isTypingTarget } from '../session/interaction.js';
import {
  applyLadderCell,
  applyOrContact,
  applyRuleLine,
  clearLadderCell,
  ladderKeyToAction,
  moveCursor,
  toggleNoNcAt,
  togglePulseAt,
  type LadderEditResult,
  type LadderEditorMode,
  type PlaceKind,
} from '../session/ladder.js';
import { emptyCellForm, formForCell, type CellForm } from '../session/ladder-cell.js';
import { DeviceInput } from './DeviceInput.js';
import { LadderGrid } from './LadderGrid.js';
import styles from './ladder.module.css';

/**
 * ラダーエディタ。設計仕様 §10.6 / §10.7。
 *
 * キーの意味は `DialectProfile.shortcuts` が決める（決定表#12）。この部品はキーの文字列を
 * 1つも持たず、`ladderKeyToAction()` が返した `action` に対して振る舞いを選ぶだけである。
 */

/** デバイス入力欄を開く必要があるセル種別。 */
const NEEDS_DEVICE: Readonly<Record<PlaceKind, boolean>> = {
  'contact-no': true,
  'contact-nc': true,
  'or-contact-no': true,
  'or-contact-nc': true,
  coil: true,
  hline: false,
  vline: false,
};

/** 入力欄を開いたときに待っている置き場所。 */
interface Pending {
  kind: PlaceKind;
  form: CellForm;
}

/** ラダーエディタ。 */
export function LadderEditor({
  profile,
  gridCols,
  onConvert,
  onModeChange,
}: {
  profile: DialectProfile;
  gridCols: number;
  /** `F4`（変換）。実体は `LadderWorkspace` が持つ。§10.6 */
  onConvert: () => void;
  /** 書込み／読出し／モニタが変わった（Worker へモニタの開始停止を伝える）。§10.6 */
  onModeChange: (mode: LadderEditorMode) => void;
}): JSX.Element {
  const program = useStore((s) => s.ladder);
  const cursor = useStore((s) => s.ladderCursor);
  const mode = useStore((s) => s.ladderMode);
  const comments = useStore((s) => s.ladderComments);
  const errorCells = useStore((s) => s.convertIssues.errors);
  /** モニタ中だけ通電文字列を購読する（決定表#5）。 */
  const powered = useStore((s) => s.plcMonitor?.powered);
  const [pending, setPending] = useState<Pending | undefined>(undefined);

  /** 編集結果をストアへ入れる（失敗は理由をトーストに出す）。 */
  const commit = useCallback((result: LadderEditResult): void => {
    const store = useStore.getState();
    if (!result.ok) {
      store.toast(result.message, 'error');
      return;
    }
    store.setLadder(result.program);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      // 入力欄に打ち込んでいる間は盤・ラダーのショートカットを動かさない（§8.2 と同じ規則）
      if (isTypingTarget(event.target) || event.nativeEvent.isComposing) return;
      const store = useStore.getState();
      const current = store.ladder;
      if (current === undefined) return;
      const action = ladderKeyToAction(profile.shortcuts, event, {
        cursor: store.ladderCursor,
        mode: store.ladderMode,
      });
      if (action.type === 'none') return;
      event.preventDefault();
      switch (action.type) {
        case 'move':
          store.setLadderCursor(moveCursor(current, store.ladderCursor, action.dRow, action.dCol));
          break;
        case 'place': {
          if (!NEEDS_DEVICE[action.kind]) {
            const cell: Cell = action.kind === 'hline' ? hline() : vline();
            commit(applyLadderCell(current, store.ladderCursor, cell));
            break;
          }
          const target = action.kind === 'coil' ? 'output' : 'contact';
          const form = emptyCellForm(target);
          setPending({
            kind: action.kind,
            form:
              action.kind === 'contact-nc' || action.kind === 'or-contact-nc'
                ? { ...form, contact: 'NC' }
                : form,
          });
          break;
        }
        case 'edit': {
          const net = current.networks.find((n) => n.id === store.ladderCursor.networkId);
          if (net === undefined) break;
          const cell = cellAt(net, store.ladderCursor.row, store.ladderCursor.col);
          if (cell.kind === 'empty' || cell.kind === 'hline' || cell.kind === 'vline') break;
          setPending({ kind: 'contact-no', form: formForCell(cell, profile) });
          break;
        }
        case 'ruleLine':
          commit(applyRuleLine(current, store.ladderCursor, action.direction));
          break;
        case 'toggleNoNc':
          commit(toggleNoNcAt(current, store.ladderCursor));
          break;
        case 'togglePulse':
          commit(togglePulseAt(current, store.ladderCursor));
          break;
        case 'delete':
          commit(clearLadderCell(current, store.ladderCursor));
          break;
        case 'undo':
          if (!store.undoLadderEdit()) store.toast(JA.ladder.nothingToUndo);
          break;
        case 'redo':
          if (!store.redoLadderEdit()) store.toast(JA.ladder.nothingToRedo);
          break;
        case 'convert':
          onConvert();
          break;
        case 'setMode':
          store.setLadderMode(action.mode);
          onModeChange(action.mode);
          break;
        case 'toggleInsert':
          // 挿入・上書きの切換は Phase 3 では常に上書き（意図的な差分 #4）
          store.toast(JA.ladder.overwriteOnly);
          break;
        case 'help':
          store.toast(JA.ladder.helpHint);
          break;
        case 'disabled':
          store.toast(action.entry.note ?? action.entry.label, 'error');
          break;
        case 'readOnly':
          store.toast(JA.ladder.readOnly, 'error');
          break;
        default:
          break;
      }
    },
    [commit, onConvert, onModeChange, profile],
  );

  if (program === undefined) return <div className={styles.editor} data-testid="ladder-editor" />;

  return (
    <div
      className={styles.editor}
      data-testid="ladder-editor"
      data-mode={mode}
      role="application"
      aria-label={profile.panels.editor}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => {
        useStore.getState().setLadderFocused(true);
      }}
      onBlur={(event) => {
        // 入力欄（子要素）へフォーカスが移っただけならエディタは手放さない
        if (event.currentTarget.contains(event.relatedTarget)) return;
        useStore.getState().setLadderFocused(false);
      }}
    >
      <LadderGrid
        program={program}
        profile={profile}
        cursor={cursor}
        mode={mode}
        powered={powered}
        comments={comments}
        errorCells={
          new Set(
            errorCells.flatMap((issue) =>
              issue.networkId === undefined || issue.row === undefined || issue.col === undefined
                ? []
                : [`${issue.networkId}:${String(issue.row)}:${String(issue.col)}`],
            ),
          )
        }
        gridCols={gridCols}
        onPickCell={(next) => {
          useStore.getState().setLadderCursor(next);
        }}
      />
      {pending === undefined ? null : (
        <DeviceInput
          initial={pending.form}
          profile={profile}
          onCancel={() => {
            setPending(undefined);
          }}
          onCommit={(cell) => {
            if (cell instanceof Error) return;
            const store = useStore.getState();
            const current = store.ladder;
            if (current === undefined) return;
            const isBranch =
              pending.kind === 'or-contact-no' || pending.kind === 'or-contact-nc';
            commit(
              isBranch
                ? applyOrContact(current, store.ladderCursor, cell)
                : applyLadderCell(current, store.ladderCursor, cell),
            );
            setPending(undefined);
          }}
        />
      )}
    </div>
  );
}
```

> **`errorCells` の作り直し:** `new Set(...)` を毎レンダーで作ると `LadderGrid` の `memo` が効かない。Task 8 で `LadderWorkspace` が `useMemo` した `Set` を props で流し込む形に直す（このタスクでは動作を先に確かめる）。**Task 8 Step 5 でここを直すこと。**

- [ ] **Step 6: CSS と `ja.ts` を足す**

`ladder.module.css` に追記:

```css
.editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
  outline: none;
  border: 2px solid transparent;
}

.editor:focus-within {
  border-color: #1e64ff;
}

.inputBox {
  border-top: 1px solid #d5d8de;
  background: #fff;
  padding: 6px 8px;
}

.inputRow {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.inputRow input {
  width: 92px;
}

.inputError {
  margin: 4px 0 0;
  color: #b3261e;
  font-size: 12px;
}

.inputRound {
  margin: 4px 0 0;
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
}
```

`ja.ts` の `ladder` ブロックへ追記（**MERGE 注意 #1**）:

```ts
    inputTitle: 'デバイスの入力',
    contactKind: '接点の種別',
    outputKind: '出力の種別',
    contactNo: 'a接点',
    contactNc: 'b接点',
    contactRise: '立上り',
    contactFall: '立下り',
    coilOut: 'コイル（OUT）',
    coilSet: 'セット（SET）',
    coilRst: 'リセット（RST）',
    timer: 'タイマ（TON）',
    counter: 'カウンタ（CTU）',
    mc: 'マスタコントロール（MC）',
    mcr: 'マスタコントロール解除（MCR）',
    device: 'デバイス',
    preset: '設定値',
    resetDevice: 'リセットデバイス',
    commit: '確定',
    roundYes: 'はい',
    roundNo: 'いいえ',
    /** 読出し・モニタ中に編集しようとした。§10.6 */
    readOnly: '書込みモード（F2）に切り替えると編集できます',
    /** 挿入・上書きの切換（Phase 3 は常に上書き）。意図的な差分 #4 */
    overwriteOnly: 'Phase 3 のラダーエディタは常に上書きです',
    helpHint: 'キー割当はツールバーの「キー割当」から見られます',
    nothingToUndo: 'これ以上は元に戻せません',
    nothingToRedo: 'これ以上はやり直せません',
```

そして `ja.ts` の末尾（関数群）に足す:

```ts
/**
 * タイマ設定値をその番号帯で表せないときの確認文。§10.5
 * 例: 「3050ms は T0 では指定できません。100ms 刻みに丸めますか？」
 */
export function timerRoundPrompt(ms: number, device: string, baseMs: number): string {
  return `${String(ms)}ms は ${device} では指定できません。${String(baseMs)}ms 刻みに丸めますか？`;
}
```

- [ ] **Step 7: GREEN を確認する**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-cell.test.ts test/ladder-editor.test.tsx
pnpm --filter @ojt/desktop typecheck
```

Expected: `ladder-cell` が `Tests  9 passed (9)`、`ladder-editor` が `Tests  11 passed (11)`。

- [ ] **Step 8: コミットする**

```powershell
npx prettier --write "apps/desktop/src/renderer/ladder/**/*.{ts,tsx,css}" "apps/desktop/src/renderer/session/ladder-cell.ts" "apps/desktop/src/renderer/i18n/ja.ts" "apps/desktop/test/ladder-*.test.*"
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): wire F5/F6/F7/F9 and the device input to the ladder"
```

---

## Task 6: 「変換」（F4）と出力ウィンドウ

**Files:**
- Create: `apps/desktop/src/renderer/session/ladder-errors.ts`
- Create: `apps/desktop/src/renderer/ladder/OutputWindow.tsx`
- Modify: `apps/desktop/src/renderer/ladder/ladder.module.css`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（**MERGE 注意 #1**）
- Test: `apps/desktop/test/ladder-errors.test.ts`
- Test: `apps/desktop/test/output-window.test.tsx`

`convert(program, profile)`（3A）を走らせ、結果を §10.6 の出力ウィンドウに並べる。**決定表#4** のとおりエラーの位置はライブラリが持っているものをそのまま使う。

| 決めること | 本タスクの実装 |
|---|---|
| 変換の実体 | `runConvert(program, profile)` が `convert()` を呼び、`ConvertIssues`（ストアの値型）に畳む。**成功したときだけ** `converted: true` にして Worker へ `plc { kind:'load' }` を送る（H-1） |
| 行の並び | ①構造エラー → ②方言エラー → ③警告（二重コイル）→ ④使用デバイス一覧。各行に `ネットワーク / 行 / 列` を出す |
| クリック | `row` / `col` を持つ行はカーソルをそのセルへ飛ばす。持たない行は何もしない（決定表#4） |
| 使用デバイス | `CompiledProgram.usage` の `reads` / `writes` を方言表記で並べ、**片方にしか出てこないデバイス**を「未使用」として淡色で注記する。**合否には効かせない**（決定表#15b） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/ladder-errors.test.ts`:

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
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import { errorCellKeys, runConvert, unusedDevices } from '../src/renderer/session/ladder-errors.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const profile = MITSUBISHI_FX5U;

describe('runConvert（§10.6）', () => {
  it('reports success with the device usage', () => {
    const result = runConvert(program(network('n1', [rung(no(X(0)), out(Y(0)))]), endNetwork()), profile);
    expect(result.ok).toBe(true);
    expect(result.issues.errors).toEqual([]);
    expect(result.issues.usage).toEqual({ reads: ['X0'], writes: ['Y0'] });
    expect(result.program).toBeDefined();
  });

  it('separates structural errors from dialect errors', () => {
    const result = runConvert(program(network('n1', [rung(no(X(0)), ton(T(0), 150))])), profile);
    expect(result.ok).toBe(false);
    expect(result.issues.errors.map((e) => e.source)).toContain('structure');
    expect(result.issues.errors.map((e) => e.source)).toContain('dialect');
    expect(result.issues.usage).toBeUndefined();
  });

  it('keeps the double-coil warning on a successful conversion (§10.4)', () => {
    const result = runConvert(
      program(
        network('n1', [rung(no(X(0)), out(Y(0)))]),
        network('n2', [rung(no(X(1)), out(Y(0)))]),
        endNetwork(),
      ),
      profile,
    );
    expect(result.ok).toBe(true);
    expect(result.issues.warnings.map((w) => w.code)).toEqual(['double-coil']);
    expect(result.issues.warnings[0]?.networkId).toBe('n2');
  });

  it('formats the devices with the dialect (X10 = index 8)', () => {
    const result = runConvert(
      program(network('n1', [rung(no({ kind: 'input', index: 8 }), out(Y(0)))]), endNetwork()),
      profile,
    );
    expect(result.issues.usage?.reads).toEqual(['X10']);
  });
});

describe('errorCellKeys', () => {
  it('collects only the issues that point at a cell (決定表#4)', () => {
    const keys = errorCellKeys([
      { source: 'structure', code: 'coil-column', message: '', networkId: 'n1', row: 0, col: 2 },
      { source: 'structure', code: 'missing-end', message: '' },
      { source: 'dialect', code: 'device-range', message: '', networkId: 'n2', row: 1, col: 0 },
      { source: 'structure', code: 'no-output', message: '', networkId: 'n3' },
    ]);
    expect([...keys].sort()).toEqual(['n1:0:2', 'n2:1:0']);
  });
});

describe('unusedDevices（§10.8。表示のみ。決定表#15b）', () => {
  it('lists devices that are written but never read, and the other way round', () => {
    expect(unusedDevices({ reads: ['X0', 'M1'], writes: ['Y0', 'M2'] })).toEqual({
      neverRead: ['Y0', 'M2'],
      neverWritten: ['X0', 'M1'],
    });
  });
});
```

`apps/desktop/test/output-window.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OutputWindow } from '../src/renderer/ladder/OutputWindow.js';

const issues = {
  errors: [
    { source: 'structure' as const, code: 'coil-column', message: 'コイルは最終列に置きます', networkId: 'n1', row: 0, col: 2 },
    { source: 'dialect' as const, code: 'device-range', message: 'X の番号が範囲外です', networkId: 'n1', row: 0, col: 0 },
    { source: 'structure' as const, code: 'missing-end', message: 'END がありません' },
  ],
  warnings: [
    { code: 'double-coil', message: 'Y0 のコイルが2回以上あります', networkId: 'n2', row: 0, col: 15 },
  ],
  usage: { reads: ['X0'], writes: ['Y0', 'M1'] },
};

describe('出力ウィンドウ（§10.6）', () => {
  it('lists structural errors first, then dialect errors, then warnings', () => {
    render(<OutputWindow issues={issues} converted={false} onJump={() => undefined} />);
    const rows = screen.getAllByTestId(/^output-row-/u);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('コイルは最終列');
    expect(rows[2]).toHaveTextContent('END がありません');
    expect(rows[3]).toHaveTextContent('二重コイル');
  });

  it('shows where each issue is', () => {
    render(<OutputWindow issues={issues} converted={false} onJump={() => undefined} />);
    expect(screen.getByTestId('output-row-0')).toHaveTextContent('n1');
    expect(screen.getByTestId('output-row-0')).toHaveTextContent('1 行');
    expect(screen.getByTestId('output-row-0')).toHaveTextContent('3 列');
  });

  it('jumps to the cell an issue points at, and does nothing for the rest', () => {
    const onJump = vi.fn();
    render(<OutputWindow issues={issues} converted={false} onJump={onJump} />);
    fireEvent.click(screen.getByTestId('output-row-0'));
    expect(onJump).toHaveBeenCalledWith({ networkId: 'n1', row: 0, col: 2 });
    fireEvent.click(screen.getByTestId('output-row-2'));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('shows the used devices and marks the unused ones (決定表#15b)', () => {
    render(
      <OutputWindow
        issues={{ errors: [], warnings: [], usage: issues.usage }}
        converted
        onJump={() => undefined}
      />,
    );
    expect(screen.getByTestId('usage-reads')).toHaveTextContent('X0');
    expect(screen.getByTestId('usage-writes')).toHaveTextContent('Y0');
    expect(screen.getByTestId('usage-unused')).toHaveTextContent('M1');
    expect(screen.getByTestId('convert-state')).toHaveTextContent('変換に成功');
  });

  it('says the ladder still needs converting when it does', () => {
    render(<OutputWindow issues={{ errors: [], warnings: [], usage: undefined }} converted={false} onJump={() => undefined} />);
    expect(screen.getByTestId('convert-state')).toHaveTextContent('未変換');
  });
});
```

- [ ] **Step 2: RED を確認し、Step 3 で `session/ladder-errors.ts` を書く**

```ts
import { deviceLabel, type CompiledProgram, type LadderProgram } from '@ojt/ladder-core';
import { convert, type DialectProfile } from '@ojt/plc-dialects';
import type { ConvertIssues, ConvertErrorLine } from '../app/store-types.js';

/**
 * 「変換」（F4）と出力ウィンドウの材料。設計仕様 §10.6 / §10.8。決定表#4
 *
 * `@ojt/plc-dialects` の `convert()` を呼び、結果をストアの値型（`ConvertIssues`）に畳む。
 * 位置（ネットワーク・行・列）は**ライブラリが持っているものをそのまま**使い、UI 側で推定しない。
 */

/** 変換の結果（成功なら実行形式も返す）。 */
export interface ConvertRun {
  ok: boolean;
  issues: ConvertIssues;
  program: CompiledProgram | undefined;
}

/** 変換を走らせる。 */
export function runConvert(source: LadderProgram, profile: DialectProfile): ConvertRun {
  const result = convert(source, profile);
  const errors: ConvertErrorLine[] = result.errors.map((error) => ({
    source: error.source,
    code: error.code,
    message: error.message,
    ...(error.networkId === undefined ? {} : { networkId: error.networkId }),
    ...(error.row === undefined ? {} : { row: error.row }),
    ...(error.col === undefined ? {} : { col: error.col }),
  }));
  const warnings = result.warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    networkId: warning.networkId,
    row: warning.row,
    col: warning.col,
  }));
  if (!result.ok) {
    return { ok: false, issues: { errors, warnings, usage: undefined }, program: undefined };
  }
  return {
    ok: true,
    issues: {
      errors,
      warnings,
      usage: {
        // 出力ウィンドウは方言表記で出す（IRの通し番号ではない）。§10.5
        reads: result.program.usage.reads.map((device) => profile.formatDevice(device)),
        writes: result.program.usage.writes.map((device) => profile.formatDevice(device)),
      },
    },
    program: result.program,
  };
}

/** 変換エラーのうち、セルを指しているものの鍵（`"net:row:col"`）。 */
export function errorCellKeys(errors: readonly ConvertErrorLine[]): Set<string> {
  const keys = new Set<string>();
  for (const error of errors) {
    if (error.networkId === undefined || error.row === undefined || error.col === undefined) continue;
    keys.add(`${error.networkId}:${String(error.row)}:${String(error.col)}`);
  }
  return keys;
}

/**
 * 使われていないデバイス。§10.8
 * **表示のみ**で合否には効かせない（決定表#15b）。
 */
export function unusedDevices(usage: { reads: readonly string[]; writes: readonly string[] }): {
  neverRead: string[];
  neverWritten: string[];
} {
  const reads = new Set(usage.reads);
  const writes = new Set(usage.writes);
  return {
    neverRead: usage.writes.filter((device) => !reads.has(device)),
    neverWritten: usage.reads.filter((device) => !writes.has(device)),
  };
}

/** IR の `deviceLabel()` をそのまま使いたいとき（デバイスコメントの鍵）。§10.7 */
export { deviceLabel };
```

- [ ] **Step 4: `ladder/OutputWindow.tsx` を書く**

```tsx
import type { JSX } from 'react';
import { JA, ladderIssuePlace } from '../i18n/ja.js';
import type { ConvertIssues } from '../app/store-types.js';
import type { LadderCursor } from '../session/ladder.js';
import { unusedDevices } from '../session/ladder-errors.js';
import styles from './ladder.module.css';

/**
 * 出力ウィンドウ。設計仕様 §10.6 / §10.8。
 * 変換エラー（構造 → 方言）・警告・使用デバイスをこの順で1つの一覧に並べる。
 */

/** 1行の形（エラーも警告も同じ形に畳んでから描く）。 */
interface Row {
  key: string;
  severity: 'error' | 'warning';
  label: string;
  message: string;
  cursor: LadderCursor | undefined;
  place: string;
}

/** 出力ウィンドウ。 */
export function OutputWindow({
  issues,
  converted,
  onJump,
}: {
  issues: ConvertIssues;
  converted: boolean;
  onJump: (cursor: LadderCursor) => void;
}): JSX.Element {
  const rows: Row[] = [
    ...issues.errors
      .filter((issue) => issue.source === 'structure')
      .map((issue, index) => toRow(issue, 'structure', index)),
    ...issues.errors
      .filter((issue) => issue.source === 'dialect')
      .map((issue, index) => toRow(issue, 'dialect', index)),
    ...issues.warnings.map((warning, index) => ({
      key: `w-${String(index)}`,
      severity: 'warning' as const,
      label: JA.ladder.doubleCoil,
      message: warning.message,
      cursor: { networkId: warning.networkId, row: warning.row, col: warning.col },
      place: ladderIssuePlace(warning.networkId, warning.row, warning.col),
    })),
  ];
  const unused =
    issues.usage === undefined
      ? undefined
      : unusedDevices(issues.usage);
  return (
    <section className={styles.output} data-testid="output-window" aria-label={JA.ladder.output}>
      <header className={styles.outputHeader}>
        <h2>{JA.ladder.output}</h2>
        <span data-testid="convert-state" className={converted ? styles.okTag : styles.ngTag}>
          {converted ? JA.ladder.convertOk : JA.ladder.notConverted}
        </span>
      </header>
      <ul className={styles.outputList}>
        {rows.length === 0 ? <li className={styles.outputEmpty}>{JA.ladder.noIssues}</li> : null}
        {rows.map((row, index) => (
          <li
            key={row.key}
            data-testid={`output-row-${String(index)}`}
            data-severity={row.severity}
            className={row.severity === 'error' ? styles.outputError : styles.outputWarning}
            onClick={() => {
              if (row.cursor !== undefined) onJump(row.cursor);
            }}
          >
            <span className={styles.outputLabel}>{row.label}</span>
            <span className={styles.outputPlace}>{row.place}</span>
            <span>{row.message}</span>
          </li>
        ))}
      </ul>
      {issues.usage === undefined || unused === undefined ? null : (
        <div className={styles.usage}>
          <p data-testid="usage-reads">
            {JA.ladder.usageReads}: {issues.usage.reads.join(' ') || JA.inspectRepair.none}
          </p>
          <p data-testid="usage-writes">
            {JA.ladder.usageWrites}: {issues.usage.writes.join(' ') || JA.inspectRepair.none}
          </p>
          <p data-testid="usage-unused" className={styles.usageUnused}>
            {JA.ladder.usageUnused}:{' '}
            {[...unused.neverRead, ...unused.neverWritten].join(' ') || JA.inspectRepair.none}
          </p>
        </div>
      )}
    </section>
  );
}

/** 変換エラー1件を行に畳む。 */
function toRow(
  issue: ConvertIssues['errors'][number],
  source: 'structure' | 'dialect',
  index: number,
): Row {
  return {
    key: `${source}-${String(index)}`,
    severity: 'error',
    label: source === 'structure' ? JA.ladder.structureError : JA.ladder.dialectError,
    message: issue.message,
    cursor:
      issue.networkId === undefined || issue.row === undefined || issue.col === undefined
        ? undefined
        : { networkId: issue.networkId, row: issue.row, col: issue.col },
    place: ladderIssuePlace(issue.networkId, issue.row, issue.col),
  };
}
```

`ja.ts` の `ladder` へ追記と、末尾の関数:

```ts
    output: '出力ウィンドウ',
    structureError: '構造エラー',
    dialectError: '機種エラー',
    doubleCoil: '二重コイル',
    noIssues: '指摘はありません。',
    convertOk: '変換に成功しました',
    notConverted: '未変換（F4 で変換します）',
    usageReads: '読み出しているデバイス',
    usageWrites: '書き込んでいるデバイス',
    usageUnused: '使われていないデバイス（表示のみ・合否には影響しません）',
```

```ts
/** 変換エラーの場所（`n1 / 1 行 / 3 列`）。位置を持たない指摘は空文字。§10.6 */
export function ladderIssuePlace(networkId?: string, row?: number, col?: number): string {
  if (networkId === undefined) return '';
  if (row === undefined || col === undefined) return networkId;
  return `${networkId} / ${String(row + 1)} 行 / ${String(col + 1)} 列`;
}
```

CSS（`ladder.module.css` へ追記）:

```css
.output {
  border-top: 1px solid #d5d8de;
  background: #fff;
  max-height: 168px;
  overflow: auto;
  font-size: 12px;
}

.outputHeader {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  position: sticky;
  top: 0;
  background: #eef0f4;
}

.outputHeader h2 {
  font-size: 12px;
  margin: 0;
}

.okTag {
  color: #1c7c3c;
}

.ngTag {
  color: #b34700;
}

.outputList {
  list-style: none;
  margin: 0;
  padding: 0;
}

.outputList li {
  display: grid;
  grid-template-columns: 76px 128px 1fr;
  gap: 6px;
  padding: 2px 8px;
  cursor: pointer;
}

.outputError {
  color: #b3261e;
}

.outputWarning {
  color: #b34700;
}

.outputEmpty {
  color: #666;
  cursor: default;
}

.outputLabel {
  font-weight: 700;
}

.outputPlace {
  color: #555;
}

.usage {
  padding: 4px 8px 8px;
  border-top: 1px dashed #d5d8de;
}

.usage p {
  margin: 2px 0;
}

.usageUnused {
  color: #777;
}
```

- [ ] **Step 5: GREEN とコミット**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-errors.test.ts test/output-window.test.tsx
npx prettier --write "apps/desktop/src/renderer/**/*.{ts,tsx,css}" "apps/desktop/test/*.test.*"
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}"
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): run the conversion and list the result in the output window"
```

Expected: `ladder-errors` が `Tests  6 passed (6)`、`output-window` が `Tests  5 passed (5)`。

---

## Task 7: デバイスコメント欄と I/O テーブル

**Files:**
- Create: `apps/desktop/src/renderer/ladder/CommentPanel.tsx`
- Create: `apps/desktop/src/renderer/ladder/IoTable.tsx`
- Modify: `apps/desktop/src/renderer/ladder/ladder.module.css`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（**MERGE 注意 #1**）
- Test: `apps/desktop/test/ladder-panels.test.tsx`

§10.7 のデバイスコメントと、§7.6 の I/O割付表。**I/Oテーブルは「課題が与えた割付」だけを出し、配線できているかどうかは出さない**（決定表#7）。

| 決めること | 本タスクの実装 |
|---|---|
| コメントの並び | いまのラダーが使っているデバイス（`compile()` を通さず IR を走査）を方言表記の昇順で並べ、各行に入力欄を出す。キーは `deviceLabel()`（ベンダー中立）で、表示だけ `profile.formatDevice()` |
| 上限 | 1件32文字・200件（ストアの `setDeviceComment` が守る）。件数が上限のときは新しいデバイスの欄を淡色にして注記を出す |
| I/Oテーブル | `resolvePlcIo(problem.io)` の `inputs` / `outputs` をそのまま表にする。`mode: 'fixed'` なら「この割付どおりに配線します」、`'free'` なら「推奨の割付です（変更できます）」を添える（§7.6） |
| 結線方式 | `io.wiring`（`sink` / `source`）を §10.2 の言葉で出す（「シンク結線（P → S/S）」） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/ladder-panels.test.tsx`:

```tsx
import { PLC_UNIT_FX5U } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, resolvePlcIo } from '@ojt/content';
import { endNetwork, hline, IR_COLS, network, no, out, program, T, ton, X, Y, type Cell } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommentPanel } from '../src/renderer/ladder/CommentPanel.js';
import { IoTable } from '../src/renderer/ladder/IoTable.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const ladder = program(
  network('n1', [rung(no(X(0)), out(Y(0)))]),
  network('n2', [rung(no({ kind: 'input', index: 8 }), ton(T(0), 3000))]),
  endNetwork(),
);

describe('デバイスコメント欄（§10.7）', () => {
  it('lists every device the ladder uses in the dialect notation', () => {
    render(
      <CommentPanel program={ladder} profile={MITSUBISHI_FX5U} comments={{}} onChange={() => undefined} />,
    );
    // X8 は三菱表記で X10
    expect(screen.getByTestId('comment-X0')).toBeInTheDocument();
    expect(screen.getByTestId('comment-X8')).toHaveTextContent('X10');
    expect(screen.getByTestId('comment-Y0')).toBeInTheDocument();
    expect(screen.getByTestId('comment-T0')).toBeInTheDocument();
  });

  it('keys the comment on the vendor-neutral label (§10.7)', () => {
    const onChange = vi.fn();
    render(
      <CommentPanel program={ladder} profile={MITSUBISHI_FX5U} comments={{}} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId('comment-input-X8'), { target: { value: '停止' } });
    expect(onChange).toHaveBeenCalledWith('X8', '停止');
  });

  it('shows the comment that is already stored', () => {
    render(
      <CommentPanel
        program={ladder}
        profile={MITSUBISHI_FX5U}
        comments={{ X0: '運転押ボタン' }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('comment-input-X0')).toHaveValue('運転押ボタン');
  });

  it('warns when the comment cap is reached', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 200; i += 1) many[`M${String(i)}`] = 'x';
    render(
      <CommentPanel program={ladder} profile={MITSUBISHI_FX5U} comments={many} onChange={() => undefined} />,
    );
    expect(screen.getByTestId('comment-cap')).toHaveTextContent('200');
  });
});

describe('I/Oテーブル（§7.6 / 決定表#7 / #16）', () => {
  const problem = BUILTIN_PLC_PROBLEMS[0]!;
  const io = resolvePlcIo(problem.io);
  const unit = PLC_UNIT_FX5U;

  it('lists the assignment the problem gives', () => {
    render(<IoTable io={io} profile={MITSUBISHI_FX5U} unit={unit} />);
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('X0');
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('PB1');
    expect(screen.getByTestId('io-output-0')).toHaveTextContent('Y0');
    expect(screen.getByTestId('io-output-0')).toHaveTextContent('CR1');
    expect(screen.getByTestId('io-output-0')).toHaveTextContent('PL1');
  });

  it('takes the terminal name from the unit spec, not from the decimal index (決定表#16)', () => {
    const wide = {
      ...io,
      inputs: [{ x: 10, pb: 'PB1' as const }],
      outputs: [{ y: 8, cr: 'CR1' as const, pl: 'PL1' as const }],
    };
    render(<IoTable io={wide} profile={MITSUBISHI_FX5U} unit={unit} />);
    // IR の 10 番目の入力は FX5U の端子 X12、8 番目の出力は Y10（どちらも8進）
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('PLC.X12');
    expect(screen.getByTestId('io-output-0')).toHaveTextContent('PLC.Y10');
  });

  it('says whether the assignment is fixed or a suggestion', () => {
    render(<IoTable io={{ ...io, mode: 'fixed' }} profile={MITSUBISHI_FX5U} unit={unit} />);
    expect(screen.getByTestId('io-mode')).toHaveTextContent('この割付どおり');
  });

  it('names the common wiring style (§10.2)', () => {
    render(<IoTable io={{ ...io, wiring: 'sink' }} profile={MITSUBISHI_FX5U} unit={unit} />);
    expect(screen.getByTestId('io-wiring')).toHaveTextContent('シンク');
  });

  it('never says whether the trainee has wired it (決定表#7)', () => {
    const { container } = render(<IoTable io={io} profile={MITSUBISHI_FX5U} unit={unit} />);
    for (const forbidden of ['未配線', '配線済', '直結', '2段']) {
      expect(container.textContent ?? '').not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: RED を確認し、Step 3 で `CommentPanel.tsx` を書く**

```tsx
import { deviceLabel, type Cell, type Device, type LadderProgram } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { useMemo, type JSX } from 'react';
import { DEVICE_COMMENT_COUNT_LIMIT, DEVICE_COMMENT_LIMIT } from '../app/store.js';
import { commentCapText, JA } from '../i18n/ja.js';
import styles from './ladder.module.css';

/**
 * デバイスコメント欄。設計仕様 §10.7。
 * キーは**ベンダー中立の表示名**（`deviceLabel()` が返す `X0` / `M1`）で、画面に出すときだけ
 * 方言表記（`profile.formatDevice()`）に直す。作業ファイルにもこの形のまま入る（3A 引渡し表）。
 */

/** セルが参照するデバイスを集める。 */
function devicesOf(program: LadderProgram): Device[] {
  const seen = new Map<string, Device>();
  const add = (device: Device): void => {
    const key = deviceLabel(device);
    if (!seen.has(key)) seen.set(key, device);
  };
  const visit = (cell: Cell): void => {
    if ('device' in cell) add(cell.device);
    if (cell.kind === 'counter') add(cell.resetDevice);
  };
  for (const net of program.networks) for (const row of net.cells) for (const cell of row) visit(cell);
  return [...seen.values()];
}

/** デバイスコメント欄。 */
export function CommentPanel({
  program,
  profile,
  comments,
  onChange,
}: {
  program: LadderProgram;
  profile: DialectProfile;
  comments: Record<string, string>;
  onChange: (device: string, text: string) => void;
}): JSX.Element {
  const rows = useMemo(
    () =>
      devicesOf(program)
        .map((device) => ({ key: deviceLabel(device), text: profile.formatDevice(device) }))
        .sort((a, b) => a.text.localeCompare(b.text, 'ja')),
    [program, profile],
  );
  const full = Object.keys(comments).length >= DEVICE_COMMENT_COUNT_LIMIT;
  return (
    <section className={styles.side} aria-label={JA.ladder.comments} data-testid="comment-panel">
      <h2 className={styles.sideTitle}>{JA.ladder.comments}</h2>
      {full ? (
        <p className={styles.sideNote} data-testid="comment-cap">
          {commentCapText(DEVICE_COMMENT_COUNT_LIMIT)}
        </p>
      ) : null}
      {rows.length === 0 ? <p className={styles.sideNote}>{JA.ladder.noDevices}</p> : null}
      <ul className={styles.commentList}>
        {rows.map((row) => (
          <li key={row.key} data-testid={`comment-${row.key}`}>
            <span className={styles.commentDevice}>{row.text}</span>
            <input
              data-testid={`comment-input-${row.key}`}
              aria-label={`${row.text} ${JA.ladder.comment}`}
              maxLength={DEVICE_COMMENT_LIMIT}
              value={comments[row.key] ?? ''}
              disabled={full && comments[row.key] === undefined}
              onChange={(event) => {
                onChange(row.key, event.target.value);
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: `IoTable.tsx` を書く**

```tsx
import type { PlcUnitDefinition } from '@ojt/board-model';
import type { ResolvedPlcIo } from '@ojt/content';
import { X, Y } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './ladder.module.css';

/**
 * I/O割付表。設計仕様 §7.6 / §10.2。
 *
 * **課題が与えた割付だけ**を出す。いまの配線がその割付どおりかどうかは**出さない**
 * （`ioAssignment` / `twoStage` は判定時の静的チェックで、セッション中に漏らすと
 *  §16 Phase 3 の受入基準④⑤が体験として成立しない。決定表#7）。
 *
 * 「ラダーのデバイス名」は方言（`profile.formatDevice`）から、「PLC本体の端子名」は機種
 * （`unit.spec`）から引く。三菱では両方とも8進で一致するが、根拠が違う（決定表#16）。
 */
export function IoTable({
  io,
  profile,
  unit,
}: {
  io: ResolvedPlcIo;
  profile: DialectProfile;
  unit: PlcUnitDefinition;
}): JSX.Element {
  return (
    <section className={styles.side} aria-label={JA.ladder.ioTable} data-testid="io-table">
      <h2 className={styles.sideTitle}>{JA.ladder.ioTable}</h2>
      <p className={styles.sideNote} data-testid="io-mode">
        {io.mode === 'fixed' ? JA.ladder.ioFixed : JA.ladder.ioFree}
      </p>
      <p className={styles.sideNote} data-testid="io-wiring">
        {io.wiring === 'sink' ? JA.ladder.wiringSink : JA.ladder.wiringSource}
      </p>
      <table className={styles.ioTable}>
        <thead>
          <tr>
            <th>{JA.ladder.ioDevice}</th>
            <th>{JA.ladder.ioTerminal}</th>
            <th>{JA.ladder.ioTarget}</th>
          </tr>
        </thead>
        <tbody>
          {io.inputs.map((input, index) => (
            <tr key={`in-${String(index)}`} data-testid={`io-input-${String(index)}`}>
              <td>{profile.formatDevice(X(input.x))}</td>
              <td>{`PLC.${unit.spec.inputs[input.x] ?? ''}`}</td>
              <td>{input.pb}</td>
            </tr>
          ))}
          {io.outputs.map((output, index) => (
            <tr key={`out-${String(index)}`} data-testid={`io-output-${String(index)}`}>
              <td>{profile.formatDevice(Y(output.y))}</td>
              <td>{`PLC.${unit.spec.outputs[output.y]?.name ?? ''}`}</td>
              <td>
                {output.cr} → {output.pl}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

`ja.ts` の `ladder` へ追記:

```ts
    comments: 'デバイスコメント',
    comment: 'コメント',
    noDevices: 'まだデバイスを置いていません。',
    ioTable: 'I/O割付',
    ioDevice: 'デバイス',
    /** PLC本体の端子名（機種の8進表記）。決定表#16 */
    ioTerminal: 'PLC端子',
    ioTarget: '割当',
    /** §7.6 `io.mode` */
    ioFixed: 'この割付どおりに配線します。',
    ioFree: '推奨の割付です（変更できます）。',
    /** §10.2 入力コモンの結線 */
    wiringSink: 'シンク結線（P → S/S、PBのa接点 → X、PBのc端子 → N）',
    wiringSource: 'ソース結線（N → S/S、PBのa接点 → X、PBのc端子 → P）',
```

```ts
/** デバイスコメントの上限に達した注記。§10.7 */
export function commentCapText(limit: number): string {
  return `デバイスコメントは ${String(limit)} 件までです（新しい欄は入力できません）`;
}
```

CSS（追記）:

```css
.side {
  border-top: 1px solid #d5d8de;
  padding: 6px 8px;
  font-size: 12px;
  max-height: 200px;
  overflow: auto;
}

.sideTitle {
  font-size: 12px;
  margin: 0 0 4px;
}

.sideNote {
  margin: 2px 0;
  color: #555;
}

.commentList {
  list-style: none;
  margin: 0;
  padding: 0;
}

.commentList li {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 6px;
  align-items: center;
  margin-bottom: 2px;
}

.commentDevice {
  font-weight: 700;
}

.ioTable {
  width: 100%;
  border-collapse: collapse;
}

.ioTable th,
.ioTable td {
  border-bottom: 1px solid #e4e7ec;
  text-align: left;
  padding: 2px 4px;
}
```

- [ ] **Step 5: GREEN とコミット**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-panels.test.tsx
npx prettier --write "apps/desktop/src/renderer/**/*.{ts,tsx,css}" "apps/desktop/test/ladder-panels.test.tsx"
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): add the device comment panel and the I/O table"
```

Expected: `Tests  9 passed (9)`。

---

## Task 8: GX Works3風の枠（プロジェクトツリー・ツールバー・キー割当表）

**Files:**
- Create: `apps/desktop/src/renderer/ladder/ProjectTree.tsx`
- Create: `apps/desktop/src/renderer/ladder/ShortcutHelp.tsx`
- Create: `apps/desktop/src/renderer/ladder/LadderWorkspace.tsx`
- Modify: `apps/desktop/src/renderer/ladder/LadderEditor.tsx`（`errorCells` を props で受ける）
- Modify: `apps/desktop/src/renderer/ladder/ladder.module.css`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（**MERGE 注意 #1**）
- Test: `apps/desktop/test/ladder-workspace.test.tsx`

§10.6 の「ナビゲーションウィンドウ ＋ ラダーエディタ ＋ 出力ウィンドウ」を1つの枠に組む。名称は `profile.panels` から引く（**ベンダーのロゴ・アイコン・画面キャプチャは使わない**。§17）。

| 決めること | 本タスクの実装 |
|---|---|
| ツールバー | `profile.panels.toolbar` の8項目を**そのまま並べる**。Phase 3 で実体があるのは「変換」「全変換」（同じ動作）「書込みモード」「読出しモード」「モニタ開始」「モニタ停止」の6つで、「オンライン」「シーケンサへの書込み」は**押すと `loadLadder` を送る**（本アプリでは変換＝書込み相当なので、押しても変換済みのラダーを送り直すだけ）。それぞれに注記を出す |
| 回路ブロックの操作 | `SHORTCUTS` に無いので**ボタンで出す**（決定表#12。キーを勝手に足さない）: 「回路ブロック挿入」「回路ブロック削除」「行挿入」「行削除」 |
| プロジェクトツリー | `profile.panels.tree` の名前で、`プログラム > MAIN > <ネットワークID>` の木を出す。クリックでカーソルがそのネットワークへ飛ぶ |
| キー割当表 | `profile.shortcuts` を表にし、`confirmed: false` に §12.1 の注記（「実機マニュアル未確認のため本アプリの表記です」）、`enabled: false` に `note` を添える |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/ladder-workspace.test.tsx`:

```tsx
import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { ShortcutHelp } from '../src/renderer/ladder/ShortcutHelp.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.getState().openProblem(problem);
});

function workspace(onPlc = vi.fn()) {
  render(<LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={onPlc} />);
  return onPlc;
}

describe('GX Works3風の枠（§10.6 / §17）', () => {
  it('names the three panels from the profile', () => {
    workspace();
    expect(screen.getByTestId('project-tree')).toHaveAccessibleName(MITSUBISHI_FX5U.panels.tree);
    expect(screen.getByTestId('ladder-editor')).toHaveAccessibleName(MITSUBISHI_FX5U.panels.editor);
    expect(screen.getByTestId('output-window')).toHaveAccessibleName(MITSUBISHI_FX5U.panels.output);
  });

  it('lists the toolbar items the skin names', () => {
    workspace();
    for (const label of MITSUBISHI_FX5U.panels.toolbar) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'u') })).toBeInTheDocument();
    }
  });

  it('converts and sends the ladder to the worker when it succeeds (H-1)', () => {
    const onPlc = workspace();
    // 空のラダーは END しか無いので変換に落ちる（コイルが無い）
    fireEvent.click(screen.getByTestId('toolbar-convert'));
    expect(useStore.getState().converted).toBe(false);
    expect(onPlc).not.toHaveBeenCalled();
    expect(screen.getAllByTestId(/^output-row-/u).length).toBeGreaterThan(0);
  });

  it('adds and removes networks with buttons, not invented keys (決定表#12)', () => {
    workspace();
    fireEvent.click(screen.getByTestId('toolbar-insert-network'));
    expect(useStore.getState().ladder?.networks.map((n) => n.id)).toEqual(['n1', 'n2', 'end']);
    useStore.getState().setLadderCursor({ networkId: 'n2', row: 0, col: 0 });
    fireEvent.click(screen.getByTestId('toolbar-delete-network'));
    expect(useStore.getState().ladder?.networks.map((n) => n.id)).toEqual(['n1', 'end']);
  });

  it('inserts and deletes rows inside a network', () => {
    workspace();
    fireEvent.click(screen.getByTestId('toolbar-insert-row'));
    expect(useStore.getState().ladder?.networks[0]?.rows).toBe(2);
    fireEvent.click(screen.getByTestId('toolbar-delete-row'));
    expect(useStore.getState().ladder?.networks[0]?.rows).toBe(1);
  });

  it('jumps the cursor from the project tree', () => {
    workspace();
    fireEvent.click(screen.getByTestId('toolbar-insert-network'));
    fireEvent.click(screen.getByTestId('tree-network-n2'));
    expect(useStore.getState().ladderCursor).toEqual({ networkId: 'n2', row: 0, col: 0 });
  });

  it('starts and stops monitoring through the worker', () => {
    const onPlc = workspace();
    fireEvent.click(screen.getByTestId('toolbar-monitor-start'));
    expect(useStore.getState().ladderMode).toBe('monitor');
    expect(onPlc).toHaveBeenCalledWith({ kind: 'monitor', on: true });
    fireEvent.click(screen.getByTestId('toolbar-monitor-stop'));
    expect(useStore.getState().ladderMode).toBe('read');
    expect(onPlc).toHaveBeenCalledWith({ kind: 'monitor', on: false });
  });
});

describe('キー割当表（§12.1 / §17.1）', () => {
  it('shows every shortcut the profile declares', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getAllByTestId(/^shortcut-/u)).toHaveLength(MITSUBISHI_FX5U.shortcuts.length);
    expect(screen.getByTestId('shortcut-contact-no')).toHaveTextContent('F5');
  });

  it('marks the assumed bindings with the §12.1 notice', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcut-convert')).toHaveTextContent('本アプリの表記');
    expect(screen.getByTestId('shortcut-contact-no')).not.toHaveTextContent('本アプリの表記');
  });

  it('greys out and explains the entry Phase 3 cannot place', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcut-application')).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByTestId('shortcut-application')).toHaveTextContent('Phase 4');
  });

  it('says the table is swapped with the vendor (Phase 4)', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcut-note')).toHaveTextContent('メーカー');
  });
});
```

- [ ] **Step 2: RED を確認し、Step 3 で `ProjectTree.tsx` / `ShortcutHelp.tsx` を書く**

```tsx
// ProjectTree.tsx
import type { LadderProgram } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './ladder.module.css';

/**
 * ナビゲーションウィンドウ（プロジェクトツリー）。設計仕様 §10.6。
 * 名称はスキン（`profile.panels.tree`）から引く。**ベンダーのアイコンは使わない**（§17）。
 */
export function ProjectTree({
  program,
  profile,
  currentNetworkId,
  onPick,
}: {
  program: LadderProgram;
  profile: DialectProfile;
  currentNetworkId: string;
  onPick: (networkId: string) => void;
}): JSX.Element {
  return (
    <nav className={styles.tree} data-testid="project-tree" aria-label={profile.panels.tree}>
      <p className={styles.treeRoot}>{JA.ladder.treeProgram}</p>
      <ul className={styles.treeList}>
        <li>
          {JA.ladder.treeMain}
          <ul>
            {program.networks.map((net) => (
              <li key={net.id}>
                <button
                  type="button"
                  data-testid={`tree-network-${net.id}`}
                  aria-current={net.id === currentNetworkId}
                  onClick={() => {
                    onPick(net.id);
                  }}
                >
                  {net.id}
                  {net.comment === undefined ? '' : `（${net.comment}）`}
                </button>
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </nav>
  );
}
```

```tsx
// ShortcutHelp.tsx
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './ladder.module.css';

/**
 * キー割当表。設計仕様 §10.6 / §12.1 / §17.1。
 *
 * 表の中身は `DialectProfile.shortcuts` がすべて持っている（決定表#12）。`confirmed: false` は
 * 一次資料が未確認のまま §17.1 の前提方針で採用した割当なので、§12.1 の注記を添える。
 * Phase 4 でメーカーを足すと、この画面は**プロファイルを差し替えるだけ**で追随する。
 */
export function ShortcutHelp({ profile }: { profile: DialectProfile }): JSX.Element {
  return (
    <section className={styles.side} aria-label={JA.ladder.shortcuts} data-testid="shortcut-help">
      <h2 className={styles.sideTitle}>
        {JA.ladder.shortcuts}（{profile.displayName}）
      </h2>
      <p className={styles.sideNote} data-testid="shortcut-note">
        {JA.ladder.shortcutNote}
      </p>
      <table className={styles.ioTable}>
        <tbody>
          {profile.shortcuts.map((entry) => (
            <tr
              key={entry.action}
              data-testid={`shortcut-${entry.action}`}
              data-enabled={entry.enabled !== false}
              className={entry.enabled === false ? styles.shortcutOff : undefined}
            >
              <td>{entry.keys}</td>
              <td>{entry.label}</td>
              <td className={styles.sideNote}>
                {entry.confirmed ? '' : JA.settings.assumptionNotice}
                {entry.note === undefined ? '' : ` ${entry.note}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 4: `LadderWorkspace.tsx` を書く**

```tsx
import { PLC_UNIT_FX5U, plcUnitFor } from '@ojt/board-model';
import { isPlcProblem, resolvePlcIo, type PlcProblem } from '@ojt/content';
import { deleteNetwork, deleteRow, empty, insertNetwork, insertRow, network } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { useCallback, useMemo, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { nextNetworkId, type LadderEditorMode } from '../session/ladder.js';
import { errorCellKeys, runConvert } from '../session/ladder-errors.js';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { CommentPanel } from './CommentPanel.js';
import { IoTable } from './IoTable.js';
import { LadderEditor } from './LadderEditor.js';
import { OutputWindow } from './OutputWindow.js';
import { ProjectTree } from './ProjectTree.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import styles from './ladder.module.css';

/**
 * GX Works3“風”のワークスペース。設計仕様 §10.6。
 *
 * 画面の構成（ナビゲーションウィンドウ・ラダーエディタ・出力ウィンドウ）とツールバーの項目名は
 * すべて `DialectProfile.panels` から引く。**各社のロゴ・アイコン・画面キャプチャ・図記号
 * ビットマップは一切使わない**（§17 / PLC調査資料 §6）。
 */

/** ツールバーの項目 → 押したときの意味。`profile.panels.toolbar` の並び順で引く。 */
type ToolbarAction =
  | 'convert'
  | 'convert-all'
  | 'write-mode'
  | 'read-mode'
  | 'online'
  | 'download'
  | 'monitor-start'
  | 'monitor-stop';

/** `panels.toolbar` の並び（§10.6 のスキン定義と同じ順）に対応させる。 */
const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
  'convert',
  'convert-all',
  'write-mode',
  'read-mode',
  'online',
  'download',
  'monitor-start',
  'monitor-stop',
];

/** ラダーのワークスペース。 */
export function LadderWorkspace({
  problem,
  profile,
  gridCols,
  onPlc,
}: {
  problem: PlcProblem;
  profile: DialectProfile;
  gridCols: number;
  /** Worker への `plc` コマンド（親がブリッジへ流す）。§10.4 */
  onPlc: (action: PlcCommandAction) => void;
}): JSX.Element {
  const program = useStore((s) => s.ladder);
  const cursor = useStore((s) => s.ladderCursor);
  const comments = useStore((s) => s.ladderComments);
  const issues = useStore((s) => s.convertIssues);
  const converted = useStore((s) => s.converted);
  const io = useMemo(() => resolvePlcIo(problem.io), [problem]);
  /** 機種の端子名はここから引く（決定表#16）。課題の機種が未対応なら FX5U に倒す。 */
  const unit = useMemo(() => plcUnitFor(problem.plc.model) ?? PLC_UNIT_FX5U, [problem]);
  const errorCells = useMemo(() => errorCellKeys(issues.errors), [issues]);

  /** 「変換」。成功したときだけ Worker へ載せる（H-1）。§10.6 */
  const convert = useCallback((): void => {
    const store = useStore.getState();
    const current = store.ladder;
    if (current === undefined) return;
    const run = runConvert(current, profile);
    store.setConverted(run.ok, run.issues);
    if (!run.ok) {
      store.toast(JA.ladder.convertFailed, 'error');
      return;
    }
    onPlc({ kind: 'load', program: current });
    store.toast(JA.ladder.convertOk);
  }, [onPlc, profile]);

  /** 書込み／読出し／モニタ。モニタの開始停止は Worker にも伝える（決定表#5）。 */
  const changeMode = useCallback(
    (mode: LadderEditorMode): void => {
      useStore.getState().setLadderMode(mode);
      onPlc({ kind: 'monitor', on: mode === 'monitor' });
    },
    [onPlc],
  );

  const edit = useCallback((next: ReturnType<typeof insertRow>): void => {
    useStore.getState().setLadder(next);
  }, []);

  if (program === undefined || !isPlcProblem(problem)) {
    return <div className={styles.workspace} data-testid="ladder-workspace" />;
  }

  const onToolbar = (action: ToolbarAction): void => {
    const store = useStore.getState();
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
          store.toast(JA.ladder.notConverted, 'error');
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
    }
  };

  return (
    <div className={styles.workspace} data-testid="ladder-workspace">
      <div className={styles.toolbar} role="toolbar" aria-label={JA.ladder.title}>
        {profile.panels.toolbar.map((label, index) => {
          const action = TOOLBAR_ACTIONS[index] ?? 'convert';
          return (
            <button
              key={label}
              type="button"
              data-testid={`toolbar-${action}`}
              onClick={() => {
                onToolbar(action);
              }}
            >
              {label}
            </button>
          );
        })}
        <span className={styles.toolbarGap} />
        {/* 回路ブロック・行の操作はショートカット表に無いのでボタンで出す（決定表#12） */}
        <button
          type="button"
          data-testid="toolbar-insert-network"
          onClick={() => {
            const id = nextNetworkId(program);
            const index = program.networks.findIndex((net) => net.id === cursor.networkId);
            edit(insertNetwork(program, index < 0 ? 0 : index + 1, network(id, [[empty()]])));
            useStore.getState().setLadderCursor({ networkId: id, row: 0, col: 0 });
          }}
        >
          {JA.ladder.insertNetwork}
        </button>
        <button
          type="button"
          data-testid="toolbar-delete-network"
          disabled={program.networks.length <= 2}
          onClick={() => {
            edit(deleteNetwork(program, cursor.networkId));
            const first = program.networks[0];
            if (first !== undefined) {
              useStore.getState().setLadderCursor({ networkId: first.id, row: 0, col: 0 });
            }
          }}
        >
          {JA.ladder.deleteNetwork}
        </button>
        <button
          type="button"
          data-testid="toolbar-insert-row"
          onClick={() => {
            edit(insertRow(program, cursor.networkId, cursor.row + 1));
          }}
        >
          {JA.ladder.insertRow}
        </button>
        <button
          type="button"
          data-testid="toolbar-delete-row"
          onClick={() => {
            edit(deleteRow(program, cursor.networkId, cursor.row));
            useStore.getState().setLadderCursor({ ...cursor, row: Math.max(0, cursor.row - 1) });
          }}
        >
          {JA.ladder.deleteRow}
        </button>
      </div>

      <div className={styles.workspaceBody}>
        <ProjectTree
          program={program}
          profile={profile}
          currentNetworkId={cursor.networkId}
          onPick={(networkId) => {
            useStore.getState().setLadderCursor({ networkId, row: 0, col: 0 });
          }}
        />
        <div className={styles.workspaceMain}>
          <LadderEditor
            profile={profile}
            gridCols={gridCols}
            errorCells={errorCells}
            onConvert={convert}
            onModeChange={changeMode}
          />
          <OutputWindow
            issues={issues}
            converted={converted}
            onJump={(next) => {
              useStore.getState().setLadderCursor(next);
            }}
          />
        </div>
        <div className={styles.workspaceSide}>
          <IoTable io={io} profile={profile} unit={unit} />
          <CommentPanel
            program={program}
            profile={profile}
            comments={comments}
            onChange={(device, text) => {
              useStore.getState().setDeviceComment(device, text);
            }}
          />
          <ShortcutHelp profile={profile} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `LadderEditor.tsx` の `errorCells` を props にする（Task 5 の積み残し）**

`LadderEditor` の props に `errorCells: ReadonlySet<string>` を足し、`useStore((s) => s.convertIssues.errors)` の購読と `new Set(...)` の組み立てを**消して** `errorCells` をそのまま `LadderGrid` へ渡す。`LadderGrid` の `memo` を効かせるため、`Set` は `LadderWorkspace` の `useMemo` が持つ。

- [ ] **Step 6: CSS と `ja.ts`、GREEN とコミット**

CSS（追記）:

```css
.workspace {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #eef0f4;
  border-right: 1px solid #d5d8de;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 6px;
  background: #e4e7ec;
  border-bottom: 1px solid #d5d8de;
}

.toolbarGap {
  flex: 1 1 auto;
}

.workspaceBody {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr) 210px;
  min-height: 0;
  flex: 1 1 auto;
}

.workspaceMain {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.workspaceSide {
  border-left: 1px solid #d5d8de;
  overflow: auto;
  background: #fff;
}

.tree {
  border-right: 1px solid #d5d8de;
  padding: 6px;
  font-size: 12px;
  background: #fff;
  overflow: auto;
}

.treeRoot {
  font-weight: 700;
  margin: 0 0 4px;
}

.treeList,
.treeList ul {
  list-style: none;
  margin: 0;
  padding-left: 10px;
}

.treeList button {
  background: none;
  border: none;
  padding: 1px 2px;
  cursor: pointer;
  font: inherit;
}

.treeList button[aria-current='true'] {
  font-weight: 700;
  color: #1e64ff;
}

.shortcutOff {
  color: #999;
}
```

`ja.ts` の `ladder` へ追記:

```ts
    treeProgram: 'プログラム',
    treeMain: 'MAIN',
    shortcuts: 'キー割当',
    shortcutNote: 'キー割当はメーカー（方言プロファイル）ごとに切り替わります。',
    insertNetwork: '回路ブロック挿入',
    deleteNetwork: '回路ブロック削除',
    insertRow: '行挿入',
    deleteRow: '行削除',
    convertFailed: '変換できませんでした（出力ウィンドウを確認してください）',
    downloaded: 'シーケンサへ書き込みました（変換済みのラダーを反映）',
```

```powershell
pnpm --filter @ojt/desktop exec vitest run test/ladder-workspace.test.tsx test/ladder-editor.test.tsx
npx prettier --write "apps/desktop/src/renderer/**/*.{ts,tsx,css}" "apps/desktop/test/ladder-*.test.*"
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): compose the GX Works3-style workspace"
```

Expected: `ladder-workspace` が `Tests  11 passed (11)`、`ladder-editor` も引き続き通る。

---

## Task 9: モニタ（F3）とRUN/STOP

**Files:**
- Create: `apps/desktop/src/renderer/ladder/MonitorPanel.tsx`
- Modify: `apps/desktop/src/renderer/ladder/LadderWorkspace.tsx`（RUN/STOP と `MonitorPanel` の差し込み）
- Modify: `apps/desktop/src/renderer/ladder/ladder.module.css`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（**MERGE 注意 #1**）
- Test: `apps/desktop/test/monitor-panel.test.tsx`

モニタ中のデバイス値を一覧で出し、RUN/STOP を操作する。**通電表示そのものは Task 4 の `LadderGrid` が描く**ので、ここは数値の一覧と RUN/STOP だけを持つ。

| 決めること | 本タスクの実装 |
|---|---|
| 再描画の範囲 | `plcMonitor` を購読するのは **`MonitorPanel` と `LadderGrid` だけ**。`LadderGrid` は `powered[net.id]` の**文字列1本**を見る（決定表#5）ので、値が変わらないネットワークは再描画されない。セッション画面本体・3D・右パネルは `plcMonitor` を購読しない |
| 一覧の中身 | 入力（`X` ＋ **PLCの端子名**）／出力（`Y` ＋ 端子名）／内部リレー／タイマ（経過 ms と設定値）／カウンタ（現在値）。デバイス名は `profile.formatDevice()`、端子名は `unit.spec`（決定表#16） |
| 入力仕様の注記 | FX5U の値（4.5kΩ／ON 3.5mA／OFF 1.5mA）を `@ojt/board-model` の `FX5U_INPUT_OHMS` / `FX5U_ON_AMPS` / `FX5U_OFF_AMPS` から出す（`circuit-sim` の既定値ではない） |
| RUN/STOP | ツールバーの外に独立したボタンを置く。`plcRunning` はストアが持ち、押すと `plc { kind:'run', on }` を送る。STOP 中はモニタの値を出したまま「停止中」を添える |
| モニタとRUNの関係 | RUN していないときにモニタを開始したら、「RUN にすると動きます」と注記を出す（止まったまま光らない理由が分からないため） |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/monitor-panel.test.tsx`:

```tsx
import { PLC_UNIT_FX5U } from '@ojt/board-model';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { MonitorPanel } from '../src/renderer/ladder/MonitorPanel.js';

function snapshot(overrides: Partial<PlcMonitorSnapshot> = {}): PlcMonitorSnapshot {
  return {
    scanCount: 12,
    tMs: 120,
    powered: {},
    inputs: [true, false, false],
    outputs: [false, true],
    internals: { 0: true },
    timers: { 0: { elapsedMs: 1200, on: false } },
    counters: { 0: { value: 2, on: false } },
    ...overrides,
  };
}

function panel(onPlc = vi.fn()) {
  render(<MonitorPanel profile={MITSUBISHI_FX5U} unit={PLC_UNIT_FX5U} onPlc={onPlc} />);
  return onPlc;
}

beforeEach(() => {
  useStore.setState({ plcMonitor: undefined, plcRunning: false, ladderMode: 'write' });
});

describe('モニタ一覧（§10.7）', () => {
  it('asks to start monitoring while it is off', () => {
    panel();
    expect(screen.getByTestId('monitor-off')).toHaveTextContent('F3');
  });

  it('lists the devices with the dialect name and the unit terminal name (決定表#16)', () => {
    useStore.setState({ plcMonitor: snapshot(), ladderMode: 'monitor', plcRunning: true });
    panel();
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('X0');
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('PLC.X0');
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('ON');
    expect(screen.getByTestId('monitor-output-1')).toHaveTextContent('Y1');
    expect(screen.getByTestId('monitor-output-1')).toHaveTextContent('ON');
    expect(screen.getByTestId('monitor-internal-0')).toHaveTextContent('M0');
    expect(screen.getByTestId('monitor-timer-0')).toHaveTextContent('1.2');
    expect(screen.getByTestId('monitor-counter-0')).toHaveTextContent('2');
    expect(screen.getByTestId('monitor-scan')).toHaveTextContent('12');
  });

  it('names the FX5U input spec, not the engine defaults (3A レビュー指摘)', () => {
    useStore.setState({ plcMonitor: snapshot(), ladderMode: 'monitor' });
    panel();
    const note = screen.getByTestId('monitor-spec');
    expect(note).toHaveTextContent('4.5');
    expect(note).toHaveTextContent('3.5');
    expect(note).not.toHaveTextContent('4.7');
  });

  it('runs and stops the PLC through the worker', () => {
    const onPlc = panel();
    fireEvent.click(screen.getByTestId('plc-run'));
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: true });
    expect(useStore.getState().plcRunning).toBe(true);
    fireEvent.click(screen.getByTestId('plc-run'));
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: false });
    expect(useStore.getState().plcRunning).toBe(false);
  });

  it('explains why nothing moves while the PLC is stopped', () => {
    useStore.setState({ plcMonitor: snapshot(), ladderMode: 'monitor', plcRunning: false });
    panel();
    expect(screen.getByTestId('monitor-stopped')).toHaveTextContent('RUN');
  });

  it('resets the devices from the panel', () => {
    const onPlc = panel();
    fireEvent.click(screen.getByTestId('plc-reset'));
    expect(onPlc).toHaveBeenCalledWith({ kind: 'reset' });
  });
});
```

- [ ] **Step 2: RED を確認し、Step 3 で `MonitorPanel.tsx` を書く**

```tsx
import {
  FX5U_INPUT_OHMS,
  FX5U_OFF_AMPS,
  FX5U_ON_AMPS,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { C, M, T, X, Y } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA, onOffLabel, plcInputSpecText, secondsLabel } from '../i18n/ja.js';
import type { PlcCommandAction } from '../../worker/protocol.js';
import styles from './ladder.module.css';

/**
 * モニタのデバイス一覧と RUN/STOP。設計仕様 §10.6 / §10.7。
 *
 * **`plcMonitor` を購読するのはこの部品と `LadderGrid` だけ**にする（決定表#5）。セッション画面の
 * 本体や3Dがこれを購読すると、毎秒30枚のスナップショットで盤ごと再描画されてしまう（§15）。
 */
export function MonitorPanel({
  profile,
  unit,
  onPlc,
}: {
  profile: DialectProfile;
  unit: PlcUnitDefinition;
  onPlc: (action: PlcCommandAction) => void;
}): JSX.Element {
  const monitor = useStore((s) => s.plcMonitor);
  const running = useStore((s) => s.plcRunning);
  const mode = useStore((s) => s.ladderMode);
  const terminal = (name: string | undefined): string => `PLC.${name ?? ''}`;
  return (
    <section className={styles.side} aria-label={JA.ladder.monitor} data-testid="monitor-panel">
      <h2 className={styles.sideTitle}>{JA.ladder.monitor}</h2>
      <div className={styles.monitorButtons}>
        <button
          type="button"
          data-testid="plc-run"
          aria-pressed={running}
          onClick={() => {
            const next = !useStore.getState().plcRunning;
            useStore.getState().setPlcRunning(next);
            onPlc({ kind: 'run', on: next });
          }}
        >
          {running ? JA.ladder.stop : JA.ladder.run}
        </button>
        <button
          type="button"
          data-testid="plc-reset"
          onClick={() => {
            onPlc({ kind: 'reset' });
          }}
        >
          {JA.ladder.plcReset}
        </button>
      </div>
      {mode !== 'monitor' || monitor === undefined ? (
        <p className={styles.sideNote} data-testid="monitor-off">
          {JA.ladder.monitorOff}
        </p>
      ) : (
        <>
          <p className={styles.sideNote} data-testid="monitor-scan">
            {JA.ladder.scanCount}: {monitor.scanCount}（{secondsLabel(monitor.tMs)}）
          </p>
          {running ? null : (
            <p className={styles.sideNote} data-testid="monitor-stopped">
              {JA.ladder.monitorStopped}
            </p>
          )}
          <table className={styles.ioTable}>
            <tbody>
              {monitor.inputs.map((value, index) => (
                <tr key={`x-${String(index)}`} data-testid={`monitor-input-${String(index)}`}>
                  <td>{profile.formatDevice(X(index))}</td>
                  <td>{terminal(unit.spec.inputs[index])}</td>
                  <td>{onOffLabel(value)}</td>
                </tr>
              ))}
              {monitor.outputs.map((value, index) => (
                <tr key={`y-${String(index)}`} data-testid={`monitor-output-${String(index)}`}>
                  <td>{profile.formatDevice(Y(index))}</td>
                  <td>{terminal(unit.spec.outputs[index]?.name)}</td>
                  <td>{onOffLabel(value)}</td>
                </tr>
              ))}
              {Object.entries(monitor.internals).map(([index, value]) => (
                <tr key={`m-${index}`} data-testid={`monitor-internal-${index}`}>
                  <td>{profile.formatDevice(M(Number(index)))}</td>
                  <td />
                  <td>{onOffLabel(value)}</td>
                </tr>
              ))}
              {Object.entries(monitor.timers).map(([index, state]) => (
                <tr key={`t-${index}`} data-testid={`monitor-timer-${index}`}>
                  <td>{profile.formatDevice(T(Number(index)))}</td>
                  <td>{secondsLabel(state.elapsedMs)}</td>
                  <td>{onOffLabel(state.on)}</td>
                </tr>
              ))}
              {Object.entries(monitor.counters).map(([index, state]) => (
                <tr key={`c-${index}`} data-testid={`monitor-counter-${index}`}>
                  <td>{profile.formatDevice(C(Number(index)))}</td>
                  <td>{state.value}</td>
                  <td>{onOffLabel(state.on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.sideNote} data-testid="monitor-spec">
            {plcInputSpecText(FX5U_INPUT_OHMS, FX5U_ON_AMPS, FX5U_OFF_AMPS)}
          </p>
        </>
      )}
    </section>
  );
}
```

`ja.ts` の `ladder` へ追記と関数:

```ts
    monitor: 'モニタ',
    monitorOff: 'モニタ（F3）を開始すると通電状態が表示されます。',
    monitorStopped: 'PLCが停止中です。RUN にすると動きます。',
    scanCount: 'スキャン回数',
    run: 'RUN',
    stop: 'STOP',
    plcReset: 'デバイス初期化',
```

```ts
/** ミリ秒を秒表示にする（`1.2 秒`）。§10.7 */
export function secondsLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)} ${JA.session.seconds}`;
}

/**
 * PLC入力回路の仕様の注記。§5.1.3
 * 値は**機種（FX5U）側**から渡す（`circuit-sim` の既定値 4.7kΩ/3mA ではない）。
 */
export function plcInputSpecText(ohms: number, onAmps: number, offAmps: number): string {
  const mA = (amps: number): string => (amps * 1000).toFixed(1);
  return `入力回路 ${(ohms / 1000).toFixed(1)}kΩ／ON ${mA(onAmps)}mA 以上／OFF ${mA(offAmps)}mA 以下`;
}
```

CSS（追記）:

```css
.monitorButtons {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}
```

- [ ] **Step 4: `LadderWorkspace.tsx` に差し込む**

`workspaceSide` の先頭（`IoTable` の前）に `<MonitorPanel profile={profile} unit={unit} onPlc={onPlc} />` を足す。

- [ ] **Step 5: GREEN とコミット**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/monitor-panel.test.tsx test/ladder-workspace.test.tsx
npx prettier --write "apps/desktop/src/renderer/**/*.{ts,tsx,css}" "apps/desktop/test/monitor-panel.test.tsx"
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): show the monitored devices and run/stop the PLC"
```

Expected: `monitor-panel` が `Tests  6 passed (6)`。

---

## Task 10: 3DのPLC本体・壁コンセント・机上配線と `plc` 視点

**Files:**
- Create: `apps/desktop/src/renderer/three/PlcUnit.tsx`
- Create: `apps/desktop/src/renderer/three/Outlet.tsx`
- Create: `apps/desktop/src/renderer/three/DeskWires.tsx`
- Modify: `apps/desktop/src/renderer/three/camera.ts`
- Modify: `apps/desktop/src/renderer/three/BoardScene.tsx`（**MERGE 注意 #5。4箇所のみ**）
- Modify: `apps/desktop/src/renderer/panels/Toolbar.tsx`（**MERGE 注意 #6。1箇所のみ**）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（**MERGE 注意 #1**）
- Test: `apps/desktop/test/plc-scene.test.ts`
- Test: `apps/desktop/test/plc-camera.test.ts`

§10.1 の3D構成を描く。**盤の座標系の延長**として描くので、`toScene()` / `boardToWorld()` / `safeRoutes()` / E2E の射影計算がそのまま使える（意図的な差分 #1）。

| 決めること | 本タスクの実装 |
|---|---|
| 置き場所 | PLC本体・壁コンセント・机上配線はすべて**盤と同じ傾斜グループの中**に描く。`PLC_UNIT_FX5U.pos`（盤モデル座標 `(390, 18, 0)`）と `OUTLET_ORIGIN_MM`（`(395, 190, 0)`）をそのまま `toScene()` に通す |
| 端子 | `board.terminals` のうち `isOffBoardTerminal()` が真のものを `TerminalHit` で描く。当たり判定・ホバー・ピックは盤の端子と同じ仕組み（`pickRadiusMm` は 4mm） |
| 筐体 | `sizeMm`（150×90×83）の箱。入力側・出力側の端子列の背景に薄いプレートを敷き、`leds`（PWR/ERR/P.RUN/BAT/CARD）を小さな丸で並べる。**ベンダーのロゴ・銘板画像は描かない**（§17）。銘板は `displayName` の文字だけ |
| 机上配線 | `deskWires(board, session)` の `fromPos` / `toPos` を結ぶ**たるんだケーブル**（3点の `CatmullRomCurve3`。中間点を手前へ 12mm 垂らす）。色は `session.wires` の `color`（モードDは青のみ） |
| 視点 | `CameraPreset` に `'plc'`。`PLC_VIEW_RECT`（PLC本体とコンセントの外接矩形＋余白20mm）を `fitDistanceMm()` で収める。ツールバーには**モードDのときだけ**4つ目のボタンとして出す |

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/plc-camera.test.ts`:

```ts
import { JIPM_BOARD, OUTLET_ORIGIN_MM, PLC_UNIT_FX5U, withPlcUnit } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  boardToWorld,
  cameraPose,
  fitDistanceMm,
  MAX_CAMERA_DISTANCE_MM,
  MIN_CAMERA_DISTANCE_MM,
  PLC_VIEW_RECT,
} from '../src/renderer/three/camera.js';
import { projectToScreen } from '../e2e/projection.js';
import { toScene } from '../src/renderer/three/coords.js';

const BOX = { x: 0, y: 0, width: 900, height: 600 };

describe('plc 視点プリセット（§12.2 / 決定表#6）', () => {
  it('covers the PLC unit and the wall outlet', () => {
    expect(PLC_VIEW_RECT.x).toBeLessThanOrEqual(PLC_UNIT_FX5U.pos.x);
    expect(PLC_VIEW_RECT.x + PLC_VIEW_RECT.w).toBeGreaterThanOrEqual(
      PLC_UNIT_FX5U.pos.x + PLC_UNIT_FX5U.sizeMm.width,
    );
    expect(PLC_VIEW_RECT.y).toBeLessThanOrEqual(PLC_UNIT_FX5U.pos.y);
    expect(PLC_VIEW_RECT.y + PLC_VIEW_RECT.h).toBeGreaterThanOrEqual(OUTLET_ORIGIN_MM.y);
  });

  it('stays inside the distance limits', () => {
    const pose = cameraPose('plc');
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    expect(distance).toBeGreaterThanOrEqual(MIN_CAMERA_DISTANCE_MM);
    expect(distance).toBeLessThanOrEqual(MAX_CAMERA_DISTANCE_MM);
    expect(distance).toBeCloseTo(fitDistanceMm(PLC_VIEW_RECT.w, PLC_VIEW_RECT.h, 1.5), 3);
  });

  it('puts every PLC and outlet terminal inside the viewport', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const pose = cameraPose('plc');
    const offBoard = board.terminals.filter((t) => t.id.startsWith('PLC.') || t.id.startsWith('OUTLET.'));
    expect(offBoard.length).toBeGreaterThan(30);
    for (const terminal of offBoard) {
      const point = projectToScreen(boardToWorld(toScene(terminal.pos)), pose, BOX);
      expect(point.x).toBeGreaterThan(BOX.x);
      expect(point.x).toBeLessThan(BOX.x + BOX.width);
      expect(point.y).toBeGreaterThan(BOX.y);
      expect(point.y).toBeLessThan(BOX.y + BOX.height);
    }
  });

  it('does not change the other presets', () => {
    expect(cameraPose('front').position[2]).toBeGreaterThan(0);
    expect(cameraPose('socket').target[0]).toBeLessThan(0);
  });
});
```

`apps/desktop/test/plc-scene.test.ts`:

```ts
import {
  addWire,
  createSession,
  JIPM_BOARD,
  PLC_UNIT_FX5U,
  toNetlistTerminal,
  withPlcUnit,
  deskWires,
  routeSession,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { deskCablePoints, offBoardTerminals } from '../src/renderer/three/DeskWires.js';
import { safeRoutes } from '../src/renderer/three/BoardScene.js';

const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

function sessionWithDeskWire() {
  const session = createSession(board, {
    roles: { S1: 'CR1', S7: 'CHK' },
    allowedColors: ['青'],
    extraParts: [],
    inventory: [],
  });
  const added = addWire(session, board, 'TB_PB.1a' as TerminalId, 'PLC.X0' as TerminalId, '青');
  expect(added.ok).toBe(true);
  const power = addWire(session, board, 'OUTLET.L' as TerminalId, 'PLC.L' as TerminalId, '青');
  expect(power.ok).toBe(true);
  return session;
}

describe('机上の3D（§10.1 / 決定表#9）', () => {
  it('splits the wires between the board router and the desk cables', () => {
    const session = sessionWithDeskWire();
    expect(routeSession(board, session)).toHaveLength(0);
    expect(deskWires(board, session)).toHaveLength(2);
    // 盤側の経路器は机上の電線で例外を出さない
    expect(safeRoutes(board, session).errors).toEqual([]);
  });

  it('lists the terminals that belong to the desk', () => {
    const ids = offBoardTerminals(board).map((t) => String(t.id));
    expect(ids).toContain('PLC.X0');
    expect(ids).toContain('PLC.COM0');
    expect(ids).toContain('OUTLET.L');
    expect(ids).not.toContain('TB_PB.1a');
    // FX5U は電源3・S/S・サービス2・入力16・COM4・出力16 = 42 端子 ＋ コンセント2
    expect(ids).toHaveLength(44);
  });

  it('draws a sagging cable between the two ends', () => {
    const points = deskCablePoints({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 });
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual([0 - 165, 110, 0]);
    // 中間点は手前（盤モデルの y が増える方向＝シーンの −Y）へ垂れる
    expect(points[1]?.[1]).toBeLessThan(points[0]?.[1] ?? 0);
    expect(points[2]?.[0]).toBeCloseTo(100 - 165, 6);
  });
});
```

- [ ] **Step 2: RED を確認し、Step 3 で `camera.ts` を足す**

```ts
import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  JIPM_BOARD,
  OUTLET_ORIGIN_MM,
  PLC_TERMINAL_PITCH_MM,
  PLC_UNIT_FX5U,
} from '@ojt/board-model';
```

```ts
/** 「PLC」視点で必ず画角に入れる余白[mm]。 */
export const PLC_VIEW_MARGIN_MM = 20;

/**
 * 「PLC」視点が収める矩形（盤モデル mm）。§10.1 / 決定表#6
 * 机上のPLC本体と壁コンセントの外接矩形。数値は盤モデルの定義から求めるのでハードコードしない。
 */
export const PLC_VIEW_RECT = ((): { x: number; y: number; w: number; h: number } => {
  const unit = PLC_UNIT_FX5U;
  const xs = [
    unit.pos.x,
    unit.pos.x + unit.sizeMm.width,
    OUTLET_ORIGIN_MM.x,
    OUTLET_ORIGIN_MM.x + PLC_TERMINAL_PITCH_MM * 2,
  ];
  const ys = [
    unit.pos.y,
    unit.pos.y + unit.sizeMm.height,
    OUTLET_ORIGIN_MM.y - PLC_TERMINAL_PITCH_MM,
    OUTLET_ORIGIN_MM.y + PLC_TERMINAL_PITCH_MM,
  ];
  const x = Math.min(...xs) - PLC_VIEW_MARGIN_MM;
  const y = Math.min(...ys) - PLC_VIEW_MARGIN_MM;
  return {
    x,
    y,
    w: Math.max(...xs) + PLC_VIEW_MARGIN_MM - x,
    h: Math.max(...ys) + PLC_VIEW_MARGIN_MM - y,
  };
})();
```

`cameraPose()` の `switch` に1件足す（**`socket` と同じ形**。ほかの分岐は触らない）:

```ts
    case 'plc': {
      // 机上のPLC本体と壁コンセントが収まるまで寄る（盤面の延長なので面直で見る）。§10.1
      const rect = PLC_VIEW_RECT;
      const distance = fitDistanceMm(rect.w, rect.h, SOCKET_VIEW_ASPECT);
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

- [ ] **Step 4: `three/PlcUnit.tsx` / `Outlet.tsx` / `DeskWires.tsx` を書く**

```tsx
// PlcUnit.tsx
import type { BoardTerminal, PlcUnitDefinition } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import { roleColor } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { TerminalHit, terminalTooltip } from './TerminalHit.js';
import { toScene } from './coords.js';

/**
 * 机上のPLC本体（FX5U）。設計仕様 §10.1 / §17。
 *
 * 外形・端子・LEDの並びはすべて `PlcUnitDefinition`（`@ojt/board-model`）から引く。
 * **各社のロゴ・銘板画像・画面キャプチャは描かない**（§17 / PLC調査資料 §6）。銘板は
 * `displayName` の文字だけで、機種が増えても3Dのコードは変わらない。
 */

/** 筐体の色（灰）。 */
const BODY_COLOR = '#D8DBE0';
/** LEDの直径[mm]。 */
const LED_D_MM = 3;
/** LEDの並びの左端[mm]（筐体の左から）。 */
const LED_LEFT_MM = 10;
/** LEDの縦位置[mm]（筐体の上から）。 */
const LED_TOP_MM = 6;

/** レイキャストを受けない（筐体が端子のクリックを奪わないように）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** PLC本体。 */
export function PlcUnit({
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
  const { width, height } = unit.sizeMm;
  // 筐体は薄い台（厚み6mm）として描く。机上の実寸の奥行（83mm）まで出すと端子が谷底になって
  // クリックしづらく、正面視でも端子列が見えなくなる（意図的な差分 #1）
  const bodyZ = 6;
  const center = toScene({ x: unit.pos.x + width / 2, y: unit.pos.y + height / 2, z: bodyZ / 2 });
  return (
    <group name="plc-unit">
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(BODY_COLOR, { roughness: 0.65, metalness: 0.1 })}
        raycast={noPick}
        position={center}
        scale={[width, height, bodyZ]}
      />
      {unit.leds.map((led, index) => (
        <mesh
          key={led}
          raycast={noPick}
          position={toScene({
            x: unit.pos.x + LED_LEFT_MM + index * (LED_D_MM * 2),
            y: unit.pos.y + LED_TOP_MM,
            z: bodyZ + 0.4,
          })}
        >
          <circleGeometry args={[LED_D_MM / 2, 12]} />
          <meshBasicMaterial color="#5A6070" />
        </mesh>
      ))}
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
      {/* 端子の印字（常時表示）。色は役割ごとの既存の表から引く（§12.2） */}
      {terminals.map((terminal) => (
        <Html
          key={`label-${terminal.id}`}
          center
          style={{ pointerEvents: 'none', color: roleColor(terminal.role) }}
          distanceFactor={300}
          position={toScene({ x: terminal.pos.x, y: terminal.pos.y - 5, z: bodyZ + 0.5 })}
          zIndexRange={[10, 0]}
        >
          <span className="terminal-mark">{terminal.label}</span>
        </Html>
      ))}
      <Html
        center
        style={{ pointerEvents: 'none' }}
        distanceFactor={420}
        position={toScene({ x: unit.pos.x + width / 2, y: unit.pos.y + height + 8, z: bodyZ })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{unit.displayName}</span>
      </Html>
    </group>
  );
}
```

> `roleColor(role)` は `three/labels.ts` に**既にある**役割色の引き手（`x` / `y` / `ss` / `plc-com` / `ac-l` / `ac-n` を含む）。無ければ既存の色表から同じ形の関数を切り出すこと（色の値は足さない）。

```tsx
// Outlet.tsx
import type { BoardTerminal } from '@ojt/board-model';
import { OUTLET_ORIGIN_MM, PLC_TERMINAL_PITCH_MM } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { TerminalHit, terminalTooltip } from './TerminalHit.js';
import { toScene } from './coords.js';

/** 壁コンセント（AC100V）。設計仕様 §10.1。 */
const PLATE_W_MM = 34;
const PLATE_H_MM = 24;
const PLATE_Z_MM = 4;

function noPick(): void {
  // 交差候補を積まない
}

/** 壁コンセント。 */
export function Outlet({
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
}: {
  terminals: readonly BoardTerminal[];
  hoveredTerminal: TerminalId | undefined;
  pendingTerminal: TerminalId | undefined;
  onHoverTerminal: (id: TerminalId | undefined) => void;
  onPickTerminal: (terminal: BoardTerminal) => void;
}): JSX.Element {
  const center = toScene({
    x: OUTLET_ORIGIN_MM.x + PLC_TERMINAL_PITCH_MM / 2,
    y: OUTLET_ORIGIN_MM.y,
    z: PLATE_Z_MM / 2,
  });
  return (
    <group name="outlet">
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial('#F0F1F3', { roughness: 0.8, metalness: 0 })}
        raycast={noPick}
        position={center}
        scale={[PLATE_W_MM, PLATE_H_MM, PLATE_Z_MM]}
      />
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
        style={{ pointerEvents: 'none' }}
        distanceFactor={360}
        position={toScene({
          x: OUTLET_ORIGIN_MM.x + PLC_TERMINAL_PITCH_MM / 2,
          y: OUTLET_ORIGIN_MM.y + PLATE_H_MM / 2 + 6,
          z: PLATE_Z_MM,
        })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{JA.plc.outlet}</span>
      </Html>
    </group>
  );
}
```

```tsx
// DeskWires.tsx
import {
  deskWires,
  isOffBoardTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
  type Vec3,
} from '@ojt/board-model';
import type { WireColor } from '@ojt/circuit-sim';
import { useMemo, type JSX } from 'react';
import { CatmullRomCurve3, Vector3 } from 'three';
import { wireBodyColor } from '../session/colors.js';
import { sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 机上へ渡るケーブル。設計仕様 §10.1 / 3A 決定表#9。
 *
 * 盤の配線帯（§6.6）は机上まで伸びていないので、これらの電線は `routeSession()` の対象外で
 * ある（`deskWires()` が別に返す）。ここでは**たるんだ直線ケーブル**として描く。
 */

/** ケーブルの半径[mm]。 */
const CABLE_R_MM = 1.6;
/** ケーブルの垂れ下がり量[mm]（手前へ）。 */
const SAG_MM = 12;

/** 机上に属する端子（PLC本体と壁コンセント）。 */
export function offBoardTerminals(board: BoardDefinition): BoardTerminal[] {
  return board.terminals.filter((terminal) => isOffBoardTerminal(terminal.id));
}

/** ケーブルの制御点（始点・たるみ・終点）をシーン座標で返す。 */
export function deskCablePoints(from: Vec3, to: Vec3): Array<[number, number, number]> {
  const a = toScene(from);
  const b = toScene(to);
  const middle = toScene({
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 + SAG_MM,
    z: (from.z + to.z) / 2 + 2,
  });
  return [a, middle, b];
}

/** 机上へ渡るケーブルをまとめて描く。 */
export function DeskWires({
  board,
  session,
}: {
  board: BoardDefinition;
  session: BoardSession;
}): JSX.Element | null {
  const cables = useMemo(() => {
    const colors = new Map<string, WireColor>(session.wires.map((wire) => [wire.id, wire.color]));
    return deskWires(board, session).map((wire) => ({
      id: wire.id,
      color: colors.get(wire.id) ?? '青',
      points: deskCablePoints(wire.fromPos, wire.toPos),
    }));
  }, [board, session]);
  if (cables.length === 0) return null;
  return (
    <group name="desk-wires">
      {cables.map((cable) => (
        <mesh
          key={cable.id}
          material={sharedMaterial(wireBodyColor(cable.color, false, false), {
            roughness: 0.5,
            metalness: 0.1,
          })}
        >
          <tubeGeometry
            args={[
              new CatmullRomCurve3(cable.points.map((p) => new Vector3(p[0], p[1], p[2]))),
              16,
              CABLE_R_MM,
              8,
              false,
            ]}
          />
        </mesh>
      ))}
    </group>
  );
}
```

> `wireBodyColor(color, selected, locked)` は `session/colors.ts` の既存の関数。引数の形が違えば既存の署名に合わせること（線色 → 色の変換を新しく書かない）。

- [ ] **Step 5: `BoardScene.tsx` に足す（**MERGE 注意 #5。編集は4箇所のみ**）**

1. **import**: `PlcUnit` / `Outlet` / `DeskWires` / `offBoardTerminals` を足す。
2. **`BoardContents` の `board`**: `const board = JIPM_BOARD;` を **props で受け取る**（`board: BoardDefinition`）ように変える。`BoardSceneImpl` にも `board` props を足し、既定値を `JIPM_BOARD` にする（モードB/C1/C2 の呼び出し側は変えなくてよい）。
3. **`visualSignature()`**: 机上の配線と盤が変わったことを署名に入れる（下の2行を配列の末尾に足す）。

```ts
    // 机上のPLC・コンセントと机上配線が絵に効く（§10.1）
    session?.boardId ?? '',
    state.problem !== undefined && state.problem.mode === 'plc' ? 'plc' : '',
```

4. **`<group rotation={[BOARD_TILT_RAD, 0, 0]}>` の中**（`ProbeMarkers` の**直前**）に机上の3つを足す:

```tsx
        {/* 机上のPLC本体・壁コンセント・渡りケーブル（モードDの盤だけが持つ）。§10.1 */}
        {board.plcUnit === undefined ? null : (
          <>
            <PlcUnit
              unit={board.plcUnit}
              terminals={plcTerminals}
              hoveredTerminal={hovered}
              pendingTerminal={pending}
              onHoverTerminal={onHover}
              onPickTerminal={pickTerminal}
            />
            <Outlet
              terminals={outletTerminals}
              hoveredTerminal={hovered}
              pendingTerminal={pending}
              onHoverTerminal={onHover}
              onPickTerminal={pickTerminal}
            />
            {session === undefined ? null : <DeskWires board={board} session={session} />}
          </>
        )}
```

端子の振り分けは既存の `useMemo` 群の隣に置く（**同一性を保つためメモ化する**。§15）:

```tsx
  /** 机上の端子（PLC本体・壁コンセント）。同一性を保つためメモ化する。§15 */
  const deskTerminals = useMemo(() => offBoardTerminals(board), [board]);
  const plcTerminals = useMemo(
    () => deskTerminals.filter((t) => t.id.startsWith(`${PLC_PART_ID}.`)),
    [deskTerminals],
  );
  const outletTerminals = useMemo(
    () => deskTerminals.filter((t) => t.id.startsWith(`${OUTLET_ID}.`)),
    [deskTerminals],
  );
```

- [ ] **Step 6: `Toolbar.tsx` に4つ目の視点ボタン（**MERGE 注意 #6。1箇所のみ**）**

`VIEWS` はそのままにし、`showPlcView?: boolean` の props を足して視点グループの末尾に条件つきで1つ描く:

```tsx
          {showPlcView === true ? (
            <button
              type="button"
              data-testid="view-plc"
              aria-pressed={camera === 'plc'}
              title={JA.plc.viewPlc}
              onClick={() => {
                onCamera('plc');
              }}
            >
              {JA.plc.viewPlc}
            </button>
          ) : null}
```

`ja.ts` に `plc` ブロックを新設（`ladder` の直後）:

```ts
  /** モードD（PLC）の画面。§10.1 / §10.2 / §12.1 */
  plc: {
    outlet: '壁コンセント（AC100V）',
    viewPlc: 'PLC',
    unit: 'PLC本体',
  },
```

- [ ] **Step 7: GREEN とコミット**

```powershell
pnpm --filter @ojt/desktop exec vitest run test/plc-camera.test.ts test/plc-scene.test.ts test/scene.test.ts test/camera-presets.test.tsx test/board-scene.test.ts test/toolbar.test.tsx
npx prettier --write "apps/desktop/src/renderer/three/*.{ts,tsx}" "apps/desktop/src/renderer/panels/Toolbar.tsx" "apps/desktop/test/plc-*.test.ts"
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): draw the FX5U, the wall outlet and the desk cables"
```

Expected: `plc-camera` が `Tests  4 passed (4)`、`plc-scene` が `Tests  3 passed (3)`。既存の3Dテスト（`scene` / `camera-presets` / `board-scene` / `toolbar`）も通る。

---

<!-- CHUNK -->






