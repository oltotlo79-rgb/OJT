import type { ProblemFailureReason, ProblemIssue, SupportedProblem } from './schema/index.js';

/**
 * 課題フォルダの読込結果の型。設計仕様 §7.8 / §13 #1。
 * `node:fs` を使う実際の読込（`loadProblemsFromDir()` / `mergeProblemSets()`）は
 * `./loader.ts` にあるが、型だけはここに置く。fs に触れないので `@ojt/content` の
 * ルートバレル（`./index.ts`）と `./loader.ts` の両方から再エクスポートでき、
 * renderer（ブラウザ相当）が `ProblemLoadError` 等の型だけを IPC の型付けに使うときに
 * `node:fs` を引き込まずに済む（Task 1D1-b）。
 */

/** 読込に失敗した1件。§13 #1 */
export interface ProblemLoadError {
  /** 失敗したファイルのパス（フォルダごと読めない場合はフォルダのパス）。 */
  file: string;
  reason: ProblemFailureReason | 'read-error' | 'duplicate-id';
  message: string;
  issues: ProblemIssue[];
  /** 読めた範囲のID。 */
  id?: string;
}

/** 読込結果。§7.8 */
export interface ProblemSet {
  /** 開始できるモードの課題（モードB／C1／C2）。 */
  problems: SupportedProblem[];
  errors: ProblemLoadError[];
}
