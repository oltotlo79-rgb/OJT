import { BUILTIN_PROBLEMS } from '@ojt/content';
import { DEFAULT_LAYOUT_OPTIONS, layout } from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { ASSUMPTION_NOTICE, TRADEMARK_NOTICE } from '../src/renderer/screens/Settings.js';

/**
 * Plan 1D2 で足した仕上げ部分の純粋ロジック（§12.3 / §13 #8 / §15 / §11.2）。
 *
 * Plan 1D2 Task 7 の下書きには他にも `parseWorkFile()` / `toWorkFile()` / `toSession()` /
 * `soundsForSnapshot()` / `effectiveGain()` の検査が載っているが、それらは Task 1〜6 の実装者が
 * 先に書いた次のファイルで既にすべて検査済みなので、ここでは重複させない（テストの重複は
 * メンテナンスコストを増やすだけで検出力を上げない）。
 * - `parseWorkFile()`（§13 #8: 未知のバージョンは読み込まない）→ `test/work-files.test.ts`
 *   の `describe('parseWorkFile（§13 #8: 未知のバージョンは読み込まない）')`
 * - `toWorkFile()` / `toSession()`（§12.3）→ `test/work-file.test.ts` の
 *   `describe('toWorkFile（§12.3）')` / `describe('toSession（§13 #8: 形が違えば undefined）')`
 * - `soundsForSnapshot()` / `effectiveGain()`（§15。「最初のスナップショットでは鳴らさない」を
 *   含む）→ `test/sounds.test.ts` の `describe('soundsForSnapshot')` / `describe('effectiveGain')`
 *
 * ここに残すのは、Task 1〜6 のどのテストにも出てこない2つだけ：
 * `@ojt/schematic-core` の `layout()` を SVG 化する回路図レンダラ（§11.2）と、
 * 設定画面の商標注記・未確認事項注記（§15 / §17.1）。
 */

describe('回路図レンダラ（§11.2）', () => {
  it('内蔵課題の回路図から図形が返る', () => {
    const problem = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const result = layout(problem.schematic);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.shapes.length).toBeGreaterThan(0);
    expect(result.shapes.some((s) => s.kind === 'text')).toBe(true);
    // 図形は4種の直和で、`fill` を持つのは circle だけ（表示灯の色）
    for (const shape of result.shapes) {
      expect(['line', 'circle', 'arc', 'text']).toContain(shape.kind);
    }
    // 銘板が重ならないよう SchematicSvg は列幅を広げて渡す（既定の 24 では `T1 (3.0秒)` が溢れる）
    expect(layout(problem.schematic, { colWidth: 40 }).width).toBeGreaterThan(result.width);
    expect(DEFAULT_LAYOUT_OPTIONS.colWidth).toBe(24);
  });
});

describe('設定画面の注記（§15 / §17.1）', () => {
  it('商標注記に4社の名前が載っている', () => {
    for (const name of ['三菱電機', 'オムロン', 'ジェイテクト', 'シャープ']) {
      expect(TRADEMARK_NOTICE).toContain(name);
    }
    expect(TRADEMARK_NOTICE).toContain('提携・後援関係を示すものではありません');
  });

  it('未確認事項の注記がある', () => {
    expect(ASSUMPTION_NOTICE).toContain('本アプリの表記');
  });
});
