import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 同梱課題JSONを `@ojt/content` から `apps/desktop/resources/content/` へ複写する。
 * 設計仕様 §7.8（同梱課題は `resources/content/<mode>/<id>.json` を読む）。
 *
 * `resources/` はリポジトリに入っている（配布物の中身をレビューできるように）が、課題の
 * 正本は `packages/content/src/builtin/` の1箇所だけにしたい。ここを `dist` の前に必ず通し、
 * `test/content-resources.test.ts` が「複写が正本と一致していること」を検査する。
 * 食い違ったらテストが落ちるので、片方だけ直したまま配布されることがない。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');
const SOURCE = resolve(APP_ROOT, '../../packages/content/src/builtin');
const TARGET = join(APP_ROOT, 'resources', 'content');

/**
 * 複写するモード別フォルダ。正本（`packages/content/src/builtin/`）配下のディレクトリを
 * そのまま拾うため、Phase 3 で `plc` 等のモードフォルダが増えても本ファイルの変更なしに
 * 複写される（BLOCKER: 以前は `['assemble']` に固定されており、モードC1/C2が
 * 配布物から欠落していた）。
 */
const MODES = readdirSync(SOURCE, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const mode of MODES) {
  const from = join(SOURCE, mode);
  const to = join(TARGET, mode);
  // 正本から消えた課題が配布物に残らないよう、いったん消してから丸ごと複写する
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  const count = readdirSync(to).filter((name) => name.endsWith('.json')).length;
  // `globalThis.` を付けるのは、素のJS向け lint 設定に Node のグローバルが入っていないため
  globalThis.process.stdout.write(`同梱課題を複写しました: ${mode} ${String(count)} 件 → ${to}\n`);
}
