import { readFileSync } from 'node:fs';
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
});

describe('手順の書き方（設計 §6.2 の規則7）', () => {
  it.each(PROCEDURE_SECTIONS)('writes %s as a numbered procedure', (id) => {
    expect(HTML_BY_ID.get(id), `節 ${id} がありません`).toBeDefined();
    expect(HTML_BY_ID.get(id) ?? '').toContain('<ol>');
  });
});
