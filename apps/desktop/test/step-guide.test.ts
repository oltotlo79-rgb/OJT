import { describe, expect, it } from 'vitest';
import {
  assembleSteps,
  assembleStepHint,
  inspectPartsSteps,
  inspectPartsStepHint,
  inspectRepairSteps,
  inspectRepairStepHint,
  sequentialSteps,
} from '../src/renderer/session/step-guide.js';

/**
 * B/C1/C2の手順帯（UXレビュー #3）。`PlcSession.tsx` の手順帯と同じ考え方の純関数を
 * 単体で検証する。ここでは配線の中身（合否）は一切見ないので、その境界だけを確かめる。
 */
describe('sequentialSteps（一直線の手順の状態付け）', () => {
  it('marks the first not-done entry current and the rest todo', () => {
    const steps = sequentialSteps([
      { key: 'a', label: 'A', done: true },
      { key: 'b', label: 'B', done: false },
      { key: 'c', label: 'C', done: false },
    ]);
    expect(steps.map((s) => s.state)).toEqual(['done', 'current', 'todo']);
  });

  it('leaves every step done when all are done (nothing becomes current)', () => {
    const steps = sequentialSteps([
      { key: 'a', label: 'A', done: true },
      { key: 'b', label: 'B', done: true },
    ]);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done']);
  });
});

describe('assembleSteps（モードB: 部品装着 → 配線 → 通電 → 判定）', () => {
  it('starts at parts when nothing is mounted', () => {
    const steps = assembleSteps({
      partsRemaining: 2,
      wireCount: 3,
      fixedWireCount: 3,
      powered: false,
    });
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ['parts', 'current'],
      ['wire', 'todo'],
      ['power', 'todo'],
      ['judge', 'todo'],
    ]);
  });

  it('moves to wire once parts are all mounted, before any new wire is drawn', () => {
    const steps = assembleSteps({
      partsRemaining: 0,
      wireCount: 3,
      fixedWireCount: 3,
      powered: false,
    });
    expect(steps.find((s) => s.key === 'wire')?.state).toBe('current');
  });

  it('moves to power once a wire beyond the fixed ones is drawn', () => {
    const steps = assembleSteps({
      partsRemaining: 0,
      wireCount: 4,
      fixedWireCount: 3,
      powered: false,
    });
    expect(steps.find((s) => s.key === 'wire')?.state).toBe('done');
    expect(steps.find((s) => s.key === 'power')?.state).toBe('current');
  });

  it('moves to judge once powered', () => {
    const steps = assembleSteps({
      partsRemaining: 0,
      wireCount: 4,
      fixedWireCount: 3,
      powered: true,
    });
    expect(steps.find((s) => s.key === 'power')?.state).toBe('done');
    expect(steps.find((s) => s.key === 'judge')?.state).toBe('current');
  });

  it('gives a hint only for the current step', () => {
    expect(assembleStepHint('parts')).toContain('装着');
    expect(assembleStepHint(undefined)).toBeUndefined();
  });
});

describe('inspectPartsSteps（モードC1: 部品を挿す → 通電 → 測る → マーク → 判定）', () => {
  it('starts at plug', () => {
    const steps = inspectPartsSteps({
      plugged: false,
      powered: false,
      probed: false,
      answered: false,
    });
    expect(steps[0]).toMatchObject({ key: 'plug', state: 'current' });
  });

  it('walks through power, measure, mark, then judge', () => {
    expect(
      inspectPartsSteps({ plugged: true, powered: false, probed: false, answered: false }).find(
        (s) => s.key === 'power',
      )?.state,
    ).toBe('current');
    expect(
      inspectPartsSteps({ plugged: true, powered: true, probed: false, answered: false }).find(
        (s) => s.key === 'measure',
      )?.state,
    ).toBe('current');
    expect(
      inspectPartsSteps({ plugged: true, powered: true, probed: true, answered: false }).find(
        (s) => s.key === 'mark',
      )?.state,
    ).toBe('current');
    expect(
      inspectPartsSteps({ plugged: true, powered: true, probed: true, answered: true }).find(
        (s) => s.key === 'judge',
      )?.state,
    ).toBe('current');
  });

  it('gives a hint only for the current step', () => {
    expect(inspectPartsStepHint('measure')).toContain('プローブ');
    expect(inspectPartsStepHint(undefined)).toBeUndefined();
  });
});

describe('inspectRepairSteps（モードC2: 指摘 → 修復 → 判定）', () => {
  it('starts at report', () => {
    expect(
      inspectRepairSteps({ reportCount: 0, requiredReportCount: 1, repaired: false })[0],
    ).toMatchObject({
      key: 'report',
      state: 'current',
    });
  });

  it('moves to fix once every fault has been reported', () => {
    expect(
      inspectRepairSteps({ reportCount: 1, requiredReportCount: 1, repaired: false }).find(
        (s) => s.key === 'fix',
      )?.state,
    ).toBe('current');
  });

  /*
   * UI監査 I19: 故障が2箇所ある課題で1件だけ指摘しても「指摘 済」にしない。
   * 指摘すべき件数（`requiredReportCount`）ぶん揃うまでは「いまここ」のまま。
   */
  it('keeps report as current until every fault is reported, not just the first one', () => {
    const steps = inspectRepairSteps({ reportCount: 1, requiredReportCount: 2, repaired: false });
    expect(steps.find((s) => s.key === 'report')?.state).toBe('current');
    expect(steps.find((s) => s.key === 'fix')?.state).toBe('todo');
  });

  it('moves report to done once all required faults are reported', () => {
    const steps = inspectRepairSteps({ reportCount: 2, requiredReportCount: 2, repaired: false });
    expect(steps.find((s) => s.key === 'report')?.state).toBe('done');
    expect(steps.find((s) => s.key === 'fix')?.state).toBe('current');
  });

  it('moves to judge once a repair action follows a report', () => {
    expect(
      inspectRepairSteps({ reportCount: 1, requiredReportCount: 1, repaired: true }).find(
        (s) => s.key === 'judge',
      )?.state,
    ).toBe('current');
  });

  it('指摘前でも修復操作の実施状態は保持する', () => {
    // 修復してから指摘する順序にも対応する。未提出の指摘は引き続き案内する。
    const steps = inspectRepairSteps({ reportCount: 0, requiredReportCount: 1, repaired: true });
    expect(steps.find((s) => s.key === 'report')?.state).toBe('current');
    expect(steps.find((s) => s.key === 'fix')?.state).toBe('done');
  });

  it('gives a hint only for the current step', () => {
    expect(inspectRepairStepHint('report')).toContain('故障');
    expect(inspectRepairStepHint(undefined)).toBeUndefined();
  });
});
