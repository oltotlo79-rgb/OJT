import {
  addWire,
  createSession,
  plug,
  type BoardDefinition,
  type BoardSession,
  type InventoryItem,
} from '@ojt/board-model';
import { partId, type PartId, type WireColor } from '@ojt/circuit-sim';
import { assignToBoard, type AssignError, type AssignOptions, type Assignment } from './assign.js';
import { documentDevices, type SchematicDocument } from './document.js';

/**
 * 割当結果から盤セッションを作る。設計仕様 §11.3 / §7.2。
 * 実際の配線は board-model の `addWire()` を通すので、1端子2本の上限や線色パレットの検査は
 * 盤モデル側の規則がそのまま効く。違反は割当側のエラーとして返す。
 */

/** セッション生成のオプション。 */
export interface ToSessionOptions extends AssignOptions {
  /** 盤に追加する任意部品。回路図がブザーを使う場合は自動で `BZ` が追加される。§5.3.4 */
  extraParts?: readonly PartId[];
  /** 使える部品の在庫。省略すると board-model の既定（リレー4・タイマ2）。 */
  inventory?: readonly InventoryItem[];
}

/** 生成結果。 */
export type ToSessionResult =
  | { ok: true; session: BoardSession; assignment: Assignment }
  | { ok: false; errors: readonly AssignError[] };

/** ブザーの部品ID。§6.4 */
const BUZZER_PART_ID = partId('BZ');

/** 回路図から盤セッション（装着＋配線）を作る。§11.3 */
export function toSession(
  doc: SchematicDocument,
  board: BoardDefinition,
  options: ToSessionOptions = {},
): ToSessionResult {
  const assignment = assignToBoard(doc, options);
  if (!assignment.ok) return { ok: false, errors: assignment.errors };

  const color: WireColor = options.color ?? '青';
  const extraParts = [...(options.extraParts ?? [])];
  if (documentDevices(doc).includes('BZ') && !extraParts.includes(BUZZER_PART_ID)) {
    extraParts.push(BUZZER_PART_ID);
  }

  const session = createSession(board, {
    roles: assignment.roles,
    allowedColors: [color],
    extraParts,
    ...(options.inventory !== undefined ? { inventory: options.inventory } : {}),
  });

  const errors: AssignError[] = [];
  for (const part of assignment.parts) {
    const result = plug(session, part.socket, part.kind, {
      ...(part.presetMs !== undefined ? { presetMs: part.presetMs } : {}),
      ...(part.rangeMaxMs !== undefined ? { rangeMaxMs: part.rangeMaxMs } : {}),
    });
    if (!result.ok) errors.push({ path: part.role, message: result.message });
  }
  // 電線IDは割当のID（`sw-NNN`）をそのまま使う。Phase 1D が割当と盤の電線を突き合わせる鍵になる
  for (const spec of assignment.wires) {
    const result = addWire(session, board, spec.from, spec.to, spec.color, { id: spec.id });
    if (!result.ok) errors.push({ path: spec.id, message: result.message });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, session, assignment };
}
