import { N_RAIL_ID, P_RAIL_ID } from '@ojt/board-model';
import {
  buildNets,
  terminalId,
  type Nets,
  type Netlist,
  type Part,
  type TerminalId,
} from '@ojt/circuit-sim';

/**
 * 禁則回路の構造パターン照合。設計仕様 §7.4 / §5.3.2 / 調査資料 §5.5。
 *
 * Phase 1 はチャタリング検出だけで判定していた（復帰時間モデルにより禁則回路は必ず
 * tick 周期で反転するため検出漏れは無い）。Phase 2 では「なぜ駄目なのか」を言えるように、
 * ネットリストの導電グラフから2つのパターンを構造的に見つける。
 *
 * 判定の骨組みは「対象コイル自身を経路から外した導電グラフで、指定したタイマだけを
 * タイムアップ位置に置き、それ以外の接点はすべて閉として、コイルの両端が P / N から
 * 到達できるか」を見るだけである。**誰もタイムアップしていない状態で既に切れているコイルは
 * 対象外**にするので、断線・未配線でコイルが死んでいるだけの盤（モードC2の初期状態）を
 * タイマのせいにしない。
 */

/** 見つかったパターンの種別。 */
export type ForbiddenPatternKind = 'timer-self-cut' | 'timer-pair-flicker';

/** 見つかった禁則回路1件。 */
export interface ForbiddenPattern {
  kind: ForbiddenPatternKind;
  /** 関係するタイマの部品ID（自己遮断は1個、2個フリッカは2個。昇順）。 */
  timerIds: readonly string[];
  /** 結果画面に出す説明。 */
  message: string;
}

/** P母線の供給端子。§6.4 */
const P_TERMINAL: TerminalId = terminalId(P_RAIL_ID, '1');
/** N母線の供給端子。§6.4 */
const N_TERMINAL: TerminalId = terminalId(N_RAIL_ID, '1');

/** そのタイマのコイル要素（負荷要素はコイル1つだけ）。 */
function coilOf(timer: Part): { id: string; from: TerminalId; to: TerminalId } | undefined {
  for (const el of timer.elements) {
    if (el.kind === 'load') return { id: el.id, from: el.from, to: el.to };
  }
  return undefined;
}

/**
 * そのコイルが P / N から到達できないか（＝切られているか）を調べる。
 * `energized` に入れたタイマの接点だけをタイムアップ位置（a=閉 / b=開）にし、
 * それ以外の接点はすべて閉とみなす（最良ケース）。
 *
 * 導電辺に採るのは**接点とリンク（部品内部の内部結線・端子台）だけ**で、負荷（コイル・ランプ・
 * ブザー）は採らない。負荷を導線と同一視すると「CR1コイル → PL1ランプ」のように負荷2個を
 * 直列に通る幻の経路ができ、そこから対象タイマの限時b接点へ回り込んで、断線しただけの盤を
 * 「タイマが自分のコイルを切っている」と誤検出してしまう（レビュー指摘 BLOCKING）。
 * 見たいのは「コイルの両端が P / N に**繋がっているか**」であり、コイル自身より先に別の負荷を
 * 通る経路は電気的にも給電経路ではない。
 *
 * `nets` は呼び出し側（{@link findForbiddenPatterns}）が `buildNets()` で1回だけ作ったものを渡す
 * こと（CT-10。以前はここで毎回 `buildNets(netlist)` をやり直しており、タイマ `timers` 個に対し
 * `timers × (timers+1)` 回、ネットリストの組み直しが起きていた）。
 */
function isCoilCut(
  netlist: Netlist,
  nets: Nets,
  timer: Part,
  energized: ReadonlySet<string>,
): boolean {
  const coil = coilOf(timer);
  if (coil === undefined) return true;
  if (!nets.hasTerminal(P_TERMINAL) || !nets.hasTerminal(N_TERMINAL)) return false;
  const adjacency = new Map<number, number[]>();
  const push = (from: number, to: number): void => {
    const list = adjacency.get(from);
    if (list === undefined) adjacency.set(from, [to]);
    else list.push(to);
  };
  const connect = (a: TerminalId, b: TerminalId): void => {
    const na = nets.nodeOf(a);
    const nb = nets.nodeOf(b);
    push(na, nb);
    push(nb, na);
  };
  for (const part of netlist.parts) {
    for (const el of part.elements) {
      if (el.id === coil.id) continue;
      if (el.kind === 'contact') {
        const timedOut = el.driver === 'timer' && energized.has(el.driverId);
        if (timedOut ? el.contact === 'a' : true) connect(el.from, el.to);
      } else if (el.kind === 'link') {
        connect(el.from, el.to);
      }
    }
  }
  const walk = (start: TerminalId): Set<number> => {
    const first = nets.nodeOf(start);
    const seen = new Set<number>([first]);
    const stack = [first];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) break;
      for (const next of adjacency.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return seen;
  };
  const fromP = walk(P_TERMINAL);
  const fromN = walk(N_TERMINAL);
  return !(fromP.has(nets.nodeOf(coil.from)) && fromN.has(nets.nodeOf(coil.to)));
}

/**
 * 禁則回路を構造から見つける。§7.4
 * 戻り値は自己遮断（部品ID順）→ 2個フリッカ（組の昇順）の順。空配列なら問題なし。
 */
export function findForbiddenPatterns(netlist: Netlist): ForbiddenPattern[] {
  const timers = netlist.parts.filter((p) => p.meta.kind === 'timer-h3y4');
  if (timers.length === 0) return [];
  // CT-10: ネットリストは判定のあいだ変わらないので、`buildNets()` はここで1回だけ作る。
  const nets = buildNets(netlist);
  const alive = new Map<string, boolean>();
  const cutBy = new Map<string, Set<string>>();
  for (const timer of timers) {
    alive.set(timer.id, !isCoilCut(netlist, nets, timer, new Set()));
    const cut = new Set<string>();
    for (const other of timers) {
      if (isCoilCut(netlist, nets, timer, new Set([other.id]))) cut.add(other.id);
    }
    cutBy.set(timer.id, cut);
  }
  const out: ForbiddenPattern[] = [];
  for (const timer of timers) {
    if (alive.get(timer.id) !== true) continue;
    if (cutBy.get(timer.id)?.has(timer.id) !== true) continue;
    out.push({
      kind: 'timer-self-cut',
      timerIds: [timer.id],
      message: `${timer.id} はタイマ自身の限時接点で自分のコイルを切っています（リレーを介してください）`,
    });
  }
  for (let i = 0; i < timers.length; i += 1) {
    for (let j = i + 1; j < timers.length; j += 1) {
      const a = timers[i];
      const b = timers[j];
      if (a === undefined || b === undefined) continue;
      if (alive.get(a.id) !== true || alive.get(b.id) !== true) continue;
      if (cutBy.get(a.id)?.has(b.id) !== true) continue;
      if (cutBy.get(b.id)?.has(a.id) !== true) continue;
      out.push({
        kind: 'timer-pair-flicker',
        timerIds: [a.id, b.id],
        message: `${a.id}・${b.id} はタイマ2個だけでフリッカ回路を構成しています（リレーを介してください）`,
      });
    }
  }
  return out;
}
