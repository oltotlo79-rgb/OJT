import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

/** 別SHAの成功・同じSHAの古い成功・未完了の実行を公開根拠にしない。 */
export function requireSuccessfulCI(runs, sha, tag) {
  for (const branch of ['main', tag]) {
    const latest = runs
      .filter((run) => run.headSha === sha && run.headBranch === branch && run.event === 'push')
      .sort((a, b) => b.databaseId - a.databaseId)[0];
    if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
      throw new Error(
        `${branch} の対象コミット ${sha} の最新CIが成功していません。公開を中止します。`,
      );
    }
  }
}

/** 添付した実体がローカルで検証した2つのEXEと一致することも公開直前に確認する。 */
export function requireMatchingAssets(release, expected) {
  if (!release.draft)
    throw new Error('下書きリリースだけ公開できます。公開済みの版は変更しません。');
  if (release.assets.length !== expected.length)
    throw new Error('添付ファイルの数が一致しません。');
  for (const file of expected) {
    const asset = release.assets.find((item) => item.name === file.name);
    if (
      !asset ||
      asset.state !== 'uploaded' ||
      asset.size !== file.size ||
      asset.digest !== file.digest
    )
      throw new Error(`検証済みEXEと添付ファイルが一致しません: ${file.name}`);
  }
}

function main() {
  const run = (command, args) =>
    execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  if (run('git', ['status', '--porcelain']))
    throw new Error('未コミット変更があります。公開を中止します。');
  const { version } = JSON.parse(readFileSync(resolve(ROOT, 'apps/desktop/package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('正式版のバージョンを指定してください。');
  const tag = `v${version}`;
  const sha = run('git', ['rev-parse', 'HEAD']);
  if (run('git', ['rev-parse', `${tag}^{commit}`]) !== sha)
    throw new Error('タグと作業中のコミットが一致しません。');
  const remoteRefs = run('git', ['ls-remote', 'origin', 'refs/heads/main', `refs/tags/${tag}^{}`]);
  for (const ref of ['refs/heads/main', `refs/tags/${tag}^{}`]) {
    if (!remoteRefs.split(/\r?\n/u).some((line) => line === `${sha}\t${ref}`))
      throw new Error(`リモートの ${ref} が対象コミットと一致しません。`);
  }
  const runs = JSON.parse(
    run('gh', [
      'run',
      'list',
      '--workflow',
      'ci.yml',
      '--commit',
      sha,
      '--limit',
      '100',
      '--json',
      'headSha,headBranch,event,status,conclusion,databaseId',
    ]),
  );
  requireSuccessfulCI(runs, sha, tag);
  const { nameWithOwner } = JSON.parse(run('gh', ['repo', 'view', '--json', 'nameWithOwner']));
  const release = JSON.parse(run('gh', ['api', `repos/${nameWithOwner}/releases/tags/${tag}`]));
  const expected = ['Setup', 'Portable'].map((kind) => {
    const name = `DenkiKyoikuTool-${version}-x64-${kind}.exe`;
    const bytes = readFileSync(resolve(ROOT, 'apps/desktop/release', name));
    return {
      name,
      size: bytes.length,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    };
  });
  requireMatchingAssets(release, expected);
  run('gh', ['release', 'edit', tag, '--draft=false', '--latest']);
  globalThis.process.stdout.write(`${tag} を公開しました。対象コミット: ${sha}\n`);
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
