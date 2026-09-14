import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { buildSpecChart } from '../src/renderer/session/spec-chart.js';

const SELF_HOLD = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');

describe('buildSpecChart', () => {
  it('内蔵課題「自己保持回路」の仕様チャートを作れる（§7.7）', () => {
    expect(SELF_HOLD).toBeDefined();
    if (SELF_HOLD === undefined) return;
    const result = buildSpecChart(SELF_HOLD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chart.durationMs).toBe(SELF_HOLD.durationMs);
    expect(result.chart.signals.map((s) => s.name)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
  });

  it('PL1 は押下後に点灯し、停止で消える（自己保持）', () => {
    expect(SELF_HOLD).toBeDefined();
    if (SELF_HOLD === undefined) return;
    const result = buildSpecChart(SELF_HOLD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pl1 = result.chart.signals.find((s) => s.name === 'PL1');
    expect(pl1?.segments.some((seg) => seg.value)).toBe(true);
    expect(pl1?.segments.at(0)?.value).toBe(false);
    expect(pl1?.segments.at(-1)?.value).toBe(false);
  });

  it('模範回路が組める課題はすべてチャートになる', () => {
    // 「内蔵課題の模範回路が必ず組めること」は Plan 1C の自己整合テスト（§7.8 / §14.1 #30）の担当。
    // ここで見るのは「組めた課題は必ずチャートになる」という 1D 側の変換の全域性。
    for (const problem of BUILTIN_PROBLEMS) {
      const reference = buildReferenceSession(problem, JIPM_BOARD);
      if (!reference.ok) continue;
      expect(buildSpecChart(problem).ok, problem.id).toBe(true);
    }
  });
});

describe('判定（worker が呼ぶ経路と同じ）', () => {
  it('模範回路そのままなら合格する（§7.8 自己整合）', () => {
    expect(SELF_HOLD).toBeDefined();
    if (SELF_HOLD === undefined) return;
    const reference = buildReferenceSession(SELF_HOLD, JIPM_BOARD);
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    const judged = judgeAssemble(SELF_HOLD, JIPM_BOARD, reference.value.session, {
      elapsedMs: 61_000,
    });
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(true);
    expect(judged.value.elapsedMs).toBe(61_000);
  });

  it('電線を1本外すと不合格になり差分が出る（§16 Phase 1 受入基準③）', () => {
    expect(SELF_HOLD).toBeDefined();
    if (SELF_HOLD === undefined) return;
    const reference = buildReferenceSession(SELF_HOLD, JIPM_BOARD);
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    const broken = reference.value.session;
    const target = broken.wires.find((w) => !w.locked);
    expect(target).toBeDefined();
    broken.wires = broken.wires.filter((w) => w.id !== target?.id);
    const judged = judgeAssemble(SELF_HOLD, JIPM_BOARD, broken);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
  });
});
