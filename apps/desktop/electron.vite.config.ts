import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * electron-vite の3ビルド（main / preload / renderer）。設計仕様 §4.3。
 *
 * ワークスペースの `@ojt/*` は生の TypeScript を `exports` に載せているため、main でも
 * 外部化せずバンドルする（`exclude` に列挙）。
 *
 * `external` を明示するのが要点。`electron` は devDependencies にあるので
 * `externalizeDepsPlugin()` の対象にならず、放っておくと **npm パッケージの `electron`**
 * （Electron 実行ファイルのパスを返すだけの CLI ヘルパ）がバンドルされてしまい、
 * main プロセスが `app` を持たないオブジェクトを掴んでウィンドウを1枚も作らなくなる。
 */
const OJT_PACKAGES = [
  '@ojt/circuit-sim',
  '@ojt/board-model',
  '@ojt/schematic-core',
  '@ojt/content',
];

/** main / preload で必ず外部化するもの（Electron 本体と Node 組み込みモジュール）。 */
const NODE_EXTERNALS = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: OJT_PACKAGES })],
    build: {
      rollupOptions: {
        external: NODE_EXTERNALS,
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: NODE_EXTERNALS,
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        /*
         * preload は **CommonJS の `.cjs`** で出す（Phase 7 Task 8 / 指摘 DM-4）。
         * `webPreferences.sandbox: true` の renderer は preload を CommonJS としてしか
         * 読み込めず、ESM の `.js` を指すと preload が丸ごと無視されて `window.ojt` が
         * 生えない。拡張子を `.cjs` にするのは `apps/desktop/package.json` が
         * `"type": "module"` だからで、`.js` のままでは Node が ESM として読もうとする。
         * `src/main/index.ts` の `preload:` と**対で**直すこと。
         */
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(import.meta.dirname, 'src/shared'),
        // 取扱説明書の図（生成物 `manual-content.ts` が読み込む）。取扱説明書 設計 §7.2b
        '@manual-images': resolve(import.meta.dirname, '../../docs/manual/images'),
      },
    },
    // `docs/` は `apps/desktop` の外にあるので、開発サーバに読んでよい根を明示する
    server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
    worker: { format: 'es' },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
      },
    },
  },
});
