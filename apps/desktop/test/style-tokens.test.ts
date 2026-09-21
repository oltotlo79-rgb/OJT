import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { undefinedStyleTokens } from '../scripts/style-tokens.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../src');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : ['.css', '.ts', '.tsx', '.mjs'].includes(extname(path))
        ? [path]
        : [];
  });
}
describe('色・寸法の共通変数を未定義のまま使わない', () => {
  it('CSS、Reactのstyle、setPropertyを読み、fallbackなしの未定義参照を検出する', () => {
    const text = `.a { --panel: white; color: var(--missing); background: var(--panel); width: var(--size, 12px); } const inline = { '--font': '12px' }; e.style.setProperty('--wide', '100px'); .b { font-size: var(--font); width: var(--wide) }`;
    expect(undefinedStyleTokens([{ path: 'sample', text }])).toEqual([
      { path: 'sample', token: '--missing' },
    ]);
  });
  it('アプリと紙の全スタイルに未定義の変数がない', () => {
    expect(
      undefinedStyleTokens(
        files(root).map((path) => ({
          path: relative(root, path),
          text: readFileSync(path, 'utf8'),
        })),
      ),
    ).toEqual([]);
  });
});
