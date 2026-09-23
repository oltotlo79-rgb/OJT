import { guideIndexFor } from './wiring-guide.js';
import { buildHighlightIndex, isAssembleProblem } from '@ojt/content';
import { boardForProblem } from './plc-session.js';
import { addWire, removeWire, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import type { TerminalId, WireColor } from '@ojt/circuit-sim';
import { cloneSession, type CommandResult } from './commands.js';
import { useStore } from '../app/store.js';
import { bridge } from './worker-bridge.js';

/** Validate in a candidate. Failure or cancellation never removes the original wire. */
export function reconnectWire(
  source: BoardSession,
  board: BoardDefinition,
  id: string,
  from: TerminalId,
  to: TerminalId,
  color: WireColor,
): CommandResult<BoardSession> {
  const before = cloneSession(source),
    candidate = cloneSession(source);
  const removed = removeWire(candidate, id);
  if (!removed.ok) return removed;
  const added = addWire(candidate, board, from, to, color, { id });
  if (!added.ok) return added;
  added.value.open = removed.value.open;
  if (source.wireAnnotations?.[id] !== undefined)
    candidate.wireAnnotations = {
      ...candidate.wireAnnotations,
      [id]: structuredClone(source.wireAnnotations[id]),
    };
  if (source.wireRoutePreferences?.[id] !== undefined)
    candidate.wireRoutePreferences = {
      ...candidate.wireRoutePreferences,
      [id]: structuredClone(source.wireRoutePreferences[id]),
    };
  return {
    ok: true,
    value: candidate,
    command: {
      kind: 'reconnectWire',
      label: `接続先変更 ${id}: ${from} → ${to}`,
      before,
      after: cloneSession(candidate),
    },
  };
}

export function commitWireEdit(result: CommandResult<BoardSession>): boolean {
  const store = useStore.getState();
  if (!result.ok) {
    store.toast(result.message, 'error');
    return false;
  }
  if (store.snapshot.powered || store.plcRunning || store.replay !== undefined) {
    store.toast('編集する前に盤電源をOFFにしてPLCを停止してください。', 'error');
    return false;
  }
  const before = result.command.before,
    after = result.command.after;
  for (const wire of before.wires) {
    const next = after.wires.find((candidate) => candidate.id === wire.id);
    if (
      next === undefined ||
      next.from !== wire.from ||
      next.to !== wire.to ||
      next.color !== wire.color
    )
      bridge.send({ type: 'removeWire', wireId: wire.id });
  }
  for (const wire of after.wires) {
    const previous = before.wires.find((candidate) => candidate.id === wire.id);
    if (
      previous === undefined ||
      previous.from !== wire.from ||
      previous.to !== wire.to ||
      previous.color !== wire.color
    )
      bridge.send({ type: 'addWire', wire });
  }
  store.setSession(cloneSession(after));
  store.pushHistory(result.command);
  store.addLog(result.command.label);
  return true;
}

export function focusWiring(terminals: readonly string[], wireIds: readonly string[] = []): void {
  const store = useStore.getState();
  const index =
    store.session === undefined || store.problem === undefined
      ? undefined
      : store.circuit !== undefined
        ? buildHighlightIndex(store.circuit.cells, store.session)
        : isAssembleProblem(store.problem)
          ? guideIndexFor({
              doc: store.schematicDoc,
              problem: store.problem,
              board: boardForProblem(store.problem),
              session: store.session,
            })
          : undefined;
  const cellIds =
    index === undefined
      ? []
      : [...index.values()]
          .filter(
            (cell) =>
              cell.terminals.some((terminal) => terminals.includes(terminal)) ||
              cell.wireIds.some((id) => wireIds.includes(id)),
          )
          .map((cell) => cell.cellId);
  store.setHighlight({ terminals, wireIds, cellIds });
  store.setSelectedWire(wireIds[0]);
  store.setBoardFocus({
    from: store.route === 'result' ? 'result' : 'diagnosis',
    text: `${terminals.join(' ／ ')} を確認します`,
  });
  if (store.problem?.mode === 'plc') store.setLadderView('split');
  else store.setAssembleView('board');
}
