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
