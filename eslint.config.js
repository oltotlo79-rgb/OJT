import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `out/` は electron-vite のビルド成果物、`test-results/` は Playwright の出力。
  // `manual-content.ts` は `docs/manual/*.md` からの生成物（取扱説明書 設計 決定表#2）。
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/test-results/**',
      'apps/desktop/src/renderer/help/manual-content.ts',
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
  {
    files: ['apps/desktop/e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              importNames: ['_electron'],
              message:
                '利用者の設定を保護するため、起動は一時userDataを作るapp.tsのlaunchAppを使ってください。',
            },
          ],
        },
      ],
    },
  },
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
  // 素のJS（設定ファイル・ビルドスクリプト）は型情報を使うルールの対象外にする。
  // ただし `apps/desktop/scripts/` の配布用スクリプト5本は対象外にしない
  // （QA-14: 検査が最も薄いコードが配布物を作っていた）。残る4本
  // （`annotate-shots` / `build-manual` / `feature-inventory` / `manual-build`）は
  // 同名の手書き `*.d.mts` が型の正本で、`tsconfig.json` の TS プログラムには
  // `*.mjs` 本体が root file として入らない（`.d.mts` に隠れる、TS の既定動作）ため、
  // 型情報つき ESLint を当てると「project service に見つからない」で構文エラーになる。
  {
    files: ['**/*.js', '**/*.mjs'],
    ignores: [
      'apps/desktop/scripts/build.mjs',
      'apps/desktop/scripts/check-dist.mjs',
      'apps/desktop/scripts/inspect-dist.mjs',
      'apps/desktop/scripts/manual-date.mjs',
      'apps/desktop/scripts/copy-content.mjs',
      'apps/desktop/scripts/dev.mjs',
      'apps/desktop/scripts/print-manual.mjs',
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
