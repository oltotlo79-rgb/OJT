import type { BoardDefinition } from '@ojt/board-model';
import { compareLogs, type ChatterEvent, type Mismatch } from '@ojt/circuit-sim';
import { matchesSite, type FaultReport, type FaultSite } from './faults.js';
import {
  modificationWireIds,
  addedWireIds,
  repairNetlist,
  REPAIR_WIRE_COLOR,
  type RepairCircuit,
} from './inspect-repair.js';
import {
  countHazards,
  findDeadReferenceIssue,
  findUnknownCompareSignalIssues,
  liveSignalsOf,
  type HazardCounts,
  type JudgeOptions,
} from './judge.js';
import { buildReferenceSession } from './reference.js';
import { runOperations } from './runner.js';
import { resolveCompareSignals } from './schema/judge.js';
import type { InspectPartsProblem, PartTruth } from './schema/inspect-parts.js';
import type { InspectRepairProblem } from './schema/inspect-repair.js';
import type { ProblemIssue } from './schema/index.js';
import { runStaticChecks, type StaticCheckResult } from './static-checks.js';
import { buildTimeChart, defaultChartSignals, timerMarkers, type TimeChart } from './timechart.js';

/**
 * モードC1／C2の判定。設計仕様 §9.1 / §9.2。
 * C1はマークシートの解答だけを採点する（測定そのものは採点しない。§9.1 判定）。
 * C2は「指摘の正誤 → 修復後の動作比較 → 白線ルールと改造 → 危険操作 → 所要時間」を1回で出す。
 * 危険操作回数と所要時間は記録するだけで合否に影響しない（§7.4 / §17.2 #3）。
 */

/** マークシートの解答1件。§9.1 */
export interface InspectPartAnswer {
  partId: string;
  answer: PartTruth;
}

/** マークシートの採点1行。 */
export interface InspectPartScore {
  partId: string;
  /** その部品の本当の状態。 */
  truth: PartTruth;
  /** 訓練者の解答（未回答は undefined）。 */
  answer: PartTruth | undefined;
  correct: boolean;
}

/** モードC1の判定結果。§9.1 */
export interface JudgeInspectPartsResult {
  mode: 'inspect-parts';
  /** 全部品の解答一致で合格。 */
  passed: boolean;
  correctCount: number;
  total: number;
  scores: InspectPartScore[];
  hazardCount: number;
  hazardsByKind: HazardCounts;
  elapsedMs?: number;
}

/** 指摘の採点。§9.2 判定① */
export interface InspectReportScore {
  /** 言い当てた故障と、それを指した指摘。 */
  matched: { site: FaultSite; report: FaultReport }[];
  /** 見逃した故障。 */
  missed: FaultSite[];
  /** 過剰な指摘。 */
  extra: FaultReport[];
}

/** モードC2の判定結果。§9.2 */
export interface JudgeInspectRepairResult {
  mode: 'inspect-repair';
  /** 指摘が過不足なく、修復後の動作が一致し、白線ルール違反も改造も無い。§9.2 合格条件 */
  passed: boolean;
  reports: InspectReportScore;
  /** 許容差を超えた遷移の一覧（修復後の動作比較）。§9.2 判定② */
  mismatches: Mismatch[];
  staticChecks: StaticCheckResult[];
  /** 故障箇所でない青線を削除した電線のID（改造）。§9.2 判定③ */
  modifications: string[];
  /** 訓練者が引いた電線のID。 */
  addedWires: string[];
  /** セッション中に記録した危険操作の総数（判定の再生ぶんは数えない。§5.6）。 */
  hazardCount: number;
  /** セッション中に記録した危険操作の種別ごとの回数。§8.3 */
  hazardsByKind: HazardCounts;
  chatter: ChatterEvent[];
  elapsedMs?: number;
  charts: { expected: TimeChart; actual: TimeChart };
  compareSignals: string[];
}

/** 結果画面が受け取る点検系の判定結果（`mode` で判別する）。 */
export type JudgeInspectResult = JudgeInspectPartsResult | JudgeInspectRepairResult;

/** C2判定の実行結果（模範回路が作れない・故障の指定が不正なら課題エラー）。§13 #2 */
export type JudgeInspectRepairOutcome =
  { ok: true; value: JudgeInspectRepairResult } | { ok: false; errors: ProblemIssue[] };

/**
 * マークシートを採点する。§9.1
 * 未回答は不正解として数え、`n/m 正解` の表示は `correctCount` / `total` から作る。
 * 危険操作はセッション中に記録したものだけを数える（C1の判定は何も再生しない。§5.6）。
 * `answers` は `partId` で `Map` にまとめるため、同じ部品に複数の回答があれば
 * **最後の回答を採用する**（先の回答は上書きされて消える）。
 */
export function judgeInspectParts(
  problem: InspectPartsProblem,
  answers: readonly InspectPartAnswer[],
  options: JudgeOptions = {},
): JudgeInspectPartsResult {
  const byId = new Map(answers.map((a) => [a.partId, a.answer] as const));
  const scores: InspectPartScore[] = problem.parts.map((part) => {
    const answer = byId.get(part.id);
    return { partId: part.id, truth: part.truth, answer, correct: answer === part.truth };
  });
  const correctCount = scores.filter((s) => s.correct).length;
  const sessionHazards = options.sessionHazards ?? [];
  return {
    mode: 'inspect-parts',
    passed: correctCount === scores.length,
    correctCount,
    total: scores.length,
    scores,
    hazardCount: sessionHazards.length,
    hazardsByKind: countHazards(sessionHazards),
    ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
  };
}

/**
 * 指摘と故障を突き合わせる。§9.2 判定①
 * 1つの指摘は1つの故障にしか使わない（同じ指摘を2回出しても2件は当たらない）。
 * 故障の並び順に、まだ使っていない指摘の先頭から当てていく（決定論）。
 */
export function scoreReports(
  sites: readonly FaultSite[],
  reports: readonly FaultReport[],
): InspectReportScore {
  const matched: { site: FaultSite; report: FaultReport }[] = [];
  const missed: FaultSite[] = [];
  const used = new Set<number>();
  for (const site of sites) {
    const index = reports.findIndex((report, i) => !used.has(i) && matchesSite(site, report));
    const report = index < 0 ? undefined : reports[index];
    if (report === undefined) {
      missed.push(site);
      continue;
    }
    used.add(index);
    matched.push({ site, report });
  }
  const extra = reports.filter((_, i) => !used.has(i));
  return { matched, missed, extra };
}

/**
 * モードC2を判定する。§9.2
 * 1. 模範回路（＝課題の回路図）を操作列で再生する
 * 2. 訓練者の盤（修復後）からネットリストを作り、残っている部品の故障を注入して同じ操作列を再生する
 * 3. 指摘の正誤・波形の一致・静的チェック・改造・危険操作・所要時間をまとめる
 *
 * 線色の検査は「初期状態にあった電線」を除外して行う（残っている青線は訓練者の責任ではなく、
 * 新しく引いた電線だけが白でなければならない。§8.1 / §9.2）。
 */
export function judgeInspectRepair(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  circuit: RepairCircuit,
  reports: readonly FaultReport[],
  options: JudgeOptions = {},
): JudgeInspectRepairOutcome {
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return reference;
  const expectedRun = runOperations(reference.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  /**
   * 模範回路が実質的に動かない・比較信号の指定が模範回路に無い、を判定を進める前に課題エラーで
   * 弾く（CT-02）。`judge.ts`（モードB）と同じ共通ヘルパ。以前はC2だけこの検査が無く、
   * 課題データの誤りで訓練者が不合格になり得た。
   */
  const deadReference = findDeadReferenceIssue(liveSignalsOf(problem.schematic), expectedRun.log);
  if (deadReference !== undefined) return { ok: false, errors: [deadReference] };

  const compareSignals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);
  const unknownSignals = findUnknownCompareSignalIssues(compareSignals, expectedRun.log);
  if (unknownSignals.length > 0) return { ok: false, errors: unknownSignals };

  const built = repairNetlist(circuit, board);
  if (built.errors.length > 0) return { ok: false, errors: built.errors };
  const actualRun = runOperations(built.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });

  const mismatches = compareLogs(
    expectedRun.log,
    actualRun.log,
    compareSignals,
    problem.judge.tolerance,
  );
  const scored = scoreReports(circuit.applied.sites, reports);
  const modifications = modificationWireIds(circuit, circuit.session);
  /**
   * 新しく引いた電線が白か（§8.1 / §9.2 合格条件③）。`problem.judge.staticChecks.wireColorRule`
   * を無効にした課題JSONでも white-wire ルールだけは外れないよう、ここで直接検査する（I-2）。
   */
  const colourViolations = circuit.session.wires.filter(
    (w) => !w.locked && !circuit.initialWireIds.includes(w.id) && w.color !== REPAIR_WIRE_COLOR,
  );
  /**
   * 結果画面に出す危険操作は**セッション中に記録したものだけ**を数える（§5.6 / §8.3）。
   * 判定は提出された盤をもう一度通電し直すので、短絡したまま提出された盤では同じ1回の短絡が
   * セッションと再生の両方に出てしまい、足すと訓練者の実際の操作回数より多くなる。
   * 静的チェック（`powerSequence`）には再生ぶんも合わせて渡す（`judge.ts` と同じ扱い）。
   */
  const sessionHazards = options.sessionHazards ?? [];
  const checkedHazards = [...sessionHazards, ...actualRun.events.hazards()];
  const chatter = actualRun.events.chatters();
  const staticChecks = runStaticChecks(
    {
      session: circuit.session,
      netlist: built.netlist,
      log: actualRun.log,
      hazards: checkedHazards,
      chatters: chatter,
      allowedColors: [REPAIR_WIRE_COLOR],
      preexistingWireIds: new Set(circuit.initialWireIds),
    },
    problem.judge.staticChecks,
  );

  const chartSignals = defaultChartSignals(compareSignals);
  const markers = timerMarkers(reference.value.netlist);
  const charts = {
    expected: buildTimeChart(expectedRun.log, chartSignals, problem.durationMs, markers),
    actual: buildTimeChart(actualRun.log, chartSignals, problem.durationMs, markers),
  };

  return {
    ok: true,
    value: {
      mode: 'inspect-repair',
      passed:
        scored.missed.length === 0 &&
        scored.extra.length === 0 &&
        mismatches.length === 0 &&
        modifications.length === 0 &&
        colourViolations.length === 0 &&
        staticChecks.every((c) => c.ok),
      reports: scored,
      mismatches,
      staticChecks,
      modifications,
      addedWires: addedWireIds(circuit, circuit.session),
      hazardCount: sessionHazards.length,
      hazardsByKind: countHazards(sessionHazards),
      chatter: [...chatter],
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
      charts,
      compareSignals,
    },
  };
}
