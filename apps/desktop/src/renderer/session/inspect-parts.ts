import { JIPM_BOARD, type BoardSession, type MountableKind } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  checkContactTerminals,
  checkSettleMs,
  truthFault,
  type FaultSpecData,
  type InspectPartAnswer,
  type InspectPartsProblem,
  type PartTruth,
  type ProblemIssue,
} from '@ojt/content';

/**
 * モードC1（部品点検）の純粋な下ごしらえ。設計仕様 §9.1。
 * React も three も使わないので Vitest だけで検証できる（§14.2）。
 *
 * 盤の組み立て（チェック用ソケットへ挿す・故障を決める）は Plan 2A の
 * `buildCheckCircuit()` / `truthFault()` が唯一の実装であり、ここはその結果を
 * Worker の `load` コマンドの形に詰め替えるだけである。
 */

/** チェック用回路を Worker に読ませるための材料。 */
export type CheckLoadResult =
  | {
      ok: true;
      /** チェック用ソケットに部品を1個挿した盤。 */
      session: BoardSession;
      /** ネットリスト変換のたびに注入する部品の故障（正常品なら空）。§5.4 */
      partFaults: FaultSpecData[];
      /** 接点の不良を入れた組（1〜4）。**画面には出さない**（Plan 2A 差分 #14）。 */
      group: number;
      /** 励磁が安定するまでの目安[ms]（リレー100 / タイマ1100）。§9.1 手順① */
      settleMs: number;
    }
  | { ok: false; errors: ProblemIssue[] };

/**
 * トレイの部品1個をチェック用ソケットに挿した回路を作る。§9.1
 * `buildCheckCircuit()` は故障注入済みのネットリストも返すが、Worker は自分で
 * `toNetlist()` するので、ここでは**盤と故障の指定**だけを渡す（同じ故障が二重に入らない）。
 */
export function checkLoadFor(problem: InspectPartsProblem, partId: string): CheckLoadResult {
  const built = buildCheckCircuit(problem, JIPM_BOARD, partId);
  if (!built.ok) return built;
  const part = problem.parts.find((p) => p.id === partId);
  if (part === undefined) {
    return { ok: false, errors: [{ path: 'parts', message: `部品が見つかりません: ${partId}` }] };
  }
  const fault = truthFault(problem, part);
  return {
    ok: true,
    session: built.value.session,
    partFaults: fault === undefined ? [] : [fault],
    group: built.value.group,
    settleMs: checkSettleMs(part.kind),
  };
}

/** マークシートの1行（**本当の状態は入れない**。答えが漏れる）。§9.1 回答 */
export interface MarkSheetRow {
  partId: string;
  kind: MountableKind;
  answer: PartTruth | undefined;
}

/** マークシートの行を作る。並びは課題の `parts` の順。§9.1 */
export function markSheetRows(
  problem: InspectPartsProblem,
  answers: readonly InspectPartAnswer[],
): MarkSheetRow[] {
  const byId = new Map(answers.map((a) => [a.partId, a.answer] as const));
  return problem.parts.map((part) => ({
    partId: part.id,
    kind: part.kind,
    answer: byId.get(part.id),
  }));
}

/** 解答済みの部品の数（課題に無い部品IDは数えない）。§9.1 */
export function answeredCount(
  problem: InspectPartsProblem,
  answers: readonly InspectPartAnswer[],
): number {
  const ids = new Set(problem.parts.map((p) => p.id));
  const answered = new Set<string>();
  for (const answer of answers) {
    if (ids.has(answer.partId)) answered.add(answer.partId);
  }
  return answered.size;
}

/** プローブの置き場所のショートカット1件。 */
export interface ProbeTarget {
  /** `coil` / `a1`〜`a4` / `b1`〜`b4`。 */
  id: string;
  black: TerminalId;
  red: TerminalId;
}

/**
 * §9.1 が測る端子の組（コイル＋4組ぶんの a接点・b接点）。
 *
 * **4組すべてを出す。** 不良を入れた組（`CheckLoadResult.group`）だけを出すと、
 * どの組が怪しいかが画面から漏れて点検にならない（Plan 2A 意図的な差分 #14）。
 * 訓練者は3D盤の端子を直接クリックしてもよく、これは「毎回8本の端子を探さずに済む」
 * ための補助にすぎない。
 */
export function probeTargets(): ProbeTarget[] {
  const out: ProbeTarget[] = [{ id: 'coil', black: CHECK_COIL_MINUS, red: CHECK_COIL_PLUS }];
  for (let group = 1; group <= 4; group += 1) {
    const pins = checkContactTerminals(group);
    out.push({ id: `a${String(group)}`, black: pins.com, red: pins.no });
    out.push({ id: `b${String(group)}`, black: pins.com, red: pins.nc });
  }
  return out;
}
