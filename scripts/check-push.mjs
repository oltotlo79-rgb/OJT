import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const ZERO = /^0+$/u;
export const MANUAL_GATES = [
  'test/feature-inventory.test.ts',
  'test/manual-coverage.test.ts',
  'test/manual-sync.test.ts',
  'test/manual-style.test.ts',
  'test/manual-appdata.test.ts',
  'test/i18n-keys.test.ts',
];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/** hook の標準入力を使う。直前1コミットだけでなく、送信する全コミットを検査する。 */
export function changedFiles(root, input, base = 'origin/main') {
  const head = git(root, ['rev-parse', 'HEAD']);
  const updates = input.trim() ? input.trim().split(/\r?\n/u) : [];
  const comparisons = [];
  for (const update of updates) {
    const [, local, , remote] = update.split(/\s+/u);
    if (
      !local ||
      !remote ||
      !/^(?:[\da-f]{40}|[\da-f]{64})$/u.test(local) ||
      !/^(?:[\da-f]{40}|[\da-f]{64})$/u.test(remote)
    ) {
      throw new Error('送信する参照を読み取れません。push を中止します。');
    }
    if (ZERO.test(local)) continue;
    const commit = git(root, ['rev-parse', `${local}^{commit}`]);
    if (commit !== head) throw new Error('送信先のコミットを checkout してから検査してください。');
    comparisons.push(ZERO.test(remote) ? git(root, ['merge-base', head, base]) : remote);
  }
  if (!updates.length) comparisons.push(git(root, ['merge-base', head, base]));
  if (!comparisons.length) return null; // 削除だけの push に検査対象のコードは無い。
  if (git(root, ['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('未コミット変更があります。検査する内容と送信する内容を一致させてください。');
  }
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
  if (
    untracked.some((path) =>
      /^(apps\/|packages\/|scripts\/|\.githooks\/|docs\/manual\/)/u.test(path),
    )
  ) {
    throw new Error('未追跡の実装・テスト・説明書があります。送信対象の漏れを確認してください。');
  }
  return [
    ...new Set(
      comparisons.flatMap((before) =>
        git(root, ['diff', '--name-only', '-z', before, head]).split('\0').filter(Boolean),
      ),
    ),
  ];
}

/** import 関係に出ない説明書の照合は常時。関連テストの選択は Vitest に任せる。 */
export function checkPlan(files, packages) {
  const source = files.filter((path) => /\.(?:[cm]?[jt]sx?|css|json)$/u.test(path));
  const configuration = files.some((path) =>
    /(^|\/)(?:package\.json|pnpm-lock\.yaml|vitest\.config\.[cm]?[jt]s|tsconfig[^/]*\.json)$/u.test(
      path,
    ),
  );
  const shared = source.filter((path) => path.startsWith('packages/'));
  const checks = [{ cwd: '.', args: ['--test', 'scripts/check-push.test.mjs'], node: true }];
  for (const workspace of [...packages.map((name) => `packages/${name}`), 'apps/desktop']) {
    const relevant = source.filter((path) => path.startsWith(`${workspace}/`));
    if (workspace === 'apps/desktop') {
      // Electron 44 の初回取得を複数の Vitest worker が同時に開始しないよう直列化する。
      checks.push({ cwd: workspace, args: ['-e', "require('electron')"], node: true });
      relevant.push(...MANUAL_GATES.map((path) => `${workspace}/${path}`));
    }
    if (configuration) checks.push({ cwd: workspace, args: ['run'] });
    else if (relevant.length || shared.length) {
      checks.push({
        cwd: workspace,
        args: [
          'related',
          '--run',
          '--passWithNoTests',
          ...new Set([...relevant, ...shared].map((path) => `../../${path}`)),
        ],
      });
    }
  }
  return checks;
}

export function executeChecks(checks, execute) {
  for (const check of checks) {
    const result = execute(check);
    if (result !== 0)
      throw new Error(
        `push 前の検査が失敗しました（${check.cwd}）。修正後に再度 push してください。`,
      );
  }
}

/** Git hook の GIT_DIR / INDEX_FILE 等をテスト用の別リポジトリへ漏らさない。 */
export function checkEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('GIT_')));
}

function main() {
  const files = changedFiles(ROOT, readFileSync(0, 'utf8'));
  if (files === null) return;
  for (const gate of MANUAL_GATES) {
    if (!existsSync(resolve(ROOT, 'apps/desktop', gate))) {
      throw new Error(`必須の検査がありません: ${gate}`);
    }
  }
  const packages = readdirSync(resolve(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const require = createRequire(import.meta.url);
  const vitest = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  globalThis.process.stdout.write(
    `push 前の検査: 変更 ${files.length} ファイル＋説明書の必須照合\n`,
  );
  executeChecks(checkPlan(files, packages), (check) => {
    const args = check.node ? check.args : [vitest, ...check.args];
    return spawnSync(globalThis.process.execPath, args, {
      cwd: resolve(ROOT, check.cwd),
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...checkEnvironment(globalThis.process.env), DEBUG_PRINT_LIMIT: '500' },
    }).status;
  });
}

if (
  globalThis.process.argv[1] &&
  resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    globalThis.process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    globalThis.process.exitCode = 1;
  }
}
