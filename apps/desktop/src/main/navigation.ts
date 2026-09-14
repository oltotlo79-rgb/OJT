import { pathToFileURL } from 'node:url';

/**
 * 画面遷移の許可判定。設計仕様 §1.2（完全オフライン）/ §13。
 *
 * renderer が何かの拍子に外部URLへ飛ぼうとしても（課題JSONに書かれたリンク、貼り付けられた
 * テキストの自動リンク化、将来の実装ミス）、このアプリは**自分の画面以外へは遷移しない**。
 * 判定そのものは Electron に触らない純粋関数にして、単体テストで固定する。
 */

/** 許可する遷移先。 */
export interface AppUrlOptions {
  /** renderer の `index.html`（本番）。`file://` のURL文字列でも OS のパスでもよい。 */
  rendererFile: string;
  /** 開発サーバのURL（`ELECTRON_RENDERER_URL`）。本番では `undefined`。 */
  devUrl?: string | undefined;
}

/** `file://` のパス部分を比較できる形に揃える（Windows は大文字小文字とスラッシュを無視）。 */
function normalizeFilePath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

/**
 * 文字列を URL にする。`file://` でない素のパスは `file://` として解釈する。
 *
 * Windows の絶対パス（`C:\...`）を `new URL()` に渡すと **`c:` というスキーム**として
 * 解釈されてしまい `file:` にならないので、先にドライブ文字の形を見て振り分ける。
 */
function toUrl(value: string): URL | undefined {
  if (value.length === 0) return undefined;
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    try {
      return pathToFileURL(value);
    } catch {
      return undefined;
    }
  }
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * その URL はアプリ自身の画面か。§1.2
 *
 * - 本番: renderer の `index.html`（同じファイル。`#`/`?` が付いていてもよい）だけを許す
 * - 開発: `ELECTRON_RENDERER_URL` と**同じオリジン**も許す（Vite の HMR が付ける経路を含む）
 * - それ以外（`http(s)://`・`about:`・別の `file://`・`javascript:` など）はすべて拒否
 */
export function isAppUrl(target: string, options: AppUrlOptions): boolean {
  const url = toUrl(target);
  if (url === undefined) return false;
  const dev = options.devUrl;
  if (dev !== undefined && dev.length > 0) {
    const devParsed = toUrl(dev);
    if (devParsed !== undefined && devParsed.origin !== 'null' && url.origin === devParsed.origin) {
      return true;
    }
  }
  if (url.protocol !== 'file:') return false;
  const renderer = toUrl(options.rendererFile);
  if (renderer === undefined || renderer.protocol !== 'file:') return false;
  // ネットワーク共有（`file://server/share/...`）は素のパスと綴りが被りうるので host も比べる
  if (url.host.toLowerCase() !== renderer.host.toLowerCase()) return false;
  return normalizeFilePath(url) === normalizeFilePath(renderer);
}
