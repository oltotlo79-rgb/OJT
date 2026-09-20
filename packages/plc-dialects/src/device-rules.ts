import {
  device,
  type Cell,
  type Device,
  type DeviceKind,
  type LadderProgram,
} from '@ojt/ladder-core';
import type { DeviceRange, DialectError, TimerPresetText } from './profile.js';

/**
 * 4方言で共通するデバイス検査と、IRからデバイスを集める走査。設計仕様 §10.5 / §10.8。
 *
 * 三菱（`mitsubishi.ts`）は番号帯ごとにタイマの時間単位が変わるうえ、エラー文言が Phase 3 の
 * テストで固定されているので**この器を使わない**（決定表#3）。Phase 4 で足す3方言は時間単位が
 * 一定なので、ここに置いた `TimerRule` と `collectDeviceIssues()` をそのまま使える。
 */

/** 時間単位が一定の方言のタイマ規則（OMRON・JTEKT・シャープはいずれも0.1秒刻み）。 */
export interface TimerRule {
  /** 設定値1カウントの長さ[ms]。 */
  baseMs: number;
  /** 設定値カウントの下限。 */
  min: number;
  /** 設定値カウントの上限。 */
  max: number;
  /** エラー文言に出す単位名（`0.1秒`）。 */
  unitLabel: string;
  /** カウント → 方言の設定値表記。 */
  format(count: number): string;
  /** 方言の設定値表記 → カウント。読めなければ `undefined`。 */
  parse(text: string): number | undefined;
}

/**
 * デバイス・設定値の入力文字列を正規化する。指摘 PD-1
 *
 * 4方言とも `trim()` ＋ `toUpperCase()` だけで全角を正規化せず、日本語IMEの既定入力
 * （`Ｘ０`・`Ｋ３０`）を必ず弾いていた。`normalize('NFKC')` で全角英数字・記号を半角へ寄せてから
 * 前後の空白を落とし大文字化する。4方言の `parseDevice` / `parseTimerPreset` /
 * `parseCounterPreset` の先頭から呼ぶ。
 */
export function normalizeDeviceText(text: string): string {
  return text.normalize('NFKC').trim().toUpperCase();
}

/** `DialectProfile.timerPreset` を作る。 */
export function makeTimerPreset(
  rule: TimerRule,
  formatDevice: (device: Device) => string,
): (ms: number, timer: Device) => TimerPresetText | Error {
  return (ms, timer) => {
    if (!Number.isInteger(ms) || ms <= 0 || ms % rule.baseMs !== 0) {
      return new Error(
        `${formatDevice(timer)} は${rule.unitLabel}単位で指定します（${ms}ms は指定できません）`,
      );
    }
    const count = ms / rule.baseMs;
    if (count < rule.min || count > rule.max) {
      return new Error(
        `${formatDevice(timer)} の設定値が範囲外です（${rule.format(rule.min)}〜${rule.format(rule.max)}）: ${rule.format(count)}`,
      );
    }
    return { text: rule.format(count), device: timer };
  };
}

/** `DialectProfile.parseTimerPreset` を作る。 */
export function makeParseTimerPreset(
  rule: TimerRule,
): (text: string, timer: Device) => number | Error {
  return (text) => {
    const count = rule.parse(text);
    if (count === undefined) return new Error(`読めないタイマ設定値です: ${text}`);
    if (count < rule.min || count > rule.max) {
      return new Error(
        `タイマ設定値が範囲外です（${rule.format(rule.min)}〜${rule.format(rule.max)}）: ${text}`,
      );
    }
    return count * rule.baseMs;
  };
}

/**
 * 番号が範囲内なら IR のデバイスを、外なら共通の文言（「この機種にはない番号です」）で
 * `Error` を返す（投げない）。OMRON・JTEKT・シャープの3方言で重複していた番号帯チェックを
 * ここに集めた（レビュー A-M3）。三菱は番号帯ごとに時間単位が変わるうえエラー文言が
 * Phase 3 のテストで固定されているのでこの器を使わない（決定表#3）。
 */
export function deviceInRange(
  ranges: Readonly<Record<DeviceKind, DeviceRange>>,
  formatDevice: (target: Device) => string,
  kind: DeviceKind,
  index: number,
  text: string,
): Device | Error {
  const range = ranges[kind];
  if (index < range.min || index > range.max) {
    const low = formatDevice({ kind, index: range.min });
    const high = formatDevice({ kind, index: range.max });
    return new Error(`この機種にはない番号です（${low}〜${high}）: ${text}`);
  }
  return device(kind, index);
}

/** 共通デバイス検査に要る方言の情報。 */
export interface DeviceRuleSet {
  deviceRanges: Readonly<Record<DeviceKind, DeviceRange>>;
  specialDevices: Readonly<Record<number, string>>;
  formatDevice(device: Device): string;
  timer: TimerRule;
  counter: { min: number; max: number };
}

/** デバイスが現れた位置。 */
export interface DevicePlace {
  networkId: string;
  row: number;
  col: number;
}

/** IR上のデバイス1件（最初に現れた位置つき）。 */
export interface DeviceUse {
  device: Device;
  place: DevicePlace;
}

/** セルが参照するデバイスを左から右の順に返す。 */
function devicesOf(cell: Cell): Device[] {
  if (
    cell.kind === 'contact' ||
    cell.kind === 'coil' ||
    cell.kind === 'mc' ||
    cell.kind === 'mcr'
  ) {
    return [cell.device];
  }
  if (cell.kind === 'timer') return [cell.device];
  if (cell.kind === 'counter') return [cell.device, cell.resetDevice];
  return [];
}

/**
 * プログラムが使うデバイスを、グリッドの順（ネットワーク → 行 → 列）で重複なく集める。§10.7
 * 表記切替（`switchNotation()`）と共通デバイス検査の両方がこの走査を使う。
 */
export function collectDevices(source: LadderProgram): DeviceUse[] {
  const seen = new Set<string>();
  const uses: DeviceUse[] = [];
  for (const net of source.networks) {
    net.cells.forEach((cells, row) => {
      cells.forEach((cell, col) => {
        for (const target of devicesOf(cell)) {
          const key = `${target.kind}:${target.index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          uses.push({ device: target, place: { networkId: net.id, row, col } });
        }
      });
    });
  }
  return uses;
}

/** デバイス種別の番号帯を方言表記で書いた文字列（`I0〜I7`）。 */
function rangeLabel(rules: DeviceRuleSet, kind: DeviceKind): string {
  const range = rules.deviceRanges[kind];
  if (kind === 'special') return `${range.prefix}${range.min}〜${range.prefix}${range.max}`;
  const low = rules.formatDevice({ kind, index: range.min });
  const high = rules.formatDevice({ kind, index: range.max });
  return `${low}〜${high}`;
}

/** デバイス1つの番号帯を検査する。 */
function checkDevice(
  target: Device,
  place: DevicePlace,
  rules: DeviceRuleSet,
  errors: DialectError[],
): void {
  if (target.kind === 'special') {
    if (rules.specialDevices[target.index] !== undefined) return;
    // device() が SP0〜SP2 以外を作らせず、この器を使う3方言とも SPECIAL_DEVICES がその3つを
    // すべて定義しているため、ここから先には到達しない（防御的）
    /* c8 ignore next 8 */
    const range = rules.deviceRanges.special;
    errors.push({
      code: 'special-unsupported',
      message: `この機種にはない特殊デバイスです（${rangeLabel(rules, 'special')}）: ${range.prefix}${target.index}`,
      device: target,
      ...place,
    });
    return;
  }
  const range = rules.deviceRanges[target.kind];
  if (target.index >= range.min && target.index <= range.max) return;
  errors.push({
    code: 'device-range',
    message: `${rules.formatDevice(target)} はこの機種のデバイス範囲外です（${rangeLabel(rules, target.kind)}）`,
    device: target,
    ...place,
  });
}

/** セル1つを検査する（設定値の検査もここで行う）。`timerPreset` は呼び出し側が1回だけ作る（A-M5）。 */
function checkCell(
  cell: Cell,
  place: DevicePlace,
  rules: DeviceRuleSet,
  timerPreset: (ms: number, timer: Device) => TimerPresetText | Error,
  errors: DialectError[],
): void {
  if (cell.kind === 'timer') {
    const preset = timerPreset(cell.presetMs, cell.device);
    if (preset instanceof Error) {
      const divisible =
        Number.isInteger(cell.presetMs) &&
        cell.presetMs > 0 &&
        cell.presetMs % rules.timer.baseMs === 0;
      errors.push({
        code: divisible ? 'timer-range' : 'timer-unit',
        message: preset.message,
        device: cell.device,
        ...place,
      });
    }
  } else if (cell.kind === 'counter') {
    if (cell.preset < rules.counter.min || cell.preset > rules.counter.max) {
      errors.push({
        code: 'counter-range',
        message: `カウンタ設定値が範囲外です（${rules.counter.min}〜${rules.counter.max}）: ${cell.preset}`,
        device: cell.device,
        ...place,
      });
    }
  }
  for (const target of devicesOf(cell)) checkDevice(target, place, rules, errors);
}

/**
 * デバイス範囲・タイマ単位・カウンタ範囲・未対応の特殊デバイスを検査する。§10.5 / §10.8
 * 方言固有の検査（TOYOPUC の同番号重複など）は各プロファイルがこの結果に足す。
 */
export function collectDeviceIssues(source: LadderProgram, rules: DeviceRuleSet): DialectError[] {
  const errors: DialectError[] = [];
  // セルの数だけ作り直さない（A-M5）。デバイス表記はプログラム全体で同じなので1回で足りる
  const timerPreset = makeTimerPreset(rules.timer, (d) => rules.formatDevice(d));
  for (const net of source.networks) {
    net.cells.forEach((cells, row) => {
      cells.forEach((cell, col) => {
        if (cell.kind === 'empty') return;
        checkCell(cell, { networkId: net.id, row, col }, rules, timerPreset, errors);
      });
    });
  }
  return errors;
}
