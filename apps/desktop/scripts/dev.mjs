import { createServer } from 'electron-vite';

/**
 * 開発サーバ（renderer の HMR ＋ main/preload の再ビルド ＋ Electron 起動）。
 * CLI を使わない理由は `scripts/build.mjs` と同じ。
 */
await createServer({ configFile: 'electron.vite.config.ts' }, { rendererOnly: false });
