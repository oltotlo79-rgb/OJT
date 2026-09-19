import type { SessionMode } from '../../shared/ipc.js';
import type { AssembleViewMode } from '../app/store.js';
import { MANUAL_SECTIONS, type ManualSection } from './manual-content.js';

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
  list: 'screens/課題をえらぶ',
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
export function searchManual(query: string, limit: number = MAX_HELP_HITS): HelpHit[] {
  const needle = normalize(query);
  if (needle === '') return [];
  const hits: HelpHit[] = [];
  for (const section of MANUAL_SECTIONS) {
    if (hits.length >= limit) break;
    const haystack = NORMALIZED_HAYSTACK.get(section.id) ?? '';
    if (!haystack.includes(needle)) continue;
    hits.push({
      sectionId: section.id,
      title: section.title,
      chapterTitle: section.chapterTitle,
      excerpt: excerptOf(section, query),
    });
  }
  return hits;
}

/**
 * 当たったところの前後を切り出す。
 * 正規化した文字列では元の位置がずれるので、**元の文**の上で素直に探し直す。
 * 元の文で見つからない（全角・半角の違いなどで正規化したときだけ当たった）ときは
 * 節の書き出しを返す。
 */
function excerptOf(section: ManualSection, query: string): string {
  const trimmed = query.trim();
  const at = trimmed === '' ? -1 : section.text.indexOf(trimmed);
  if (at < 0) return section.text.slice(0, EXCERPT_PAD * 2);
  const from = Math.max(0, at - EXCERPT_PAD);
  const to = Math.min(section.text.length, at + trimmed.length + EXCERPT_PAD);
  return `${from > 0 ? '…' : ''}${section.text.slice(from, to)}${to < section.text.length ? '…' : ''}`;
}
