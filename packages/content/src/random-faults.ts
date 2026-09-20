import {
  SOCKET_IDS,
  SOCKET_PIN_COUNT,
  toNetlist,
  type BoardDefinition,
  type BoardSession,
} from '@ojt/board-model';
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
 * 引き直しに使ってよい時間の上限（ミリ秒）。
 * 1回の試行は課題の `durationMs` ぶんの再生を含むので、長い課題では100回引き直すと数十秒かかる
 * （実測: `durationMs: 8000` の課題で1試行あたり約363ms、100回で約36秒）。課題開始が止まって
 * 見えるのを避けるため、回数だけでなく時間でも打ち切り、超えたら回数超過と同じく
 * `random.fallback` を使う。
 */
export const MAX_RANDOM_FAULT_MILLIS = 5000;

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
  /**
   * 引き直しに使ってよい時間の上限（ミリ秒。既定 `MAX_RANDOM_FAULT_MILLIS`）。
   * 超えたら回数超過とまったく同じ扱いで `random.fallback` を使う。0にすると即フォールバックする。
   * **`seed` が明示されている（このオプションか課題の `random.seed`）ときは、この既定を
   * 省略した呼び出しでは既定の時間予算そのものを適用しない**（CT-04。§5.2の決定論を保つため）。
   * それでも時間で打ち切りたいときはこのオプションを明示すること（既定に頼らない）。
   */
  maxMillis?: number;
}

/**
 * 生成結果。
 * `fellBack` は「引き直しに失敗して `random.fallback` を使った」ことを表す（明示リストの課題と、
 * 引き直しで組合せを作れた場合は `false`）。2B は作業ファイルに残す解決結果がランダム生成か
 * フォールバックかを、これで区別できる。
 *
 * `seed`（CT-14）は実際に乱数へ使った種で、ランダム指定の課題を解決したときだけ値を持つ
 * （明示 `faults` 配列の課題は乱数を使わないので `undefined`）。`seed` を渡さずに呼ぶと内部で
 * `Date.now()` を使うため、再開時に同じ結果を再現するにはこの値を作業ファイルへ保存し、次回は
 * `resolveFaults()` を呼び直さずに解決済みの `value` をそのまま渡すこと（`options.seed` に
 * この値を渡しても、時計が動いた分だけ `spec.count` 超過の引き直しが起きれば別の結果になりうる
 * ため、再現には `value` を渡す方式のみを使う）。この項目を型に持たせることで、呼び出し側が
 * 種を保存し忘れたまま「保存した」つもりになる事故を防ぐ（コメントだけでは強制できなかった）。
 */
export type ResolveFaultsResult =
  | { ok: true; value: FaultSpecData[]; fellBack: boolean; seed: number | undefined }
  | { ok: false; errors: ProblemIssue[] };

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
    for (let pin = 1; pin <= SOCKET_PIN_COUNT; pin += 1) {
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

/**
 * 模範セッションの複製を作る。
 * `applyFaults()` は `session.wires`（配列と要素）しか書き換えず、`toNetlist()` /
 * `checkWirableTerminal()` は読むだけなので、電線を1段だけ複製すれば試行どうしは干渉しない。
 * 試行ごとに `buildReferenceSession()` をやり直す必要はない（1試行の実測 44.0ms のうち
 * 再構築は 0.18ms で、残りは `runOperations()` の再生。速度より「同じ模範回路から始まることを
 * 構造で保証する」ことが狙いで、再構築の失敗を毎回気にせずに済む）。
 */
function cloneSession(session: BoardSession): BoardSession {
  return { ...session, wires: session.wires.map((w) => ({ ...w })) };
}

/** その組合せが §7.5 の2条件を満たすか（動作が模範と違う／即保護動作しない）。 */
function isUsable(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  reference: BoardSession,
  candidate: readonly FaultSpecData[],
  expectedLog: SignalLog,
  signals: readonly string[],
): boolean {
  const session = cloneSession(reference);
  const applied = applyFaults(session, candidate, board);
  /* c8 ignore next -- 引いた候補は実在する電線・空き端子しか指さないので通常は拒否されない。
     ただし `spareTerminals()` は消費した端子を取り除かないため、同じ空き端子へ3本以上を
     付け替える組合せ（1端子2本まで。§6.6）が出れば拒否されうる（その試行を捨てる）。
     `fallback` の検証にもこの関数を通すので、課題データの誤りもここで弾かれる */
  if (!applied.ok) return false;
  const netlist = toNetlist(session, board);
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
 * 最大 `maxAttempts` 回（かつ `maxMillis` ミリ秒まで）引き直し、尽きたら `random.fallback` を
 * 返す（`fellBack: true`）。`fallback` は返す直前に検証し、盤に適用できない・§7.5 の2条件を
 * 満たさないなら課題データの誤りとして `faults.random.fallback` のエラーにする（§13 #2）。
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
  if (!isRandomFaults(faults)) {
    return { ok: true, value: [...faults], fellBack: false, seed: undefined };
  }
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
  // 試行のたびに複製して使う模範セッション（`isUsable()` は複製の方だけを書き換える）。
  const reference = built.value.session;
  const wireIds = faultableWireIds(built.value.session);
  const partIds = faultablePartIds(built.value.session);
  const spares = spareTerminals(built.value.session);
  const maxAttempts = options.maxAttempts ?? MAX_RANDOM_FAULT_ATTEMPTS;
  /**
   * 既定の壁時計予算（`options.maxMillis` を明示していないとき）は、`seed` が明示されている
   * （`options.seed` か課題の `random.seed`）ときは適用しない（CT-04）。実行時間は機械の速さに
   * 依存するため、同じ seed でも遅い機械では既定の5秒予算に先に当たって `fallback` に落ち、
   * 速い機械では正しい組合せが引ける——という非決定論が起きていた（§5.2「同じseedからは
   * 必ず同じ結果」が破れる）。`maxAttempts`（回数）だけで打ち切れば、同じ seed からは
   * 常に同じ試行列・同じ結論になる。`options.maxMillis` を明示したとき（「時間予算切れ」の
   * 検証など）はその指定を優先する。
   */
  const seedIsExplicit = options.seed !== undefined || spec.seed !== undefined;
  const maxMillis = options.maxMillis ?? (seedIsExplicit ? undefined : MAX_RANDOM_FAULT_MILLIS);
  const deadline = maxMillis === undefined ? undefined : Date.now() + maxMillis;
  const seed = options.seed ?? spec.seed ?? Date.now();
  const random = mulberry32(seed);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (deadline !== undefined && Date.now() >= deadline) break;
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
      // 同じ部品・同じ電線を2度引かない（`takenParts` / `takenWires`）。そのため部品の故障は
      // 「装着されている故障可能な部品の数」より多くは引けず、`count` がそれを超える課題では
      // 部品系の種別だけ引けずに試行が捨てられ続け、最後は `fallback` に落ちる（レビュー指摘 M6）。
      // 例: 装着部品が CR1 だけの盤で `count: 2, types: ['coil-open']`。
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
    if (isUsable(problem, board, reference, candidate, expected.log, signals)) {
      return { ok: true, value: candidate, fellBack: false, seed };
    }
  }
  // 引き直しに失敗したときだけ通る道。`fallback` は課題データなので、ここではじめて
  // 実際に適用できる／§7.5 の2条件を満たすことを確かめる（誤りなら課題エラー。§13 #2）。
  const fallback = [...spec.fallback];
  if (!isUsable(problem, board, reference, fallback, expected.log, signals)) {
    return {
      ok: false,
      errors: [
        {
          path: 'faults.random.fallback',
          message:
            '引き直しに失敗したときの fallback が使えません（盤に適用できないか、模範回路と動作が同じか、電源保護が即座に動作します）',
        },
      ],
    };
  }
  return { ok: true, value: fallback, fellBack: true, seed };
}
