import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { buildSpecChart } from '../src/renderer/session/spec-chart.js';

/**
 * C2 の提示情報（§9.2）: 2級は回路図＋タイムチャート、**1級はタイムチャートのみ**。
 * つまり1級では `buildSpecChart()` が失敗すると手がかりがゼロになる。8題すべてで
 * 模範回路が変換できることを確かめる（Plan 2B レビュー: これまで確かめていなかった）。
 * `buildSpecChart()` は模範回路の同期シミュレートだけで Worker を挟まないので軽い。
 */
describe('buildSpecChart for every C2 problem', () => {
  it.each(BUILTIN_INSPECT_REPAIR_PROBLEMS.map((p) => [p.id, p] as const))(
    '%s のタイムチャートが作れる',
    (id, problem) => {
      const spec = buildSpecChart(problem);
      expect(spec.ok, `${id}: ${spec.ok ? '' : JSON.stringify(spec)}`).toBe(true);
      if (!spec.ok) return;
      expect(spec.chart.signals.length, `${id} signals`).toBeGreaterThan(0);
    },
  );
});
