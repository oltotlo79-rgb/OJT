import { toSessionTerminal, type BoardSession } from '@ojt/board-model';
import type { TerminalId, Wire } from '@ojt/circuit-sim';
import { useStore } from '../app/store.js';

/**
 * 3本目の配線を止めたときの共通処理（2026-09-26 利用者指示「同一の端子からは2本までの配線しか
 * できないようにして。3本目を配線しようとしたら注意文を出して」）。
 *
 * 組立・点検修復・PLCの3画面が同じ文言と同じ後始末を使うよう、ここに1か所だけ置く。
 */

/**
 * 注意文に出す端子の名前。役割ID（`CR1.14`）に、盤の印字（`⑭ +`）があれば添える。
 * 3Dのピックは物理ID（`S1.14`）で来るので、呼び出し側は役割IDへ直してから渡す。
 */
export function wireLimitLabel(id: TerminalId, printed: string): string {
  const text = printed.trim();
  return text.length === 0 || text === String(id) ? String(id) : `${String(id)}（${text}）`;
}

/**
 * 注意文を出す。1本目を選んでいる途中なら、その選択は残す（別の端子を選び直せる）。
 * 電線は作らず、Worker へも送らない（危険操作として数えない）。
 */
export function showWireLimit(id: TerminalId, printed: string): void {
  const store = useStore.getState();
  const session = store.session;
  const label = wireLimitLabel(
    session === undefined ? id : toSessionTerminal(session, id),
    printed,
  );
  store.setWireLimitNotice(label);
  store.addLog(`配線を止めました: ${label} は2本つながっています（3本目は接続できません）`);
}

/** 次の電線を張れたら注意文を消す（読み終える前に消えないよう、始点を選んだだけでは消さない）。 */
export function clearWireLimit(): void {
  const store = useStore.getState();
  if (store.wireLimitNotice !== undefined) store.setWireLimitNotice(undefined);
}

/**
 * `addWire()` が `terminal-overload` で断った電線のうち、満杯だった端（役割ID）。
 * 3Dと端子一覧は満杯の端子を押させないので、ここへ来るのは状態が食い違った稀な場合だけ。
 */
export function overloadedEnd(session: BoardSession, wire: Wire): TerminalId {
  const count = (id: TerminalId): number =>
    session.wires.filter((w) => w.from === id || w.to === id).length;
  return count(wire.from) >= count(wire.to) ? wire.from : wire.to;
}
