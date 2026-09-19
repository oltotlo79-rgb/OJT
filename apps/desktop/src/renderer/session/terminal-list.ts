import {
  isOffBoardTerminal,
  isSocketId,
  toSessionTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
} from '@ojt/board-model';
import { MAX_WIRES_PER_TERMINAL, parseTerminalId, type TerminalId } from '@ojt/circuit-sim';

/**
 * 端子リスト（キーボードで配線するための一覧）。UXレビュー #29（2026-09-19）。
 * §15 のアクセシビリティは「課題選択・判定・結果確認まで」しか求めていないが、
 * 利用者要求「分かりやすく直感的に」に応えて**配線もキーボードで完結**させる。
 * React も three も使わないので Vitest だけで検証できる（§14.2）。
 *
 * **端子IDは役割ベースに正規化する。** `board.terminals[].id` はソケットを**物理ID**
 * （`S1.9`）で持つのに対し、`session.wires` は**役割ID**（`CR1.9`）で張られている
 * （`board-model/src/session.ts` の `toSessionTerminal()` の注記: 「電線と突き合わせる前に
 * 必ずこれを通すこと」）。混ぜると①電線の本数が常に0本に見え、②見出しが `S1` になり、
 * ③`pickToAction()` → `addWire()` が入口で別のIDに正規化するので画面の表示とずれる。
 */

/** 一覧の1行。 */
export interface TerminalRow {
  /** **役割ベース**の端子ID（`CR1.9` / `TB_PL.1+` / `P.1`）。`session.wires` と同じ語彙。 */
  id: TerminalId;
  /** 画面に出す名前（`CR1 ⑨ COM` / `PL1 +` / `P1`）。 */
  label: string;
  /** まとまりの見出し（`CR1` / `TB_PL` / `P` のような部品ID。ソケットは**役割ID**）。 */
  group: string;
  /** いまその端子に繋がっている電線の本数。 */
  wireCount: number;
  /** 上限（2本）に達していて、これ以上繋げないか。§6.6 */
  full: boolean;
}

/** その端子に繋がっている電線の本数（既設配線も数える）。§6.6 */
function wireCountAt(session: BoardSession, id: TerminalId): number {
  return session.wires.filter((w) => w.from === id || w.to === id).length;
}

/**
 * 盤定義の端子1つを、いまのセッションの語彙の1行にする。出せない端子は undefined。
 *
 * 出さないのは次の3種類:
 * - `wirable: false`（AC一次側 `CB`/`SW`/`PS`、PB／PL 本体端子）。§6.4
 * - 課題が足していない任意部品の端子（`BZ`）。§5.3.4
 * - 役割の割り当てが無い予備ソケットの端子（`toSessionTerminal()` が物理IDのまま返す）。§6.1
 */
function toRow(session: BoardSession, terminal: BoardTerminal): TerminalRow | undefined {
  if (!terminal.wirable) return undefined;
  const physical = parseTerminalId(terminal.id);
  if (terminal.optional && !session.extraParts.includes(physical.part)) return undefined;
  const id = toSessionTerminal(session, terminal.id);
  const { part } = parseTerminalId(id);
  const socket = isSocketId(physical.part);
  if (socket && isSocketId(part)) return undefined;
  const count = wireCountAt(session, id);
  return {
    id,
    // 盤定義の印字はソケットだけ部品IDを持たない（`⑨ COM`）ので、役割IDを前に足す。§8.2
    label: socket ? `${part} ${terminal.label}` : terminal.label,
    group: part,
    wireCount: count,
    full: count >= MAX_WIRES_PER_TERMINAL,
  };
}

/**
 * 配線できる盤の端子の一覧（盤定義の並び順）。`query` を渡すと端子IDと名前の両方で絞り込む。
 * 机上の端子（PLC本体・壁コンセント）も**盤の一部として出す**（モードDで使う）。
 */
export function terminalRows(
  board: BoardDefinition,
  session: BoardSession,
  query = '',
): TerminalRow[] {
  const needle = query.trim();
  const out: TerminalRow[] = [];
  for (const terminal of board.terminals) {
    const row = toRow(session, terminal);
    if (row === undefined) continue;
    if (needle.length > 0 && !`${row.id}${row.label}`.includes(needle)) continue;
    out.push(row);
  }
  return out;
}

/** 机上の端子か（見出しに「机上」を付ける）。§10.1 */
export function isDeskRow(row: TerminalRow): boolean {
  return isOffBoardTerminal(row.id);
}
