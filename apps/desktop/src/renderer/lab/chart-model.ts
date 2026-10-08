import {
  expectedFrom,
  expectedIntervals,
  inputIntervals,
  LAB_DRAW_STEP_MS,
  LAB_INPUTS,
  LAB_MAX_DURATION_MS,
  LAB_MIN_DURATION_MS,
  LAB_OUTPUTS,
  normalizeIntervals,
  operationsFromInputs,
  OUTPUT_LABELS,
  paintIntervals,
  PB_LABELS,
  valueAt,
  type LabInput,
  type LabInterval,
  type LabOutput,
  type LabProblem,
  type TimeChartSegment,
} from '@ojt/content';

/**
 * タイムチャートの編集の純関数（2026-10-08）。設計 §6.3
 *
 * 編集窓は押ボタン4行・ランプ4行を並べ、行の上をドラッグして区間を塗る。押ボタンの区間は課題の
 * 操作列（押す・離す）に、ランプの区間は正解（`expected`）に書き戻す。React にも DOM にも触らない
 * ので、塗り方・吸着・秒の読み取りを画面を出さずに確かめられる。
 */

/** 実験のチャートの1行の信号。 */
export type LabSignal = LabInput | LabOutput;

/** 編集窓の1行（押ボタンの行とランプの行）。 */
export type LabRow =
  | { kind: 'input'; signal: LabInput; label: string; intervals: LabInterval[]; judged: false }
  | {
      kind: 'output';
      signal: LabOutput;
      label: string;
      intervals: LabInterval[];
      /** 判定に使うランプか。 */
      judged: boolean;
    };

/** 押ボタンの行か。 */
export function isLabInput(signal: LabSignal): signal is LabInput {
  return (LAB_INPUTS as readonly string[]).includes(signal);
}

/** 判定に使うランプ（指定が無ければ4つすべて）。 */
export function judgedSignals(problem: LabProblem): LabOutput[] {
  const listed = problem.judge.compareSignals;
  return LAB_OUTPUTS.filter((signal) => listed === undefined || listed.includes(signal));
}

/** 編集窓の行（押ボタン4行は操作列から、ランプ4行は正解から）。 */
export function labRows(problem: LabProblem): LabRow[] {
  const inputs = inputIntervals(problem.operations, problem.durationMs);
  const outputs = expectedIntervals(problem.expected);
  const judged = new Set<string>(judgedSignals(problem));
  return [
    ...LAB_INPUTS.map((signal): LabRow => ({
      signal,
      kind: 'input',
      label: PB_LABELS[signal] ?? signal,
      intervals: inputs[signal],
      judged: false,
    })),
    ...LAB_OUTPUTS.map((signal): LabRow => ({
      signal,
      kind: 'output',
      label: OUTPUT_LABELS[signal] ?? signal,
      intervals: outputs[signal],
      judged: judged.has(signal),
    })),
  ];
}

/** 時刻を描く刻み（0.1秒）へ吸着させ、`[0, durationMs]` に収める。 */
export function snapMs(ms: number, durationMs: number, step: number = LAB_DRAW_STEP_MS): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(durationMs, Math.max(0, Math.round(ms / step) * step));
}

/**
 * ドラッグで塗る値。点灯（押している）区間の上から始めたら消し、そうでなければ点ける。
 * 区間の終わりちょうどは「消えている」側なので、続けて引くと区間が伸びる。
 */
export function paintValueAt(row: Pick<LabRow, 'intervals'>, startMs: number): boolean {
  return !valueAt(row.intervals, startMs);
}

/** 行の区間をまるごと差し替えた課題（押ボタンは操作列、ランプは正解へ書き戻す）。 */
export function setRowIntervals<P extends LabProblem>(
  problem: P,
  signal: LabSignal,
  intervals: readonly LabInterval[],
): P {
  const durationMs = problem.durationMs;
  if (isLabInput(signal)) {
    const inputs = { ...inputIntervals(problem.operations, durationMs), [signal]: intervals };
    return { ...problem, operations: operationsFromInputs(inputs, durationMs) };
  }
  const outputs = { ...expectedIntervals(problem.expected), [signal]: intervals };
  return { ...problem, expected: expectedFrom(outputs, durationMs) };
}

/** 行の `[fromMs, toMs)` を塗った課題。 */
export function applyRowPaint<P extends LabProblem>(
  problem: P,
  signal: LabSignal,
  fromMs: number,
  toMs: number,
  value: boolean,
): P {
  const row = labRows(problem).find((candidate) => candidate.signal === signal);
  const current = row?.intervals ?? [];
  return setRowIntervals(
    problem,
    signal,
    paintIntervals(current, fromMs, toMs, value, problem.durationMs),
  );
}

/**
 * 長さを変えた課題。縮めたときは長さを超える押し方と正解を切り詰める
 * （押したまま終わる区間は「離す」を書かない形になる）。
 */
export function setDuration<P extends LabProblem>(problem: P, durationMs: number): P {
  const next = Math.min(LAB_MAX_DURATION_MS, Math.max(LAB_MIN_DURATION_MS, durationMs));
  const inputs = inputIntervals(problem.operations, problem.durationMs);
  const clippedInputs = Object.fromEntries(
    LAB_INPUTS.map((signal) => [signal, normalizeIntervals(inputs[signal], next)]),
  ) as Record<LabInput, LabInterval[]>;
  const resized: P = {
    ...problem,
    durationMs: next,
    operations: operationsFromInputs(clippedInputs, next),
  };
  if (problem.expected === undefined) return resized;
  return { ...resized, expected: expectedFrom(expectedIntervals(problem.expected), next) };
}

/** 押し方をすべて消した課題。 */
export function clearInputs<P extends LabProblem>(problem: P): P {
  return { ...problem, operations: [] };
}

/** 正解を消した課題（正解が無ければ判定はできず、動かすだけになる）。 */
export function clearExpected<P extends LabProblem>(problem: P): P {
  const next = { ...problem };
  delete next.expected;
  return next;
}

/**
 * 判定に使うランプの印を切り替えた課題。4つすべてなら指定を省き（既定＝すべて）、
 * 最後の1つは外させない（判定するランプが0では判定にならない）。
 */
export function toggleJudged<P extends LabProblem>(problem: P, signal: LabOutput): P {
  const current = new Set<string>(judgedSignals(problem));
  if (current.has(signal)) {
    if (current.size === 1) return problem;
    current.delete(signal);
  } else {
    current.add(signal);
  }
  const listed = LAB_OUTPUTS.filter((name) => current.has(name));
  const judge = { ...problem.judge };
  if (listed.length === LAB_OUTPUTS.length) delete judge.compareSignals;
  else judge.compareSignals = listed;
  return { ...problem, judge };
}

/** 秒の表示（`1.5` / `0.52` / `3`。入力欄にそのまま入れられる形）。 */
export function secondsText(ms: number): string {
  return String(Math.round(ms / 10) / 100);
}

/**
 * 入力欄の秒を読む（`1.5` → 1500ms）。全角数字も読む。0.01秒（10ms）単位でない値・負の値・
 * 数でないものは `undefined`（`maxMs` を渡せばそれを超える値も）。
 */
export function parseSeconds(text: string, maxMs?: number): number | undefined {
  const normalized = text.normalize('NFKC').trim();
  if (!/^\d+(\.\d{1,2})?$/u.test(normalized)) return undefined;
  const ms = Math.round(Number(normalized) * 1000);
  if (!Number.isFinite(ms) || ms % 10 !== 0) return undefined;
  if (maxMs !== undefined && ms > maxMs) return undefined;
  return ms;
}

/**
 * 実験の欄の1行に出す数（押し方の区間数・正解を描いたランプの数）。正解が無いときは
 * `expectedRows` が `undefined`（0 は「ランプはすべて消えたまま」という正解）。
 */
export function chartCounts(problem: LabProblem): {
  inputs: number;
  expectedRows: number | undefined;
} {
  const inputs = inputIntervals(problem.operations, problem.durationMs);
  return {
    inputs: LAB_INPUTS.reduce((sum, signal) => sum + inputs[signal].length, 0),
    expectedRows: problem.expected?.length,
  };
}

/** 区間の列を、チャートの区間（`[0, durationMs]` を隙間なく埋める点灯・消灯の列）にする。 */
export function segmentsOf(
  intervals: readonly LabInterval[],
  durationMs: number,
): TimeChartSegment[] {
  const out: TimeChartSegment[] = [];
  let at = 0;
  for (const [from, to] of normalizeIntervals(intervals, durationMs)) {
    if (from > at) out.push({ fromMs: at, toMs: from, value: false });
    out.push({ fromMs: from, toMs: to, value: true });
    at = to;
  }
  if (at < durationMs) out.push({ fromMs: at, toMs: durationMs, value: false });
  return out;
}
