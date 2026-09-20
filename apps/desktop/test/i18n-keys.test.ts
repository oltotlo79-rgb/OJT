import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';

/**
 * UI-15 の再発防止。`JA` の全葉キー（`main` は `src/shared/messages.ts` の `MSG` を
 * 再輸出したもの。§15）が `src` / `test` / `e2e` のどこかから参照されていることを検査する。
 *
 * 参照の探し方は文字列一致（`JA.foo.bar` の並び、または動的添字アクセス先なら `JA.foo.bar[`）。
 * `main` 配下だけは main プロセス側が `MSG.foo` の形で直接読む（§15 冒頭のコメントのとおり
 * main は `ja.ts` を読み込めない）ので、`MSG.foo` の形も同じキーの参照として数える。
 *
 * `JA.hazard[hazard.kind]` のように**添字アクセスで読む部分木**は、`HazardKind` 等の
 * `satisfies Record<...>` で網羅性を型検査済みなので、その部分木ごと検査から外す
 * （個々の葉を「未参照」と誤検出しないため）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'test', 'e2e'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIR_NAMES = new Set(['node_modules', 'out', 'release', 'dist', 'coverage']);

function collectFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    const dot = name.lastIndexOf('.');
    if (dot >= 0 && SCAN_EXTENSIONS.has(name.slice(dot))) out.push(full);
  }
}

function loadCorpus(): string {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) collectFiles(join(APP_ROOT, dir), files);
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** そのキーを指す文字列表現（`main` 配下だけ `MSG.` 別名も足す）。 */
function referenceStrings(fullPath: string): string[] {
  const refs = [`JA.${fullPath}`];
  if (fullPath === 'main' || fullPath.startsWith('main.')) {
    const sub = fullPath === 'main' ? '' : fullPath.slice('main.'.length);
    refs.push(sub === '' ? 'MSG' : `MSG.${sub}`);
  }
  return refs;
}

function isDynamicallyIndexed(corpus: string, fullPath: string): boolean {
  return referenceStrings(fullPath).some((ref) =>
    new RegExp(`${escapeRegExp(ref)}\\[`, 'u').test(corpus),
  );
}

function isReferenced(corpus: string, fullPath: string): boolean {
  return referenceStrings(fullPath).some((ref) =>
    new RegExp(`${escapeRegExp(ref)}\\b`, 'u').test(corpus),
  );
}

/** `JA` を再帰的に歩き、参照が見つからない葉キーのパスを集める。 */
function unreferencedLeaves(value: unknown, fullPath: string, corpus: string, out: string[]): void {
  const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (isPlainObject) {
    if (isDynamicallyIndexed(corpus, fullPath)) return; // 添字アクセスの部分木は型検査済みとして除外
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      unreferencedLeaves(child, `${fullPath}.${key}`, corpus, out);
    }
    return;
  }
  if (!isReferenced(corpus, fullPath)) out.push(fullPath);
}

describe('i18n キーの未参照検査', () => {
  it('JA の全葉キーが src / test / e2e のどこかから参照されている（UI-15 再発防止）', () => {
    const corpus = loadCorpus();
    const unused: string[] = [];
    for (const [key, value] of Object.entries(JA)) {
      unreferencedLeaves(value, key, corpus, unused);
    }
    expect(unused, `未参照キー ${String(unused.length)} 件: ${unused.join(', ')}`).toEqual([]);
  });
});
