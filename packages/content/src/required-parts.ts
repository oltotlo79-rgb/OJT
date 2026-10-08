import { SOCKET_ROLES, type SocketRole } from '@ojt/board-model';
import { isAssembleProblem, isPlcProblem, type SupportedProblem } from './schema/index.js';
import { resolvePlcIo } from './schema/plc.js';

/**
 * 課題の模範が使う装着部品の役割（`CR1`・`T1` など）。v2.0.0 総点検 Task 2。
 *
 * 手順帯の「部品装着」を「在庫を全部使ったら済」ではなく「**必要な部品が全部載ったら済**」に
 * するための集合。回路組立は模範回路図の接点・コイルが指す機器、PLCは I/O 割付の出力が指す
 * 中継リレーから取る。課題の盤に割り当てられていない役割（ソケットが無い役割）は除く。
 * 部品点検・回路点検修復・実験は「部品を載せる」手順を持たないので空。
 *
 * 並びは `SOCKET_ROLES` の順（CR1〜CR4・T1・T2）に固定し、案内文が課題ごとに揺れないようにする。
 */
export function requiredPartRoles(problem: SupportedProblem): SocketRole[] {
  const found = new Set<string>();
  if (isAssembleProblem(problem)) {
    for (const rung of problem.schematic.rungs) {
      for (const cell of rung.cells) {
        if (
          cell.kind === 'cr-a' ||
          cell.kind === 'cr-b' ||
          cell.kind === 't-a' ||
          cell.kind === 't-b' ||
          cell.kind === 'coil'
        ) {
          found.add(cell.device);
        }
      }
    }
  } else if (isPlcProblem(problem)) {
    for (const output of resolvePlcIo(problem.io).outputs) found.add(output.cr);
  }
  const assigned = new Set(Object.values(problem.board.socketRoles));
  return SOCKET_ROLES.filter(
    (role) => role !== 'CHK' && found.has(role) && assigned.has(role),
  );
}
