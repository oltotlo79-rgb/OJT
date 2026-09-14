import {
  addWire,
  JIPM_BOARD,
  plug,
  removeWire,
  setPreset,
  toNetlistTerminal,
  unplug,
  type BoardSession,
  type MountableKind,
  type Result,
  type SocketId,
} from '@ojt/board-model';
import type { TerminalId, Wire, WireColor } from '@ojt/circuit-sim';

/**
 * 盤操作のコマンド履歴（元に戻す／やり直し、上限50手）。設計仕様 §8.2。
 *
 * 逆操作を自前で組み立てると「タイマのレンジ丸め」等で元に戻せない場合があるため、
 * **操作の前後でセッション全体のスナップショットを持つ**方式にする。
 * セッションは電線数十本ぶんの素の JSON なので 50 手ぶん持っても数十KBにしかならない。
 */

/** 元に戻せる手数の上限。§8.2 */
export const HISTORY_LIMIT = 50;

/** コマンド1件。 */
export interface SessionCommand {
  /** 操作の種別（ログ表示用）。 */
  kind: 'addWire' | 'removeWire' | 'plug' | 'unplug' | 'setPreset';
  /** 操作の説明（操作ログに出す文）。§8.1 */
  label: string;
  before: BoardSession;
  after: BoardSession;
}

/** 元に戻す／やり直しの履歴。 */
export interface CommandHistory {
  done: SessionCommand[];
  undone: SessionCommand[];
}

/** 空の履歴。 */
export function emptyHistory(): CommandHistory {
  return { done: [], undone: [] };
}

/** セッションを深くコピーする（履歴に入れるスナップショット）。 */
export function cloneSession(session: BoardSession): BoardSession {
  return {
    ...session,
    mounted: { ...session.mounted },
    wires: session.wires.map((w) => ({ ...w })),
    allowedColors: [...session.allowedColors],
    extraParts: [...session.extraParts],
    inventory: session.inventory.map((i) => ({ ...i })),
  };
}

/** 履歴に1手積む（上限を超えた古い手は捨てる。やり直し列は消える）。§8.2 */
export function pushCommand(history: CommandHistory, command: SessionCommand): CommandHistory {
  const done = [...history.done, command];
  return { done: done.slice(Math.max(0, done.length - HISTORY_LIMIT)), undone: [] };
}

/** 1手戻す。戻せなければ undefined。 */
export function undo(
  history: CommandHistory,
): { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined {
  const command = history.done[history.done.length - 1];
  if (command === undefined) return undefined;
  return {
    history: { done: history.done.slice(0, -1), undone: [...history.undone, command] },
    session: cloneSession(command.before),
    command,
  };
}

/** 1手やり直す。やり直せなければ undefined。 */
export function redo(
  history: CommandHistory,
): { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined {
  const command = history.undone[history.undone.length - 1];
  if (command === undefined) return undefined;
  return {
    history: { done: [...history.done, command], undone: history.undone.slice(0, -1) },
    session: cloneSession(command.after),
    command,
  };
}

/**
 * 操作の実行結果（成功なら新しいセッションと履歴1手）。
 * 失敗にも `wire` が付くことがある（`board-model` の `terminal-overload` のとき、張ろうとした
 * 電線そのもの）。呼び出し側はそれを `Simulation.addWire()` に渡して §5.6 #5 の危険操作として
 * 計上させる（`packages/board-model/src/session.ts` の `Result` を参照）。
 */
export type CommandResult<T> =
  | { ok: true; value: T; command: SessionCommand }
  | { ok: false; code: string; message: string; wire?: Wire };

function wrap<T>(
  before: BoardSession,
  session: BoardSession,
  result: Result<T>,
  kind: SessionCommand['kind'],
  label: string,
): CommandResult<T> {
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      ...(result.wire !== undefined ? { wire: result.wire } : {}),
    };
  }
  return {
    ok: true,
    value: result.value,
    command: { kind, label, before, after: cloneSession(session) },
  };
}

/**
 * 電線を張る。§8.2（失敗理由はそのままトーストに出す）
 *
 * 3D盤から渡ってくる端子IDは**物理ID**（`S1.10`。盤定義 `BoardTerminal.id`）だが、
 * `BoardSession.wires` と `toNetlist()` は**役割ID**（`CR1.10`。§6.4）で持つ。
 * その変換をここ1箇所で行う（`toNetlistTerminal()` は端子台や P/N はそのまま返す）。
 */
export function runAddWire(
  session: BoardSession,
  from: TerminalId,
  to: TerminalId,
  color: WireColor,
): CommandResult<Wire> {
  const before = cloneSession(session);
  const netFrom = toNetlistTerminal(session.socketRoles, from);
  const netTo = toNetlistTerminal(session.socketRoles, to);
  const result = addWire(session, JIPM_BOARD, netFrom, netTo, color);
  return wrap(before, session, result, 'addWire', `配線 ${netFrom} — ${netTo}（${color}）`);
}

/** 電線を外す。§8.2 */
export function runRemoveWire(session: BoardSession, wireId: string): CommandResult<Wire> {
  const before = cloneSession(session);
  const result = removeWire(session, wireId);
  return wrap(before, session, result, 'removeWire', `電線を削除 ${wireId}`);
}

/** 部品を装着する。§8.2 */
export function runPlug(
  session: BoardSession,
  socketId: SocketId,
  kind: MountableKind,
): CommandResult<unknown> {
  const before = cloneSession(session);
  const result = plug(session, socketId, kind);
  return wrap(before, session, result, 'plug', `${socketId} に ${kind} を装着`);
}

/** 部品を外す。§8.2 */
export function runUnplug(session: BoardSession, socketId: SocketId): CommandResult<unknown> {
  const before = cloneSession(session);
  const result = unplug(session, socketId);
  return wrap(before, session, result, 'unplug', `${socketId} の部品を取り外し`);
}

/** タイマの設定時間を変える。§8.2 */
export function runSetPreset(
  session: BoardSession,
  socketId: SocketId,
  presetMs: number,
): CommandResult<unknown> {
  const before = cloneSession(session);
  const result = setPreset(session, socketId, presetMs);
  return wrap(
    before,
    session,
    result,
    'setPreset',
    `${socketId} のタイマを ${(presetMs / 1000).toFixed(1)} 秒に設定`,
  );
}
