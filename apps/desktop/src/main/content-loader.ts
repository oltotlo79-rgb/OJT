import { existsSync } from 'node:fs';
import { BUILTIN_PROBLEMS, type AssembleProblem } from '@ojt/content';
import { loadProblemsFromDir, mergeProblemSets, type ProblemSet } from '@ojt/content/loader';
import { toErrorRow, toSummary, type ProblemListPayload } from '../shared/ipc.js';

/**
 * 課題の供給。設計仕様 §7.8 / §13 #1 / §13 #9。
 * Node の `fs` を使う `loadProblemsFromDir()` は main プロセスでしか動かないため、ここに置く。
 * 内蔵課題と利用者フォルダを `mergeProblemSets()` で合流し、同一IDは利用者側を優先する。
 */

/** 合流済みの課題（IDで引けるようにした一覧）。 */
export interface LoadedContent {
  payload: ProblemListPayload;
  byId: Map<string, AssembleProblem>;
}

/** 内蔵課題を `ProblemSet` の形にする（読込エラーは無い）。 */
export function builtinSet(): ProblemSet {
  return { problems: [...BUILTIN_PROBLEMS], errors: [] };
}

/**
 * 内蔵課題と利用者フォルダを合流する。§7.8
 * フォルダが無いときは読込を試みず、`userDirExists: false` だけを返す（§13 #9）。
 */
export function loadContent(userDir: string): LoadedContent {
  const builtin = builtinSet();
  const builtinIds = new Set(builtin.problems.map((p) => p.id));
  const exists = userDir.length > 0 && existsSync(userDir);
  const user: ProblemSet = exists ? loadProblemsFromDir(userDir) : { problems: [], errors: [] };
  const merged = mergeProblemSets(builtin, user);
  const userIds = new Set(user.problems.map((p) => p.id));
  const byId = new Map(merged.problems.map((p) => [p.id, p] as const));
  return {
    payload: {
      problems: merged.problems.map((p) =>
        toSummary(p, userIds.has(p.id) || !builtinIds.has(p.id) ? 'user' : 'builtin'),
      ),
      errors: merged.errors.map(toErrorRow),
      userDir,
      userDirExists: exists,
    },
    byId,
  };
}
