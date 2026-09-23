import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chapterIdOf } from '../scripts/manual-build.mjs';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';

/**
 * 説明書の文体。取扱説明書 設計 §6.2 / 決定表#21。
 * **利用者要求「専門用語なく詳細に解説すること」を機械で数えるテスト。**
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const STYLE = JSON.parse(readFileSync(join(MANUAL_DIR, 'style.json'), 'utf8')) as {
  banned: string[];
  exempt: Record<string, string[]>;
};
const TERMS = JSON.parse(readFileSync(join(MANUAL_DIR, 'terms.json'), 'utf8')) as {
  terms: string[];
};

interface Chapter {
  id: string;
  /** 本文。章によっては囲み（```）の中を落としてある。禁止語はここで数える。 */
  prose: string;
}

/*
 * IM-3: 以前は**どの章でも**囲み（```）の中を丸ごと対象外にしていたため、囲みに入れさえすれば
 * 禁止語が何語でも通る抜け道になっていた（`09-settings.md` の引用に禁止語「JSON」が残っていた）。
 * 囲みを対象外にしてよいのは `style.json` の `exempt` に載っている章（いまは `authoring` だけ、
 * 指導者向けの課題ファイルの例）だけにし、それ以外の章では囲みの中も禁止語検査にかける。
 */
function chapters(): Chapter[] {
  return readdirSync(MANUAL_DIR)
    .filter((name) => /^\d{2}-.+\.md$/u.test(name))
    .sort()
    .map((name) => {
      const id = chapterIdOf(name);
      const text = readFileSync(join(MANUAL_DIR, name), 'utf8').replace(/\r\n/gu, '\n');
      const fencesExempt = Object.hasOwn(STYLE.exempt, id);
      return { id, prose: fencesExempt ? text.replace(/```[\s\S]*?```/gu, ' ') : text };
    });
}

/** 全章の本文を章の順につないだもの（初出の位置を見るのに使う）。 */
function wholeProse(): string {
  return chapters()
    .map((chapter) => chapter.prose)
    .join('\n');
}

describe('禁止語（決定表#21）', () => {
  const all = chapters();

  it.each(STYLE.banned)('never writes %s outside the chapters that are exempt', (word) => {
    const offenders: string[] = [];
    for (const chapter of all) {
      if ((STYLE.exempt[chapter.id] ?? []).includes(word)) continue;
      const index = chapter.prose.toLowerCase().indexOf(word.toLowerCase());
      if (index >= 0) {
        offenders.push(
          `${chapter.id}: …${chapter.prose.slice(Math.max(0, index - 30), index + 30)}…`,
        );
      }
    }
    expect(offenders, `禁止語「${word}」が残っています`).toEqual([]);
  });

  it('keeps the banned list and the exempt chapters honest', () => {
    expect(STYLE.banned.length).toBeGreaterThanOrEqual(20);
    for (const [chapterId, words] of Object.entries(STYLE.exempt)) {
      expect(all.some((chapter) => chapter.id === chapterId)).toBe(true);
      for (const word of words) expect(STYLE.banned).toContain(word);
    }
  });
});

describe('専門用語の初出（決定表#21）', () => {
  const prose = wholeProse();

  it.each(TERMS.terms)('introduces %s in bold with a plain explanation', (term) => {
    const first = prose.indexOf(term);
    expect(first, `「${term}」が本文に1度も出ていません`).toBeGreaterThanOrEqual(0);
    const context = prose.slice(Math.max(0, first - 30), first + 90);
    expect(prose.slice(first - 2, first), `初出が太字ではありません: …${context}…`).toBe('**');
    const after = prose.slice(first + term.length);
    expect(after.startsWith('**（'), `初出の直後に説明の括弧がありません: …${context}…`).toBe(true);
    const close = after.indexOf('）');
    expect(close - 3, `初出の説明が短すぎます: …${context}…`).toBeGreaterThanOrEqual(15);
  });
});

describe('用語集', () => {
  const glossary = MANUAL_SECTIONS.find((section) => section.id === 'glossary/用語集');

  it('exists', () => {
    expect(glossary).toBeDefined();
  });

  it.each(TERMS.terms)('explains %s with at least twenty characters', (term) => {
    const rows = (glossary?.html ?? '').split('<tr>');
    const row = rows.find((cells) => cells.includes(term));
    expect(row, `用語集に「${term}」の行がありません`).toBeDefined();
    const cells = (row ?? '').match(/<td>([\s\S]*?)<\/td>/gu) ?? [];
    const explanation = (cells[2] ?? '').replace(/<[^>]+>/gu, '').trim();
    expect(explanation.length, `用語集の「${term}」の説明が短すぎます`).toBeGreaterThanOrEqual(20);
  });
});

it('説明書の基本用語は自然な漢字表記を保つ', () => {
  expect(wholeProse()).not.toMatch(/もくじ|まん中|課題をえらぶ|見かた|部品をのせ|こわれ|まちがい/u);
});

it('3Dの導入と実習の両方でキューブ回転・平行移動・Alt配線を案内する', () => {
  for (const name of ['02-screens.md', '13-tutorial-modes.md', '14-tutorial-features.md']) {
    const prose = readFileSync(join(MANUAL_DIR, name), 'utf8');
    expect(prose, name).toMatch(/キューブ[\s\S]*回転/u);
    expect(prose, name).toMatch(/角度を保ったまま|角度を保って/u);
    expect(prose, name).toContain('Alt');
    expect(prose, name).not.toMatch(/空白を左ドラッグして回転|裏側や真下には回り込め/u);
  }
});
