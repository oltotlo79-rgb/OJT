import { BUILTIN_PROBLEMS, type AssembleProblem } from '@ojt/content';
import { toSummary, type ProblemListPayload } from '../shared/ipc.js';

/**
 * 課題の供給。設計仕様 §7.8。
 * Plan 1D1 では内蔵課題だけを返す（利用者フォルダの合流は Plan 1D2 で足す）。
 * Node の `fs` を使う `loadProblemsFromDir()` は main プロセスでしか動かないため、この層に置く。
 */

/** 課題一覧の中身（IDで引けるようにした一覧つき）。 */
export interface LoadedContent {
  payload: ProblemListPayload;
  byId: Map<string, AssembleProblem>;
}

/** 内蔵課題だけを課題一覧の形にする。§7.9 */
export function loadContent(userDir: string): LoadedContent {
  const problems = [...BUILTIN_PROBLEMS];
  return {
    payload: {
      problems: problems.map((p) => toSummary(p, 'builtin')),
      errors: [],
      userDir,
      userDirExists: false,
    },
    byId: new Map(problems.map((p) => [p.id, p] as const)),
  };
}
