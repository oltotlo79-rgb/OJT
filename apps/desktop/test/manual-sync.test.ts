import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildManual } from '../scripts/manual-build.mjs';
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

/** 印刷用 HTML から節ID・見出し・素の文を取り出す（生成物と同じ3つ）。 */
function sectionsOfPrintHtml(html: string): Array<{ id: string; title: string; text: string }> {
  const out: Array<{ id: string; title: string; text: string }> = [];
  const pattern =
    /<section class="manual-section" data-section-id="([^"]+)">\s*<h2>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/gu;
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

/** `manual-build.mjs` の `plainText()` と同じ規則（図を落としてタグを剥がす）。 */
function plainOf(html: string): string {
  return html
    .replace(/<figure[\s\S]*?<\/figure>/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

describe('正本と生成物', () => {
  const built = buildManual(manualFiles());

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
