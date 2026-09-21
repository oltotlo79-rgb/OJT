import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  changedFiles,
  checkEnvironment,
  checkPlan,
  executeChecks,
  MANUAL_GATES,
} from './check-push.mjs';

// このファイルだけを Git hook から直接実行した場合も、親のリポジトリには触れない。
for (const key of Object.keys(globalThis.process.env)) {
  if (key.startsWith('GIT_')) delete globalThis.process.env[key];
}

test('Git hook固有の環境を子のテストから除き、通常の実行環境を保つ', () => {
  assert.deepEqual(
    checkEnvironment({
      GIT_DIR: 'parent',
      GIT_WORK_TREE: 'parent',
      GIT_INDEX_FILE: 'parent-index',
      GIT_CONFIG_COUNT: '1',
      PATH: 'bin',
      TEMP: 'tmp',
    }),
    { PATH: 'bin', TEMP: 'tmp' },
  );
});

test('画面・文言・説明書の変更で必須照合が選ばれ、修正したテストも含まれる', () => {
  for (const file of [
    'apps/desktop/src/renderer/panels/ViewHint.tsx',
    'apps/desktop/src/renderer/i18n/ja.ts',
    'docs/manual/coverage.json',
    'apps/desktop/test/settings-plc.test.tsx',
  ]) {
    const plan = checkPlan([file], []);
    const app = plan.find((check) => check.cwd === 'apps/desktop');
    for (const gate of MANUAL_GATES) assert.ok(app.args.includes(`../../apps/desktop/${gate}`));
    if (file.startsWith('apps/')) assert.ok(app.args.includes(`../../${file}`));
  }
});

test('共有エンジンの変更は各パッケージと画面の依存関係まで検査する', () => {
  const file = 'packages/ladder-core/src/edit.ts';
  const plan = checkPlan([file], ['ladder-core', 'plc-dialects']);
  for (const check of plan.filter((row) => !row.node))
    assert.ok(check.args.includes(`../../${file}`));
  assert.deepEqual(
    plan.filter((row) => !row.node).map((row) => row.cwd),
    ['packages/ladder-core', 'packages/plc-dialects', 'apps/desktop'],
  );
});

test('依存関係・テスト設定の変更では関連判定だけに頼らない', () => {
  const plan = checkPlan(['pnpm-lock.yaml'], ['ladder-core']);
  assert.deepEqual(
    plan.filter((row) => !row.node).map((row) => row.args),
    [['run'], ['run']],
  );
});

test('検査失敗・プロセス起動失敗を成功に扱わず、その時点で中止する', () => {
  for (const failure of [1, null]) {
    let calls = 0;
    assert.throws(
      () =>
        executeChecks([{ cwd: 'a' }, { cwd: 'b' }], () => {
          calls++;
          return failure;
        }),
      /検査が失敗/u,
    );
    assert.equal(calls, 1);
  }
});

test('送信する全差分を検査し、未コミット・未追跡コード・別コミットは拒否する', () => {
  const root = mkdtempSync(join(tmpdir(), 'ojt-push-gate-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git('init');
    git('config', 'user.name', 'Gate test');
    git('config', 'user.email', 'gate@example.invalid');
    const commit = (name) => {
      writeFileSync(join(root, name), name);
      git('add', '--', name);
      git('commit', '-m', name);
      return git('rev-parse', 'HEAD');
    };
    const first = commit('first.txt');
    commit('second.txt');
    const head = commit('third.txt');
    const input = `refs/heads/test ${head} refs/heads/main ${first}\n`;
    assert.deepEqual(changedFiles(root, input), ['second.txt', 'third.txt']);
    assert.throws(
      () => changedFiles(root, `refs/heads/test ${first} refs/heads/main ${first}`),
      /checkout/u,
    );
    writeFileSync(join(root, 'third.txt'), 'dirty');
    assert.throws(() => changedFiles(root, input), /未コミット/u);
    git('add', '--', 'third.txt');
    git('commit', '-m', '変更を保存');
    const current = git('rev-parse', 'HEAD');
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'scripts', 'forgotten.mjs'), 'export const x = 1;');
    assert.throws(
      () => changedFiles(root, `refs/heads/test ${current} refs/heads/main ${first}`),
      /未追跡/u,
    );
    assert.throws(
      () => changedFiles(root, `refs/heads/test ${current} refs/heads/main invalid`),
      /読み取れ/u,
    );
    const deletion = `refs/heads/test ${'0'.repeat(40)} refs/heads/test ${current}`;
    assert.equal(changedFiles(root, deletion), null);
  } finally {
    // このテストで作成した一時ディレクトリだけを解放する。
    rmSync(root, { recursive: true, force: true });
  }
});

test('実際のgit pushをフックが拒否し、送信先のコミットが変わらない', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ojt-hook-reject-'));
  const root = join(temp, 'work');
  const remote = join(temp, 'remote.git');
  mkdirSync(root);
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git('init');
    git('init', '--bare', remote);
    git('config', 'user.name', 'Gate test');
    git('config', 'user.email', 'gate@example.invalid');
    writeFileSync(join(root, 'sample.txt'), 'before');
    git('add', '--', 'sample.txt');
    git('commit', '-m', '最初の版');
    const before = git('rev-parse', 'HEAD');
    git('push', remote, 'HEAD:refs/heads/main');
    mkdirSync(join(root, '.githooks'));
    mkdirSync(join(root, 'scripts'));
    copyFileSync(
      join(import.meta.dirname, '../.githooks/pre-push'),
      join(root, '.githooks/pre-push'),
    );
    copyFileSync(join(import.meta.dirname, 'check-push.mjs'), join(root, 'scripts/check-push.mjs'));
    git('add', '--', '.githooks/pre-push', 'scripts/check-push.mjs');
    git('commit', '-m', '検査ゲートを追加');
    git('config', 'core.hooksPath', '.githooks');
    writeFileSync(join(root, 'sample.txt'), '検査対象と送信内容が違う');
    const result = spawnSync('git', ['push', remote, 'HEAD:refs/heads/main'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /未コミット変更/u);
    assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/heads/main'), before);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
