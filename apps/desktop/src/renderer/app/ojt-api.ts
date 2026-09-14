import type { OjtApi } from '../../shared/ipc.js';
import { JA } from '../i18n/ja.js';

/**
 * `window.ojt`（preload が `contextBridge` で公開する API）への唯一の入口。設計仕様 §4.3。
 *
 * 型の上で「必ずある」ことにすると、preload が読み込めなかったとき
 * （ビルド設定の誤り・`sandbox` の切替ミス・E2E の素の Chromium）に
 * `undefined.listProblems is not a function` という読めない例外で画面が落ちる。
 * ここで1度だけ確かめ、日本語の理由を持つ `Error` にして投げ直す（§13 #5 の例外バナーに出る）。
 */

/** preload の API を取り出す。無ければ日本語の理由付きで投げる。 */
export function ojtApi(): OjtApi {
  const api = window.ojt;
  if (api === undefined) throw new Error(JA.error.preloadMissing);
  return api;
}

/**
 * preload の API を取り出す。無ければ `undefined`。
 * 「あれば使う、無ければ黙って諦める」場所（起動時の設定読込・一時保存の後始末）用。§13 #5
 */
export function tryOjtApi(): OjtApi | undefined {
  return window.ojt;
}
