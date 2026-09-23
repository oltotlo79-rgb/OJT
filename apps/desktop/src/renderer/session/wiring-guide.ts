import { type BoardDefinition, type BoardSession } from '@ojt/board-model';
import {
  buildHighlightIndex,
  buildReferenceSession,
  cellIdsAtTerminal,
  cellIdsOfWire,
  highlightFor,
  type HighlightIndex,
  type SchematicProblem,
} from '@ojt/content';
import { assignToBoard, type SchematicDocument } from '@ojt/schematic-core';
import { NO_HIGHLIGHT, type HighlightSelection } from '../app/store-types.js';

/**
 * 回路図 ⇄ 3D盤の連動ハイライト。設計仕様 §9.2（C2）/ §11.4（モードBの配線ガイド）。
 *
 * C2 で landed していた glue（`InspectRepairSession.tsx` の中）をここへ寄せ、モードBの
 * 配線ガイドと**同じ実装**を使う。索引の出どころは Plan 5 決定表#7 のとおり:
 * 訓練者の下書きがあればそれ、無ければ課題の模範回路。
 *
 * ここが扱う端子IDは**索引と同じ語彙**（役割ベース。`CR1.14`）である。3Dが返すのは物理端子ID
 * （`S1.14`）なので、呼び出し側は `toSessionTerminal()` を通してから渡すこと（§6.4）。
 *
 * React も three も使わないので Vitest だけで検証できる（§14.2）。
 */

/** 索引を作るための入力。 */
export interface GuideInput {
  /** 訓練者が描いた回路図（モードBのエディタ）。C2 は課題の提示回路図を渡す。 */
  doc: SchematicDocument | undefined;
  problem: SchematicProblem;
  board: BoardDefinition;
  /** いまの盤（電線IDを引くのに使う。配線が変わったら作り直すこと）。 */
  session: BoardSession;
}

/**
 * 連動ハイライトの索引。決定表#7
 * `doc` の物理割当に失敗したら（作りかけの下書きなど）`undefined` を返す。呼び出し側は
 * ハイライトを出さない（エディタの指摘欄が理由を出しているので、二重に言わない）。
 */
export function guideIndexFor(input: GuideInput): HighlightIndex | undefined {
  if (input.doc !== undefined) {
    const assigned = assignToBoard(input.doc, {
      roles: input.session.socketRoles,
      board: input.board,
    });
    if (!assigned.ok) return undefined;
    return buildHighlightIndex(assigned.cells, input.session);
  }
  const reference = buildReferenceSession(input.problem, input.board);
  if (!reference.ok) return undefined;
  return buildHighlightIndex(reference.value.cells, input.session);
}

/** 回路図の要素 → 盤の選択。要素が無い／引けないときは「何も光らない」。§11.4 */
export function selectionFor(
  index: HighlightIndex | undefined,
  cellId: string | undefined,
): HighlightSelection {
  if (index === undefined || cellId === undefined) return NO_HIGHLIGHT;
  const target = highlightFor(index, cellId);
  if (target === undefined) return NO_HIGHLIGHT;
  return {
    cellIds: [target.cellId],
    terminals: [...target.terminals],
    wireIds: [...target.wireIds],
  };
}

/** 盤の端子・電線 → 回路図の要素ID（逆引き）。決定表#8 */
export function cellsForHover(
  index: HighlightIndex | undefined,
  hover: { terminal?: string | undefined; wireId?: string | undefined },
): string[] {
  if (index === undefined) return [];
  if (hover.terminal !== undefined) return cellIdsAtTerminal(index, hover.terminal);
  if (hover.wireId !== undefined) return cellIdsOfWire(index, hover.wireId);
  return [];
}

/** 盤の端子・電線から作る選択（逆引きでは端子と電線はそのまま光らせる）。 */
export function selectionForHover(
  index: HighlightIndex | undefined,
  hover: { terminal?: string | undefined; wireId?: string | undefined },
): HighlightSelection {
  const cellIds = cellsForHover(index, hover);
  if (cellIds.length === 0) return NO_HIGHLIGHT;
  return {
    cellIds,
    terminals: hover.terminal === undefined ? [] : [hover.terminal],
    wireIds: hover.wireId === undefined ? [] : [hover.wireId],
  };
}

/**
 * 2つの選択が同じか。ホバーは1秒に何度も走るので、**同じ結果なら `setHighlight()` を呼ばない**
 * ために使う（`visualSignature()` が変わらなくても zustand の購読は全部走るため）。
 */
export function sameSelection(a: HighlightSelection, b: HighlightSelection): boolean {
  const key = (s: HighlightSelection): string =>
    `${s.cellIds.join(',')}|${s.terminals.join(',')}|${s.wireIds.join(',')}`;
  return key(a) === key(b);
}
