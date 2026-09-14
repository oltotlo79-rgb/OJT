import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 内蔵課題は素の Node ESM でも読めること。§7.8
 *
 * `src/builtin/index.ts` の JSON import は **import attributes**（`with { type: 'json' }`）が
 * 必須である。Vite / Vitest は属性が無くても読めてしまうため、テストが通るのに
 * Electron のメインプロセス（素の Node ESM）では `ERR_IMPORT_ATTRIBUTE_MISSING` で落ちる、
 * という取りこぼしが起きる。ここだけは Node を直接起動して読み込みを見張る。
 */

/** `packages/content`（Node を起動する作業ディレクトリ）。 */
const PACKAGE_ROOT = join(import.meta.dirname, '..');

describe('builtin problems under plain Node ESM', () => {
  it('imports the builtin registry without import-attribute errors', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--import',
        './scripts/ts-source-resolve.js',
        '-e',
        "const m = await import('./src/builtin/index.ts'); process.stdout.write(String(m.BUILTIN_PROBLEMS.length));",
      ],
      { cwd: PACKAGE_ROOT, encoding: 'utf8' },
    );
    expect(result.stderr).not.toContain('ERR_IMPORT_ATTRIBUTE_MISSING');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('8');
  });
});
