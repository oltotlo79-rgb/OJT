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
 * 原稿（Plan 6 Task 3・4）は全13章そろっている（Minor#10）。
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
  it('points every screen at a section that actually exists (Minor#10: 全章そろったので決め打ちで検査する)', () => {
    for (const [screen, id] of Object.entries(HELP_SECTION_BY_SCREEN)) {
      expect(sectionById(id), `${screen} の節 ${id} がありません`).toBeDefined();
    }
  });

  it('falls back to the first section when the id is unknown', () => {
    expect(defaultSectionId('home')).toBe(HELP_SECTION_BY_SCREEN.home);
    expect(sectionById('ありません/ありません')).toBeUndefined();
  });
});

describe('検索（決定表#19）', () => {
  // Minor#10: 章がそろったので、電気の実在の言葉（自己保持）へ決め打ちに戻せる
  it('finds a section by a word in its body', () => {
    const hits = searchManual('自己保持');
    expect(hits.length).toBeGreaterThan(0);
    expect(sectionById(hits[0]?.sectionId ?? '')).toBeDefined();
    expect(hits[0]?.excerpt).toContain('自己保持');
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
    // 全13章そろって93節あるので（Minor#10）、上限より節数が多いことを確かめてから頭打ちを見る
    expect(MANUAL_SECTIONS.length).toBeGreaterThan(MAX_HELP_HITS);
    // 「の」はほとんどの節に出る
    expect(searchManual('の').length).toBeLessThanOrEqual(MAX_HELP_HITS);
    expect(searchManual('の', 1).length).toBe(1);
  });
});
