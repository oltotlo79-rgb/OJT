import { toSessionTerminal } from '@ojt/board-model';
import { toTerminalId, type TerminalId, type Wire } from '@ojt/circuit-sim';
import { buildReferenceSession, type InspectRepairProblem } from '@ojt/content';
import type { BoardDefinition } from '@ojt/board-model';
import { nodeKey, resolveNode, schematicWireNumbers } from '@ojt/schematic-core';

export interface WireMarkIndex {
  nodes: ReadonlyMap<string, string>;
  terminals: ReadonlyMap<string, string>;
  wires: ReadonlyMap<string, string>;
  cellTerminals: Readonly<Record<string, readonly [TerminalId, TerminalId]>>;
}

/** 誤配線があっても元の電線の印字を維持するため、故障を入れる前の模範回路から採番する。 */
export function buildWireMarkIndex(
  problem: InspectRepairProblem,
  board: BoardDefinition,
): WireMarkIndex {
  const nodes = schematicWireNumbers(problem.schematic);
  const terminals = new Map<string, string>([
    ['P.1', 'P'],
    ['N.1', 'N'],
  ]);
  const wires = new Map<string, string>();
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return { nodes, terminals, wires, cellTerminals: {} };
  const { session, cells } = reference.value;
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));
  for (const rung of problem.schematic.rungs) {
    rung.cells.forEach((cell, index) => {
      const assigned = cellsById.get(cell.id);
      if (assigned === undefined) return;
      for (const [terminal, offset] of [
        [assigned.left, 0],
        [assigned.right, 1],
      ] as const) {
        const node = resolveNode(problem.schematic, rung, index + offset);
        const number = node === undefined ? undefined : nodes.get(nodeKey(node));
        if (number !== undefined) terminals.set(toSessionTerminal(session, terminal), number);
      }
    });
  }
  // 中継端子など、模範回路の渡り線も同じ番号にそろえる。
  for (let pass = 0; pass < session.wires.length; pass += 1) {
    let changed = false;
    for (const wire of session.wires) {
      const number = terminals.get(wire.from) ?? terminals.get(wire.to);
      if (number === undefined) continue;
      for (const end of [wire.from, wire.to]) {
        if (!terminals.has(end)) {
          terminals.set(end, number);
          changed = true;
        }
      }
      wires.set(wire.id, number);
    }
    if (!changed) break;
  }
  // 3Dで扱う物理ソケット端子も、同じ対応表で引けるようにする。
  for (const terminal of board.terminals) {
    const number = terminals.get(toSessionTerminal(session, toTerminalId(terminal.id)));
    if (number !== undefined) terminals.set(terminal.id, number);
  }
  const cellTerminals = Object.fromEntries(
    cells.map((cell) => [cell.cellId, [cell.left, cell.right] as const]),
  );
  return { nodes, terminals, wires, cellTerminals };
}

/** 既設線は元の印字を維持。新しい修復線は始点側の線番を両端へ付ける。 */
export function wireMarker(index: WireMarkIndex, wire: Wire): string {
  return (
    index.wires.get(wire.id) ??
    index.terminals.get(wire.from) ??
    index.terminals.get(wire.to) ??
    wire.id
  );
}
