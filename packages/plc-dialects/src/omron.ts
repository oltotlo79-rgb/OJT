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
    return new Error(
      `この機種にはないデバイスです（${ch}.00〜${ch}.${bit2(points - 1)}）: ${text}`,
    );
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
