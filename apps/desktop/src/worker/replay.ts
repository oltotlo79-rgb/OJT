import { JIPM_BOARD, toNetlist } from '@ojt/board-model';
import { Simulation } from '@ojt/circuit-sim';
import {
  buildPlcReferenceSession,
  createOperationPlayback,
  createPlcCoupling,
  operationWindows,
  repairNetlist,
  type PlcCoupling,
} from '@ojt/content';
import { compile } from '@ojt/ladder-core';
import type { ReplaySource, SimSnapshot } from './protocol.js';
import { lampsOf, relaysOf, timersOf, plcSnapshot, timerPresetsOf } from './snapshot.js';

export interface ReplayEngine {
  frame: (index: number) => SimSnapshot;
}

/** 採点と同じネットリスト・操作列・PLCスキャン。元のSimulationには触れない。 */
export function createReplay(source: ReplaySource): ReplayEngine {
  let sim: Simulation;
  let coupling: PlcCoupling | undefined;
  let presets: Record<number, number> = {};
  if (source.mode === 'plc') {
    const reference = buildPlcReferenceSession(source.problem, JIPM_BOARD);
    if (!reference.ok) throw new Error(reference.errors.map((issue) => issue.message).join(' / '));
    const compiled = compile(source.ladder);
    if (!compiled.ok) throw new Error(compiled.errors.map((issue) => issue.message).join(' / '));
    sim = new Simulation(toNetlist(source.session, reference.value.board));
    coupling = createPlcCoupling(sim, compiled.program, {
      outputCount: reference.value.unit.spec.outputs.length,
    });
    coupling.runtime.setRecordPowered(true);
    presets = timerPresetsOf(compiled.program);
  } else {
    if (source.mode === 'assemble') sim = new Simulation(toNetlist(source.session, JIPM_BOARD));
    else {
      const repaired = repairNetlist(source.circuit, JIPM_BOARD);
      if (repaired.errors.length > 0)
        throw new Error(repaired.errors.map((issue) => issue.message).join(' / '));
      sim = new Simulation(repaired.netlist);
    }
  }
  const windows = operationWindows(source.problem.operations, source.problem.durationMs);
  const playback = createOperationPlayback(sim, source.problem.operations, {
    durationMs: source.problem.durationMs,
    ...(coupling === undefined ? {} : { beforeTick: coupling.beforeTick }),
  });
  const frames: SimSnapshot[] = [];
  return {
    frame: (index) => {
      if (!Number.isInteger(index) || index < 0 || index >= windows.length)
        throw new Error('見直す区間を選び直してください');
      for (let next = frames.length; next <= index; next += 1) {
        playback.advanceUntil(windows[next]!.toMs);
        const state = sim.state();
        frames.push({
          tMs: state.tMs,
          breakerOn: state.breakerOn,
          switchOn: state.switchOn,
          powered: state.powered,
          tripped: state.tripped,
          sourceAmps: state.sourceAmps,
          buttons: { ...state.buttons },
          lamps: lampsOf(sim),
          relays: relaysOf(sim),
          timers: timersOf(sim),
          // 見直しのログ・危険操作を作業の記録へ足さない。
          logDelta: [],
          hazardDelta: [],
          chatterDelta: [],
          droppedTicks: 0,
          tester: {
            kind: 'digital',
            mode: 'off',
            value: Number.NaN,
            display: 'OFF',
            targetDeg: 0,
            needleDeg: 0,
            overRange: false,
            live: false,
            conductive: false,
          },
          ...(coupling === undefined ? {} : { plc: plcSnapshot(coupling, presets) }),
        });
      }
      return frames[index]!;
    },
  };
}
