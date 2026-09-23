import type { Simulation } from '@ojt/circuit-sim';
import type { PlcCoupling } from '@ojt/content';
import { IR_COLS, type CompiledProgram } from '@ojt/ladder-core';
import type { PlcMonitorSnapshot } from '../shared/plc-monitor.js';
import type { LampSnapshot, RelaySnapshot, TimerSnapshot } from './protocol.js';

export function lampsOf(sim: Simulation): Record<string, LampSnapshot> {
  const out: Record<string, LampSnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().lamps)) {
    out[id] = { level: runtime.level, volts: runtime.volts };
  }
  return out;
}

export function relaysOf(sim: Simulation): Record<string, RelaySnapshot> {
  const out: Record<string, RelaySnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().relays)) {
    out[id] = {
      coilOn: runtime.coilOn,
      contactsOn: runtime.contactsOn,
      coilVolts: runtime.coilVolts,
    };
  }
  return out;
}

export function timersOf(sim: Simulation): Record<string, TimerSnapshot> {
  const out: Record<string, TimerSnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().timers)) {
    out[id] = {
      powered: runtime.powered,
      elapsedMs: runtime.elapsedMs,
      presetMs: runtime.presetMs,
      timedOut: runtime.timedOut,
    };
  }
  return out;
}

export function timerPresetsOf(program: CompiledProgram): Record<number, number> {
  const presets: Record<number, number> = {};
  for (const net of program.networks) {
    for (const row of net.cells) {
      for (const cell of row) {
        if (cell.kind === 'timer') presets[cell.device.index] = cell.presetMs;
      }
    }
  }
  return presets;
}

export function plcSnapshot(
  coupling: PlcCoupling,
  presets: Record<number, number>,
): PlcMonitorSnapshot {
  const state = coupling.runtime.state();
  // ランタイムの `Map` を直接読む（`state()` 越しに `Record` を作り直さない。指摘 DW-1 ③）
  const cells = coupling.runtime.poweredCells;
  const powered: Record<string, string> = {};
  for (const net of coupling.runtime.program.networks) {
    if (net.isEnd) continue;
    let bits = '';
    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < IR_COLS; col += 1) {
        bits += cells.get(`${net.id}:${row}:${col}`) === true ? '1' : '0';
      }
    }
    powered[net.id] = bits;
  }
  return {
    diagnostics: coupling.runtime.diagnostics(),
    counterPresets: Object.fromEntries(
      coupling.runtime.program.networks.flatMap((net) =>
        net.outputs.flatMap((output) =>
          output.cell.kind === 'counter' ? [[output.cell.device.index, output.cell.preset]] : [],
        ),
      ),
    ),
    scanCount: state.scanCount,
    tMs: state.tMs,
    powered,
    inputs: [...state.inputs],
    outputs: [...state.outputs],
    internals: { ...state.internals },
    specials: { ...state.specials },
    timers: Object.fromEntries(
      Object.entries(state.timers).map(([index, value]) => [
        index,
        { ...value, presetMs: presets[Number(index)] ?? 0 },
      ]),
    ),
    counters: Object.fromEntries(
      Object.entries(state.counters).map(([index, value]) => [index, { ...value }]),
    ),
  };
}
