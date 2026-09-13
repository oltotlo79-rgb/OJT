import type { SignalLog, SignalValue } from './log.js';

/** 判定の許容差。§7.4 */
export interface Tolerance {
  /** 遷移時刻の許容差[ms]。 */
  edgeMs: number;
  /** 直前の区間長に対する許容比。 */
  ratio: number;
}

/** 既定の許容差。§7.4 */
export const DEFAULT_TOLERANCE: Tolerance = { edgeMs: 200, ratio: 0.1 };

/** 不一致の理由。 */
export type MismatchReason =
  /** 値は同じだが遷移時刻が許容差を超えてずれている。 */
  | 'timing'
  /** 同じ順番の遷移で値が違う。 */
  | 'value'
  /** 模範側にある遷移が訓練者側に無い。 */
  | 'missing'
  /** 訓練者側に余分な遷移がある。 */
  | 'extra';

/** 不一致1件。 */
export interface Mismatch {
  /** 模範側の遷移時刻[ms]（`extra` のときは訓練者側の時刻）。 */
  tMs: number;
  signal: string;
  expected: SignalValue | undefined;
  actual: SignalValue | undefined;
  reason: MismatchReason;
  /** 訓練者側の遷移時刻[ms]。 */
  actualTMs?: number;
  /** その遷移に適用した許容差[ms]。 */
  allowedMs?: number;
}

/** その遷移に適用する許容差[ms]。`edgeMs` と「直前の区間長 × ratio」の大きい方。§7.4 */
export function allowedShiftMs(previousIntervalMs: number, tolerance: Tolerance): number {
  return Math.max(tolerance.edgeMs, previousIntervalMs * tolerance.ratio);
}

/**
 * 模範回路のログと訓練者回路のログを突き合わせ、不一致の一覧を返す。§7.4
 * 空配列なら動作一致（合格）。
 */
export function compareLogs(
  expected: SignalLog,
  actual: SignalLog,
  signals: readonly string[],
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): Mismatch[] {
  const out: Mismatch[] = [];
  for (const signal of signals) {
    const want = expected.transitions(signal);
    const got = actual.transitions(signal);
    const count = Math.max(want.length, got.length);
    for (let i = 0; i < count; i += 1) {
      const w = want[i];
      const g = got[i];
      if (w === undefined && g !== undefined) {
        out.push({ tMs: g.tMs, signal, expected: undefined, actual: g.value, reason: 'extra' });
        continue;
      }
      if (w === undefined || g === undefined) {
        if (w !== undefined) {
          out.push({ tMs: w.tMs, signal, expected: w.value, actual: undefined, reason: 'missing' });
        }
        continue;
      }
      if (w.value !== g.value) {
        out.push({
          tMs: w.tMs,
          signal,
          expected: w.value,
          actual: g.value,
          reason: 'value',
          actualTMs: g.tMs,
        });
        continue;
      }
      const previous = want[i - 1];
      const interval = previous === undefined ? 0 : w.tMs - previous.tMs;
      const allowed = allowedShiftMs(interval, tolerance);
      if (Math.abs(w.tMs - g.tMs) > allowed) {
        out.push({
          tMs: w.tMs,
          signal,
          expected: w.value,
          actual: g.value,
          reason: 'timing',
          actualTMs: g.tMs,
          allowedMs: allowed,
        });
      }
    }
  }
  return out;
}
