import type { MountableKind, SocketId } from '@ojt/board-model';
import { MAX_WIRES_PER_TERMINAL, type TerminalId, type WireColor } from '@ojt/circuit-sim';
import type { PendingReport } from '../app/store-types.js';
import { JA } from '../i18n/ja.js';

/**
 * 「ピック結果 → 実行する操作」の純粋関数。設計仕様 §12.2 / Phase 7 設計 §7.3。
 * 3D も React も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 *
 * 2026-09-20（Phase 7 Task 27・指摘 UX-08 / PR-11 / 利用者要望9）で**直接操作**（3Dを
 * クリックして電源を入れる／端子から端子へドラッグして配線する／部品をつまんでソケットへ
 * 落とす）を足した。入口は3つ（3Dのクリック・3Dのドラッグ・端子リストと部品パレット）に
 * 増えたが、**何が起きるかを決めるのはこの `intentOf()` 1箇所だけ**にする（Phase 7 設計 §7.2
 * 案B: 対象で決まるモードレス操作）。`pickToAction()` は `intentOf()` の結果を既存の
 * `PickAction` の語彙へ直すだけの薄い層になっている。
 */

/** レイキャストで拾えるもの。§12.2 */
export type PickHit =
  | { kind: 'terminal'; id: TerminalId; wirable: boolean; label: string }
  | { kind: 'wire'; id: string; locked: boolean }
  | { kind: 'socket'; id: SocketId; occupied: boolean }
  | { kind: 'pushbutton'; id: string }
  /** AC一次側の操作部（ブレーカのハンドル／電源スイッチのロッカー）。Phase 7 設計 §7.3.2 */
  | { kind: 'fixture'; fixture: PowerFixture }
  | { kind: 'empty' };

/** 3Dで押せる電源の操作部。 */
export type PowerFixture = 'breaker' | 'switch';

/**
 * つまんで運んでいるもの。Phase 7 設計 §7.3.3
 * パレットの在庫カード（`palette`）と、盤に載っている部品そのもの（`socket`）の2通り。
 */
export type DragPayload =
  | { source: 'palette'; kind: MountableKind }
  | { source: 'socket'; socketId: SocketId; kind: MountableKind };

/** 断る理由。文言は持たない（`refuseMessageKey()` が `i18n/ja.ts` の鍵を返す）。 */
export type RefuseReason =
  'terminal-full' | 'not-wirable' | 'locked-wire' | 'socket-occupied' | 'not-a-socket';

/** 断る理由の全部（試験が「すべて文言を持つ」ことを確かめるために並べる）。 */
export const REFUSE_REASONS: readonly RefuseReason[] = [
  'terminal-full',
  'not-wirable',
  'locked-wire',
  'socket-occupied',
  'not-a-socket',
];

/** 断る理由 → `JA.refuse` の鍵。 */
const REFUSE_KEYS: Readonly<Record<RefuseReason, keyof typeof JA.refuse>> = {
  'terminal-full': 'terminalFull',
  'not-wirable': 'notWirable',
  'locked-wire': 'lockedWire',
  'socket-occupied': 'socketOccupied',
  'not-a-socket': 'notASocket',
};

/** 断る理由の日本語（`i18n/ja.ts` のキーを返すだけ。文言は持たない）。Phase 7 設計 §7.3.1 */
export function refuseMessageKey(reason: RefuseReason): keyof typeof JA.refuse {
  return REFUSE_KEYS[reason];
}

/** 断る理由の文（`JA.refuse` から引く。トーストとホバー予告の両方がこれを使う）。 */
export function refuseMessage(reason: RefuseReason): string {
  return JA.refuse[refuseMessageKey(reason)];
}

/**
 * ツールバーのモード。§8.1 / §9.2 / §9.3
 * `tester` はプローブを端子に置くモード（C1/C2）、`report` は3D要素をクリックして
 * 故障を指摘するモード（C2）。どのモードでも押ボタンは押せる（励磁して測るため）。
 */
export type ToolMode = 'wire' | 'delete' | 'tester' | 'report';

/** 端子1つの結線状況（`legalTargets()` と「2本で一杯」の判断に使う）。 */
export interface TerminalLoad {
  id: TerminalId;
  /** いまその端子に繋がっている電線の本数（既設配線も数える）。§6.6 */
  wireCount: number;
  wireLimit?: number;
}

/**
 * ピック判断に要る UI 状態だけを抜き出したもの。
 *
 * 直接操作のために足した3つ（`terminals` / `dragging`）は**省略できる**ようにしてある。
 * `pickToAction()` の呼び出し元（端子リスト・回路図からの選択）は運搬もしなければ端子の
 * 本数も知らないので、渡さなければ「運んでいない・本数は分からない」として従来どおり動く。
 */
export interface InteractionState {
  replaying?: boolean;
  mode: ToolMode;
  /** 配線1本目に選んだ端子（未選択は undefined）。§8.2 */
  pendingTerminal: TerminalId | undefined;
  /** 選択中の電線ID。§8.2 */
  selectedWire: string | undefined;
  /** 選択中の線色。§8.1 */
  wireColor: WireColor;
  /** 盤の端子と結線数（3Dから渡す。渡さなければ満杯の判断はしない）。Phase 7 設計 §7.3.1 */
  terminals?: readonly TerminalLoad[] | undefined;
  /** つまんで運んでいるもの（運んでいなければ undefined）。Phase 7 設計 §7.3.3 */
  dragging?: DragPayload | undefined;
}

/**
 * ポインタが指しているものと、いまの状態から「何が起きるか」。Phase 7 設計 §7.3.1
 * 描画も副作用も持たない。
 */
export type Intent =
  | { type: 'none' }
  /** ブレーカ／電源スイッチを入切する。 */
  | { type: 'togglePower'; fixture: PowerFixture }
  /** 空きソケットを選ぶ（部品カードを開く）。 */
  | { type: 'selectSocket'; socketId: SocketId }
  /** 装着済みソケットを選ぶ（部品カードを開く）。設計 §7.3.2「装着部品のクリック＝カードを開く」 */
  | { type: 'selectMounted'; socketId: SocketId }
  /** つまんだ部品をソケットの外へ放した＝取り外し。 */
  | { type: 'unplugPart'; socketId: SocketId }
  /** 配線の1本目を選んだ。 */
  | { type: 'beginWire'; from: TerminalId }
  /** 2本目を選んだので電線を張る。 */
  | { type: 'completeWire'; from: TerminalId; to: TerminalId; color: WireColor }
  /** 配線操作を取り消す。 */
  | { type: 'cancelWire' }
  /** 電線を選択する（`wireId` が空文字なら選択解除）。 */
  | { type: 'selectWire'; wireId: string }
  /** つまんだ部品を空きソケットへ落とす。 */
  | { type: 'dropPart'; socketId: SocketId; kind: MountableKind }
  /** 押ボタンを押す。 */
  | { type: 'pressButton'; pbId: string }
  /** 断る（理由つき）。 */
  | { type: 'refuse'; reason: RefuseReason };

/**
 * 故障の指摘先。§9.2 / Plan 2A の `FaultReport['target']` と同じ形にする。
 * 未配線は盤に電線が無いので端子で指す（Plan 2A 意図的な差分 #6）。
 *
 * 実体はストアの値型（`app/store-types.ts` の `PendingReport`）。ストアは「種別を選ぶ前の対象」を
 * 持つ必要があり、その値型は three にも React にも依存しない層に置きたいので、定義をあちらに寄せて
 * ここからは名前だけを通す（同じ形の型が2つできると片方だけ広げたときに静かにずれる）。
 */
export type ReportTarget = PendingReport;

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
  /** ブレーカ／電源スイッチを入切する（3Dの操作部を押した）。Phase 7 設計 §7.3.2 */
  | { type: 'togglePower'; fixture: PowerFixture }
  /** つまんだ部品を空きソケットへ落とす。Phase 7 設計 §7.3.3 */
  | { type: 'dropPart'; socketId: SocketId; kind: MountableKind }
  /** つまんだ部品をソケットの外へ放した＝取り外し。Phase 7 設計 §7.3.2 */
  | { type: 'unplugPart'; socketId: SocketId }
  /** テスターのプローブを端子に置く。§9.3 */
  | { type: 'placeProbe'; probe: 'black' | 'red'; terminal: TerminalId }
  /** テスターのプローブを外す（`both` は両方）。§9.3 */
  | { type: 'liftProbe'; probe: 'black' | 'red' | 'both' }
  /** 故障の指摘先を選んだので種別ポップオーバーを出す。§9.2 */
  | { type: 'openReport'; target: ReportTarget };

/**
 * 固定配線を触ったときの文言（既設配線は本アプリでは全て青。§6.3・§6.6）。
 * 文言の正本は `JA.refuse`（§15「全文言を1箇所に集約」）。ここは従来の名前を残すだけの別名。
 */
export const LOCKED_WIRE_MESSAGE = JA.refuse.lockedWire;
/** 配線できない端子を触ったときの文言。§6.4 */
export const NOT_WIRABLE_MESSAGE = JA.refuse.notWirable;

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
const modalLayers = new Set<number>();
let nextModalDepth = 0;
let previousBodyOverflow = '';

/**
 * モーダルを1枚積む。`depth` はこの1枚の重なり順（一番外側が1）、`release()` を呼ぶと下ろす
 * （`useEffect` の後始末から呼ぶ）。親が先に閉じても、残る窓の順序を変えない。
 * 本文のスクロール止めもここで共有し、最後の1枚が閉じたときだけ元の値へ戻す。
 *
 * `depth` はモーダルが2枚重なったときに Esc が**上の1枚だけ**を閉じるために要る
 * （`topModalLayer()` と比べて自分が最上段でなければキー入力を無視する）。
 */
export function pushModalLayer(): { depth: number; release: () => void } {
  if (modalLayers.size === 0 && typeof document !== 'undefined') {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  const depth = ++nextModalDepth;
  modalLayers.add(depth);
  let released = false;
  return {
    depth,
    release: () => {
      if (released) return;
      released = true;
      modalLayers.delete(depth);
      if (modalLayers.size === 0) {
        nextModalDepth = 0;
        if (typeof document !== 'undefined') document.body.style.overflow = previousBodyOverflow;
      }
    },
  };
}

/** モーダルが開いているか。§8.2 */
export function isModalOpen(): boolean {
  return modalLayers.size > 0;
}

/** 一番上に積まれているモーダルの重なり順（積んでいなければ0）。§8.2 */
export function topModalLayer(): number {
  return [...modalLayers].at(-1) ?? 0;
}

/**
 * 盤のショートカット（Esc / Delete / 1・2・3）を**無視すべき**キー入力か。§8.2
 *
 * タイマの設定秒を数値入力欄へ打ち込むと `3` で視点が「ソケット拡大」に飛び、
 * `Delete` で電線が消える、という取り違えが起きていた（レビュー指摘）。
 * 入力欄に宛てられたキーと、IME の変換中（`isComposing`）、
 * そしてモーダルが開いているあいだ（`isModalOpen()`）は盤へ通さない。
 */
export function shouldIgnoreShortcut(
  event: {
    target: unknown;
    isComposing?: boolean | undefined;
  },
  allowedModalDepth?: number,
): boolean {
  return (
    (isModalOpen() && topModalLayer() !== allowedModalDepth) ||
    event.isComposing === true ||
    isTypingTarget(event.target)
  );
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
  return toPickAction(intentOf(state, hit));
}

/**
 * 意図を既存の `PickAction` の語彙へ直す。断る理由だけがここで文言になる
 * （`Intent` は理由の符号しか持たない。Phase 7 設計 §7.3.1）。
 */
export function toPickAction(intent: Intent): PickAction {
  return intent.type === 'refuse'
    ? { type: 'reject', message: refuseMessage(intent.reason) }
    : intent;
}

/** その端子に繋がっている本数（`terminals` を渡していなければ 0 として扱う）。 */
function wireCountOf(state: InteractionState, id: TerminalId): number {
  return state.terminals?.find((row) => row.id === id)?.wireCount ?? 0;
}

/** その端子はもう2本つながっているか（§6.6 の上限）。 */
export function isTerminalFull(state: InteractionState, id: TerminalId): boolean {
  return (
    wireCountOf(state, id) >=
    (state.terminals?.find((row) => row.id === id)?.wireLimit ?? MAX_WIRES_PER_TERMINAL)
  );
}

/**
 * いまの状態でつなげられる端子の集合。配線中のハイライトに使う。Phase 7 設計 §7.3.1
 * 2本で一杯の端子と、1本目に選んでいる端子そのものを外す（同じ端子は「取り消し」であって
 * 接続先ではない）。`terminals` を渡していなければ空（＝光らせるものが無い）。
 */
export function legalTargets(state: InteractionState): readonly TerminalId[] {
  const pending = state.pendingTerminal;
  return (state.terminals ?? [])
    .filter(
      (row) => row.id !== pending && row.wireCount < (row.wireLimit ?? MAX_WIRES_PER_TERMINAL),
    )
    .map((row) => row.id);
}

/**
 * ポインタが指しているものと、いまの状態から「何が起きるか」を決める。Phase 7 設計 §7.3.1
 *
 * 判断の順は ①運搬中（つまんでいるものが最優先） ②電源の操作部（どのモードでも押せる）
 * ③モードごとの規則、である。電源をモードの前に置くのは、点検（C1/C2）でも
 * 「ブレーカを入れてから測る」が要るためで、**触ったものが反応する**という約束を
 * モードで破らないようにするため。
 */
export function intentOf(state: InteractionState, hit: PickHit): Intent {
  if (state.replaying === true) return { type: 'none' };
  const carried = state.dragging;
  if (carried !== undefined) return dropIntent(carried, hit);
  // 電源の操作部はモードに関わらず押せる（実物の盤と同じ）
  if (hit.kind === 'fixture') return { type: 'togglePower', fixture: hit.fixture };

  if (state.mode === 'tester' || state.mode === 'report') {
    // テスター／指摘モードの判断は専用の純関数が持つ（`session/tester.ts` / `session/inspect-repair.ts`）
    return { type: 'none' };
  }

  if (state.mode === 'delete') {
    if (hit.kind === 'wire') {
      return hit.locked
        ? { type: 'refuse', reason: 'locked-wire' }
        : { type: 'selectWire', wireId: hit.id };
    }
    if (hit.kind === 'pushbutton') return { type: 'pressButton', pbId: hit.id };
    // 電線の選択は削除モードにしかないので、選択解除もここに置く（配線モード側では死に枝だった）
    if (hit.kind === 'empty' && hasSelection(state)) return { type: 'selectWire', wireId: '' };
    return { type: 'none' };
  }

  switch (hit.kind) {
    case 'terminal': {
      if (!hit.wirable) return { type: 'refuse', reason: 'not-wirable' };
      const pending = state.pendingTerminal;
      if (pending === undefined) return { type: 'beginWire', from: hit.id };
      if (pending === hit.id) return { type: 'cancelWire' };
      /*
       * **2本で一杯の端子でも手は止めない。** 実機ではやってしまえる操作なので、
       * `addWire()` まで通して `terminal-overload` を出させ、危険操作として計上する
       * （§5.6 #5 / §17 #25。`Session` の `apply()` が断られた電線を Worker へ送る）。
       * 訓練者には**押す前に**理由を知らせる: 指した時点で `hoverHintFor()` が
       * 「この端子はすでに2本つながっています」を下端に出し、`legalTargets()` が
       * その端子を灰に沈める（Phase 7 設計 §7.3.2・§7.3.4）。
       */
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

/**
 * 運搬中に放したときの意図。Phase 7 設計 §7.3.2 / §7.3.3
 * - パレットの在庫 → 空きソケットなら装着、埋まっていれば断る、ソケット以外なら断る
 * - 盤の部品 → 元のソケットへ戻せば何もしない、それ以外の場所へ放せば取り外し
 */
function dropIntent(carried: DragPayload, hit: PickHit): Intent {
  if (carried.source === 'socket') {
    if (hit.kind === 'socket' && hit.id === carried.socketId) return { type: 'none' };
    return { type: 'unplugPart', socketId: carried.socketId };
  }
  if (hit.kind !== 'socket') return { type: 'refuse', reason: 'not-a-socket' };
  return hit.occupied
    ? { type: 'refuse', reason: 'socket-occupied' }
    : { type: 'dropPart', socketId: hit.id, kind: carried.kind };
}

/**
 * ホバー予告の1行（Phase 7 設計 §7.3.4）。**意図から**作るので、予告と実際に起きることが
 * ずれない（「押すと何が起きるか」を別の表で書き直すと、片方だけ直して食い違う）。
 * 予告するものが無ければ `undefined`（呼び出し側が最初の一手の案内を出す）。
 */
export function hintForIntent(
  intent: Intent,
  power: { breakerOn: boolean; switchOn: boolean },
): string | undefined {
  const hint = JA.hoverHint;
  switch (intent.type) {
    case 'togglePower':
      if (intent.fixture === 'breaker') return power.breakerOn ? hint.breakerOff : hint.breakerOn;
      if (power.switchOn) return hint.switchOff;
      // 手順は①ブレーカ②電源スイッチ（§5.3.5）。順を間違えても止めないが、先に言う
      return power.breakerOn ? hint.switchOn : hint.switchOffFirst;
    case 'beginWire':
      return hint.wireBegin;
    case 'completeWire':
      return hint.wireFinish;
    case 'selectSocket':
      return hint.socketEmpty;
    case 'selectMounted':
      return hint.socketMounted;
    case 'dropPart':
      return hint.carrying;
    case 'unplugPart':
      return hint.carryingMounted;
    case 'pressButton':
      return hint.pushButton;
    case 'refuse':
      return refuseMessage(intent.reason);
    default:
      return undefined;
  }
}

/**
 * いま指しているものの予告（Phase 7 設計 §7.3.4）。`hintForIntent()` の一段上で、
 * **実行はしないが先に言っておくべきこと**を足す。
 *
 * いまのところ1つだけ: 2本で一杯の端子。手は止めない（`intentOf()` の注記のとおり、
 * 実機で起こせる操作は起こさせて危険操作に数える）が、押す前に理由は言う。
 */
export function hoverHintFor(
  state: InteractionState,
  hit: PickHit,
  power: { breakerOn: boolean; switchOn: boolean },
): string | undefined {
  if (
    hit.kind === 'terminal' &&
    state.dragging === undefined &&
    state.mode === 'wire' &&
    state.pendingTerminal !== hit.id &&
    isTerminalFull(state, hit.id)
  ) {
    return refuseMessage('terminal-full');
  }
  return hintForIntent(intentOf(state, hit), power);
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
