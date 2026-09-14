import { socketPartId, SOCKET_IDS, wireCountAtTerminal, type BoardSession } from '@ojt/board-model';
import {
  MAX_WIRES_PER_TERMINAL,
  PICKUP_VOLTS,
  type ChatterEvent,
  type HazardEvent,
  type Netlist,
  type SignalLog,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import { STATIC_CHECK_IDS, type StaticCheckId, type StaticChecksData } from './schema/judge.js';

/**
 * 静的チェック。設計仕様 §7.4。
 * 通電せずに（＝再生後のログとイベントだけで）判定できる検査をまとめる。
 * 各チェックは `{ id, ok, message, details }` を返し、UIは項目ごとに OK / エラーを並べる（§8.3）。
 */

/** チェック1件の結果。§7.4 */
export interface StaticCheckResult {
  id: StaticCheckId;
  ok: boolean;
  message: string;
  details: string[];
}

/** チェックの入力（訓練者側の盤・ネットリスト・再生結果）。 */
export interface StaticCheckInput {
  session: BoardSession;
  netlist: Netlist;
  log: SignalLog;
  hazards: readonly HazardEvent[];
  chatters: readonly ChatterEvent[];
  /** 新規配線に使ってよい線色。モードBは青のみ。§8.1 */
  allowedColors: readonly WireColor[];
}

function result(id: StaticCheckId, details: string[], okMessage: string, ngMessage: string) {
  return details.length === 0
    ? { id, ok: true, message: okMessage, details }
    : { id, ok: false, message: ngMessage, details };
}

/**
 * 線色ルール。訓練者が引いた電線がパレットの色（モードBは青のみ）かを見る。§7.4 / §4.2 / §8.1
 * 盤に最初から施工されている固定配線（`locked`）は訓練者の責任範囲ではなく、実物でも
 * チェック用回路を含めて**青**で配線されているため、色の検査対象から外す（§6.3）。
 */
export function checkWireColorRule(input: StaticCheckInput): StaticCheckResult {
  const details: string[] = [];
  for (const wire of input.session.wires) {
    if (wire.locked) continue;
    if (!input.allowedColors.includes(wire.color)) {
      details.push(
        `${wire.id}: この課題で使えるのは ${input.allowedColors.join('・')} です（${wire.color}）`,
      );
    }
  }
  return result(
    'wireColorRule',
    details,
    '線色は規定どおりです',
    '規定外の線色で配線された箇所があります',
  );
}

/** 1端子2本まで。§7.4 / §6.6 */
export function checkTerminalLimit(input: StaticCheckInput): StaticCheckResult {
  const seen = new Set<TerminalId>();
  const details: string[] = [];
  for (const wire of input.session.wires) {
    for (const terminal of [wire.from, wire.to]) {
      if (seen.has(terminal)) continue;
      seen.add(terminal);
      const count = wireCountAtTerminal(input.session, terminal);
      if (count > MAX_WIRES_PER_TERMINAL) {
        details.push(`${terminal}: ${count}本（上限は${MAX_WIRES_PER_TERMINAL}本）`);
      }
    }
  }
  return result(
    'terminalLimit',
    details,
    '1端子あたりの本数は規定内です',
    '1端子に3本以上つながっている箇所があります',
  );
}

/**
 * 未使用部品。装着したのにどのピンにも電線が1本も来ていない部品を検出する。§7.4
 * （回路への「組み込まれ方」の良否ではなく、盤上で完全に浮いている部品を指摘する。）
 * チェック用ソケットは固定配線で常に励磁できる状態にあるため対象外にする（§6.3）。
 * 役割なしの予備ソケットは物理ソケットIDがそのまま部品IDになる（`socketPartId`。§6.4）。
 */
export function checkUnusedParts(input: StaticCheckInput): StaticCheckResult {
  const wired = new Set<string>();
  for (const wire of input.session.wires) {
    for (const terminal of [wire.from, wire.to]) {
      wired.add(terminal.slice(0, terminal.indexOf('.')));
    }
  }
  const details: string[] = [];
  for (const socket of SOCKET_IDS) {
    const mounted = input.session.mounted[socket];
    if (mounted === undefined) continue;
    if (input.session.socketRoles[socket] === 'CHK') continue;
    const part = socketPartId(input.session.socketRoles, socket);
    if (!wired.has(part)) details.push(`${socket}（${part}）: 装着していますが未接続です`);
  }
  return result(
    'unusedParts',
    details,
    '未接続のまま装着された部品はありません',
    '装着したのに回路に組み込まれていない部品があります',
  );
}

/**
 * チャタリングを訓練者に見える単位の信号名に直す。§5.7
 * エンジンは接点要素ごとに `CR1:a1.closed` という信号も記録するので、リレー1個が震えるだけで
 * 接点8本ぶんのイベントが出る。盤の上で見えるのは**部品**（`CR1` / `PL1` / `T1.coil`）なので、
 * `<部品ID>:<要素>.closed` は部品IDに畳む。
 */
function visibleChatterSignal(signal: string): string {
  const colon = signal.indexOf(':');
  return colon < 0 ? signal : signal.slice(0, colon);
}

/**
 * 禁則回路。判定区間でチャタリングを検出したら不合格にする。§7.4 / §5.3.2 / 調査資料 §5.5
 * タイマ自身の限時接点で自コイルを切る構成・タイマ2個だけのフリッカは、通電断が
 * 100ms未満しか続かず経過時間が保持されるため tick 周期で反転し、ここで捕まる。
 *
 * 1つの震えは（接点要素ごと・1秒窓ごとに）何十件ものイベントになるため、そのまま並べると
 * 結果画面が同じ内容で埋まる。信号ごとに最初の1件だけを出す（§8.3）。
 */
export function checkForbiddenCircuit(input: StaticCheckInput): StaticCheckResult {
  const seen = new Set<string>();
  const details: string[] = [];
  for (const e of input.chatters) {
    const signal = visibleChatterSignal(e.signal);
    if (seen.has(signal)) continue;
    seen.add(signal);
    details.push(`${signal}: ${e.tMs}ms 付近で1秒間に${e.count}回反転しました`);
  }
  return result(
    'forbiddenCircuit',
    details,
    '禁則回路は検出されませんでした',
    'タイマの接点で自分のコイルを切る回路は実機では動作が不安定になります（リレーを介してください）',
  );
}

/**
 * コイル極性。14 = (+)、13 = (−)。§7.4 / §5.3.1
 * 通電中のコイル電圧（`<部品ID>.coilV` として記録される）が励磁しきい値ぶん**負**に振れていれば、
 * 13 に + を、14 に − を繋いでいる（逆極性）と判定する。
 */
export function checkCoilPolarity(input: StaticCheckInput): StaticCheckResult {
  const details: string[] = [];
  for (const part of input.netlist.parts) {
    if (part.meta.kind !== 'relay-my4n' && part.meta.kind !== 'timer-h3y4') continue;
    let worst = 0;
    for (const entry of input.log.transitions(`${part.id}.coilV`)) {
      if (typeof entry.value === 'number' && entry.value < worst) worst = entry.value;
    }
    if (worst <= -PICKUP_VOLTS) {
      details.push(
        `${part.id}: コイル電圧が ${worst.toFixed(1)}V です（14 に +、13 に − を接続します）`,
      );
    }
  }
  return result(
    'coilPolarity',
    details,
    'コイルの極性は正しく接続されています',
    'コイルの極性が逆の部品があります',
  );
}

/** 電源投入・遮断の手順違反。§7.4 / §5.3.5 */
export function checkPowerSequence(input: StaticCheckInput): StaticCheckResult {
  const violations = input.hazards.filter((e) => e.kind === 'power-sequence-violation');
  const details = violations.map((e) => `${e.tMs}ms: ${e.detail}`);
  return result(
    'powerSequence',
    details,
    '電源の入切手順は守られています',
    '電源の入切手順に違反があります（ON: ブレーカ→スイッチ／OFF: スイッチ→ブレーカ）',
  );
}

/** IDごとのチェック関数。 */
const CHECKS: Readonly<Record<StaticCheckId, (input: StaticCheckInput) => StaticCheckResult>> = {
  wireColorRule: checkWireColorRule,
  terminalLimit: checkTerminalLimit,
  unusedParts: checkUnusedParts,
  forbiddenCircuit: checkForbiddenCircuit,
  coilPolarity: checkCoilPolarity,
  powerSequence: checkPowerSequence,
};

/** 有効にした静的チェックだけを `STATIC_CHECK_IDS` の順に実行する。§7.4 */
export function runStaticChecks(
  input: StaticCheckInput,
  enabled: StaticChecksData,
): StaticCheckResult[] {
  const out: StaticCheckResult[] = [];
  for (const id of STATIC_CHECK_IDS) {
    if (!enabled[id]) continue;
    out.push(CHECKS[id](input));
  }
  return out;
}
