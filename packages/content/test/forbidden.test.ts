import { JIPM_BOARD } from '@ojt/board-model';
import { createNetlist, createTimer4c, terminalId, type Part } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '../src/builtin/index.js';
import { findForbiddenPatterns } from '../src/forbidden.js';
import { buildReferenceSession } from '../src/reference.js';
import { parseProblem } from '../src/schema/index.js';
import { selfHoldProblemJson } from './helpers/problems.js';

/** 回路図だけを差し替えた課題のネットリスト。 */
function netlistOf(rungs: unknown[], id: string) {
  const json = {
    ...selfHoldProblemJson(),
    id,
    operations: [],
    durationMs: 3000,
    schematic: {
      formatVersion: 1,
      id: `sch-${id}`,
      title: 'テスト',
      orientation: 'horizontal',
      rungs,
    },
  };
  const parsed = parseProblem(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  if (parsed.problem.mode !== 'assemble') throw new Error('not an assemble problem');
  const built = buildReferenceSession(parsed.problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value.netlist;
}

/** タイマ自身の限時b接点で自コイルを切るワンショット（禁則）。調査資料 §5.5 */
function selfCutRungs(): unknown[] {
  return [
    {
      id: 'r1',
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [
        { kind: 't-b', id: 'c01', device: 'T1' },
        { kind: 'coil', id: 'c02', device: 'T1', presetMs: 500 },
      ],
    },
    {
      id: 'r2',
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [
        { kind: 't-a', id: 'c03', device: 'T1' },
        { kind: 'lamp', id: 'c04', device: 'PL1' },
      ],
    },
  ];
}

describe('findForbiddenPatterns', () => {
  it('finds nothing in the eight built-in mode B problems (§7.9)', () => {
    for (const problem of BUILTIN_ASSEMBLE_PROBLEMS) {
      const built = buildReferenceSession(problem, JIPM_BOARD);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(findForbiddenPatterns(built.value.netlist), problem.id).toEqual([]);
    }
  });

  it('detects a timer that cuts its own coil (調査資料 §5.5)', () => {
    const netlist = netlistOf(selfCutRungs(), 'x-f1');
    const found = findForbiddenPatterns(netlist);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('timer-self-cut');
    expect(found[0]?.timerIds).toEqual(['T1']);
    expect(found[0]?.message).toContain('リレーを介して');
  });

  it('detects a flicker made of two timers only (調査資料 §5.5)', () => {
    const netlist = netlistOf(
      [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-b', id: 'c01', device: 'T2' },
            { kind: 'coil', id: 'c02', device: 'T1', presetMs: 500 },
          ],
        },
        {
          id: 'r2',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-b', id: 'c03', device: 'T1' },
            { kind: 'coil', id: 'c04', device: 'T2', presetMs: 500 },
          ],
        },
        {
          id: 'r3',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-a', id: 'c05', device: 'T1' },
            { kind: 'lamp', id: 'c06', device: 'PL1' },
          ],
        },
      ],
      'x-f2',
    );
    const found = findForbiddenPatterns(netlist);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('timer-pair-flicker');
    expect(found[0]?.timerIds).toEqual(['T1', 'T2']);
  });

  it('does not flag a timer that legitimately stops another timer', () => {
    const netlist = netlistOf(
      [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 'pb-a', id: 'c01', device: 'PB1' },
            { kind: 'coil', id: 'c02', device: 'T1', presetMs: 500 },
          ],
        },
        {
          id: 'r2',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-b', id: 'c03', device: 'T1' },
            { kind: 'coil', id: 'c04', device: 'T2', presetMs: 500 },
          ],
        },
        {
          id: 'r3',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-a', id: 'c05', device: 'T2' },
            { kind: 'lamp', id: 'c06', device: 'PL1' },
          ],
        },
      ],
      'x-f3',
    );
    expect(findForbiddenPatterns(netlist)).toEqual([]);
  });

  it('does not blame the timer when a broken wire cuts its coil', () => {
    const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-003');
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const built = buildReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) return;
    // `sw-011`（CR1.6 – T1.14）はタイマの電源線。ここを切ってもタイマのせいではない。
    const wire = built.value.netlist.wires.find((w) => w.id === 'sw-011');
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    wire.open = true;
    expect(findForbiddenPatterns(built.value.netlist)).toEqual([]);
  });

  it('does not blame the timer when the wire through its own b contact is broken', () => {
    // コイルが T1 自身のb接点を通って給電される回路。無傷なら自己遮断として検出される。
    const netlist = netlistOf(selfCutRungs(), 'x-f4');
    expect(findForbiddenPatterns(netlist).map((p) => p.kind)).toEqual(['timer-self-cut']);
    // そのb接点とコイル＋端子をつなぐ電線を切ると、誰もタイムアップしていなくてもコイルは死ぬ。
    // 「E = {} で生きている」条件が無ければ、ここを断線と区別できずタイマのせいにしてしまう。
    const ends = [terminalId('T1', '1'), terminalId('T1', '14')];
    const wire = netlist.wires.find((w) => ends.includes(w.from) && ends.includes(w.to));
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    wire.open = true;
    expect(findForbiddenPatterns(netlist)).toEqual([]);
  });

  it('returns nothing when the netlist has no P/N supply terminals', () => {
    expect(findForbiddenPatterns(createNetlist([createTimer4c('T1', 500)], [], []))).toEqual([]);
  });

  it('treats a timer without a coil element as already cut (defensive)', () => {
    const timer = createTimer4c('T1', 500);
    const stripped: Part = { ...timer, elements: timer.elements.filter((e) => e.kind !== 'load') };
    expect(findForbiddenPatterns(createNetlist([stripped], [], []))).toEqual([]);
  });
});
