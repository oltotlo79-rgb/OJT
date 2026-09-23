import { DIAGNOSIS_TABLE, PART_TRUTH_LABELS, type DiagnosisRow } from '@ojt/content';
import type { DialectId } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';
import { JA } from '../src/renderer/i18n/ja.js';

/**
 * コードが持っている表・文言と、説明書の一致。取扱説明書 設計 §5.5 / 決定表#10・#11。
 *
 * 判定表もキー割当も設定の説明文も、**実体はコード側にある**（アプリの動作そのものが
 * 使っているデータだから）。説明書はそれを写して載せ、このテストが1行ずつ照らす。
 * どちらを直しても、直していないほうが落ちる。
 *
 * 実装メモ（Plan 6 Task 10）: 本プランの雛形コードは `@ojt/plc-dialects` の関数名を
 * `profileOf` としているが、実ソース（`packages/plc-dialects/src/index.ts`）が輸出している
 * のは `getDialect` である。また C1の判定表がヘルプ画面に描く「原因」は `DiagnosisRow.cause`
 * （内部ID、例: `coil-open`）そのものではなく `PART_TRUTH_LABELS[cause]`（日本語表示名、例:
 * 「コイル断線」）である（`panels/DiagnosisHelp.tsx` 参照）。どちらも実ソースに合わせて書き換えた。
 *
 * 実装メモ（Phase 6 C〜E レビュー IM-1）: キー割当の照合は前は `section().includes(entry.keys)`
 * だけだった。OMRON の1文字キー（`C` `/` `O` `I` `W` `L`）はどのメーカーの行にも当たってしまい、
 * `label` も三菱表と同じ語を使うため、**OMRON の表を丸ごと消しても緑のまま**という空振りだった。
 * いまは節の HTML から `<table>` を4つ切り出し、`keys` と `label` が**同じ `<tr>`**（同じ行番号）
 * に並んでいることを照合する。表を1つ消すと表の枚数が合わなくなって必ず落ちる
 * （`表を1つ消しても落ちることを確かめる` のテストが証拠）。
 */

const TEXT_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.text]));
const HTML_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.html]));

function textOf(id: string): string {
  const text = TEXT_BY_ID.get(id);
  expect(text, `節 ${id} がありません`).toBeDefined();
  return text ?? '';
}

function htmlOf(id: string): string {
  const html = HTML_BY_ID.get(id);
  expect(html, `節 ${id} がありません`).toBeDefined();
  return html ?? '';
}

describe('C1 の判定表（§9.1）', () => {
  const section = () => textOf('mode-c1/不良の見分け方');

  it('has as many rows as the app shows', () => {
    expect(DIAGNOSIS_TABLE.length).toBe(7);
  });

  it.each(DIAGNOSIS_TABLE.map((row) => [row.situation, PART_TRUTH_LABELS[row.cause]] as const))(
    'writes the row "%s" into the manual',
    (situation, causeLabel) => {
      expect(section()).toContain(situation);
      expect(section()).toContain(causeLabel);
    },
  );

  /*
   * IM-2: 画面の判定表（`panels/DiagnosisHelp.tsx`）は行ごとに `note`（溶着の優先規則・
   * レアショートの補足）を併記するが、説明書の表は「測った結果」「こわれ方」の2列しか
   * 見ていなかった。備考列を足し、`note` を持つ6行（7行中）を逐語で照らす。
   */
  const rowsWithNote = DIAGNOSIS_TABLE.filter(
    (row): row is DiagnosisRow & { note: string } => row.note !== undefined,
  );

  it('has as many rows with a note as the app shows (6 of 7)', () => {
    expect(rowsWithNote.length).toBe(6);
  });

  it.each(rowsWithNote.map((row) => [row.situation, row.note] as const))(
    'writes the note of the row "%s" into the manual word for word',
    (_situation, note) => {
      expect(section()).toContain(note);
    },
  );

  it('writes the ohm-safety note word for word', () => {
    expect(section()).toContain(JA.inspectParts.ohmSafeNote);
  });
});

/** `<table>…</table>` を出てくる順に切り出す。 */
function tablesIn(html: string): string[] {
  return [...html.matchAll(/<table>[\s\S]*?<\/table>/gu)].map((match) => match[0]);
}

/** HTML実体参照を素の文字に戻す（`scripts/manual-build.mjs` の `plainText()` と同じ規則）。 */
function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&');
}

/** 1つの `<table>` の `<tbody>` から、行ごとの `<td>` の中身を並べる（見出し行は含めない）。 */
function rowsOfTable(tableHtml: string): string[][] {
  const body = /<tbody>([\s\S]*?)<\/tbody>/u.exec(tableHtml)?.[1] ?? '';
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/gu)].map((row) =>
    [...(row[1] ?? '').matchAll(/<td>([\s\S]*?)<\/td>/gu)].map((cell) =>
      unescapeHtml((cell[1] ?? '').trim()),
    ),
  );
}

/**
 * 節のHTMLに並ぶキー割当表（メーカーの登場順）が、渡した方言の `shortcuts` と
 * **行ごとに**（`keys` と `label` が同じ `<tr>` に）一致するかを調べ、ずれを日本語で返す。
 * 空配列なら一致。表の枚数がメーカー数と違う時点で「メーカーの表が丸ごと無い」を検出する。
 */
function keyTableMismatches(
  html: string,
  order: readonly DialectId[],
  shortcutsOf: (id: DialectId) => readonly { keys: string; label: string }[],
): string[] {
  const tables = tablesIn(html);
  if (tables.length !== order.length) {
    return [`表の数が${String(order.length)}枚ではありません（実際は${String(tables.length)}枚）`];
  }
  const missing: string[] = [];
  order.forEach((id, tableIndex) => {
    const rows = rowsOfTable(tables[tableIndex] ?? '');
    const shortcuts = shortcutsOf(id);
    if (rows.length !== shortcuts.length) {
      missing.push(
        `${id}: 行数が${String(shortcuts.length)}ではありません（実際は${String(rows.length)}）`,
      );
      return;
    }
    shortcuts.forEach((entry, rowIndex) => {
      const row = rows[rowIndex] ?? [];
      if (row[0] !== entry.keys) {
        missing.push(`${id} の行${String(rowIndex + 1)}: キーが「${entry.keys}」ではありません`);
      }
      if (row[1] !== entry.label) {
        missing.push(`${id} の行${String(rowIndex + 1)}: 操作名が「${entry.label}」ではありません`);
      }
    });
  });
  return missing;
}

describe('モードD のキー割当（§10.6）', () => {
  /** 節に出てくる4つの表の順番（三菱・オムロン・ジェイテクト・シャープ。`DIALECT_IDS` の並びとは違う）。 */
  const MANUAL_TABLE_ORDER: readonly DialectId[] = ['mitsubishi', 'omron', 'jtekt', 'sharp'];

  it('writes every key and label of every vendor into the same row of the manual table', async () => {
    const dialects = await import('@ojt/plc-dialects');
    const missing = keyTableMismatches(
      htmlOf('mode-d/キーの割り当て'),
      MANUAL_TABLE_ORDER,
      (id) => dialects.getDialect(id).shortcuts,
    );
    expect(missing).toEqual([]);
  });

  it('would catch a vendor table being deleted entirely (proves the check is not vacuous)', async () => {
    const dialects = await import('@ojt/plc-dialects');
    const tables = tablesIn(htmlOf('mode-d/キーの割り当て'));
    // OMRON表（2番目の表）を丸ごと消した状態を作る
    const withoutOmronTable = [tables[0], tables[2], tables[3]].join('\n');
    const missing = keyTableMismatches(
      withoutOmronTable,
      MANUAL_TABLE_ORDER,
      (id) => dialects.getDialect(id).shortcuts,
    );
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe('設定の説明文（§12.1）', () => {
  it.each([
    ['userContentHelp', '設定の画面', JA.settings.userContentHelp],
    ['vendorHelp', 'PLCの既定のメーカー', JA.settings.vendorHelp],
    ['monitorColorHelp', 'ラダーの見た目', JA.settings.monitorColorHelp],
  ])('writes %s into its manual section word for word', (_name, section, text) => {
    expect(textOf(`settings/${section}`)).toContain(text);
  });

  /*
   * IM-3: 以前は「数字を除いた文言そのものは固定」という検査都合の注記を説明書に書き、
   * それを頼りに数を除いた断片だけを照合していた。いまは説明書が実際に使っている数（11）で
   * `gridColsHelp()` を呼び、逐語一致を求める（説明書側にその注記はもう無い）。
   */
  it('writes the ladder column hint word for word (11, the number the manual quotes)', () => {
    expect(textOf('settings/ラダーの見た目')).toContain(JA.settings.gridColsHelp(11));
  });
});

describe('商標と表記の断り（§15 / §17.1）', () => {
  it('writes the trademark notice word for word', () => {
    expect(textOf('intro/商標と表記について')).toContain(JA.settings.trademarkNotice);
  });

  it('writes the assumption notice word for word', () => {
    expect(textOf('troubleshooting/命令名やキーの割り当てについてのお断り')).toContain(
      JA.settings.assumptionNotice,
    );
  });
});
