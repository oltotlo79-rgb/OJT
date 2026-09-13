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
