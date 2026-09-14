import {
  DEFAULT_SOCKET_ROLES,
  DEFAULT_TIMER_PRESET_MS,
  DEFAULT_TIMER_RANGE,
  JIPM_BOARD,
  resolveEndpoint,
  SOCKET_IDS,
  terminalIdFor,
  toNetlistTerminal,
  type MountableKind,
  type SocketId,
  type SocketRole,
  type SocketRoles,
} from '@ojt/board-model';
import {
  MAX_WIRES_PER_TERMINAL,
  terminalId,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  isLoadCell,
  rungNodeCount,
  validateDocument,
  type Rung,
  type RungEnd,
  type SchematicCell,
  type SchematicDocument,
} from './document.js';

/**
 * 回路図 → 物理割当（設計仕様 §11.3）。
 * 各 `CRn`／`Tn` の接点を出現順に組1〜組4へ1つずつ割り当てる。
 * 母線は実機どおり供給端子が `P.1` / `N.1` の1点ずつしかないので、**渡り配線**（鎖状）で分配する。
 */

/** 生成すべき電線1本。 */
export interface WireSpec {
  id: string;
  from: TerminalId;
  to: TerminalId;
  color: WireColor;
}

/** 装着すべき部品1個。 */
export interface PartAssignment {
  socket: SocketId;
  role: SocketRole;
  kind: MountableKind;
  /** タイマのときの設定時間[ms]。 */
  presetMs?: number;
  /** タイマのときのレンジ上限[ms]。 */
  rangeMaxMs?: number;
}

/** 回路図要素 → 物理端子の対応（1要素につき左右2端子）。 */
export interface CellAssignment {
  cellId: string;
  device: string;
  /** 接点のときの組番号（1〜4）。接点以外は0。§11.3 */
  group: number;
  /** P側（左）の端子。 */
  left: TerminalId;
  /** N側（右）の端子。 */
  right: TerminalId;
}

/** 割当エラー1件。 */
export interface AssignError {
  path: string;
  message: string;
}

/** 割当オプション。 */
export interface AssignOptions {
  /** ソケットの役割割当。省略すると回路図に現れる機器から決める。 */
  roles?: SocketRoles;
  /** 生成する電線の色。既定は青（モードB・D）。§11.3 */
  color?: WireColor;
  /** 回路図要素IDごとの物理端子の上書き（`[左, 右]`）。§7.2 / §11.3 */
  physicalOverride?: Readonly<Record<string, readonly TerminalId[]>>;
}

/** 割当の結果。 */
export type AssignResult =
  | {
      ok: true;
      roles: SocketRoles;
      parts: PartAssignment[];
      cells: CellAssignment[];
      wires: WireSpec[];
    }
  | { ok: false; errors: AssignError[] };

/** ソケットに載せられる役割の正準順。 */
const ASSIGNABLE_ROLES: readonly SocketRole[] = ['CR1', 'CR2', 'CR3', 'CR4', 'T1', 'T2'];

/** 母線の節点キー。 */
const BUS_P_KEY = 'BUS:P';
const BUS_N_KEY = 'BUS:N';

function isSocketDevice(device: string): device is SocketRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(device);
}

/** 回路図に現れるソケット機器を正準順に返す。 */
export function requiredRoles(doc: SchematicDocument): SocketRole[] {
  const used = new Set<string>();
  for (const r of doc.rungs) {
    for (const cell of r.cells) {
      if (isSocketDevice(cell.device)) used.add(cell.device);
    }
  }
  return ASSIGNABLE_ROLES.filter((role) => used.has(role));
}

/**
 * 回路図から役割割当を決める。
 * 実物の盤はソケットを8個持ち、§6.1 の7役割（`CR1`〜`CR4` / `T1` / `T2` / `CHK`）を
 * すべて同時に載せられるので、既定の割当（`DEFAULT_SOCKET_ROLES`）をそのまま使えばよい。
 * 課題側で `options.roles` を渡せば §6.1 の課題1形式・課題2形式に絞ることもできる。
 */
export function deriveSocketRoles(): SocketRoles {
  return DEFAULT_SOCKET_ROLES;
}

function terminalPair(
  cell: SchematicCell,
  group: number,
  override: Readonly<Record<string, readonly TerminalId[]>>,
): { left: TerminalId; right: TerminalId } | AssignError {
  const forced = override[cell.id];
  if (forced !== undefined) {
    const left = forced[0];
    const right = forced[1];
    if (left === undefined || right === undefined) {
      return { path: cell.id, message: `physicalOverride は端子2つを指定します: ${cell.id}` };
    }
    return { left, right };
  }
  const n = cell.device.slice(-1);
  switch (cell.kind) {
    case 'pb-a':
      return { left: terminalId('TB_PB', `${n}c`), right: terminalId('TB_PB', `${n}a`) };
    case 'pb-b':
      return { left: terminalId('TB_PB', `${n}c`), right: terminalId('TB_PB', `${n}b`) };
    case 'cr-a':
    case 't-a':
      return {
        left: terminalIdFor(cell.device as SocketRole, 8 + group),
        right: terminalIdFor(cell.device as SocketRole, 4 + group),
      };
    case 'cr-b':
    case 't-b':
      return {
        left: terminalIdFor(cell.device as SocketRole, 8 + group),
        right: terminalIdFor(cell.device as SocketRole, group),
      };
    case 'coil':
      return {
        left: terminalIdFor(cell.device as SocketRole, 14),
        right: terminalIdFor(cell.device as SocketRole, 13),
      };
    case 'lamp':
      return { left: terminalId('TB_PL', `${n}+`), right: terminalId('TB_PL', `${n}-`) };
    case 'buzzer':
      return { left: terminalId('BZ', '+'), right: terminalId('BZ', '-') };
  }
}

function resolveNodeKey(
  doc: SchematicDocument,
  rung: Rung,
  node: number,
  depth = 0,
): string | AssignError {
  if (depth > 32) {
    return { path: rung.id, message: `段の参照が循環しています: ${rung.id}` };
  }
  if (node === 0) return resolveEnd(doc, rung.from, rung, depth + 1);
  if (node === rungNodeCount(rung) - 1) return resolveEnd(doc, rung.to, rung, depth + 1);
  return `${rung.id}#${node}`;
}

function resolveEnd(
  doc: SchematicDocument,
  end: RungEnd,
  owner: Rung,
  depth: number,
): string | AssignError {
  if ('bus' in end) return end.bus === 'P' ? BUS_P_KEY : BUS_N_KEY;
  const target = doc.rungs.find((r) => r.id === end.rung);
  if (target === undefined) {
    return { path: owner.id, message: `参照先の段がありません: ${end.rung}` };
  }
  return resolveNodeKey(doc, target, end.node, depth);
}

function isAssignError(value: unknown): value is AssignError {
  return typeof value === 'object' && value !== null && 'message' in value && 'path' in value;
}

/** 既設の固定配線（青）で既に使われている端子の本数。§6.3 */
function preUsedCounts(roles: SocketRoles): Map<string, number> {
  const used = new Map<string, number>();
  for (const fw of JIPM_BOARD.fixedWires) {
    for (const endpoint of [fw.from, fw.to]) {
      const id = toNetlistTerminal(roles, resolveEndpoint(endpoint));
      used.set(id, (used.get(id) ?? 0) + 1);
    }
  }
  return used;
}

/**
 * 回路図を物理端子へ割り当て、生成すべき電線と装着すべき部品を返す。§11.3
 * 同じ組を2つの接点に割り当てず、5個目の接点が現れたらエラーにする。
 */
export function assignToBoard(doc: SchematicDocument, options: AssignOptions = {}): AssignResult {
  const structural = validateDocument(doc);
  if (structural.length > 0) return { ok: false, errors: structural };

  const roles = options.roles ?? deriveSocketRoles();
  const needed = requiredRoles(doc);
  const missing = needed.filter((role) => !SOCKET_IDS.some((socket) => roles[socket] === role));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: missing.map((role) => ({
        path: 'roles',
        message: `役割が盤に割り当てられていません: ${role}`,
      })),
    };
  }

  const color = options.color ?? '青';
  const override = options.physicalOverride ?? {};
  const errors: AssignError[] = [];

  // 1. 接点を出現順に組1〜組4へ割り当てる
  const groupUsed = new Map<string, number>();
  const cells: CellAssignment[] = [];
  const cellByNode = new Map<string, TerminalId[]>();
  const presetOf = new Map<string, number>();

  const attach = (key: string, id: TerminalId): void => {
    const list = cellByNode.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    cellByNode.set(key, list);
  };

  for (const r of doc.rungs) {
    r.cells.forEach((cell, index) => {
      let group = 0;
      if (!isLoadCell(cell) && cell.kind !== 'pb-a' && cell.kind !== 'pb-b') {
        const used = groupUsed.get(cell.device) ?? 0;
        if (used >= 4) {
          errors.push({
            path: cell.id,
            message: `${cell.device} の接点が5個目です（1つの部品の接点は4組までです）`,
          });
          return;
        }
        group = used + 1;
        groupUsed.set(cell.device, group);
      }
      const pair = terminalPair(cell, group, override);
      if (isAssignError(pair)) {
        errors.push(pair);
        return;
      }
      if (cell.kind === 'coil' && cell.presetMs !== undefined) {
        presetOf.set(cell.device, cell.presetMs);
      }
      cells.push({
        cellId: cell.id,
        device: cell.device,
        group,
        left: pair.left,
        right: pair.right,
      });

      const leftKey = resolveNodeKey(doc, r, index);
      const rightKey = resolveNodeKey(doc, r, index + 1);
      if (isAssignError(leftKey) || isAssignError(rightKey)) {
        if (isAssignError(leftKey)) errors.push(leftKey);
        if (isAssignError(rightKey)) errors.push(rightKey);
        return;
      }
      attach(leftKey, pair.left);
      attach(rightKey, pair.right);
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  // 2. 節点ごとに電線を作る。母線は P.1〜/N.1〜 に若番から割り当てる（1端子2本まで）。§11.3
  const used = preUsedCounts(roles);
  const bump = (id: TerminalId): void => {
    used.set(id, (used.get(id) ?? 0) + 1);
  };
  const wires: WireSpec[] = [];
  let seq = 1;
  const emit = (from: TerminalId, to: TerminalId): void => {
    wires.push({ id: `sw-${String(seq).padStart(3, '0')}`, from, to, color });
    seq += 1;
    bump(from);
    bump(to);
  };
  // 母線も含めてすべての節点を**渡り配線**（鎖状）で結ぶ。§11.3 / 調査資料 §4.5
  // 供給端子は実機どおり P.1 / N.1 の1点ずつなので、母線の節点は
  // 「P.1 → 最初の入口端子 → 次の入口端子 → …」という1本の鎖になる。
  for (const [key, terminals] of cellByNode) {
    const chain =
      key === BUS_P_KEY
        ? [terminalId('P', '1'), ...terminals]
        : key === BUS_N_KEY
          ? [terminalId('N', '1'), ...terminals]
          : terminals;
    for (let i = 1; i < chain.length; i += 1) {
      const a = chain[i - 1];
      const b = chain[i];
      if (a === undefined || b === undefined) continue;
      emit(a, b);
    }
  }

  // 3. 1端子2本の上限を確認する。§6.6
  for (const [id, count] of used) {
    if (count > MAX_WIRES_PER_TERMINAL) {
      errors.push({
        path: id,
        message: `1端子に${count}本つながります（上限は${MAX_WIRES_PER_TERMINAL}本）: ${id}`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // 4. 装着すべき部品
  const parts: PartAssignment[] = [];
  for (const socket of SOCKET_IDS) {
    const role = roles[socket];
    if (role === undefined || !needed.includes(role)) continue;
    if (role.startsWith('T')) {
      parts.push({
        socket,
        role,
        kind: 'timer-h3y4',
        presetMs: presetOf.get(role) ?? DEFAULT_TIMER_PRESET_MS,
        rangeMaxMs: DEFAULT_TIMER_RANGE.maxMs,
      });
    } else {
      parts.push({ socket, role, kind: 'relay-my4n' });
    }
  }

  return { ok: true, roles, parts, cells, wires };
}
