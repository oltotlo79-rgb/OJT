import js from '@eslint/js';
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
  // 素のJS（設定ファイル・ビルドスクリプト）は型情報を使うルールの対象外にする
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
);
