import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
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
    files: ['**/*.ts'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['packages/*/tsconfig.json'],
        }),
      ],
    },
    rules: { 'import-x/no-cycle': ['error', { maxDepth: Infinity }] },
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
);
