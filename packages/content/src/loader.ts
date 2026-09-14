import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AssembleProblem } from './schema/assemble.js';
import { parseProblem, type ProblemFailureReason, type ProblemIssue } from './schema/index.js';

/**
 * 課題フォルダの読込。設計仕様 §7.8 / §13 #1 / §13 #9。
 * 1ファイルの失敗で他の課題の読込を止めない。失敗は理由付きで `errors` に積み、
 * 課題一覧がそのまま表示できる形にする。
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
  problems: AssembleProblem[];
  errors: ProblemLoadError[];
}

/** 拡張子が `.json` のファイルか。 */
function isJsonFile(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

/**
 * フォルダ直下と1階層下（`<mode>/<id>.json`。§7.8）の `.json` を名前順に集める。
 * 名前順に固定するので読込順は決定論的になる。
 */
function collectJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      for (const child of readdirSync(full).sort()) {
        if (isJsonFile(child)) out.push(join(full, child));
      }
    } else if (isJsonFile(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 1ファイルを読んで検証する。 */
function loadOne(file: string, problems: AssembleProblem[], errors: ProblemLoadError[]): void {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    errors.push({
      file,
      reason: 'read-error',
      message: `ファイルを読めませんでした: ${String(cause)}`,
      issues: [],
    });
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    errors.push({
      file,
      reason: 'invalid-json',
      message: `JSONとして読めませんでした: ${String(cause)}`,
      issues: [],
    });
    return;
  }
  const parsed = parseProblem(json);
  if (!parsed.ok) {
    errors.push({
      file,
      reason: parsed.reason,
      message: parsed.message,
      issues: parsed.issues,
      ...(parsed.id === undefined ? {} : { id: parsed.id }),
    });
    return;
  }
  if (problems.some((p) => p.id === parsed.problem.id)) {
    errors.push({
      file,
      reason: 'duplicate-id',
      message: `課題IDが重複しています: ${parsed.problem.id}`,
      issues: [],
      id: parsed.problem.id,
    });
    return;
  }
  problems.push(parsed.problem);
}

/**
 * フォルダから課題を読み込む。§7.8
 * フォルダが無い場合は空の結果と `read-error` を1件返す（内蔵課題だけで動作を続ける。§13 #9）。
 */
export function loadProblemsFromDir(dir: string): ProblemSet {
  const problems: AssembleProblem[] = [];
  const errors: ProblemLoadError[] = [];
  let files: string[];
  try {
    files = collectJsonFiles(dir);
  } catch (cause) {
    return {
      problems,
      errors: [
        {
          file: dir,
          reason: 'read-error',
          message: `課題フォルダを読めませんでした: ${String(cause)}`,
          issues: [],
        },
      ],
    };
  }
  for (const file of files) loadOne(file, problems, errors);
  return { problems, errors };
}

/**
 * 内蔵課題と利用者課題を統合する。同一IDは**利用者側を優先**する。§7.8
 * 並びは「内蔵の並び（利用者側で置き換わったものは置換）＋ 利用者側の新規課題」。
 */
export function mergeProblemSets(builtin: ProblemSet, user: ProblemSet): ProblemSet {
  const userById = new Map(user.problems.map((p) => [p.id, p] as const));
  const taken = new Set<string>();
  const problems: AssembleProblem[] = [];
  for (const problem of builtin.problems) {
    const override = userById.get(problem.id);
    problems.push(override ?? problem);
    taken.add(problem.id);
  }
  for (const problem of user.problems) {
    if (taken.has(problem.id)) continue;
    problems.push(problem);
  }
  return { problems, errors: [...builtin.errors, ...user.errors] };
}
