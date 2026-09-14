import { toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import {
  compareLogs,
  HAZARD_KINDS,
  type ChatterEvent,
  type HazardEvent,
  type HazardKind,
  type Mismatch,
  type SignalLog,
} from '@ojt/circuit-sim';
import { buildReferenceSession, ASSEMBLE_WIRE_COLOR } from './reference.js';
import { runOperations } from './runner.js';
import { resolveCompareSignals } from './schema/judge.js';
import type { AssembleProblem } from './schema/assemble.js';
import type { ProblemIssue } from './schema/index.js';
import { runStaticChecks, type StaticCheckResult } from './static-checks.js';
import { buildTimeChart, defaultChartSignals, timerMarkers, type TimeChart } from './timechart.js';

/**
 * モードBの判定。設計仕様 §7.4 / §8.3。
 * 模範回路と訓練者回路を同じ操作列で同じエンジンにかけ、出力波形を許容差付きで比較したうえで
 * 静的チェックを走らせる。固定の正解波形は持たない（決定事項#8）。
 */

/** 危険操作の種別ごとの回数。§8.3 */
export type HazardCounts = Readonly<Record<HazardKind, number>>;

/**
 * 危険操作の種別ごとの回数を数える。種別の集合は circuit-sim の `HAZARD_KINDS` を唯一の源とするので、
 * エンジン側に種別が増えても結果画面の集計は自動で追随する（§5.6）。
 */
function countHazards(hazards: readonly HazardEvent[]): HazardCounts {
  const out = {} as Record<HazardKind, number>;
  for (const kind of HAZARD_KINDS) {
    out[kind] = hazards.filter((e) => e.kind === kind).length;
  }
  return out;
}

/** 判定オプション。 */
export interface JudgeOptions {
  /** 訓練者の所要時間[ms]（結果画面の参考表示。合否には影響しない。§17.2 #3）。 */
  elapsedMs?: number;
  /** セッション中（判定の再生以外）に記録した危険操作。§5.6 */
  sessionHazards?: readonly HazardEvent[];
}

/** 判定結果。§7.4 / §8.3 */
export interface JudgeResult {
  /** 動作一致かつ有効な静的チェックにエラーが無い。§7.4 */
  passed: boolean;
  /** 許容差を超えた遷移の一覧。§8.3 */
  mismatches: Mismatch[];
  staticChecks: StaticCheckResult[];
  /** セッション中に記録した危険操作の総数（判定の再生ぶんは数えない。§5.6）。 */
  hazardCount: number;
  /** セッション中に記録した危険操作の種別ごとの回数。§8.3 */
  hazardsByKind: HazardCounts;
  /** 検出したチャタリング。§8.3 の禁則回路の警告に使う。 */
  chatter: ChatterEvent[];
  /** 訓練者の所要時間[ms]（渡されたときだけ入る）。 */
  elapsedMs?: number;
  /** 模範波形と訓練者波形。§8.3 の重ね表示に使う。 */
  charts: { expected: TimeChart; actual: TimeChart };
  /** 実際に比較した信号名。§7.4 */
  compareSignals: string[];
}

/** 判定の実行結果（模範回路が作れなければ課題エラー）。§13 #2 */
export type JudgeAssembleResult =
  { ok: true; value: JudgeResult } | { ok: false; errors: ProblemIssue[] };

/** 模範回路のログで見張るべき信号（ランプの点灯・コイルの励磁）。§13 #2 */
function liveSignalsOf(problem: AssembleProblem): string[] {
  const names: string[] = [];
  for (const r of problem.schematic.rungs) {
    for (const cell of r.cells) {
      if (cell.kind === 'lamp') names.push(cell.device);
      else if (cell.kind === 'coil') names.push(`${cell.device}.coil`);
    }
  }
  return [...new Set(names)];
}

/** その信号がログの中で実際に値を変えたか（初回の記録＝初期値だけなら変化なし）。§5.7 */
function hasTransition(log: SignalLog, signal: string): boolean {
  return log.transitions(signal).length > 1;
}

/**
 * 模範回路が構造上は組めても実質的に動かないときの課題エラー。§13 #2
 * `physicalOverride` がコイルの片方の端子を盤の別の場所（母線など）へ逃がすと、
 * `assignToBoard()` の検査（1端子2本・接点組の不足など）はすべて通ってしまうのに、
 * そのコイル本来の端子（例: `CR1.13`）がどこにも配線されず宙に浮き、永久に励磁されない。
 * ランプもコイルもログ上1回も変化しない模範回路は、判定を進める前にここで弾く。
 */
function findDeadReferenceIssue(
  problem: AssembleProblem,
  log: SignalLog,
): ProblemIssue | undefined {
  const live = liveSignalsOf(problem);
  if (live.length === 0 || live.some((signal) => hasTransition(log, signal))) return undefined;
  return {
    path: 'schematic',
    message: '模範回路が動作しません（ランプ・コイルの変化がありません）',
  };
}

/**
 * `judge.compareSignals` に、模範回路のログに存在しない信号が指定されているときの課題エラー。§13 #2
 * 綴り違い（`PL9`）や盤に無い部品（`BZ` を `extraParts` に足し忘れた）を指定すると、エンジンは
 * その信号を1度も記録しないので `compareLogs()` が `unknown-signal` の不一致を返し、
 * **訓練者が不合格になってしまう**。訓練者の回路とは関係の無い課題データの誤りなので、
 * 判定を進める前に課題一覧のエラー（§13 #2）として返す。
 */
function findUnknownCompareSignalIssues(
  compareSignals: readonly string[],
  log: SignalLog,
): ProblemIssue[] {
  const recorded = new Set(log.signals());
  const out: ProblemIssue[] = [];
  compareSignals.forEach((signal, index) => {
    if (recorded.has(signal)) return;
    out.push({
      path: `judge.compareSignals[${index}]`,
      message: `比較信号 ${signal} は模範回路の記録にありません`,
    });
  });
  return out;
}

/**
 * モードBの判定を実行する。§8.3
 * 1. 模範回路を組み立てて操作列を再生する
 * 2. 訓練者の盤セッションをネットリストにして同じ操作列を再生する
 * 3. 出力波形を比較し、静的チェックを走らせ、両方の波形をタイムチャートにする
 *
 * 課題エラー（`ok: false`）として返すのは、**模範回路が作れない**か、**作れても実質動かない**
 * （`physicalOverride` の誤りなどでランプ・コイルが1回も変化しない）か、**比較信号の指定が
 * 模範回路に存在しない**場合だけである（いずれも課題データ側の誤り。§13 #2）。
 * `traineeSession` がこの盤のセッションでないのは呼び出し側の取り違えなので、board-model の
 * `toNetlist()` が `SessionError` を投げる（黙って壊れたネットリストを判定するより早く落とす。§8.2）。
 * UIは課題が要求する盤で作ったセッションを渡すこと。
 */
export function judgeAssemble(
  problem: AssembleProblem,
  board: BoardDefinition,
  traineeSession: BoardSession,
  options: JudgeOptions = {},
): JudgeAssembleResult {
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return reference;

  const expectedRun = runOperations(reference.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  const deadReference = findDeadReferenceIssue(problem, expectedRun.log);
  if (deadReference !== undefined) return { ok: false, errors: [deadReference] };

  const compareSignals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);
  const unknownSignals = findUnknownCompareSignalIssues(compareSignals, expectedRun.log);
  if (unknownSignals.length > 0) return { ok: false, errors: unknownSignals };

  const traineeNetlist = toNetlist(traineeSession, board);
  const actualRun = runOperations(traineeNetlist, problem.operations, {
    durationMs: problem.durationMs,
  });

  const mismatches = compareLogs(
    expectedRun.log,
    actualRun.log,
    compareSignals,
    problem.judge.tolerance,
  );

  /**
   * 結果画面に出す危険操作は**セッション中に記録したものだけ**を数える（§5.6「セッションの
   * カウンタを加算する」/ §8.3）。判定はいま提出された盤をもう一度通電し直すので、短絡したまま
   * 提出された盤では同じ1回の短絡が `short-circuit-power-on` としてセッションと再生の両方に出る。
   * 両方を足すと結果画面の回数が訓練者の実際の操作回数より多くなってしまう。
   * 静的チェック（`powerSequence`）には再生ぶんも合わせて渡す（合否の根拠は従来どおり）。
   */
  const sessionHazards = options.sessionHazards ?? [];
  const checkedHazards = [...sessionHazards, ...actualRun.events.hazards()];
  const chatter = actualRun.events.chatters();
  const staticChecks = runStaticChecks(
    {
      session: traineeSession,
      netlist: traineeNetlist,
      log: actualRun.log,
      hazards: checkedHazards,
      chatters: chatter,
      allowedColors: [ASSEMBLE_WIRE_COLOR],
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
      passed: mismatches.length === 0 && staticChecks.every((c) => c.ok),
      mismatches,
      staticChecks,
      hazardCount: sessionHazards.length,
      hazardsByKind: countHazards(sessionHazards),
      chatter: [...chatter],
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
      charts,
      compareSignals,
    },
  };
}

/**
 * 課題の模範回路を、その課題自身の操作列で判定にかける（自己整合テスト）。§7.8 / §14.1 #30
 * 内蔵課題はこれが全件合格することをCIで保証する。
 */
export function judgeReference(
  problem: AssembleProblem,
  board: BoardDefinition,
): JudgeAssembleResult {
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return reference;
  return judgeAssemble(problem, board, reference.value.session);
}
