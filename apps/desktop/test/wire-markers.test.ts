import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId, wireId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildInspectRepairCircuit,
  buildReferenceSession,
} from '@ojt/content';
import { layout } from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { buildWireMarkIndex, wireMarker } from '../src/renderer/session/wire-markers.js';
import { safeRoutes } from '../src/renderer/session/wire-routes.js';
import { wireMarkerPoses } from '../src/renderer/three/WireMarker.js';

describe('回路図と3D配線の線番', () => {
  it.each(BUILTIN_INSPECT_REPAIR_PROBLEMS)(
    '$id: 模範配線の両端と回路図の線番が一致する',
    (problem) => {
      const built = buildReferenceSession(problem, JIPM_BOARD);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      const index = buildWireMarkIndex(problem, JIPM_BOARD);
      const printed = new Set(
        layout(problem.schematic, { wireNumbers: index.nodes })
          .shapes.filter((shape) => shape.kind === 'text' && shape.role === 'wire-number')
          .map((shape) => (shape.kind === 'text' ? shape.text : '')),
      );
      for (const wire of built.value.session.wires) {
        const number = index.wires.get(wire.id);
        expect(number, wire.id).toBeDefined();
        expect(number).toBe(index.terminals.get(wire.from));
        expect(number).toBe(index.terminals.get(wire.to));
        expect(printed.has(number!)).toBe(true);
      }
    },
  );
  it('誤配線・断線が起きても既設線の印字を付け替えない', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0]!;
    const built = buildReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const index = buildWireMarkIndex(problem, JIPM_BOARD);
    const wire = built.value.session.wires[0]!;
    const changed = { ...wire, to: toTerminalId('TB_PL.4+'), open: true };
    expect(wireMarker(index, changed)).toBe(wireMarker(index, wire));
    const repair = { ...wire, id: wireId('w-999'), color: '白' as const };
    expect(wireMarker(index, repair)).toBe(index.terminals.get(wire.from));
  });
  it.each(BUILTIN_INSPECT_REPAIR_PROBLEMS)(
    '$id: 出線の直線部に両端のチューブを置ける',
    (problem) => {
      for (const built of [
        buildReferenceSession(problem, JIPM_BOARD),
        buildInspectRepairCircuit(problem, JIPM_BOARD, { seed: 42 }),
      ]) {
        if (!built.ok) throw new Error(JSON.stringify(built.errors));
        const routed = safeRoutes(JIPM_BOARD, built.value.session);
        expect(routed.errors).toHaveLength(0);
        for (const route of routed.routes) {
          const poses = wireMarkerPoses(route);
          expect(
            poses,
            `${problem.id}/${route.wireId}: ${JSON.stringify(route.points)}`,
          ).toHaveLength(2);
          expect(poses.every((pose) => pose.position.toArray().every(Number.isFinite))).toBe(true);
          expect(poses[0]!.position.distanceTo(poses[1]!.position)).toBeGreaterThan(2.5);
        }
      }
    },
  );
});
