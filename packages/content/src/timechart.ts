import type { Netlist, SignalLog } from '@ojt/circuit-sim';

/**
 * 信号ログ → タイムチャートモデル。設計仕様 §7.7 / §8.3。
 * 上段に入力（PB）、下段に出力（PL／BZ）を並べる（調査資料 §5.2 の提示形式）。
 * 波形は課題JSONに書かず、模範回路のシミュレーション結果から毎回生成する（決定事項#8）。
 */

/** 信号の区分。§7.7 */
export type TimeChartSignalKind = 'input' | 'output';

/** 1信号のひと区間。 */
export interface TimeChartSegment {
  fromMs: number;
  toMs: number;
  value: boolean;
}

/** チャートに並べる1信号。 */
export interface TimeChartSignal {
  name: string;
  label: string;
  kind: TimeChartSignalKind;
  segments: TimeChartSegment[];
}

/** 目盛に立てる印（タイマ設定秒など）。§7.7 */
export interface TimeChartMarker {
  tMs: number;
  label: string;
}

/** タイムチャート。 */
export interface TimeChart {
  durationMs: number;
  signals: TimeChartSignal[];
  markers: TimeChartMarker[];
}

/** チャートに並べる信号の指定。 */
export interface TimeChartSignalSpec {
  name: string;
  label: string;
  kind: TimeChartSignalKind;
}

/** 押ボタンの表示名（盤の色に合わせる）。§5.3.3 */
export const PB_LABELS: Readonly<Record<string, string>> = {
  PB1: '黒押ボタン（PB1）',
  PB2: '黄押ボタン（PB2）',
  PB3: '緑押ボタン（PB3）',
  PB4: '赤押ボタン（PB4）',
};

/** 出力部品の表示名（盤の色に合わせる）。§5.3.4 */
export const OUTPUT_LABELS: Readonly<Record<string, string>> = {
  PL1: '白ランプ（PL1）',
  PL2: '黄ランプ（PL2）',
  PL3: '緑ランプ（PL3）',
  PL4: '赤ランプ（PL4）',
  BZ: 'ブザー（BZ）',
};

/** 押ボタン4点を上段、比較対象の出力を下段に並べた既定の信号指定。§7.7 */
export function defaultChartSignals(compareSignals: readonly string[]): TimeChartSignalSpec[] {
  const inputs: TimeChartSignalSpec[] = Object.keys(PB_LABELS).map((name) => ({
    name,
    label: PB_LABELS[name] ?? name,
    kind: 'input',
  }));
  const outputs: TimeChartSignalSpec[] = compareSignals.map((name) => ({
    name,
    label: OUTPUT_LABELS[name] ?? name,
    kind: 'output',
  }));
  return [...inputs, ...outputs];
}

/** 秒数を「3秒」「0.8秒」の形に整える。 */
function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? `${seconds}秒` : `${seconds.toFixed(1)}秒`;
}

/**
 * 模範回路に装着されたタイマの設定時間から目盛の印を作る。§7.7
 * 例: `T1` が3秒なら `{ tMs: 3000, label: 'T1=3秒' }`。並びは部品の並び順（決定論）。
 */
export function timerMarkers(netlist: Netlist): TimeChartMarker[] {
  const out: TimeChartMarker[] = [];
  for (const part of netlist.parts) {
    if (part.meta.kind !== 'timer-h3y4') continue;
    out.push({ tMs: part.meta.presetMs, label: `${part.id}=${formatSeconds(part.meta.presetMs)}` });
  }
  return out;
}

/** 1信号ぶんの区間列を作る（記録が無ければ全区間 false）。 */
function segmentsOf(log: SignalLog, name: string, durationMs: number): TimeChartSegment[] {
  const points: { tMs: number; value: boolean }[] = [];
  for (const entry of log.transitions(name)) {
    if (typeof entry.value !== 'boolean') continue;
    if (entry.tMs > durationMs) break;
    points.push({ tMs: entry.tMs, value: entry.value });
  }
  const segments: TimeChartSegment[] = [];
  let value = false;
  let from = 0;
  for (const point of points) {
    if (point.tMs > from && point.value !== value) {
      segments.push({ fromMs: from, toMs: point.tMs, value });
      from = point.tMs;
    }
    value = point.value;
  }
  segments.push({ fromMs: from, toMs: durationMs, value });
  return segments;
}

/**
 * 信号ログをタイムチャートモデルに変換する。§7.7
 * 区間は `[fromMs, toMs)` で隙間なく `durationMs` まで埋まる。boolean 以外の信号（電圧など）は無視する。
 */
export function buildTimeChart(
  log: SignalLog,
  signals: readonly TimeChartSignalSpec[],
  durationMs: number,
  markers: readonly TimeChartMarker[] = [],
): TimeChart {
  return {
    durationMs,
    signals: signals.map((spec) => ({
      name: spec.name,
      label: spec.label,
      kind: spec.kind,
      segments: segmentsOf(log, spec.name, durationMs),
    })),
    markers: [...markers],
  };
}

/** チャートの始まりと終わりがどちらも論理0か（内蔵課題の自己整合テスト用）。§7.3 */
export function startsAndEndsLow(chart: TimeChart): boolean {
  return chart.signals.every((signal) => {
    const first = signal.segments[0];
    const last = signal.segments[signal.segments.length - 1];
    return first !== undefined && last !== undefined && !first.value && !last.value;
  });
}
