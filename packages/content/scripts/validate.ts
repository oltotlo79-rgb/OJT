import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { validateDefinition } from '../src/definition-validation.js';
/**
 * 作った課題ファイルを確かめる道具。設計仕様 §16 Phase 7 §4.3（PR-15 の代替）。
 *
 *   pnpm --filter @ojt/content validate <ファイルまたはフォルダ> [...]
 *
 * やることは3段:
 *   1. 形式の検査（`parseProblem()`。項目の過不足・型・値の範囲）
 *   2. モード別の自己整合検査（模範回路を課題自身の操作列にかけて合格するか）
 *   3. タイムチャートの始まりと終わりが論理0か（`startsAndEndsLow()`。§7.3）
 *
 * 出力は課題1件につき1行の日本語。終了コードは**落ちた課題の件数**なので、
 * そのまま他の道具の合否に繋げられる。
 *
 * 判定の規則はどれもアプリ本体と同じ関数（`judgeReference()` / `judgePlcReference()` /
 * `expectedCheckReading()` / `timerRangeFor()`）を呼ぶ。この道具の中に規則を書き写さないので、
 * 本体の規則が変わればこの道具の答えも自動で追随する。
 */

/** 課題1件の検査結果。 */
interface Checked {
  /** 表示に使うファイル名（起動したフォルダからの相対）。 */
  file: string;
  /** 読めたときの課題ID。 */
  id: string | undefined;
  /** 見出しに添える一言（級・難しさ・テーマ、タイマのレンジなど）。 */
  note: string;
  /** 落ちた理由（空なら合格）。 */
  reasons: string[];
}

/** 1行に並べる理由の上限（多すぎると読めないので残りは件数だけ出す）。 */
const MAX_REASONS_PER_LINE = 5;

/** 引数のパスから課題ファイル（`.json`）を集める。フォルダは下の階層まで見る。 */
function collectFiles(target: string): string[] {
  const stat = statSync(target);
  if (!stat.isDirectory()) return [target];
  const out: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(target, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(path));
    else if (entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}

/** 級・難しさ・学習テーマの一言。 */
function checkFile(file: string, root: string): Checked {
  const shown = relative(root, file) || file;
  const result: Checked = { file: shown, id: undefined, note: '', reasons: [] };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    result.reasons.push(
      `ファイルを読めません（かっこや点の打ち間違いがあります）: ${(error as Error).message}`,
    );
    return result;
  }
  return { file: shown, ...validateDefinition(json) };
}

/** 1件ぶんの出力行を組み立てる。 */
function lineOf(checked: Checked): string {
  const name = `${checked.file}${checked.id === undefined ? '' : `（${checked.id}）`}`;
  if (checked.reasons.length === 0) {
    return `合格  ${name}  ${checked.note}`.trimEnd();
  }
  const shown = checked.reasons.slice(0, MAX_REASONS_PER_LINE).join(' / ');
  const rest = checked.reasons.length - MAX_REASONS_PER_LINE;
  return `問題  ${name}  ${shown}${rest > 0 ? ` / ほか${rest}件` : ''}`;
}

/** 引数を受け取って検査し、出力行と落ちた件数を返す。 */
function run(targets: readonly string[], root: string): { lines: string[]; failed: number } {
  if (targets.length === 0) {
    return {
      lines: ['使い方: pnpm --filter @ojt/content validate <課題ファイルまたはフォルダ>'],
      failed: 1,
    };
  }
  const lines: string[] = [];
  let failed = 0;
  for (const target of targets) {
    let files: string[];
    try {
      files = collectFiles(target);
    } catch {
      lines.push(`問題  ${target}  そのファイルやフォルダはありません`);
      failed += 1;
      continue;
    }
    if (files.length === 0) lines.push(`（${target} に課題ファイルはありません）`);
    for (const file of files) {
      const checked = checkFile(file, root);
      if (checked.reasons.length > 0) failed += 1;
      lines.push(lineOf(checked));
    }
  }
  lines.push(failed === 0 ? '0 件の問題' : `${failed} 件の問題`);
  return { lines, failed };
}

const outcome = run(process.argv.slice(2), process.cwd());
process.stdout.write(`${outcome.lines.join('\n')}\n`);
process.exitCode = outcome.failed === 0 ? 0 : Math.min(outcome.failed, 125);
