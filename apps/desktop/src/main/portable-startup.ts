import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** ランチャーが自分の展開先に指定した通知ファイルだけへ書く。 */
export function notifyPortableReady(
  executable: string,
  supplied: string | undefined,
  packaged: boolean,
): boolean {
  if (!packaged || supplied === undefined) return false;
  const expected = join(dirname(dirname(executable)), 'ojt-ready');
  if (resolve(supplied).toLowerCase() !== resolve(expected).toLowerCase()) return false;
  try {
    writeFileSync(expected, 'ready', 'utf8');
    return true;
  } catch {
    return false;
  }
}
