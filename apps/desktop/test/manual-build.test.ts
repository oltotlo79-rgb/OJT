import { describe, expect, it } from 'vitest';
import { buildManual, chapterIdOf, plainText } from '../scripts/manual-build.mjs';

/**
 * 正本（Markdown）の変換。取扱説明書 設計 §4.2。
 * ここで縛るのは「節の切り出し」「素の文」「図の二重出力」「壊れた原稿を黙って通さないこと」。
 */

const INTRO = [
  '# はじめに',
  '',
  '## このアプリでできること',
  '',
  'このアプリは、電気の練習盤をパソコンの画面の中で動かせるようにしたものです。',
  '',
  '![ホームの画面。4つの練習が並んでいます。](images/home.png)',
  '',
  '## 画面の呼び名',
  '',
  'いちばん上の帯を「上の帯」と呼びます。',
  '',
  '| 名前 | 場所 |',
  '|---|---|',
  '| 上の帯 | 画面のいちばん上 |',
  '',
].join('\n');

function build() {
  return buildManual([{ name: '00-intro.md', text: INTRO }]);
}

describe('章とファイル名', () => {
  it('takes the chapter id from the file name', () => {
    expect(chapterIdOf('04-mode-c1.md')).toBe('mode-c1');
  });

  it('refuses a file name without the two-digit prefix', () => {
    expect(() => chapterIdOf('intro.md')).toThrow('章のファイル名が規則に合いません');
  });
});

describe('節の切り出し', () => {
  it('names the chapter from the first heading', () => {
    expect(build().chapters).toEqual([
      {
        id: 'intro',
        title: 'はじめに',
        sectionIds: ['intro/このアプリでできること', 'intro/画面の呼び名'],
      },
    ]);
  });

  it('keeps the heading out of the section html', () => {
    const section = build().sections[0];
    expect(section?.title).toBe('このアプリでできること');
    expect(section?.html).not.toContain('<h2');
  });

  it('renders a table', () => {
    expect(build().sections[1]?.html).toContain('<table>');
  });

  it('refuses a chapter whose first line is not a heading', () => {
    expect(() => buildManual([{ name: '00-intro.md', text: 'ここに本文\n' }])).toThrow(
      '章の1行目が',
    );
  });

  it('refuses two sections with the same heading in one chapter', () => {
    const text = '# はじめに\n\n## 同じ\n\nあ\n\n## 同じ\n\nい\n';
    expect(() => buildManual([{ name: '00-intro.md', text }])).toThrow('同じ見出しが2つ');
  });

  it('refuses a chapter with no section', () => {
    expect(() => buildManual([{ name: '00-intro.md', text: '# はじめに\n' }])).toThrow(
      '節がありません',
    );
  });

  it('does not split on a heading-looking line inside a code fence (Minor#3)', () => {
    const text = [
      '# はじめに',
      '',
      '## 図',
      '',
      '説明の前',
      '',
      '```',
      '## これは見出しではない',
      '```',
      '',
      '説明の後',
      '',
    ].join('\n');
    const built = buildManual([{ name: '00-intro.md', text }]);
    expect(built.chapters).toEqual([{ id: 'intro', title: 'はじめに', sectionIds: ['intro/図'] }]);
    expect(built.sections[0]?.html).toContain('これは見出しではない');
  });
});

describe('図の扱い（決定表#9。利用者の決定 2026-09-20）', () => {
  it('gives the in-app help a figure it can fill in later', () => {
    const section = build().sections[0];
    expect(section?.hasFigure).toBe(true);
    expect(section?.imageNames).toEqual(['home']);
    // 束ねた図の URL は Vite が決めるので、生成物には `src` を書かない（決定表 P16）
    expect(section?.html).toContain('data-manual-image="home"');
    expect(section?.html).toContain('loading="lazy"');
    expect(section?.html).toContain('width="400"');
    expect(section?.html).toContain('<button type="button"');
    expect(section?.html).not.toContain('src=');
  });

  it('keeps the figure for the printed manual', () => {
    const section = build().sections[0];
    expect(section?.printHtml).toContain('<img src="images/home.png"');
    expect(section?.printHtml).toContain('<figcaption>');
  });

  it('shows the same figures in the same order on both sides', () => {
    const section = build().sections[0];
    const printed = [
      ...(section?.printHtml ?? '').matchAll(/<img src="images\/([^."]+)\.png"/gu),
    ].map((match) => match[1]);
    expect(printed).toEqual(section?.imageNames);
  });

  it('refuses a figure whose file name breaks the rule', () => {
    // 図の名前は Task 12 の撮影と `shots.json` の鍵になるので、原稿の時点で形を縛る
    const text = '# はじめに\n\n## 図\n\n![説明](images/ホーム.png)\n';
    expect(() => buildManual([{ name: '00-intro.md', text }])).toThrow(
      '図の名前が規則に合いません',
    );
  });

  it('refuses a figure written in the middle of a paragraph (IM-10)', () => {
    // 5行目: 文中に書かれた図。`FIGURE_PARAGRAPH`（段落に図が1つだけ）に当たらないので
    // 黙って `src="images/…"` が生成物に残って壊れる前に、ファイル名と行番号を添えて止める
    const text = [
      '# はじめに',
      '',
      '## 図',
      '',
      '文の途中に ![説明](images/home.png) 図です。',
    ].join('\n');
    expect(() => buildManual([{ name: '00-intro.md', text }])).toThrow(
      /図が段落の外にあります.*00-intro\.md:5/u,
    );
  });

  it('refuses a figure written inside a list item', () => {
    const text = ['# はじめに', '', '## 図', '', '- ![説明](images/home.png)'].join('\n');
    expect(() => buildManual([{ name: '00-intro.md', text }])).toThrow('図が段落の外にあります');
  });

  it('keeps the figure out of the plain text', () => {
    const section = build().sections[0];
    expect(section?.text).not.toContain('ホームの画面');
    expect(section?.text).toContain('練習盤をパソコンの画面の中で動かせる');
  });
});

describe('素の文', () => {
  it('drops tags and unescapes entities', () => {
    expect(plainText('<p>a &amp; b</p><p>c</p>')).toBe('a & b c');
  });
});

describe('生成物', () => {
  it('writes a TypeScript module the app can import', () => {
    const { helpModule } = build();
    expect(helpModule).toContain('export const MANUAL_SECTIONS');
    expect(helpModule).toContain('export const MANUAL_CHAPTERS');
    expect(helpModule).toContain('export const MANUAL_SOURCES');
    expect(helpModule).toContain('export const MANUAL_IMAGES');
    // 図は Vite の別名で読み込む（取扱説明書 設計 §7.2b）
    expect(helpModule).toContain("from '@manual-images/small/home.png'");
    expect(helpModule).toContain("from '@manual-images/home.png'");
    expect(helpModule).toContain('"00-intro.md"');
    // 生成物にはアプリ用の本文だけを入れる（印刷用の本文は PDF 側にしかない）
    expect(helpModule).not.toContain('printHtml');
    expect(helpModule.endsWith('\n')).toBe(true);
  });

  it('writes one printable html with a cover, a table of contents and every section', () => {
    const { printHtml } = build();
    expect(printHtml).toContain('<!doctype html>');
    expect(printHtml).toContain('電気教育ツール');
    expect(printHtml).toContain('id="toc"');
    expect(printHtml).toContain('data-section-id="intro/このアプリでできること"');
    expect(printHtml).toContain('<img src="images/home.png"');
  });
});
