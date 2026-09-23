import type { PlcDiagnostics } from '@ojt/ladder-core';
export interface PlcMonitorSnapshot {
  diagnostics?: PlcDiagnostics;
  counterPresets?: Record<number, number>;
  scanCount: number;
  tMs: number;
  /** ネットワークID → 「行 × 16列」を連ねた `'0'`/`'1'` の文字列。ENDネットワークは入らない。 */
  powered: Record<string, string>;
  inputs: boolean[];
  outputs: boolean[];
  internals: Record<number, boolean>;
  /** 特殊リレーは内部リレーと別に運ぶ。同番号M0の値と混同しない。 */
  specials?: Record<number, boolean>;
  /**
   * `presetMs` はコンパイル済みラダーのタイマセルから取る（Batch 3 レビュー M4）。
   * ランタイムの `PlcTimerState` 自体は設定値を持たないので、Worker 側で合成する。
   */
  timers: Record<number, { elapsedMs: number; on: boolean; presetMs: number }>;
  counters: Record<number, { value: number; on: boolean }>;
}
