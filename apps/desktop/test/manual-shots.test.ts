import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';

/**
 * 図の意味と原稿の対応。取扱説明書 設計 §6.2 の規則10 / §6.4。
 * **画像そのものは見ない**ので、撮影（Plan 6 Task 12）より前に走る。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const SHOTS = JSON.parse(readFileSync(join(MANUAL_DIR, 'shots.json'), 'utf8')) as Record<
  string,
  { caption: string; callouts: Array<{ n: number; label: string }> }
>;

/** 丸数字（①〜⑳）。 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** 原稿が参照している図（`![alt](images/x.png)` の x と alt と、その節）。 */
function references(): Array<{ name: string; alt: string; sectionId: string }> {
  const out: Array<{ name: string; alt: string; sectionId: string }> = [];
  for (const name of readdirSync(MANUAL_DIR)
    .filter((n) => /^\d{2}-.+\.md$/u.test(n))
    .sort()) {
    const chapterId = name.replace(/^\d{2}-/u, '').replace(/\.md$/u, '');
    let sectionTitle = '';
    for (const line of readFileSync(join(MANUAL_DIR, name), 'utf8')
      .replace(/\r\n/gu, '\n')
      .split('\n')) {
      if (line.startsWith('## ')) {
        sectionTitle = line.slice(3).trim();
        continue;
      }
      const match = /^!\[([^\]]*)\]\(images\/([A-Za-z0-9-]+)\.png\)\s*$/u.exec(line.trim());
      if (match?.[1] !== undefined && match[2] !== undefined) {
        out.push({ name: match[2], alt: match[1], sectionId: `${chapterId}/${sectionTitle}` });
      }
    }
  }
  return out;
}

const TEXT_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.text]));

describe('図の定義（設計 §6.4）', () => {
  it('defines every figure the manual refers to', () => {
    const referred = [...new Set(references().map((row) => row.name))].sort();
    expect(Object.keys(SHOTS).sort()).toEqual(referred);
  });

  it('gives every figure a caption and at least two callouts', () => {
    for (const [name, shot] of Object.entries(SHOTS)) {
      expect(shot.caption.length, `${name} の説明文がありません`).toBeGreaterThan(0);
      expect(shot.callouts.length, `${name} の吹き出しが少なすぎます`).toBeGreaterThanOrEqual(2);
    }
  });

  it('numbers the callouts from one without a gap', () => {
    for (const [name, shot] of Object.entries(SHOTS)) {
      expect(
        shot.callouts.map((callout) => callout.n),
        `${name} の吹き出しの番号が 1 から続いていません`,
      ).toEqual(shot.callouts.map((_callout, index) => index + 1));
    }
  });
});

describe('原稿と図の対応（設計 §6.2 の規則9・10）', () => {
  it('writes the caption into the alt text of every figure', () => {
    const missing: string[] = [];
    for (const row of references()) {
      const caption = SHOTS[row.name]?.caption ?? '';
      if (!row.alt.includes(caption)) missing.push(`${row.name} の説明が alt にありません`);
    }
    expect(missing).toEqual([]);
  });

  it('points at every callout by its circled number and its on-screen label', () => {
    const missing: string[] = [];
    for (const row of references()) {
      const text = TEXT_BY_ID.get(row.sectionId);
      if (text === undefined) {
        missing.push(`節 ${row.sectionId} がありません`);
        continue;
      }
      for (const callout of SHOTS[row.name]?.callouts ?? []) {
        const mark = CIRCLED[callout.n - 1] ?? '';
        if (!text.includes(mark)) missing.push(`${row.sectionId} に ${mark} が出ていません`);
        if (!text.includes(callout.label)) {
          missing.push(`${row.sectionId} に「${callout.label}」が出ていません`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
