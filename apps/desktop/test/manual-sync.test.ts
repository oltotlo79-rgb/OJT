import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildManual, decodeFragment, plainText } from '../scripts/manual-build.mjs';
import { anchorIdOf, chapterAnchorIdOf } from '../src/renderer/help/anchor-id.mjs';
import { sectionIdForAnchor } from '../src/renderer/help/help-model.js';
import {
  MANUAL_CHAPTERS,
  MANUAL_SECTIONS,
  MANUAL_SOURCES,
} from '../src/renderer/help/manual-content.js';

/**
 * 正本と生成物の一致。取扱説明書 設計 §4.3 / 決定表#2・#12。
 * **利用者要求「取扱説明書とヘルプの内容は一致していること」を機械で保証するテスト。**
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const GENERATED = join(APP_ROOT, 'src', 'renderer', 'help', 'manual-content.ts');

/** 改行コードをそろえる（Windows と Linux で生成物が違って見えないように。決定表 P7）。 */
function lf(text: string): string {
  return text.replace(/\r\n/gu, '\n');
}

function manualFiles(): Array<{ name: string; text: string }> {
  return readdirSync(MANUAL_DIR)
    .filter((name) => /^\d{2}-.+\.md$/u.test(name))
    .sort()
    .map((name) => ({ name, text: lf(readFileSync(join(MANUAL_DIR, name), 'utf8')) }));
}

/**
 * 撮り終わっている図の名前（`scripts/build-manual.mjs` と同じ判定）。決定表 P13。
 * ここを `buildManual()` の既定（引数省略＝全部あるものとして扱う）に任せると、
 * 図をまだ1枚も撮っていない段階（Task 12 より前）で「生成物と一致しない」という
 * 誤った失敗になる（原稿はまだ無い図を参照してよい。§6.2 規則6）。
 */
function availableImages(): string[] | undefined {
  const imageDir = join(MANUAL_DIR, 'images');
  if (!existsSync(imageDir)) return [];
  return readdirSync(imageDir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.replace(/\.png$/u, ''))
    .sort();
}

/**
 * `manual-build.mjs` の `plainText()` を再利用する（IM-9 に添えて Minor#5 も直す）。
 * 前は同じ規則をここへ手写ししていたので、`plainText()` 側だけ直した抜け漏れが
 * 両辺に同時に乗り、テストが独立に落ちなかった。
 */
const plainOf = plainText;

/**
 * 印刷用 HTML から節ID・見出し・素の文を取り出す（生成物と同じ3つ）。
 * 見出しには Task 34 で `id`（`#sec-…`）と節番号（`<span class="num">3.2</span>`）が付いたので、
 * どちらも読み飛ばして**見出しの文字だけ**を取り出す。
 */
function sectionsOfPrintHtml(html: string): Array<{ id: string; title: string; text: string }> {
  const out: Array<{ id: string; title: string; text: string }> = [];
  const pattern =
    /<section class="manual-section" data-section-id="([^"]+)">\s*<h2[^>]*>(?:<span class="num">[^<]*<\/span> )?([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/gu;
  let match = pattern.exec(html);
  while (match !== null) {
    const [, id, title, body] = match;
    if (id !== undefined && title !== undefined && body !== undefined) {
      out.push({ id, title, text: plainOf(body) });
    }
    match = pattern.exec(html);
  }
  return out;
}

/** 印刷用 HTML から、節ごとに出てくる図の名前を出てくる順に取り出す。IM-9。 */
function imageNamesOfPrintHtml(html: string): Array<{ id: string; images: string[] }> {
  const out: Array<{ id: string; images: string[] }> = [];
  const pattern =
    /<section class="manual-section" data-section-id="([^"]+)">\s*<h2[^>]*>[\s\S]*?<\/h2>([\s\S]*?)<\/section>/gu;
  let match = pattern.exec(html);
  while (match !== null) {
    const [, id, body] = match;
    if (id !== undefined && body !== undefined) {
      const images = [...body.matchAll(/<img src="images\/([^."]+)\.png"/gu)].map(
        (imageMatch) => imageMatch[1] ?? '',
      );
      out.push({ id, images });
    }
    match = pattern.exec(html);
  }
  return out;
}

describe('正本と生成物', () => {
  const built = buildManual(manualFiles(), '', availableImages());

  it('has a generated module identical to a fresh build of the manual', () => {
    expect(lf(readFileSync(GENERATED, 'utf8'))).toBe(built.helpModule);
  });

  it('remembers exactly the chapters that exist today', () => {
    expect([...MANUAL_SOURCES]).toEqual(manualFiles().map((file) => file.name));
    expect(MANUAL_CHAPTERS.map((c) => c.id)).toEqual(built.chapters.map((c) => c.id));
  });

  it('gives the in-app help and the printed manual the same headings and the same words', () => {
    const printed = sectionsOfPrintHtml(built.printHtml);
    const inApp = MANUAL_SECTIONS.map((s) => ({ id: s.id, title: s.title, text: s.text }));
    expect(printed).toEqual(inApp);
  });

  it('shows the same figures, in the same order, in the help and in the pdf', () => {
    // 利用者の決定（2026-09-20）: 図もヘルプに出すので、図の一致も検査する（決定表#12 ③）
    const printed = built.sections.map((section) => ({
      id: section.id,
      images: section.imageNames,
    }));
    const inApp = MANUAL_SECTIONS.map((section) => ({
      id: section.id,
      images: [...section.imageNames],
    }));
    expect(inApp).toEqual(printed);
    /*
     * IM-9: 上の2つはどちらも同じ `buildManual()` の戻り値（`built.sections` と、それを
     * 書き出しただけの `MANUAL_SECTIONS`）から来ており、検査1（バイト一致）が既に
     * 保証している範囲なので独立に落ちない。ここでは `built.printHtml` という**別の出力**を
     * 正規表現で読み直し、そちらとも突き合わせる（`toPrintHtml()` が図を落としても緑のままに
     * ならないようにする）。
     */
    const fromPrintHtml = imageNamesOfPrintHtml(built.printHtml).map((section) => ({
      id: section.id,
      images: section.images,
    }));
    expect(fromPrintHtml).toEqual(printed);
  });

  /*
   * Task 34: PDF の見出しの `id` と、アプリ内ヘルプが本文リンクを引くときの断片識別子は
   * **同じ1本の関数**（`anchor-id.mjs`）から出る。ここが食い違うと、本文の相互参照が
   * PDF では飛べてアプリでは何も起きない、という気づきにくい壊れ方をする。
   */
  it('gives the pdf headings and the in-app help exactly the same anchors', () => {
    for (const section of MANUAL_SECTIONS) {
      const anchor = anchorIdOf(section.id);
      expect(built.printHtml, `${section.id} の見出しに id がありません`).toContain(
        `<h2 id="${anchor}">`,
      );
      expect(sectionIdForAnchor(anchor), `#${anchor} がアプリ内で節に当たりません`).toBe(
        section.id,
      );
    }
    for (const chapter of MANUAL_CHAPTERS) {
      const anchor = chapterAnchorIdOf(chapter.id);
      expect(built.printHtml).toContain(`<h1 id="${anchor}">`);
      expect(sectionIdForAnchor(anchor)).toBe(chapter.sectionIds[0]);
    }
  });

  it('points every link in the printed manual at a heading that exists', () => {
    const ids = new Set([...built.printHtml.matchAll(/ id="([^"]+)"/gu)].map((m) => m[1]));
    const targets = [...built.printHtml.matchAll(/href="#([^"]+)"/gu)].map((m) =>
      decodeFragment(m[1] ?? ''),
    );
    expect(targets.length).toBeGreaterThanOrEqual(MANUAL_SECTIONS.length);
    expect(targets.filter((target) => !ids.has(target))).toEqual([]);
  });

  it('gives every section a unique id', () => {
    const ids = MANUAL_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists every section of every chapter exactly once', () => {
    const fromChapters = MANUAL_CHAPTERS.flatMap((c) => [...c.sectionIds]);
    expect(fromChapters).toEqual(MANUAL_SECTIONS.map((s) => s.id));
  });
});
