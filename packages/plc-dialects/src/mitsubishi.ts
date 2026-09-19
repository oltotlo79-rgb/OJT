import {
  device,
  deviceLabel,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  type Cell,
  type Device,
  type DeviceKind,
  type LadderProgram,
} from '@ojt/ladder-core';
import type {
  DeviceRange,
  DialectError,
  DialectProfile,
  InstructionKey,
  MonitorColors,
  PanelLayout,
  SymbolDrawing,
  TimerPresetText,
} from './profile.js';
import { GX_STYLE_SHORTCUTS } from './shortcuts.js';

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
  const clamped = rounded < baseMs ? baseMs : rounded;
  const max = MAX_K * baseMs;
  return clamped > max ? max : clamped;
}

/** タイマ設定値 `K` の範囲。 */
const MIN_K = 1;
const MAX_K = 32_767;

/**
 * デバイス種別ごとの番号体系。§10.5
 * `internal.max` は `M7999` まで。`M8000` 以降は特殊リレー帯（`SPECIAL_DEVICES` の
 * `M8000`/`M8002`/`M8013` を含む）と番号が重なるため、通常の内部リレーとしては使わせない
 * （レビュー #M1）。
 */
const DEVICE_RANGES: Readonly<Record<DeviceKind, DeviceRange>> = {
  input: { radix: 8, prefix: 'X', min: 0, max: 1023 },
  output: { radix: 8, prefix: 'Y', min: 0, max: 1023 },
  internal: { radix: 10, prefix: 'M', min: 0, max: 7_999 },
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
 * カウンタ設定値の方言表記（`K5`）。§10.7 / Plan 4B の申し送り F-2
 * この機種で表せる {@link MIN_K}〜{@link MAX_K} だけを `K` 表記で書く。範囲外は素の10進数の
 * まま返す（`K` を付けた「表せるふりの表記」にしない。B2 の往復検査が拾えるようにする。M4）。
 */
function counterPresetText(preset: number): string {
  if (!Number.isInteger(preset) || preset < MIN_K || preset > MAX_K) {
    return String(preset);
  }
  return `K${preset}`;
}

/** `K` 表記 → カウンタ設定値。§10.7 / Plan 4B の申し送り F-2 */
function parseCounterPreset(text: string): number | Error {
  const digits = /^K([0-9]+)$/u.exec(text.trim().toUpperCase())?.[1];
  if (digits === undefined) return new Error(`カウンタ設定値は K<数値> の形式です: ${text}`);
  const preset = Number(digits);
  if (preset < MIN_K || preset > MAX_K) {
    return new Error(`カウンタ設定値が範囲外です（K${MIN_K}〜K${MAX_K}）: ${text}`);
  }
  return preset;
}

/** 命令語。§10.5 / §17 #21（FX3系の体系を採用） */
const INSTRUCTION_NAMES: Readonly<Record<InstructionKey, string>> = {
  ld: 'LD',
  ldi: 'LDI',
  and: 'AND',
  ani: 'ANI',
  or: 'OR',
  ori: 'ORI',
  ldp: 'LDP',
  ldf: 'LDF',
  andp: 'ANDP',
  andf: 'ANDF',
  orp: 'ORP',
  orf: 'ORF',
  andBlock: 'ANB',
  orBlock: 'ORB',
  out: 'OUT',
  set: 'SET',
  rst: 'RST',
  pulseUp: 'PLS',
  pulseDown: 'PLF',
  timer: 'OUT T',
  counter: 'OUT C',
  mc: 'MC',
  mcr: 'MCR',
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
const MONITOR_COLORS: MonitorColors = { powered: '#1E64FF', idle: '#6B7280' };

/** 画面構成。§10.6 */
const PANELS: PanelLayout = {
  tree: 'ナビゲーションウィンドウ（プロジェクトツリー）',
  editor: 'ラダーエディタ',
  output: '出力ウィンドウ',
  toolbar: [
    '変換',
    '全変換',
    '書込みモード',
    '読出しモード',
    'オンライン',
    'シーケンサへの書込み',
    'モニタ開始',
    'モニタ停止',
  ],
};

/** 方言エラーの日本語文言。§10.5 の `errorMessages` */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'device-range': 'デバイス番号がこの機種の範囲を超えています',
  'timer-unit': 'このタイマ番号の時間単位では指定できない設定値です',
  'timer-range': 'タイマ設定値（K値）がこの機種の範囲を超えています',
  'counter-range': 'カウンタ設定値がこの機種の範囲を超えています',
  'special-unsupported': 'この機種に対応する特殊デバイスがありません',
};

/**
 * タイマ設定値のエラー種別を判定する。`timerPreset()` は失敗理由（単位に合わない／K値が
 * 範囲外）ごとに文言を変えるが `code` までは持たないので、`checkCell` はここで再判定する。
 */
function timerErrorCode(ms: number, timer: Device): 'timer-unit' | 'timer-range' {
  const base = timerBaseMs(timer);
  if (!Number.isInteger(ms) || ms <= 0 || ms % base !== 0) return 'timer-unit';
  return 'timer-range';
}

/** セルが参照するデバイスを列挙する（設定値の検査もここで行う）。 */
function checkCell(
  networkId: string,
  row: number,
  col: number,
  cell: Cell,
  errors: DialectError[],
): void {
  const devices: Device[] = [];
  if (
    cell.kind === 'contact' ||
    cell.kind === 'coil' ||
    cell.kind === 'mc' ||
    cell.kind === 'mcr'
  ) {
    devices.push(cell.device);
  } else if (cell.kind === 'timer') {
    devices.push(cell.device);
    const preset = timerPreset(cell.presetMs, cell.device);
    if (preset instanceof Error) {
      errors.push({
        code: timerErrorCode(cell.presetMs, cell.device),
        message: preset.message,
        device: cell.device,
        networkId,
        row,
        col,
      });
    }
  } else if (cell.kind === 'counter') {
    devices.push(cell.device, cell.resetDevice);
    if (cell.preset < MIN_K || cell.preset > MAX_K) {
      errors.push({
        code: 'counter-range',
        message: `カウンタ設定値が範囲外です（${MIN_K}〜${MAX_K}）: ${cell.preset}`,
        device: cell.device,
        networkId,
        row,
        col,
      });
    }
  }
  for (const target of devices) {
    if (target.kind === 'special') {
      // device() が SP0〜SP2 以外を作らせず、SPECIAL_DEVICES がその3つを定義しているため、
      // この分岐には到達しない（防御的）
      /* c8 ignore next 10 */
      if (SPECIAL_DEVICES[target.index] === undefined) {
        const sp = DEVICE_RANGES.special;
        errors.push({
          code: 'special-unsupported',
          message: `この機種にはない特殊デバイスです（${sp.prefix}${sp.min}〜${sp.prefix}${sp.max}）: ${sp.prefix}${target.index}`,
          device: target,
          networkId,
          row,
          col,
        });
      }
      continue;
    }
    const range = DEVICE_RANGES[target.kind];
    if (target.index < range.min || target.index > range.max) {
      errors.push({
        code: 'device-range',
        message: `${range.prefix} の番号が範囲外です（${range.prefix}${range.min.toString(range.radix)}〜${range.prefix}${range.max.toString(range.radix)}）: ${formatDevice(target)}`,
        device: target,
        networkId,
        row,
        col,
      });
    }
  }
}

/** 方言に依る検査。§10.5 / §10.8 */
function validate(source: LadderProgram): DialectError[] {
  const errors: DialectError[] = [];
  for (const net of source.networks) {
    net.cells.forEach((cells, row) => {
      cells.forEach((cell, col) => {
        if (cell.kind === 'empty') return;
        checkCell(net.id, row, col, cell, errors);
      });
    });
  }
  return errors;
}

/** 三菱 FX5U ＋ GX Works3風スキン。§10.5 / §10.6 */
export const MITSUBISHI_FX5U: DialectProfile = {
  id: 'mitsubishi',
  displayName: '三菱電機 MELSEC iQ-F FX5U（GX Works3風）',
  formatDevice,
  parseDevice,
  deviceRanges: DEVICE_RANGES,
  timerPreset,
  parseTimerPreset,
  counterPresetText,
  parseCounterPreset,
  specialDevices: SPECIAL_DEVICES,
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
