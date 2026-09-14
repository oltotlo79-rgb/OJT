import type { OjtApi } from '../shared/ipc.js';

/** preload が `contextBridge` で公開する API。設計仕様 §4.3。 */
declare global {
  interface Window {
    ojt: OjtApi;
  }
}

export {};
