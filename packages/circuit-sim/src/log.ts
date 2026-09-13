/** 信号値。接点・コイル・ランプは boolean、電位・電流は number。§5.7 */
export type SignalValue = boolean | number;

/** ランレングス記録の1件。§5.7 */
export interface LogEntry {
  tMs: number;
  signal: string;
  value: SignalValue;
}

/** 数値信号を記録する際の小数桁数。丸めないと浮動小数の揺れで毎tick記録されてしまう。 */
export const LOG_DECIMALS = 3;

/** 数値信号を記録用に丸める。 */
export function roundSignal(value: number): number {
  const scale = 10 ** LOG_DECIMALS;
  return Math.round(value * scale) / scale;
}

/**
 * tickごとの監視信号を変化点のみ記録する（ランレングス形式）。§5.7
 * 信号名の規約:
 * - `PB1` … 押下中（boolean）
 * - `CR1` … 接点が動作位置にある（boolean）／`CR1.coil` コイル励磁判定／`CR1.coilV` コイル電圧[V]
 * - `T1`  … 限時接点が反転している（boolean）／`T1.coil` 通電中／`T1.coilV` 電源電圧[V]
 * - `CR1:a1.closed` … 各接点要素の閉（boolean）
 * - `PL1` … 点灯（boolean）／`PL1.level` 0=消灯 1=暗点灯 2=点灯／`PL1.volts` 端子電圧[V]
 * - `V:<端子ID>` … 指定端子の電位[V]
 * - `POWER` … 通電中（boolean）／`POWER.I` 電源電流[A]
 */
export class SignalLog {
  private readonly recorded: LogEntry[] = [];
  private readonly last = new Map<string, SignalValue>();
  /** 信号名 → その信号のエントリ列（`recorded` と同じ内容・同じ順序の索引）。 */
  private readonly bySignal = new Map<string, LogEntry[]>();

  /**
   * 1tickぶんを記録する。前回と同じ値の信号は記録しない。
   * @returns 値が変化した（=記録した）信号名の配列。
   */
  record(tMs: number, values: ReadonlyMap<string, SignalValue>): string[] {
    const changed: string[] = [];
    for (const [signal, raw] of values) {
      const value = typeof raw === 'number' ? roundSignal(raw) : raw;
      const previous = this.last.get(signal);
      if (previous !== undefined && previous === value) continue;
      this.last.set(signal, value);
      const entry: LogEntry = { tMs, signal, value };
      this.recorded.push(entry);
      const bucket = this.bySignal.get(signal);
      if (bucket === undefined) this.bySignal.set(signal, [entry]);
      else bucket.push(entry);
      changed.push(signal);
    }
    return changed;
  }

  /** 記録された全エントリ（時刻昇順）。 */
  entries(): readonly LogEntry[] {
    return this.recorded;
  }

  /** 記録されている信号名の一覧（初出順）。 */
  signals(): string[] {
    return [...this.last.keys()];
  }

  /** その信号の変化点の列（最初の記録＝初期値を含む）。 */
  transitions(signal: string): LogEntry[] {
    return [...(this.bySignal.get(signal) ?? [])];
  }

  /** その時刻における信号の値。まだ記録が無ければ undefined。 */
  valueAt(signal: string, tMs: number): SignalValue | undefined {
    const bucket = this.bySignal.get(signal);
    if (bucket === undefined || bucket.length === 0) return undefined;
    // entry.tMs <= tMs を満たす最後のエントリを二分探索する（bucket は tMs 昇順）。
    let lo = 0;
    let hi = bucket.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = bucket[mid];
      if (entry !== undefined && entry.tMs <= tMs) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found < 0 ? undefined : bucket[found]?.value;
  }

  /** 記録を消す。 */
  clear(): void {
    this.recorded.length = 0;
    this.last.clear();
    this.bySignal.clear();
  }
}
