import { TIMER_RANGE_60S } from '@ojt/board-model';
import { TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';
import {
  createDocument,
  DEVICE_PATTERNS,
  isLoadCell,
  rung as makeRung,
  resolveNode,
  BUS_N,
  BUS_P,
  SCHEMATIC_FORMAT_VERSION,
  type CellKind,
  type Rung,
  type RungEnd,
  type SchematicCell,
  type SchematicDocument,
} from './document.js';

/**
 * 展開接続図の編集操作。設計仕様 §11.4（Phase 5 のエディタ機能）。
 *
 * ここが受け持つのは「**その編集が文書として表せるか**」だけである（Plan 5 決定表#3）。
 * 回路として妥当かどうか（段に要素があるか、右母線に至る段が負荷で終わるか、両母線に
 * つながっているか）は `validateDocument()` が別に返す。作りかけの文書は必ず不正なので、
 * ここで妥当性を要求すると訓練者は1要素も置けない。
 *
 * すべての関数は**入力の文書を変えず**、新しい文書を返す（元に戻す／やり直しがスナップショットで
 * 済むようにするため。`apps/desktop` の `LadderHistory` と同じ流儀）。
 */

/** 1つの段に置ける要素の数（回路図の横幅の上限）。 */
export const MAX_CELLS_PER_RUNG = 8;
/** 文書が持てる段の数。 */
export const MAX_RUNGS = 12;
/** タイマコイルを新しく置いたときの既定の設定時間[ms]（§5.3.2 のレンジ `0〜10s` の中央付近）。 */
export const DEFAULT_EDIT_PRESET_MS = 3000;

/** まだIDの付いていない要素（置く前の指定）。 */
export interface CellDraft {
  kind: CellKind;
  device: string;
  /** タイマコイルのときの設定時間[ms]。 */
  presetMs?: number;
}

/** 編集操作1件。 */
export type SchematicEdit =
  /** 段を足す（`after` の直後。省略すると末尾）。 */
  | { kind: 'addRung'; after?: string }
  /** 段を消す（その段へ合流していた段は右母線へ付け替える）。 */
  | { kind: 'removeRung'; rungId: string }
  /** 要素を桁 `index` に差し込む。 */
  | { kind: 'insertCell'; rungId: string; index: number; draft: CellDraft }
  /** 要素を置き換える（**IDは保つ**）。 */
  | { kind: 'replaceCell'; cellId: string; draft: CellDraft }
  /** 要素を消す。 */
  | { kind: 'removeCell'; cellId: string }
  /** 機器名だけを変える（種別はそのまま）。 */
  | { kind: 'setDevice'; cellId: string; device: string }
  /** タイマコイルの設定時間を変える。 */
  | { kind: 'setPreset'; cellId: string; presetMs: number }
  /** 段の始点・終点を変える（分岐を作る／外す）。 */
  | { kind: 'setEnds'; rungId: string; from: RungEnd; to: RungEnd }
  /** 段の中で要素を動かす。 */
  | { kind: 'moveCell'; cellId: string; toIndex: number };

/** 編集の結果。失敗は理由つき（画面はトーストに出す）。 */
export type EditOutcome = { ok: true; doc: SchematicDocument } | { ok: false; message: string };

function fail(message: string): EditOutcome {
  return { ok: false, message };
}

/** 文書を浅く作り直す（段と要素の配列は新しくする）。 */
function withRungs(doc: SchematicDocument, rungs: Rung[]): SchematicDocument {
  return { ...doc, rungs };
}

/** 段を1本だけ差し替えた段配列。 */
function replaceRung(doc: SchematicDocument, rungId: string, next: Rung): Rung[] {
  return doc.rungs.map((r) => (r.id === rungId ? next : r));
}

/** 段1本を差し替えた文書を返す（`withRungs` ＋ `replaceRung`）。 */
function withRung(doc: SchematicDocument, rungId: string, next: Rung): SchematicDocument {
  return withRungs(doc, replaceRung(doc, rungId, next));
}

/** 空の文書（段1本・要素0個）。決定表#2 */
export function emptySchematic(id: string, title: string): SchematicDocument {
  return createDocument(id, title, [makeRung('r1', BUS_P, BUS_N, [])]);
}

/** `prefix` + 連番のIDのうち、まだ使われていない最小の番号。 */
function nextId(prefix: string, used: readonly string[]): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'u');
  let max = 0;
  for (const id of used) {
    const found = pattern.exec(id);
    if (found === null) continue;
    const n = Number(found[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/** 次の要素ID（`c1`, `c2`, …）。 */
export function nextCellId(doc: SchematicDocument): string {
  return nextId(
    'c',
    doc.rungs.flatMap((r) => r.cells.map((c) => c.id)),
  );
}

/** 次の段ID（`r1`, `r2`, …）。 */
export function nextRungId(doc: SchematicDocument): string {
  return nextId(
    'r',
    doc.rungs.map((r) => r.id),
  );
}

/** 要素とその居場所を探す。 */
function locate(
  doc: SchematicDocument,
  cellId: string,
): { rung: Rung; index: number; cell: SchematicCell } | undefined {
  for (const r of doc.rungs) {
    const index = r.cells.findIndex((c) => c.id === cellId);
    const cell = r.cells[index];
    if (cell !== undefined) return { rung: r, index, cell };
  }
  return undefined;
}

/** その種別がその機器名を使えるか。 */
function deviceProblem(kind: CellKind, device: string): string | undefined {
  const pattern = DEVICE_PATTERNS[kind];
  /* c8 ignore next -- 種別は `CellKind` に閉じているので表に載っていない種別は来ない */
  if (pattern === undefined) return `未知の要素種別です: ${String(kind)}`;
  return pattern.test(device) ? undefined : `${kind} に使えない機器名です: ${device}`;
}

/** タイマコイル（設定時間を持つ要素）か。 */
function isTimerCoil(kind: CellKind, device: string): boolean {
  return kind === 'coil' && device.startsWith('T');
}

/** 下書きから要素を作る（タイマコイルには必ず設定時間を付ける）。 */
function buildCell(id: string, draft: CellDraft, fallbackPresetMs: number): SchematicCell {
  if (!isTimerCoil(draft.kind, draft.device)) {
    return { kind: draft.kind, id, device: draft.device };
  }
  return {
    kind: draft.kind,
    id,
    device: draft.device,
    presetMs: draft.presetMs ?? fallbackPresetMs,
  };
}

/** 設定時間がレンジに収まるか（`validateDocument()` と同じ範囲）。§5.3.2 */
function presetProblem(presetMs: number): string | undefined {
  if (
    !Number.isInteger(presetMs) ||
    presetMs < TIMER_MIN_PRESET_MS ||
    presetMs > TIMER_RANGE_60S.maxMs
  ) {
    return `タイマの設定時間は ${TIMER_MIN_PRESET_MS}〜${TIMER_RANGE_60S.maxMs}ms の整数です: ${presetMs}`;
  }
  return undefined;
}

/** 端点が指す段が実在するか（自分自身への参照も断る）。 */
function endProblem(doc: SchematicDocument, ownerId: string, end: RungEnd): string | undefined {
  if ('bus' in end) return undefined;
  if (end.rung === ownerId) return `段が自分自身を参照しています: ${ownerId}`;
  const target = doc.rungs.find((r) => r.id === end.rung);
  if (target === undefined) return `段がありません: ${end.rung}`;
  if (!Number.isInteger(end.node) || end.node < 0 || end.node > target.cells.length) {
    return `参照先の節点番号が範囲外です: ${end.rung}#${end.node}（0〜${target.cells.length}）`;
  }
  return undefined;
}

/** 消した段を指していた端点を右母線（終点）／左母線（始点）へ逃がす。 */
function detachEnd(end: RungEnd, removedId: string, side: 'from' | 'to'): RungEnd {
  if ('bus' in end || end.rung !== removedId) return end;
  return side === 'from' ? BUS_P : BUS_N;
}

function editAddRung(doc: SchematicDocument, after: string | undefined): EditOutcome {
  if (doc.rungs.length >= MAX_RUNGS) return fail(`段は${MAX_RUNGS}本までです`);
  const created = makeRung(nextRungId(doc), BUS_P, BUS_N, []);
  if (after === undefined) return { ok: true, doc: withRungs(doc, [...doc.rungs, created]) };
  const at = doc.rungs.findIndex((r) => r.id === after);
  if (at < 0) return fail(`段がありません: ${after}`);
  const rungs = [...doc.rungs];
  rungs.splice(at + 1, 0, created);
  return { ok: true, doc: withRungs(doc, rungs) };
}

function editRemoveRung(doc: SchematicDocument, rungId: string): EditOutcome {
  if (doc.rungs.length <= 1) return fail('最後の1段は消せません');
  if (!doc.rungs.some((r) => r.id === rungId)) return fail(`段がありません: ${rungId}`);
  const rungs = doc.rungs
    .filter((r) => r.id !== rungId)
    .map((r) => ({
      ...r,
      from: detachEnd(r.from, rungId, 'from'),
      to: detachEnd(r.to, rungId, 'to'),
      cells: [...r.cells],
    }));
  return { ok: true, doc: withRungs(doc, rungs) };
}

function editInsertCell(
  doc: SchematicDocument,
  rungId: string,
  index: number,
  draft: CellDraft,
): EditOutcome {
  const target = doc.rungs.find((r) => r.id === rungId);
  if (target === undefined) return fail(`段がありません: ${rungId}`);
  if (target.cells.length >= MAX_CELLS_PER_RUNG) {
    return fail(`1つの段に置ける要素は${MAX_CELLS_PER_RUNG}個までです`);
  }
  if (!Number.isInteger(index) || index < 0 || index > target.cells.length) {
    return fail(`段 ${rungId} に桁 ${index} はありません（0〜${target.cells.length}）`);
  }
  const problem = deviceProblem(draft.kind, draft.device);
  if (problem !== undefined) return fail(problem);
  if (draft.presetMs !== undefined) {
    const bad = presetProblem(draft.presetMs);
    if (bad !== undefined) return fail(bad);
  }
  const cells = [...target.cells];
  cells.splice(index, 0, buildCell(nextCellId(doc), draft, DEFAULT_EDIT_PRESET_MS));
  return { ok: true, doc: withRung(doc, rungId, { ...target, cells }) };
}

/** 要素1個を作り替える（IDは保つ）。`replaceCell` / `setDevice` / `setPreset` の共通部分。 */
function updateCell(
  doc: SchematicDocument,
  cellId: string,
  make: (cell: SchematicCell) => SchematicCell | string,
): EditOutcome {
  const found = locate(doc, cellId);
  if (found === undefined) return fail(`要素がありません: ${cellId}`);
  const next = make(found.cell);
  if (typeof next === 'string') return fail(next);
  const cells = [...found.rung.cells];
  cells[found.index] = next;
  return { ok: true, doc: withRung(doc, found.rung.id, { ...found.rung, cells }) };
}

function editRemoveCell(doc: SchematicDocument, cellId: string): EditOutcome {
  const found = locate(doc, cellId);
  if (found === undefined) return fail(`要素がありません: ${cellId}`);
  const cells = found.rung.cells.filter((c) => c.id !== cellId);
  return { ok: true, doc: withRung(doc, found.rung.id, { ...found.rung, cells }) };
}

function editMoveCell(doc: SchematicDocument, cellId: string, toIndex: number): EditOutcome {
  const found = locate(doc, cellId);
  if (found === undefined) return fail(`要素がありません: ${cellId}`);
  const last = found.rung.cells.length - 1;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > last) {
    return fail(`段 ${found.rung.id} に桁 ${toIndex} はありません（0〜${last}）`);
  }
  const cells = [...found.rung.cells];
  const [moved] = cells.splice(found.index, 1);
  /* c8 ignore next -- `locate` が見つけた要素なので必ず取れる */
  if (moved === undefined) return fail(`要素がありません: ${cellId}`);
  cells.splice(toIndex, 0, moved);
  return { ok: true, doc: withRung(doc, found.rung.id, { ...found.rung, cells }) };
}

/**
 * 段の両端を決め直す（分岐を作る／外す）。
 *
 * 「表せるか」だけを見る（決定表#3）が、**参照の循環だけは表せない**。`layout()` も
 * `toSession()` も端点を `resolveNode()` でたどり切って初めて節点が決まるので、輪になった
 * 参照は「どの節点か」が存在しない（`resolveNode()` が `undefined` を返し、`layout()` は
 * 段を左母線に寄せ、`toSession()` は割当に失敗する）。作りかけの文書として許してよい
 * 「まだ回路になっていない」とは違い、**図にすら描けない**ので、ここで断る。
 */
function editSetEnds(
  doc: SchematicDocument,
  rungId: string,
  from: RungEnd,
  to: RungEnd,
): EditOutcome {
  const target = doc.rungs.find((r) => r.id === rungId);
  if (target === undefined) return fail(`段がありません: ${rungId}`);
  for (const end of [from, to]) {
    const problem = endProblem(doc, rungId, end);
    if (problem !== undefined) return fail(problem);
  }
  const next = withRung(doc, rungId, { ...target, from, to });
  for (const r of next.rungs) {
    if (
      resolveNode(next, r, 0) === undefined ||
      resolveNode(next, r, r.cells.length) === undefined
    ) {
      return fail(`段の端点が循環します: ${rungId}`);
    }
  }
  return { ok: true, doc: next };
}

/** 編集を1つ当てる。入力の文書は変えない。決定表#3 */
export function applyEdit(doc: SchematicDocument, edit: SchematicEdit): EditOutcome {
  switch (edit.kind) {
    case 'addRung':
      return editAddRung(doc, edit.after);
    case 'removeRung':
      return editRemoveRung(doc, edit.rungId);
    case 'insertCell':
      return editInsertCell(doc, edit.rungId, edit.index, edit.draft);
    case 'replaceCell':
      return updateCell(doc, edit.cellId, (cell) => {
        const problem = deviceProblem(edit.draft.kind, edit.draft.device);
        if (problem !== undefined) return problem;
        if (edit.draft.presetMs !== undefined) {
          const bad = presetProblem(edit.draft.presetMs);
          if (bad !== undefined) return bad;
        }
        return buildCell(cell.id, edit.draft, cell.presetMs ?? DEFAULT_EDIT_PRESET_MS);
      });
    case 'removeCell':
      return editRemoveCell(doc, edit.cellId);
    case 'setDevice':
      return updateCell(doc, edit.cellId, (cell) => {
        const problem = deviceProblem(cell.kind, edit.device);
        if (problem !== undefined) return problem;
        return buildCell(
          cell.id,
          {
            kind: cell.kind,
            device: edit.device,
            ...(cell.presetMs === undefined ? {} : { presetMs: cell.presetMs }),
          },
          DEFAULT_EDIT_PRESET_MS,
        );
      });
    case 'setPreset':
      return updateCell(doc, edit.cellId, (cell) => {
        if (!isTimerCoil(cell.kind, cell.device)) {
          return `設定時間を持てるのはタイマコイルだけです: ${cell.id}`;
        }
        const bad = presetProblem(edit.presetMs);
        if (bad !== undefined) return bad;
        return { kind: cell.kind, id: cell.id, device: cell.device, presetMs: edit.presetMs };
      });
    case 'setEnds':
      return editSetEnds(doc, edit.rungId, edit.from, edit.to);
    case 'moveCell':
      return editMoveCell(doc, edit.cellId, edit.toIndex);
  }
}

/** 種別の日本語名（パレットと操作ログで使う）。§11.1 */
export const CELL_KIND_LABELS: Readonly<Record<CellKind, string>> = {
  'pb-a': '押ボタン a接点',
  'pb-b': '押ボタン b接点',
  'cr-a': 'リレー a接点',
  'cr-b': 'リレー b接点',
  't-a': 'タイマ a接点（限時）',
  't-b': 'タイマ b接点（限時）',
  coil: 'コイル',
  lamp: '表示灯',
  buzzer: 'ブザー',
};

/** 端点の日本語表現（`P母線` / `N母線` / `r1 の3番目`）。 */
function endLabel(end: RungEnd): string {
  return 'bus' in end ? `${end.bus}母線` : `${end.rung} の節点${end.node}`;
}

/** 編集1件の説明（操作ログに出す1行）。§8.1 */
export function editLabel(edit: SchematicEdit): string {
  switch (edit.kind) {
    case 'addRung':
      return '段を追加';
    case 'removeRung':
      return `段を削除（${edit.rungId}）`;
    case 'insertCell':
      return `${CELL_KIND_LABELS[edit.draft.kind]} ${edit.draft.device} を配置`;
    case 'replaceCell':
      return `${CELL_KIND_LABELS[edit.draft.kind]} ${edit.draft.device} に置き換え`;
    case 'removeCell':
      return '要素を削除';
    case 'setDevice':
      return `機器名を ${edit.device} に変更`;
    case 'setPreset':
      return `設定時間を ${(edit.presetMs / 1000).toFixed(1)}秒 に変更`;
    case 'setEnds':
      return `段の両端を ${endLabel(edit.from)} → ${endLabel(edit.to)} に変更`;
    case 'moveCell':
      return '要素を移動';
  }
}

/** 文書の版（`emptySchematic()` が入れる値の確認用）。 */
export const EDIT_FORMAT_VERSION = SCHEMATIC_FORMAT_VERSION;

/** 負荷の要素を持つ段か（パレットの「この段にはもう負荷を置けません」の判定）。§11.1 */
export function rungHasLoad(r: Rung): boolean {
  return r.cells.some((cell) => isLoadCell(cell));
}
