import {
  ctu,
  fall,
  mc,
  mcr,
  nc,
  no,
  out,
  rise,
  rst,
  set,
  ton,
  type Cell,
  type Device,
  type DeviceKind,
} from '@ojt/ladder-core';
import { roundTimerPreset, type DialectProfile } from '@ojt/plc-dialects';

/**
 * OMRON・JTEKT・シャープの既定のタイマ刻み（0.1秒＝100ms）。指摘 LE-6
 *
 * この3方言は `DialectProfile.timerBaseMs` を実装しない（一定刻みなので不要）。丸め提示は
 * `profile.timerBaseMs?.(device) ?? DEFAULT_TIMER_BASE_MS` で、三菱だけ番号帯ごとの刻みを使う。
 */
const DEFAULT_TIMER_BASE_MS = 100;

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
 *
 * 指摘 LE-4: 以前は素の数字を「ミリ秒」として**先に**判定していたため、接頭辞を持たない
 * シャープ（0.1秒刻みの10進4桁。例: `0100` = 10秒）で `0100` が 100ms と誤読され、
 * 編集の往復でタイマ設定値が黙って1/100に化けていた。`parseCounterPreset()` と同じく
 * **方言を先に試し**、それが読めないときだけ素の数値へフォールバックする。
 */
export function timerPresetMs(
  text: string,
  device: Device,
  profile: DialectProfile,
): number | Error {
  const trimmed = text.trim();
  if (trimmed.length === 0) return new Error('設定値を入力してください');
  const parsed = profile.parseTimerPreset(trimmed, device);
  if (typeof parsed === 'number') return parsed;
  if (/^[0-9]+$/u.test(trimmed)) {
    const ms = Number(trimmed);
    if (ms <= 0) return new Error('設定値は1以上にしてください');
    return ms;
  }
  return parsed;
}

/** 丸めの提案（§10.5 の「100ms 刻みに丸めますか？」）。丸めが要らなければ undefined。 */
export interface RoundSuggestion {
  ms: number;
  baseMs: number;
  rounded: number;
}

/**
 * その番号帯で表せない ms に対して、丸め先を提案する。
 *
 * 指摘 LE-6: 以前は方言に関わらず三菱固有の `timerBaseMs()`（番号帯で1/10/100ms に変わる）を
 * 使っていたため、OMRON/JTEKT/シャープでもこの機種に無い刻み（例: T256相当で「1ms刻みに
 * 丸めますか」）を提示していた。丸めの刻みは `profile.timerBaseMs?.(device)` から取り、
 * 実装しない方言（一定刻み）は既定の0.1秒刻みへ倒す。
 */
export function roundSuggestionFor(
  ms: number,
  device: Device,
  profile: DialectProfile,
): RoundSuggestion | undefined {
  if (!(profile.timerPreset(ms, device) instanceof Error)) return undefined;
  const baseMs = profile.timerBaseMs?.(device) ?? DEFAULT_TIMER_BASE_MS;
  return { ms, baseMs, rounded: roundTimerPreset(ms, baseMs) };
}

/** 1以上の整数であることだけを確かめる（番号帯の上限は `profile.validate()` が見る）。 */
function checkedCounterPreset(preset: number): number | Error {
  return Number.isInteger(preset) && preset >= 1
    ? preset
    : new Error('カウンタの設定値は1以上の整数にします');
}

/**
 * カウンタ設定値の綴り → 数。§10.5 / 申し送り F-2
 *
 * 綴りの持ち主は `DialectProfile`（三菱 `K5` / OMRON `#0005` / JTEKT `H0005` / シャープ `0005`。
 * 4A Task 7 / d721b23）。タイマの {@link timerPresetMs} と同じく、**素の数値（`5`）も受ける**
 * ——訓練者が方言の頭字を知らなくても入力できるようにするためで、Phase 3 からの振る舞いでもある。
 */
export function parseCounterPreset(text: string, profile: DialectProfile): number | Error {
  const trimmed = text.trim();
  if (trimmed.length === 0) return new Error('設定値を入力してください');
  const parsed = profile.parseCounterPreset?.(trimmed);
  if (typeof parsed === 'number') return checkedCounterPreset(parsed);
  if (/^[0-9]+$/u.test(trimmed)) return checkedCounterPreset(Number(trimmed));
  return parsed ?? new Error('カウンタの設定値を入力してください');
}

/**
 * 数 → カウンタ設定値の綴り（入力例と `Enter` での編集に使う）。
 * 4方言すべてが `counterPresetText` を持つが、型の上では任意なので素の数値へ倒す枝を置く。
 */
export function counterPresetText(preset: number, profile: DialectProfile): string {
  return profile.counterPresetText?.(preset) ?? String(preset);
}

/** 入力欄からセルを作る。読めない値は `Error`（投げない）。 */
export function buildCell(form: CellForm, profile: DialectProfile): Cell | Error {
  const device = readDevice(form.deviceText, profile);
  if (device instanceof Error) return device;
  if (form.target === 'contact') {
    if (form.contact === 'NO') return no(device);
    if (form.contact === 'NC') return nc(device);
    // P/F は `rise()` / `fall()` を通す（オブジェクトリテラルのままだと`@ojt/ladder-core`の
    // デバイス検査を経ないままセルになってしまう。レビュー Minor）
    return form.contact === 'P' ? rise(device) : fall(device);
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
  // Phase 4: 設定値の綴りは方言が決める（`DialectProfile.parseCounterPreset`。申し送り F-2）
  const preset = parseCounterPreset(form.presetText, profile);
  if (preset instanceof Error) return preset;
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
      presetText: counterPresetText(cell.preset, profile),
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
