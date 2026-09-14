import type { BoardSession } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import type { CellAssignment } from '@ojt/schematic-core';

/**
 * 回路図と盤の対応表。設計仕様 §9.2（C2の連動ハイライト）/ §11.4。
 * 描画はしない。`apps/desktop`（Plan 2B）が「SVGの図形 → `Shape.cellId` → この索引 →
 * 3D盤の端子・電線」という一本道でハイライトできるだけの情報を返す純関数である。
 *
 * 回路図の図形のうち `cellId` を持つのは**記号とそのラベル**だけで、段の渡り線は `rungId`
 * しか持たない（`@ojt/schematic-core` の `ShapeSource`）。電線の図形から盤へ引く索引は
 * 作れないので、2B は渡り線をクリックされたら何もハイライトしない（逆引きの
 * `cellIdsOfWire()` は盤の電線から回路図の**要素**を引くもので、回路図の線とは別物である）。
 */

/** 回路図の1要素に対応する盤の場所。 */
export interface HighlightTarget {
  cellId: string;
  /** 回路図上の機器名（`CR1` / `PB1` / `PL1` など）。 */
  device: string;
  /** その要素が使う物理端子（`[P側, N側]` の順）。 */
  terminals: readonly TerminalId[];
  /** その端子のどちらかに繋がっている電線のID（盤の電線順）。 */
  wireIds: readonly string[];
}

/** 回路図要素ID → 盤の場所。 */
export type HighlightIndex = ReadonlyMap<string, HighlightTarget>;

/**
 * 回路図要素の物理割当（`buildReferenceSession()` が返す `cells`）と、いまの盤から索引を作る。
 * 電線は**渡された盤セッション**から引くので、故障で取り除かれた電線（未配線）は出てこない。
 *
 * `wireIds` は呼んだ時点の電線IDの写しである。訓練者が電線を張る・外すたびに索引は古くなるので、
 * **配線が変わったら作り直すこと**（端子の割当は変わらないので、作り直しは配線変更のときだけでよい）。
 */
export function buildHighlightIndex(
  cells: readonly CellAssignment[],
  session: BoardSession,
): HighlightIndex {
  const out = new Map<string, HighlightTarget>();
  for (const cell of cells) {
    const terminals: readonly TerminalId[] = [cell.left, cell.right];
    const wireIds = session.wires
      .filter((w) => terminals.some((t) => t === w.from || t === w.to))
      .map((w) => w.id);
    out.set(cell.cellId, { cellId: cell.cellId, device: cell.device, terminals, wireIds });
  }
  return out;
}

/** 回路図の要素から盤の場所を引く。 */
export function highlightFor(index: HighlightIndex, cellId: string): HighlightTarget | undefined {
  return index.get(cellId);
}

/** 盤の端子から、その端子を使っている回路図の要素IDを引く（逆引き）。 */
export function cellIdsAtTerminal(index: HighlightIndex, terminal: string): string[] {
  const out: string[] = [];
  for (const target of index.values()) {
    if (target.terminals.some((t) => t === terminal)) out.push(target.cellId);
  }
  return out;
}

/** 盤の電線から、その電線が繋いでいる回路図の要素IDを引く（逆引き）。 */
export function cellIdsOfWire(index: HighlightIndex, wireId: string): string[] {
  const out: string[] = [];
  for (const target of index.values()) {
    if (target.wireIds.includes(wireId)) out.push(target.cellId);
  }
  return out;
}
