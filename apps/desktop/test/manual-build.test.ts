import { describe, expect, it } from 'vitest';
import { buildManual, chapterIdOf, decodeFragment, plainText } from '../scripts/manual-build.mjs';

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

describe('説明書の再現性', () => {
  it('同じ原稿と発行日から同じHTML・ヘルプを作る', () => {
    const files = [{ name: '00-intro.md', text: INTRO }];
    expect(buildManual(files, '2026-09-20')).toEqual(buildManual(files, '2026-09-20'));
    expect(buildManual(files, '2026-09-20').printHtml).toContain('2026-09-20 発行');
  });
  it('発行日の指定がなければ表紙に勝手な日付を入れない', () => {
    expect(build().printHtml).not.toMatch(/\d{4}-\d{2}-\d{2} 発行/);
  });
});

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

/*
 * ここから下は Task 34（説明書PDFの体裁ともくじのリンク）。Phase 7 設計 §6.2・§6.3。
 * 番号・リンク・注意箱・版面は、どれも「読む人が迷わない」ための決まりなので機械で縛る。
 */

/** 2章ぶんの原稿（章番号・節番号・図番号の連番を見るため）。 */
const TWO_CHAPTERS = [
  { name: '00-intro.md', text: INTRO },
  {
    name: '01-setup.md',
    text: [
      '# パソコンに入れる',
      '',
      '## 入れかた',
      '',
      '手順は次のとおりです。',
      '',
      '![入れている途中の画面。](images/home.png)',
      '',
      '![入れ終わった画面。](images/list.png)',
      '',
      '## 消しかた',
      '',
      '> **注意** 設定も一緒に消えます。',
      '',
      '> **ヒント** 持ち運び版はフォルダごと消せます。',
      '',
      '> **やってはいけない** 動かしたまま消さないでください。',
      '',
      '> ここは引用です。注意箱ではありません。',
      '',
    ].join('\n'),
  },
];

describe('章番号・節番号・図番号（設計 §6.2）', () => {
  const { printHtml } = buildManual(TWO_CHAPTERS, '2026-09-20', undefined, 'v1.1.0');

  it('numbers the chapters in order and puts the number inside the heading (so the bookmark shows it)', () => {
    expect(printHtml).toContain('<span class="chapter-no">第1章</span> はじめに</h1>');
    expect(printHtml).toContain('<span class="chapter-no">第2章</span> パソコンに入れる</h1>');
  });

  it('numbers the sections within their chapter', () => {
    const numbers = [...printHtml.matchAll(/<h2[^>]*><span class="num">([\d.]+)<\/span>/gu)].map(
      (match) => match[1],
    );
    expect(numbers).toEqual(['1.1', '1.2', '2.1', '2.2']);
  });

  it('numbers the figures within their chapter and writes the number into the caption', () => {
    const captions = [
      ...printHtml.matchAll(/<figcaption><span class="fig-no">([^<]+)<\/span>/gu),
    ].map((match) => match[1]);
    expect(captions).toEqual(['図 1-1', '図 2-1', '図 2-2']);
    expect(printHtml).toContain('<span class="fig-no">図 2-2</span>入れ終わった画面。');
  });

  it('keeps the numbers out of the in-app help (the drawer has its own table of contents)', () => {
    const { sections } = buildManual(TWO_CHAPTERS);
    expect(sections[0]?.html).not.toContain('fig-no');
    expect(sections[0]?.html).not.toContain('class="num"');
  });
});

describe('もくじのリンクと見出しの id（設計 §6.3）', () => {
  const { printHtml } = buildManual(TWO_CHAPTERS, '2026-09-20', undefined, 'v1.1.0');

  it('makes every row of the table of contents a link', () => {
    expect(printHtml).toContain('<a href="#ch-intro">');
    expect(printHtml).toContain('<a href="#sec-intro--このアプリでできること">');
    expect(printHtml).toContain('<span class="toc-no">第1章</span>');
    expect(printHtml).toContain('<span class="toc-no">1.1</span>');
    // 行末のリーダ（点線）
    expect(printHtml).toContain('<span class="toc-leader"></span>');
  });

  it('gives every heading the id its link points at', () => {
    const ids = new Set([...printHtml.matchAll(/ id="([^"]+)"/gu)].map((match) => match[1]));
    const targets = [...printHtml.matchAll(/href="#([^"]+)"/gu)].map((match) =>
      decodeFragment(match[1] ?? ''),
    );
    expect(targets.length).toBe(2 + 4);
    expect(targets.filter((target) => !ids.has(target))).toEqual([]);
  });

  it('never gives two headings the same id', () => {
    const ids = [...printHtml.matchAll(/ id="((?:sec|ch)-[^"]+)"/gu)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses two headings that differ only in punctuation (they would share one id)', () => {
    const text = '# はじめに\n\n## 電線をつなぐ・外す\n\nあ\n\n## 電線をつなぐ外す\n\nい\n';
    expect(() => buildManual([{ name: '00-intro.md', text }])).toThrow('id が重なります');
  });

  it('lets the prose link to another section', () => {
    const text = [
      '# はじめに',
      '',
      '## 読む順番',
      '',
      'くわしくは [→ 1.2 つぎの節](#sec-intro--つぎの節) を見てください。',
      '',
      '## つぎの節',
      '',
      'ここです。',
      '',
    ].join('\n');
    const built = buildManual([{ name: '00-intro.md', text }]);
    expect(built.sections[0]?.html).toContain('href="#sec-intro--');
  });

  it('refuses a link that points at a heading that is not there', () => {
    const text =
      '# はじめに\n\n## 読む順番\n\n[→ 無い節](#sec-intro--ありません) を見てください。\n';
    expect(() => buildManual([{ name: '00-intro.md', text }])).toThrow(
      /本文のリンクの行き先がありません.*00-intro\.md/u,
    );
  });
});

describe('注意箱（設計 §6.2）', () => {
  const built = buildManual(TWO_CHAPTERS, '2026-09-20', undefined, 'v1.1.0');

  it('tells the three kinds apart by the first word', () => {
    expect(built.printHtml).toContain('<blockquote class="notice notice-caution">');
    expect(built.printHtml).toContain('<blockquote class="notice notice-tip">');
    expect(built.printHtml).toContain('<blockquote class="notice notice-forbid">');
  });

  it('leaves an ordinary quotation alone', () => {
    expect(built.printHtml).toContain('<blockquote>\n<p>ここは引用です。');
  });

  it('marks the boxes in the in-app help too, and never changes the plain text', () => {
    const section = built.sections[3];
    expect(section?.html).toContain('notice-caution');
    expect(section?.text).toContain('注意 設定も一緒に消えます。');
  });
});

describe('表紙と版面（設計 §6.2）', () => {
  const { printHtml } = buildManual(TWO_CHAPTERS, '2026-09-20', undefined, 'v1.1.0');

  it('prints the product name, the edition, the date, how to read it and the F1 line', () => {
    expect(printHtml).toContain('<p class="cover-title">電気教育ツール</p>');
    expect(printHtml).toContain('v1.1.0');
    expect(printHtml).toContain('2026-09-20 発行');
    expect(printHtml).toContain('この説明書の読み方');
    expect(printHtml).toContain('<code>F1</code>');
    // 表紙に見出しタグは使わない（しおりの先頭に表紙の行を出さないため）
    expect(printHtml.slice(0, printHtml.indexOf('<nav id="toc">'))).not.toContain('<h1');
  });

  it('lays the page out the way the design table says', () => {
    expect(printHtml).toContain('@page { size: A4; margin: 18mm 16mm 20mm; }');
    expect(printHtml).toContain('max-width: 150mm');
    expect(printHtml).toContain('font-size: 10.5pt');
    expect(printHtml).toContain('line-height: 1.8');
    expect(printHtml).toContain("font-family: 'Yu Gothic UI', 'Meiryo', sans-serif");
    expect(printHtml).toContain('page-break-after: avoid');
    expect(printHtml).toContain('thead { display: table-header-group; }');
    expect(printHtml).toContain('page-break-inside: avoid');
  });
});
