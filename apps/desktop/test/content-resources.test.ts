import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { describe, expect, it } from 'vitest';

/**
 * 同梱課題JSONの二重管理を防ぐ検査（§7.8 / 1D2-a のレビュー指摘）。
 *
 * 配布版は `resources/content/assemble/*.json` を読んで同梱課題を組み立てる。
 * 正本は `packages/content/src/builtin/assemble/` の1箇所だけで、`scripts/copy-content.mjs`
 * （`predist` と `dist` の先頭）が複写する。ここが食い違ったまま配布されないよう、
 * **パースした中身が完全に一致すること**を検査する（改行・整形の違いは問題にしない）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = join(APP_ROOT, 'resources', 'content', 'assemble');
const SOURCE = resolve(APP_ROOT, '../../packages/content/src/builtin/assemble');

function jsonFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function parsed(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

/**
 * `it.each` の対象は `packages/content/src/builtin/index.ts` が実際に import している
 * ファイル名の固定リスト（正本のうち「配線済み」のものだけ）。`readdirSync(SOURCE)` を直接
 * 使うと、他の作業でこのディレクトリにファイルを追加してから `index.ts` に import 文を
 * 足すまでの一瞬だけテスト件数が変わってしまう（収集時点のディスク状態に依存するため）。
 * 一覧を静的にしておけば、そうした一時的な状態でもテスト件数は変わらない。
 * ここを増やすときは `index.ts` の import と `MODES` 複写結果に合わせて追記すること。
 */
const WIRED_ASSEMBLE_FILES = [
  'b-001-self-hold.json',
  'b-002-interlock.json',
  'b-003-on-delay.json',
  'b-004-sequential.json',
  'b-005-one-shot.json',
  'b-006-flicker.json',
  'b-007-first-press.json',
  'b-008-stop-priority.json',
] as const;

describe('resources/content/assemble の複写（§7.8）', () => {
  it('正本と同じファイルが揃っている', () => {
    expect(jsonFilesIn(SHIPPED)).toEqual(jsonFilesIn(SOURCE));
  });

  it('内蔵課題の数（8題）と一致する（§7.9）', () => {
    expect(jsonFilesIn(SHIPPED)).toHaveLength(BUILTIN_PROBLEMS.length);
  });

  it.each(WIRED_ASSEMBLE_FILES)('%s の中身が正本と一致する', (file) => {
    expect(parsed(SHIPPED, file)).toEqual(parsed(SOURCE, file));
  });

  it('複写した課題のIDが内蔵課題と揃っている', () => {
    const ids = jsonFilesIn(SHIPPED)
      .map((file) => (parsed(SHIPPED, file) as { id: string }).id)
      .sort();
    expect(ids).toEqual(BUILTIN_PROBLEMS.map((p) => p.id).sort());
  });
});
