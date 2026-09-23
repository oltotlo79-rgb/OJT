import {
  SOCKET_ROLES,
  TIMER_RANGE_10S,
  type BoardDefinition,
  type SocketRole,
} from '@ojt/board-model';
import { TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';
import type { AssembleProblem } from '@ojt/content';
import {
  CELL_KIND_LABELS,
  rungHasLoad,
  type CellKind,
  type RungEnd,
  type SchematicCell,
  type SchematicDocument,
  type SchematicEdit,
} from '@ojt/schematic-core';
import { JA } from '../i18n/ja.js';

/**
 * 回路図エディタの純関数層。設計仕様 §11.4 / Plan 5 決定表#25・#26。
 * React も three も SVG も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 * 履歴の形は `session/ladder.ts` の `LadderHistory` と同じ（スナップショット方式）。
 */

/** 元に戻せる手数の上限（ラダーと同じ）。 */
export const SCHEMATIC_HISTORY_LIMIT = 50;

/** カーソル（どの段のどの桁を指しているか）。桁は 0〜要素数（要素数＝末尾の空き桁）。 */
export interface EditorCursor {
  rungId: string;
  index: number;
}

/** パレットの1項目。 */
export interface PaletteItem {
  /** `kind:device`（React の `key` と選択の同一性に使う）。 */
  id: string;
  kind: CellKind;
  device: string;
  /** 画面に出す名前（`リレー a接点 CR1`）。 */
  label: string;
  /** まとまりの見出し（`押ボタン` / `リレー` / `タイマ` / `出力`）。 */
  group: string;
}

/** 元に戻す／やり直しの履歴。 */
export interface SchematicHistory {
  done: SchematicDocument[];
  undone: SchematicDocument[];
}

/** 空の履歴。 */
export function emptySchematicHistory(): SchematicHistory {
  return { done: [], undone: [] };
}

/** 編集の**前**の文書を積む（やり直し列は捨てる）。 */
export function pushSchematic(
  history: SchematicHistory,
  before: SchematicDocument,
): SchematicHistory {
  const done = [...history.done, before];
  return { done: done.slice(Math.max(0, done.length - SCHEMATIC_HISTORY_LIMIT)), undone: [] };
}

/** 1手戻す。 */
export function undoSchematic(
  history: SchematicHistory,
  current: SchematicDocument,
): { history: SchematicHistory; doc: SchematicDocument } | undefined {
  const previous = history.done[history.done.length - 1];
  if (previous === undefined) return undefined;
  return {
    history: { done: history.done.slice(0, -1), undone: [...history.undone, current] },
    doc: previous,
  };
}

/** 1手やり直す。 */
export function redoSchematic(
  history: SchematicHistory,
  current: SchematicDocument,
): { history: SchematicHistory; doc: SchematicDocument } | undefined {
  const next = history.undone[history.undone.length - 1];
  if (next === undefined) return undefined;
  return {
    history: { done: [...history.done, current], undone: history.undone.slice(0, -1) },
    doc: next,
  };
}

/** パレットのまとまりの見出し。 */
const GROUP_PB = '押ボタン';
const GROUP_CR = 'リレー';
const GROUP_T = 'タイマ';
const GROUP_OUT = '出力';

function item(kind: CellKind, device: string, group: string): PaletteItem {
  return {
    id: `${kind}:${device}`,
    kind,
    device,
    label: `${CELL_KIND_LABELS[kind]} ${device}`,
    group,
  };
}

/**
 * 課題が盤に割り当てている役割（チェック用の `CHK` は除く）。§6.1
 * `board.socketRoles` は課題スキーマ（`BoardRefSchema`）の**必須項目**なので、
 * 「割当が無いときは全役割」という分岐は存在しない。
 */
function assignedRoles(problem: Pick<AssembleProblem, 'board'>): SocketRole[] {
  const used = new Set(
    Object.values(problem.board.socketRoles).filter(
      (role): role is SocketRole => role !== undefined,
    ),
  );
  return SOCKET_ROLES.filter((role) => role !== 'CHK' && used.has(role));
}

/**
 * その課題で置ける要素の一覧。決定表#26
 * ソケットの役割は課題の `board.socketRoles`、押ボタン・表示灯は盤の定義、
 * ブザーは課題の `board.extraParts` にあるときだけ。
 */
export function paletteFor(
  problem: Pick<AssembleProblem, 'board'>,
  board: BoardDefinition,
): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const pb of board.pushButtons) {
    out.push(item('pb-a', pb.id, GROUP_PB), item('pb-b', pb.id, GROUP_PB));
  }
  for (const role of assignedRoles(problem)) {
    if (role.startsWith('CR')) {
      out.push(
        item('cr-a', role, GROUP_CR),
        item('cr-b', role, GROUP_CR),
        item('coil', role, GROUP_CR),
      );
    } else {
      out.push(item('t-a', role, GROUP_T), item('t-b', role, GROUP_T), item('coil', role, GROUP_T));
    }
  }
  for (const lamp of board.lamps) out.push(item('lamp', lamp.id, GROUP_OUT));
  if ((problem.board.extraParts ?? []).includes('BZ')) out.push(item('buzzer', 'BZ', GROUP_OUT));
  return out;
}

/** その段の桁の上限（末尾の空き桁を含む）。 */
function lastIndexOf(doc: SchematicDocument, rungId: string): number {
  return doc.rungs.find((r) => r.id === rungId)?.cells.length ?? 0;
}

/** 文書の中に収まるカーソルへ直す（段が消えたら先頭の段の先頭へ）。 */
export function clampCursor(doc: SchematicDocument, cursor: EditorCursor): EditorCursor {
  const found = doc.rungs.find((r) => r.id === cursor.rungId);
  const target = found ?? doc.rungs[0];
  if (target === undefined) return { rungId: '', index: 0 };
  if (found === undefined) return { rungId: target.id, index: 0 };
  return { rungId: target.id, index: Math.min(Math.max(0, cursor.index), target.cells.length) };
}

/** 矢印キーでカーソルを動かす（範囲外へは出ない）。 */
export function moveCursor(
  doc: SchematicDocument,
  cursor: EditorCursor,
  key: string,
): EditorCursor {
  const current = clampCursor(doc, cursor);
  const row = doc.rungs.findIndex((r) => r.id === current.rungId);
  switch (key) {
    case 'ArrowLeft':
      return { ...current, index: Math.max(0, current.index - 1) };
    case 'ArrowRight':
      return { ...current, index: Math.min(lastIndexOf(doc, current.rungId), current.index + 1) };
    case 'ArrowUp': {
      const next = doc.rungs[Math.max(0, row - 1)];
      return next === undefined
        ? current
        : clampCursor(doc, { rungId: next.id, index: current.index });
    }
    case 'ArrowDown': {
      const next = doc.rungs[Math.min(doc.rungs.length - 1, row + 1)];
      return next === undefined
        ? current
        : clampCursor(doc, { rungId: next.id, index: current.index });
    }
    default:
      return current;
  }
}

/**
 * 編集のあとにカーソルが行く先。§11.4 / レビュー I1
 *
 * 置いたら**その次の桁**を指す（`Enter` を3回打てば打った順に並ぶ。指さないと `CR1, PB1, PB2`
 * のように逆順に積み上がる）。置き換えたらその桁のまま。ほかの編集は文書の中へ収め直すだけ。
 */
export function cursorAfterEdit(
  doc: SchematicDocument,
  cursor: EditorCursor,
  edit: SchematicEdit,
): EditorCursor {
  if (edit.kind === 'insertCell') {
    return clampCursor(doc, { rungId: edit.rungId, index: edit.index + 1 });
  }
  if (edit.kind === 'replaceCell') {
    for (const r of doc.rungs) {
      const index = r.cells.findIndex((c) => c.id === edit.cellId);
      if (index >= 0) return clampCursor(doc, { rungId: r.id, index });
    }
  }
  return clampCursor(doc, cursor);
}

/** カーソルの下にある要素のID（末尾の空き桁なら undefined）。 */
export function cellUnder(doc: SchematicDocument, cursor: EditorCursor): string | undefined {
  return doc.rungs.find((r) => r.id === cursor.rungId)?.cells[cursor.index]?.id;
}

/*
 * ここから「分岐」（§11.1 の分岐点）。受入基準①の自己保持回路は、**両端が別の段の節点**にある
 * 段（b-001 の `r1h`: `{rung:'r1',node:1}` → `{rung:'r1',node:2}`）を1本引かないと描けない。
 * `addRung` は必ず `P → N` の段を作るので、それだけでは永久に描けない（B1）。
 *
 * 操作は2クリック（またはカーソル＋Enter 2回）で完結させる:
 *   ①「分岐にする」を押す → ②始点の節点を選ぶ → ③終点の節点を選ぶ → `setEnds` を1回当てる。
 * 節点 k は「桁 k の左端」なので、当たり判定は `slotRects()`（Task 1）をそのまま使える。
 * 新しい当たり矩形も新しい図形も足さない。
 */

/** 分岐の下書き（どの段を分岐にするか、始点は決まったか）。§11.4 */
export interface BranchDraft {
  /** 分岐にする段。 */
  rungId: string;
  /** 決まった始点。未定なら undefined（次に選ぶ節点が始点になる）。 */
  from?: RungEnd;
}

/** 分岐の節点を1つ選んだ結果。 */
export type BranchOutcome =
  /** 始点が決まった（次は終点）。画面は下書きを差し替える。 */
  | { kind: 'draft'; branch: BranchDraft }
  /** 両端が決まった。画面はこの編集を `onEdit` に投げ、分岐モードを抜ける。 */
  | { kind: 'edit'; edit: Extract<SchematicEdit, { kind: 'setEnds' }> }
  /** 選べない節点。画面は理由をトーストに出し、分岐モードは続ける。 */
  | { kind: 'refused'; message: string };

/** 2つの端点が同じ節点を指しているか。 */
function sameEnd(a: RungEnd, b: RungEnd): boolean {
  if ('bus' in a || 'bus' in b) return 'bus' in a && 'bus' in b && a.bus === b.bus;
  return a.rung === b.rung && a.node === b.node;
}

/**
 * その段を分岐にできるか。できないときは**理由**（「分岐にする」ボタンの `title` に出す）。
 * 利用者要求「分かりやすく直感的に」: 押せないボタンには必ず理由を添える（完了条件の「画面の品質」）。
 */
export function branchDisabledReason(doc: SchematicDocument, rungId: string): string | undefined {
  const target = doc.rungs.find((r) => r.id === rungId);
  if (target === undefined) return JA.schematic.branchNoRung;
  if (doc.rungs.length < 2) return JA.schematic.branchNeedsAnotherRung;
  // 分岐段（右母線に至らない段）に負荷は置けない（`validateDocument()` の規則。§11.1）
  if (rungHasLoad(target)) return JA.schematic.branchHasLoad;
  return undefined;
}

/**
 * 分岐の節点を1つ選ぶ。**クリックでもカーソル＋Enterでもこの関数を通す**（規則を1箇所に保つ）。
 * ここが見るのは「その節点を選べるか」だけで、文書を書き換えるのは `applyEdit()` の `setEnds`。
 * 参照の循環（`layout()` が解けない形）はそちらが断る（`schematic-core/src/edit.ts`）。
 */
export function pickBranchNode(
  doc: SchematicDocument,
  branch: BranchDraft,
  target: { rungId: string; node: number },
): BranchOutcome {
  if (target.rungId === branch.rungId) {
    return { kind: 'refused', message: JA.schematic.branchSelfRefused };
  }
  const owner = doc.rungs.find((r) => r.id === branch.rungId);
  const parent = doc.rungs.find((r) => r.id === target.rungId);
  if (owner === undefined || parent === undefined) {
    return { kind: 'refused', message: JA.schematic.branchNoRung };
  }
  if (!Number.isInteger(target.node) || target.node < 0 || target.node > parent.cells.length) {
    return { kind: 'refused', message: JA.schematic.branchNoNode };
  }
  const end: RungEnd = { rung: target.rungId, node: target.node };
  if (branch.from === undefined) {
    return { kind: 'draft', branch: { rungId: branch.rungId, from: end } };
  }
  if (sameEnd(branch.from, end)) {
    return { kind: 'refused', message: JA.schematic.branchSameNode };
  }
  return {
    kind: 'edit',
    edit: { kind: 'setEnds', rungId: branch.rungId, from: branch.from, to: end },
  };
}

/**
 * 分岐中の1行の案内（手順帯の案内を一時的に置き換える）。決定表#24
 * **どの段を分岐にしているか**を先に言う（レビュー Minor: 段を選び直したつもりの取り違え防止）。
 * 画面に内部IDは出さない約束なので、段は `rungLabel()` の「1段目」で呼ぶ。
 */
export function branchStepHint(
  doc: SchematicDocument,
  branch: BranchDraft | undefined,
): string | undefined {
  if (branch === undefined) return undefined;
  const step = branch.from === undefined ? JA.schematic.branchPickFrom : JA.schematic.branchPickTo;
  return `${rungLabel(doc, branch.rungId)}${JA.schematic.branchOf}${step}`;
}

/**
 * キー入力を編集操作に直す。決定表#25
 * 割り当てが無いキーは `undefined`（画面は何もしない）。`Ctrl+Z` / `Ctrl+Y` は履歴の操作で
 * 編集操作ではないので、ここでは扱わない（画面が直接 `undoSchematic()` を呼ぶ）。
 */
export function keyToEdit(
  doc: SchematicDocument,
  cursor: EditorCursor,
  key: string,
  selected: PaletteItem | undefined,
  modifiers: { ctrl?: boolean } = {},
  /** 分岐の節点を選んでいる最中なら、その下書き。 */
  branch?: BranchDraft,
): SchematicEdit | undefined {
  const current = clampCursor(doc, cursor);
  /*
   * 分岐の節点を選んでいるあいだは `Enter` だけを受ける。`Delete` や `Insert` を通すと
   * 「終点を選ぼうとして押した Delete」で要素が消える（Phase 1D で踏んだのと同じ形の事故）。
   * 始点しか決まっていない段階では `pickBranchNode()` が `kind: 'draft'` を返すので、
   * ここは編集を返さない（下書きの更新は画面の仕事）。
   */
  if (branch !== undefined) {
    if (key !== 'Enter') return undefined;
    const picked = pickBranchNode(doc, branch, { rungId: current.rungId, node: current.index });
    return picked.kind === 'edit' ? picked.edit : undefined;
  }
  if (key === 'Insert') return { kind: 'addRung', after: current.rungId };
  if (key === 'Delete' && modifiers.ctrl === true) {
    return { kind: 'removeRung', rungId: current.rungId };
  }
  if (key === 'Delete' || key === 'Backspace') {
    const cellId = cellUnder(doc, current);
    return cellId === undefined ? undefined : { kind: 'removeCell', cellId };
  }
  if (key === 'Enter') {
    if (selected === undefined) return undefined;
    return {
      kind: 'insertCell',
      rungId: current.rungId,
      index: current.index,
      draft: { kind: selected.kind, device: selected.device },
    };
  }
  return undefined;
}

/** 文書に置かれている要素の総数（手順帯の「描いた」の判定に使う）。 */
export function cellCount(doc: SchematicDocument): number {
  return doc.rungs.reduce((sum, r) => sum + r.cells.length, 0);
}

/* ここから「画面に出す文面」（レビュー I3・I4 / Minor）。内部IDは1文字も外へ出さない。 */

/** 段の呼び名（`r1` → 「1段目」）。知らない段は「その段」。 */
export function rungLabel(doc: SchematicDocument, rungId: string): string {
  const row = doc.rungs.findIndex((r) => r.id === rungId);
  return row < 0 ? 'その段' : `${row + 1}段目`;
}

/**
 * 内部IDを含む文面を画面の言葉に直す（レビュー I3・I4）。
 *
 * `validateDocument()` / `applyEdit()` / `verifySchematic()` の文面は内部ID（`r1` / `c01`）と
 * 内部の経路（`rungs[0].cells[1]`）を含むが、**画面に内部IDは出さない**約束なので
 * 「1段目」「1段目の2番目」に読み替える（利用者要求「分かりやすく直感的に」）。
 * エディタの指摘欄・検算パネル・トースト・操作ログは**すべてこの関数を通す**。
 */
export function issueText(doc: SchematicDocument, message: string): string {
  const names: Array<{ id: string; text: string }> = [];
  doc.rungs.forEach((r, ri) => {
    names.push({ id: r.id, text: `${ri + 1}段目` });
    r.cells.forEach((cell, ci) => {
      names.push({ id: cell.id, text: `${ri + 1}段目の${ci + 1}番目` });
    });
  });
  // 長いIDから先に置き換える（`r1` が `r1h` の一部に当たらないようにする）
  names.sort((a, b) => b.id.length - a.id.length);
  let out = message.replace(
    /rungs\[(\d+)\](?:\.cells\[(\d+)\])?(\.from|\.to)?/gu,
    (_match, ri: string, ci: string | undefined, end: string | undefined) =>
      `${Number(ri) + 1}段目` +
      (ci === undefined ? '' : `の${Number(ci) + 1}番目`) +
      (end === '.from' ? 'の始点' : end === '.to' ? 'の終点' : ''),
  );
  for (const { id, text } of names) {
    // `r1#2`（節点の指し方）を先に処理してから、ID単体を置き換える
    out = out.split(`${id}#`).join(`${text}の節点`).split(id).join(text);
  }
  return out;
}

/** いまカーソルがある場所の言い方（「1段目の2番目」／末尾の空き桁は「1段目の末尾」）。 */
export function cursorText(doc: SchematicDocument, cursor: EditorCursor): string {
  const current = clampCursor(doc, cursor);
  const rung = doc.rungs.find((r) => r.id === current.rungId);
  const name = rungLabel(doc, current.rungId);
  if (rung === undefined) return name;
  return current.index >= rung.cells.length
    ? `${name}の末尾（空き）`
    : `${name}の${current.index + 1}番目`;
}

/*
 * ここから「設定時間」（タイマコイルの presetMs）。§5.3.2 / §17.2 #12 / レビュー B1
 * パレットは `コイル T1` を置けるが、置いた直後の値は `DEFAULT_EDIT_PRESET_MS`（3.0秒）で、
 * 変える手段が画面に無かった。0.8秒のフリッカ回路（b-006）はどう描いても検算に通らない。
 * 刻みは実機（H3Y-4 の 0〜10秒レンジ）と同じ 0.1 秒。
 */

/** 設定時間の下限[ms]（0〜10秒レンジで取れる最小値）。 */
export const PRESET_MIN_MS = Math.max(TIMER_MIN_PRESET_MS, TIMER_RANGE_10S.stepMs);
/** 設定時間の上限[ms]。 */
export const PRESET_MAX_MS = TIMER_RANGE_10S.maxMs;
/** 設定時間の刻み[ms]（0.1秒）。 */
export const PRESET_STEP_MS = TIMER_RANGE_10S.stepMs;

/** カーソルの下にあるタイマコイル（設定時間を変えられる要素）。無ければ undefined。 */
export function timerCoilUnder(
  doc: SchematicDocument,
  cursor: EditorCursor,
): SchematicCell | undefined {
  const current = clampCursor(doc, cursor);
  const cell = doc.rungs.find((r) => r.id === current.rungId)?.cells[current.index];
  if (cell === undefined) return undefined;
  // `schematic-core` の `isTimerCoil()` と同じ見分け方（コイルで機器名が `T` で始まる）
  return cell.kind === 'coil' && cell.device.startsWith('T') ? cell : undefined;
}

/**
 * 数値欄に打ち込まれた秒を設定時間[ms]に直す。読めない・範囲外なら `undefined`。
 * 打ち込みの途中（`0.` や空欄）は毎回 `undefined` になるので、画面は**何も送らない**
 * （打鍵のたびに断られて赤いトーストが出る、という事故を防ぐ）。
 */
export function presetFromText(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const seconds = Number(text);
  if (!Number.isFinite(seconds)) return undefined;
  const ms = Math.round((seconds * 1000) / PRESET_STEP_MS) * PRESET_STEP_MS;
  if (ms < PRESET_MIN_MS || ms > PRESET_MAX_MS) return undefined;
  return ms;
}

/** ＋／− を押したときの設定時間[ms]（範囲の外へは出ない）。 */
export function stepPreset(presetMs: number, direction: 1 | -1): number {
  const snapped = Math.round(presetMs / PRESET_STEP_MS) * PRESET_STEP_MS;
  const next = snapped + direction * PRESET_STEP_MS;
  return Math.min(Math.max(next, PRESET_MIN_MS), PRESET_MAX_MS);
}

/** 数値欄に出す秒（`3` ではなく `3.0`）。 */
export function presetSecondsText(presetMs: number): string {
  return (presetMs / 1000).toFixed(1);
}
