import { MAX_CATCHUP_TICKS } from './protocol.js';

/**
 * `Simulation` を実時間に追従させるループの純粋部分。設計仕様 §4.3 / §5.2。
 *
 * `setInterval(fn, 10)` は Chromium のタイマ丸め（最小4ms／非表示時は1秒）で
 * 実時間から静かにずれていくため使わない。代わりに `performance.now()` を基準に
 * 「いま何 tick ぶん遅れているか」を毎回計算して、その数だけ進める追従方式にする。
 *
 * ウィンドウ非表示でタイマが詰まった場合は、`MAX_CATCHUP_TICKS`（200ms相当）より
 * 古い遅れは**捨てて基準時刻を現在に引き直す**。まとめて何千 tick も早送りすると、
 * 押しっぱなしのPBが一瞬で数十秒ぶん進むなど訓練者の体感と食い違うため（§8.2）。
 */

/** 追従ループの1周期ぶんの判断結果。 */
export interface TickPlan {
  /** 今回進める tick 数。 */
  ticks: number;
  /** 次回の基準にする「最後に進めた tick の名目時刻」。 */
  nextBaselineMs: number;
  /** 追従上限を超えて捨てた tick 数。 */
  dropped: number;
}

/**
 * いま進めるべき tick 数を決める。
 * @param nowMs `performance.now()` の値
 * @param baselineMs 前回の `nextBaselineMs`（ループ開始時は開始時刻）
 * @param tickMs 1tickの長さ[ms]
 * @param maxCatchUp 1周期で進める tick 数の上限
 */
export function planTicks(
  nowMs: number,
  baselineMs: number,
  tickMs: number,
  maxCatchUp: number = MAX_CATCHUP_TICKS,
): TickPlan {
  if (tickMs <= 0) throw new RangeError(`tickMs は正の数にします: ${tickMs}`);
  const behind = nowMs - baselineMs;
  if (behind < tickMs) return { ticks: 0, nextBaselineMs: baselineMs, dropped: 0 };
  const due = Math.floor(behind / tickMs);
  if (due <= maxCatchUp) {
    return { ticks: due, nextBaselineMs: baselineMs + due * tickMs, dropped: 0 };
  }
  // 詰まったぶんは捨てて基準を現在へ引き直す
  return { ticks: maxCatchUp, nextBaselineMs: nowMs, dropped: due - maxCatchUp };
}

/** 経過[ms]を `12:34.5` の形に整える（経過時間表示）。§8.1 */
export function formatElapsed(ms: number): string {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = (clamped % 60_000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}
