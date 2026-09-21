import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupportedProblem } from './schema/index.js';
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
 *
 * `node:fs/promises` を使う（Phase 7 Task 9 / レビュー DM-1 ≡ CT-06）: 同期の `readdirSync` /
 * `readFileSync` / `statSync` は Electron の main プロセスで呼ぶと、そのファイルI/Oが終わるまで
 * イベントループが止まる。利用者課題フォルダに数千〜数万件の `.json` を置かれても main が
 * 固まらないよう、1ファイルごとに非同期で読む。
 */
export type { ProblemLoadError, ProblemSet };

/**
 * 1ファイルの最大バイト数（読む前に断る）。§13 #9 / レビュー DM-1 ≡ CT-06
 * 巨大な課題JSONをそのまま `JSON.parse()` すると main を長時間止める。
 */
export const MAX_PROBLEM_BYTES = 2 * 1024 * 1024;

/**
 * 1回の `loadProblemsFromDir()` で処理する `.json` ファイル数の上限。§13 #9 / レビュー DM-1 ≡ CT-06
 * 上限に達したら以降のファイルは集めるのを打ち切り、打ち切った旨を `errors` に1件積む
 * （1ファイルの失敗で他を止めない、という方針と同じく、集めた分はそのまま読み込む）。
 */
export const MAX_PROBLEM_FILES = 2000;

/** 拡張子が `.json` のファイルか。 */
function isJsonFile(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

/** そのパスがフォルダか（読めずに判定できないときは undefined）。 */
async function directoryCheck(full: string): Promise<boolean | undefined> {
  try {
    const info = await stat(full);
    return info.isDirectory();
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
 *
 * `MAX_PROBLEM_FILES` 件に達したら以降は集めず、打ち切った旨を `errors` に積む（DM-1 ≡ CT-06）。
 */
async function collectJsonFiles(
  dir: string,
  errors: ProblemLoadError[],
  maxFiles: number,
): Promise<string[]> {
  const out: string[] = [];
  let truncated = false;
  const add = (file: string): boolean => {
    if (out.length === maxFiles) {
      truncated = true;
      return false;
    }
    out.push(file);
    return true;
  };
  const names = (await readdir(dir)).sort();
  for (const name of names) {
    const full = join(dir, name);
    const isDirectory = await directoryCheck(full);
    if (isDirectory === undefined) continue;
    if (isDirectory) {
      let children: string[];
      try {
        children = (await readdir(full)).sort();
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
        if (isJsonFile(child) && (await directoryCheck(childPath)) === false && !add(childPath))
          break;
      }
      if (truncated) break;
    } else if (isJsonFile(name) && !add(full)) {
      break;
    }
  }
  if (truncated) {
    errors.push({
      file: dir,
      reason: 'read-error',
      message: `課題ファイルが多すぎるため ${String(maxFiles)} 件で打ち切りました。残りは別のフォルダに移して開いてください`,
      issues: [],
    });
  }
  return out;
}

/** UTF-8 の BOM。`JSON.parse()` は受け付けないので読んだ直後に落とす。§7.8 */
const BOM = '﻿';

/**
 * 1ファイルを読んで検証する。
 * `seenIds` は同じフォルダ内で既に読めた課題IDの集合（CT-11: `problems.some(...)` の
 * O(n²) 探索を `Set` に変える）。
 */
async function loadOne(
  file: string,
  problems: SupportedProblem[],
  errors: ProblemLoadError[],
  seenIds: Set<string>,
): Promise<void> {
  // 大きすぎるファイルは読む前に断る（DM-1 ≡ CT-06）。中身がJSONとして妥当かは確かめない
  try {
    const info = await stat(file);
    if (info.size > MAX_PROBLEM_BYTES) {
      errors.push({
        file,
        reason: 'read-error',
        message: `課題ファイルが大きすぎます（上限 ${String(MAX_PROBLEM_BYTES)} バイト）: ${file}`,
        issues: [],
      });
      return;
    }
  } catch (cause) {
    errors.push({
      file,
      reason: 'read-error',
      message: `ファイルを読めませんでした: ${String(cause)}`,
      issues: [],
    });
    return;
  }
  let text: string;
  try {
    text = await readFile(file, 'utf8');
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
  if (text.includes('�')) {
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
  if (seenIds.has(parsed.problem.id)) {
    errors.push({
      file,
      reason: 'duplicate-id',
      message: `課題IDが重複しています: ${parsed.problem.id}`,
      issues: [],
      id: parsed.problem.id,
    });
    return;
  }
  seenIds.add(parsed.problem.id);
  problems.push(parsed.problem);
}

/**
 * フォルダから課題を読み込む。§7.8
 * フォルダが無い場合は空の結果と `read-error` を1件返す（内蔵課題だけで動作を続ける。§13 #9）。
 */
export async function loadProblemsFromDir(
  dir: string,
  options: { maxFiles?: number } = {},
): Promise<ProblemSet> {
  const maxFiles = options.maxFiles ?? MAX_PROBLEM_FILES;
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_PROBLEM_FILES) {
    throw new RangeError(`maxFiles must be between 1 and ${String(MAX_PROBLEM_FILES)}`);
  }
  const problems: SupportedProblem[] = [];
  const errors: ProblemLoadError[] = [];
  const seenIds = new Set<string>();
  let files: string[];
  try {
    files = await collectJsonFiles(dir, errors, maxFiles);
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
  for (const file of files) await loadOne(file, problems, errors, seenIds);
  return { problems, errors };
}

/**
 * 内蔵課題と利用者課題を統合する。同一IDは**利用者側を優先**する。§7.8
 * 並びは「内蔵の並び（利用者側で置き換わったものは置換）＋ 利用者側の新規課題」。
 */
export function mergeProblemSets(builtin: ProblemSet, user: ProblemSet): ProblemSet {
  const userById = new Map(user.problems.map((p) => [p.id, p] as const));
  const taken = new Set<string>();
  const problems: SupportedProblem[] = [];
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
