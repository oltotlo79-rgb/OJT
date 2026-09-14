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

/**
 * 経過[ms]を `12:34.5` の形に整える（経過時間表示）。§8.1
 *
 * **先に0.1秒へ丸めてから**分と秒に割る。分・秒を先に出して秒だけ丸めると、
 * 59.95秒が `00:60.0`（分が繰り上がらないまま秒が60）になる。
 */
export function formatElapsed(ms: number): string {
  const deciseconds = Math.round(Math.max(0, ms) / 100);
  const minutes = Math.floor(deciseconds / 600);
  const seconds = (deciseconds % 600) / 10;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** `formatSavedAt()` の表示体裁（`Intl.DateTimeFormat` の options）。 */
const SAVED_AT_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/**
 * 一時保存の保存時刻（ISO 8601 / UTC）を、実行環境のローカル時刻で
 * `2026/09/14 21:05` の形に整える（復元プロンプト表示用）。§12.3
 *
 * 生の ISO 文字列（`T`区切り・末尾`Z`）のまま出すと日本語ユーザーには読み取りづらく、
 * UTCのままなのでローカル時刻とずれる。不正な値・空文字は空文字を返すので、
 * 呼び出し側は時刻部分を省いた文言にフォールバックする。
 */
export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', SAVED_AT_FORMAT).format(date);
}
