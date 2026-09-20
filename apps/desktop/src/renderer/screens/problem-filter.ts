import type { Difficulty, ProblemTag } from '@ojt/content';
import type { ProblemSummary } from '../../shared/ipc.js';
import type { ListMode } from '../app/store.js';

/**
 * 課題一覧の絞り込み。指摘 UX-18 / UX-19 / PR-09（Phase 7 Task 25）。
 *
 * 課題が72題に増えたので、モードと級の2段だけでは目的の課題に辿り着けない。
 * 言葉で探す・難しさで絞る・学習テーマで絞るの3つを足し、
 * **どれも純関数**にして画面から切り離す（§14.2。並べ替えと既定値の決め方も含めて検査できる）。
 */

/** 級の絞り込み（`undefined` は「すべて」）。 */
export type GradeFilter = 1 | 2 | 3 | undefined;

/** 絞り込みの条件（どれも `undefined` は「すべて」）。 */
export interface ProblemFilter {
  readonly mode: ListMode;
  readonly grade: GradeFilter;
  readonly difficulty: Difficulty | undefined;
  readonly tag: ProblemTag | undefined;
  /** 課題名・課題文・IDから探す言葉（前後の空白は無視する）。 */
  readonly search: string;
}

/**
 * 課題文の先頭1文（一覧の薄字の説明）。指摘 UX-19。
 * 句点で切り、長すぎるときは丸めて「…」を付ける（行の高さを揃えるため）。
 */
export function firstSentence(description: string, limit = 42): string {
  const trimmed = description.trim();
  const stop = trimmed.indexOf('。');
  const head = stop >= 0 ? trimmed.slice(0, stop + 1) : trimmed;
  return head.length > limit ? `${head.slice(0, limit)}…` : head;
}

/** 探す言葉が1件に当たるか（課題名・課題文・IDのどれかに含まれていればよい）。 */
export function matchesSearch(problem: ProblemSummary, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  return [problem.title, problem.description, problem.id].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/** 絞り込みを1件に当てる。 */
export function matchesFilter(problem: ProblemSummary, filter: ProblemFilter): boolean {
  if (filter.mode !== undefined && problem.mode !== filter.mode) return false;
  if (filter.grade !== undefined && problem.grade !== filter.grade) return false;
  if (filter.difficulty !== undefined && problem.difficulty !== filter.difficulty) return false;
  if (filter.tag !== undefined && !problem.tags.includes(filter.tag)) return false;
  return matchesSearch(problem, filter.search);
}

/**
 * 絞り込んだ行。並びは**やさしい順**（級は3級→1級、同じ級なら難しさの小さい順、
 * 同じならIDの順）にする。72題を上から順に進めればそのまま学習の順になる（指摘 UX-19）。
 */
export function filterProblems(
  problems: readonly ProblemSummary[],
  filter: ProblemFilter,
): readonly ProblemSummary[] {
  return problems
    .filter((problem) => matchesFilter(problem, filter))
    .sort(
      (a, b) =>
        b.grade - a.grade ||
        a.difficulty - b.difficulty ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/**
 * 初めて開いたときの級の既定（指摘 UX-19）。
 *
 * 説明書は「3級がいちばんやさしい」と書いているのに、一覧の既定は「すべて」で、
 * いきなり1級のPLC課題に入ってしまえた。**そのモードに3級の課題があれば3級**を既定にする。
 * 回路点検・修復とPLCには3級形式の課題が無いので、そのときだけ「すべて」に落とす
 * （既定で0件の一覧を見せない）。
 */
export function defaultGrade(problems: readonly ProblemSummary[], mode: ListMode): GradeFilter {
  const inMode = problems.filter((problem) => mode === undefined || problem.mode === mode);
  return inMode.some((problem) => problem.grade === 3) ? 3 : undefined;
}

/** その一覧に出てくる学習テーマ（絞り込みの選択肢。出現順）。 */
export function tagsInUse(problems: readonly ProblemSummary[]): readonly ProblemTag[] {
  const seen = new Set<ProblemTag>();
  for (const problem of problems) for (const tag of problem.tags) seen.add(tag);
  return [...seen];
}
