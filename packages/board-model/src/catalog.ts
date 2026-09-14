import { TIMER_RANGE_10S_MS, TIMER_RANGE_60S_MS, TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';
import { SOCKET_PIN_COUNT } from './board-jipm.js';

/**
 * 訓練者がソケットに装着できる部品のカタログ。設計仕様 §6.6 / §5.3.1 / §5.3.2。
 * 盤に固定されている部品（PB／PL／電源）はカタログに含めない（装着対象ではないため）。
 */

/** ソケットに装着できる部品種別の一覧。§3 決定事項#3 */
export const MOUNTABLE_KINDS = ['relay-my4n', 'timer-h3y4'] as const;

/** ソケットに装着できる部品種別。§3 決定事項#3 */
export type MountableKind = (typeof MOUNTABLE_KINDS)[number];

/** タイマの時間レンジ。§5.3.2 / §17.2 #12 */
export interface TimerRange {
  id: '0-10s' | '0-60s';
  /** レンジ上限[ms]。 */
  maxMs: number;
  /** 分解能[ms]。 */
  stepMs: number;
  label: string;
}

/** 0〜10秒レンジ（0.1秒刻み）。§5.3.2 */
export const TIMER_RANGE_10S: TimerRange = {
  id: '0-10s',
  maxMs: TIMER_RANGE_10S_MS,
  stepMs: 100,
  label: '0〜10秒（0.1秒刻み）',
};

/** 0〜60秒レンジ（0.5秒刻み）。§5.3.2 */
export const TIMER_RANGE_60S: TimerRange = {
  id: '0-60s',
  maxMs: TIMER_RANGE_60S_MS,
  stepMs: 500,
  label: '0〜60秒（0.5秒刻み）',
};

/** 選択できるタイマレンジ（既定は 0〜10s）。§5.3.2 */
export const TIMER_RANGES: readonly TimerRange[] = [TIMER_RANGE_10S, TIMER_RANGE_60S];

/** 既定のタイマレンジ。§5.3.2 */
export const DEFAULT_TIMER_RANGE: TimerRange = TIMER_RANGE_10S;

/**
 * タイマ設定の既定値[ms]（新規装着時にダイヤルへ入る値）。
 *
 * 意図的に `DEFAULT_TIMER_RANGE`（0〜10秒レンジ・0.1秒刻み）で選べる最小値にしてある
 * （`snapPresetToStep()` の下限 = `max(TIMER_MIN_PRESET_MS, range.stepMs)` = 100ms）。
 * どの内蔵課題の設定時間とも一致しない値にすることで、訓練者がダイヤルへ一切触れなくても
 * 課題に合格してしまう抜け穴を防ぐ（Phase 1 受け入れレビュー指摘）。内蔵課題を追加するときは
 * `packages/content/test/builtin-timer-preset.test.ts` がこの既定値との重複を検出する。
 */
export const DEFAULT_TIMER_PRESET_MS = 100;

/** カタログ1件。 */
export interface CatalogEntry {
  kind: MountableKind;
  displayName: string;
  /** 装着可能なソケット種別。§6.6 */
  mountableOn: 'socket-14pin';
  pinCount: typeof SOCKET_PIN_COUNT;
  /** 設定UIのレンジ一覧（リレーは空）。§6.6 */
  ranges: readonly TimerRange[];
}

/** 部品カタログ。 */
export const PART_CATALOG: Readonly<Record<MountableKind, CatalogEntry>> = {
  'relay-my4n': {
    kind: 'relay-my4n',
    displayName: 'ミニチュアリレー 4c（MY4N相当・DC24V）',
    mountableOn: 'socket-14pin',
    pinCount: SOCKET_PIN_COUNT,
    ranges: [],
  },
  'timer-h3y4': {
    kind: 'timer-h3y4',
    displayName: 'ミニチュアタイマ 4c（H3Y-4相当・DC24V・オンディレー）',
    mountableOn: 'socket-14pin',
    pinCount: SOCKET_PIN_COUNT,
    ranges: TIMER_RANGES,
  },
};

/** カタログ参照の失敗。 */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/** 文字列が装着可能な部品種別か。 */
export function isMountableKind(value: string): value is MountableKind {
  return (MOUNTABLE_KINDS as readonly string[]).includes(value);
}

/** カタログを引く。未知の種別は CatalogError。 */
export function catalogEntry(kind: MountableKind): CatalogEntry {
  const entry = PART_CATALOG[kind];
  if (entry === undefined) throw new CatalogError(`カタログに無い部品です: ${kind}`);
  return entry;
}

/** レンジ上限[ms]からレンジ定義を引く。 */
export function findTimerRange(maxMs: number): TimerRange | undefined {
  return TIMER_RANGES.find((r) => r.maxMs === maxMs);
}

/**
 * 設定値をレンジの分解能に丸める（四捨五入）。§5.3.2
 *
 * 下限は `TIMER_MIN_PRESET_MS`（100ms）と**そのレンジの分解能**の大きい方。
 * 0〜60秒レンジは0.5秒刻みなので、刻みに載らない 100ms は取れず下限は 500ms になる。
 * 上限はレンジ上限。非有限な値（NaN・Infinity）は丸めようがないので CatalogError。
 */
export function snapPresetToStep(presetMs: number, range: TimerRange): number {
  if (!Number.isFinite(presetMs)) {
    throw new CatalogError(`タイマ設定値が数値ではありません: ${presetMs}`);
  }
  const snapped = Math.round(presetMs / range.stepMs) * range.stepMs;
  const minMs = Math.max(TIMER_MIN_PRESET_MS, range.stepMs);
  return Math.min(Math.max(snapped, minMs), range.maxMs);
}

/** 課題が与える在庫の1件。§7.1 `inventory` */
export interface InventoryItem {
  kind: MountableKind;
  count: number;
}

/** 既定の在庫（リレー4個・タイマ2個。調査資料 §2.1 の課題1用リレー4個＋課題2用タイマ）。 */
export const DEFAULT_INVENTORY: readonly InventoryItem[] = [
  { kind: 'relay-my4n', count: 4 },
  { kind: 'timer-h3y4', count: 2 },
];

/** 在庫の本数。 */
export function inventoryCount(inventory: readonly InventoryItem[], kind: MountableKind): number {
  return inventory.find((i) => i.kind === kind)?.count ?? 0;
}

/**
 * 在庫から装着済みぶんを引いた残り。本数は0未満にならない。
 *
 * 在庫に無い種別（`inventory` に項目が無い種別）は、装着済みでも結果に現れない。
 * 「その課題では配れない部品」を 0 個として並べても意味がないため、意図的に落としている
 * （残り本数の照会は `inventoryCount` が0を返す）。
 */
export function remainingInventory(
  inventory: readonly InventoryItem[],
  mountedKinds: readonly MountableKind[],
): InventoryItem[] {
  return inventory.map((item) => ({
    kind: item.kind,
    count: Math.max(0, item.count - mountedKinds.filter((k) => k === item.kind).length),
  }));
}
