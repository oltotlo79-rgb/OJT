import {
  parseTerminalId,
  partId,
  terminalId,
  type PartId,
  type TerminalId,
} from '@ojt/circuit-sim';
import {
  CHECK_SOCKET_ID,
  SOCKET_IDS,
  SOCKET_PIN_COUNT,
  socketPinTerminal,
  type SocketId,
} from './board-jipm.js';

/**
 * ソケットの役割割当。設計仕様 §6.1。
 * 役割名がそのまま circuit-sim 側の部品IDになり、端子IDは `<役割>.<ピン>`（例: `CR1.13`）となる（§6.4）。
 *
 * 実物（写真）はソケットを8個持つが、仕様 §6.1 の役割は7つ（`CR1`〜`CR4` / `T1` / `T2` / `CHK`）しか
 * 無い。余ったソケットは**役割なしの予備**とし、`SocketRoles` から単に欠落させる。
 * 予備ソケットは端子だけが存在して配線でき、部品を挿せば物理ソケットID（`S8`）が部品IDになる。
 * 「役割なし」を `'NONE'` のような番兵値で表さないのは、役割名がそのまま部品IDとして端子IDに
 * 埋め込まれる規約（§6.4）のもとでは、番兵値が `NONE.13` という意味のない端子IDを生んでしまうため。
 */

/** ソケットに割り当てられる役割の一覧（§6.1 の7役割）。 */
export const SOCKET_ROLES = ['CR1', 'CR2', 'CR3', 'CR4', 'T1', 'T2', 'CHK'] as const;

/** ソケットに割り当てられる役割。 */
export type SocketRole = (typeof SOCKET_ROLES)[number];

/** 物理ソケットID → 役割。欠落しているソケットは役割なしの予備。 */
export type SocketRoles = Readonly<Partial<Record<SocketId, SocketRole>>>;

/** チェック用ソケットの役割名。§6.3 */
export const CHECK_SOCKET_ROLE: SocketRole = 'CHK';

/**
 * 既定の役割割当。ソケットが8個あるので §6.1 の7役割をすべて同時に載せられる。
 * 左クラスタ（S1〜S4）にCR、右クラスタの S5・S6 にタイマ、S7 をチェック用、S8 を予備とする。
 */
export const DEFAULT_SOCKET_ROLES: SocketRoles = {
  S1: 'CR1',
  S2: 'CR2',
  S3: 'CR3',
  S4: 'CR4',
  S5: 'T1',
  S6: 'T2',
  S7: 'CHK',
};

/** 課題1形式（CR4個＋チェック用）。§6.1。残りのソケットは予備。 */
export const TASK1_SOCKET_ROLES: SocketRoles = {
  S1: 'CR1',
  S2: 'CR2',
  S3: 'CR3',
  S4: 'CR4',
  S7: 'CHK',
};

/** 課題2形式（CR2個＋T2個＋チェック用）。§6.1。残りのソケットは予備。 */
export const TASK2_SOCKET_ROLES: SocketRoles = {
  S1: 'CR1',
  S2: 'CR2',
  S5: 'T1',
  S6: 'T2',
  S7: 'CHK',
};

/** 役割割当の参照に失敗したときに投げる。 */
export class RoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleError';
  }
}

/** 文字列が役割名か。 */
export function isSocketRole(value: string): value is SocketRole {
  return (SOCKET_ROLES as readonly string[]).includes(value);
}

/** 文字列が物理ソケットIDか。 */
export function isSocketId(value: string): value is SocketId {
  return (SOCKET_IDS as readonly string[]).includes(value);
}

/**
 * 役割とピン番号から circuit-sim の端子IDを作る（§6.4）。
 * 例: `terminalIdFor('CR1', 13)` → `CR1.13`。
 */
export function terminalIdFor(role: SocketRole, pin: number): TerminalId {
  if (!Number.isInteger(pin) || pin < 1 || pin > SOCKET_PIN_COUNT) {
    throw new RoleError(`ピン番号が範囲外です: ${pin}`);
  }
  return terminalId(role, String(pin));
}

/** 役割割当の不正を列挙する。空配列なら妥当。 */
export function validateSocketRoles(roles: SocketRoles): string[] {
  const errors: string[] = [];
  const seen = new Set<SocketRole>();
  for (const socket of SOCKET_IDS) {
    const role = roles[socket];
    if (role === undefined) continue; // 役割なしの予備ソケット
    if (!isSocketRole(role)) {
      errors.push(`${socket} の役割が不正です: ${String(role)}`);
      continue;
    }
    if (seen.has(role)) errors.push(`役割が重複しています: ${role}`);
    seen.add(role);
  }
  for (const key of Object.keys(roles)) {
    if (!isSocketId(key)) errors.push(`盤に無いソケットIDです: ${key}`);
  }
  if (!seen.has(CHECK_SOCKET_ROLE)) {
    errors.push('チェック用ソケット（CHK）が割り当てられていません');
  } else if (roles[CHECK_SOCKET_ID] !== CHECK_SOCKET_ROLE) {
    // チェック回路の既設配線（§6.3）が S7 に固定で結線されているため、役割の位置も動かせない
    errors.push(`チェック用役割 ${CHECK_SOCKET_ROLE} は ${CHECK_SOCKET_ID} に固定です`);
  }
  return errors;
}

/** その役割が割り当てられた物理ソケットID。割り当てが無ければ undefined。 */
export function trySocketOf(roles: SocketRoles, role: SocketRole): SocketId | undefined {
  return SOCKET_IDS.find((socket) => roles[socket] === role);
}

/** その役割が割り当てられた物理ソケットID。無ければ RoleError。 */
export function socketOf(roles: SocketRoles, role: SocketRole): SocketId {
  const hit = trySocketOf(roles, role);
  if (hit === undefined) throw new RoleError(`割り当てられていない役割です: ${role}`);
  return hit;
}

/** その物理ソケットの役割。予備ソケットは undefined。 */
export function roleOf(roles: SocketRoles, socket: SocketId): SocketRole | undefined {
  return roles[socket];
}

/** その役割が割り当てられているか。 */
export function hasRole(roles: SocketRoles, role: SocketRole): boolean {
  return SOCKET_IDS.some((socket) => roles[socket] === role);
}

/**
 * ソケットに装着された部品のネットリスト上の部品ID。
 * 役割が割り当てられていれば役割名、予備ソケットなら物理ソケットIDをそのまま使う。§6.4
 */
export function socketPartId(roles: SocketRoles, socket: SocketId): PartId {
  return partId(roles[socket] ?? socket);
}

/**
 * 物理端子ID（`S1.13`）を circuit-sim の端子ID（`CR1.13`）に変換する。
 * 予備ソケットとソケット以外の端子（`TB_PB.1a` / `P.1` など）はそのまま返す。
 */
export function toNetlistTerminal(roles: SocketRoles, physical: TerminalId): TerminalId {
  const parsed = parseTerminalId(physical);
  const part: string = parsed.part;
  if (!isSocketId(part)) return physical;
  const role = roles[part];
  if (role === undefined) return physical;
  return terminalId(role, parsed.name);
}

/**
 * circuit-sim の端子ID（`CR1.13`）を物理端子ID（`S1.13`）に変換する。
 *
 * ソケット以外の端子はそのまま返す。割り当てられていない役割の端子（`T1.9` で T1 が未割当）も
 * **そのまま返す**ので、呼び出し側は「盤に無い端子」として扱える（例外にはしない）。
 * ピン番号が10進数字でない端子ID（`CR1.09` や `CR1.coil`）は RoleError（数値へ丸めて解釈しない）。
 */
export function toPhysicalTerminal(roles: SocketRoles, id: TerminalId): TerminalId {
  const parsed = parseTerminalId(id);
  const part: string = parsed.part;
  if (!isSocketRole(part)) return id;
  const socket = trySocketOf(roles, part);
  if (socket === undefined) return id;
  const pin = Number(parsed.name);
  if (!/^\d+$/.test(parsed.name) || String(pin) !== parsed.name) {
    throw new RoleError(`ピン番号の形式が不正です: ${id}`);
  }
  return socketPinTerminal(socket, pin);
}
