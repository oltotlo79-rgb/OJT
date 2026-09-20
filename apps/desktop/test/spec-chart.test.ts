import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSpecChart,
  clearSpecChartCache,
  isSpecChartCached,
} from '../src/renderer/session/spec-chart.js';

const SELF_HOLD = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
const TIMER = BUILTIN_PROBLEMS.find((p) => p.id === 'b-003');

// 既定の5秒だと並列実行時の負荷でまれに超過する（既知のflake）。このファイルだけ延ばす。
vi.setConfig({ testTimeout: 15_000 });

beforeEach(() => {
  clearSpecChartCache();
});

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

describe('buildSpecChart のキャッシュ（§15）', () => {
  it('同じ課題の2度目はキャッシュを返す（模範回路を走らせ直さない）', () => {
    if (SELF_HOLD === undefined) return;
    expect(isSpecChartCached(SELF_HOLD)).toBe(false);
    const first = buildSpecChart(SELF_HOLD);
    expect(isSpecChartCached(SELF_HOLD)).toBe(true);
    const second = buildSpecChart(SELF_HOLD);
    // 同じオブジェクトが返る＝作り直していない
    expect(second).toBe(first);
  });

  it('キャッシュを捨てれば作り直す（課題が差し替わったときに古い結果を返さない）', () => {
    if (SELF_HOLD === undefined) return;
    const first = buildSpecChart(SELF_HOLD);
    clearSpecChartCache();
    const rebuilt = buildSpecChart(SELF_HOLD);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.ok).toBe(true);
  });

  it('IDも版も同じまま中身を直したら作り直す（指摘 DS-6: 利用者課題フォルダのJSONを編集したとき）', () => {
    if (SELF_HOLD === undefined) return;
    const first = buildSpecChart(SELF_HOLD);
    expect(first.ok).toBe(true);
    // 利用者が JSON の操作列だけ直した状態（ID・版はそのまま）
    const edited = {
      ...SELF_HOLD,
      durationMs: SELF_HOLD.durationMs + 1000,
    };
    expect(isSpecChartCached(edited)).toBe(false);
    const rebuilt = buildSpecChart(edited);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.chart.durationMs).toBe(SELF_HOLD.durationMs + 1000);
    // 元の課題のぶんは残っているので、開き直しても走らせ直さない
    expect(buildSpecChart(SELF_HOLD)).toBe(first);
  });

  it('課題ごとに別々に覚える', () => {
    if (SELF_HOLD === undefined || TIMER === undefined) return;
    expect(buildSpecChart(SELF_HOLD)).not.toBe(buildSpecChart(TIMER));
    expect(isSpecChartCached(SELF_HOLD)).toBe(true);
    expect(isSpecChartCached(TIMER)).toBe(true);
  });
});

describe('タイマ課題（b-003）の仕様チャート（§7.7）', () => {
  it('タイマの設定値（3000ms）の目印が立ち、PL1 は起動から 3000ms 後に立ち上がる', () => {
    expect(TIMER).toBeDefined();
    if (TIMER === undefined) return;
    const result = buildSpecChart(TIMER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 目印はタイマの設定値そのもの（`timerMarkers()`）
    expect(result.chart.markers.map((m) => m.tMs)).toContain(3000);

    // 起動は PB1 の押下。PL1 はその 3000ms 後（走査1回ぶんの遅れは許容）に点く
    const start = TIMER.operations.find((op) => op.target === 'PB1' && op.action === 'press');
    expect(start).toBeDefined();
    if (start === undefined) return;
    const pl1 = result.chart.signals.find((s) => s.name === 'PL1');
    const rise = pl1?.segments.find((seg) => seg.value);
    expect(rise).toBeDefined();
    if (rise === undefined) return;
    expect(rise.fromMs - start.t).toBeGreaterThanOrEqual(3000);
    expect(rise.fromMs - start.t).toBeLessThanOrEqual(3050);
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
