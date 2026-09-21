import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireMatchingAssets, requireSuccessfulCI } from './publish-release.mjs';

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

test('公開するSHAのmainとタグが両方成功したときだけ許可する', () => {
  assert.doesNotThrow(() => requireSuccessfulCI([green('main'), green(tag)], sha, tag));
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
