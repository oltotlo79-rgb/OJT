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

/**
 * ツールバーのモード。§8.1 / §9.2 / §9.3
 * `tester` はプローブを端子に置くモード（C1/C2）、`report` は3D要素をクリックして
 * 故障を指摘するモード（C2）。どのモードでも押ボタンは押せる（励磁して測るため）。
 */
export type ToolMode = 'wire' | 'delete' | 'tester' | 'report';

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

/**
 * 故障の指摘先。§9.2 / Plan 2A の `FaultReport['target']` と同じ形にする。
 * 未配線は盤に電線が無いので端子で指す（Plan 2A 意図的な差分 #6）。
 */
export type ReportTarget = { wireId: string } | { partId: string } | { terminalId: string };

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
  | { type: 'pressButton'; pbId: string }
  /** テスターのプローブを端子に置く。§9.3 */
  | { type: 'placeProbe'; probe: 'black' | 'red'; terminal: TerminalId }
  /** テスターのプローブを外す（`both` は両方）。§9.3 */
  | { type: 'liftProbe'; probe: 'black' | 'red' | 'both' }
  /** 故障の指摘先を選んだので種別ポップオーバーを出す。§9.2 */
  | { type: 'openReport'; target: ReportTarget };

/** 固定配線を触ったときの文言（既設配線は本アプリでは全て青。§6.3・§6.6）。 */
export const LOCKED_WIRE_MESSAGE = 'チェック用回路の既設配線（青）は変更できません';
/** 配線できない端子を触ったときの文言。§6.4 */
export const NOT_WIRABLE_MESSAGE = 'この端子には配線できません（本体側は既設配線済みです）';

/** 電線が選択されているか（空文字は「選択なし」の別表現）。 */
function hasSelection(state: InteractionState): boolean {
  return state.selectedWire !== undefined && state.selectedWire.length > 0;
}

/** 文字を打ち込む要素のタグ名。 */
const TYPING_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * そのイベントの宛先が「文字を打ち込む欄」か。§8.2
 * DOM の型に依存させないためダックタイピングで見る（`interaction.ts` は純粋な層）。
 */
export function isTypingTarget(target: unknown): boolean {
  if (target === null || typeof target !== 'object') return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === 'string' && TYPING_TAGS.has(element.tagName.toUpperCase());
}

/**
 * 開いているモーダル（タイムチャートの拡大表示など）の重なり数。§8.2 / §7.7
 * モーダルは `document.body` へポータルで出すので、キー入力は窓口まで上がってくる。
 * 盤のショートカットへ通してしまうと、拡大表示を Esc で閉じたつもりが電線の選択も解除される、
 * `3` で後ろの3Dビューが「ソケット拡大」へ飛ぶ、といった取り違えが起きる。
 */
let modalLayers = 0;

/**
 * モーダルを1枚積む。`depth` はこの1枚の重なり順（一番外側が1）、`release()` を呼ぶと下ろす
 * （`useEffect` の後始末から呼ぶ）。数で持つのは、モーダルの上にモーダルが出ても取りこぼさないため。
 *
 * `depth` はモーダルが2枚重なったときに Esc が**上の1枚だけ**を閉じるために要る
 * （`topModalLayer()` と比べて自分が最上段でなければキー入力を無視する）。
 */
export function pushModalLayer(): { depth: number; release: () => void } {
  modalLayers += 1;
  const depth = modalLayers;
  let released = false;
  return {
    depth,
    release: () => {
      if (released) return;
      released = true;
      modalLayers = Math.max(0, modalLayers - 1);
    },
  };
}

/** モーダルが開いているか。§8.2 */
export function isModalOpen(): boolean {
  return modalLayers > 0;
}

/** 一番上に積まれているモーダルの重なり順（積んでいなければ0）。§8.2 */
export function topModalLayer(): number {
  return modalLayers;
}

/**
 * 盤のショートカット（Esc / Delete / 1・2・3）を**無視すべき**キー入力か。§8.2
 *
 * タイマの設定秒を数値入力欄へ打ち込むと `3` で視点が「ソケット拡大」に飛び、
 * `Delete` で電線が消える、という取り違えが起きていた（レビュー指摘）。
 * 入力欄に宛てられたキーと、IME の変換中（`isComposing`）、
 * そしてモーダルが開いているあいだ（`isModalOpen()`）は盤へ通さない。
 */
export function shouldIgnoreShortcut(event: {
  target: unknown;
  isComposing?: boolean | undefined;
}): boolean {
  return isModalOpen() || event.isComposing === true || isTypingTarget(event.target);
}

/**
 * ピック結果を操作に変換する。§12.2
 * - 削除モード: 電線を拾ったら選択（実際の削除は Delete キー。§8.2）、`locked` なら拒否、
 *   空間クリックは選択解除、それ以外は何もしない
 * - 配線モード: 端子 → 端子 で配線、同じ端子を2度押したら取り消し、空間クリックで取り消し。
 *   電線のクリック選択は削除モード限定なので、配線モードでは電線を拾っても何もしない
 *   （配線中でも取り消し扱いにはしない。§8.2「配線モードでは端子クリックを優先」）
 */
export function pickToAction(state: InteractionState, hit: PickHit): PickAction {
  if (state.mode === 'tester' || state.mode === 'report') {
    // テスター／指摘モードの判断は専用の純関数が持つ（`session/tester.ts` / `session/inspect-repair.ts`）
    return { type: 'none' };
  }

  if (state.mode === 'delete') {
    if (hit.kind === 'wire') {
      return hit.locked
        ? { type: 'reject', message: LOCKED_WIRE_MESSAGE }
        : { type: 'selectWire', wireId: hit.id };
    }
    if (hit.kind === 'pushbutton') return { type: 'pressButton', pbId: hit.id };
    // 電線の選択は削除モードにしかないので、選択解除もここに置く（配線モード側では死に枝だった）
    if (hit.kind === 'empty' && hasSelection(state)) return { type: 'selectWire', wireId: '' };
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
      return state.pendingTerminal === undefined ? { type: 'none' } : { type: 'cancelWire' };
  }
}

/** Esc キーの扱い（配線中なら取り消し、削除モードで電線を選んでいれば選択解除）。§8.2 */
export function escapeToAction(state: InteractionState): PickAction {
  if (state.pendingTerminal !== undefined) return { type: 'cancelWire' };
  if (state.mode === 'delete' && hasSelection(state)) return { type: 'selectWire', wireId: '' };
  return { type: 'none' };
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
