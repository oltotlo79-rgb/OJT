import type { BoardDefinition, BoardTerminal } from './board-jipm.js';
import { rectContains, type Rect } from './geometry.js';

/** 端子台の描画と出線位置で共有する外形。単位は盤座標のmm。 */
export interface TerminalBlockShape extends Rect {
  cx: number;
  cy: number;
  bodyTop: number;
  cap: Rect & { top: number };
  printZ: number;
  leadZ: number;
}

export const TERMINAL_BLOCK_PAD_MM = 6;
const MIN_BODY_MM = 16;
const CAP_DEPTH_MM = 4;

/** ネジ頭の底へ台座を合わせ、奥側のカバーも台座の外形内に収める。 */
export function terminalBlockShape(
  terminals: readonly BoardTerminal[],
): TerminalBlockShape | undefined {
  if (terminals.length === 0) return undefined;
  const xs = terminals.map((terminal) => terminal.pos.x);
  const ys = terminals.map((terminal) => terminal.pos.y);
  const screwZ = Math.max(...terminals.map((terminal) => terminal.pos.z));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = Math.max(MIN_BODY_MM, Math.max(...xs) - Math.min(...xs) + TERMINAL_BLOCK_PAD_MM * 2);
  const h = Math.max(MIN_BODY_MM, Math.max(...ys) - Math.min(...ys) + TERMINAL_BLOCK_PAD_MM * 2);
  const x = cx - w / 2;
  const y = cy - h / 2;
  return {
    x,
    y,
    w,
    h,
    cx,
    cy,
    bodyTop: screwZ - 0.8,
    cap: { x, y, w, h: CAP_DEPTH_MM, top: screwZ + 1 },
    printZ: screwZ + 1.4,
    leadZ: screwZ + 4,
  };
}

const shapesByBoard = new WeakMap<BoardDefinition, Map<string, TerminalBlockShape>>();

/** 拡張盤の同名端子台も、占有領域ごとに分けて描画と同じ端子群で計算する。 */
export function terminalBlockFor(
  board: BoardDefinition,
  terminal: BoardTerminal,
): TerminalBlockShape | undefined {
  let shapes = shapesByBoard.get(board);
  if (shapes === undefined) {
    shapes = new Map();
    for (const footprint of board.footprints.filter((item) => item.kind === 'block')) {
      const terminals = board.terminals.filter((item) => rectContains(footprint, item.pos));
      const shape = terminalBlockShape(terminals);
      if (shape !== undefined) {
        for (const item of terminals) shapes.set(item.id, shape);
      }
    }
    shapesByBoard.set(board, shapes);
  }
  return shapes.get(terminal.id);
}
