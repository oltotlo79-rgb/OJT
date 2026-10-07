import type { Mismatch } from '@ojt/circuit-sim';
import { operationWindows, PB_LABELS, type Operation, type TimeChart } from '@ojt/content';
import type { ReplaySource, SimSnapshot } from '../../worker/protocol.js';
import type { PlcMonitorSnapshot } from '../app/store-types.js';
import { useStore } from '../app/store.js';
import { JA, outputSignalLabel } from '../i18n/ja.js';
import { circuitForJudge } from './inspect-repair.js';

export interface ReplayStep {
  index: number;
  total: number;
  atMs: number;
  toMs: number;
  action: string;
  expect: string;
  mismatched: boolean;
  mismatchNote?: string;
}
export interface ReplayState {
  source: ReplaySource;
  steps: readonly ReplayStep[];
  index: number;
  busy: boolean;
  openedAtMs: number;
  before: { snapshot: SimSnapshot; plcMonitor: PlcMonitorSnapshot | undefined };
  /** 見直しを終えたら戻る画面（結果画面から／実験の欄の「盤で動きを見る」から）。 */
  returnTo: 'result' | 'session';
}

/** 差分は採点結果そのもの。許容差を別の規則で計算し直さない。 */
export function replaySteps(
  operations: readonly Operation[],
  durationMs: number,
  mismatches: readonly Mismatch[],
  expected?: TimeChart,
): readonly ReplayStep[] {
  const windows = operationWindows(operations, durationMs);
  return windows.map((window, index) => {
    const differences = mismatches.filter((m) => m.tMs >= window.fromMs && m.tMs < window.toMs);
    const first = differences[0];
    const expect = expected?.signals
      .filter((signal) => signal.kind === 'output')
      .map((signal) => {
        const segments = signal.segments.filter(
          (segment) => segment.fromMs < window.toMs && segment.toMs > window.fromMs,
        );
        return `${outputSignalLabel(signal.name)}：${segments.map((segment) => `${JA.replay.seconds(Math.max(segment.fromMs, window.fromMs))} ${segment.value ? JA.replay.on : JA.replay.off}`).join(' → ')}`;
      })
      .join(' ／ ');
    return {
      index: index + 1,
      total: windows.length,
      atMs: window.fromMs,
      toMs: window.toMs,
      action:
        window.operations.length === 0
          ? JA.replay.power
          : window.operations
              .map(
                (op) =>
                  `${PB_LABELS[op.target] ?? op.target}${op.action === 'press' ? JA.replay.press : JA.replay.release}`,
              )
              .join('・'),
      expect: expect || JA.replay.noExpectation,
      mismatched: first !== undefined,
      ...(first === undefined
        ? {}
        : {
            mismatchNote: JA.replay.mismatch(
              differences.length,
              `${JA.replay.seconds(first.tMs)} ${outputSignalLabel(first.signal)} — ${JA.mismatchReason[first.reason]}`,
            ),
          }),
    };
  });
}

/**
 * この時点の提出物を固定する。履歴・採点結果・経過時間は変更しない。
 * `from: 'lab'` は実験の欄の「盤で動きを見る」（2026-10-08）で、最後に「動かす」した結果
 * （`labRun`）の差分を添えて見直し、終えたら練習の画面へ戻る。
 */
export function startReplay(from: 'result' | 'lab' = 'result'): boolean {
  const s = useStore.getState();
  const { problem, session } = s;
  const judge = from === 'lab' ? s.labRun : s.judge;
  if (
    s.replay !== undefined ||
    problem === undefined ||
    session === undefined ||
    judge === undefined ||
    judge.mode !== problem.mode ||
    judge.mode === 'inspect-parts'
  )
    return false;
  let source: ReplaySource;
  if (problem.mode === 'assemble') source = { mode: 'assemble', problem, session };
  else if (problem.mode === 'assemble-lab') source = { mode: 'assemble-lab', problem, session };
  else if (problem.mode === 'inspect-repair' && s.circuit !== undefined)
    source = { mode: 'inspect-repair', problem, circuit: circuitForJudge(s.circuit, session) };
  else if (
    problem.mode === 'plc' &&
    judge.mode === 'plc' &&
    judge.ladderErrors.length === 0 &&
    s.ladder !== undefined
  )
    source = { mode: 'plc', problem, session, ladder: s.ladder };
  else if (
    problem.mode === 'plc-lab' &&
    judge.mode === 'plc-lab' &&
    judge.ladderErrors.length === 0 &&
    s.ladder !== undefined
  )
    source = { mode: 'plc-lab', problem, session, ladder: s.ladder };
  else return false;
  useStore.setState({
    route: 'session',
    replay: {
      openedAtMs: Date.now(),
      source: structuredClone(source),
      steps: replaySteps(
        source.problem.operations,
        source.problem.durationMs,
        judge.mismatches,
        judge.charts.expected,
      ),
      index: 0,
      busy: true,
      before: { snapshot: s.snapshot, plcMonitor: s.plcMonitor },
      returnTo: from === 'lab' ? 'session' : 'result',
    },
  });
  return true;
}

export function stopReplay(): void {
  const replay = useStore.getState().replay;
  if (replay === undefined) return;
  const startedAtMs = useStore.getState().startedAtMs;
  useStore.setState({
    ...replay.before,
    startedAtMs: startedAtMs === 0 ? 0 : startedAtMs + Math.max(0, Date.now() - replay.openedAtMs),
    replay: undefined,
    route: replay.returnTo,
  });
}
