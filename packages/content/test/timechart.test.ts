import { JIPM_BOARD } from '@ojt/board-model';
import { SignalLog } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { buildReferenceSession } from '../src/reference.js';
import { runOperations } from '../src/runner.js';
import {
  buildTimeChart,
  defaultChartSignals,
  startsAndEndsLow,
  timerMarkers,
} from '../src/timechart.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

function logWith(entries: readonly [number, boolean][]): SignalLog {
  const log = new SignalLog();
  for (const [tMs, value] of entries) log.record(tMs, new Map([['PL1', value]]));
  return log;
}

describe('buildTimeChart', () => {
  it('turns run-length entries into contiguous segments', () => {
    const chart = buildTimeChart(
      logWith([
        [0, false],
        [500, true],
        [1500, false],
      ]),
      [{ name: 'PL1', label: '白ランプ', kind: 'output' }],
      2000,
    );
    expect(chart.signals[0]?.segments).toEqual([
      { fromMs: 0, toMs: 500, value: false },
      { fromMs: 500, toMs: 1500, value: true },
      { fromMs: 1500, toMs: 2000, value: false },
    ]);
  });

  it('produces one false segment for a signal that never appears', () => {
    const chart = buildTimeChart(new SignalLog(), defaultChartSignals(['PL1']), 1000);
    for (const signal of chart.signals) {
      expect(signal.segments).toEqual([{ fromMs: 0, toMs: 1000, value: false }]);
    }
    expect(startsAndEndsLow(chart)).toBe(true);
  });

  it('handles a signal that is already high at t=0', () => {
    const chart = buildTimeChart(
      logWith([
        [0, true],
        [300, false],
      ]),
      [{ name: 'PL1', label: '白ランプ', kind: 'output' }],
      1000,
    );
    expect(chart.signals[0]?.segments[0]).toEqual({ fromMs: 0, toMs: 300, value: true });
    expect(startsAndEndsLow(chart)).toBe(false);
  });

  it('drops entries beyond the duration', () => {
    const chart = buildTimeChart(
      logWith([
        [0, false],
        [500, true],
        [3000, false],
      ]),
      [{ name: 'PL1', label: '白ランプ', kind: 'output' }],
      1000,
    );
    expect(chart.signals[0]?.segments).toEqual([
      { fromMs: 0, toMs: 500, value: false },
      { fromMs: 500, toMs: 1000, value: true },
    ]);
  });

  it('puts the push buttons above the outputs', () => {
    const specs = defaultChartSignals(['PL1', 'BZ']);
    expect(specs.map((s) => s.name)).toEqual(['PB1', 'PB2', 'PB3', 'PB4', 'PL1', 'BZ']);
    expect(specs.filter((s) => s.kind === 'input')).toHaveLength(4);
    expect(specs[0]?.label).toBe('黒押ボタン（PB1）');
    expect(specs[5]?.label).toBe('ブザー（BZ）');
    expect(defaultChartSignals(['X9'])[4]?.label).toBe('X9');
  });

  it('keeps the markers it is given', () => {
    const chart = buildTimeChart(new SignalLog(), [], 1000, [{ tMs: 300, label: 'T1=0.3秒' }]);
    expect(chart.markers).toEqual([{ tMs: 300, label: 'T1=0.3秒' }]);
  });
});

describe('timerMarkers', () => {
  it('labels each timer with its preset', () => {
    const problem = parseOrThrow({
      ...selfHoldProblemJson(),
      schematic: {
        formatVersion: 1,
        id: 'sch-x-003',
        title: 'タイマ2個',
        orientation: 'horizontal',
        rungs: [
          {
            id: 'r1',
            from: { bus: 'P' },
            to: { bus: 'N' },
            cells: [
              { kind: 'pb-a', id: 'c01', device: 'PB1' },
              { kind: 'coil', id: 'c02', device: 'T1', presetMs: 3000 },
            ],
          },
          {
            id: 'r2',
            from: { bus: 'P' },
            to: { bus: 'N' },
            cells: [
              { kind: 't-a', id: 'c03', device: 'T1' },
              { kind: 'coil', id: 'c04', device: 'T2', presetMs: 1500 },
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
      },
    });
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(timerMarkers(built.value.netlist)).toEqual([
      { tMs: 3000, label: 'T1=3秒' },
      { tMs: 1500, label: 'T2=1.5秒' },
    ]);
  });

  it('returns nothing when the circuit has no timer', () => {
    const problem = parseOrThrow(selfHoldProblemJson());
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(timerMarkers(built.value.netlist)).toEqual([]);
    const run = runOperations(built.value.netlist, problem.operations, {
      durationMs: problem.durationMs,
    });
    const chart = buildTimeChart(run.log, defaultChartSignals(['PL1']), problem.durationMs);
    expect(startsAndEndsLow(chart)).toBe(true);
  });
});
