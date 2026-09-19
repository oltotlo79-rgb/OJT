import {
  cellAt,
  clearCell,
  COIL_COL,
  empty,
  endNetwork,
  hline,
  insertRow,
  LadderError,
  nc,
  no,
  program as makeProgram,
  network,
  rst,
  set,
  setCell,
  setVerticalLink,
  type Cell,
  type LadderProgram,
  type Network,
} from '@ojt/ladder-core';
import type { ShortcutEntry, ShortcutTable } from '@ojt/plc-dialects';

/**
 * ラダー編集の純粋層。設計仕様 §10.3 / §10.6 / §10.7。
 *
 * React も three も `@ojt/plc-dialects` の実装（プロファイルの中身）も知らない。編集の実体は
 * `@ojt/ladder-core` の `edit.ts`（純粋関数）で、このファイルが持つのは**呼び出し順**と
 * 「キー入力 → 操作」の対応だけである。キーの文字列は1つも書かない（決定表#12）。
 */

/** ラダーの取り消しで遡れる手数の上限（盤の `HISTORY_LIMIT` と同じ）。§8.2 */
export const LADDER_HISTORY_LIMIT = 50;

/** セルカーソル。 */
export interface LadderCursor {
  networkId: string;
  row: number;
  col: number;
}

/** エディタのモード。§10.6（`F2` / `Shift+F2` / `F3`）。決定表#11 */
export type LadderEditorMode = 'write' | 'read' | 'monitor';

/** 取り消し／やり直しのスタック（`LadderProgram` のスナップショット）。決定表#2 */
export interface LadderHistory {
  done: LadderProgram[];
  undone: LadderProgram[];
}

/** 編集の結果（失敗は理由つき。`LadderError` の文言をそのまま返す）。 */
export type LadderEditResult =
  { ok: true; program: LadderProgram } | { ok: false; message: string };

/** デバイス入力欄を開くセルの種別（`ShortcutEntry.action` と同じ語彙）。§10.6 */
export type PlaceKind =
  'contact-no' | 'contact-nc' | 'or-contact-no' | 'or-contact-nc' | 'coil' | 'hline' | 'vline';

/** キー入力から決まる操作。 */
export type LadderAction =
  | { type: 'none' }
  /** カーソルを相対移動する。 */
  | { type: 'move'; dRow: number; dCol: number }
  /** セルを置く（デバイスが要る種別はデバイス入力欄を開く）。 */
  | { type: 'place'; kind: PlaceKind }
  /** 罫線（`Ctrl+←↑↓→`）。 */
  | { type: 'ruleLine'; direction: 'left' | 'up' | 'down' | 'right' }
  | { type: 'toggleNoNc' }
  | { type: 'togglePulse' }
  | { type: 'convert' }
  /** `monitorWrite` は `Shift+F3`（モニタ書込み）で押されたことを示す。決定表#11 */
  | { type: 'setMode'; mode: LadderEditorMode; monitorWrite?: true }
  | { type: 'toggleInsert' }
  | { type: 'help' }
  /** カーソル位置のセルを編集する（デバイス入力欄を開く）。 */
  | { type: 'edit' }
  | { type: 'delete' }
  | { type: 'undo' }
  | { type: 'redo' }
  /** 表には載っているが Phase 3 では押せない項目（`enabled: false`）。 */
  | { type: 'disabled'; entry: ShortcutEntry }
  /** 読出し・モニタ中に編集操作を押した。 */
  | { type: 'readOnly' };

/** キー入力のうちこの層が見る部分（DOM の型に依存させない）。 */
export interface LadderKeyEvent {
  key?: string | undefined;
  ctrlKey?: boolean | undefined;
  shiftKey?: boolean | undefined;
  altKey?: boolean | undefined;
  metaKey?: boolean | undefined;
}

/** 矢印の記号 → `KeyboardEvent.key`。方言表（`Ctrl+←↑↓→`）の展開に使う。 */
const ARROW_KEYS: Readonly<Record<string, string>> = {
  '←': 'ArrowLeft',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '→': 'ArrowRight',
};

/**
 * 方言表の短い名前 → `KeyboardEvent.key` が実際に返す値。
 *
 * 三菱スキンは `Ins` / `Del` / `Esc` と書くが、ブラウザが渡すのは `Insert` / `Delete` / `Escape`
 * である。直さないと `insert-toggle` の行は**永久に一致しない**（レビュー指摘 B6）。表そのものは
 * Plan 3A の所有物なので書き換えず、照合側で吸収する。
 */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  Ins: 'Insert',
  Del: 'Delete',
  Esc: 'Escape',
};

/** 矢印キー → 罫線の向き。 */
const ARROW_DIRECTION: Readonly<Record<string, 'left' | 'up' | 'down' | 'right'>> = {
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowRight: 'right',
};

/** 矢印キー → カーソルの相対移動。 */
const ARROW_MOVE: Readonly<Record<string, { dRow: number; dCol: number }>> = {
  ArrowLeft: { dRow: 0, dCol: -1 },
  ArrowRight: { dRow: 0, dCol: 1 },
  ArrowUp: { dRow: -1, dCol: 0 },
  ArrowDown: { dRow: 1, dCol: 0 },
};

/** `action` → 置くセルの種別。表に無い `action` は `undefined`（押しても何もしない）。 */
const PLACE_KINDS: Readonly<Record<string, PlaceKind>> = {
  'contact-no': 'contact-no',
  'contact-nc': 'contact-nc',
  'or-contact-no': 'or-contact-no',
  'or-contact-nc': 'or-contact-nc',
  coil: 'coil',
  hline: 'hline',
  vline: 'vline',
};

/** `action` → エディタのモード。`monitor-write` は Phase 3 では `monitor` と同じ（決定表#11）。 */
const MODE_ACTIONS: Readonly<Record<string, LadderEditorMode>> = {
  'write-mode': 'write',
  'read-mode': 'read',
  monitor: 'monitor',
  'monitor-write': 'monitor',
};

/** 押されたキーを、ショートカット表と同じ書式の文字列にする。 */
export function keyChord(event: LadderKeyEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey === true || event.metaKey === true) parts.push('Ctrl');
  if (event.shiftKey === true) parts.push('Shift');
  if (event.altKey === true) parts.push('Alt');
  parts.push(event.key ?? '');
  return parts.join('+');
}

/** `keys` の文字列を照合できる形の一覧に展開する（`Ctrl+←↑↓→` → 4件、`Ins` → `Insert`）。 */
function expandKeys(keys: string): string[] {
  const plus = keys.lastIndexOf('+');
  const prefix = plus < 0 ? '' : keys.slice(0, plus + 1);
  const tail = plus < 0 ? keys : keys.slice(plus + 1);
  const arrows = [...tail].filter((char) => ARROW_KEYS[char] !== undefined);
  if (arrows.length > 0) return arrows.map((char) => `${prefix}${ARROW_KEYS[char] ?? char}`);
  return [`${prefix}${KEY_ALIASES[tail] ?? tail}`];
}

/** キー入力に対応するショートカット表の行を探す。決定表#12 */
export function matchShortcut(
  table: ShortcutTable,
  event: LadderKeyEvent,
): ShortcutEntry | undefined {
  const chord = keyChord(event);
  return table.find((entry) => expandKeys(entry.keys).includes(chord));
}

/** `ladderKeyToAction` が見る画面状態。 */
export interface LadderKeyState {
  cursor: LadderCursor;
  mode: LadderEditorMode;
}

/** 編集を伴う操作か（読出し・モニタ中に断るもの）。 */
function isEditing(action: LadderAction): boolean {
  return (
    action.type === 'place' ||
    action.type === 'ruleLine' ||
    action.type === 'toggleNoNc' ||
    action.type === 'togglePulse' ||
    action.type === 'edit' ||
    action.type === 'delete' ||
    action.type === 'undo' ||
    action.type === 'redo' ||
    action.type === 'toggleInsert'
  );
}

/** ショートカット表に無いキー（矢印・Tab・Enter・Delete・Ctrl+Z/Y）の扱い。 */
function builtinAction(event: LadderKeyEvent): LadderAction {
  const key = event.key ?? '';
  const ctrl = event.ctrlKey === true || event.metaKey === true;
  if (ctrl && (key === 'z' || key === 'Z')) {
    return event.shiftKey === true ? { type: 'redo' } : { type: 'undo' };
  }
  if (ctrl && (key === 'y' || key === 'Y')) return { type: 'redo' };
  if (ctrl) return { type: 'none' };
  const move = ARROW_MOVE[key];
  if (move !== undefined) return { type: 'move', ...move };
  if (key === 'Tab') return { type: 'move', dRow: 0, dCol: event.shiftKey === true ? -1 : 1 };
  if (key === 'Enter') return { type: 'edit' };
  if (key === 'Delete' || key === 'Backspace') return { type: 'delete' };
  return { type: 'none' };
}

/** キー入力 → 操作。§10.6 */
export function ladderKeyToAction(
  table: ShortcutTable,
  event: LadderKeyEvent,
  state: LadderKeyState,
): LadderAction {
  const entry = matchShortcut(table, event);
  let action: LadderAction;
  if (entry === undefined) {
    action = builtinAction(event);
  } else if (entry.enabled === false) {
    return { type: 'disabled', entry };
  } else {
    const place = PLACE_KINDS[entry.action];
    const mode = MODE_ACTIONS[entry.action];
    if (place !== undefined) action = { type: 'place', kind: place };
    else if (mode !== undefined) {
      // `Shift+F3`（モニタ書込み）は `F3` と同じ動作だが、初回だけ注記を出すので印を付ける（決定表#11）
      action =
        entry.action === 'monitor-write'
          ? { type: 'setMode', mode, monitorWrite: true }
          : { type: 'setMode', mode };
    } else if (entry.action === 'rule-line') {
      const direction = ARROW_DIRECTION[event.key ?? ''];
      action = direction === undefined ? { type: 'none' } : { type: 'ruleLine', direction };
    } else if (entry.action === 'toggle-no-nc') action = { type: 'toggleNoNc' };
    else if (entry.action === 'toggle-pulse') action = { type: 'togglePulse' };
    else if (entry.action === 'convert') action = { type: 'convert' };
    else if (entry.action === 'insert-toggle') action = { type: 'toggleInsert' };
    else if (entry.action === 'help') action = { type: 'help' };
    else if (entry.action === 'next-symbol') action = { type: 'move', dRow: 0, dCol: 1 };
    else action = { type: 'none' };
  }
  if (state.mode !== 'write' && isEditing(action)) return { type: 'readOnly' };
  return action;
}

/** ネットワークを引く（無ければ undefined）。 */
function findNetwork(program: LadderProgram, networkId: string): Network | undefined {
  return program.networks.find((net) => net.id === networkId);
}

/** カーソルを動かす。上下の端では隣のネットワークへ移る。 */
export function moveCursor(
  program: LadderProgram,
  cursor: LadderCursor,
  dRow: number,
  dCol: number,
): LadderCursor {
  const index = program.networks.findIndex((net) => net.id === cursor.networkId);
  const net = program.networks[index];
  if (net === undefined) return cursor;
  const col = Math.min(COIL_COL, Math.max(0, cursor.col + dCol));
  const row = cursor.row + dRow;
  if (row >= 0 && row < net.rows) return { networkId: net.id, row, col };
  const nextIndex = row < 0 ? index - 1 : index + 1;
  const next = program.networks[nextIndex];
  if (next === undefined) return { networkId: net.id, row: cursor.row, col };
  return { networkId: next.id, row: row < 0 ? next.rows - 1 : 0, col };
}

/** `LadderError` を投げさせずに文言へ畳む。 */
function guard(run: () => LadderProgram): LadderEditResult {
  try {
    return { ok: true, program: run() };
  } catch (error) {
    if (error instanceof LadderError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * セルを置く。§10.6（`Ins` 挿入・上書きの切換。意図的な差分 #4 ／ レビュー指摘 B6）
 *
 * `insert` が真のときは、カーソルの列からコイル列の**1つ手前**までを右へ1つずらしてから置く
 * （GX Works3 の「挿入」と同じ体感）。押し出される最後の接点列に中身があると、コイル列を
 * 潰してしまうので**置かずに理由を返す**。`edit.ts` に「挿入して右へずらす」操作は無いので、
 * ここで `setCell` の繰り返しとして組む（`edit.ts` は触らない）。
 */
export function applyLadderCell(
  program: LadderProgram,
  cursor: LadderCursor,
  cell: Cell,
  insert = false,
): LadderEditResult {
  if (!insert || cursor.col >= COIL_COL) {
    return guard(() => setCell(program, cursor.networkId, cursor.row, cursor.col, cell));
  }
  const net = program.networks.find((n) => n.id === cursor.networkId);
  if (net === undefined) return { ok: false, message: 'ネットワークが見つかりません' };
  const last = cellAt(net, cursor.row, COIL_COL - 1);
  if (last.kind !== 'empty') return { ok: false, message: '右端が埋まっているので挿入できません' };
  return guard(() => {
    let next = program;
    for (let col = COIL_COL - 1; col > cursor.col; col -= 1) {
      next = setCell(next, cursor.networkId, cursor.row, col, cellAt(net, cursor.row, col - 1));
    }
    return setCell(next, cursor.networkId, cursor.row, cursor.col, cell);
  });
}

/** セルを空にする。 */
export function clearLadderCell(program: LadderProgram, cursor: LadderCursor): LadderEditResult {
  return guard(() => clearCell(program, cursor.networkId, cursor.row, cursor.col));
}

/** 罫線を引く／消す（`Ctrl+↓` で下へ、`Ctrl+↑` で上の行から、左右は横線）。§10.3 */
export function applyRuleLine(
  program: LadderProgram,
  cursor: LadderCursor,
  direction: 'left' | 'up' | 'down' | 'right',
): LadderEditResult {
  if (direction === 'left' || direction === 'right') {
    const col = direction === 'right' ? cursor.col : cursor.col - 1;
    if (col < 0) return { ok: false, message: '左母線より左には横線を引けません' };
    return guard(() => setCell(program, cursor.networkId, cursor.row, col, hline()));
  }
  const row = direction === 'down' ? cursor.row : cursor.row - 1;
  if (row < 0) return { ok: false, message: '先頭行より上には縦線を引けません' };
  return guard(() => setVerticalLink(program, cursor.networkId, row, cursor.col, true));
}

/**
 * OR接点（並列分岐）を1行下に置く。§10.3
 *
 * 縦線（`vline`）はセルの**左辺**で下の行と繋ぐので、分岐の左側は「1つ左の列に縦線 ＋ 下の行の
 * 同じ列に横線」、右側は「1つ右の列に縦線」で閉じる（`runtime.ts` の `solve()` の規則）。
 * 0列目は左母線が全行を繋いでいるので左側の罫線が要らない。
 */
export function applyOrContact(
  program: LadderProgram,
  cursor: LadderCursor,
  cell: Cell,
): LadderEditResult {
  const net = findNetwork(program, cursor.networkId);
  if (net === undefined)
    return { ok: false, message: `ネットワークがありません: ${cursor.networkId}` };
  if (cursor.col + 1 > COIL_COL - 1) {
    return { ok: false, message: 'OR接点はコイル列の1つ手前より右には置けません' };
  }
  return guard(() => {
    let next = program;
    if (cursor.row + 1 >= net.rows) next = insertRow(next, net.id, cursor.row + 1);
    next = setCell(next, net.id, cursor.row + 1, cursor.col, cell);
    if (cursor.col > 0) {
      next = setVerticalLink(next, net.id, cursor.row, cursor.col - 1, true);
      const below = cellAt(findNetwork(next, net.id) ?? net, cursor.row + 1, cursor.col - 1);
      if (below.kind === 'empty')
        next = setCell(next, net.id, cursor.row + 1, cursor.col - 1, hline());
    }
    next = setVerticalLink(next, net.id, cursor.row, cursor.col + 1, true);
    return next;
  });
}

/** a接点 ⇄ b接点（`/`）。§10.6 */
export function toggleNoNcAt(program: LadderProgram, cursor: LadderCursor): LadderEditResult {
  const net = findNetwork(program, cursor.networkId);
  if (net === undefined)
    return { ok: false, message: `ネットワークがありません: ${cursor.networkId}` };
  return guard(() => {
    const cell = cellAt(net, cursor.row, cursor.col);
    if (cell.kind !== 'contact') throw new LadderError('接点の上でだけ切り換えられます');
    const flip: Record<string, Cell> = {
      NO: nc(cell.device),
      NC: no(cell.device),
      P: { kind: 'contact', type: 'F', device: cell.device },
      F: { kind: 'contact', type: 'P', device: cell.device },
    };
    return setCell(program, net.id, cursor.row, cursor.col, flip[cell.type] ?? cell);
  });
}

/** 微分接点 ⇄ 通常接点、OUT → SET → RST → OUT（`Alt+/`）。§10.6 */
export function togglePulseAt(program: LadderProgram, cursor: LadderCursor): LadderEditResult {
  const net = findNetwork(program, cursor.networkId);
  if (net === undefined)
    return { ok: false, message: `ネットワークがありません: ${cursor.networkId}` };
  return guard(() => {
    const cell = cellAt(net, cursor.row, cursor.col);
    if (cell.kind === 'contact') {
      const cycle: Record<string, Cell> = {
        NO: { kind: 'contact', type: 'P', device: cell.device },
        P: no(cell.device),
        NC: { kind: 'contact', type: 'F', device: cell.device },
        F: nc(cell.device),
      };
      return setCell(program, net.id, cursor.row, cursor.col, cycle[cell.type] ?? cell);
    }
    if (cell.kind === 'coil') {
      const cycle: Record<string, Cell> = {
        OUT: set(cell.device),
        SET: rst(cell.device),
        RST: { kind: 'coil', type: 'OUT', device: cell.device },
      };
      return setCell(program, net.id, cursor.row, cursor.col, cycle[cell.type] ?? cell);
    }
    throw new LadderError('接点またはコイルの上でだけ切り換えられます');
  });
}

/** 空のラダー（セッションの開始点）。決定表#14 */
export function initialLadder(): LadderProgram {
  return makeProgram(network('n1', [[empty()]]), endNetwork());
}

/** 次に作るネットワークのID（既存の最大番号＋1）。決定表#15 */
export function nextNetworkId(program: LadderProgram): string {
  let max = 0;
  for (const net of program.networks) {
    const matched = /^n(\d+)$/u.exec(net.id);
    const value = matched?.[1];
    if (value !== undefined) max = Math.max(max, Number(value));
  }
  return `n${max + 1}`;
}

/** 空の履歴。 */
export function emptyLadderHistory(): LadderHistory {
  return { done: [], undone: [] };
}

/** 編集の**前**の状態を積む（やり直し列は捨てる）。 */
export function pushLadder(history: LadderHistory, before: LadderProgram): LadderHistory {
  const done = [...history.done, before];
  return { done: done.slice(Math.max(0, done.length - LADDER_HISTORY_LIMIT)), undone: [] };
}

/** 1手戻す。 */
export function undoLadder(
  history: LadderHistory,
  current: LadderProgram,
): { history: LadderHistory; program: LadderProgram } | undefined {
  const previous = history.done[history.done.length - 1];
  if (previous === undefined) return undefined;
  return {
    history: { done: history.done.slice(0, -1), undone: [...history.undone, current] },
    program: previous,
  };
}

/** 1手やり直す。 */
export function redoLadder(
  history: LadderHistory,
  current: LadderProgram,
): { history: LadderHistory; program: LadderProgram } | undefined {
  const next = history.undone[history.undone.length - 1];
  if (next === undefined) return undefined;
  return {
    history: { done: [...history.done, current], undone: history.undone.slice(0, -1) },
    program: next,
  };
}
