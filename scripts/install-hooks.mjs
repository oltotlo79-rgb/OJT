import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
if (!globalThis.process.env.CI && existsSync(resolve(root, '.git'))) {
  const existing = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (existing.status !== 0 && existing.status !== 1)
    throw new Error('Git フックの設定を読み取れません。');
  const value = (existing.stdout ?? '').trim();
  if (value && value !== '.githooks') {
    throw new Error(`既存の Git フックを保護するため自動変更を停止しました: ${value}`);
  }
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root });
  globalThis.process.stdout.write('push 前の関連テスト・説明書整合ゲートを設定しました。\n');
}
