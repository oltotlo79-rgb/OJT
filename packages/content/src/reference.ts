import {
  SOCKET_ROLES,
  toNetlist,
  type BoardDefinition,
  type BoardSession,
  type SocketRoles,
} from '@ojt/board-model';
import { partId, toTerminalId, type Netlist, type PartId, type TerminalId } from '@ojt/circuit-sim';
import {
  toSession,
  type CellAssignment,
  type SchematicDocument,
  type ToSessionResult,
} from '@ojt/schematic-core';
import { toSocketRoles } from './schema/common.js';
import type { AssembleProblem } from './schema/assemble.js';
import type { InspectRepairProblem } from './schema/inspect-repair.js';
import type { ProblemIssue } from './schema/index.js';

/**
 * 模範回路の構築。設計仕様 §7.2 / §11.3 / §13 #2。
 * 課題の回路図（＋ `physicalOverride`）を schematic-core で盤セッションに落とし、
 * board-model でネットリストにする。物理割当に失敗したら課題エラーとして返す。
 */

/**
 * 模範回路を持つ課題（モードB／モードC2）。どちらも回路図から模範回路を組み立てる。§7.2 / §9.2
 * モードC2の「基準になる回路」は模範回路そのものであり、故障はそこへ後から注入する。
 */
export type SchematicProblem = AssembleProblem | InspectRepairProblem;

/** 模範回路（盤セッション＋ネットリスト＋回路図要素の物理割当）。 */
export interface ReferenceCircuit {
  session: BoardSession;
  netlist: Netlist;
  roles: SocketRoles;
  /** 回路図の要素 → 物理端子の対応。C2の連動ハイライト（§9.2）と指摘の説明に使う。 */
  cells: readonly CellAssignment[];
}

/** 模範回路の構築結果。 */
export type ReferenceResult =
  { ok: true; value: ReferenceCircuit } | { ok: false; errors: ProblemIssue[] };

/** モードBの新規配線に使う線色（青のみ）。§8.1 */
export const ASSEMBLE_WIRE_COLOR = '青';

/** 課題の `physicalOverride` を schematic-core が要求する形に直す。§7.2 */
export function toPhysicalOverride(
  raw: Readonly<Record<string, readonly [string, string]>> | undefined,
): Record<string, readonly [TerminalId, TerminalId]> | undefined {
  if (raw === undefined) return undefined;
  const out: Record<string, readonly [TerminalId, TerminalId]> = {};
  for (const [cellId, [left, right]] of Object.entries(raw)) {
    out[cellId] = [toTerminalId(left), toTerminalId(right)];
  }
  return out;
}

/**
 * 課題の盤指定を board-model の型に直す。
 * zod の `S1?: SocketRole | undefined` を `SocketRoles`（`exactOptionalPropertyTypes` のもとでは
 * `S1?: SocketRole`）に詰め替える。値が無いキー＝役割なしの予備ソケット。§6.1
 */
function toRoles(problem: SchematicProblem): SocketRoles {
  return toSocketRoles(problem.board.socketRoles);
}

/** 課題の任意追加部品を部品IDの配列に直す。§5.3.4 */
function toExtraParts(problem: SchematicProblem): PartId[] {
  return (problem.board.extraParts ?? []).map((name) => partId(name));
}

/** 回路図の要素IDから、その要素の課題JSON上の位置（`schematic.rungs[i].cells[j]`）を引く。 */
function cellPath(problem: SchematicProblem, cellId: string): string | undefined {
  const rungs = problem.schematic.rungs;
  for (let i = 0; i < rungs.length; i += 1) {
    const cells = rungs[i]?.cells ?? [];
    for (let j = 0; j < cells.length; j += 1) {
      if (cells[j]?.id === cellId) return `schematic.rungs[${i}].cells[${j}]`;
    }
  }
  return undefined;
}

/**
 * 割当エラーのパスを課題JSONのパスに直す。§13 #2
 *
 * `assignToBoard()` / `toSession()` が返すパスは盤と回路図の語彙（役割名 `roles`、回路図の要素ID
 * `c05`、ソケットの役割 `CR1`、電線ID `sw-003`）なので、そのまま出すと課題JSONのどこを直せば
 * よいのか分からない。課題一覧のエラー表示はスキーマ違反と同じ形にそろえる（§13 #1）。
 */
export function toProblemPath(problem: SchematicProblem, path: string): string {
  if (path.startsWith('physicalOverride.')) return path;
  if (path === 'roles') return 'board.socketRoles';
  const cell = cellPath(problem, path);
  if (cell !== undefined) return cell;
  // 部品を挿せなかったときのパスはソケットの役割名。原因は在庫（`inventory`）の不足
  if ((SOCKET_ROLES as readonly string[]).includes(path)) return 'inventory';
  // 残りは盤側の語彙（電線ID `sw-003` など）で、課題JSONにそのキーは無い。
  // `schematic.sw-003` と書くと存在しない場所を指してしまうので、回路図そのものを指す。
  return 'schematic';
}

/** `buildSchematicSession()` のオプション。 */
export interface BuildSchematicSessionOptions {
  /**
   * `physicalOverride`（§7.2）を使うか。省略時は `doc === problem.schematic`（参照の同一性。
   * 課題自身の回路図をそのまま渡しているか）で決める。
   */
  useProblemOverride?: boolean;
}

/**
 * 回路図1枚を、その課題の盤の設定（役割割当・任意部品・在庫・線色）で盤セッションに落とす。§7.2 / §11.3
 *
 * `physicalOverride`（§7.2）の鍵は**課題の模範回路の要素ID**である。だから使うのは
 * 課題自身の回路図を落とすときだけにする。訓練者の下書きは自分のID（`c1`, `c2`, …）を持つので、
 * そのまま渡すと `toSession()` の `checkOverride()` が「要素IDが見つかりません」を返し、
 * 回路とは無関係な指摘がエディタに出る。
 *
 * 既定は `doc === problem.schematic` という**参照の同一性**で判定する（今までの呼び出し元は
 * この既定のままで動く）。ただし同一性は壊れやすい――構造的に等しいだけの複製（保存して
 * 読み込み直した課題データなど）を渡すと `false` 側に倒れて override が黙って抜け落ちる。
 * 呼び出し側が「これは課題自身の回路図だ」と分かっているときは `useProblemOverride` で
 * 明示できる。`verifySchematic()`（訓練者の下書きを検算する側）は常に `false` を明示で渡す
 * （訓練者の下書きがたまたま `problem.schematic` と同じ参照であっても override を使わない）。
 */
export function buildSchematicSession(
  problem: SchematicProblem,
  board: BoardDefinition,
  doc: SchematicDocument,
  options: BuildSchematicSessionOptions = {},
): ToSessionResult {
  const useOverride = options.useProblemOverride ?? doc === problem.schematic;
  const override = useOverride ? toPhysicalOverride(problem.physicalOverride) : undefined;
  return toSession(doc, board, {
    roles: toRoles(problem),
    color: ASSEMBLE_WIRE_COLOR,
    extraParts: toExtraParts(problem),
    inventory: problem.inventory,
    ...(override === undefined ? {} : { physicalOverride: override }),
  });
}

/**
 * 課題の模範回路を盤セッション＋ネットリストとして組み立てる。§7.2
 * 盤IDが課題と一致しない場合と、割当に失敗した場合はエラーを返す（課題一覧で「模範回路エラー」。§13 #2）。
 */
export function buildReferenceSession(
  problem: SchematicProblem,
  board: BoardDefinition,
): ReferenceResult {
  if (problem.board.boardId !== board.id) {
    return {
      ok: false,
      errors: [
        {
          path: 'board.boardId',
          message: `課題が要求する盤（${problem.board.boardId}）と渡された盤（${board.id}）が違います`,
        },
      ],
    };
  }
  const built = buildSchematicSession(problem, board, problem.schematic);
  if (!built.ok) {
    return {
      ok: false,
      errors: built.errors.map((e) => ({
        path: toProblemPath(problem, e.path),
        message: e.message,
      })),
    };
  }
  return {
    ok: true,
    value: {
      session: built.session,
      netlist: toNetlist(built.session, board),
      roles: built.assignment.roles,
      cells: built.assignment.cells,
    },
  };
}
