import { describe, expect, it } from 'vitest';
import {
  currentHelpScreen,
  defaultSectionId,
  HELP_SECTION_BY_SCREEN,
  MAX_HELP_HITS,
  searchManual,
  sectionById,
} from '../src/renderer/help/help-model.js';
import { MANUAL_SECTIONS, type ManualSection } from '../src/renderer/help/manual-content.js';

/**
 * ヘルプの引き出しが使う純関数。取扱説明書 設計 §5.2 / 決定表#18・#19。
 *
 * 原稿（Plan 6 Task 3・4）はこのテストと並行して育つ（実装バッチB）。
 * このファイルを書いた時点では `docs/manual/` に `00-intro.md` しかなく、
 * `MANUAL_SECTIONS` はまだ「はじめに」章の2節しか持たない。そのため、検索と
 * 画面対応のテストは特定の章・語を決め打ちにせず、**そのとき実在する節**から
 * 動かして確かめる（実装者への MERGE 注意「節の一覧は作業中に増えうる」）。
 */

function firstSection(): ManualSection {
  const section = MANUAL_SECTIONS[0];
  if (!section) throw new Error('MANUAL_SECTIONS が空です（Task 2 の生成物を確認）');
  return section;
}

describe('いまの画面（決定表#18）', () => {
  it('maps the home screen', () => {
    expect(currentHelpScreen('home', undefined, 'board')).toBe('home');
  });

  it('maps the list and the settings screens', () => {
    expect(currentHelpScreen('list', undefined, 'board')).toBe('list');
    expect(currentHelpScreen('settings', undefined, 'board')).toBe('settings');
  });

  it('maps the result screen', () => {
    expect(currentHelpScreen('result', 'assemble', 'board')).toBe('result');
  });

  it('tells the three modes of a session apart', () => {
    expect(currentHelpScreen('session', 'inspect-parts', 'board')).toBe('inspect-parts');
    expect(currentHelpScreen('session', 'inspect-repair', 'board')).toBe('inspect-repair');
    expect(currentHelpScreen('session', 'plc', 'board')).toBe('plc');
  });

  it('switches to the schematic when mode B shows the drawing', () => {
    expect(currentHelpScreen('session', 'assemble', 'board')).toBe('assemble');
    expect(currentHelpScreen('session', 'assemble', 'split')).toBe('assemble');
    expect(currentHelpScreen('session', 'assemble', 'schematic')).toBe('schematic');
  });

  it('falls back to the home screen when no problem is open', () => {
    expect(currentHelpScreen('session', undefined, 'board')).toBe('home');
  });
});

describe('画面と節の対応', () => {
  it('points every screen whose chapter has already landed at a section that exists', () => {
    // 章はまだ全部そろっていない（Task 3・4 と並行）。生成物に来ている章だけを検査する。
    const landedChapterIds = new Set(MANUAL_SECTIONS.map((section) => section.chapterId));
    for (const [screen, id] of Object.entries(HELP_SECTION_BY_SCREEN)) {
      const chapterId = id.split('/')[0] ?? '';
      if (!landedChapterIds.has(chapterId)) continue;
      expect(sectionById(id), `${screen} の節 ${id} がありません`).toBeDefined();
    }
  });

  it('falls back to the first section when the id is unknown', () => {
    expect(defaultSectionId('home')).toBe(HELP_SECTION_BY_SCREEN.home);
    expect(sectionById('ありません/ありません')).toBeUndefined();
  });
});

describe('検索（決定表#19）', () => {
  it('finds a section by a word in its body', () => {
    const sample = firstSection();
    const word = sample.text.slice(0, Math.min(6, sample.text.length));
    const hits = searchManual(word);
    expect(hits.length).toBeGreaterThan(0);
    expect(sectionById(hits[0]?.sectionId ?? '')).toBeDefined();
    expect(hits[0]?.excerpt).toContain(word);
  });

  it('finds a section by its heading', () => {
    const sample = firstSection();
    const hits = searchManual(sample.title);
    expect(hits.some((hit) => hit.sectionId === sample.id)).toBe(true);
  });

  it('ignores case, width and spaces', () => {
    const wide = searchManual('ＰＬＣ');
    const narrow = searchManual('plc');
    expect(wide.map((h) => h.sectionId)).toEqual(narrow.map((h) => h.sectionId));
  });

  it('returns nothing for an empty query or a word that is not there', () => {
    expect(searchManual('')).toEqual([]);
    expect(searchManual('   ')).toEqual([]);
    expect(searchManual('そんな言葉はありません')).toEqual([]);
  });

  it('never returns more hits than the cap', () => {
    expect(searchManual('の').length).toBeLessThanOrEqual(MAX_HELP_HITS);
    // 「の」はほとんどの節に出るので、節が2つ以上あれば小さい上限で頭打ちを確かめられる
    // （`MANUAL_SECTIONS.length` が `MAX_HELP_HITS` を超えるのは全章がそろってから）。
    if (MANUAL_SECTIONS.length >= 2) {
      expect(searchManual('の', 1).length).toBe(1);
    }
  });
});
