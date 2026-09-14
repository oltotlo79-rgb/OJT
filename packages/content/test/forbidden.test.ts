import { JIPM_BOARD, toNetlist } from '@ojt/board-model';
import {
  createNetlist,
  createTimer4c,
  terminalId,
  toTerminalId,
  type Part,
} from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '../src/builtin/index.js';
import { applyFaults } from '../src/faults.js';
import { findForbiddenPatterns } from '../src/forbidden.js';
import { buildReferenceSession } from '../src/reference.js';
import type { FaultSpecData } from '../src/schema/faults.js';
import { parseProblem } from '../src/schema/index.js';
import type { AssembleProblem } from '../src/schema/assemble.js';
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

/** 模範回路に故障を1件だけ入れた盤のネットリスト（毎回まっさらな模範から作り直す）。 */
function faultedNetlist(problem: AssembleProblem, fault: FaultSpecData) {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const applied = applyFaults(built.value.session, [fault]);
  if (!applied.ok) throw new Error(JSON.stringify(applied.errors));
  return toNetlist(built.value.session, JIPM_BOARD);
}

/** その課題の模範回路のうち、故障を入れてよい電線ID（既設の固定配線は除く）。 */
function faultableWireIds(problem: AssembleProblem): string[] {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value.session.wires.filter((w) => !w.locked).map((w) => w.id);
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

  it('still detects the self-cut even if a different, unrelated wire is also broken (M-15)', () => {
    const netlist = netlistOf(selfCutRungs(), 'x-f1b');
    // r2（T1のa接点→表示灯PL1）はコイル自身の導通経路とは別の枝。ここを切ってもコイル側の
    // P/N到達性には関係が無いので、自己遮断の検出（コイル自身の経路だけを見る）には影響しない
    // はずである。「無関係な断線が1本あるだけで自己遮断を見逃す」退行が起きていないか見張る。
    const lampPlus = toTerminalId('TB_PL.1+');
    const wire = netlist.wires.find((w) => w.to === lampPlus || w.from === lampPlus);
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    wire.open = true;
    const found = findForbiddenPatterns(netlist);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('timer-self-cut');
    expect(found[0]?.timerIds).toEqual(['T1']);
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

  it('does not invent a self-cut on the one-shot board when a single wire is faulted (b-005)', () => {
    // b-005 は T1 の限時b接点 → PB1 → CR1 コイルの直列。負荷（コイル・ランプ）を導電要素として
    // 扱うと「CR1コイル → PL1ランプ」の2負荷直列という物理的に存在しない経路ができ、そこから
    // T1 のb接点へ回り込んで「T1 が自分のコイルを切っている」と誤検出してしまう。
    const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-005');
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    for (const wireId of ['sw-002', 'sw-009']) {
      for (const kind of ['wire-open', 'wire-missing'] as const) {
        const netlist = faultedNetlist(problem, { target: { wireId }, kind });
        expect(findForbiddenPatterns(netlist), `${wireId} / ${kind}`).toEqual([]);
      }
    }
  });

  it('never blames a timer for a single broken or missing wire on any built-in board', () => {
    let boards = 0;
    for (const problem of BUILTIN_ASSEMBLE_PROBLEMS) {
      for (const wireId of faultableWireIds(problem)) {
        for (const kind of ['wire-open', 'wire-missing'] as const) {
          const netlist = faultedNetlist(problem, { target: { wireId }, kind });
          expect(findForbiddenPatterns(netlist), `${problem.id} / ${wireId} / ${kind}`).toEqual([]);
          boards += 1;
        }
      }
    }
    expect(boards).toBeGreaterThan(100);
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
