import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchRelease,
  requireIdenticalReleaseSource,
  requireMatchingAssets,
  requireSuccessfulCI,
} from './publish-release.mjs';

const sha = 'abc';
const tag = 'v1.1.1';
const green = (headBranch, databaseId = 1) => ({
  headSha: sha,
  headBranch,
  databaseId,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
});

test('タグの製品と最新公開ツールのそれぞれのCI成功を必須にする', () => {
  const tagged = { ...green(tag), headSha: 'tag-source' };
  assert.doesNotThrow(() => requireSuccessfulCI([green('main'), tagged], sha, tag, 'tag-source'));
  assert.throws(() => requireSuccessfulCI([green('main'), green(tag)], sha, tag, 'tag-source'));
  assert.throws(() =>
    requireSuccessfulCI(
      [{ ...green('main'), headSha: 'tag-source' }, tagged],
      sha,
      tag,
      'tag-source',
    ),
  );
});

test('タグ以降の変更は公開ツールの2ファイルだけを許可する', () => {
  assert.doesNotThrow(() => requireIdenticalReleaseSource([]));
  assert.doesNotThrow(() =>
    requireIdenticalReleaseSource([
      'scripts/publish-release.mjs',
      'scripts/publish-release.test.mjs',
    ]),
  );
  for (const file of [
    'apps/desktop/src/main/index.ts',
    'apps/desktop/package.json',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    'docs/manual/index.md',
    'scripts/other.mjs',
  ])
    assert.throws(() => requireIdenticalReleaseSource(['scripts/publish-release.mjs', file]));
});

test('下書き取得に対応したCLIを使い、添付のハッシュと状態を保つ', () => {
  const release = {
    isDraft: true,
    assets: [{ name: 'Setup.exe', digest: 'sha256:abc', state: 'uploaded' }],
  };
  const result = fetchRelease((command, args) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['release', 'view', tag, '--json', 'isDraft,assets']);
    return JSON.stringify(release);
  }, tag);
  assert.deepEqual(result, { draft: true, assets: release.assets });
});

test('公開するSHAのmainとタグが両方成功したときだけ許可する', () => {
  assert.doesNotThrow(() => requireSuccessfulCI([green('main'), green(tag)], sha, tag));
});

test('新しい手動CIの失敗も古いpush成功で見逃さない', () => {
  const manual = { ...green('main', 2), event: 'workflow_dispatch', conclusion: 'failure' };
  assert.throws(() => requireSuccessfulCI([green('main'), green(tag), manual], sha, tag));
});

test('手動CIが完了した場合も最新実行の結果で判断する', () => {
  const old = { ...green('main'), conclusion: 'failure' };
  const manual = { ...green('main', 2), event: 'workflow_dispatch' };
  assert.doesNotThrow(() => requireSuccessfulCI([old, green(tag), manual], sha, tag));
});

for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
  test(`古い成功があっても最新の${conclusion}を見逃さない`, () => {
    const latest = { ...green('main', 2), conclusion };
    assert.throws(() => requireSuccessfulCI([green('main'), green(tag), latest], sha, tag));
  });
}

test('別SHAの成功・タグ未検査・未完了を拒否する', () => {
  assert.throws(() =>
    requireSuccessfulCI([green('main'), { ...green(tag), headSha: 'old' }], sha, tag),
  );
  assert.throws(() => requireSuccessfulCI([green('main')], sha, tag));
  assert.throws(() =>
    requireSuccessfulCI([green('main'), { ...green(tag), status: 'in_progress' }], sha, tag),
  );
});

const expected = [
  { name: 'Setup.exe', size: 3, digest: 'sha256:123' },
  { name: 'Portable.exe', size: 4, digest: 'sha256:456' },
];
const draft = () => ({
  draft: true,
  assets: expected.map((file) => ({ ...file, state: 'uploaded' })),
});
test('検証したEXEと添付の内容が一致する下書きだけ許可する', () => {
  assert.doesNotThrow(() => requireMatchingAssets(draft(), expected));
  assert.throws(() => requireMatchingAssets({ ...draft(), draft: false }, expected));
  assert.throws(() => requireMatchingAssets({ ...draft(), assets: [] }, expected));
  for (const field of ['name', 'size', 'digest', 'state']) {
    const release = draft();
    release.assets[0][field] = 'wrong';
    assert.throws(() => requireMatchingAssets(release, expected));
  }
});
