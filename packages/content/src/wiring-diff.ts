import { toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import {
  buildNets,
  parseTerminalId,
  terminalId,
  type Nets,
  type TerminalId,
} from '@ojt/circuit-sim';
import type { CellAssignment } from '@ojt/schematic-core';
import { buildReferenceSession, type SchematicProblem } from './reference.js';

/**
 * 「疑わしい配線」の割り出し。UXレビュー #28（2026-09-19）。
 *
 * 判定（`judgeAssemble()`）は波形の食い違いしか返さないので、訓練者は「PL1 が点かない」までは
 * 分かっても**どの電線を見ればよいか**が分からない。ここでは模範回路と訓練者回路の
 * **節点分割**（`buildNets()` の union-find）を比べ、「本来つながるはずの2端子がつながっていない」
 * （`missing`）と「本来別のはずの2端子がつながっている」（`extra`）を挙げる。
 *
 * 電線を1本ずつ突き合わせないのは、§11.3 の母線分配が**渡り配線**（鎖）であり、鎖の順序に
 * 自由度があるためである（`P.1 → A → B` と `P.1 → B → A` は電気的に同じ）。節点分割なら
 * 「電気的に同じかどうか」だけを見るので、正しい配線を誤りと呼ばずに済む。
 *
 * 比べる端子は**回路図の要素が使う端子と母線の供給端子**に限る。盤の全端子で比べると、
 * その課題で使わないソケットの端子が大量に `missing` として出てくる。
 */

/** 疑いの種別。 */
export type SuspectKind = 'missing' | 'extra';

/** 疑い1件。 */
export interface WiringSuspect {
  kind: SuspectKind;
  /** 関わる2端子（模範回路の出現順）。 */
  terminals: readonly [TerminalId, TerminalId];
  /** その端子を使う回路図上の機器名（重複を除いた出現順）。 */
  devices: readonly string[];
  /** その端子を使う回路図の要素ID（`buildHighlightIndex()` の鍵）。 */
  cellIds: readonly string[];
  /** その2端子のどちらかに繋がっている訓練者の電線ID（3Dで光らせる先）。 */
  wireIds: readonly string[];
  /** 画面にそのまま出せる1行。 */
  message: string;
}

/**
 * 疑いの一覧と、上限で切り捨てた件数。決定表#27
 * 「ほかに N 件」を結果画面が出せるように、**切り捨てた件数まで**返す（一覧の長さだけでは
 * 「5件しか無かった」のか「5件しか出していない」のかが呼び出し側から分からない）。
 */
export interface WiringSuspectReport {
  /** 画面に出す疑い（最大 `MAX_WIRING_SUSPECTS` 件）。 */
  suspects: readonly WiringSuspect[];
  /** 見つかった疑いの総数。 */
  total: number;
  /** 上限で切り捨てた件数（`total - suspects.length`）。 */
  omitted: number;
}

/** 結果画面に出す上限（決定表#27）。 */
export const MAX_WIRING_SUSPECTS = 5;

/** 母線の供給端子（§6.1: P/N は各1点）。 */
const BUS_P_TERMINAL = terminalId('P', '1');
const BUS_N_TERMINAL = terminalId('N', '1');
const BUS_TERMINALS: readonly TerminalId[] = [BUS_P_TERMINAL, BUS_N_TERMINAL];

/** 端子 → 回路図の機器名（母線は `P` / `N`）。 */
function deviceIndex(cells: readonly CellAssignment[]): Map<TerminalId, string> {
  const out = new Map<TerminalId, string>();
  for (const cell of cells) {
    for (const id of [cell.left, cell.right]) if (!out.has(id)) out.set(id, cell.device);
  }
  out.set(BUS_P_TERMINAL, 'P');
  out.set(BUS_N_TERMINAL, 'N');
  return out;
}

/** 端子 → その端子を使う回路図要素ID（出現順）。 */
function cellIndex(cells: readonly CellAssignment[]): Map<TerminalId, string[]> {
  const out = new Map<TerminalId, string[]>();
  for (const cell of cells) {
    for (const id of [cell.left, cell.right]) {
      out.set(id, [...(out.get(id) ?? []), cell.cellId]);
    }
  }
  return out;
}

/** 見張る端子（回路図の要素が使う端子 ＋ 母線の供給端子。模範回路の出現順）。 */
function watchedTerminals(cells: readonly CellAssignment[]): TerminalId[] {
  const out: TerminalId[] = [];
  for (const cell of cells) {
    for (const id of [cell.left, cell.right]) if (!out.includes(id)) out.push(id);
  }
  for (const bus of BUS_TERMINALS) if (!out.includes(bus)) out.push(bus);
  return out;
}

/**
 * 端子の節点番号。そのネットリストに無い端子は `undefined`。
 * 盤に無い端子（課題が使わないソケットの役割）でも落ちないようにする。
 */
function nodeOf(nets: Nets, id: TerminalId): number | undefined {
  return nets.hasTerminal(id) ? nets.nodeOf(id) : undefined;
}

/** 節点番号ごとに端子をまとめる（`undefined` の端子は除く）。 */
function groupByNode(nets: Nets, terminals: readonly TerminalId[]): Map<number, TerminalId[]> {
  const out = new Map<number, TerminalId[]>();
  for (const id of terminals) {
    const node = nodeOf(nets, id);
    if (node === undefined) continue;
    out.set(node, [...(out.get(node) ?? []), id]);
  }
  return out;
}

/**
 * その2端子のどちらかに繋がっている訓練者の電線（3Dで光らせる）。
 * `locked` な既設固定配線（チェック用回路。`fw-chk-*` など。§6.3）は除く。訓練者は変更できない
 * 電線なので、光らせても直しようがなく誤解を招く（I3）。
 */
function wiresTouching(session: BoardSession, pair: readonly TerminalId[]): string[] {
  return session.wires
    .filter((w) => !w.locked && (pair.includes(w.from) || pair.includes(w.to)))
    .map((w) => w.id);
}

/** 疑い1件を組み立てる。 */
function makeSuspect(
  kind: SuspectKind,
  a: TerminalId,
  b: TerminalId,
  devices: ReadonlyMap<TerminalId, string>,
  cells: ReadonlyMap<TerminalId, string[]>,
  session: BoardSession,
): WiringSuspect {
  const deviceA = devices.get(a) ?? a;
  const deviceB = devices.get(b) ?? b;
  const names = [...new Set([deviceA, deviceB])];
  const message =
    kind === 'missing'
      ? `${a}（${deviceA}）と ${b}（${deviceB}）がつながっていません`
      : `${a}（${deviceA}）と ${b}（${deviceB}）が余計につながっています`;
  return {
    kind,
    terminals: [a, b],
    devices: names,
    cellIds: [...new Set([...(cells.get(a) ?? []), ...(cells.get(b) ?? [])])],
    wireIds: wiresTouching(session, [a, b]),
    message,
  };
}

/**
 * `nodeOf()` の結果を集合の要素として比べるための鍵。節点番号はそのまま使い、
 * その端子がそのネットリストに無い（`undefined`）ときは**端子ごとに違う印**を返す。
 * 素の `undefined` を鍵にすると、盤に無い端子が2つあるだけで「同じ節点」と誤認して
 * 本物の疑いを1件にまとめて消してしまう（M-f。例: `BZ` を `extraParts` に足していない
 * 訓練者の盤では `BZ.+` も `BZ.-` も無いが、電気的には別の節点である）。
 */
function nodeKeyOf(nets: Nets, id: TerminalId): number | `absent:${TerminalId}` {
  const node = nodeOf(nets, id);
  return node ?? `absent:${id}`;
}

/**
 * ある分割（`from`）のまとまりが、別の分割（`to`）で割れている箇所を挙げる。
 * まとまりの先頭（模範回路の出現順の1つ目）を基準にし、別の節点にいる端子を1つずつ挙げる。
 * 同じ節点に落ちた端子はまとめて1件にするので、4端子が2対2に割れても2件ではなく1件になる。
 */
function splits(
  groups: ReadonlyMap<number, TerminalId[]>,
  other: Nets,
): Array<[TerminalId, TerminalId]> {
  const out: Array<[TerminalId, TerminalId]> = [];
  for (const members of groups.values()) {
    const anchor = members[0];
    if (anchor === undefined || members.length < 2) continue;
    const seen = new Set<number | string>([nodeKeyOf(other, anchor)]);
    for (const id of members.slice(1)) {
      const key = nodeKeyOf(other, id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([anchor, id]);
    }
  }
  return out;
}

/** 接点のピン番号 → 役割クラス（①〜④＝b接点、⑤〜⑧＝a接点、⑨〜⑫＝COM）。範囲外は `undefined`。 */
function contactRoleClass(pin: number): 'nc' | 'no' | 'com' | undefined {
  if (pin >= 1 && pin <= 4) return 'nc';
  if (pin >= 5 && pin <= 8) return 'no';
  if (pin >= 9 && pin <= 12) return 'com';
  return undefined;
}

/**
 * `id` と同じ部品・同じ役割クラス（b接点／a接点／COM）の4組ぶんの端子。§11.3
 * `id` が接点の組のピン（①〜⑫）でなければ空（PB・PL・BZ・母線・コイルの⑬⑭には組が無い）。
 */
function samePartRoleClassTerminals(id: TerminalId): TerminalId[] {
  let parsed;
  try {
    parsed = parseTerminalId(id);
  } catch {
    /* c8 ignore next -- id は TerminalId 型（terminalId() で作った値）なので形式は必ず正しい */
    return [];
  }
  const pin = Number(parsed.name);
  if (!Number.isInteger(pin)) return [];
  const roleClass = contactRoleClass(pin);
  if (roleClass === undefined) return [];
  const base = roleClass === 'nc' ? 0 : roleClass === 'no' ? 4 : 8;
  return [1, 2, 3, 4].map((group) => terminalId(parsed.part, String(base + group)));
}

/**
 * 「組の選び方の違い」（決定表#9b）で出た `missing` の疑いか。RANKING（レビュー#9b）
 * `assignToBoard()` は模範回路の要素の出現順に接点の4組を割り当てるので、訓練者が
 * 電気的に正しいまま別の組へ張ると、節点分割は違って見える。`b` と同じ部品・同じ役割クラスの
 * **別の**組が、訓練者の回路で `a` と同じ節点にいれば、それは配線ミスではなく組の選び方の違い。
 */
function isPairChoiceArtifact(a: TerminalId, b: TerminalId, traineeNets: Nets): boolean {
  const aNode = nodeOf(traineeNets, a);
  if (aNode === undefined) return false;
  return samePartRoleClassTerminals(b).some(
    (candidate) => candidate !== b && nodeOf(traineeNets, candidate) === aNode,
  );
}

/** 何も疑うところが無いときの戻り。 */
const NO_SUSPECTS: WiringSuspectReport = { suspects: [], total: 0, omitted: 0 };

/**
 * 模範回路と訓練者回路の節点分割の差を「疑わしい配線」として返す。UXレビュー #28
 * 模範回路が作れない課題（課題データの誤り。§13 #2）では空の報告を返す——判定そのものが
 * 先に課題エラーで止まるので、結果画面に出すものは無い。
 *
 * **接点の組の違いも出る**（決定表#9b）。`assignToBoard()` は模範回路の要素の出現順に
 * `CR1` の4組（⑨⑤／⑩⑥／⑪⑦／⑫⑧）を割り当てるので、訓練者が別の組へ張ると、
 * 電気的には正しくても節点分割は違う。正規化はしない（画面（`JA.result.suspectNote`）で断る）が、
 * 本物の配線ミスより後ろへ回す（消しはしない。RANKING・レビュー#9b）。
 */
export function wiringSuspects(
  problem: SchematicProblem,
  board: BoardDefinition,
  traineeSession: BoardSession,
): WiringSuspectReport {
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return NO_SUSPECTS;

  const cells = reference.value.cells;
  const watched = watchedTerminals(cells);
  const devices = deviceIndex(cells);
  const cellsAt = cellIndex(cells);

  const referenceNets = buildNets(reference.value.netlist);
  const traineeNets = buildNets(toNetlist(traineeSession, board));

  const missing = splits(groupByNode(referenceNets, watched), traineeNets).map(([a, b]) => ({
    suspect: makeSuspect('missing', a, b, devices, cellsAt, traineeSession),
    artifact: isPairChoiceArtifact(a, b, traineeNets),
  }));
  const extra = splits(groupByNode(traineeNets, watched), referenceNets).map(([a, b]) => ({
    suspect: makeSuspect('extra', a, b, devices, cellsAt, traineeSession),
    artifact: false,
  }));

  // 安定ソート（`Array#sort` はES2019以降のJSエンジンでは安定）：組の選び方の違いだけ後ろへ回す。
  // 件数は変えない（キャップは変わらず MAX_WIRING_SUSPECTS、`omitted` の数え方も変わらない）。
  const ranked = [...missing, ...extra]
    .sort((x, y) => Number(x.artifact) - Number(y.artifact))
    .map((x) => x.suspect);
  const suspects = ranked.slice(0, MAX_WIRING_SUSPECTS);
  return { suspects, total: ranked.length, omitted: ranked.length - suspects.length };
}
