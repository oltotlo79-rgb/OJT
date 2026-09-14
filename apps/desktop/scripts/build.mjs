import { build } from 'electron-vite';

/**
 * electron-vite のビルドを JavaScript API から呼ぶ。
 *
 * `electron-vite build` の CLI は CJS のシムから自前の ESM を `require()` するため、
 * Node 25 系の循環検出に引っかかって `ERR_REQUIRE_CYCLE_MODULE` で落ちることがある。
 * API 経由なら最初から ESM のまま読み込まれるのでこの問題を踏まない。
 */
await build({ configFile: 'electron.vite.config.ts' });
