/**
 * 取扱説明書の本文。**このファイルは生成物である。手で直さない。**
 *
 * 正本は `docs/manual/*.md`。`node scripts/build-manual.mjs` が作り直す。
 * 正本との一致は `test/manual-sync.test.ts` がバイト単位で検査する（取扱説明書 設計 §4.3）。
 */

/** 章（正本のファイル1つ）。 */
export interface ManualChapter {
  id: string;
  title: string;
  sectionIds: readonly string[];
}

/** 節（章の中の見出し1つ）。ヘルプが開く単位。 */
export interface ManualSection {
  id: string;
  chapterId: string;
  chapterTitle: string;
  title: string;
  html: string;
  text: string;
  hasFigure: boolean;
  /** この節に出る図の名前（出てくる順）。 */
  imageNames: readonly string[];
}

/** 元にした正本のファイル名（並び順）。 */
export const MANUAL_SOURCES: readonly string[] = ["00-intro.md"];

/** 図の置き場所。`small` は幅400pxの縮小版、`full` は原寸。取扱説明書 設計 §7.2b */
export interface ManualImage {
  small: string;
  full: string;
}

/** 図の名前 → 置き場所。 */
export const MANUAL_IMAGES: Readonly<Record<string, ManualImage>> = {
};

/** 章の並び。 */
export const MANUAL_CHAPTERS: readonly ManualChapter[] = [
  {
    id: "intro",
    title: "はじめに",
    sectionIds: ["intro/このアプリでできること", "intro/商標と表記について"],
  },
];

/** 節の並び（章の順）。 */
export const MANUAL_SECTIONS: readonly ManualSection[] = [
  {
    id: "intro/このアプリでできること",
    chapterId: "intro",
    chapterTitle: "はじめに",
    title: "このアプリでできること",
    html: "<p>電気教育ツールは、機械保全技能検定の電気系保全作業でつかう練習盤を、パソコンの画面の中にそのまま作ったものです。実際の盤と同じように、部品をのせて、電線をつないで、電気を流して、思ったとおりに動くかどうかを確かめられます。うまく動かないときは、どこがちがうのかを画面が教えてくれます。</p>\n",
    text: "電気教育ツールは、機械保全技能検定の電気系保全作業でつかう練習盤を、パソコンの画面の中にそのまま作ったものです。実際の盤と同じように、部品をのせて、電線をつないで、電気を流して、思ったとおりに動くかどうかを確かめられます。うまく動かないときは、どこがちがうのかを画面が教えてくれます。",
    hasFigure: false,
    imageNames: [],
  },
  {
    id: "intro/商標と表記について",
    chapterId: "intro",
    chapterTitle: "はじめに",
    title: "商標と表記について",
    html: "<p>このアプリは、三菱電機・オムロン・ジェイテクト・シャープの各社が作っている機器やソフトの「書き方」をまねた練習ができます。各社の名前は、どの書き方のことかを示すためだけに使っていて、各社との提携や後援をあらわすものではありません。</p>\n",
    text: "このアプリは、三菱電機・オムロン・ジェイテクト・シャープの各社が作っている機器やソフトの「書き方」をまねた練習ができます。各社の名前は、どの書き方のことかを示すためだけに使っていて、各社との提携や後援をあらわすものではありません。",
    hasFigure: false,
    imageNames: [],
  },
];
