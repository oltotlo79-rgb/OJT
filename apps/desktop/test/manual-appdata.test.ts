import { DIAGNOSIS_TABLE, PART_TRUTH_LABELS } from '@ojt/content';
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
 */

const TEXT_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.text]));

function textOf(id: string): string {
  const text = TEXT_BY_ID.get(id);
  expect(text, `節 ${id} がありません`).toBeDefined();
  return text ?? '';
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
});

describe('モードD のキー割当（§10.6）', () => {
  const section = () => textOf('mode-d/キーの割り当て');

  it('writes every key of every vendor into the manual', async () => {
    const dialects = await import('@ojt/plc-dialects');
    const missing: string[] = [];
    for (const id of dialects.DIALECT_IDS) {
      for (const entry of dialects.getDialect(id).shortcuts) {
        if (!section().includes(entry.keys)) missing.push(`${id}: ${entry.keys}`);
        if (!section().includes(entry.label)) missing.push(`${id}: ${entry.label}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('設定の説明文（§12.1）', () => {
  const section = () => textOf('settings/設定の画面');

  it.each([
    ['userContentHelp', JA.settings.userContentHelp],
    ['vendorHelp', JA.settings.vendorHelp],
    ['monitorColorHelp', JA.settings.monitorColorHelp],
  ])('writes %s into the manual word for word', (_name, text) => {
    expect(section()).toContain(text);
  });

  it('writes the ladder column hint too', () => {
    // 引数で数が変わるので、変わらない部分だけを見る
    const sample = JA.settings.gridColsHelp(11);
    const fixed = sample.replace(/\d+/gu, '');
    for (const piece of fixed.split(/\s+/u).filter((part) => part.length >= 4)) {
      expect(section()).toContain(piece);
    }
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
