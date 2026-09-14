import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AssembleProblem } from './schema/assemble.js';
import { parseProblem } from './schema/index.js';
import type { ProblemLoadError, ProblemSet } from './problem-set.js';

/**
 * 課題フォルダの読込。設計仕様 §7.8 / §13 #1 / §13 #9。
 * 1ファイルの失敗で他の課題の読込を止めない。失敗は理由付きで `errors` に積み、
 * 課題一覧がそのまま表示できる形にする。
 *
 * `ProblemLoadError` / `ProblemSet` は fs に触れない型なので `./problem-set.ts` に定義されている。
 * `@ojt/content/loader` の利用者（main プロセス）が型と実装を一箇所から取れるよう、ここで
 * 再エクスポートする（Task 1D1-b。`@ojt/content` のルートバレルは `./index.ts` も参照）。
 */
export type { ProblemLoadError, ProblemSet };

/** 拡張子が `.json` のファイルか。 */
function isJsonFile(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

/** そのパスがフォルダか（読めずに判定できないときは undefined）。 */
function directoryCheck(full: string): boolean | undefined {
  try {
    return statSync(full).isDirectory();
  } catch {
    return undefined;
  }
}

/**
 * フォルダ直下と1階層下（`<mode>/<id>.json`。§7.8）の `.json` を名前順に集める。
 * 名前順に固定するので読込順は決定論的になる。
 *
 * どちらの階層でもフォルダは除く。`x.json` という名前のフォルダを課題ファイルと取り違えると
 * 読込時に意味の分からない失敗になるためで、1階層下のフォルダにはこれ以上降りない（§7.8）。
 * 1つのフォルダが読めなくても、そのフォルダだけを `read-error` にして残りは読み進める（§13 #9）。
 */
function collectJsonFiles(dir: string, errors: ProblemLoadError[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const isDirectory = directoryCheck(full);
    if (isDirectory === undefined) continue;
    if (isDirectory) {
      let children: string[];
      try {
        children = readdirSync(full).sort();
      } catch (cause) {
        errors.push({
          file: full,
          reason: 'read-error',
          message: `課題フォルダを読めませんでした: ${String(cause)}`,
          issues: [],
        });
        continue;
      }
      for (const child of children) {
        const childPath = join(full, child);
        if (isJsonFile(child) && directoryCheck(childPath) === false) out.push(childPath);
      }
    } else if (isJsonFile(name)) {
      out.push(full);
    }
  }
  return out;
}

/** UTF-8 の BOM。`JSON.parse()` は受け付けないので読んだ直後に落とす。§7.8 */
const BOM = '\uFEFF';

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
  // メモ帳などが付ける BOM は落とす。残したままだと `JSON.parse()` が構文エラーにする
  if (text.startsWith(BOM)) text = text.slice(BOM.length);
  // UTF-8 として解釈できないバイトは U+FFFD になる。Shift_JIS の課題ファイルを文字化けしたまま
  // 読み込むと課題文も部品名も壊れるので、読めた気にならずここで止める（§13 #1）
  if (text.includes('\uFFFD')) {
    errors.push({
      file,
      reason: 'read-error',
      message: `文字コードは UTF-8（BOMなし）で保存してください: ${file}`,
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
    files = collectJsonFiles(dir, errors);
  } catch (cause) {
    return {
      problems,
      errors: [
        ...errors,
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
