import type { LogEntry, SignalLog, SignalValue } from './log.js';

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
  | 'extra'
  /** 比較対象に指定された信号が模範側のログに存在しない。 */
  | 'unknown-signal';

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
 * 遷移列は2つのインデックスで走査し、余分／欠落したエッジはその場で読み飛ばして
 * 以降を再同期する（1箇所のずれが末尾まで不一致になるのを防ぐ）。
 */
export function compareLogs(
  expected: SignalLog,
  actual: SignalLog,
  signals: readonly string[],
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): Mismatch[] {
  const out: Mismatch[] = [];
  for (const signal of signals) {
    const extra = (g: LogEntry): void => {
      out.push({ tMs: g.tMs, signal, expected: undefined, actual: g.value, reason: 'extra' });
    };
    const missing = (w: LogEntry): void => {
      out.push({ tMs: w.tMs, signal, expected: w.value, actual: undefined, reason: 'missing' });
    };
    const value = (w: LogEntry, g: LogEntry): void => {
      out.push({
        tMs: w.tMs,
        signal,
        expected: w.value,
        actual: g.value,
        reason: 'value',
        actualTMs: g.tMs,
      });
    };
    const timing = (w: LogEntry, g: LogEntry, allowed: number): void => {
      out.push({
        tMs: w.tMs,
        signal,
        expected: w.value,
        actual: g.value,
        reason: 'timing',
        actualTMs: g.tMs,
        allowedMs: allowed,
      });
    };

    const want = expected.transitions(signal);
    const got = actual.transitions(signal);
    if (want.length === 0) {
      out.push({
        tMs: 0,
        signal,
        expected: undefined,
        actual: undefined,
        reason: 'unknown-signal',
      });
      continue;
    }
    let i = 0;
    let j = 0;
    while (i < want.length || j < got.length) {
      const w = want[i];
      const g = got[j];
      if (w === undefined) {
        // 模範側は尽きたので、残りの訓練者側の遷移はすべて余分。
        if (g !== undefined) extra(g);
        j += 1;
        continue;
      }
      if (g === undefined) {
        // 訓練者側が尽きたので、残りの模範側の遷移はすべて欠落。
        missing(w);
        i += 1;
        continue;
      }
      const previous = want[i - 1];
      const interval = previous === undefined ? 0 : w.tMs - previous.tMs;
      const allowed = allowedShiftMs(interval, tolerance);
      if (w.value === g.value) {
        if (Math.abs(w.tMs - g.tMs) <= allowed) {
          // 同じエッジとして対応が取れた。
          i += 1;
          j += 1;
          continue;
        }
        const g1 = got[j + 1];
        const g2 = got[j + 2];
        if (
          g1 !== undefined &&
          g2 !== undefined &&
          g2.value === w.value &&
          Math.abs(g2.tMs - w.tMs) <= allowed
        ) {
          // 訓練者側に余分なパルスが1つ入っている。2エッジ読み飛ばして再同期する。
          extra(g);
          extra(g1);
          j += 2;
          continue;
        }
        const w1 = want[i + 1];
        const w2 = want[i + 2];
        if (
          w1 !== undefined &&
          w2 !== undefined &&
          w2.value === g.value &&
          Math.abs(w2.tMs - g.tMs) <= allowed
        ) {
          // 訓練者側でパルスが1つ欠落している。2エッジ読み飛ばして再同期する。
          missing(w);
          missing(w1);
          i += 2;
          continue;
        }
        timing(w, g, allowed);
        i += 1;
        j += 1;
        continue;
      }
      // 値が違う場合は、片方が1エッジぶんずれていないか確かめる。
      const g1 = got[j + 1];
      if (g1 !== undefined && g1.value === w.value && Math.abs(g1.tMs - w.tMs) <= allowed) {
        extra(g);
        j += 1;
        continue;
      }
      const w1 = want[i + 1];
      if (w1 !== undefined && w1.value === g.value && Math.abs(w1.tMs - g.tMs) <= allowed) {
        missing(w);
        i += 1;
        continue;
      }
      value(w, g);
      i += 1;
      j += 1;
    }
  }
  return out;
}
