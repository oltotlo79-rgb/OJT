import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

/**
 * TypeScript のソースをそのまま Node で走らせるための解決フック。
 *
 * このリポジトリの import は `./foo.js`（TypeScript の作法。`verbatimModuleSyntax`）で書くが、
 * `node --experimental-transform-types` は拡張子を読み替えないので、実体が `foo.ts` だけの相対
 * importは解決できない。ビルド手順や追加依存（tsx など）を足さずに `scripts/*.ts` を動かすため、
 * 相対 import の `.js` が実在せず `.ts` が在るときだけ `.ts` に読み替える。
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL !== undefined) {
      const asTs = new URL(`${specifier.slice(0, -'.js'.length)}.ts`, context.parentURL);
      if (asTs.protocol === 'file:' && existsSync(fileURLToPath(asTs))) {
        return { url: asTs.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
