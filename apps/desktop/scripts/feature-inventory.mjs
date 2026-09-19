import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 画面の操作要素を数え上げる。取扱説明書 設計 §6.3 / 決定表#22。
 *
 * `src/renderer/**\/*.tsx` に書かれた目印（`data-testid` と、`SidePanel` などが取る
 * `testId` プロパティ）を全部拾って並べる。`docs/manual/coverage.json` はこの集合と
 * **完全に一致**していなければならない（`test/feature-inventory.test.ts`）。
 *
 * 単独で走らせると JSON を標準出力に出すので、機能一覧表を作り直すときに使える:
 *   node scripts/feature-inventory.mjs
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');

/** 走査するフォルダ。 */
export const RENDERER_DIR = join(APP_ROOT, 'src', 'renderer');

/**
 * 差し込み（`${…}`）を `{}` に畳む。
 * `open-${problem.id}` は課題の数だけ実体があるが、説明書から見れば1つの機能なので
 * `open-{}` という1行にまとめる。
 */
function foldTemplate(raw) {
  return raw.replace(/\$\{[^}]*\}/gu, '{}');
}

/** 文字で直に書いた目印（`data-testid="judge-button"`）。 */
const PATTERNS = [/data-testid="([^"]+)"/gu, /\btestId="([^"]+)"/gu];

/** 式で書いた目印の始まり（`data-testid={…}` / `testId={…}`）。 */
const EXPRESSION_STARTS = [/data-testid=\{/gu, /\btestId=\{/gu];

/**
 * `{` から対応する `}` までを切り出す。
 * 差し込み（`${…}`）の波括弧も数に入るが左右で釣り合うので、数えるだけで正しく閉じる。
 */
function expressionAt(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return source.slice(openIndex + 1);
}

/**
 * 1ファイル分の目印。
 *
 * 式で書いた目印は、式の中にある**すべての**テンプレート文字列を拾う。
 * `data-testid={first ? `toolbar-${a}` : `toolbar-${a}-${b}`}`（`LadderWorkspace.tsx` の
 * メーカー別ツールバー）のように1つの式が2通りの名前を作ることがあり、単純な
 * `data-testid={`…`}` だけを見ていると、画面に出ているボタンを丸ごと見落とす。
 */
export function testIdsIn(source) {
  const found = new Set();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const raw = match[1];
      if (raw !== undefined) found.add(foldTemplate(raw));
      match = pattern.exec(source);
    }
  }
  for (const start of EXPRESSION_STARTS) {
    start.lastIndex = 0;
    let match = start.exec(source);
    while (match !== null) {
      const expression = expressionAt(source, match.index + match[0].length - 1);
      const templates = /`([^`]+)`/gu;
      let inner = templates.exec(expression);
      while (inner !== null) {
        const raw = inner[1];
        if (raw !== undefined) found.add(foldTemplate(raw));
        inner = templates.exec(expression);
      }
      match = start.exec(source);
    }
  }
  return found;
}

/** フォルダの `.tsx` を名前順に並べる。 */
function tsxFiles(dir) {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path));
    else if (entry.name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** 画面ぜんぶの目印（重複を除いて並べ替えたもの）。 */
export function collectTestIds(dir = RENDERER_DIR) {
  const found = new Set();
  for (const file of tsxFiles(dir)) {
    for (const id of testIdsIn(readFileSync(file, 'utf8'))) found.add(id);
  }
  return [...found].sort();
}

// `globalThis.` を付けるのは、素のJS向け lint 設定に Node のグローバルが入っていないため
const entry = globalThis.process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  globalThis.process.stdout.write(`${JSON.stringify(collectTestIds(), null, 2)}\n`);
}
