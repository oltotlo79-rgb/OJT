import {
  device,
  deviceLabel,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  type Device,
  type DeviceKind,
} from '@ojt/ladder-core';
import type {
  DeviceRange,
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
export function timerBaseMs(timer: Device): number {
  if (timer.index >= 256) return 1;
  if (timer.index >= 200) return 10;
  return 100;
}

/**
 * タイマ設定値をその番号帯の時間単位に丸める。§10.5
 *
 * §10.5 の「`3050ms` は `T0` では指定できません。100ms 刻みに丸めますか？」に「はい」と
 * 答えられたときに UI（Plan 3B）が使う。**四捨五入ではなく最も近い刻みへ丸め**、0 になる場合は
 * 1刻みに切り上げる（設定値 0 のタイマは作れないため）。`baseMs` は `timerBaseMs()` の戻り値。
 */
export function roundTimerPreset(ms: number, baseMs: number): number {
  if (!Number.isFinite(ms) || !Number.isInteger(baseMs) || baseMs <= 0) {
    throw new Error(`丸められない引数です: ms=${ms} baseMs=${baseMs}`);
  }
  const rounded = Math.round(ms / baseMs) * baseMs;
  return rounded < baseMs ? baseMs : rounded;
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
  // 特殊デバイスはIR側の通し番号（`SP0`〜`SP2`）の範囲。実デバイス名は `SPECIAL_DEVICES` が持つ
  special: { radix: 10, prefix: 'SP', min: 0, max: 2 },
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
    return new Error(
      `デバイス番号が範囲外です（${range.prefix}${range.min.toString(range.radix)}〜${range.prefix}${range.max.toString(range.radix)}）: ${text}`,
    );
  }
  return device(kind, index);
}

/** ms → `K` 表記。番号帯の単位で割り切れないと Error。§10.5 */
function timerPreset(ms: number, timer: Device): TimerPresetText | Error {
  const base = timerBaseMs(timer);
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
  return k * timerBaseMs(timer);
}

/**
 * 命令語（Task 10 で本実装するまでの暫定値）。§10.5
 * 三菱 GX Works3 のニーモニックとして広く知られた表記を採用している（§17 #19）。
 */
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

/** 記号の描画識別子（Task 10 で本実装するまでの暫定値）。§10.6 */
const SYMBOLS: SymbolDrawing = {
  no: 'contact-no',
  nc: 'contact-nc',
  rise: 'contact-rise',
  fall: 'contact-fall',
  coil: 'coil',
  set: 'coil-set',
  rst: 'coil-rst',
  timer: 'block-timer',
  counter: 'block-counter',
};

/** ショートカット（Task 10 で本実装するまでの暫定値）。§10.6 */
const SHORTCUTS: ShortcutTable = [];

/** モニタ通電色（Task 10 で本実装するまでの暫定値）。§10.6 */
const MONITOR_COLORS: MonitorColors = {
  powered: '#1e88e5',
  idle: '#9e9e9e',
};

/** 画面構成（Task 10 で本実装するまでの暫定値）。§10.6 */
const PANELS: PanelLayout = {
  tree: 'ナビゲーション',
  editor: 'ラダーエディタ',
  output: '出力',
  toolbar: [],
};

/** バリデータ（Task 10 で本実装するまでの暫定値）。§10.8 */
function validate(): [] {
  return [];
}

/** エラーメッセージ表（Task 10 で本実装するまでの暫定値）。 */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {};

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
