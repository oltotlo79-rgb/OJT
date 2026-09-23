import { addWire, removeWire, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import { PlcIoSchema, plcWiringPlan, type ResolvedPlcIo } from '@ojt/content';
import type { Device } from '@ojt/ladder-core';
import { useStore } from '../app/store.js';
import { cloneSession, type CommandResult } from './commands.js';
import { focusWiring } from './wire-edit.js';

const edgeKey = (from: string, to: string): string => [from, to].sort().join('|');

/** 割付と物理配線を同じUndo単位にする。候補で全線を検証してから反映する。 */
export function planPlcAssignment(
  session: BoardSession,
  board: BoardDefinition,
  previous: ResolvedPlcIo,
  next: ResolvedPlcIo,
  rewire: boolean,
): CommandResult<BoardSession> {
  const invalid = (message: string): CommandResult<BoardSession> => ({
    ok: false,
    message,
    code: 'unknown-terminal',
  });
  if (previous.mode !== 'free' || next.mode !== 'free')
    return invalid('この課題のI/O割付は固定です。');
  const parsed = PlcIoSchema.safeParse(next),
    unit = board.plcUnit;
  if (!parsed.success)
    return invalid(parsed.error.issues.map((issue) => issue.message).join(' / '));
  if (
    unit === undefined ||
    next.inputs.some((input) => unit.spec.inputs[input.x] === undefined) ||
    next.outputs.some((output) => unit.spec.outputs[output.y] === undefined)
  )
    return invalid('この機種に存在しないI/O番号です。');
  const before = cloneSession(session),
    after = cloneSession(session);
  after.plcAssignment = { ...structuredClone(next), mode: 'free' };
  if (rewire) {
    const oldKeys = new Set(
      plcWiringPlan(previous, unit).map((wire) => edgeKey(wire.from, wire.to)),
    );
    // 自作配線が残る場合も削除せず、追加時の重複・本数上限を検査する。
    for (const wire of [...after.wires]) {
      if (wire.locked || !oldKeys.has(edgeKey(wire.from, wire.to))) continue;
      const removed = removeWire(after, wire.id);
      if (!removed.ok) return removed;
    }
    for (const wire of plcWiringPlan(next, unit)) {
      if (
        after.wires.some(
          (existing) => edgeKey(existing.from, existing.to) === edgeKey(wire.from, wire.to),
        )
      )
        continue;
      const added = addWire(after, board, wire.from, wire.to, after.allowedColors[0] ?? '青');
      if (!added.ok)
        return {
          ...added,
          message: `${added.message}。自作配線は保持しています。「割付表のみ」を選び、接続先を手動で調整できます。`,
        };
    }
  }
  return {
    ok: true,
    value: after,
    command: {
      kind: 'plcAssignment',
      label: rewire ? 'I/O割付・推奨配線を一括変更' : 'I/O割付表を変更',
      before,
      after,
    },
  };
}

export function focusIo(device: Device, terminals: readonly string[]): void {
  const store = useStore.getState();
  const wireIds =
    store.session?.wires
      .filter((wire) => terminals.includes(wire.from) || terminals.includes(wire.to))
      .map((wire) => wire.id) ?? [];
  focusWiring(terminals, wireIds);
  const uses =
    store.ladder?.networks.flatMap((network) =>
      network.cells.flatMap((row, r) =>
        row.flatMap((cell, col) =>
          'device' in cell && cell.device.kind === device.kind && cell.device.index === device.index
            ? [{ networkId: network.id, row: r, col }]
            : [],
        ),
      ),
    ) ?? [];
  const next =
    uses.find(
      (use, index) =>
        index >
        uses.findIndex(
          (current) =>
            current.networkId === store.ladderCursor.networkId &&
            current.row === store.ladderCursor.row &&
            current.col === store.ladderCursor.col,
        ),
    ) ?? uses[0];
  if (next !== undefined) store.setLadderCursor(next);
  store.toast(
    uses.length === 0
      ? '配線端子を表示しました。このデバイスはラダーでは未使用です。'
      : `使用箇所 ${uses.indexOf(next!) + 1}/${uses.length}。もう一度押すと次の使用箇所へ移ります。`,
  );
}
