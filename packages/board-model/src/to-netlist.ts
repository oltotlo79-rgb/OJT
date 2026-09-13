import {
  createBuzzer,
  createLamp,
  createNetlist,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTerminalBlockLink,
  createTimer4c,
  createWire,
  partId,
  terminalId,
  type LinkElement,
  type Netlist,
  type Part,
  type TerminalId,
  type Wire,
} from '@ojt/circuit-sim';
import { SOCKET_IDS, type BoardDefinition } from './board-jipm.js';
import { socketPartId, type SocketRoles } from './roles.js';
import type { BoardSession } from './session.js';

/**
 * 盤セッション → circuit-sim のネットリスト。設計仕様 §6.4 / §4.4。
 * 端子IDはすべて §6.4 の命名（`CR1.13` / `TB_PB.1a` / `TB_PL.1+` / `P.1` / `N.1` / `PS.+`）。
 */

/** DC24V電源の部品ID。§6.4 */
export const POWER_SUPPLY_ID = 'PS';
/** P供給端子の部品ID。§6.4 */
export const P_RAIL_ID = 'P';
/** N供給端子の部品ID。§6.4 */
export const N_RAIL_ID = 'N';
/** 押ボタン用端子台の部品ID。§6.4 */
export const PB_BLOCK_ID = 'TB_PB';
/** ランプ用端子台の部品ID。§6.4 */
export const PL_BLOCK_ID = 'TB_PL';
/** ブザー（任意部品）の部品ID。§6.4 */
export const BUZZER_ID = 'BZ';

/**
 * 端子だけを持つ部品（要素なし）。端子台と、部品が装着されていないソケットに使う。
 * 電気的実体を持たないので、節点は電線で併合されるだけになる（＝空きソケットは開放）。
 */
export function createTerminalOnlyPart(id: string, terminals: readonly TerminalId[]): Part {
  return {
    id: partId(id),
    kind: 'terminal-block',
    terminals: [...terminals],
    elements: [],
    meta: { kind: 'terminal-block' },
  };
}

/**
 * 空きソケットを「14端子だけを持つ部品」として作る。
 * `partIdOfSocket` は役割名（`CR1`）か、役割なしの予備ソケットなら物理ソケットID（`S8`）。
 */
export function createEmptySocketPart(partIdOfSocket: string): Part {
  const terminals: TerminalId[] = [];
  for (let pin = 1; pin <= 14; pin += 1) terminals.push(terminalId(partIdOfSocket, String(pin)));
  return createTerminalOnlyPart(partIdOfSocket, terminals);
}

function railPart(id: string, count: number): Part {
  const terminals: TerminalId[] = [];
  for (let i = 1; i <= count; i += 1) terminals.push(terminalId(id, String(i)));
  return createTerminalOnlyPart(id, terminals);
}

function pushButtonBlockPart(): Part {
  const terminals: TerminalId[] = [];
  for (let n = 1; n <= 4; n += 1) {
    for (const sign of ['c', 'a', 'b'] as const) {
      terminals.push(terminalId(PB_BLOCK_ID, `${n}${sign}`));
    }
  }
  return createTerminalOnlyPart(PB_BLOCK_ID, terminals);
}

function lampBlockPart(): Part {
  const terminals: TerminalId[] = [];
  for (let n = 1; n <= 4; n += 1) {
    for (const sign of ['+', '-'] as const) {
      terminals.push(terminalId(PL_BLOCK_ID, `${n}${sign}`));
    }
  }
  return createTerminalOnlyPart(PL_BLOCK_ID, terminals);
}

/**
 * 盤セッションからネットリストを組み立てる。
 *
 * 部品の並び（決定論）: 電源 → P/N供給端子 → 端子台2つ → PB4個 → PL4個 → BZ（任意）→ ソケットS1〜S8。
 * ソケットの部品IDは、役割が割り当てられていれば役割名（`CR1`）、予備ソケットなら物理ID（`S8`）。
 * リンクの並び: P/N供給端子どうし → PB本体↔端子台（12本）→ PL本体↔端子台（8本）。
 * 電線: セッションの並び順のまま（先頭に既設の固定配線（青）3本）。
 *
 * ブレーカ（`CB`）と電源スイッチ（`SW`）はAC一次側にあり電気的には解かないため、
 * ネットリストには載せない。開閉は `Simulation.setBreaker()` / `setSwitch()` が担う（§5.3.5）。
 */
export function toNetlist(session: BoardSession, board: BoardDefinition): Netlist {
  const parts: Part[] = [];
  parts.push(createPowerSupply(POWER_SUPPLY_ID));
  parts.push(railPart(P_RAIL_ID, board.supplyTerminalCount));
  parts.push(railPart(N_RAIL_ID, board.supplyTerminalCount));
  parts.push(pushButtonBlockPart());
  parts.push(lampBlockPart());
  for (const pb of board.pushButtons) parts.push(createPushButton(pb.id));
  for (const lamp of board.lamps) parts.push(createLamp(lamp.id, lamp.color));
  if (session.extraParts.includes(partId(BUZZER_ID))) parts.push(createBuzzer(BUZZER_ID));
  const roles: SocketRoles = session.socketRoles;
  for (const socket of SOCKET_IDS) {
    const id = socketPartId(roles, socket);
    const mounted = session.mounted[socket];
    if (mounted === undefined) {
      parts.push(createEmptySocketPart(id));
    } else if (mounted.kind === 'relay-my4n') {
      parts.push(createRelay4c(id));
    } else {
      parts.push(createTimer4c(id, mounted.presetMs, mounted.rangeMaxMs));
    }
  }

  const links: LinkElement[] = board.fixedLinks.map((l) =>
    createTerminalBlockLink(l.id, l.from, l.to, true),
  );

  const wires: Wire[] = session.wires.map((w) => createWire(w.id, w.from, w.to, w.color, w.locked));

  return createNetlist(parts, wires, links);
}
