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

/** Phase 4 で4メーカーすべてを実装した。§16 */
export const IMPLEMENTED_DIALECT_IDS: readonly DialectId[] = DIALECT_IDS;

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
  /**
   * Phase 3 のエディタで使えるか。既定は `true`。
   * `false` の項目は表に載せるが押しても何も起きない（UIは淡色で出す。§12.1）。
   */
  enabled?: boolean;
  /** `enabled: false` の理由や △ 割当の補足。UIが注記として出す。 */
  note?: string;
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
  /**
   * カウンタ設定値の方言表記（三菱 `K5` / OMRON `#0005` / JTEKT `H0005` / シャープ `0005`）。
   * 命令語リスト（§10.7）と 4B のカウンタ設定値欄が使う。タイマの `timerPreset` と対になる
   * （4B 申し送り F-2）。省略した方言は10進の数値そのままで書かれる。
   */
  counterPresetText?(preset: number): string;
  /**
   * 方言のカウンタ設定表記 → 設定値。読めない表記と機種の範囲外は `Error` を返す（投げない）。
   * 4B 申し送り F-2。
   */
  parseCounterPreset?(text: string): number | Error;
  instructionNames: Readonly<Record<InstructionKey, string>>;
  /** 特殊デバイス番号（`SP0`〜`SP2`）→ 実デバイス名。§10.3 / §10.5 */
  specialDevices: Readonly<Record<number, string>>;
  /**
   * 実機ではb接点で使う特殊デバイスの番号（シャープの `007366`＝常時ON。§10.5 / §17 #22）。
   * 4B のエディタはここに載っている番号の接点をb接点として描く。IRとランタイムは関知しない
   * （IRの `SP0` は常時ONという意味そのもので、表示だけが方言に依る）。
   */
  specialInverted?: readonly number[];
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
