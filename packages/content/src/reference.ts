import {
  SOCKET_ROLES,
  toNetlist,
  type BoardDefinition,
  type BoardSession,
  type SocketRoles,
} from '@ojt/board-model';
import { partId, toTerminalId, type Netlist, type PartId, type TerminalId } from '@ojt/circuit-sim';
import { toSession } from '@ojt/schematic-core';
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

/** 模範回路（盤セッション＋ネットリスト）。 */
export interface ReferenceCircuit {
  session: BoardSession;
  netlist: Netlist;
  roles: SocketRoles;
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
  const override = toPhysicalOverride(problem.physicalOverride);
  const built = toSession(problem.schematic, board, {
    roles: toRoles(problem),
    color: ASSEMBLE_WIRE_COLOR,
    extraParts: toExtraParts(problem),
    inventory: problem.inventory,
    ...(override === undefined ? {} : { physicalOverride: override }),
  });
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
    },
  };
}
