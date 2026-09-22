import {
  ctu,
  isDraftOutput,
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
import {
  nativeContact,
  roundTimerPreset,
  type DialectProfile,
  type InstructionKey,
} from '@ojt/plc-dialects';
import { JA } from '../i18n/ja.js';

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
 * 丸めますか」）を提示していた。丸めの刻みは `profile.timerBaseMs(device)` から取る。
 */
export function roundSuggestionFor(
  ms: number,
  device: Device,
  profile: DialectProfile,
): RoundSuggestion | undefined {
  if (!(profile.timerPreset(ms, device) instanceof Error)) return undefined;
  const baseMs = profile.timerBaseMs(device);
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
  if (cell.kind === 'draft') {
    return isDraftOutput(cell.symbol)
      ? { ...emptyCellForm('output'), output: cell.symbol as OutputForm }
      : { ...emptyCellForm('contact'), contact: cell.symbol as ContactForm };
  }
  if (cell.kind === 'contact') {
    cell = nativeContact(cell, profile);
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

/* --- Phase 7 Task 21: 1行直接入力（設計 §5.3 / 指摘 PR-01） --- */

/**
 * 1行直接入力の解釈結果。
 *
 * `branch` は「OR接点として置く」印（`OR X1` のように並列の命令で書いたとき）。`LadderEditor`
 * はこれを見て `applyOrContact()` に回す。`undefined` なら押したキー（`PlaceKind`）のまま。
 */
export interface DirectEntry {
  form: CellForm;
  branch?: boolean;
}

/** ニーモニック1語ぶんの意味（どの欄をどう埋めるか）。 */
interface EntrySpec {
  /** この命令が使う `InstructionKey`（応用命令欄の絞り込みに使う）。 */
  key: InstructionKey;
  target: CellForm['target'];
  contact?: ContactForm;
  output?: OutputForm;
  /** 並列（OR）の命令か。 */
  branch?: boolean;
}

/**
 * `InstructionKey` → 入力欄の形。**並び順に意味がある**（先に書いたものが綴りの取り合いに
 * 勝つ）。PCwin 風は `out` / `timer` / `counter` がどれも `OUT` なので、`OUT T0` は
 * まず `out` として読み、デバイスがタイマなら下の {@link promoteByDevice} が TON へ寄せる。
 */
const ENTRY_SPECS: readonly EntrySpec[] = [
  { key: 'ld', target: 'contact', contact: 'NO' },
  { key: 'ldi', target: 'contact', contact: 'NC' },
  { key: 'and', target: 'contact', contact: 'NO' },
  { key: 'ani', target: 'contact', contact: 'NC' },
  { key: 'or', target: 'contact', contact: 'NO', branch: true },
  { key: 'ori', target: 'contact', contact: 'NC', branch: true },
  { key: 'ldp', target: 'contact', contact: 'P' },
  { key: 'ldf', target: 'contact', contact: 'F' },
  { key: 'andp', target: 'contact', contact: 'P' },
  { key: 'andf', target: 'contact', contact: 'F' },
  { key: 'orp', target: 'contact', contact: 'P', branch: true },
  { key: 'orf', target: 'contact', contact: 'F', branch: true },
  { key: 'out', target: 'output', output: 'OUT' },
  { key: 'set', target: 'output', output: 'SET' },
  { key: 'rst', target: 'output', output: 'RST' },
  { key: 'mc', target: 'output', output: 'MC' },
  { key: 'mcr', target: 'output', output: 'MCR' },
  { key: 'timer', target: 'output', output: 'TON' },
  { key: 'counter', target: 'output', output: 'CTU' },
];

/**
 * メーカーの綴りに関わらず受ける短い綴り。応用命令欄の断り文
 * （`JA.ladder.entry.applicationUnsupported`）が挙げている6語をそのまま受けるためにある。
 */
const ENTRY_ALIASES: Readonly<Record<string, InstructionKey>> = {
  SET: 'set',
  RST: 'rst',
  MC: 'mc',
  MCR: 'mcr',
  T: 'timer',
  C: 'counter',
};

/** 応用命令欄（三菱 `F8` ／ OMRON `I`）が受ける命令。設計 §5.2 */
const APPLICATION_KEYS: ReadonlySet<InstructionKey> = new Set<InstructionKey>([
  'set',
  'rst',
  'mc',
  'mcr',
  'timer',
  'counter',
]);

/** ニーモニックは最大3語（`OUT T` / `AND NOT` / `STR NOT` のように空白を含む綴りがある）。 */
const MAX_MNEMONIC_WORDS = 3;

/**
 * 全角で打たれても読めるようにする（指摘 PD-1）。`NFKC` は全角英数と全角空白を半角へ畳む。
 */
export function normalizeEntryText(text: string): string {
  return text.normalize('NFKC');
}

/** その方言の「綴り → 命令の意味」表。同じ綴りが重なったら **先に書いた命令が勝つ**。 */
function entryTable(profile: DialectProfile): Map<string, EntrySpec> {
  const table = new Map<string, EntrySpec>();
  for (const spec of ENTRY_SPECS) {
    const name = normalizeEntryText(profile.instructionNames[spec.key]).toUpperCase();
    // 綴りが空（あり得ないが型の上では起こり得る）や既出のものは飛ばす
    if (name.length === 0 || table.has(name)) continue;
    table.set(name, spec);
  }
  for (const [alias, key] of Object.entries(ENTRY_ALIASES)) {
    if (table.has(alias)) continue;
    const spec = ENTRY_SPECS.find((item) => item.key === key);
    if (spec !== undefined) table.set(alias, spec);
  }
  return table;
}

/** その方言で使える命令の綴り（応用命令欄の案内に出す）。 */
export function applicationMnemonics(profile: DialectProfile): string[] {
  return [...entryTable(profile)]
    .filter(([, spec]) => APPLICATION_KEYS.has(spec.key))
    .map(([name]) => name);
}

/**
 * `OUT` で書かれた出力を、デバイスの種別でタイマ・カウンタへ寄せる。
 *
 * 三菱の `OUT T0 K30`（タイマの綴りは `OUT T`）や、`out` / `timer` / `counter` がすべて `OUT` の
 * PCwin 風で「命令どおりに OUT を置いたらタイマに使えない」と断られるのを防ぐ。
 */
function promoteByDevice(
  output: OutputForm,
  deviceText: string,
  profile: DialectProfile,
): OutputForm {
  if (output !== 'OUT') return output;
  const device = profile.parseDevice(deviceText);
  if (device instanceof Error) return output;
  if (device.kind === 'timer') return 'TON';
  if (device.kind === 'counter') return 'CTU';
  return output;
}

/** 1行を語に割る（全角空白も区切りに数える）。 */
function words(text: string): string[] {
  return normalizeEntryText(text)
    .split(/\s+/u)
    .filter((word) => word.length > 0);
}

/**
 * 1行直接入力を読む。設計 §5.3
 *
 * - `LD X0` のように**ニーモニック＋デバイス（＋設定値）**を空白で区切って書ける。綴りは
 *   `profile.instructionNames` から引くので、シャープでは `STR 000000` になる。
 * - **空白を含まない入力は「デバイスだけ」**と読み、記号は `base`（押したキーで決まった形）の
 *   ままにする。
 * - 語が多すぎるときは断る（黙って捨てない）。
 *
 * @param base 押したキー・ドロップダウンで決まっている入力欄の形
 * @param only ここに挙げた命令だけを受ける（応用命令欄）。省略時はすべて受ける
 */
export function parseDirectEntry(
  text: string,
  base: CellForm,
  profile: DialectProfile,
  only?: ReadonlySet<InstructionKey>,
): DirectEntry | Error {
  const parts = words(text);
  if (parts.length === 0) return new Error('デバイスを入力してください');
  const table = entryTable(profile);
  let spec: EntrySpec | undefined;
  let rest = parts;
  for (let take = Math.min(MAX_MNEMONIC_WORDS, parts.length); take >= 1; take -= 1) {
    const found = table.get(parts.slice(0, take).join(' ').toUpperCase());
    // 語が1つだけのときは「デバイスだけ」と読む（応用命令欄は命令が要るので `only` で許す）
    if (found === undefined || (take === parts.length && only === undefined)) continue;
    spec = found;
    rest = parts.slice(take);
    break;
  }
  if (only !== undefined && (spec === undefined || !only.has(spec.key))) {
    return new Error(JA.ladder.entry.applicationUnsupported);
  }
  const form: CellForm = { ...base };
  if (spec !== undefined) {
    form.target = spec.target;
    if (spec.contact !== undefined) form.contact = spec.contact;
    if (spec.output !== undefined) form.output = spec.output;
  }
  form.deviceText = rest[0] ?? '';
  if (form.target === 'output') {
    form.output = promoteByDevice(form.output, form.deviceText, profile);
  }
  const takesPreset = form.target === 'output' && (form.output === 'TON' || form.output === 'CTU');
  const takesReset = form.target === 'output' && form.output === 'CTU';
  if (takesPreset && rest.length >= 2) form.presetText = rest[1] ?? '';
  if (takesReset && rest.length >= 3) form.resetText = rest[2] ?? '';
  const allowed = 1 + (takesPreset ? 1 : 0) + (takesReset ? 1 : 0);
  if (rest.length > allowed) return new Error(JA.ladder.entry.tooManyWords);
  return spec?.branch === true ? { form, branch: true } : { form };
}

/**
 * 応用命令欄（三菱 `F8` ／ OMRON `I`）を読む。設計 §5.2
 * 本アプリが解釈できる命令（SET / RST / MC / MCR / T / C）だけを受け、それ以外は1行で断る。
 */
export function parseApplicationEntry(
  text: string,
  base: CellForm,
  profile: DialectProfile,
): DirectEntry | Error {
  return parseDirectEntry(text, base, profile, APPLICATION_KEYS);
}
