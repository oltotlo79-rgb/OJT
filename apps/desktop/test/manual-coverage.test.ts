import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectTestIds } from '../scripts/feature-inventory.mjs';
import { JA } from '../src/renderer/i18n/ja.js';
import { MSG } from '../src/shared/messages.js';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';

/**
 * 機能の網羅。取扱説明書 設計 §6.3 / 決定表#22・#23。
 * **利用者要求「すべての機能を使用者目線で詳細に解説すること」を機械で数えるテスト。**
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE = JSON.parse(
  readFileSync(join(resolve(APP_ROOT, '../../docs/manual'), 'coverage.json'), 'utf8'),
) as {
  controls: ReadonlyArray<{
    testid: string;
    screen?: string;
    label?: string;
    section?: string;
    internal?: string;
  }>;
  keys: ReadonlyArray<{ key: string; screen: string; action: string; section: string }>;
  gestures: ReadonlyArray<{ name: string; screen: string; action: string; section: string }>;
  messages: ReadonlyArray<{ key: string; section: string }>;
};

const TEXT_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.text]));
const HTML_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.html]));

/** 手順として番号付きで書くことを求める節。設計 §6.2 の規則7。 */
const PROCEDURE_SECTIONS = [
  'setup/インストーラで入れる',
  'setup/持ち運び版を使う',
  'setup/初回に出る青い画面',
  'mode-b/回路を組み立てる',
  'mode-c1/部品を点検する',
  'mode-c2/回路を点検して直す',
  'mode-d/PLCの課題を進める',
  'tutorial-modes/この章の使い方',
  'tutorial-modes/回路を組み立てる（モードB）',
  'tutorial-modes/部品を点検する（モードC1）',
  'tutorial-modes/回路を点検して直す（モードC2）',
  'tutorial-modes/PLCでプログラムを作る（モードD）',
  'tutorial-modes/うまくいかないときの戻り道',
  'tutorial-features/3Dの見方',
  'tutorial-features/端子をつなぐ',
  'tutorial-features/部品を置く・外す・交換する',
  'tutorial-features/タイマの設定',
  'tutorial-features/電源の入れ方と順序',
  'tutorial-features/テスターの使い方',
  'tutorial-features/回路図ヒントの読み方',
  'tutorial-features/タイムチャートの読み方',
  'tutorial-features/ラダーの記号を置く',
  'tutorial-features/変換とモニタ',
  'tutorial-features/表記（メーカー）の切替',
  'tutorial-features/作業ファイルの保存と読込',
  'tutorial-features/設定',
  'tutorial-features/ヘルプと説明書',
  'tutorial-features/初回ガイドの出し直し',
  'tutorial-features/課題の索引',
];

/**
 * メッセージの葉を `JA.error.banner` のような名前で集める。
 * 値が文字列のものだけ本文との一致を求める（関数は引数で文が変わるため名前だけ見る）。
 */
function messageLeaves(): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const walk = (prefix: string, value: unknown): void => {
    if (typeof value === 'string') {
      out.set(prefix, value);
      return;
    }
    if (typeof value === 'function') {
      out.set(prefix, undefined);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(`${prefix}.${key}`, child);
    }
  };
  walk('JA.error', JA.error);
  walk('JA.hazard', JA.hazard);
  walk('JA.staticCheck', JA.staticCheck);
  walk('JA.disabledReason', JA.disabledReason);
  walk('JA.routeReason', JA.routeReason);
  walk('JA.mismatchReason', JA.mismatchReason);
  walk('MSG', MSG);
  return out;
}

/*
 * IM-5: これまでの検査は「`label` が説明書の節に出ているか」だけを見ていて、その `label` が
 * **画面の実際の文言かどうか**は誰も見ていなかった（`shortcuts-note` の label が
 * `JA.ladder.shortcutNote` の断片の書き換えに追随せず古いままでも、説明書側さえ同じ古い語で
 * 書けば緑のままになる、という抜け道）。ここでは `label` が画面のコード（`i18n/ja.ts` /
 * `src/shared/messages.ts` / `src/renderer/**` の部品）の中にリテラルとして実在するかを見る。
 * `help/manual-content.ts` は説明書から作った生成物なので、これを混ぜると「説明書に書いてあるか」
 * を見るだけの無意味な検査になってしまう。除外する。
 */
const RENDERER_DIR = resolve(APP_ROOT, 'src', 'renderer');
const SHARED_MESSAGES_FILE = resolve(APP_ROOT, 'src', 'shared', 'messages.ts');
const GENERATED_MANUAL_FILE = resolve(RENDERER_DIR, 'help', 'manual-content.ts');

function rendererSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...rendererSourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/u.test(entry.name)) continue;
    if (path === GENERATED_MANUAL_FILE) continue; // 生成物。画面の実装ではない
    out.push(path);
  }
  return out;
}

function rendererSourceHaystack(): string {
  const files = [...rendererSourceFiles(RENDERER_DIR), SHARED_MESSAGES_FILE];
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

/*
 * `coverage.json` の `label` は普段は本当にボタン・見出しの文字そのもの（例:
 * 「既定に戻す」）だが、次の testid だけは**押しても見えても文字が無い場所の名前**か
 * **中身が実行時に決まる欄の呼び名**を `label` に書いている（`role="presentation"` の
 * 覆い、`error` の中身がゾッドやライブラリの実行結果になる欄、折りたたみの `<summary>` の
 * 呼び名など）。実測でこの13件だけは renderer のソースのどこにも逐語で存在しない
 * （`internal` の理由文と同じ「説明のための言葉」で、画面のliteralな文字ではない）。
 * 消してはいけない情報なので、ここに明記したうえで別扱いにする（節への一致は
 * 上の「writes the on-screen label…」がすべての行に対して変わらず見ている）。
 */
const DESCRIPTIVE_NOT_LITERAL_LABELS: ReadonlySet<string> = new Set([
  'chart-backdrop', // 覆い（`role="presentation"`）。押すと閉じるが文字は無い
  'schematic-backdrop', // 同上（回路図ヒントの覆い）
  'device-error', // 中身は `parseDevice()` が返すエラー文（デバイスごとに違う）
  'diagnosis-note', // 判定表の備考の要約（本文は行ごとに違う）
  'il-issues', // 命令語リストの書き出せなかった理由の一覧（欄の呼び名）
  'ladder-grid', // ラダーの格子そのものの呼び名（文字は無い）
  'ladder-workspace', // ラダー編集の欄全体の呼び名
  'output-summary', // 出力ウィンドウの折りたたみ `<summary>` の呼び名
  '{}-summary', // 同上（IDが課題ごとに変わる折りたたみの呼び名）
  'plc-session', // モードDの画面全体の呼び名
  'schematic-enlarge-button', // `aria-label` が `${title}を${JA.timeChart.enlarge}` の組み立てで、逐語の1本の文字列としてはソースに現れない
  'skin-assumed', // 前提の一覧欄の呼び名
  'skin-title', // タイトル帯の呼び名（中身はメーカーごとに違う機種名）
  'toast', // 通知の欄の呼び名（中身は状況ごとに違う）
]);

describe('操作要素（決定表#22）', () => {
  it('covers exactly the controls the screens have', () => {
    expect(COVERAGE.controls.map((row) => row.testid).sort()).toEqual(collectTestIds());
  });

  it('points every documented control at a section that exists', () => {
    for (const row of COVERAGE.controls) {
      if (row.section === undefined) continue;
      expect(TEXT_BY_ID.has(row.section), `${row.testid} の節 ${row.section} がありません`).toBe(
        true,
      );
    }
  });

  it('writes the on-screen label of every documented control into its section', () => {
    const missing: string[] = [];
    for (const row of COVERAGE.controls) {
      if (row.section === undefined || row.label === undefined) continue;
      const text = TEXT_BY_ID.get(row.section) ?? '';
      if (!text.includes(row.label))
        missing.push(`${row.section} に「${row.label}」が出ていません`);
    }
    expect(missing).toEqual([]);
  });

  it('writes the on-screen label of every documented control into the renderer source, not just the manual (IM-5)', () => {
    const haystack = rendererSourceHaystack();
    const missing: string[] = [];
    for (const row of COVERAGE.controls) {
      if (row.section === undefined || row.label === undefined) continue;
      if (DESCRIPTIVE_NOT_LITERAL_LABELS.has(row.testid)) continue;
      if (!haystack.includes(row.label)) {
        missing.push(`${row.testid} の label「${row.label}」が画面のコードに見つかりません`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the descriptive-label exception list from silently growing', () => {
    // 説明用（逐語ではない）と断った13件以外は、必ずソースのどこかにリテラルで実在すること。
    const haystack = rendererSourceHaystack();
    const stillDescriptive = [...DESCRIPTIVE_NOT_LITERAL_LABELS].filter((testid) => {
      const row = COVERAGE.controls.find((r) => r.testid === testid);
      return row?.label === undefined || !haystack.includes(row.label);
    });
    expect(stillDescriptive.sort()).toEqual([...DESCRIPTIVE_NOT_LITERAL_LABELS].sort());
  });
});

describe('キー操作とマウス操作（決定表#22）', () => {
  it('explains every listed key in the section it points at', () => {
    const missing: string[] = [];
    for (const row of COVERAGE.keys) {
      const text = TEXT_BY_ID.get(row.section);
      if (text === undefined) missing.push(`節 ${row.section} がありません`);
      else if (!text.includes(row.key))
        missing.push(`${row.section} に「${row.key}」が出ていません`);
    }
    expect(missing).toEqual([]);
  });

  it('explains every listed mouse move in the section it points at', () => {
    const missing: string[] = [];
    for (const row of COVERAGE.gestures) {
      const text = TEXT_BY_ID.get(row.section);
      if (text === undefined) missing.push(`節 ${row.section} がありません`);
      else if (!text.includes(row.name))
        missing.push(`${row.section} に「${row.name}」が出ていません`);
    }
    expect(missing).toEqual([]);
  });
});

describe('メッセージ（決定表#23）', () => {
  it('lists exactly the messages the app can show', () => {
    expect(COVERAGE.messages.map((row) => row.key).sort()).toEqual(
      [...messageLeaves().keys()].sort(),
    );
  });

  it('quotes every fixed message in the section it points at', () => {
    const leaves = messageLeaves();
    const missing: string[] = [];
    for (const row of COVERAGE.messages) {
      const text = leaves.get(row.key);
      if (text === undefined) continue; // 引数で文が変わるものは名前だけ見る
      const section = TEXT_BY_ID.get(row.section);
      if (section === undefined) missing.push(`節 ${row.section} がありません`);
      else if (!section.includes(text)) missing.push(`${row.section} に「${text}」が出ていません`);
    }
    expect(missing).toEqual([]);
  });

  /*
   * IM-4: 設計 §6.3 検査5は「関数ならば代表の引数で呼んだ結果が節に出ていること」を求めるが、
   * 上のテストは `text === undefined`（＝関数）を素通ししていた。`messageLeaves()` が名前だけ
   * 拾う関数は `MSG.content.countMismatch` と `MSG.manual.openFailed` の2件だけなので、
   * それぞれ代表の引数で呼び、可変部を除いた固定部分（数字の手前・手前後 / `: ` の手前）が
   * 節に出ていることを求める。`12-troubleshooting.md` の `◯` の伏字は実例に置き換えた。
   */
  it('writes the fixed wording of MSG.content.countMismatch (called with representative counts) into the manual', () => {
    const sample = MSG.content.countMismatch(18, 20);
    const fixedParts = sample.split(/\d+/u).filter((part) => part.length > 0);
    expect(fixedParts.length).toBeGreaterThan(0);
    const section = TEXT_BY_ID.get('troubleshooting/こう表示されたら') ?? '';
    for (const part of fixedParts) {
      expect(section, `固定部分が説明書にありません: 「${part}」`).toContain(part);
    }
  });

  it('writes the fixed prefix of MSG.manual.openFailed (called with a representative reason) into the manual', () => {
    const sample = MSG.manual.openFailed('PDFを開けるアプリが見つかりません');
    const colonIndex = sample.indexOf(': ');
    expect(colonIndex).toBeGreaterThan(0);
    const fixedPrefix = sample.slice(0, colonIndex + 2);
    const section = TEXT_BY_ID.get('troubleshooting/こう表示されたら') ?? '';
    expect(section, `固定部分が説明書にありません: 「${fixedPrefix}」`).toContain(fixedPrefix);
  });
});

describe('手順の書き方（設計 §6.2 の規則7）', () => {
  it.each(PROCEDURE_SECTIONS)('writes %s as a numbered procedure', (id) => {
    expect(HTML_BY_ID.get(id), `節 ${id} がありません`).toBeDefined();
    expect(HTML_BY_ID.get(id) ?? '').toContain('<ol>');
  });
});
