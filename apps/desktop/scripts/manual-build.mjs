import MarkdownIt from 'markdown-it';

/**
 * 取扱説明書の正本（Markdown）を、アプリ内ヘルプ用の TypeScript と
 * 印刷用の HTML に変換する。取扱説明書 設計 §4.2。
 *
 * **入口はこの1本だけ**にする。アプリ内ヘルプと PDF が同じ呼び出しから出てくるので、
 * 「片方だけ古い」が起こりえない（利用者要求: 説明書とヘルプの内容は一致していること）。
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

/** 印刷用: 図を `<figure>` にする（説明文を図の下に出す）。 */
function toPrintHtml(html) {
  return html.replace(
    FIGURE_PARAGRAPH,
    (_all, src, alt) =>
      `<figure><img src="${src}" alt="${alt}"><figcaption>${alt}</figcaption></figure>`,
  );
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

/** 印刷用の CSS（PDF の見た目）。決定表#26 */
const PRINT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Yu Gothic UI', 'Meiryo', sans-serif; font-size: 10.5pt; line-height: 1.8; color: #14181f; }
.cover { height: 240mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
.cover h1 { font-size: 28pt; margin: 0 0 16px; }
.cover p { margin: 4px 0; font-size: 12pt; color: #3c4654; }
#toc { page-break-after: always; }
#toc h2 { font-size: 16pt; border-bottom: 2px solid #14181f; padding-bottom: 8px; }
#toc ol { padding-left: 24px; }
#toc ol ol { padding-left: 20px; color: #3c4654; }
.manual-chapter { page-break-before: always; }
.manual-chapter > h1 { font-size: 20pt; border-bottom: 2px solid #14181f; padding-bottom: 8px; margin-bottom: 16px; }
.manual-section { page-break-inside: auto; margin-bottom: 20px; }
.manual-section > h2 { font-size: 14pt; background: #eef2f7; padding: 8px 12px; margin: 20px 0 12px; }
h3 { font-size: 12pt; margin: 16px 0 8px; }
p { margin: 8px 0; }
ul, ol { margin: 8px 0; padding-left: 24px; }
li { margin: 4px 0; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: avoid; }
th, td { border: 1px solid #9aa5b4; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #eef2f7; }
code { background: #eef2f7; padding: 1px 4px; border-radius: 3px; font-family: 'Consolas', monospace; }
pre { background: #eef2f7; padding: 12px; overflow-wrap: anywhere; white-space: pre-wrap; }
figure { margin: 12px 0; page-break-inside: avoid; text-align: center; }
figure img { max-width: 100%; border: 1px solid #9aa5b4; }
figcaption { font-size: 9pt; color: #3c4654; margin-top: 4px; }
blockquote { margin: 8px 0; padding: 8px 12px; border-left: 4px solid #9aa5b4; background: #f6f8fb; }
`.trim();

/** 印刷用の HTML（表紙 ＋ 目次 ＋ 全章）。 */
function printHtmlOf(chapters, sections, builtAt) {
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
    '<div class="cover">',
    `<h1>${escape(PRODUCT_NAME)}</h1>`,
    '<p>取扱説明書</p>',
    `<p>${escape(builtAt)}</p>`,
    '</div>',
    '<nav id="toc">',
    '<h2>もくじ</h2>',
    '<ol>',
  ];
  for (const chapter of chapters) {
    parts.push(`<li>${escape(chapter.title)}`);
    parts.push('<ol>');
    for (const id of chapter.sectionIds) {
      parts.push(`<li>${escape(byId.get(id)?.title ?? '')}</li>`);
    }
    parts.push('</ol></li>');
  }
  parts.push('</ol>', '</nav>');
  for (const chapter of chapters) {
    parts.push(`<div class="manual-chapter" data-chapter-id="${escape(chapter.id)}">`);
    parts.push(`<h1>${escape(chapter.title)}</h1>`);
    for (const id of chapter.sectionIds) {
      const section = byId.get(id);
      if (section === undefined) continue;
      parts.push(`<section class="manual-section" data-section-id="${escape(section.id)}">`);
      parts.push(`<h2>${escape(section.title)}</h2>`);
      parts.push(section.printHtml);
      parts.push('</section>');
    }
    parts.push('</div>');
  }
  parts.push('</body>', '</html>', '');
  return parts.join('\n');
}

/**
 * 正本ぜんぶを変換する。
 * `files` は `{ name, text }` をファイル名の昇順に並べたもの。
 */
export function buildManual(files, builtAt = '', availableImages = undefined) {
  const chapters = [];
  const sections = [];
  for (const file of files) {
    const chapterId = chapterIdOf(file.name);
    const chapter = splitChapter(file.name, file.text);
    const sectionIds = [];
    const seen = new Set();
    for (const raw of chapter.sections) {
      if (seen.has(raw.title)) {
        throw new Error(`同じ章に同じ見出しが2つあります: ${file.name} / ${raw.title}`);
      }
      seen.add(raw.title);
      const rendered = md.render(raw.body.join('\n'));
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
        printHtml: toPrintHtml(rendered),
        text: plainText(rendered),
        hasFigure: helpHtml !== rendered,
        imageNames: imageNamesOf(rendered),
      });
      sectionIds.push(id);
    }
    chapters.push({ id: chapterId, title: chapter.title, sectionIds });
  }
  return {
    chapters,
    sections,
    helpModule: helpModuleOf(chapters, sections, files, availableImages),
    printHtml: printHtmlOf(chapters, sections, builtAt),
  };
}
