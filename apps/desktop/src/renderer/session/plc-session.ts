import { JIPM_BOARD, type BoardDefinition } from '@ojt/board-model';
import {
  isPlcProblem,
  plcBoardFor,
  resolvePlcIo,
  type ResolvedPlcIo,
  type SupportedProblem,
} from '@ojt/content';

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
  return plcBoardFor(problem, JIPM_BOARD);
}

/**
 * 画面が使う盤。モードDなら派生盤、それ以外は素の `JIPM_BOARD`。
 * 3Dシーン・経路生成・`addWire()` はすべてこの1本から盤を取る（Task 10 / 11）。
 */
export function boardForProblem(problem: SupportedProblem | undefined): BoardDefinition {
  if (problem === undefined) return JIPM_BOARD;
  return plcBoardOf(problem) ?? JIPM_BOARD;
}

/** 課題のI/O割付（既定割付の穴埋め済み）。モードD以外は `undefined`。§7.6 */
export function plcIoOf(problem: SupportedProblem | undefined): ResolvedPlcIo | undefined {
  if (problem === undefined || !isPlcProblem(problem)) return undefined;
  return resolvePlcIo(problem.io);
}
