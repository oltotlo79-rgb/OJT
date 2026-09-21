import { writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRelease, artifactTable } from './inspect-dist.mjs';

/** 全検査を通った配布物だけにチェックサム一覧を発行する。公開操作はしない。
 * @param {string} [appRoot]
 */
export async function checkDist(appRoot = resolve(import.meta.dirname, '..')) {
  const path = join(appRoot, 'release', 'artifacts.md');
  rmSync(path, { force: true });
  const report = await inspectRelease(appRoot);
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  writeFileSync(path, artifactTable(report), 'utf8');
  return path;
}

if (
  globalThis.process.argv[1] &&
  resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    globalThis.process.stdout.write(`配布物の検査に成功しました: ${await checkDist()}\n`);
  } catch (error) {
    globalThis.process.stderr.write(`配布物の検査に失敗しました: ${String(error)}\n`);
    globalThis.process.exitCode = 1;
  }
}
