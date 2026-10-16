import { withBoardProfile, JIPM_BOARD, type BoardDefinition } from '@ojt/board-model';
import {
  isPlcLabProblem,
  plcBoardFor,
  resolvePlcIo,
  usesPlc,
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
  if (!usesPlc(problem)) return undefined;
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
  if (problem === undefined || !usesPlc(problem)) return undefined;
  return resolvePlcIo(problem.io);
}

/**
 * PLCの入力を強制（診断用）してよいか。割付が自由な課題と、PLC実験（自由に試す場）で許す。
 * Worker の `load` に `allowPlcForcing` として渡す（画面・作業ファイルの復元で同じ値にする）。
 */
export function allowPlcForcingFor(problem: SupportedProblem): boolean {
  return usesPlc(problem) && (isPlcLabProblem(problem) || problem.io.mode === 'free');
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

/**
 * PLC に書き込んだプログラムとエディタのラダーの関係（v2.1.0 監査 P1）。
 * - `none`: PLC にプログラムが無い
 * - `written`: エディタのラダーを書き込んだまま（変更していない）
 * - `stale`: 書き込んだあとでエディタを変更した（書込みが必要）
 */
export type PlcProgramState = 'none' | 'written' | 'stale';

/** PLC のプログラムの状態。エディタのラダーが書き込んだときの物と同じかで見る。 */
export function plcProgramState(state: {
  plcProgram: LadderProgram | undefined;
  plcProgramSource: LadderProgram | undefined;
  ladder: LadderProgram | undefined;
}): PlcProgramState {
  if (state.plcProgram === undefined) return 'none';
  return state.plcProgramSource === state.ladder ? 'written' : 'stale';
}

/**
 * 判定ボタンを押したときにすること（v2.1.0 監査 P1）。判定は PLC に書き込んだプログラムで行う。
 * - `judge`: そのまま判定する（書き込んだまま変更していない）
 * - `confirm`: 確かめの窓を出す。`canWrite` は「書き込んでから判定」を出せるか（変換済みか）、
 *   `canJudgeAsIs` は「このまま判定」を出せるか（PLC にプログラムがあるか）
 * - `blocked`: 押せない（プログラムが無く、書き込める変換済みのラダーも無い）
 */
export type PlcJudgePlan =
  | { kind: 'judge'; program: LadderProgram }
  | { kind: 'confirm'; canWrite: boolean; canJudgeAsIs: boolean }
  | { kind: 'blocked'; reason: 'no-ladder' | 'not-converted' };

/** 判定ボタンを押したときの段取りを決める。 */
export function plcJudgePlan(state: {
  plcProgram: LadderProgram | undefined;
  plcProgramSource: LadderProgram | undefined;
  ladder: LadderProgram | undefined;
  converted: boolean;
}): PlcJudgePlan {
  const programState = plcProgramState(state);
  if (programState === 'written' && state.plcProgram !== undefined) {
    return { kind: 'judge', program: state.plcProgram };
  }
  const canWrite = state.ladder !== undefined && state.converted;
  if (programState === 'none' && !canWrite) {
    return {
      kind: 'blocked',
      reason: state.ladder === undefined ? 'no-ladder' : 'not-converted',
    };
  }
  return { kind: 'confirm', canWrite, canJudgeAsIs: programState === 'stale' };
}
