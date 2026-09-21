import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/** テスト用の仮名義を実プロジェクトの履歴に残さない。個人名義そのものは変更しない。 */
export function assertRealIdentity(name, email) {
  if (
    !name.trim() ||
    !email.includes('@') ||
    /^(?:Gate test|Test User)$/iu.test(name) ||
    /@(?:example\.(?:invalid|com|net|org)|[^@]*\.(?:invalid|test|example))$/iu.test(email)
  ) {
    throw new Error(
      `テスト用または未設定のGit名義です: ${name} <${email}>。user.name / user.email を確認してください。`,
    );
  }
}

export function checkCommitIdentity(root) {
  for (const key of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    const value = git(root, ['var', key]);
    const match = /^(.*?) <([^<>]+)> /u.exec(value);
    if (!match) throw new Error(`Git名義を読み取れません: ${key}`);
    assertRealIdentity(match[1], match[2]);
  }
}

/** すでに origin にある履歴には触れず、今回送る全コミットの両名義を検査する。 */
export function checkOutgoingIdentities(root, input, base = 'origin/main') {
  const updates = input.trim() ? input.trim().split(/\r?\n/u) : [];
  const ranges = updates.length
    ? updates.flatMap((update) => {
        const [, local, , remote] = update.split(/\s+/u);
        if (/^0+$/u.test(local)) return [];
        const before = /^0+$/u.test(remote) ? git(root, ['merge-base', local, base]) : remote;
        return [`${before}..${local}`];
      })
    : [`${git(root, ['merge-base', 'HEAD', base])}..HEAD`];
  for (const range of ranges) {
    const records = git(root, ['log', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce', range]);
    for (const line of records.split('\n').filter(Boolean)) {
      const [hash, author, authorEmail, committer, committerEmail] = line.split('\0');
      try {
        assertRealIdentity(author, authorEmail);
        assertRealIdentity(committer, committerEmail);
      } catch (error) {
        throw new Error(`コミット ${hash}: ${error.message}`, { cause: error });
      }
    }
  }
}

if (
  globalThis.process.argv[1] &&
  resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    checkCommitIdentity(ROOT);
  } catch (error) {
    globalThis.process.stderr.write(`${error.message}\n`);
    globalThis.process.exitCode = 1;
  }
}
