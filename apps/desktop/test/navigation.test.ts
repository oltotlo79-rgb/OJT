import { describe, expect, it } from 'vitest';
import { isAppUrl } from '../src/main/navigation.js';

/**
 * 画面遷移の許可判定（§1.2 完全オフライン / §13）。
 * 1D2-a のレビュー指摘で `will-navigate` を塞いだときの中身。Electron に触らない純粋関数なので
 * ここで固定しておく（本物のウィンドウを起動しなくても、どこへ行けてどこへ行けないかが分かる）。
 */

/** 配布版で `loadFile()` に渡す実際の形（OSのパス。`join()` が返すのと同じ）。 */
const RENDERER = 'C:\\Program Files\\OJT\\resources\\app.asar\\out\\renderer\\index.html';
const DEV = 'http://localhost:5173/';

describe('isAppUrl（本番）', () => {
  it('renderer の index.html は許す', () => {
    expect(
      isAppUrl(`file:///C:/Program Files/OJT/resources/app.asar/out/renderer/index.html`, {
        rendererFile: RENDERER,
      }),
    ).toBe(true);
  });

  it('同じファイルならクエリやフラグメントが付いていても許す', () => {
    const base = 'file:///C:/Program Files/OJT/resources/app.asar/out/renderer/index.html';
    expect(isAppUrl(`${base}#/session`, { rendererFile: RENDERER })).toBe(true);
    expect(isAppUrl(`${base}?x=1`, { rendererFile: RENDERER })).toBe(true);
  });

  it('大文字小文字の違うドライブ・パスでも同じファイルなら許す（Windows）', () => {
    const upper = 'file:///c:/PROGRAM FILES/OJT/resources/app.asar/out/renderer/INDEX.HTML';
    expect(isAppUrl(upper, { rendererFile: RENDERER })).toBe(true);
  });

  it.each([
    ['外部サイト', 'https://example.com/'],
    ['平文HTTP', 'http://example.com/'],
    ['別のローカルファイル', 'file:///C:/Windows/System32/calc.exe'],
    [
      '同じフォルダの別ファイル',
      'file:///C:/Program Files/OJT/resources/app.asar/out/renderer/other.html',
    ],
    ['about:blank', 'about:blank'],
    ['javascript:', 'javascript:alert(1)'],
    ['データURL', 'data:text/html,<h1>x</h1>'],
    ['UNC共有', 'file://server/share/evil.html'],
    ['空文字', ''],
  ])('%s は拒否する', (_label, url) => {
    expect(isAppUrl(url, { rendererFile: RENDERER })).toBe(false);
  });

  it('開発サーバのURLも本番では許さない', () => {
    expect(isAppUrl(DEV, { rendererFile: RENDERER })).toBe(false);
  });
});

describe('isAppUrl（開発）', () => {
  it('開発サーバと同じオリジンなら許す（HMR の経路を含む）', () => {
    expect(isAppUrl(DEV, { rendererFile: RENDERER, devUrl: DEV })).toBe(true);
    expect(isAppUrl(`${DEV}@vite/client`, { rendererFile: RENDERER, devUrl: DEV })).toBe(true);
  });

  it('別のオリジンは開発中でも拒否する', () => {
    expect(isAppUrl('http://localhost:5174/', { rendererFile: RENDERER, devUrl: DEV })).toBe(false);
    expect(isAppUrl('https://example.com/', { rendererFile: RENDERER, devUrl: DEV })).toBe(false);
  });

  it('開発サーバのURLが空文字でも壊れない', () => {
    expect(isAppUrl('https://example.com/', { rendererFile: RENDERER, devUrl: '' })).toBe(false);
  });
});
