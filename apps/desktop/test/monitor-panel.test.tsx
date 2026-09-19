import { PLC_UNIT_FX5U } from '@ojt/board-model';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { MonitorPanel } from '../src/renderer/ladder/MonitorPanel.js';

function snapshot(overrides: Partial<PlcMonitorSnapshot> = {}): PlcMonitorSnapshot {
  return {
    scanCount: 12,
    tMs: 120,
    powered: {},
    inputs: [true, false, false],
    outputs: [false, true],
    internals: { 0: true },
    timers: { 0: { elapsedMs: 1200, on: false } },
    counters: { 0: { value: 2, on: false } },
    ...overrides,
  };
}

function panel(onPlc = vi.fn()): ReturnType<typeof vi.fn> {
  render(<MonitorPanel profile={MITSUBISHI_FX5U} unit={PLC_UNIT_FX5U} onPlc={onPlc} />);
  return onPlc;
}

beforeEach(() => {
  useStore.setState({ plcMonitor: undefined, plcRunning: false, ladderMode: 'write' });
});

afterEach(cleanup);

describe('モニタ一覧（§10.7）', () => {
  it('asks to start monitoring while it is off', () => {
    panel();
    expect(screen.getByTestId('monitor-off')).toHaveTextContent('F3');
  });

  it('lists the devices with the dialect name and the unit terminal name (決定表#16)', () => {
    useStore.setState({ plcMonitor: snapshot(), ladderMode: 'monitor', plcRunning: true });
    panel();
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('X0');
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('PLC.X0');
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('ON');
    expect(screen.getByTestId('monitor-output-1')).toHaveTextContent('Y1');
    expect(screen.getByTestId('monitor-output-1')).toHaveTextContent('ON');
    expect(screen.getByTestId('monitor-internal-0')).toHaveTextContent('M0');
    expect(screen.getByTestId('monitor-timer-0')).toHaveTextContent('1.2');
    expect(screen.getByTestId('monitor-counter-0')).toHaveTextContent('2');
    expect(screen.getByTestId('monitor-scan')).toHaveTextContent('12');
  });

  it('names the FX5U input spec, not the engine defaults (3A レビュー指摘)', () => {
    useStore.setState({ plcMonitor: snapshot(), ladderMode: 'monitor' });
    panel();
    const note = screen.getByTestId('monitor-spec');
    expect(note).toHaveTextContent('4.5');
    expect(note).toHaveTextContent('3.5');
    expect(note).not.toHaveTextContent('4.7');
  });

  it('runs and stops the PLC through the worker (ツールバーの控え。決定表#9b)', () => {
    const onPlc = panel();
    fireEvent.click(screen.getByTestId('monitor-run'));
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: true });
    expect(useStore.getState().plcRunning).toBe(true);
    fireEvent.click(screen.getByTestId('monitor-run'));
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: false });
    expect(useStore.getState().plcRunning).toBe(false);
  });

  it('explains why nothing moves while the PLC is stopped', () => {
    useStore.setState({ plcMonitor: snapshot(), ladderMode: 'monitor', plcRunning: false });
    panel();
    expect(screen.getByTestId('monitor-stopped')).toHaveTextContent('RUN');
  });

  it('resets the devices from the panel', () => {
    const onPlc = panel();
    fireEvent.click(screen.getByTestId('plc-reset'));
    expect(onPlc).toHaveBeenCalledWith({ kind: 'reset' });
  });
});
