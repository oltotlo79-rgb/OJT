import type { SessionMode } from '../../shared/ipc.js';
import type { AssembleViewMode } from '../app/store.js';
import { anchorIdOf, chapterAnchorIdOf } from './anchor-id.mjs';
import { MANUAL_CHAPTERS, MANUAL_SECTIONS, type ManualSection } from './manual-content.js';

/**
 * ヘルプの引き出しが使う純関数。取扱説明書 設計 §5.2 / 決定表#18・#19。
 *
 * 3D にもストアにも触らない。「いまどの画面か」も「どの節を探し当てたか」も
 * ここで決めるので、画面を描かずに単体テストできる（§12.2 の純粋関数化と同じ趣旨）。
 */

/** ヘルプから見た画面の種類。 */
export type HelpScreenId =
  | 'home'
  | 'list'
  | 'settings'
  | 'assemble'
  | 'schematic'
  | 'inspect-parts'
  | 'inspect-repair'
  | 'plc'
  | 'result';

/** 画面ごとに最初に開く節。取扱説明書 設計 §5.2 の表。 */
export const HELP_SECTION_BY_SCREEN: Readonly<Record<HelpScreenId, string>> = {
  home: 'intro/このアプリでできること',
  list: 'screens/課題を選ぶ',
  settings: 'settings/設定の画面',
  assemble: 'mode-b/回路を組み立てる',
  schematic: 'schematic/回路図を描く',
  'inspect-parts': 'mode-c1/部品を点検する',
  'inspect-repair': 'mode-c2/回路を点検して直す',
  plc: 'mode-d/PLCの課題を進める',
  result: 'screens/結果の画面',
};

/** 検索で返す件数の上限。決定表#19 */
export const MAX_HELP_HITS = 20;

/** 当たったところの前後に付ける文字数。 */
const EXCERPT_PAD = 30;

/**
 * いまどの画面を見ているか。
 * `route` だけでは決まらない（`session` は4モードあり、モードBは回路図ビューに切り替わる）。
 */
export function currentHelpScreen(
  route: 'home' | 'list' | 'session' | 'result' | 'settings',
  mode: SessionMode | undefined,
  assembleView: AssembleViewMode,
): HelpScreenId {
  if (route === 'home') return 'home';
  if (route === 'list') return 'list';
  if (route === 'settings') return 'settings';
  if (route === 'result') return 'result';
  switch (mode) {
    case 'assemble':
      return assembleView === 'schematic' ? 'schematic' : 'assemble';
    case 'inspect-parts':
      return 'inspect-parts';
    case 'inspect-repair':
      return 'inspect-repair';
    case 'plc':
      return 'plc';
    default:
      // 課題を開かずにセッション画面へ来た（あり得ないが、黙って落ちないようにする）
      return 'home';
  }
}

const BY_ID = new Map<string, ManualSection>(
  MANUAL_SECTIONS.map((section) => [section.id, section]),
);

/** 節ID から節を引く。 */
export function sectionById(id: string): ManualSection | undefined {
  return BY_ID.get(id);
}

/** 画面に対応する節ID（無ければ目次の最初の節。§9 のエラー処理）。 */
export function defaultSectionId(screen: HelpScreenId): string {
  const id = HELP_SECTION_BY_SCREEN[screen];
  if (BY_ID.has(id)) return id;
  return MANUAL_SECTIONS[0]?.id ?? '';
}

/**
 * 比べる前にそろえる。全角と半角、大文字と小文字、空白のあるなしで
 * 見つからないことがないようにする（決定表#19）。
 */
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/** 検索で当たった1件。 */
export interface HelpHit {
  sectionId: string;
  title: string;
  chapterTitle: string;
  excerpt: string;
  /**
   * `excerpt` の中で実際に当たった文字列の開始位置（見つからなければ -1）。
   * ヘルプ引き出し 設計 §6.4: 検索結果の一致箇所を太字にするのに使う。
   */
  excerptMatchStart: number;
  /** 一致した文字列の長さ（`excerptMatchStart` が -1 のときは 0）。 */
  excerptMatchLength: number;
}

/*
 * Minor#11: `MANUAL_SECTIONS` は生成物で、実行中に変わらない。正規化した本文（検索対象）を
 * 打鍵のたびに全部の節ぶん作り直すと無駄なので、モジュール読み込み時に1回だけ作って使い回す
 * （節数は原稿が増えるたびに変わるので、ここでは数を書かない。レビュー Minor#2）。
 */
const NORMALIZED_HAYSTACK = new Map<string, string>(
  MANUAL_SECTIONS.map((section) => [section.id, normalize(`${section.title} ${section.text}`)]),
);

/**
 * 見出しと本文の素の文に対する部分一致。
 * 当たった位置の前後を切り出して一覧に出す。
 */
export function searchManual(
  query: string,
  limit: number = MAX_HELP_HITS,
  mode?: SessionMode,
): HelpHit[] {
  const needles = query.normalize('NFKC').trim().split(/\s+/u).map(normalize).filter(Boolean);
  if (needles.length === 0) return [];
  return MANUAL_SECTIONS.filter((section) =>
    needles.every((needle) => (NORMALIZED_HAYSTACK.get(section.id) ?? '').includes(needle)),
  )
    .map((section) => ({
      section,
      score: needles.reduce(
        (score, needle) => score + (normalize(section.title).includes(needle) ? 10 : 0),
        mode !== undefined &&
          section.id.startsWith(`${HELP_SECTION_BY_SCREEN[mode].split('/')[0]}/`)
          ? 3
          : 0,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ section }) => {
      const excerpt = excerptOf(
        section,
        needles.find((needle) => normalize(section.text).includes(needle)) ?? needles[0]!,
      );
      return {
        sectionId: section.id,
        title: section.title,
        chapterTitle: section.chapterTitle,
        excerpt: excerpt.text,
        excerptMatchStart: excerpt.matchStart,
        excerptMatchLength: excerpt.matchLength,
      };
    });
}

/** 検索の優先順を保ち、最初に現れた章の順に結果をまとめる。 */
export function groupHitsByChapter(
  hits: readonly HelpHit[],
): ReadonlyArray<{ chapterTitle: string; hits: readonly HelpHit[] }> {
  const groups: Array<{ chapterTitle: string; hits: HelpHit[] }> = [];
  for (const hit of hits) {
    const last = groups.find((group) => group.chapterTitle === hit.chapterTitle);
    if (last !== undefined) last.hits.push(hit);
    else groups.push({ chapterTitle: hit.chapterTitle, hits: [hit] });
  }
  return groups;
}

/** 切り出した抜粋と、その中での一致位置。 */
interface Excerpt {
  text: string;
  matchStart: number;
  matchLength: number;
}

/** 正規化した文字と元の文字の位置を対応付け、一致箇所を含む抜粋を返す。 */
function excerptOf(section: ManualSection, query: string): Excerpt {
  const source = section.text;
  let normalized = '';
  const starts: number[] = [],
    ends: number[] = [];
  let offset = 0;
  for (const character of source) {
    const mapped = normalize(character);
    normalized += mapped;
    for (let index = 0; index < mapped.length; index += 1) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    offset += character.length;
  }
  const needle = normalize(query),
    match = normalized.indexOf(needle);
  if (match < 0 || needle === '')
    return { text: source.slice(0, EXCERPT_PAD * 2), matchStart: -1, matchLength: 0 };
  const at = starts[match]!,
    end = ends[match + needle.length - 1]!;
  const from = Math.max(0, at - EXCERPT_PAD),
    to = Math.min(source.length, end + EXCERPT_PAD);
  const prefix = from > 0 ? '…' : '';
  return {
    text: prefix + source.slice(from, to) + (to < source.length ? '…' : ''),
    matchStart: prefix.length + at - from,
    matchLength: end - at,
  };
}

/**
 * 節の並び（章→節の順）の中で1つ前／後ろの節。ヘルプ引き出し 設計 §6.4:
 * 「節の末尾に『← 前の節／次の節 →』」。`MANUAL_CHAPTERS[].sectionIds` の並びをそのまま使う。
 */
const FLAT_SECTION_ORDER: readonly string[] = MANUAL_CHAPTERS.flatMap(
  (chapter) => chapter.sectionIds,
);

export function adjacentSectionId(sectionId: string, direction: -1 | 1): string | undefined {
  const at = FLAT_SECTION_ORDER.indexOf(sectionId);
  if (at < 0) return undefined;
  return FLAT_SECTION_ORDER[at + direction];
}

/**
 * 節ID・章ID を、本文中の相互参照リンクが使う断片識別子へ写す（取扱説明書 設計 §6.3・§6.4）。
 * 例: `"mode-b/電線をつなぐ・外す"` → `"sec-mode-b--電線をつなぐ外す"`。
 * 中身は `anchor-id.mjs`（素の JavaScript）にある。PDF を組む `scripts/manual-build.mjs` は
 * 素の Node から走るので TypeScript を読めない。**同じ1本の関数**を両方から呼ぶことで、
 * PDF とアプリ内ヘルプの `id` が食い違わないようにしてある（Task 34）。
 */
export { anchorIdOf, chapterAnchorIdOf };

/*
 * 章への相互参照（`#ch-…`）は、その章の最初の節へ着地させる。PDF では章の扉へ飛ぶが、
 * アプリ内ヘルプには「章」を開く単位が無いためである（引き出しは節を出す）。
 */
const ANCHOR_TO_SECTION_ID = new Map<string, string>([
  ...MANUAL_CHAPTERS.flatMap((chapter) => {
    const first = chapter.sectionIds[0];
    return first === undefined ? [] : [[chapterAnchorIdOf(chapter.id), first] as [string, string]];
  }),
  ...MANUAL_SECTIONS.map((section): [string, string] => [anchorIdOf(section.id), section.id]),
]);

/**
 * 断片識別子（`href="#…"` の `#` を除いた部分）から節IDを引く。
 * 本文中の `<a href="#sec-…">`（Task 34 で入る）を `HelpDrawer` の `onProseClick` が
 * `showSection()` へ渡すのに使う。当たらなければ `undefined`（外部URLや壊れたリンク）。
 */
export function sectionIdForAnchor(fragment: string): string | undefined {
  return ANCHOR_TO_SECTION_ID.get(fragment);
}
