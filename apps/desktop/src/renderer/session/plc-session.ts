import { withBoardProfile, JIPM_BOARD, type BoardDefinition } from '@ojt/board-model';
import {
  isPlcProblem,
  plcBoardFor,
  resolvePlcIo,
  type ResolvedPlcIo,
  type SupportedProblem,
} from '@ojt/content';
import type { LadderProgram } from '@ojt/ladder-core';

/**
 * モードD専用の小さな純関数。設計仕様 §7.6 / §10.1。
 * 「この課題の盤（PLC本体つき）」と「この課題のI/O割付」を、画面のどこからでも同じ形で引けるようにする。
 */

/**
 * 課題が使う盤。モードDは**必ず `withPlcUnit()` 済みの派生盤**を使う（3A 引渡し表）。
 * モードD以外・未対応機種は `undefined`。
 */
export function plcBoardOf(problem: SupportedProblem): BoardDefinition | undefined {
  if (!isPlcProblem(problem)) return undefined;
  return plcBoardFor(problem, withBoardProfile(JIPM_BOARD, problem.board.profile));
}

/**
 * 画面が使う盤。モードDなら派生盤、それ以外は素の `JIPM_BOARD`。
 * 3Dシーン・経路生成・`addWire()` はすべてこの1本から盤を取る（Task 10 / 11）。
 */
export function boardForProblem(problem: SupportedProblem | undefined): BoardDefinition {
  if (problem === undefined) return JIPM_BOARD;
  return plcBoardOf(problem) ?? withBoardProfile(JIPM_BOARD, problem.board.profile);
}

/** 課題のI/O割付（既定割付の穴埋め済み）。モードD以外は `undefined`。§7.6 */
export function plcIoOf(problem: SupportedProblem | undefined): ResolvedPlcIo | undefined {
  if (problem === undefined || !isPlcProblem(problem)) return undefined;
  return resolvePlcIo(problem.io);
}

/** 判定を送れるか（H-1: 変換を通ったラダーだけを判定に出す）。 */
export type JudgeReadiness = { ok: true } | { ok: false; reason: 'no-ladder' | 'not-converted' };

/**
 * 判定ボタンを押せるか。§10.6 / 3A H-1
 *
 * 見るのは**ラダーが変換済みか**だけである。配線の中身（2段結線・PLC電源・割付）は
 * 判定時の静的チェックが見るので、ここでは触らない（決定表#7: セッション中に合否を漏らさない）。
 */
export function canJudgePlc(state: {
  converted: boolean;
  ladder: LadderProgram | undefined;
}): JudgeReadiness {
  if (state.ladder === undefined) return { ok: false, reason: 'no-ladder' };
  if (!state.converted) return { ok: false, reason: 'not-converted' };
  return { ok: true };
}
