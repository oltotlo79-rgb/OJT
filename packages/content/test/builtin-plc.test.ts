import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLC_PROBLEMS } from '../src/builtin/index.js';
import { judgePlcReference } from '../src/judge-plc.js';
import { runPlcOperations } from '../src/plc-io.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';
import { resolveCompareSignals } from '../src/schema/judge.js';
import { buildTimeChart, defaultChartSignals, startsAndEndsLow } from '../src/timechart.js';

describe('内蔵モードD課題（§7.9）', () => {
  it('has the sixty built-in mode D problems (2級形式30題＋1級形式30題)', () => {
    expect(BUILTIN_PLC_PROBLEMS.map((p) => p.id)).toEqual(
      Array.from({ length: 60 }, (_, i) => `d-${String(i + 1).padStart(3, '0')}`),
    );
    expect(BUILTIN_PLC_PROBLEMS.filter((p) => p.grade === 2)).toHaveLength(30);
    expect(BUILTIN_PLC_PROBLEMS.filter((p) => p.grade === 1)).toHaveLength(30);
    // 同梱の60題は三菱で出題するが、IRはベンダ中立で4機種すべてで成立する
    // （`plc-cross-validation.test.ts` が機種を差し替えて確かめている。決定表#14）
    expect(BUILTIN_PLC_PROBLEMS.every((p) => p.plc.model === 'FX5U')).toBe(true);
    expect(BUILTIN_PLC_PROBLEMS.every((p) => p.wiringRequired)).toBe(true);
  });

  it('uses three inputs and three outputs in the 2級 form (調査資料 §1.1)', () => {
    for (const problem of BUILTIN_PLC_PROBLEMS.filter((p) => p.grade === 2)) {
      expect(problem.io.inputs).toHaveLength(3);
      expect(problem.io.outputs).toHaveLength(3);
      // PB4 はチェック用回路の押ボタンなので入力には使わない（§6.3）
      expect(problem.io.inputs?.some((input) => String(input.pb) === 'PB4')).toBe(false);
    }
  });

  it('uses three inputs and four outputs in the 1級 form (調査資料 §1.1)', () => {
    const grade1 = BUILTIN_PLC_PROBLEMS.filter((p) => p.grade === 1);
    expect(grade1).toHaveLength(30);
    for (const problem of grade1) {
      expect(problem.io.inputs).toHaveLength(3);
      expect(problem.io.outputs).toHaveLength(4);
      expect(problem.io.outputs?.at(-1)?.cr).toBe('CR4');
    }
  });

  it('labels the devices of d-001 so the 3B comment pane has something to show (§10.7)', () => {
    const problem = BUILTIN_PLC_PROBLEMS.find((p) => p.id === 'd-001');
    if (problem === undefined) throw new Error('d-001 がありません');
    expect(problem.referenceLadder.comments?.X0).toBe('運転押ボタン（黒）');
    expect(problem.referenceLadder.comments?.Y0).toBe('運転表示灯 PL1');
  });

  it.each(BUILTIN_PLC_PROBLEMS.map((p) => [p.id, p] as const))(
    '%s passes its own reference judgement (§7.8 / §14.1 #30)',
    (_id, problem) => {
      const judged = judgePlcReference(problem, JIPM_BOARD);
      expect(judged.ok).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.mismatches).toEqual([]);
      expect(judged.value.staticChecks.filter((c) => !c.ok)).toEqual([]);
      expect(judged.value.passed).toBe(true);
    },
  );

  it.each(BUILTIN_PLC_PROBLEMS.map((p) => [p.id, p] as const))(
    '%s starts and ends low on every compared signal (§7.3)',
    (_id, problem) => {
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const run = runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
        durationMs: problem.durationMs,
      });
      const signals = resolveCompareSignals(problem.judge, []);
      const chart = buildTimeChart(run.log, defaultChartSignals(signals), problem.durationMs, []);
      expect(startsAndEndsLow(chart)).toBe(true);
    },
  );

  it('actually drives every compared lamp at some point (課題として意味があること)', () => {
    for (const problem of BUILTIN_PLC_PROBLEMS) {
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      if (!built.ok) throw new Error(`${problem.id}: ${JSON.stringify(built.errors)}`);
      const run = runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
        durationMs: problem.durationMs,
      });
      for (const signal of resolveCompareSignals(problem.judge, [])) {
        const lit = run.log.transitions(signal).some((e) => e.value === true);
        expect(lit, `${problem.id} の ${signal} が一度も点灯しません`).toBe(true);
      }
    }
  });

  it('turns the on-delay lamp on 3 seconds after the start button (§10.4)', () => {
    const problem = BUILTIN_PLC_PROBLEMS.find((p) => p.id === 'd-003');
    if (problem === undefined) throw new Error('d-003 がありません');
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const run = runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
      durationMs: problem.durationMs,
    });
    const litMs = run.log.transitions('PL1').find((e) => e.value === true)?.tMs ?? -1;
    // 500ms に押す → 入力が1スキャン遅れて 510ms に M0 が入り、3000ms 計時して 3500ms に T0、
    // そこから盤のリレーの動作（1tick）とランプの点灯判定（1tick）で 3520ms に点く
    expect(litMs).toBeGreaterThanOrEqual(3500);
    expect(litMs).toBeLessThanOrEqual(3600);
  });

  it('keeps the one-shot output on for exactly 1 second even on a long press (d-004)', () => {
    const problem = BUILTIN_PLC_PROBLEMS.find((p) => p.id === 'd-004');
    if (problem === undefined) throw new Error('d-004 がありません');
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const run = runPlcOperations(built.value.netlist, built.value.program, problem.operations, {
      durationMs: problem.durationMs,
    });
    const edges = run.log.transitions('PL1');
    const rises = edges.filter((e) => e.value === true).map((e) => e.tMs);
    const falls = edges.filter((e) => e.value === false && e.tMs > 0).map((e) => e.tMs);
    expect(rises).toHaveLength(2);
    // 入力は1スキャン遅れ、盤のリレーの動作・復帰に各1tick かかるので、点灯時間は
    // 設定1000ms ちょうどではなく 990ms 前後になる（§10.4 のスキャン＋§5.3.1 の動作時間）
    expect((falls[0] ?? 0) - (rises[0] ?? 0)).toBeGreaterThanOrEqual(950);
    expect((falls[0] ?? 0) - (rises[0] ?? 0)).toBeLessThanOrEqual(1050);
  });
});
