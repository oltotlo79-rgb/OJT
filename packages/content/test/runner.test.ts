import { JIPM_BOARD } from '@ojt/board-model';
import { Simulation, terminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { buildReferenceSession } from '../src/reference.js';
import {
  createOperationPlayback,
  operationWindows,
  powerUp,
  runOperations,
} from '../src/runner.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

function referenceNetlist() {
  const problem = parseOrThrow(selfHoldProblemJson());
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, netlist: built.value.netlist };
}

describe('runOperations', () => {
  it('powers up in the right order and records no hazard', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
    expect(run.events.hazards()).toEqual([]);
    expect(run.simulation.state().powered).toBe(true);
    expect(run.lastTickMs).toBe(problem.durationMs - 10);
  });

  it('applies each operation at the tick it is scheduled for', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
    expect(run.log.valueAt('PB1', 490)).toBe(false);
    expect(run.log.valueAt('PB1', 500)).toBe(true);
    expect(run.log.valueAt('PB1', 790)).toBe(true);
    expect(run.log.valueAt('PB1', 800)).toBe(false);
  });

  it('keeps the self hold after the button is released', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
    expect(run.log.valueAt('PL1', 1000)).toBe(true);
    expect(run.log.valueAt('PL1', 4000)).toBe(false);
  });

  it('is deterministic', () => {
    const first = referenceNetlist();
    const second = referenceNetlist();
    const a = runOperations(first.netlist, first.problem.operations, {
      durationMs: first.problem.durationMs,
    });
    const b = runOperations(second.netlist, second.problem.operations, {
      durationMs: second.problem.durationMs,
    });
    expect(a.log.entries()).toEqual(b.log.entries());
  });

  it('records the watched terminal voltages', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, {
      durationMs: 1000,
      watch: [terminalId('CR1', '14')],
    });
    expect(run.log.signals()).toContain('V:CR1.14');
  });

  it('accepts a custom tick length', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, { durationMs: 1000, tickMs: 20 });
    expect(run.lastTickMs).toBe(980);
  });

  it('applies an operation that falls between two ticks at the next tick', () => {
    const { netlist } = referenceNetlist();
    const run = runOperations(netlist, [{ t: 5, target: 'PB1', action: 'press' }], {
      durationMs: 100,
    });
    expect(run.log.valueAt('PB1', 0)).toBe(false);
    expect(run.log.valueAt('PB1', 10)).toBe(true);
  });

  it('applies an operation that no tick lands on with a custom tick length', () => {
    const { netlist } = referenceNetlist();
    const run = runOperations(netlist, [{ t: 500, target: 'PB1', action: 'press' }], {
      durationMs: 1000,
      tickMs: 15,
    });
    expect(run.log.valueAt('PB1', 495)).toBe(false);
    expect(run.log.valueAt('PB1', 510)).toBe(true);
  });

  it('keeps the order of operations that share a tick (§7.3)', () => {
    const pressThenRelease = referenceNetlist();
    const released = runOperations(
      pressThenRelease.netlist,
      [
        { t: 0, target: 'PB1', action: 'press' },
        { t: 0, target: 'PB1', action: 'release' },
      ],
      { durationMs: 100 },
    );
    expect(released.log.valueAt('PB1', 0)).toBe(false);

    const releaseThenPress = referenceNetlist();
    const pressed = runOperations(
      releaseThenPress.netlist,
      [
        { t: 0, target: 'PB1', action: 'release' },
        { t: 0, target: 'PB1', action: 'press' },
      ],
      { durationMs: 100 },
    );
    expect(pressed.log.valueAt('PB1', 0)).toBe(true);
  });
});

describe('powerUp', () => {
  it('does not raise a power sequence hazard', () => {
    const { netlist } = referenceNetlist();
    const simulation = new Simulation(netlist);
    powerUp(simulation);
    expect(simulation.events.countOf('power-sequence-violation')).toBe(0);
  });

  it('the reverse order does raise two (§5.3.5)', () => {
    const { netlist } = referenceNetlist();
    const simulation = new Simulation(netlist);
    simulation.setSwitch(true);
    simulation.setBreaker(true);
    expect(simulation.events.countOf('power-sequence-violation')).toBe(2);
  });
});

describe('採点と見直しの共通実行器', () => {
  it('小刻みに止めても操作・tick・ログが一括採点と一致する', () => {
    const first = referenceNetlist();
    const second = referenceNetlist();
    const ticks: number[] = [];
    const simulation = new Simulation(second.netlist);
    const playback = createOperationPlayback(simulation, second.problem.operations, {
      durationMs: second.problem.durationMs,
      beforeTick: (_sim, t) => {
        ticks.push(t);
      },
    });
    for (let t = 0; t <= second.problem.durationMs; t += 50) playback.advanceUntil(t);
    const last = playback.advanceUntil(second.problem.durationMs + 5000);
    const full = runOperations(first.netlist, first.problem.operations, {
      durationMs: first.problem.durationMs,
    });
    expect(last.log.entries()).toEqual(full.log.entries());
    expect(last.events.hazards()).toEqual(full.events.hazards());
    expect(last.lastTickMs).toBe(full.lastTickMs);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(playback.advanceUntil(0).lastTickMs).toBe(full.lastTickMs);
  });
  it.each([0, -10, NaN, Infinity])('無効なtick=%sを拒否して無限ループを防ぐ', (tickMs) => {
    expect(() =>
      createOperationPlayback(new Simulation(referenceNetlist().netlist), [], {
        durationMs: 100,
        tickMs,
      }),
    ).toThrow();
  });
  it.each([-1, NaN, Infinity])('無効な再生時刻=%sを拒否する', (until) => {
    const playback = createOperationPlayback(new Simulation(referenceNetlist().netlist), [], {
      durationMs: 100,
    });
    expect(() => playback.advanceUntil(until)).toThrow();
  });
  it('無操作と開始前の通電区間・同時操作・終端を正しく区切る', () => {
    expect(operationWindows([], 100)).toEqual([{ fromMs: 0, toMs: 100, operations: [] }]);
    const ops = [
      { t: 5, target: 'PB1', action: 'press' },
      { t: 10, target: 'PB2', action: 'press' },
      { t: 100, target: 'PB1', action: 'release' },
    ] as const;
    expect(operationWindows(ops, 100)).toEqual([
      { fromMs: 0, toMs: 10, operations: [] },
      { fromMs: 10, toMs: 100, operations: ops.slice(0, 2) },
    ]);
  });
});
