import { socketPartId } from '@ojt/board-model';
import type { FaultReport } from '@ojt/content';
import { useStore } from '../app/store.js';
import { boardForProblem } from './plc-session.js';
import { focusWiring } from './wire-edit.js';

/** 削除した線も初期配線・編集履歴の両端を使ってたどれる。 */
export function focusDiagnosticTarget(target: FaultReport['target']): void {
  const store = useStore.getState();
  if ('wireId' in target) {
    const current = store.session?.wires.find((wire) => wire.id === target.wireId);
    const old =
      store.circuit?.initialWires.find((wire) => wire.id === target.wireId) ??
      store.history.done
        .flatMap((command) => command.before.wires)
        .find((wire) => wire.id === target.wireId);
    const wire = current ?? old;
    const terminals =
      wire === undefined
        ? (store.circuit?.applied.sites.find((site) => site.wireId === target.wireId)?.terminals ??
          [])
        : [wire.from, wire.to];
    if (terminals.length === 0) {
      store.toast('この電線は削除済みで、保存された接続先がありません。', 'warn');
      return;
    }
    focusWiring(terminals, current === undefined ? [] : [target.wireId]);
    if (current === undefined)
      store.toast(
        `削除済みの ${target.wireId}：元の接続 ${terminals.join(' → ')} を表示しています。`,
      );
  } else if ('terminalId' in target) focusWiring([target.terminalId]);
  else {
    const terminals =
      store.session?.wires
        .flatMap((wire) => [wire.from, wire.to])
        .filter((terminal) => terminal.startsWith(`${target.partId}.`)) ?? [];
    const board = boardForProblem(store.problem);
    const socket = board.sockets.find(
      (item) =>
        store.session !== undefined &&
        socketPartId(store.session.socketRoles, item.id) === target.partId,
    );
    const physical = board.terminals
      .filter((terminal) => terminal.id.startsWith(`${socket?.id ?? target.partId}.`))
      .map((terminal) => terminal.id);
    const linked = board.fixedLinks
      .filter(
        (link) =>
          link.to.startsWith(`${target.partId}.`) || link.from.startsWith(`${target.partId}.`),
      )
      .flatMap((link) => [link.from, link.to])
      .filter((id) => board.terminals.some((terminal) => terminal.id === id && terminal.wirable));
    focusWiring([...new Set([...terminals, ...physical, ...linked])]);
  }
  store.setCamera(boardForProblem(store.problem).plcUnit === undefined ? 'front' : 'plc');
  if (store.route === 'result') store.setRoute('session');
}
