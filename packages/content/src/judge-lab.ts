import {
  createSession,
  toNetlist,
  type BoardDefinition,
  type BoardSession,
} from '@ojt/board-model';
import { compareLogs, type Mismatch, type SignalLog } from '@ojt/circuit-sim';
import { compile, type LadderProgram } from '@ojt/ladder-core';
import { hazardSummary, type JudgeOptions, type JudgeResult } from './judge.js';
import { plcTimerMarkers, type JudgePlcResult } from './judge-plc.js';
import { labChartSignals, labExpectedChart, labExpectedLog } from './lab-chart.js';
import { runPlcOperations } from './plc-io.js';
import { buildPlcWiredBoard, plcBoardFor, PLC_WIRE_COLOR } from './plc-reference.js';
import { ASSEMBLE_WIRE_COLOR } from './reference.js';
import { runOperations } from './runner.js';
import { toSocketRoles } from './schema/common.js';
import type { ProblemIssue } from './schema/index.js';
import {
  LAB_OUTPUTS,
  type AssembleLabProblem,
  type LabProblem,
  type PlcLabProblem,
} from './schema/lab.js';
import { resolvePlcIo } from './schema/plc.js';
import { runStaticChecks } from './static-checks.js';
import type { StaticCheckResult } from './static-check-types.js';
import { buildTimeChart, timerMarkers, type TimeChart, type TimeChartMarker } from './timechart.js';

/**
 * 「回路実験」「PLC実験」の判定（2026-10-08）。設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §5
 *
 * 他のモードと違い、正解の源は模範回路ではなく**描いたタイムチャート**である。
 * 1. 訓練者の盤（PLC実験はラダーとPLCも）を、描いた操作で `durationMs` まで動かす
 * 2. 実際のチャートを作る（押ボタン4行＋ランプ4行。タイマの目盛付き）
 * 3. 正解があれば、正解の区間から作った信号ログと `compareLogs()` で比べる
 * 4. 静的チェック
 * 5. 合格 = 正解がある ∧ 不一致0件 ∧ 有効な静的チェックがすべて合格。正解が無ければ動かすだけ
 * 6. PLC実験でラダーが変換できないときは、ラダーの指摘を返して動かさない
 */

/** 実験の判定に共通の項目。 */
interface LabJudgeFields {
  /** 正解を描いてあり、合否を出したか（正解が無いときは動かした結果だけ）。 */
  judged: boolean;
  /** 正解（描いてあるときだけ）と実際のタイムチャート。 */
  charts: { expected?: TimeChart; actual: TimeChart };
}

/** 回路実験の判定結果。 */
export type AssembleLabJudgeResult = Omit<JudgeResult, 'mode' | 'charts'> &
  LabJudgeFields & { mode: 'assemble-lab' };

/** PLC実験の判定結果。 */
export type PlcLabJudgeResult = Omit<JudgePlcResult, 'mode' | 'charts'> &
  LabJudgeFields & { mode: 'plc-lab' };

/** 実験の判定結果。 */
export type LabJudgeResult = AssembleLabJudgeResult | PlcLabJudgeResult;

/** 実験の判定の実行結果（盤が課題と合わないときは課題エラー）。 */
export type LabJudgeOutcome<T extends LabJudgeResult = LabJudgeResult> =
  { ok: true; value: T } | { ok: false; errors: ProblemIssue[] };

/** 判定に使うランプ（指定が無ければ PL1〜PL4 すべて）。 */
export function labCompareSignals(problem: LabProblem): string[] {
  return [...(problem.judge.compareSignals ?? LAB_OUTPUTS)];
}

function boardMismatch(problem: LabProblem, board: BoardDefinition): ProblemIssue[] {
  if (problem.board.boardId === board.id) return [];
  return [
    {
      path: 'board.boardId',
      message: `課題が要求する盤（${problem.board.boardId}）と渡された盤（${board.id}）が違います`,
    },
  ];
}

/** 正解のチャートと、実際のログとの違い（正解が無ければどちらも無し）。 */
function compareWithChart(
  problem: LabProblem,
  actualLog: SignalLog | undefined,
  markers: readonly TimeChartMarker[],
): { expected?: TimeChart; mismatches: Mismatch[] } {
  if (problem.expected === undefined) return { mismatches: [] };
  return {
    expected: labExpectedChart(problem, markers),
    mismatches:
      actualLog === undefined
        ? []
        : compareLogs(
            labExpectedLog(problem),
            actualLog,
            labCompareSignals(problem),
            problem.judge.tolerance,
          ),
  };
}

function passedOf(
  judged: boolean,
  mismatches: readonly Mismatch[],
  staticChecks: readonly StaticCheckResult[],
): boolean {
  return judged && mismatches.length === 0 && staticChecks.every((check) => check.ok);
}

/** 回路実験の判定（正解が無ければ動かすだけ）。 */
export function judgeAssembleLab(
  problem: AssembleLabProblem,
  board: BoardDefinition,
  session: BoardSession,
  options: JudgeOptions = {},
): LabJudgeOutcome<AssembleLabJudgeResult> {
  const errors = boardMismatch(problem, board);
  if (errors.length > 0) return { ok: false, errors };

  const netlist = toNetlist(session, board);
  const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
  const markers = timerMarkers(netlist);
  const { expected, mismatches } = compareWithChart(problem, run.log, markers);
  const chatter = run.events.chatters();
  const staticChecks = runStaticChecks(
    {
      session,
      netlist,
      log: run.log,
      hazards: [...(options.sessionHazards ?? []), ...run.events.hazards()],
      chatters: chatter,
      allowedColors: [ASSEMBLE_WIRE_COLOR],
    },
    problem.judge.staticChecks,
  );
  const judged = problem.expected !== undefined;
  return {
    ok: true,
    value: {
      mode: 'assemble-lab',
      judged,
      passed: passedOf(judged, mismatches, staticChecks),
      mismatches,
      staticChecks,
      ...hazardSummary(options),
      chatter: [...chatter],
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
      charts: {
        ...(expected === undefined ? {} : { expected }),
        actual: buildTimeChart(run.log, labChartSignals(), problem.durationMs, markers),
      },
      compareSignals: labCompareSignals(problem),
    },
  };
}

/** PLC実験の判定（正解が無ければ動かすだけ。ラダーが変換できなければ動かさない）。 */
export function judgePlcLab(
  problem: PlcLabProblem,
  board: BoardDefinition,
  session: BoardSession,
  ladder: LadderProgram,
  options: JudgeOptions = {},
): LabJudgeOutcome<PlcLabJudgeResult> {
  const errors = boardMismatch(problem, board);
  if (errors.length > 0) return { ok: false, errors };
  const plcBoard = plcBoardFor(problem, board);
  const unit = plcBoard?.plcUnit;
  if (plcBoard === undefined || unit === undefined) {
    return {
      ok: false,
      errors: [{ path: 'plc.model', message: `対応していないPLC機種です: ${problem.plc.model}` }],
    };
  }

  const judged = problem.expected !== undefined;
  const compiled = compile(ladder);
  if (!compiled.ok) {
    // 変換に落ちたラダーは実機にも書き込めない。動かさず不合格にする（§10.6 と同じ）
    const { expected } = compareWithChart(problem, undefined, []);
    return {
      ok: true,
      value: {
        mode: 'plc-lab',
        judged,
        passed: false,
        mismatches: [],
        staticChecks: [],
        ...hazardSummary(options),
        chatter: [],
        ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
        charts: {
          ...(expected === undefined ? {} : { expected }),
          actual: { durationMs: problem.durationMs, signals: [], markers: [] },
        },
        compareSignals: labCompareSignals(problem),
        ladderErrors: compiled.errors,
        ladderWarnings: compiled.warnings,
      },
    };
  }

  const netlist = toNetlist(session, plcBoard);
  const run = runPlcOperations(netlist, compiled.program, problem.operations, {
    durationMs: problem.durationMs,
    outputCount: unit.spec.outputs.length,
  });
  const markers = plcTimerMarkers(compiled.program);
  const { expected, mismatches } = compareWithChart(problem, run.log, markers);
  const chatter = run.events.chatters();
  const staticChecks = runStaticChecks(
    {
      session,
      netlist,
      log: run.log,
      hazards: [...(options.sessionHazards ?? []), ...run.events.hazards()],
      chatters: chatter,
      allowedColors: [PLC_WIRE_COLOR],
      plc: { unit, io: resolvePlcIo(problem.io) },
    },
    problem.judge.staticChecks,
  );
  return {
    ok: true,
    value: {
      mode: 'plc-lab',
      judged,
      passed: passedOf(judged, mismatches, staticChecks),
      mismatches,
      staticChecks,
      ...hazardSummary(options),
      chatter: [...chatter],
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
      charts: {
        ...(expected === undefined ? {} : { expected }),
        actual: buildTimeChart(run.log, labChartSignals(), problem.durationMs, markers),
      },
      compareSignals: labCompareSignals(problem),
      ladderErrors: [],
      ladderWarnings: compiled.warnings,
    },
  };
}

/**
 * PLC実験の配線済みの盤。リレーを CR1〜CR4 に装着し、割付どおりの電線（模範配線と同じ §10.2）を
 * すべて固定電線（`locked`。外せない）にする。ラダー作りに集中するための盤（利用者の決定 D3）。
 */
export function buildPrewiredPlcSession(
  problem: PlcLabProblem,
  board: BoardDefinition,
): { ok: true; value: BoardSession } | { ok: false; errors: ProblemIssue[] } {
  const wired = buildPlcWiredBoard(problem, board);
  if (!wired.ok) return wired;
  for (const wire of wired.value.session.wires) wire.locked = true;
  return { ok: true, value: wired.value.session };
}

/**
 * 実験を始めるときの盤。PLC実験の配線済みは `buildPrewiredPlcSession`、それ以外は何も付いていない盤
 * （PLC実験はPLC本体を載せた盤）。実験の課題はアプリが作るので、作れないのは呼び出し側の誤り（投げる）。
 */
export function labSessionFor(problem: LabProblem, board: BoardDefinition): BoardSession {
  if (problem.mode === 'plc-lab' && problem.prewired) {
    const prewired = buildPrewiredPlcSession(problem, board);
    if (!prewired.ok) throw new Error(prewired.errors.map((error) => error.message).join(' / '));
    return prewired.value;
  }
  const sessionBoard = problem.mode === 'plc-lab' ? plcBoardFor(problem, board) : board;
  if (sessionBoard === undefined) throw new Error(`対応していないPLC機種です`);
  return createSession(sessionBoard, {
    includeCheckWires: false,
    roles: toSocketRoles(problem.board.socketRoles),
    allowedColors: [problem.mode === 'plc-lab' ? PLC_WIRE_COLOR : ASSEMBLE_WIRE_COLOR],
    inventory: problem.inventory,
  });
}
