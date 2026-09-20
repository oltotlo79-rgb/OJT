import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_ALL_PROBLEMS, BUILTIN_PROBLEMS } from '@ojt/content';
import { describe, expect, it } from 'vitest';

/**
 * 同梱課題JSONの二重管理を防ぐ検査（§7.8 / 1D2-a のレビュー指摘 / Phase 2 acceptance BLOCKER）。
 *
 * 配布版は `resources/content/<mode>/*.json` を読んで同梱課題を組み立てる。
 * 正本は `packages/content/src/builtin/<mode>/` の3フォルダ（assemble / inspect-parts /
 * inspect-repair）で、`scripts/copy-content.mjs`（`dist` の先頭）が複写する。
 * 以前は `MODES` が `['assemble']` に固定されており、C1/C2（12題）が配布物から欠落したまま
 * `builtinSet()` が「1題でも読めれば成功」とみなすため、無警告で8題しか一覧に出なかった。
 * ここが食い違ったまま配布されないよう、**モード別フォルダすべて**を検査し、
 * **パースした中身が完全に一致すること**を検査する（改行・整形の違いは問題にしない）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED_ROOT = join(APP_ROOT, 'resources', 'content');
const SOURCE_ROOT = resolve(APP_ROOT, '../../packages/content/src/builtin');

/** 正本に存在するモード別フォルダ（Phase 3 で `plc` 等が増えても自動的に拾う）。 */
const BUILTIN_MODES = readdirSync(SOURCE_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

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
const WIRED_FILES: Readonly<Record<string, readonly string[]>> = {
  assemble: [
    'b-001-self-hold.json',
    'b-002-interlock.json',
    'b-003-on-delay.json',
    'b-004-sequential.json',
    'b-005-one-shot.json',
    'b-006-flicker.json',
    'b-007-first-press.json',
    'b-008-stop-priority.json',
    'b-009-momentary.json',
    'b-010-and-lamp.json',
    'b-011-or-lamp.json',
    'b-012-self-hold-stop.json',
    'b-013-two-hand.json',
    'b-014-off-delay.json',
    'b-015-mutual-interlock.json',
    'b-016-three-step.json',
    'b-017-last-press.json',
    'b-018-flicker-alarm.json',
    'b-019-conditional-hold.json',
    'b-020-two-timer.json',
  ],
  'inspect-parts': [
    'c1-001-relay-basic.json',
    'c1-002-layer-short.json',
    'c1-003-timer.json',
    'c1-004-mixed.json',
    'c1-005-a-open.json',
    'c1-006-weld-open.json',
    'c1-007-coil-fault.json',
    'c1-008-timer-contact.json',
    'c1-009-mostly-normal.json',
    'c1-010-b-weld-mixed.json',
    'c1-011-relay-timer-mixed.json',
    'c1-012-all-truths.json',
  ],
  'inspect-repair': [
    'c2-001-self-hold.json',
    'c2-002-self-hold-contact.json',
    'c2-003-on-delay.json',
    'c2-004-one-shot.json',
    'c2-005-interlock.json',
    'c2-006-sequential.json',
    'c2-007-flicker.json',
    'c2-008-stop-priority.json',
    'c2-009-and-lamp.json',
    'c2-010-or-lamp.json',
    'c2-011-self-hold-stop.json',
    'c2-012-two-hand.json',
    'c2-013-off-delay.json',
    'c2-014-mutual-interlock.json',
    'c2-015-three-step.json',
    'c2-016-last-press.json',
    'c2-017-flicker-alarm.json',
    'c2-018-conditional-hold.json',
    'c2-019-two-timer.json',
    'c2-020-random.json',
  ],
  plc: [
    'd-001-self-hold.json',
    'd-002-interlock.json',
    'd-003-on-delay.json',
    'd-004-one-shot.json',
    'd-005-sequential.json',
    'd-006-flicker.json',
    'd-007-counter.json',
    'd-008-stop-priority.json',
    'd-009-momentary.json',
    'd-010-and-or.json',
    'd-011-set-reset.json',
    'd-012-edge-one-shot.json',
    'd-013-off-delay.json',
    'd-014-interlock.json',
    'd-015-three-step.json',
    'd-016-counter-steps.json',
    'd-017-counter-alarm.json',
    'd-018-clock-flicker.json',
    'd-019-master-control.json',
    'd-020-comprehensive.json',
  ],
};

describe('resources/content の複写（§7.8 / Phase 2 acceptance BLOCKER）', () => {
  it('正本にある全モードフォルダが揃っている', () => {
    expect(jsonFilesIn(SHIPPED_ROOT).length).toBe(0); // ルート直下にJSONは無い（モード別フォルダのみ）
    expect(readdirSync(SHIPPED_ROOT).sort()).toEqual(BUILTIN_MODES);
  });

  it.each(BUILTIN_MODES)('%s: 正本と同じファイルが揃っている', (mode) => {
    const shipped = join(SHIPPED_ROOT, mode);
    const source = join(SOURCE_ROOT, mode);
    expect(jsonFilesIn(shipped)).toEqual(jsonFilesIn(source));
  });

  it('内蔵課題の総数（72題）と一致する（§7.9）', () => {
    const total = BUILTIN_MODES.reduce(
      (sum, mode) => sum + jsonFilesIn(join(SHIPPED_ROOT, mode)).length,
      0,
    );
    expect(total).toBe(BUILTIN_ALL_PROBLEMS.length);
  });

  it('モードB内蔵課題の数（20題）と一致する（§7.9）', () => {
    expect(jsonFilesIn(join(SHIPPED_ROOT, 'assemble'))).toHaveLength(BUILTIN_PROBLEMS.length);
  });

  for (const [mode, files] of Object.entries(WIRED_FILES)) {
    describe(mode, () => {
      it.each(files)('%s の中身が正本と一致する', (file) => {
        expect(parsed(join(SHIPPED_ROOT, mode), file)).toEqual(
          parsed(join(SOURCE_ROOT, mode), file),
        );
      });
    });
  }

  it('複写した課題のIDが内蔵課題と揃っている（全モード）', () => {
    const ids = BUILTIN_MODES.flatMap((mode) =>
      jsonFilesIn(join(SHIPPED_ROOT, mode)).map(
        (file) => (parsed(join(SHIPPED_ROOT, mode), file) as { id: string }).id,
      ),
    ).sort();
    expect(ids).toEqual(BUILTIN_ALL_PROBLEMS.map((p) => p.id).sort());
  });
});
