import type { OjtApi } from '../shared/ipc.js';

/**
 * preload が `contextBridge` で公開する API。設計仕様 §4.3。
 *
 * **任意**にしておく。preload が読み込まれなかった環境（設定ミス、素のブラウザで開いたとき）が
 * 実在するため、「必ずある」ことにすると `tsc` が読み出しを検査してくれない。
 * 画面側は直接触らず `app/ojt-api.ts` の `ojtApi()` を通す。
 */
declare global {
  interface Window {
    ojt?: OjtApi;
  }
}

export {};
