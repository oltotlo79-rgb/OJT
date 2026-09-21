import { toInspectWorkFile } from '../src/renderer/session/work-file.js';
import { JIPM_BOARD } from '@ojt/board-model';
import {
  buildInspectRepairCircuit,
  buildPlcReferenceSession,
  buildReferenceSession,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  BUILTIN_PROBLEMS,
  judgeAssemble,
  judgeInspectRepair,
  judgePlc,
  operationWindows,
  type Operation,
  type TimeChart,
} from '@ojt/content';
import { terminalId, type Mismatch } from '@ojt/circuit-sim';
import { afterEach, describe, expect, it } from 'vitest';
import { replaySteps, startReplay, stopReplay } from '../src/renderer/session/replay.js';
import { createReplay } from '../src/worker/replay.js';
import { useStore } from '../src/renderer/app/store.js';
import { intentOf, pickToAction } from '../src/renderer/session/interaction.js';
import type { ReplaySource } from '../src/worker/protocol.js';

const ops: Operation[] = Array.from({ length: 6 }, (_unused, i) => ({
  t: i * 100,
  target: 'PB1',
  action: i % 2 === 0 ? 'press' : 'release',
}));
const mismatch: Mismatch = {
  tMs: 200,
  signal: 'PL1',
  expected: true,
  actual: false,
  reason: 'value',
};
afterEach(() => {
  useStore.getState().abandonSession();
});

describe('見直しの区間と表示名', () => {
  it('6操作のうち境界の差分を1区間だけに付け、最後を判定終了まで延ばす', () => {
    const steps = replaySteps(ops, 1000, [mismatch]);
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.mismatched)).toEqual([false, false, true, false, false, false]);
    expect(steps[2]?.mismatchNote).toContain('白ランプ（PL1）');
    expect(steps[0]?.action).toContain('黒押ボタン（PB1）');
    expect(steps[5]?.toMs).toBe(1000);
    expect(replaySteps(ops, 1000, []).every((step) => !step.mismatched)).toBe(true);
  });
  it('操作前と最後のtickの差分を落とさず、同時操作を分離しない', () => {
    const steps = replaySteps(
      [
        { t: 100, target: 'PB1', action: 'press' },
        { t: 100, target: 'PB2', action: 'release' },
      ],
      1000,
      [
        { ...mismatch, tMs: 0 },
        { ...mismatch, tMs: 990 },
      ],
    );
    expect(steps).toHaveLength(2);
    expect(steps.every((step) => step.mismatched)).toBe(true);
    expect(steps[1]?.action).toContain('黄押ボタン（PB2）を離す');
  });
  it('期待する動きは模範波形から時刻つきで求める', () => {
    const chart: TimeChart = {
      durationMs: 1000,
      markers: [],
      signals: [
        {
          name: 'PL1',
          label: '',
          kind: 'output',
          segments: [
            { fromMs: 0, toMs: 500, value: false },
            { fromMs: 500, toMs: 1000, value: true },
          ],
        },
      ],
    };
    expect(replaySteps([], 1000, [], chart)[0]?.expect).toBe('白ランプ（PL1）：0秒 OFF → 0.5秒 ON');
  });
  it('見直し中は端子・部品・電源の操作を同じ入口で拒否する', () => {
    const state = { ...useStore.getState(), replaying: true };
    for (const hit of [
      { kind: 'fixture', fixture: 'breaker' },
      { kind: 'terminal', id: terminalId('P', '1'), wirable: true, label: 'P.1' },
    ] as const) {
      expect(intentOf(state, hit)).toEqual({ type: 'none' });
      expect(pickToAction(state, hit)).toEqual({ type: 'none' });
    }
  });
});

function assertFrames(source: ReplaySource, chart: TimeChart): void {
  const before = structuredClone(source);
  const engine = createReplay(source);
  const windows = operationWindows(source.problem.operations, source.problem.durationMs);
  windows.forEach((window, index) => {
    const frame = engine.frame(index);
    for (const signal of chart.signals.filter((s) => s.name.startsWith('PL'))) {
      const value = signal.segments.find(
        (s) => s.fromMs <= window.toMs - 10 && s.toMs > window.toMs - 10,
      )?.value;
      expect(
        frame.lamps[signal.name]?.level === 'lit',
        `${source.problem.id} ${index} ${signal.name}`,
      ).toBe(value);
    }
    expect(frame.hazardDelta).toEqual([]);
    expect(frame.logDelta).toEqual([]);
  });
  expect(source).toEqual(before);
  const first = engine.frame(0);
  expect(engine.frame(0)).toEqual(first);
  expect(() => engine.frame(-1)).toThrow();
  expect(() => engine.frame(windows.length)).toThrow();
  expect(() => engine.frame(0.5)).toThrow();
}

describe('実際の採点と再生の一致・元の作業の保護', () => {
  it('モードBの配線不足を含む提出物で一致する', () => {
    const problem = BUILTIN_PROBLEMS[0]!;
    const built = buildReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('reference');
    built.value.session.wires.pop();
    const judge = judgeAssemble(problem, JIPM_BOARD, built.value.session);
    if (!judge.ok) throw new Error('judge');
    assertFrames(
      { mode: 'assemble', problem, session: built.value.session },
      judge.value.charts.actual,
    );
    useStore.getState().openProblem(problem);
    useStore.setState({ session: built.value.session, judge: judge.value, elapsedMs: 12345 });
    const before = useStore.getState();
    expect(startReplay()).toBe(true);
    expect(toInspectWorkFile()).toBeUndefined();
    expect(startReplay()).toBe(false);
    useStore.setState({ snapshot: createReplay(useStore.getState().replay!.source).frame(0) });
    stopReplay();
    expect(useStore.getState()).toMatchObject({
      session: before.session,
      judge: before.judge,
      snapshot: before.snapshot,
      elapsedMs: 12345,
      replay: undefined,
    });
    stopReplay();
  });
  it('モードC2は解決済みの故障を同じまま再生する', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0]!;
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('circuit');
    const judge = judgeInspectRepair(problem, JIPM_BOARD, built.value, []);
    if (!judge.ok) throw new Error('judge');
    assertFrames(
      { mode: 'inspect-repair', problem, circuit: built.value },
      judge.value.charts.actual,
    );
  });
  it('モードDのスキャンとタイマも採点と一致する', () => {
    const problem = BUILTIN_PLC_PROBLEMS[2]!;
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('reference');
    const ladder = problem.referenceLadder;
    const judge = judgePlc(problem, JIPM_BOARD, built.value.session, ladder);
    if (!judge.ok) throw new Error('judge');
    const source = { mode: 'plc', problem, session: built.value.session, ladder } as const;
    assertFrames(source, judge.value.charts.actual);
    expect(createReplay(source).frame(0).plc).toBeDefined();
  });
  it('未判定では開始しない', () => {
    expect(startReplay()).toBe(false);
  });
});
