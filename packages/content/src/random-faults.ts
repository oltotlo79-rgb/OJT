import { SOCKET_IDS, toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import { compareLogs, type FaultKind, type SignalLog } from '@ojt/circuit-sim';
import { applyFaults, injectPartFaults } from './faults.js';
import { buildReferenceSession } from './reference.js';
import { mulberry32, pickOne } from './rng.js';
import { runOperations } from './runner.js';
import {
  isRandomFaults,
  isWireFaultKind,
  SOCKET_COIL_ELEMENT_INDEX,
  socketContactElementIndex,
  type FaultSpecData,
  type RandomFaultsData,
} from './schema/faults.js';
import type { ProblemIssue } from './schema/index.js';
import { resolveCompareSignals } from './schema/judge.js';
import type { InspectRepairProblem } from './schema/inspect-repair.js';

/**
 * ランダム故障の生成。設計仕様 §7.5。
 * seed から決定論的に組合せを作り、「模範回路と動作が異なる」「電源保護が即座に動作しない」の
 * 2条件を満たすまで引き直す（最大100回、超過したら課題の `fallback` を使う）。
 */

/** 引き直しの上限。§7.5 */
export const MAX_RANDOM_FAULT_ATTEMPTS = 100;

/**
 * ランダムに選んでよい故障の種別。§7.5 / §9.2
 * 訓練者がこの盤で直せるものに限る（電線は白線で引き直す、リレー／タイマは良品に交換する）。
 * `lamp-open` は盤に固定された機器の故障で交換できず、修復後の動作一致（§9.2 判定②）に
 * 到達できないため候補から外す（明示リストでは §5.4 どおり指定できる）。
 */
export const RANDOM_FAULT_KINDS = [
  'wire-open',
  'wire-missing',
  'wire-misrouted',
  'contact-open',
  'contact-welded',
  'contact-resistive',
  'coil-open',
  'coil-layer-short',
] as const satisfies readonly FaultKind[];

/** 生成オプション。 */
export interface ResolveFaultsOptions {
  /** `random.seed` を上書きする。 */
  seed?: number;
  /** 引き直しの上限（既定 `MAX_RANDOM_FAULT_ATTEMPTS`）。0にすると即フォールバックする。 */
  maxAttempts?: number;
}

/** 生成結果。 */
export type ResolveFaultsResult =
  { ok: true; value: FaultSpecData[] } | { ok: false; errors: ProblemIssue[] };

/** 役割が割り当てられ、部品が装着されているソケットの部品ID（チェック用は除く）。§9.2 */
function faultablePartIds(session: BoardSession): string[] {
  const out: string[] = [];
  for (const socket of SOCKET_IDS) {
    if (session.mounted[socket] === undefined) continue;
    const role = session.socketRoles[socket];
    /* c8 ignore next -- 装着済みなのにロールなし／CHK という組合せはC2の盤では起きない */
    if (role === undefined || role === 'CHK') continue;
    out.push(role);
  }
  return out;
}

/** 故障を入れてよい電線（既設の固定配線を除く）。§6.3 */
function faultableWireIds(session: BoardSession): string[] {
  return session.wires.filter((w) => !w.locked).map((w) => w.id);
}

/** 誤配線の付け替え先にできる端子（装着部品の、まだ何も繋がっていないピン）。 */
function spareTerminals(session: BoardSession): string[] {
  const used = new Set<string>();
  for (const wire of session.wires) {
    used.add(wire.from);
    used.add(wire.to);
  }
  const out: string[] = [];
  for (const partId of faultablePartIds(session)) {
    for (let pin = 1; pin <= 14; pin += 1) {
      const terminal = `${partId}.${String(pin)}`;
      if (!used.has(terminal)) out.push(terminal);
    }
  }
  return out;
}

/** 1件ぶんの故障を引く。引けなければ undefined（その試行は捨てる）。 */
function drawFault(
  random: () => number,
  kind: FaultKind,
  wireIds: readonly string[],
  partIds: readonly string[],
  spares: readonly string[],
): FaultSpecData | undefined {
  if (isWireFaultKind(kind)) {
    const wireId = pickOne(random, wireIds);
    if (wireId === undefined) return undefined;
    if (kind !== 'wire-misrouted') return { target: { wireId }, kind };
    const to = pickOne(random, spares);
    if (to === undefined) return undefined;
    return { target: { wireId }, kind, to };
  }
  const partId = pickOne(random, partIds);
  if (partId === undefined) return undefined;
  if (kind === 'coil-open' || kind === 'coil-layer-short') {
    return { target: { partId, elementIndex: SOCKET_COIL_ELEMENT_INDEX }, kind };
  }
  const group = Math.min(4, 1 + Math.floor(random() * 4));
  const contact = random() < 0.5 ? 'a' : 'b';
  return {
    target: { partId, elementIndex: socketContactElementIndex(group, contact) },
    kind,
  };
}

/** その組合せが §7.5 の2条件を満たすか（動作が模範と違う／即保護動作しない）。 */
function isUsable(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  candidate: readonly FaultSpecData[],
  expectedLog: SignalLog,
  signals: readonly string[],
): boolean {
  const built = buildReferenceSession(problem, board);
  /* c8 ignore next -- resolveFaults は同じ problem/board で一度成功させてから isUsable を呼ぶため、
     決定論的な buildReferenceSession がここでだけ失敗することはない */
  if (!built.ok) return false;
  const applied = applyFaults(built.value.session, candidate);
  /* c8 ignore next -- candidate は faultableWireIds / spareTerminals から引いた実在する電線・
     空き端子しか使わないため、applyFaults が課題データの誤りとして拒否することはない */
  if (!applied.ok) return false;
  const netlist = toNetlist(built.value.session, board);
  /* c8 ignore next -- candidate の部品対象は faultablePartIds と要素番号の式から作るため、
     実在しない部品・要素・種別不一致にはならず FaultError は起きない */
  if (injectPartFaults(netlist, applied.value.partFaults).length > 0) return false;
  const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
  if (run.events.hazards('short-circuit-power-on').length > 0) return false;
  return compareLogs(expectedLog, run.log, signals, problem.judge.tolerance).length > 0;
}

/**
 * 課題の `faults` を、実際に注入する明示リストに解決する。§7.5
 * 明示リストならそのまま返す。ランダム指定なら seed から引き、2条件を満たす組合せが出るまで
 * 最大 `maxAttempts` 回引き直し、尽きたら `random.fallback` を返す。
 * `random.seed` も `options.seed` も無いときは `Date.now()` を種にする（§7.5 の
 * 「省略すると課題開始ごとに新しい乱数を使い同じ課題を繰り返し練習できる」）。この場合は
 * 呼び出し側ごとに解決結果が変わるので、判定・再現には使えない。テストからは必ず seed を
 * 渡すこと。2B は `resolveFaults()` が返す解決済みリストをそのまま作業ファイルへ書き出し、
 * 以後はその明示リストを読むことで、`Date.now()` を種にした課題でも同一プレイ内では
 * 同じ故障を再現できるようにする（この関数自身は保存を行わない）。
 */
export function resolveFaults(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  options: ResolveFaultsOptions = {},
): ResolveFaultsResult {
  const faults = problem.faults;
  if (!isRandomFaults(faults)) return { ok: true, value: [...faults] };
  const spec: RandomFaultsData = faults.random;
  const unknown = spec.types.filter(
    (kind) => !(RANDOM_FAULT_KINDS as readonly FaultKind[]).includes(kind),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      errors: [
        {
          path: 'faults.random.types',
          message: `この盤で修復できない故障はランダムに選べません: ${unknown.join('・')}`,
        },
      ],
    };
  }
  const built = buildReferenceSession(problem, board);
  if (!built.ok) return { ok: false, errors: built.errors };
  const expected = runOperations(built.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  const signals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);
  const wireIds = faultableWireIds(built.value.session);
  const partIds = faultablePartIds(built.value.session);
  const spares = spareTerminals(built.value.session);
  const maxAttempts = options.maxAttempts ?? MAX_RANDOM_FAULT_ATTEMPTS;
  const random = mulberry32(options.seed ?? spec.seed ?? Date.now());

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate: FaultSpecData[] = [];
    const takenWires = new Set<string>();
    const takenParts = new Set<string>();
    let complete = true;
    for (let i = 0; i < spec.count; i += 1) {
      const kind = pickOne(random, spec.types);
      /* c8 ignore next 4 -- スキーマが types を1件以上必須にしているため到達しない */
      if (kind === undefined) {
        complete = false;
        break;
      }
      const drawn = drawFault(
        random,
        kind,
        wireIds.filter((id) => !takenWires.has(id)),
        partIds.filter((id) => !takenParts.has(id)),
        spares,
      );
      if (drawn === undefined) {
        complete = false;
        break;
      }
      if ('wireId' in drawn.target) takenWires.add(drawn.target.wireId);
      else takenParts.add(drawn.target.partId);
      candidate.push(drawn);
    }
    if (!complete) continue;
    if (isUsable(problem, board, candidate, expected.log, signals)) {
      return { ok: true, value: candidate };
    }
  }
  return { ok: true, value: [...spec.fallback] };
}
