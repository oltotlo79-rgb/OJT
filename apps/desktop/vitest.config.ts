import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 生成物 `manual-content.ts` が図を読み込む別名。`electron.vite.config.ts` と同じ先を指す
  // （取扱説明書 設計 §7.2b）。図が入るまで（Plan 6 Task 12）は読み込みそのものが出ない。
  resolve: {
    alias: { '@manual-images': resolve(import.meta.dirname, '../../docs/manual/images') },
  },
  test: {
    name: 'desktop',
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
