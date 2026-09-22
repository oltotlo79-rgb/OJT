import {
  device,
  SPECIAL_ALWAYS_ON,
  SPECIAL_ALWAYS_OFF,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  type Device,
  type DeviceKind,
  type LadderProgram,
} from '@ojt/ladder-core';
import {
  collectDeviceIssues,
  collectDevices,
  deviceInRange,
  makeParseTimerPreset,
  makeTimerPreset,
  normalizeDeviceText,
  type DeviceRuleSet,
  type DeviceUse,
  type TimerRule,
} from './device-rules.js';
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
 * JTEKT TOYOPUC PC10G-1SP ＋ PCwin風スキンの方言プロファイル。設計仕様 §10.5 / §10.6。
 *
 * デバイス体系は PLC調査資料 §3-B の「PC10標準モード」（16進・先頭の数字はプログラム番号）で、
 * 本アプリは**プログラム1のみ**を使う（§17 #21 のとおり PC10G-1SP にそのまま対応する）。
 * 命令ニーモニック・タイマ時間単位・特殊リレー番号は一次資料が未入手のため §17 #10 / #20 / #22 の
 * 前提値である。実機と異なると分かった場合の修正箇所はこのファイルだけである（§17.1）。
 *
 * **入出力のアドレス割付**（決定表#16 / 意図的な差分#14）: §10.5 は X と Y を同じ番号帯
 * （`000`〜`7FF`）と書きつつ「X と Y の同一番号の重複使用禁止」も定めている。両方をそのまま
 * 実装すると `X(0)` と `Y(0)` を使う内蔵8題が全題エラーになるので、本アプリは実機のラック構成に
 * 合わせて **`IN-12` を `1X000`〜`1X00F`、`OUT-12` をその次の16点境界 `1Y010`〜`1Y01F`** に置く。
 * 同番号検査はIRの通し番号ではなく、この写像を通した**アドレス**どうしを比べる。
 */

/** 本アプリが使うプログラム番号。§10.5（先頭の 1/2/3 はプログラム番号） */
const PROGRAM_NUMBER = 1;

/** 出力の先頭アドレス（`IN-12` の16点の次の16点境界）。決定表#16 */
const OUTPUT_BASE = 0x010;

/** デバイス種別ごとの番号体系。PLC調査資料 §3-B */
const DEVICE_RANGES: Readonly<Record<DeviceKind, DeviceRange>> = {
  input: { radix: 16, prefix: '1X', min: 0, max: 0x7ff },
  // 出力は `OUTPUT_BASE` ぶん後ろにずれるので、上限は `1Y7FF` に当たる通し番号（0x7ff - 0x010）
  output: { radix: 16, prefix: '1Y', min: 0, max: 0x7ff - OUTPUT_BASE },
  internal: { radix: 16, prefix: '1M', min: 0, max: 0x7ff },
  timer: { radix: 16, prefix: '1T', min: 0, max: 0x1ff },
  counter: { radix: 16, prefix: '1C', min: 0, max: 0x1ff },
  special: { radix: 10, prefix: 'SP', min: 0, max: 3 },
};

/** 種別を表す1文字（プログラム番号の次の桁）。 */
const KIND_LETTER: Readonly<Record<string, DeviceKind>> = {
  X: 'input',
  Y: 'output',
  M: 'internal',
  T: 'timer',
  C: 'counter',
};

/** 特殊デバイス番号 → TOYOPUC の実デバイス名。§17 #22 の前提割当 */
const SPECIAL_DEVICES: Readonly<Record<number, string>> = {
  [SPECIAL_ALWAYS_OFF]: 'V005',
  [SPECIAL_ALWAYS_ON]: 'V004',
  [SPECIAL_FIRST_SCAN]: 'V006',
  [SPECIAL_CLOCK_1S]: 'V072',
};

/** 実デバイス名（大文字化）→ 特殊デバイス番号。 */
const SPECIAL_BY_NAME = new Map<string, number>(
  Object.entries(SPECIAL_DEVICES).map(([index, name]) => [name.toUpperCase(), Number(index)]),
);

// プログラム1の省略形とゼロ埋め、旧版の独自表記を入力時だけ受け付ける。
for (const [name, index] of Object.entries({
  V4: 0,
  V04: 0,
  '1V04': 0,
  '1V004': 0,
  'P1-V004': 0,
  V5: 3,
  V05: 3,
  '1V05': 3,
  '1V005': 3,
  'P1-V005': 3,
  V6: 1,
  V06: 1,
  '1V06': 1,
  '1V006': 1,
  'P1-V006': 1,
  V72: 2,
  '1V72': 2,
  '1V072': 2,
  'P1-V072': 2,
  '1V00': 0,
  '1V01': 1,
}))
  SPECIAL_BY_NAME.set(name, index);

/** IRの通し番号 → この機種のアドレス（出力だけ `OUTPUT_BASE` ぶんずらす）。決定表#16 */
function addressOf(target: Device): number {
  return target.kind === 'output' ? target.index + OUTPUT_BASE : target.index;
}

/** IRのデバイス → 方言表記（16進3桁・大文字）。§10.5 */
function formatDevice(target: Device): string {
  if (target.kind === 'special') {
    // device() が SP0〜SP3 以外を作らせず、SPECIAL_DEVICES がその4つを定義しているため
    // `??` の右側には到達しない（防御的）
    /* c8 ignore next */
    return SPECIAL_DEVICES[target.index] ?? `SP${target.index}`;
  }
  const range = DEVICE_RANGES[target.kind];
  return `${range.prefix}${addressOf(target).toString(16).toUpperCase().padStart(3, '0')}`;
}

/** 方言表記 → IRのデバイス。読めない表記は Error を返す（投げない）。§10.5 */
function parseDevice(text: string): Device | Error {
  const trimmed = text.trim();
  // 指摘 PD-1: 全角の `１Ｘ０００` も読む。表示（エラー文言）は元の大小文字のまま残す
  const upper = normalizeDeviceText(text);
  const special = SPECIAL_BY_NAME.get(upper);
  if (special !== undefined) return device('special', special);
  const matched = /^([0-9])([XYMTC])([0-9A-F]{1,3})$/u.exec(upper);
  if (matched === null) {
    return new Error(
      `読めないデバイス表記です（<プログラム番号><種別><16進3桁>。全角で入力されていないか確認してください）: ${trimmed}`,
    );
  }
  if (Number(matched[1]) !== PROGRAM_NUMBER) {
    return new Error(
      `プログラム番号は${PROGRAM_NUMBER}です（本アプリはプログラム1のみ）: ${trimmed}`,
    );
  }
  // 正規表現が `[XYMTC]` の1文字しか通さないので、`KIND_LETTER` は必ず引ける（防御的。A-M4）
  const kind = KIND_LETTER[matched[2] ?? ''];
  /* c8 ignore next */
  if (kind === undefined) return new Error(`読めないデバイス種別です: ${trimmed}`);
  // アドレス → IRの通し番号。出力は `1Y010` が `Y(0)` なので `OUTPUT_BASE` を引く（決定表#16）
  const address = parseInt(matched[3] ?? '', 16);
  const index = kind === 'output' ? address - OUTPUT_BASE : address;
  return deviceInRange(DEVICE_RANGES, formatDevice, kind, index, trimmed);
}

/** タイマ規則（設定値レジスタ `H` ＋ 16進4桁、0.1秒単位）。§17 #20 の前提 */
const TIMER: TimerRule = {
  baseMs: 100,
  min: 1,
  max: 0xffff,
  unitLabel: '0.1秒',
  format: (count) => `H${count.toString(16).toUpperCase().padStart(4, '0')}`,
  // 指摘 PD-1: 全角の `Ｈ０１００` も読む
  parse: (text) => {
    const matched = /^H([0-9A-F]{1,4})$/u.exec(normalizeDeviceText(text));
    return matched === null ? undefined : parseInt(matched[1] ?? '', 16);
  },
};

const timerPreset = makeTimerPreset(TIMER, formatDevice);
const parseTimerPreset = makeParseTimerPreset(TIMER);

/** カウンタ設定値の範囲（設定値レジスタ `H` ＋ 16進4桁）。§17 #20 の前提 */
const COUNTER_MIN = 1;
const COUNTER_MAX = 0xffff;

/**
 * カウンタ設定値の方言表記（`H0005`）。タイマと同じ設定値レジスタの書式。Plan 4B の申し送り F-2
 * この機種で表せる 1〜{@link COUNTER_MAX} だけをベンダー表記で書く。範囲外は素の10進数のまま
 * 返し、`H` を付けた「表せるふりの表記」にしない（B2 の往復検査が拾えるようにする。M4）。
 */
function counterPresetText(preset: number): string {
  if (!Number.isInteger(preset) || preset < COUNTER_MIN || preset > COUNTER_MAX) {
    return String(preset);
  }
  return `H${preset.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** `H` 表記 → カウンタ設定値。§10.7 / Plan 4B の申し送り F-2 */
function parseCounterPreset(text: string): number | Error {
  // 指摘 PD-1: 全角も読む
  const digits = /^H([0-9A-F]{1,4})$/u.exec(normalizeDeviceText(text))?.[1];
  if (digits === undefined) {
    return new Error(`カウンタ設定値は H<16進4桁> の形式です: ${text}`);
  }
  const preset = parseInt(digits, 16);
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

/**
 * この機種だけの検査: **X と Y、T と C に同じ番号を使ってはならない**。§10.5 / 調査資料 §8.1
 * 同じ番号のX/Yは実機では同じメモリ領域を指すため、入力を読んだつもりで出力を読んでしまう。
 * 比べるのはIRの通し番号ではなく `addressOf()` を通した**アドレス**である（決定表#16）。
 * 既定の割付では `IN-12` が `0x000`〜`0x00F`、`OUT-12` が `0x010`〜`0x01F` で重ならないので、
 * ここが鳴るのは利用者が `1X010` と `1Y010` のように**明示的に同じ番号を書いたとき**だけである。
 * 指摘位置は「後から現れたほう」にする（先に書いた側を消させないため）。
 */
function checkNumberConflicts(source: LadderProgram): DialectError[] {
  const uses = collectDevices(source);
  const errors: DialectError[] = [];
  const pairs: readonly (readonly [DeviceKind, DeviceKind])[] = [
    ['input', 'output'],
    ['timer', 'counter'],
  ];
  for (const [first, second] of pairs) {
    const seen = new Map<number, DeviceUse>();
    for (const use of uses) {
      if (use.device.kind === first) seen.set(addressOf(use.device), use);
    }
    for (const use of uses) {
      if (use.device.kind !== second) continue;
      const other = seen.get(addressOf(use.device));
      if (other === undefined) continue;
      // 指摘位置は「後から現れたほう」（グリッドの順で後ろ）にする（先に書いた側を消させないため。A-I1）
      const later = uses.indexOf(other) > uses.indexOf(use) ? other : use;
      errors.push({
        code: 'device-conflict',
        message: `${formatDevice(other.device)} と ${formatDevice(use.device)} は同じアドレスです（この機種では併用できません）`,
        device: later.device,
        ...later.place,
      });
    }
  }
  return errors;
}

/** 命令語（§17 #10 の前提: 三菱系の流用）。タイマ・カウンタは `OUT` ＋ デバイス ＋ 設定値。 */
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
  timer: 'OUT',
  counter: 'OUT',
  mc: 'MC',
  mcr: 'MCR',
  end: 'END',
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
const MONITOR_COLORS: MonitorColors = { powered: '#E08A1E', idle: '#6B7280' };

/** 画面構成。§10.6（左にツリー、右にラダー編集、下にステータスバー） */
const PANELS: PanelLayout = {
  tree: 'プロジェクトツリー（プログラム／データファイル／パラメータ／LD／SFC）',
  editor: 'ラダー編集エリア',
  output: 'ステータスバー',
  toolbar: ['JPI', 'DOR', 'MOR', 'STP', 'RDY', 'RUN', 'RES', 'モニタ開始', 'モニタ停止'],
  /*
   * PCwin は出力をステータスバーへ畳む構成で、**監視（ウォッチ）の独立した欄は公開資料で
   * 確認できていない**ため名乗らない（名乗らないメーカーでは欄そのものを出さない。設計 §5.5）。
   */
  comment: 'コメント',
  status: ['mode', 'plc-state', 'scan', 'device-count'],
};

/** 方言エラーの日本語文言。§10.5 の `errorMessages` */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'device-range': 'デバイス番号がこの機種の範囲を超えています',
  'device-conflict': 'この機種では X と Y、T と C に同じ番号を使えません',
  'timer-unit': 'このタイマの時間単位では指定できない設定値です',
  'timer-range': 'タイマ設定値がこの機種の範囲を超えています',
  'counter-range': 'カウンタ設定値がこの機種の範囲を超えています',
  'special-unsupported': 'この機種に対応する特殊デバイスがありません',
};

/** 方言に依る検査。§10.5 / §10.8 */
function validate(source: LadderProgram): DialectError[] {
  return [...collectDeviceIssues(source, RULES), ...checkNumberConflicts(source)];
}

/** JTEKT TOYOPUC PC10G-1SP ＋ PCwin風スキン。§10.5 / §10.6 */
export const JTEKT_PC10G: DialectProfile = {
  id: 'jtekt',
  displayName: 'JTEKT TOYOPUC PC10G-1SP（PCwin風）',
  formatDevice,
  parseDevice,
  deviceRanges: DEVICE_RANGES,
  timerPreset,
  parseTimerPreset,
  timerBaseMs: () => TIMER.baseMs,
  counterPresetText,
  parseCounterPreset,
  specialDevices: SPECIAL_DEVICES,
  instructionNames: INSTRUCTION_NAMES,
  symbols: SYMBOLS,
  gridCols: 11,
  // 一次資料でキー割当を確認できないので、流用した表の全行に断りを入れる（Phase 7 §5.2）
  // 公開一次資料で未確認のGXキーは割り当てない。記号ボタン・Enterで入力する。
  shortcuts: [],
  convertStep: false,
  monitorColors: MONITOR_COLORS,
  panels: PANELS,
  validate,
  errorMessages: ERROR_MESSAGES,
};
