import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 1件の判定は模範と訓練者の2回ぶんを10msティックで最後まで回すため、盤の規模(端子150前後)では
    // 1テストに数秒かかる。カバレッジ計測を付けるとさらに数倍になるので既定の5秒では足りない。
    // 内蔵C2課題の弁別テスト(mismatchCount()が模範・訓練者2回ぶん回路をシミュレートする)は
    // coverage計測込みで136秒かかるため、180秒まで上げておく(B-6)。
    testTimeout: 180_000,
    hookTimeout: 180_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
