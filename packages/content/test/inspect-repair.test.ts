import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { findPart, loadOhms, toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  addedWireIds,
  buildInspectRepairCircuit,
  INITIAL_WIRE_COLOR,
  modificationWireIds,
  repairNetlist,
  replacePart,
  REPAIR_WIRE_COLOR,
} from '../src/inspect-repair.js';
import { runOperations } from '../src/runner.js';
import { inspectRepairProblemJson, parseInspectRepairOrThrow } from './helpers/inspect.js';

/** 既定の課題（`sw-005` 断線 ＋ `sw-009` 未配線）で初期盤を作る。 */
function circuit() {
  const problem = parseInspectRepairOrThrow(inspectRepairProblemJson());
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

describe('buildInspectRepairCircuit', () => {
  it('starts from the blue reference wiring and only allows white for repairs (§8.1 / §9.2)', () => {
    const { circuit: c } = circuit();
    expect(INITIAL_WIRE_COLOR).toBe('青');
    expect(REPAIR_WIRE_COLOR).toBe('白');
    expect(c.session.allowedColors).toEqual(['白']);
    for (const wire of c.session.wires) expect(wire.color).toBe('青');
  });

  it('applies the faults to the board the trainee sees', () => {
    const { circuit: c } = circuit();
    expect(c.session.wires.find((w) => w.id === 'sw-005')?.open).toBe(true);
    expect(c.session.wires.some((w) => w.id === 'sw-009')).toBe(false);
    expect(c.applied.sites).toHaveLength(2);
    expect(c.initialWireIds).not.toContain('sw-009');
    expect(c.initialWireIds).toContain('sw-005');
  });

  it('exposes the schematic cell assignment for the linked highlight (§9.2)', () => {
    const { circuit: c } = circuit();
    const coil = c.cells.find((cell) => cell.cellId === 'c03');
    expect(coil?.device).toBe('CR1');
    expect(coil?.left).toBe('CR1.14');
    expect(coil?.right).toBe('CR1.13');
  });

  it('reports a bad fault target as a problem issue (§13 #2)', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      faults: [{ target: { wireId: 'sw-999' }, kind: 'wire-open' }],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.message).toContain('sw-999');
  });
});

describe('repairNetlist', () => {
  it('re-injects the part faults every time the netlist is rebuilt', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      faults: [
        { target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-layer-short', ratio: 0.65 },
      ],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const { netlist, errors } = repairNetlist(built.value, JIPM_BOARD);
    expect(errors).toEqual([]);
    const coil = findPart(netlist, 'CR1')?.elements[0];
    expect(coil !== undefined && coil.kind === 'load' ? loadOhms(coil) : 0).toBeCloseTo(422.5, 3);
  });

  it('leaves the part healthy after a replacement (§9.2 部品交換)', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      faults: [{ target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-open' }],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const replaced = replacePart(built.value, 'CR1');
    expect(replaced.applied.partFaults).toHaveLength(0);
    // 指摘の対象としては残る（交換しても不良だった事実は消えない。§9.2 判定①）
    expect(replaced.applied.sites).toHaveLength(1);
    const { netlist } = repairNetlist(replaced, JIPM_BOARD);
    const coil = findPart(netlist, 'CR1')?.elements[0];
    expect(coil !== undefined && coil.kind === 'load' ? loadOhms(coil) : 0).toBeCloseTo(650, 3);
  });

  it('runs the faulted board and gets a different waveform from the reference', () => {
    const { problem, circuit: c } = circuit();
    const { netlist } = repairNetlist(c, JIPM_BOARD);
    const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
    expect(run.log.transitions('PL1').some((e) => e.value === true)).toBe(false);
  });
});

describe('modificationWireIds / addedWireIds', () => {
  it('counts nothing when the trainee has not touched the board', () => {
    const { circuit: c } = circuit();
    expect(modificationWireIds(c, c.session)).toEqual([]);
    expect(addedWireIds(c, c.session)).toEqual([]);
  });

  it('does not count removing a faulty wire as a modification (§9.2)', () => {
    const { circuit: c } = circuit();
    const removed = removeWire(c.session, 'sw-005');
    expect(removed.ok).toBe(true);
    expect(modificationWireIds(c, c.session)).toEqual([]);
  });

  it('counts removing a healthy blue wire as a modification (§9.2 改造)', () => {
    const { circuit: c } = circuit();
    const removed = removeWire(c.session, 'sw-004');
    expect(removed.ok).toBe(true);
    expect(modificationWireIds(c, c.session)).toEqual(['sw-004']);
  });

  it('lists the wires the trainee added', () => {
    const { circuit: c } = circuit();
    const added = addWire(
      c.session,
      JIPM_BOARD,
      toTerminalId('CR1.6'),
      toTerminalId('TB_PL.1+'),
      REPAIR_WIRE_COLOR,
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(addedWireIds(c, c.session)).toEqual([added.value.id]);
  });

  it('refuses a blue repair wire because the palette is white only (§8.1)', () => {
    const { circuit: c } = circuit();
    const added = addWire(
      c.session,
      JIPM_BOARD,
      toTerminalId('CR1.6'),
      toTerminalId('TB_PL.1+'),
      INITIAL_WIRE_COLOR,
    );
    expect(added.ok).toBe(false);
    if (added.ok) return;
    expect(added.code).toBe('color-not-allowed');
  });
});
