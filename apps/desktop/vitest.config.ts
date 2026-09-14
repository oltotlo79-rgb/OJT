import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'desktop',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
