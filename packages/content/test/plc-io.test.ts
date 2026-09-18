import { JIPM_BOARD } from '@ojt/board-model';
import { Simulation, TICK_MS } from '@ojt/circuit-sim';
import {
  compile,
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { createPlcCoupling, createSimulationIoPort, runPlcOperations } from '../src/plc-io.js';
import { buildPlcReferenceSession, type PlcReferenceCircuit } from '../src/plc-reference.js';
import { PlcProblemSchema, type PlcProblem } from '../src/schema/plc.js';
import { plcProblemJson } from './helpers/plc.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** 模範配線（Task 14）で組んだ盤とネットリスト。 */
function reference(): { problem: PlcProblem; circuit: PlcReferenceCircuit } {
  const problem = PlcProblemSchema.parse(plcProblemJson());
  const built = buildPlcReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

describe('createSimulationIoPort', () => {
  it('reads the simulation inputs and writes its outputs (§10.4)', () => {
    const { circuit } = reference();
    const sim = new Simulation(circuit.netlist);
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.step();
    const port = createSimulationIoPort(sim);
    expect(port.readInputs()[0]).toBe(false);
    sim.press('PB1');
    sim.step();
    expect(port.readInputs()[0]).toBe(true);
    port.writeOutputs([true]);
    sim.step();
    expect(sim.state().plcs['PLC']?.outputs[0]).toBe(true);
  });
});

describe('createPlcCoupling', () => {
  it('runs exactly one scan per tick (§10.4)', () => {
    const { circuit } = reference();
    const sim = new Simulation(circuit.netlist);
    const coupling = createPlcCoupling(sim, circuit.program);
    sim.setBreaker(true);
    sim.setSwitch(true);
    for (let i = 0; i < 5; i += 1) {
      coupling.beforeTick(sim, sim.tMs);
      sim.step();
    }
    expect(coupling.runtime.scanCount).toBe(5);
    expect(coupling.runtime.tMs).toBe(5 * TICK_MS);
  });
});

describe('runPlcOperations', () => {
  it('lights the lamp through the PLC, the relay and the two-stage wiring (§10.2 / §16 Phase 3 ③)', () => {
    const { problem, circuit } = reference();
    const result = runPlcOperations(circuit.netlist, circuit.program, problem.operations, {
      durationMs: problem.durationMs,
    });
    const transitions = result.log.transitions('PL1');
    expect(transitions.some((e) => e.value === true)).toBe(true);
    // PB1 を押してから 3tick 以内（入力1スキャン遅れ＋コイル1tick＋接点1tick）で点く
    const litMs = transitions.find((e) => e.value === true)?.tMs ?? -1;
    expect(litMs).toBeGreaterThan(0);
    expect(litMs).toBeLessThanOrEqual(4 * TICK_MS);
    expect(result.runtime.scanCount).toBe(problem.durationMs / TICK_MS);
  });

  it('is deterministic (§5.2)', () => {
    const { problem, circuit } = reference();
    const once = runPlcOperations(circuit.netlist, circuit.program, problem.operations, {
      durationMs: problem.durationMs,
    }).log.entries();
    const second = reference();
    const twice = runPlcOperations(
      second.circuit.netlist,
      second.circuit.program,
      problem.operations,
      { durationMs: problem.durationMs },
    ).log.entries();
    expect(once).toEqual(twice);
  });

  it('leaves the lamp dark when the ladder never turns the output on', () => {
    const { problem, circuit } = reference();
    const idle = compile(program(network('n1', [rung(no(X(1)), out(Y(1)))]), endNetwork()));
    if (!idle.ok) throw new Error('変換に失敗しました');
    const result = runPlcOperations(circuit.netlist, idle.program, problem.operations, {
      durationMs: problem.durationMs,
    });
    expect(result.log.transitions('PL1').some((e) => e.value === true)).toBe(false);
  });
});
