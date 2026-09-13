import {
  clampPreset,
  createWire,
  MAX_WIRES_PER_TERMINAL,
  parseTerminalId,
  type PartId,
  type TerminalId,
  type Wire,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  BoardError,
  findBoardTerminal,
  resolveEndpoint,
  SOCKET_IDS,
  type BoardDefinition,
  type SocketId,
} from './board-jipm.js';
import {
  catalogEntry,
  CatalogError,
  DEFAULT_INVENTORY,
  DEFAULT_TIMER_PRESET_MS,
  DEFAULT_TIMER_RANGE,
  findTimerRange,
  remainingInventory,
  snapPresetToStep,
  type InventoryItem,
  type MountableKind,
  type TimerRange,
} from './catalog.js';
import {
  DEFAULT_SOCKET_ROLES,
  RoleError,
  toNetlistTerminal,
  toPhysicalTerminal,
  validateSocketRoles,
  type SocketRoles,
} from './roles.js';

/**
 * 盤セッション（訓練者の作業状態）。設計仕様 §6.6 / §8.2。
 * 操作関数は失敗を例外ではなく Result で返す（UIがそのまま理由を表示するため）。
 */

/** 操作が失敗した理由。 */
export type SessionErrorCode =
  | 'unknown-socket'
  | 'socket-occupied'
  | 'socket-empty'
  | 'inventory-exhausted'
  | 'not-a-timer'
  | 'invalid-preset'
  | 'unknown-terminal'
  | 'terminal-not-wirable'
  | 'terminal-unavailable'
  | 'terminal-overload'
  | 'color-not-allowed'
  | 'same-terminal'
  | 'locked-wire'
  | 'unknown-wire';

/** 操作結果。 */
export type Result<T> =
  { ok: true; value: T } | { ok: false; code: SessionErrorCode; message: string };

/** 成功を作る。 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** 失敗を作る。 */
export function fail<T>(code: SessionErrorCode, message: string): Result<T> {
  return { ok: false, code, message };
}

/** ソケットに装着された部品。 */
export type MountedPart =
  { kind: 'relay-my4n' } | { kind: 'timer-h3y4'; presetMs: number; rangeMaxMs: number };

/** 盤セッション。 */
export interface BoardSession {
  boardId: string;
  socketRoles: SocketRoles;
  /** 物理ソケットID → 装着状態。未装着のソケットはキーを持たない。 */
  mounted: Partial<Record<SocketId, MountedPart>>;
  /** 電線（既設の固定配線（青）を含む。端子IDは circuit-sim の役割ベース）。 */
  wires: Wire[];
  /** 選べる線色。モードB・D=青、C2=白（§8.1）。 */
  allowedColors: readonly WireColor[];
  /** 盤に追加した任意部品（`BZ`）。§5.3.4 */
  extraParts: readonly PartId[];
  /** 使える部品の在庫。§7.1 */
  inventory: readonly InventoryItem[];
  /** 次に発行する電線IDの連番。 */
  wireSeq: number;
}

/** セッション生成オプション。 */
export interface SessionOptions {
  roles?: SocketRoles;
  allowedColors?: readonly WireColor[];
  extraParts?: readonly PartId[];
  inventory?: readonly InventoryItem[];
}

/** 新規配線に使える既定の線色（モードB・D）。§8.1 */
export const DEFAULT_ALLOWED_COLORS: readonly WireColor[] = ['青'];

/** 役割割当が不正なときに投げる（セッションを作る前の前提違反）。 */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/**
 * 盤セッションを作る。既設の固定配線（青。§6.3）を `locked` な電線として最初から持たせるので、
 * 端子の本数上限（§6.6）の計算がこの配列だけで完結する。
 */
export function createSession(board: BoardDefinition, options: SessionOptions = {}): BoardSession {
  const roles = options.roles ?? DEFAULT_SOCKET_ROLES;
  const roleErrors = validateSocketRoles(roles);
  if (roleErrors.length > 0) throw new SessionError(roleErrors.join(' / '));
  const wires: Wire[] = board.fixedWires.map((fw) =>
    createWire(
      fw.id,
      toNetlistTerminal(roles, resolveEndpoint(fw.from)),
      toNetlistTerminal(roles, resolveEndpoint(fw.to)),
      fw.color,
      true,
    ),
  );
  return {
    boardId: board.id,
    socketRoles: roles,
    mounted: {},
    wires,
    allowedColors: options.allowedColors ?? DEFAULT_ALLOWED_COLORS,
    extraParts: options.extraParts ?? [],
    inventory: options.inventory ?? DEFAULT_INVENTORY,
    wireSeq: 1,
  };
}

/** 装着済み部品の種別一覧（物理ソケット順）。 */
export function mountedKinds(session: BoardSession): MountableKind[] {
  const out: MountableKind[] = [];
  for (const socket of SOCKET_IDS) {
    const mounted = session.mounted[socket];
    if (mounted !== undefined) out.push(mounted.kind);
  }
  return out;
}

/**
 * タイマ設定値をレンジの分解能に丸める。非有限な値（NaN・Infinity）は例外ではなく失敗で返す。§8.2
 * UIの入力欄からそのまま渡ってくる値なので、操作関数は投げずに理由を返す。
 */
function snapPreset(presetMs: number, range: TimerRange): Result<number> {
  try {
    return ok(snapPresetToStep(presetMs, range));
  } catch (error) {
    if (error instanceof CatalogError) return fail('invalid-preset', error.message);
    throw error;
  }
}

/** 部品を装着する。§8.2 */
export function plug(
  session: BoardSession,
  socketId: SocketId,
  kind: MountableKind,
  options: { presetMs?: number; rangeMaxMs?: number } = {},
): Result<MountedPart> {
  if (!SOCKET_IDS.includes(socketId)) {
    return fail('unknown-socket', `盤に無いソケットです: ${socketId}`);
  }
  if (session.mounted[socketId] !== undefined) {
    return fail('socket-occupied', `${socketId} には既に部品が装着されています`);
  }
  const entry = catalogEntry(kind);
  const remaining = remainingInventory(session.inventory, mountedKinds(session));
  const left = remaining.find((r) => r.kind === kind)?.count ?? 0;
  if (left <= 0) {
    return fail('inventory-exhausted', `${entry.displayName} の在庫がありません`);
  }
  if (kind === 'relay-my4n') {
    const part: MountedPart = { kind };
    session.mounted[socketId] = part;
    return ok(part);
  }
  const rangeMaxMs = options.rangeMaxMs ?? DEFAULT_TIMER_RANGE.maxMs;
  const range = findTimerRange(rangeMaxMs) ?? DEFAULT_TIMER_RANGE;
  const snapped = snapPreset(options.presetMs ?? DEFAULT_TIMER_PRESET_MS, range);
  if (!snapped.ok) return snapped;
  const part: MountedPart = { kind, presetMs: snapped.value, rangeMaxMs: range.maxMs };
  session.mounted[socketId] = part;
  return ok(part);
}

/** 部品を取り外す。§8.2 */
export function unplug(session: BoardSession, socketId: SocketId): Result<MountedPart> {
  const mounted = session.mounted[socketId];
  if (mounted === undefined) {
    return fail('socket-empty', `${socketId} に部品が装着されていません`);
  }
  delete session.mounted[socketId];
  return ok(mounted);
}

/** タイマの設定時間を変える。レンジの分解能に丸める。§8.2 */
export function setPreset(
  session: BoardSession,
  socketId: SocketId,
  presetMs: number,
): Result<MountedPart> {
  const mounted = session.mounted[socketId];
  if (mounted === undefined) {
    return fail('socket-empty', `${socketId} に部品が装着されていません`);
  }
  if (mounted.kind !== 'timer-h3y4') {
    return fail('not-a-timer', `${socketId} の部品はタイマではありません`);
  }
  const range = findTimerRange(mounted.rangeMaxMs) ?? DEFAULT_TIMER_RANGE;
  const snapped = snapPreset(presetMs, range);
  if (!snapped.ok) return snapped;
  const next: MountedPart = {
    kind: 'timer-h3y4',
    presetMs: clampPreset(snapped.value, range.maxMs),
    rangeMaxMs: mounted.rangeMaxMs,
  };
  session.mounted[socketId] = next;
  return ok(next);
}

/** その端子に接続されている電線（既設の固定配線を含む）。§6.6 */
export function wiresAt(session: BoardSession, terminal: TerminalId): Wire[] {
  return session.wires.filter((w) => w.from === terminal || w.to === terminal);
}

/** その端子の電線本数。§6.6 */
export function wireCountAtTerminal(session: BoardSession, terminal: TerminalId): number {
  let n = 0;
  for (const w of session.wires) {
    if (w.from === terminal) n += 1;
    if (w.to === terminal) n += 1;
  }
  return n;
}

function checkTerminal(
  session: BoardSession,
  board: BoardDefinition,
  id: TerminalId,
): Result<TerminalId> {
  let physical: TerminalId;
  try {
    physical = toPhysicalTerminal(session.socketRoles, id);
  } catch (error) {
    // 役割名は正しいがピン番号が壊れている端子ID（`CR1.09` / `CR1.99`）。未知端子として扱う
    if (error instanceof RoleError || error instanceof BoardError) {
      return fail('unknown-terminal', `盤に無い端子です: ${id}`);
    }
    throw error;
  }
  const found = findBoardTerminal(board, physical);
  if (found === undefined) return fail('unknown-terminal', `盤に無い端子です: ${id}`);
  if (!found.wirable) {
    return fail('terminal-not-wirable', `この端子には配線できません（既設配線済み）: ${id}`);
  }
  if (found.optional) {
    const owner = parseTerminalId(physical).part;
    if (!session.extraParts.includes(owner)) {
      return fail('terminal-unavailable', `盤に載っていない部品の端子です: ${id}`);
    }
  }
  if (wireCountAtTerminal(session, id) >= MAX_WIRES_PER_TERMINAL) {
    return fail(
      'terminal-overload',
      `1つの端子に接続できるのは${MAX_WIRES_PER_TERMINAL}本までです: ${id}`,
    );
  }
  return ok(id);
}

/**
 * 電線を張る。設計仕様 §6.6 / §8.2。
 * - パレットに無い色は拒否する（モードBは青のみ、C2は白のみ。§8.1）
 * - 1端子2本を超える接続は拒否する（`terminal-overload`。UIはこれを §5.6 #5 の危険操作として計上する）
 * - PB／PL本体端子など配線不可の端子は拒否する（§6.4）
 */
export function addWire(
  session: BoardSession,
  board: BoardDefinition,
  from: TerminalId,
  to: TerminalId,
  color: WireColor = session.allowedColors[0] ?? '青',
): Result<Wire> {
  if (!session.allowedColors.includes(color)) {
    return fail('color-not-allowed', `この課題で使える線色ではありません: ${color}`);
  }
  if (from === to) return fail('same-terminal', '同じ端子どうしは接続できません');
  const checkedFrom = checkTerminal(session, board, from);
  if (!checkedFrom.ok) return checkedFrom;
  const checkedTo = checkTerminal(session, board, to);
  if (!checkedTo.ok) return checkedTo;
  const wire = createWire(`w-${String(session.wireSeq).padStart(3, '0')}`, from, to, color, false);
  session.wireSeq += 1;
  session.wires.push(wire);
  return ok(wire);
}

/** 電線を外す。固定配線（`locked`）は外せない。§6.3 */
export function removeWire(session: BoardSession, wireId: string): Result<Wire> {
  const index = session.wires.findIndex((w) => w.id === wireId);
  if (index < 0) return fail('unknown-wire', `電線が見つかりません: ${wireId}`);
  const wire = session.wires[index];
  if (wire === undefined) return fail('unknown-wire', `電線が見つかりません: ${wireId}`);
  if (wire.locked) {
    return fail('locked-wire', 'チェック用回路の既設配線（青）は変更できません');
  }
  session.wires.splice(index, 1);
  return ok(wire);
}
