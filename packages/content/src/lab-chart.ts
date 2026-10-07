import { compareLogs, SignalLog, type Mismatch } from '@ojt/circuit-sim';
import { LAB_TEMPLATES } from './lab-templates.js';
import type { LabMode } from './schema/common.js';
import {
  LAB_INPUTS,
  LAB_OUTPUTS,
  type LabExpected,
  type LabInput,
  type LabOutput,
} from './schema/lab.js';
import type { ToleranceData } from './schema/judge.js';
import type { Operation } from './schema/operations.js';
import {
  buildTimeChart,
  defaultChartSignals,
  type TimeChart,
  type TimeChartMarker,
  type TimeChartSignalSpec,
} from './timechart.js';

/**
 * 「回路実験」「PLC実験」のタイムチャートの変換（2026-10-08）。
 * 設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §4.1
 *
 * 入力は既存の操作列（押す・離す）のまま課題に持ち、編集窓では押ボタンごとの「押している区間」
 * に直して見せる。正解はランプごとの点灯区間で持つ。区間はどれも `[from, to)` の半開区間。
 * ここは純粋関数だけを置く（画面・ワーカー・判定・例題の生成で共有する）。
 */

/** 区間 `[from, to)`（ms）。 */
export type LabInterval = readonly [number, number];

/** 実験のチャートの持ち物（2種類の課題に共通）。 */
export interface LabChartSource {
  operations: readonly Operation[];
  durationMs: number;
  expected?: LabExpected | undefined;
}

/**
 * 実験の例題（内蔵課題の模範を元の操作で動かした結果。`lab-templates.ts` が生成物）。
 * そのまま `createAssembleLabProblem(template)` などに渡すと、チャートだけが写される。
 */
export interface LabTemplate {
  /** 例題の名前（モードの中で一意。例: `self-hold`）。 */
  id: string;
  mode: LabMode;
  title: string;
  description: string;
  /** 元にした内蔵課題のID。 */
  source: string;
  operations: Operation[];
  durationMs: number;
  expected: LabExpected;
}

/** そのモードの例題（並びは例題の並び）。 */
export function labTemplatesFor(mode: LabMode): LabTemplate[] {
  return LAB_TEMPLATES.filter((template) => template.mode === mode);
}

/** 例題を名前で引く。 */
export function findLabTemplate(mode: LabMode, id: string): LabTemplate | undefined {
  return LAB_TEMPLATES.find((template) => template.mode === mode && template.id === id);
}

/**
 * 区間を正規化する。端を `[0, durationMs]` に収め、長さ0を捨て、昇順に並べ、
 * 重なり・接触を1つにまとめる（接した区間は「つながった点灯」なので1本にする）。
 */
export function normalizeIntervals(
  intervals: readonly LabInterval[],
  durationMs: number,
): LabInterval[] {
  const clipped = intervals
    .map(([from, to]): [number, number] => [
      Math.max(0, Math.min(from, durationMs)),
      Math.max(0, Math.min(to, durationMs)),
    ])
    .filter(([from, to]) => from < to)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [from, to] of clipped) {
    const last = out[out.length - 1];
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * `[fromMs, toMs)` を `value` で塗る（`true` は押す・点灯、`false` は消す）。
 * `fromMs` と `toMs` の大小は問わない（右から左へ引いたドラッグもそのまま渡せる）。
 */
export function paintIntervals(
  intervals: readonly LabInterval[],
  fromMs: number,
  toMs: number,
  value: boolean,
  durationMs: number,
): LabInterval[] {
  const from = Math.min(fromMs, toMs);
  const to = Math.max(fromMs, toMs);
  if (value) return normalizeIntervals([...intervals, [from, to]], durationMs);
  const out: LabInterval[] = [];
  for (const [a, b] of intervals) {
    if (b <= from || a >= to) {
      out.push([a, b]);
      continue;
    }
    if (a < from) out.push([a, from]);
    if (b > to) out.push([to, b]);
  }
  return normalizeIntervals(out, durationMs);
}

/** `tMs` が区間のどれかに入っているか。 */
export function valueAt(intervals: readonly LabInterval[], tMs: number): boolean {
  return intervals.some(([from, to]) => tMs >= from && tMs < to);
}

/** 区間の合計の長さ[ms]。 */
export function totalLength(intervals: readonly LabInterval[]): number {
  return intervals.reduce((sum, [from, to]) => sum + (to - from), 0);
}

/** 操作列 → 押ボタンごとの押している区間（押したまま終わるものは `durationMs` まで）。 */
export function inputIntervals(
  operations: readonly Operation[],
  durationMs: number,
): Record<LabInput, LabInterval[]> {
  const out = Object.fromEntries(LAB_INPUTS.map((name) => [name, [] as LabInterval[]])) as Record<
    LabInput,
    LabInterval[]
  >;
  const pressedAt = new Map<string, number>();
  for (const operation of operations) {
    if (!(LAB_INPUTS as readonly string[]).includes(operation.target)) continue;
    const target = operation.target as LabInput;
    if (operation.action === 'press') {
      if (!pressedAt.has(target)) pressedAt.set(target, operation.t);
      continue;
    }
    const start = pressedAt.get(target);
    if (start === undefined) continue;
    out[target].push([start, operation.t]);
    pressedAt.delete(target);
  }
  for (const [target, start] of pressedAt) out[target as LabInput].push([start, durationMs]);
  for (const name of LAB_INPUTS) out[name] = normalizeIntervals(out[name], durationMs);
  return out;
}

/**
 * 押ボタンごとの区間 → 操作列。時刻順、同じ時刻は「離す」を先に、押ボタンは PB1→PB4 の順。
 * 終端まで押し続ける区間は「離す」を書かない（判定区間の終わりまで押したままになる）。
 */
export function operationsFromInputs(
  inputs: Partial<Record<LabInput, readonly LabInterval[]>>,
  durationMs: number,
): Operation[] {
  // 同じ時刻では、すべての「離す」→すべての「押す」の順（それぞれ PB1→PB4）
  const events: { op: Operation; order: number }[] = [];
  LAB_INPUTS.forEach((target, index) => {
    for (const [from, to] of normalizeIntervals(inputs[target] ?? [], durationMs)) {
      events.push({ op: { t: from, target, action: 'press' }, order: LAB_INPUTS.length + index });
      if (to < durationMs) {
        events.push({ op: { t: to, target, action: 'release' }, order: index });
      }
    }
  });
  events.sort((a, b) => a.op.t - b.op.t || a.order - b.order);
  return events.map((event) => event.op);
}

/** 正解の点灯区間（書いていないランプは空＝消灯）。 */
export function expectedIntervals(
  expected: LabExpected | undefined,
): Record<LabOutput, LabInterval[]> {
  const out = Object.fromEntries(LAB_OUTPUTS.map((name) => [name, [] as LabInterval[]])) as Record<
    LabOutput,
    LabInterval[]
  >;
  for (const row of expected ?? []) out[row.signal] = row.on.map(([from, to]) => [from, to]);
  return out;
}

/** ランプごとの区間 → 正解（点灯の無いランプは書かない）。 */
export function expectedFrom(
  rows: Partial<Record<LabOutput, readonly LabInterval[]>>,
  durationMs: number,
): LabExpected {
  const out: LabExpected = [];
  for (const signal of LAB_OUTPUTS) {
    const on = normalizeIntervals(rows[signal] ?? [], durationMs);
    if (on.length > 0) out.push({ signal, on: on.map(([from, to]) => [from, to]) });
  }
  return out;
}

/**
 * 名前と区間の組から信号ログを作る。`t=0` に全信号の初期値を記録し、以後は変化した時刻だけ。
 * 判定区間の終わりちょうどの「消える」は書かない（シミュレーションは終わりの時刻を記録しない。
 * 「終わりまで点灯」と同じ意味になる）。
 */
function logFromIntervals(
  series: readonly (readonly [string, readonly LabInterval[]])[],
  durationMs: number,
): SignalLog {
  const times = new Set<number>([0]);
  for (const [, intervals] of series) {
    for (const [from, to] of intervals) {
      if (from < durationMs) times.add(from);
      if (to < durationMs) times.add(to);
    }
  }
  const log = new SignalLog();
  for (const t of [...times].sort((a, b) => a - b)) {
    log.record(t, new Map(series.map(([name, intervals]) => [name, valueAt(intervals, t)])));
  }
  return log;
}

/** 正解の信号ログ（入力 PB1〜PB4 と出力 PL1〜PL4。比較と表示に使う）。 */
export function labExpectedLog(source: LabChartSource): SignalLog {
  const inputs = inputIntervals(source.operations, source.durationMs);
  const outputs = expectedIntervals(source.expected);
  return logFromIntervals(
    [
      ...LAB_INPUTS.map((name) => [name, inputs[name]] as const),
      ...LAB_OUTPUTS.map((name) => [name, outputs[name]] as const),
    ],
    source.durationMs,
  );
}

/** 実験のチャートに並べる行（押ボタン4行・ランプ4行。判定しないランプも並べる）。 */
export function labChartSignals(): TimeChartSignalSpec[] {
  return defaultChartSignals([...LAB_OUTPUTS]);
}

/** 正解のタイムチャート（表示用）。 */
export function labExpectedChart(
  source: LabChartSource,
  markers: readonly TimeChartMarker[] = [],
): TimeChart {
  return buildTimeChart(labExpectedLog(source), labChartSignals(), source.durationMs, markers);
}

/** タイムチャート → 信号ログ（区間の境目を変化として記録し直す）。 */
export function logFromChart(chart: TimeChart): SignalLog {
  return logFromIntervals(
    chart.signals.map(
      (signal) =>
        [
          signal.name,
          signal.segments
            .filter((segment) => segment.value)
            .map((segment) => [segment.fromMs, segment.toMs] as const),
        ] as const,
    ),
    chart.durationMs,
  );
}

/** 実際のチャートの出力行 → 正解（「この結果を正解にする」）。 */
export function expectedFromChart(chart: TimeChart): LabExpected {
  const rows: Partial<Record<LabOutput, LabInterval[]>> = {};
  for (const signal of chart.signals) {
    if (!(LAB_OUTPUTS as readonly string[]).includes(signal.name)) continue;
    rows[signal.name as LabOutput] = signal.segments
      .filter((segment) => segment.value)
      .map((segment) => [segment.fromMs, segment.toMs] as const);
  }
  return expectedFrom(rows, chart.durationMs);
}

/**
 * 正解と実際のチャートを比べ直す（正解だけを描き直したとき、動かし直さずに違いを出す）。
 * 判定（`judgeAssembleLab` / `judgePlcLab`）と同じ `compareLogs` を使う。
 */
export function compareWithExpected(
  source: LabChartSource & {
    judge: { compareSignals?: readonly string[] | undefined; tolerance: ToleranceData };
  },
  actual: TimeChart,
): Mismatch[] {
  if (source.expected === undefined) return [];
  return compareLogs(
    labExpectedLog(source),
    logFromChart(actual),
    source.judge.compareSignals ?? [...LAB_OUTPUTS],
    source.judge.tolerance,
  );
}
