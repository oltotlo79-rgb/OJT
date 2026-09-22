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
    // 216課題の実ファイル読込・画面生成を含む。Windowsの全体実行では約7秒かかる
    // 検査があるため15秒を上限とする。操作応答や描画性能の個別基準は変更しない。
    testTimeout: 15_000,
    // QA-10: 142ファイル/2,225テストが一度も測定されていなかった唯一の死角。閾値は置かない
    // （前提C: `apps/desktop` に閾値は置かない設計）。可視化だけを入れ、実測値を
    // `docs/releases/v1.1.0.md` に記録してからラチェット運用（実測−3pt）へ移す（Task 29 Step 5）。
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      reporter: ['text-summary', 'json-summary'],
      // v8計装のオーバーヘッドで、既存のタイムアウト前提のテストが希に超過することがある
      // （中身のバグではなく計測固有の負荷）。既定の `false` だと失敗時にレポートが
      // 出ず「一度測る」ことそのものができないため、失敗があっても出す
      reportOnFailure: true,
    },
  },
});
