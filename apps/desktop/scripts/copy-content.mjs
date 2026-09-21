import { cpSync, mkdirSync, readdirSync, rmSync, realpathSync, lstatSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 同梱課題を正本へ揃える。余分なモードも除く。削除は検証済みの対象直下だけ。
 * @param {string} source
 * @param {string} target
 */
export function copyContent(source, target) {
  const fromRoot = realpathSync(source);
  mkdirSync(target, { recursive: true });
  const toRoot = realpathSync(target);
  const delta = relative(fromRoot, toRoot);
  const reverse = relative(toRoot, fromRoot);
  if (
    !delta ||
    (!delta.startsWith('..') && !isAbsolute(delta)) ||
    (!reverse.startsWith('..') && !isAbsolute(reverse))
  )
    throw new Error('正本と複写先は別のフォルダにしてください');
  const modes = readdirSync(fromRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (!modes.length) throw new Error('正本にモードフォルダがありません');
  for (const entry of readdirSync(toRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = resolve(toRoot, entry.name);
    const inside = relative(toRoot, path);
    if (!inside || inside.startsWith('..') || isAbsolute(inside))
      throw new Error('複写先の範囲外です');
    // ジャンクションもリンク先へ再帰せず、リンクそのものだけを外す。
    rmSync(path, { recursive: !lstatSync(path).isSymbolicLink(), force: true });
  }
  for (const mode of modes) cpSync(join(fromRoot, mode), join(toRoot, mode), { recursive: true });
  return modes;
}

if (
  globalThis.process.argv[1] &&
  resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const appRoot = resolve(import.meta.dirname, '..');
  const modes = copyContent(
    resolve(appRoot, '../../packages/content/src/builtin'),
    join(appRoot, 'resources/content'),
  );
  globalThis.process.stdout.write(`同梱課題を正本へ揃えました: ${modes.join(' / ')}\n`);
}
