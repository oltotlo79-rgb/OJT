import { validateDocument, type SchematicDocument } from '@ojt/schematic-core';
import type { BoardDefinition } from '@ojt/board-model';
import { judgeAssemble, type JudgeResult } from './judge.js';
import { buildSchematicSession } from './reference.js';
import type { AssembleProblem } from './schema/assemble.js';

/**
 * 検算。設計仕様 §11.4。
 *
 * 訓練者が**回路図エディタで描いた文書**をネットリストにし、課題の操作列で `judgeAssemble()` に
 * かける。3D盤へ配線する前に机上で確かめるための機能であり、**判定そのものと同じ判定器・同じ
 * 操作列・同じ許容差**を使う（Plan 5 決定表#6）。違うのは次の2点だけである。
 *
 * - 盤のセッションは**回路図から自動生成**する（`toSession()`）。訓練者が3Dで張った電線は見ない。
 * - 危険操作（`sessionHazards`）は渡さない。机上の作業に危険操作は無い。
 *
 * 文書が構造的に不正（作りかけ）か、物理割当に失敗した場合は判定へ進まず理由を返す。
 * 理由には**回路図の要素ID**（`cellId`）を添えるので、エディタはその要素を光らせられる
 * （課題JSONのパスへ直す `toProblemPath()` はここでは使わない。エディタが編集しているのは
 * 課題データではなく訓練者の下書きである）。
 */

/** 検算の指摘1件。 */
export interface VerifyIssue {
  /** どの検査が出したか。 */
  source: 'document' | 'assign';
  /** 出どころのパス（`rungs[0].cells[2]` / 要素ID / 電線ID）。 */
  path: string;
  message: string;
  /** その指摘が回路図の要素を指しているときの要素ID（エディタのハイライト用）。 */
  cellId?: string;
}

/** 検算のオプション。 */
export interface VerifyOptions {
  /** 経過時間[ms]（結果の参考表示。合否には影響しない）。§17.2 #3 */
  elapsedMs?: number;
}

/** 検算の結果。 */
export type VerifyResult =
  { ok: true; passed: boolean; judge: JudgeResult } | { ok: false; errors: readonly VerifyIssue[] };

/** 文書に現れる要素IDの集合（指摘に `cellId` を添えられるか判定する）。 */
function cellIds(doc: SchematicDocument): Set<string> {
  const out = new Set<string>();
  for (const r of doc.rungs) for (const cell of r.cells) out.add(cell.id);
  return out;
}

/**
 * 訓練者の回路図を検算する。§11.4
 * 1. 構造検査（`validateDocument()`）
 * 2. 物理割当と盤セッションの生成（`toSession()`。§11.3 の渡り配線を含む）
 * 3. 課題の操作列で判定（`judgeAssemble()`）
 */
export function verifySchematic(
  problem: AssembleProblem,
  board: BoardDefinition,
  doc: SchematicDocument,
  options: VerifyOptions = {},
): VerifyResult {
  if (problem.board.boardId !== board.id) {
    return {
      ok: false,
      errors: [
        {
          source: 'document',
          path: 'board.boardId',
          message: `課題が要求する盤（${problem.board.boardId}）と渡された盤（${board.id}）が違います`,
        },
      ],
    };
  }

  const structural = validateDocument(doc);
  if (structural.length > 0) {
    return {
      ok: false,
      errors: structural.map((e) => ({
        source: 'document' as const,
        path: e.path,
        message: e.message,
      })),
    };
  }

  // 盤への落とし込みは模範回路と同じ関数を通す（Step 3a）。`physicalOverride` の扱いも
  // そこが決めるので、ここには課題データの読み方が1行も残らない。ここで渡す `doc` は
  // **訓練者の下書き**なので、たまたま `problem.schematic` と同じ参照でも override は
  // 使わない（M-e。既定の参照同一性に頼らず明示する）
  const built = buildSchematicSession(problem, board, doc, { useProblemOverride: false });
  if (!built.ok) {
    const known = cellIds(doc);
    return {
      ok: false,
      errors: built.errors.map((e) => ({
        source: 'assign' as const,
        path: e.path,
        message: e.message,
        ...(known.has(e.path) ? { cellId: e.path } : {}),
      })),
    };
  }

  const judged = judgeAssemble(problem, board, built.session, {
    ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
  });
  if (!judged.ok) {
    return {
      ok: false,
      errors: judged.errors.map((e) => ({
        source: 'document' as const,
        path: e.path,
        message: e.message,
      })),
    };
  }
  return { ok: true, passed: judged.value.passed, judge: judged.value };
}
