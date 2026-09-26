import {
  addWire,
  OUTLET_ID,
  PLC_PART_ID,
  plug,
  SOCKET_IDS,
  type BoardDefinition,
  type BoardSession,
} from '@ojt/board-model';
import type { Wire } from '@ojt/circuit-sim';
import { cloneSession } from './commands.js';

/**
 * メーカー（PLC機種）を切り替えるときに、盤の作業を持ち越す純関数。
 * 2026-09-26 利用者報告「3D図の画面の時に各メーカーのシーケンサーを切り替えることができない」。
 *
 * 機種が変わると PLC本体の端子名（`X0` / `0.00` / `A0` …）が変わるので、**PLC本体と壁コンセントに
 * つながる電線だけは外す**。盤の中だけで閉じた電線（リレー・端子台・P/N の渡り）と装着した部品・
 * タイマの設定は、そのまま新しい機種の盤へ載せ直す。以前は切り替えるたびに盤がまっさらになり、
 * 盤内の配線を最初から張り直す必要があった。
 */

/** 電線が PLC本体か壁コンセントの端子につながっているか（機種を替えると張り直しになる）。 */
export function touchesPlcDesk(wire: Pick<Wire, 'from' | 'to'>): boolean {
  return [wire.from, wire.to].some(
    (end) => String(end).startsWith(`${PLC_PART_ID}.`) || String(end).startsWith(`${OUTLET_ID}.`),
  );
}

/** 切り替えると外れる本数・残る本数・残る部品の数（確認画面に出す）。 */
export interface CarrySummary {
  /** PLC本体・壁コンセントにつながっていて外れる電線。 */
  dropped: number;
  /** 盤の中で閉じていて残る電線（固定配線は数えない）。 */
  kept: number;
  /** 残る装着部品。 */
  parts: number;
}

/** いまの盤を切り替えたときに何が残るか。 */
export function carrySummary(session: BoardSession): CarrySummary {
  const own = session.wires.filter((wire) => !wire.locked);
  const dropped = own.filter(touchesPlcDesk).length;
  return {
    dropped,
    kept: own.length - dropped,
    parts: SOCKET_IDS.filter((socketId) => session.mounted[socketId] !== undefined).length,
  };
}

/**
 * 切替前の盤（`previous`）の部品と盤内の電線を、切替後の空の盤（`next`）へ載せ直した盤を返す。
 * `next` は書き換えない。載せ直せなかった電線・部品（端子や在庫が合わない）は黙って落とす
 * （切替前の盤は同じ課題・同じ盤なので、実際には起きない）。
 */
export function carryOverBoard(
  previous: BoardSession,
  next: BoardSession,
  board: BoardDefinition,
): BoardSession {
  const carried = cloneSession(next);
  for (const socketId of SOCKET_IDS) {
    const part = previous.mounted[socketId];
    if (part === undefined || carried.mounted[socketId] !== undefined) continue;
    plug(
      carried,
      socketId,
      part.kind,
      part.kind === 'timer-h3y4' ? { presetMs: part.presetMs, rangeMaxMs: part.rangeMaxMs } : {},
    );
  }
  for (const wire of previous.wires) {
    if (wire.locked || touchesPlcDesk(wire)) continue;
    if (carried.wires.some((w) => w.id === wire.id)) continue;
    addWire(carried, board, wire.from, wire.to, wire.color, { id: wire.id });
  }
  carried.wireSeq = Math.max(carried.wireSeq, previous.wireSeq);
  return carried;
}
