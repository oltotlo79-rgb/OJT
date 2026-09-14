import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `out/` は electron-vite のビルド成果物、`test-results/` は Playwright の出力
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  // 循環依存の検出（設計仕様 §4.2）。import-x は依存グラフを辿るときに
  // `import-x/parsers` を見るため、その設定を持つ typescript プリセットを取り込み、
  // 解決器だけ workspace 対応のものに差し替える。
  importX.flatConfigs.typescript,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['packages/*/tsconfig.json', 'apps/*/tsconfig.json'],
        }),
      ],
    },
    rules: {
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      'import-x/no-unresolved': 'error',
    },
  },
  // React のフック規則（`apps/desktop` の renderer だけが React を使う）。
  // `rules-of-hooks` は破れば必ずバグになるので error、`exhaustive-deps` は
  // 「意図して依存を外す」場面（Worker の張り直しなど）があるので warn にし、
  // 外すときは理由付きの `eslint-disable-next-line` を必ず添える。
  {
    files: ['apps/desktop/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // 素のJS（設定ファイル・ビルドスクリプト）は型情報を使うルールの対象外にする
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
);
