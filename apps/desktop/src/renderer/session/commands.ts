import {
  addWire,
  JIPM_BOARD,
  plug,
  removeWire,
  setPreset,
  toNetlistTerminal,
  unplug,
  type BoardDefinition,
  type BoardSession,
  type MountableKind,
  type Result,
  type SocketId,
} from '@ojt/board-model';
import type { TerminalId, Wire, WireColor } from '@ojt/circuit-sim';
import type { RepairCircuit } from '@ojt/content';
import { partKindLabel, wireLabel } from '../i18n/ja.js';

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
  kind:
    | 'plcAssignment'
    | 'reconnectWire'
    | 'wireMetadata'
    | 'addWire'
    | 'removeWire'
    | 'plug'
    | 'unplug'
    | 'setPreset'
    | 'replacePart';
  /** 操作の説明（操作ログに出す文）。§8.1 */
  label: string;
  before: BoardSession;
  after: BoardSession;
  /**
   * モードC2の部品交換のときだけ持つ、交換前後の回路（故障を含む）。undo/redo で使う。§9.2
   * 交換は盤（`BoardSession`）を変えない（ソケットの中身は同じ種類の部品のまま）ので、
   * 前後の違いは `RepairCircuit.applied.partFaults` にしか出ない。
   */
  circuitBefore?: RepairCircuit;
  circuitAfter?: RepairCircuit;
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
    ...(session.boardProfile === undefined
      ? {}
      : { boardProfile: structuredClone(session.boardProfile) }),
    mounted: { ...session.mounted },
    ...(session.plcAssignment === undefined
      ? {}
      : { plcAssignment: structuredClone(session.plcAssignment) }),
    ...(session.wireAnnotations === undefined
      ? {}
      : { wireAnnotations: structuredClone(session.wireAnnotations) }),
    ...(session.wireRoutePreferences === undefined
      ? {}
      : { wireRoutePreferences: structuredClone(session.wireRoutePreferences) }),
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
 * その変換をここ1箇所で行う（`toNetlistTerminal()` は端子台・P/N・机上の `PLC.*` / `OUTLET.*`
 * はそのまま返す）。
 *
 * `board` はモードDが**PLC本体と壁コンセントを載せた派生盤**（`withPlcUnit()`）を渡すための
 * 引数である（§10.1）。既定は `JIPM_BOARD` なので、モードB/C1/C2 の呼び出しは変わらない。
 */
export function runAddWire(
  session: BoardSession,
  from: TerminalId,
  to: TerminalId,
  color: WireColor,
  board: BoardDefinition = JIPM_BOARD,
): CommandResult<Wire> {
  const before = cloneSession(session);
  const netFrom = toNetlistTerminal(session.socketRoles, from);
  const netTo = toNetlistTerminal(session.socketRoles, to);
  const result = addWire(session, board, netFrom, netTo, color);
  return wrap(before, session, result, 'addWire', `配線 ${netFrom} — ${netTo}（${color}）`);
}

/** 電線を外す。§8.2 */
export function runRemoveWire(session: BoardSession, wireId: string): CommandResult<Wire> {
  const before = cloneSession(session);
  const result = removeWire(session, wireId);
  // UXレビュー #6b: 内部の電線ID（`sw-005`）をそのまま出さず、両端の端子と色で示す
  const label = result.ok ? `電線を削除: ${wireLabel(result.value)}` : `電線を削除 ${wireId}`;
  return wrap(before, session, result, 'removeWire', label);
}

/** 部品を装着する。§8.2 */
export function runPlug(
  session: BoardSession,
  socketId: SocketId,
  kind: MountableKind,
): CommandResult<unknown> {
  const before = cloneSession(session);
  const result = plug(session, socketId, kind);
  // UXレビュー #6c: 操作ログに `relay-my4n` のような内部種別をそのまま出さない
  return wrap(before, session, result, 'plug', `${socketId} に ${partKindLabel(kind)} を装着`);
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

/**
 * 部品を入れ替える（外して別の部品を挿し直す）。**1手**として履歴に積む。§8.2
 * 利用者要望 2026-09-19「リレーやタイマはソケットから外して入れ替えたりできるようにすること」。
 *
 * 履歴は操作の前後のスナップショットで持つ（このファイル冒頭の方針）ので、`unplug` → `plug` を
 * 続けて実行しても**前後の差だけ**を1件に畳める。取り外しと装着で2手積むと「元に戻す」を
 * 2回押さないと元の部品に戻らず、利用者から見て1回の操作と食い違う。
 *
 * 挿す側が失敗したら（在庫切れ・未知のレンジ）、抜いた部品をその場に戻して何もしなかったことに
 * する。`session` は呼び出し側（ストア）が持っている実体そのものなので、途中の状態を残して
 * 帰ってはいけない。
 */
export function runSwapPart(
  session: BoardSession,
  socketId: SocketId,
  kind: MountableKind,
): CommandResult<unknown> {
  const before = cloneSession(session);
  const removed = unplug(session, socketId);
  if (!removed.ok) return { ok: false, code: removed.code, message: removed.message };
  const result = plug(session, socketId, kind);
  if (!result.ok) {
    session.mounted[socketId] = removed.value;
    return { ok: false, code: result.code, message: result.message };
  }
  return {
    ok: true,
    value: result.value,
    command: {
      kind: 'replacePart',
      // UXレビュー #6c: 操作ログに `relay-my4n` のような内部種別をそのまま出さない
      label: `${socketId} の部品を ${partKindLabel(kind)} に交換`,
      before,
      after: cloneSession(session),
    },
  };
}
