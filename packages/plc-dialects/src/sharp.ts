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

/** カウンタ設定値の範囲（10進4桁）。§10.5 の `DCNT(BCD)` の書式 */
const COUNTER_MIN = 1;
const COUNTER_MAX = 9_999;

/** カウンタ設定値の方言表記（`0005`）。タイマと同じ10進4桁。4B 申し送り F-2 */
function counterPresetText(preset: number): string {
  return String(preset).padStart(4, '0');
}

/** 10進4桁 → カウンタ設定値。§10.7 / 4B 申し送り F-2 */
function parseCounterPreset(text: string): number | Error {
  const digits = /^([0-9]{1,4})$/u.exec(text.trim())?.[1];
  if (digits === undefined) {
    return new Error(`カウンタ設定値は10進4桁で指定します: ${text}`);
  }
  const preset = Number(digits);
  if (preset < COUNTER_MIN || preset > COUNTER_MAX) {
    return new Error(
      `カウンタ設定値が範囲外です（${counterPresetText(COUNTER_MIN)}〜${counterPresetText(COUNTER_MAX)}）: ${text}`,
    );
  }
  return preset;
}

/** 共通デバイス検査に渡す規則。 */
const RULES: DeviceRuleSet = {
  deviceRanges: DEVICE_RANGES,
  specialDevices: SPECIAL_DEVICES,
  formatDevice,
  timer: TIMER,
  counter: { min: COUNTER_MIN, max: COUNTER_MAX },
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
  counterPresetText,
  parseCounterPreset,
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
