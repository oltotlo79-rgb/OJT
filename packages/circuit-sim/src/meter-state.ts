import type { TerminalId } from './ids.js';

/**
 * Ω／導通レンジで直前に当てたプローブ配置と活線状態の記録。`ohm-on-live` の連続発行を防ぐ。§5.6 #1
 * `Simulation` とは独立した小さなモジュールに置いてあるのは、`simulation.ts` が `reset()` から
 * この記録を消せるようにするため（`meter.ts` に置くと `meter.ts` ⇄ `simulation.ts` の循環参照になる）。
 */
export interface ProbeRecord {
  black: TerminalId;
  red: TerminalId;
  live: boolean;
}

/** 記録を分けるレンジ。Ωと導通はそれぞれ独立に発行判定する。§5.5 */
export type ProbeRange = 'ohm' | 'continuity';

/**
 * 記録の持ち主（実体は `Simulation`）ごとの直近プローブ記録。
 * 循環参照を避けるため、キーの型は `Simulation` ではなく `object` にしてある。
 */
const records: Record<ProbeRange, WeakMap<object, ProbeRecord>> = {
  ohm: new WeakMap(),
  continuity: new WeakMap(),
};

/** そのレンジの直近プローブ記録（まだ測っていなければ undefined）。 */
export function getProbeState(owner: object, range: ProbeRange): ProbeRecord | undefined {
  return records[range].get(owner);
}

/** そのレンジの直近プローブ記録を更新する。 */
export function setProbeState(owner: object, range: ProbeRange, record: ProbeRecord): void {
  records[range].set(owner, record);
}

/** 全レンジの記録を消す。`Simulation.reset()` から呼ばれ、次の測定が1件目として扱われるようにする。 */
export function clearProbeState(owner: object): void {
  for (const map of Object.values(records)) map.delete(owner);
}

/**
 * アナログ針の振り切れ（`range-exceeded`）を直前に発行したときのつまみ・レンジ・プローブ配置。
 * `tester.ts` の `stepTester()` が読み書きする。§5.6 #2
 * 判定そのものは `tester.ts` にあるが、記録を `Simulation.reset()` から消せるように
 * （`tester.ts` ⇄ `simulation.ts` の循環参照を作らずに）このモジュールへ置いてある。
 */
export interface RangeExceededRecord {
  /** つまみ（モード）とレンジの組を1本にした鍵。 */
  rangeKey: string;
  black: TerminalId | undefined;
  red: TerminalId | undefined;
  /** 直前の読値が振り切れていて、`range-exceeded` を発行済みか。 */
  reported: boolean;
}

const rangeExceeded = new WeakMap<object, RangeExceededRecord>();

/** 直近の振り切れ記録（まだ測っていなければ undefined）。 */
export function getRangeExceeded(owner: object): RangeExceededRecord | undefined {
  return rangeExceeded.get(owner);
}

/** 直近の振り切れ記録を更新する。 */
export function setRangeExceeded(owner: object, record: RangeExceededRecord): void {
  rangeExceeded.set(owner, record);
}

/**
 * 振り切れ記録を消す。`Simulation.reset()` から呼ばれ、リセット後に同じつまみ・同じプローブで
 * 測り直しても改めて1件発行される（＝危険操作の警告が再武装する）ようにする。
 */
export function clearRangeExceeded(owner: object): void {
  rangeExceeded.delete(owner);
}
