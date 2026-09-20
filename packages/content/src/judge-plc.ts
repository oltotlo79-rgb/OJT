import { toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import { compareLogs, type ChatterEvent, type Mismatch } from '@ojt/circuit-sim';
import {
  compile,
  deviceLabel,
  type CompiledProgram,
  type CompileError,
  type CompileWarning,
  type LadderProgram,
} from '@ojt/ladder-core';
import {
  countHazards,
  findUnknownCompareSignalIssues,
  type HazardCounts,
  type JudgeOptions,
} from './judge.js';
import { runPlcOperations } from './plc-io.js';
import { buildPlcReferenceSession, PLC_WIRE_COLOR } from './plc-reference.js';
import type { ProblemIssue } from './schema/index.js';
import { resolveCompareSignals } from './schema/judge.js';
import type { PlcProblem } from './schema/plc.js';
import type { StaticCheckResult } from './static-check-types.js';
import { runStaticChecks } from './static-checks.js';
import {
  buildTimeChart,
  defaultChartSignals,
  formatSeconds,
  type TimeChart,
  type TimeChartMarker,
} from './timechart.js';

/**
 * モードDの判定。設計仕様 §10.8 / §7.4。
 * 模範（模範ラダー＋割付から生成した模範配線）と訓練者（自分のラダー＋自分の配線）を、
 * 同じ操作列で並走させて出力波形を比べる（決定事項#8）。方言は見ない（決定表#7）。
 */

/** モードDの判定結果。 */
export interface JudgePlcResult {
  mode: 'plc';
  passed: boolean;
  mismatches: Mismatch[];
  staticChecks: StaticCheckResult[];
  hazardCount: number;
  hazardsByKind: HazardCounts;
  chatter: ChatterEvent[];
  elapsedMs?: number;
  charts: { expected: TimeChart; actual: TimeChart };
  compareSignals: string[];
  /** 訓練者のラダーの変換エラー（あればシミュレートせず不合格）。§10.6 */
  ladderErrors: CompileError[];
  /** 二重コイルなどの変換警告。§10.4 */
  ladderWarnings: CompileWarning[];
}

/** 判定の実行結果（模範回路が作れなければ課題エラー）。§13 #2 */
export type JudgePlcOutcome =
  { ok: true; value: JudgePlcResult } | { ok: false; errors: ProblemIssue[] };

/**
 * ラダーのタイマ設定値からタイムチャートの印を作る。§7.7
 * `deviceLabel()`（`T0` 等の表示名）と `formatSeconds()`（`timechart.ts`。「3秒」の整形）を
 * `timerMarkers()` と共有する。同じタイマデバイスが複数ネットワークの出力に現れても
 * （§10.4 の二重コイル。実行は後勝ちだが印は1個でよい）印は重複させない。
 */
export function plcTimerMarkers(compiled: CompiledProgram): TimeChartMarker[] {
  const markers: TimeChartMarker[] = [];
  const seen = new Set<string>();
  for (const net of compiled.networks) {
    for (const output of net.outputs) {
      if (output.cell.kind !== 'timer') continue;
      const key = deviceLabel(output.cell.device);
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({
        tMs: output.cell.presetMs,
        label: `${key}=${formatSeconds(output.cell.presetMs)}`,
      });
    }
  }
  return markers;
}

/** モードDの判定を実行する。§10.8 */
export function judgePlc(
  problem: PlcProblem,
  board: BoardDefinition,
  traineeSession: BoardSession,
  traineeLadder: LadderProgram,
  options: JudgeOptions = {},
): JudgePlcOutcome {
  const reference = buildPlcReferenceSession(problem, board);
  if (!reference.ok) return reference;
  const { board: plcBoard, unit, io, program: referenceProgram } = reference.value;
  const outputCount = unit.spec.outputs.length;

  const expectedRun = runPlcOperations(
    reference.value.netlist,
    referenceProgram,
    problem.operations,
    { durationMs: problem.durationMs, outputCount },
  );
  const compareSignals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);
  const unknown = findUnknownCompareSignalIssues(compareSignals, expectedRun.log);
  if (unknown.length > 0) return { ok: false, errors: unknown };

  const compiled = compile(traineeLadder);
  const ladderWarnings = compiled.warnings;
  const traineeNetlist = toNetlist(traineeSession, plcBoard);
  const sessionHazards = options.sessionHazards ?? [];
  const chartSignals = defaultChartSignals(compareSignals);
  const markers = plcTimerMarkers(referenceProgram);
  const expectedChart = buildTimeChart(expectedRun.log, chartSignals, problem.durationMs, markers);

  if (!compiled.ok) {
    // 変換に落ちたラダーは実機にも書き込めない。シミュレートせず不合格にする（§10.6）。
    return {
      ok: true,
      value: {
        mode: 'plc',
        passed: false,
        mismatches: [],
        staticChecks: [],
        hazardCount: sessionHazards.length,
        hazardsByKind: countHazards(sessionHazards),
        chatter: [],
        ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
        // 実測波形は無い（走らせていない）ので空のチャートを返す
        charts: {
          expected: expectedChart,
          actual: { durationMs: problem.durationMs, signals: [], markers: [] },
        },
        compareSignals,
        ladderErrors: compiled.errors,
        ladderWarnings,
      },
    };
  }

  const actualRun = runPlcOperations(traineeNetlist, compiled.program, problem.operations, {
    durationMs: problem.durationMs,
    outputCount,
  });
  const mismatches = compareLogs(
    expectedRun.log,
    actualRun.log,
    compareSignals,
    problem.judge.tolerance,
  );
  const chatter = actualRun.events.chatters();
  const staticChecks = runStaticChecks(
    {
      session: traineeSession,
      netlist: traineeNetlist,
      log: actualRun.log,
      hazards: [...sessionHazards, ...actualRun.events.hazards()],
      chatters: chatter,
      allowedColors: [PLC_WIRE_COLOR],
      plc: { unit, io },
    },
    problem.judge.staticChecks,
  );

  return {
    ok: true,
    value: {
      mode: 'plc',
      passed: mismatches.length === 0 && staticChecks.every((c) => c.ok),
      mismatches,
      staticChecks,
      hazardCount: sessionHazards.length,
      hazardsByKind: countHazards(sessionHazards),
      chatter: [...chatter],
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
      charts: {
        expected: expectedChart,
        actual: buildTimeChart(actualRun.log, chartSignals, problem.durationMs, markers),
      },
      compareSignals,
      ladderErrors: [],
      ladderWarnings,
    },
  };
}

/**
 * 課題の模範ラダー＋模範配線を、その課題自身の操作列で判定にかける（自己整合テスト）。§7.8 / §14.1 #30
 * 内蔵課題はこれが全件合格することをCIで保証する。
 */
export function judgePlcReference(problem: PlcProblem, board: BoardDefinition): JudgePlcOutcome {
  const reference = buildPlcReferenceSession(problem, board);
  if (!reference.ok) return reference;
  return judgePlc(problem, board, reference.value.session, problem.referenceLadder);
}
