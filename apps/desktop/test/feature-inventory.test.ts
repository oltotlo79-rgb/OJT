import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectTestIds, testIdsIn } from '../scripts/feature-inventory.mjs';

/**
 * 機能一覧表の網羅。取扱説明書 設計 §6.3 / 決定表#22。
 *
 * 画面に操作要素を1つ足すと、このテストが「機能一覧表に無い」と言って落ちる。
 * 説明書に書くか、画面に出ない内部用である理由を書くかしないと通らない。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE = JSON.parse(
  readFileSync(resolve(APP_ROOT, '../../docs/manual/coverage.json'), 'utf8'),
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

describe('目印の拾い方', () => {
  it('reads a plain data-testid', () => {
    expect([...testIdsIn('<button data-testid="judge-button">判定</button>')]).toEqual([
      'judge-button',
    ]);
  });

  it('folds a template into {}', () => {
    expect([...testIdsIn('<tr data-testid={`open-${problem.id}`}>')]).toEqual(['open-{}']);
  });

  it('reads the testId prop that SidePanel takes', () => {
    expect([...testIdsIn('<SidePanel testId="shortcuts-note" />')]).toEqual(['shortcuts-note']);
  });

  /**
   * 1つの式が2通りの名前を作る書き方（`LadderWorkspace.tsx` のメーカー別ツールバー）。
   * 両方とも画面に出るボタンなので、両方とも拾えていないと説明書から漏れる。
   */
  it('reads every template in one expression', () => {
    const source =
      '<button data-testid={first ? `toolbar-${item.action}` : ' +
      '`toolbar-${item.action}-${String(item.index)}`} />';
    expect([...testIdsIn(source)].sort()).toEqual(['toolbar-{}', 'toolbar-{}-{}']);
  });

  it('finds nothing in a file without markers', () => {
    expect([...testIdsIn('export const x = 1;')]).toEqual([]);
  });
});

describe('機能一覧表', () => {
  it('covers exactly the controls the screens have', () => {
    const found = collectTestIds();
    const listed = COVERAGE.controls.map((row) => row.testid).sort();
    // 不足＝説明していない操作要素、余分＝画面から消えたのに表に残っている行
    expect(listed).toEqual(found);
  });

  it('gives every listed control either a section or a reason for being internal', () => {
    for (const row of COVERAGE.controls) {
      const documented = typeof row.section === 'string' && row.section.length > 0;
      const internal = typeof row.internal === 'string' && row.internal.length >= 6;
      expect(documented !== internal, `${row.testid} は節か内部用の理由のどちらか一方を持つ`).toBe(
        true,
      );
      if (documented) {
        expect(typeof row.screen, `${row.testid} に画面名がない`).toBe('string');
        expect((row.label ?? '').length, `${row.testid} に画面の文言がない`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * キー操作・マウス操作・メッセージの行も、節を指していないと説明書から漏れる
   * （利用者要求「すべての機能を使用者目線で詳細に解説すること」）。
   */
  it('gives every key, gesture and message a section', () => {
    for (const row of COVERAGE.keys) {
      expect(row.key.length, `${row.key} が空`).toBeGreaterThan(0);
      expect(row.section, `${row.key} に節がない`).toMatch(/^[a-z0-9-]+\/.+$/u);
    }
    for (const row of COVERAGE.gestures) {
      expect(row.name.length, `${row.name} が空`).toBeGreaterThan(0);
      expect(row.section, `${row.name} に節がない`).toMatch(/^[a-z0-9-]+\/.+$/u);
    }
    for (const row of COVERAGE.messages) {
      expect(row.key, `${row.key} の名前が JA. か MSG. で始まっていない`).toMatch(
        /^(JA|MSG)\.[A-Za-z]+\./u,
      );
      expect(row.section, `${row.key} に節がない`).toBe('troubleshooting/こう表示されたら');
    }
  });
});
