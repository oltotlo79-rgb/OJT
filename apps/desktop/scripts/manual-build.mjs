import { PAPER_TOKENS } from '../src/shared/paper-style.mjs';
import MarkdownIt from 'markdown-it';
import { anchorIdOf, chapterAnchorIdOf } from '../src/renderer/help/anchor-id.mjs';

/**
 * 取扱説明書の正本（Markdown）を、アプリ内ヘルプ用の TypeScript と
 * 印刷用の HTML に変換する。取扱説明書 設計 §4.2 ／ Phase 7 設計 §6.2・§6.3。
 *
 * **入口はこの1本だけ**にする。アプリ内ヘルプと PDF が同じ呼び出しから出てくるので、
 * 「片方だけ古い」が起こりえない（利用者要求: 説明書とヘルプの内容は一致していること）。
 *
 * 章番号（`第3章`）・節番号（`3.2`）・図番号（`図 3-2`）は**ここで機械が振る**。
 * 正本の Markdown には書かない（章を足し引きしても番号を振り直さなくてよい）。
 */

/** アプリ内ヘルプが出す縮小版の幅[px]。決定表#9（利用者の決定 2026-09-20） */
export const HELP_IMAGE_WIDTH = 400;

/** 製品名。`i18n/ja.ts` の `APP_NAME` と同じ値だが、素の JS からは読めないのでここにも置く。 */
export const PRODUCT_NAME = '電気教育ツール';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

/*
 * 図の書き出し方を決め打ちにする。既定の書き出しは属性の順番が版によって変わりうるので、
 * あとで正規表現で拾えるように `<img src="…" alt="…">` の形に固定する。
 */
md.renderer.rules['image'] = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token === undefined) return '';
  const src = token.attrGet('src') ?? '';
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  return `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}">`;
};

/** ファイル名から章ID（`04-mode-c1.md` → `mode-c1`）。 */
export function chapterIdOf(fileName) {
  const match = /^\d{2}-(.+)\.md$/u.exec(fileName);
  const id = match?.[1];
  if (id === undefined) throw new Error(`章のファイル名が規則に合いません: ${fileName}`);
  return id;
}

/** 図だけの段落（`![説明](images/x.png)` が1行だけの段落）。 */
const FIGURE_PARAGRAPH = /<p><img src="([^"]*)" alt="([^"]*)"><\/p>/gu;

/**
 * 注意箱の3種。正本の記法は `> **注意** …` / `> **ヒント** …` / `> **やってはいけない** …`
 * で、**先頭語だけ**で見分ける（Phase 7 設計 §6.2）。印は CSS の `::before` で出すので、
 * 素の文（検索と一致検査が見る `plainText()`）は変わらない。
 */
const NOTICE_KINDS = [
  { word: 'やってはいけない', kind: 'forbid' },
  { word: '注意', kind: 'caution' },
  { word: 'ヒント', kind: 'tip' },
];

/** 引用のうち、先頭語が注意箱のものに印を付ける（アプリ内ヘルプと PDF の両方に効く）。 */
function withNotices(html) {
  return html.replace(/<blockquote>\s*<p><strong>([^<]+)<\/strong>/gu, (all, word) => {
    const found = NOTICE_KINDS.find((notice) => notice.word === word);
    if (found === undefined) return all;
    return all.replace('<blockquote>', `<blockquote class="notice notice-${found.kind}">`);
  });
}

/**
 * 印刷用: 図を `<figure>` にする（説明文を図の下に出す）。
 * 図には章ごとの通し番号（`図 3-2`）を振る。`counter` は章の中で持ち回る入れ物。
 */
function toPrintHtml(html, chapterNo, counter) {
  // 図を挟んだ手順の開始番号を、印刷用の丸数字にも引き継ぐ。
  const numbered = html.replace(
    /<ol start="(\d+)">/gu,
    (_all, start) =>
      `<ol start="${start}" style="counter-reset: step ${String(Number(start) - 1)}">`,
  );
  return numbered.replace(FIGURE_PARAGRAPH, (_all, src, alt) => {
    counter.n += 1;
    const label = `図 ${String(chapterNo)}-${String(counter.n)}`;
    return (
      `<figure><img src="${src}" alt="${alt}">` +
      `<figcaption><span class="fig-no">${label}</span>${alt}</figcaption></figure>`
    );
  });
}

/**
 * アプリ内ヘルプ用: 図を「押すと原寸が開くボタン」にする。
 * **`src` は書かない**——束ねた図の URL は Vite が決めるので、画面側が `MANUAL_IMAGES` から
 * 差し込む（取扱説明書 設計 §4.2 の規則5／本プラン 決定表 P16）。
 */
function toHelpHtml(html) {
  return html.replace(FIGURE_PARAGRAPH, (_all, src, alt) => {
    const name = imageNameOf(src);
    return (
      `<figure class="manual-figure">` +
      `<button type="button" data-manual-image="${name}">` +
      `<img data-manual-image="${name}" alt="${alt}" loading="lazy" width="${String(HELP_IMAGE_WIDTH)}">` +
      `</button><figcaption>${alt}</figcaption></figure>`
    );
  });
}

/** `images/home.png` → `home`。 */
function imageNameOf(src) {
  const match = /^images\/([A-Za-z0-9-]+)\.png$/u.exec(src);
  const name = match?.[1];
  if (name === undefined) throw new Error(`図の名前が規則に合いません: ${src}`);
  return name;
}

/** その節に出る図の名前を、出てくる順に並べる。 */
function imageNamesOf(html) {
  return [...html.matchAll(/<img src="images\/([A-Za-z0-9-]+)\.png"/gu)].map((match) => match[1]);
}

/** HTML から素の文を作る（図は落とす）。検索と一致検査はこれを見る。 */
export function plainText(html) {
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

/** 1章を「章題」と「節の並び」に割る。 */
function splitChapter(fileName, source) {
  const lines = source.replace(/\r\n/gu, '\n').split('\n');
  const first = lines[0] ?? '';
  if (!first.startsWith('# ')) {
    throw new Error(`章の1行目が「# 章題」ではありません: ${fileName}`);
  }
  const title = first.slice(2).trim();
  const sections = [];
  let current;
  // コードフェンス（```）の中の行は見出し扱いしない（Minor#3）。「## 」で始まる例示行が
  // 説明中に出ても、そこで節が割れてしまわないようにする。
  let inFence = false;
  lines.forEach((line, index) => {
    if (index === 0) return;
    const lineNo = index + 1;
    if (/^```/u.test(line.trimStart())) {
      inFence = !inFence;
    } else if (!inFence && line.startsWith('## ')) {
      if (current !== undefined) sections.push(current);
      current = { title: line.slice(3).trim(), body: [], lines: [] };
      return;
    }
    if (current === undefined) {
      if (line.trim() !== '') {
        throw new Error(`章題と最初の見出しの間に本文があります: ${fileName}`);
      }
      return;
    }
    current.body.push(line);
    current.lines.push(lineNo);
  });
  if (current !== undefined) sections.push(current);
  if (sections.length === 0) throw new Error(`節がありません: ${fileName}`);
  return { title, sections };
}

/** アプリ内ヘルプ用の TypeScript を組む。 */
function helpModuleOf(chapters, sections, files, availableImages) {
  const s = (value) => JSON.stringify(value);
  // その説明書に出る図を、名前の順に1回ずつ（決定表 P16）
  const imageNames = [...new Set(sections.flatMap((section) => section.imageNames))].sort();
  /*
   * まだ撮っていない図は読み込まない（決定表 P13）。`availableImages` を渡さなければ
   * 全部あるものとして扱う（単体テスト用）。撮るまでは `{ small: '', full: '' }` が入り、
   * 引き出しは `src` が空の図を描かない。
   */
  const has = (name) => availableImages === undefined || availableImages.includes(name);
  const loaded = imageNames.filter((name) => has(name));
  const imports = loaded.flatMap((name) => [
    `import full_${name.replace(/-/gu, '_')} from '@manual-images/${name}.png';`,
    `import small_${name.replace(/-/gu, '_')} from '@manual-images/small/${name}.png';`,
  ]);
  const lines = [
    '/**',
    ' * 取扱説明書の本文。**このファイルは生成物である。手で直さない。**',
    ' *',
    ' * 正本は `docs/manual/*.md`。`node scripts/build-manual.mjs` が作り直す。',
    ' * 正本との一致は `test/manual-sync.test.ts` がバイト単位で検査する（取扱説明書 設計 §4.3）。',
    ' */',
    '',
    '/** 章（正本のファイル1つ）。 */',
    'export interface ManualChapter {',
    '  id: string;',
    '  title: string;',
    '  sectionIds: readonly string[];',
    '}',
    '',
    '/** 節（章の中の見出し1つ）。ヘルプが開く単位。 */',
    'export interface ManualSection {',
    '  id: string;',
    '  chapterId: string;',
    '  chapterTitle: string;',
    '  title: string;',
    '  html: string;',
    '  text: string;',
    '  hasFigure: boolean;',
    '  /** この節に出る図の名前（出てくる順）。 */',
    '  imageNames: readonly string[];',
    '}',
    '',
    '/** 元にした正本のファイル名（並び順）。 */',
    `export const MANUAL_SOURCES: readonly string[] = [${files.map((f) => s(f.name)).join(', ')}];`,
    '',
    '/** 図の置き場所。`small` は幅400pxの縮小版、`full` は原寸。取扱説明書 設計 §7.2b */',
    'export interface ManualImage {',
    '  small: string;',
    '  full: string;',
    '}',
    '',
    '/** 図の名前 → 置き場所。 */',
    'export const MANUAL_IMAGES: Readonly<Record<string, ManualImage>> = {',
    ...imageNames.map((name) =>
      has(name)
        ? `  ${s(name)}: { small: small_${name.replace(/-/gu, '_')}, full: full_${name.replace(/-/gu, '_')} },`
        : `  ${s(name)}: { small: '', full: '' },`,
    ),
    '};',
    '',
    '/** 章の並び。 */',
    'export const MANUAL_CHAPTERS: readonly ManualChapter[] = [',
  ];
  for (const chapter of chapters) {
    lines.push('  {');
    lines.push(`    id: ${s(chapter.id)},`);
    lines.push(`    title: ${s(chapter.title)},`);
    lines.push(`    sectionIds: [${chapter.sectionIds.map((id) => s(id)).join(', ')}],`);
    lines.push('  },');
  }
  lines.push(
    '];',
    '',
    '/** 節の並び（章の順）。 */',
    'export const MANUAL_SECTIONS: readonly ManualSection[] = [',
  );
  for (const section of sections) {
    lines.push('  {');
    lines.push(`    id: ${s(section.id)},`);
    lines.push(`    chapterId: ${s(section.chapterId)},`);
    lines.push(`    chapterTitle: ${s(section.chapterTitle)},`);
    lines.push(`    title: ${s(section.title)},`);
    lines.push(`    html: ${s(section.html)},`);
    lines.push(`    text: ${s(section.text)},`);
    lines.push(`    hasFigure: ${section.hasFigure ? 'true' : 'false'},`);
    lines.push(`    imageNames: [${section.imageNames.map((name) => s(name)).join(', ')}],`);
    lines.push('  },');
  }
  lines.push('];', '');
  // 図の読み込みは冒頭（説明の囲みの直後）に置く
  const head = lines.indexOf('') + 1;
  return [
    ...lines.slice(0, head),
    ...imports,
    ...(imports.length > 0 ? [''] : []),
    ...lines.slice(head),
  ].join('\n');
}

/**
 * 印刷用の CSS（PDF の見た目）。Phase 7 設計 §6.2 の表のとおり。
 *
 * 紙の体裁で効くのは4つ。① 版面（`@page`）と1行の字数、② 見出しの段差、
 * ③ ページの切れ目（見出しの直後で切らない・図と表を割らない）、④ 注意箱と手順の印。
 * 地色は薄く、罫は細くする（家庭用のプリンタで刷ってもつぶれない）。
 */
const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
${PAPER_TOKENS}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  max-width: 150mm;
  font-family: 'Yu Gothic UI', 'Meiryo', sans-serif;
  font-size: 10.5pt;
  line-height: 1.8;
  color: var(--ink);
  word-break: normal;
  overflow-wrap: anywhere;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1, h2, h3 { letter-spacing: .02em; page-break-after: avoid; break-after: avoid; }

/* 表紙 */
.cover { height: 250mm; display: flex; flex-direction: column; page-break-after: always; }
.cover-band { height: 5mm; background: var(--accent); margin-bottom: 44mm; }
.cover-kind { margin: 0 0 6px; font-size: 12pt; color: var(--sub); letter-spacing: .3em; }
.cover-title { font-size: 28pt; margin: 0; line-height: 1.3; font-weight: 700; }
.cover-rule { width: 60mm; height: 2px; background: var(--ink); margin: 10mm 0; }
.cover-meta { margin: 0; font-size: 11pt; color: var(--sub); }
.cover-howto { margin-top: auto; border: 1px solid var(--hair); background: #fafcff; padding: 10px 14px; }
.cover-howto-title { font-size: 12pt; font-weight: 700; margin: 0 0 6px; }
.cover-howto ol { margin: 0; padding-left: 20px; font-size: 10pt; color: var(--sub); }
.cover-howto ol > li { margin: 2px 0; }
.cover-help { margin: 8px 0 0; font-size: 10pt; color: var(--sub); }

/* もくじ */
#toc { page-break-after: always; }
#toc > h1 { font-size: 20pt; margin: 0 0 8mm; padding-bottom: 8px; border-bottom: 2px solid var(--ink); }
#toc ol { list-style: none; margin: 0; padding: 0; }
#toc a { color: inherit; text-decoration: none; display: flex; align-items: baseline; }
#toc .toc-chapter > a { font-size: 11pt; font-weight: 700; margin-top: 10px; }
#toc .toc-sections { padding-left: 14mm; }
#toc .toc-sections a { font-size: 10pt; color: var(--sub); }
#toc .toc-no { flex: none; min-width: 16mm; }
#toc .toc-sections .toc-no { min-width: 12mm; }
#toc .toc-text { flex: none; }
#toc .toc-leader { flex: 1 1 auto; border-bottom: 1px dotted var(--rule); margin: 0 4px 4px; }

/* 章・節・見出し */
.manual-chapter { page-break-before: always; }
/* 章番号は h1 の中に置く。しおり（PDF outline）にも「第1章 …」と出るようにするため。 */
.chapter-no { font-size: 13pt; color: var(--accent); margin-right: 8px; }
.manual-chapter > h1 { font-size: 20pt; margin: 0 0 20px; padding-bottom: 8px; border-bottom: 2px solid var(--ink); }
.manual-section { margin-bottom: 18px; }
.manual-section > h2 { font-size: 14pt; background: var(--tint); border-left: 4px solid var(--accent); padding: 7px 12px; margin: 22px 0 12px; }
.manual-section > h2 .num { color: var(--accent); margin-right: 6px; }
h3 { font-size: 12pt; border-left: 3px solid var(--rule); padding-left: 8px; margin: 16px 0 8px; }
p { margin: 8px 0; }
ul { margin: 8px 0; padding-left: 22px; }
li { margin: 4px 0; }
a { color: var(--accent); }

/* 手順（丸数字風の連番） */
.manual-section ol { counter-reset: step; list-style: none; margin: 10px 0; padding-left: 26px; }
.manual-section ol > li { position: relative; margin: 6px 0; }
.manual-section ol > li::before {
  counter-increment: step;
  content: counter(step);
  position: absolute;
  left: -26px;
  top: .3em;
  width: 17px;
  height: 17px;
  line-height: 17px;
  text-align: center;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 8.5pt;
  font-weight: 700;
}

/* 表と囲み */
table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: auto; font-size: 10pt; line-height: 1.55; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid var(--rule); padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: var(--tint); }
table[data-manual-table="problem-index"] { font-size: 9pt; }
table[data-manual-table="problem-index"] :is(th, td) { padding: 5px; }
table[data-manual-table="problem-index"] :is(th, td):nth-child(-n+4) { white-space: nowrap; }
code { background: var(--tint); padding: 1px 4px; border-radius: 3px; font-family: 'Consolas', monospace; font-size: 9.5pt; }
pre { background: var(--tint); border-left: 3px solid var(--hair); padding: 10px 12px; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 9.5pt; line-height: 1.6; page-break-inside: avoid; }

/* 図 */
figure { margin: 14px 0; page-break-inside: avoid; text-align: center; }
figure img { max-width: 100%; border: 1px solid var(--rule); }
figcaption { font-size: 9pt; color: var(--sub); margin-top: 5px; text-align: center; }
figcaption .fig-no { font-weight: 700; color: var(--ink); margin-right: 6px; }

/* 注意箱（3種） */
blockquote { margin: 12px 0; padding: 8px 12px; border-left: 4px solid var(--rule); background: #f6f8fb; page-break-inside: avoid; }
blockquote p { margin: 4px 0; }
blockquote.notice { position: relative; padding-left: 40px; }
blockquote.notice::before {
  position: absolute;
  left: 12px;
  top: 10px;
  width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  border-radius: 50%;
  color: #fff;
  font-size: 10pt;
  font-weight: 700;
}
.notice-caution { border-left-color: var(--caution); background: #fdf7ec; }
.notice-caution::before { content: '!'; background: var(--caution); }
.notice-tip { border-left-color: var(--tip); background: #eef4fb; }
.notice-tip::before { content: 'i'; background: var(--tip); }
.notice-forbid { border-left-color: var(--forbid); background: #fdf0ef; }
.notice-forbid::before { content: '\\00d7'; background: var(--forbid); }
.notice > p:first-child > strong:first-child { display: block; margin-bottom: 2px; }
.notice-caution > p:first-child > strong:first-child { color: var(--caution); }
.notice-tip > p:first-child > strong:first-child { color: var(--tip); }
.notice-forbid > p:first-child > strong:first-child { color: var(--forbid); }
`.trim();

/** 表紙（1ページ目）。Phase 7 設計 §6.2。 */
function coverOf(builtAt, edition, escape) {
  return [
    '<div class="cover">',
    '<div class="cover-band"></div>',
    '<p class="cover-kind">取扱説明書</p>',
    `<p class="cover-title">${escape(PRODUCT_NAME)}</p>`,
    '<div class="cover-rule"></div>',
    ...(edition === '' ? [] : [`<p class="cover-meta">${escape(edition)}</p>`]),
    ...(builtAt === '' ? [] : [`<p class="cover-meta">${escape(builtAt)} 発行</p>`]),
    '<div class="cover-howto">',
    '<p class="cover-howto-title">この説明書の読み方</p>',
    '<ol>',
    '<li>はじめて使う方は「はじめに」から順に読んでください。</li>',
    '<li>使い方だけ知りたい方は、もくじの行を押すとその節へ飛べます。</li>',
    '<li>言葉が分からないときは、うしろの「用語集」を引いてください。</li>',
    '</ol>',
    '</div>',
    '<p class="cover-help">困ったら <code>F1</code> を押してください。いま開いている画面の説明が、アプリの中に出ます。</p>',
    '</div>',
  ];
}

/** もくじ（2ページ目以降）。章・節の行はリンクで、行末に点線のリーダを引く。 */
function tocOf(chapters, byId, escape) {
  const parts = ['<nav id="toc">', '<h1>もくじ</h1>', '<ol class="toc-chapters">'];
  chapters.forEach((chapter, index) => {
    const chapterNo = index + 1;
    parts.push('<li class="toc-chapter">');
    parts.push(
      `<a href="#${chapterAnchorIdOf(chapter.id)}">` +
        `<span class="toc-no">第${String(chapterNo)}章</span>` +
        `<span class="toc-text">${escape(chapter.title)}</span>` +
        '<span class="toc-leader"></span></a>',
    );
    parts.push('<ol class="toc-sections">');
    chapter.sectionIds.forEach((id, sectionIndex) => {
      const section = byId.get(id);
      if (section === undefined) return;
      parts.push(
        `<li><a href="#${anchorIdOf(id)}">` +
          `<span class="toc-no">${String(chapterNo)}.${String(sectionIndex + 1)}</span>` +
          `<span class="toc-text">${escape(section.title)}</span>` +
          '<span class="toc-leader"></span></a></li>',
      );
    });
    parts.push('</ol>');
    parts.push('</li>');
  });
  parts.push('</ol>', '</nav>');
  return parts;
}

/** 印刷用の HTML（表紙 ＋ もくじ ＋ 全章）。 */
function printHtmlOf(chapters, sections, builtAt, edition) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const escape = (text) => md.utils.escapeHtml(text);
  const parts = [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escape(PRODUCT_NAME)} 取扱説明書</title>`,
    `<style>${PRINT_CSS}</style>`,
    '</head>',
    '<body>',
    ...coverOf(builtAt, edition, escape),
    ...tocOf(chapters, byId, escape),
  ];
  chapters.forEach((chapter, index) => {
    const chapterNo = index + 1;
    parts.push(`<div class="manual-chapter" data-chapter-id="${escape(chapter.id)}">`);
    parts.push(
      `<h1 id="${chapterAnchorIdOf(chapter.id)}">` +
        `<span class="chapter-no">第${String(chapterNo)}章</span> ${escape(chapter.title)}</h1>`,
    );
    chapter.sectionIds.forEach((id, sectionIndex) => {
      const section = byId.get(id);
      if (section === undefined) return;
      parts.push(`<section class="manual-section" data-section-id="${escape(section.id)}">`);
      parts.push(
        `<h2 id="${anchorIdOf(id)}">` +
          `<span class="num">${String(chapterNo)}.${String(sectionIndex + 1)}</span> ` +
          `${escape(section.title)}</h2>`,
      );
      parts.push(section.printHtml);
      parts.push('</section>');
    });
    parts.push('</div>');
  });
  parts.push('</body>', '</html>', '');
  return parts.join('\n');
}

/**
 * 断片識別子を素の形に戻す。markdown-it はリンクの行き先を `encodeURI` するので、
 * 日本語の見出しへのリンクは `#%E7%B7%B4…` の形になる。見出しの `id` は素の日本語なので、
 * 引き当てる前にここでそろえる（ブラウザも PDF もそろえた上で照合している）。
 */
export function decodeFragment(fragment) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * 本文中の相互参照（`[→ 3.2 電線をつなぐ](#sec-…)`）の行き先を検査する。
 * 行き先の無いリンクは、PDF でもアプリ内ヘルプでも「押しても何も起きない」になり、
 * 読む人には壊れていることが分からない。**原稿のファイル名を添えてここで止める。**
 */
function checkCrossReferences(sources, anchors) {
  for (const source of sources) {
    for (const match of source.html.matchAll(/href="#([^"]*)"/gu)) {
      const target = decodeFragment(match[1] ?? '');
      if (!anchors.has(target)) {
        throw new Error(
          `本文のリンクの行き先がありません: ${source.file} / ${source.title} → #${target}`,
        );
      }
    }
  }
}

/**
 * 正本ぜんぶを変換する。
 * `files` は `{ name, text }` をファイル名の昇順に並べたもの。
 * `edition` は表紙に出す版（`v1.1.0`）。省略すると版の行を出さない。
 */
export function buildManual(files, builtAt = '', availableImages = undefined, edition = '') {
  const chapters = [];
  const sections = [];
  const sources = [];
  for (const file of files) {
    const chapterId = chapterIdOf(file.name);
    const chapter = splitChapter(file.name, file.text);
    const sectionIds = [];
    const seen = new Set();
    const chapterNo = chapters.length + 1;
    const figures = { n: 0 };
    for (const raw of chapter.sections) {
      if (seen.has(raw.title)) {
        throw new Error(`同じ章に同じ見出しが2つあります: ${file.name} / ${raw.title}`);
      }
      seen.add(raw.title);
      let rendered = withNotices(md.render(raw.body.join('\n')));
      if (chapterId === 'tutorial-features' && raw.title === '課題の索引') {
        rendered = rendered.replace('<table>', '<table data-manual-table="problem-index">');
      }
      const helpHtml = toHelpHtml(rendered);
      /*
       * IM-10: 図は必ず「段落に図が1つだけ」の形でなければならない（`FIGURE_PARAGRAPH`）。
       * 文中・箇条書き・表の中に書かれた図はその正規表現に当たらず、`src="images/…"` が
       * `helpHtml` にそのまま残る。Vite が解決しない生の相対パスなので、アプリ内ヘルプでは
       * 画像が割れる。黙って通さず、原稿のファイル名と行番号を添えて止める。
       */
      if (helpHtml.includes('src="images/')) {
        const badIndex = raw.body.findIndex((line) => /!\[[^\]]*\]\(images\/[^)]*\)/u.test(line));
        const lineNo = badIndex >= 0 ? raw.lines[badIndex] : undefined;
        throw new Error(
          `図が段落の外にあります（図はその段落に1つだけにしてください）: ` +
            `${file.name}${lineNo === undefined ? '' : `:${String(lineNo)}`} / ${raw.title}`,
        );
      }
      const id = `${chapterId}/${raw.title}`;
      sections.push({
        id,
        chapterId,
        chapterTitle: chapter.title,
        title: raw.title,
        html: helpHtml,
        printHtml: toPrintHtml(rendered, chapterNo, figures),
        text: plainText(rendered),
        hasFigure: helpHtml !== rendered,
        imageNames: imageNamesOf(rendered),
      });
      sources.push({ file: file.name, title: raw.title, html: helpHtml });
      sectionIds.push(id);
    }
    chapters.push({ id: chapterId, title: chapter.title, sectionIds });
  }
  /*
   * 断片識別子は記号を落として作る（`anchor-id.mjs`）ので、記号だけが違う見出しが
   * 同じ `id` になりうる。そうなるともくじの2行が同じところへ飛ぶ（読む人は気づけない）。
   */
  const anchors = new Set();
  for (const chapter of chapters) {
    const anchor = chapterAnchorIdOf(chapter.id);
    if (anchors.has(anchor)) throw new Error(`章の見出しの id が重なります: ${anchor}`);
    anchors.add(anchor);
  }
  for (const section of sections) {
    const anchor = anchorIdOf(section.id);
    if (anchors.has(anchor)) {
      throw new Error(`見出しの id が重なります: ${anchor}（${section.id}）`);
    }
    anchors.add(anchor);
  }
  checkCrossReferences(sources, anchors);
  return {
    chapters,
    sections,
    helpModule: helpModuleOf(chapters, sections, files, availableImages),
    printHtml: printHtmlOf(chapters, sections, builtAt, edition),
  };
}
