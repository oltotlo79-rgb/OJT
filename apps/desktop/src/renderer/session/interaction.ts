import type { SocketId } from '@ojt/board-model';
import type { TerminalId, WireColor } from '@ojt/circuit-sim';

/**
 * 「ピック結果 → 実行する操作」の純粋関数。設計仕様 §12.2。
 * 3D も React も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 */

/** レイキャストで拾えるもの。§12.2 */
export type PickHit =
  | { kind: 'terminal'; id: TerminalId; wirable: boolean; label: string }
  | { kind: 'wire'; id: string; locked: boolean }
  | { kind: 'socket'; id: SocketId; occupied: boolean }
  | { kind: 'pushbutton'; id: string }
  | { kind: 'empty' };

/** ツールバーのモード。§8.1 */
export type ToolMode = 'wire' | 'delete';

/** ピック判断に要る UI 状態だけを抜き出したもの。 */
export interface InteractionState {
  mode: ToolMode;
  /** 配線1本目に選んだ端子（未選択は undefined）。§8.2 */
  pendingTerminal: TerminalId | undefined;
  /** 選択中の電線ID。§8.2 */
  selectedWire: string | undefined;
  /** 選択中の線色。§8.1 */
  wireColor: WireColor;
}

/** ピックの結果として実行する操作。 */
export type PickAction =
  | { type: 'none' }
  /** 配線の1本目を選んだ。 */
  | { type: 'beginWire'; from: TerminalId }
  /** 2本目を選んだので電線を張る。 */
  | { type: 'completeWire'; from: TerminalId; to: TerminalId; color: WireColor }
  /** 配線操作を取り消す。§8.2 */
  | { type: 'cancelWire' }
  /** 電線を選択する。 */
  | { type: 'selectWire'; wireId: string }
  /** 電線を削除する。 */
  | { type: 'removeWire'; wireId: string }
  /** 固定配線には触れない。§6.3 */
  | { type: 'reject'; message: string }
  /** ソケットを選ぶ（部品パネルで装着する部品を選ばせる）。§8.2 */
  | { type: 'selectSocket'; socketId: SocketId }
  /** 装着済み部品を選ぶ（取り外しUIを出す）。§8.2 */
  | { type: 'selectMounted'; socketId: SocketId }
  /** 押ボタンを押す。§8.2 */
  | { type: 'pressButton'; pbId: string };

/** 固定配線を触ったときの文言（既設配線は本アプリでは全て青。§6.3・§6.6）。 */
export const LOCKED_WIRE_MESSAGE = 'チェック用回路の既設配線（青）は変更できません';
/** 配線できない端子を触ったときの文言。§6.4 */
export const NOT_WIRABLE_MESSAGE = 'この端子には配線できません（本体側は既設配線済みです）';

/**
 * ピック結果を操作に変換する。§12.2
 * - 削除モード: 電線を拾ったら選択（実際の削除は Delete キー。§8.2）、`locked` なら拒否、
 *   それ以外は何もしない
 * - 配線モード: 端子 → 端子 で配線、同じ端子を2度押したら取り消し、空間クリックで取り消し。
 *   電線のクリック選択は削除モード限定なので、配線モードでは電線を拾っても何もしない
 *   （配線中でも取り消し扱いにはしない。§8.2「配線モードでは端子クリックを優先」）
 */
export function pickToAction(state: InteractionState, hit: PickHit): PickAction {
  if (state.mode === 'delete') {
    if (hit.kind === 'wire') {
      return hit.locked
        ? { type: 'reject', message: LOCKED_WIRE_MESSAGE }
        : { type: 'selectWire', wireId: hit.id };
    }
    if (hit.kind === 'pushbutton') return { type: 'pressButton', pbId: hit.id };
    return { type: 'none' };
  }

  switch (hit.kind) {
    case 'terminal': {
      if (!hit.wirable) return { type: 'reject', message: NOT_WIRABLE_MESSAGE };
      const pending = state.pendingTerminal;
      if (pending === undefined) return { type: 'beginWire', from: hit.id };
      if (pending === hit.id) return { type: 'cancelWire' };
      return { type: 'completeWire', from: pending, to: hit.id, color: state.wireColor };
    }
    case 'wire':
      return { type: 'none' };
    case 'socket':
      if (state.pendingTerminal !== undefined) return { type: 'cancelWire' };
      return hit.occupied
        ? { type: 'selectMounted', socketId: hit.id }
        : { type: 'selectSocket', socketId: hit.id };
    case 'pushbutton':
      return state.pendingTerminal === undefined
        ? { type: 'pressButton', pbId: hit.id }
        : { type: 'cancelWire' };
    case 'empty':
      if (state.pendingTerminal !== undefined) return { type: 'cancelWire' };
      return state.selectedWire === undefined
        ? { type: 'none' }
        : { type: 'selectWire', wireId: '' };
  }
}

/** Esc キーの扱い（配線中なら取り消し、それ以外は何もしない）。§8.2 */
export function escapeToAction(state: InteractionState): PickAction {
  return state.pendingTerminal === undefined ? { type: 'none' } : { type: 'cancelWire' };
}

/** Delete キーの扱い（削除モードで電線を選んでいれば削除。電線選択は削除モード限定。§8.2 / §12.2） */
export function deleteKeyToAction(
  state: InteractionState,
  lockedWireIds: readonly string[],
): PickAction {
  if (state.mode !== 'delete') return { type: 'none' };
  const id = state.selectedWire;
  if (id === undefined || id.length === 0) return { type: 'none' };
  if (lockedWireIds.includes(id)) return { type: 'reject', message: LOCKED_WIRE_MESSAGE };
  return { type: 'removeWire', wireId: id };
}
