import { toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import type { Netlist, Wire, WireColor } from '@ojt/circuit-sim';
import type { CellAssignment } from '@ojt/schematic-core';
import { applyFaults, injectPartFaults, withoutPartFaults, type AppliedFaults } from './faults.js';
import {
  resolveFaults,
  type ResolveFaultsOptions,
  type ResolveFaultsResult,
} from './random-faults.js';
import { buildReferenceSession } from './reference.js';
import type { FaultSpecData } from './schema/faults.js';
import type { InspectRepairProblem } from './schema/inspect-repair.js';
import type { ProblemIssue } from './schema/index.js';

/**
 * モードC2（回路点検・修復）のドメイン。設計仕様 §9.2。
 * 模範回路を**青**で組んでから故障を注入し、パレットを**白のみ**に差し替えて訓練者へ渡す。
 * 判定に必要な「初期状態にあった電線ID」と「故障の在処」をここで確定させる。
 */

/** 初期配線の色（＝模範回路の色）。§8.1 / §11.3 */
export const INITIAL_WIRE_COLOR: WireColor = '青';
/** 修復に使える唯一の色。§8.1 / §9.2 */
export const REPAIR_WIRE_COLOR: WireColor = '白';

/** 故障を注入した初期盤。 */
export interface RepairCircuit {
  /** 訓練者に渡す盤（故障適用済み・パレットは白のみ）。 */
  session: BoardSession;
  /** 振り分けた故障（部品の故障はネットリスト変換のたびに注入し直す）。 */
  applied: AppliedFaults;
  /** 故障適用直後の電線ID（改造と白線ルールの基準）。 */
  initialWireIds: readonly string[];
  /**
   * 故障適用直後の電線のスナップショット（`id` に加え `from` / `to` / `color` を持つ）。
   * 修復で外した電線は `session.wires` から消えるため、後から画面に出す表示名
   * （`wireLabel()` の「CR1.9–PB1.2c の青線」）を組み立てるにはここを引く（UI監査 I5）。
   */
  initialWires: readonly Wire[];
  /** 回路図の要素 → 物理端子の対応（連動ハイライト用）。§9.2 */
  cells: readonly CellAssignment[];
}

/** 構築結果。 */
export type RepairCircuitResult =
  { ok: true; value: RepairCircuit } | { ok: false; errors: ProblemIssue[] };

/** 初期盤の構築オプション。 */
export interface RepairCircuitOptions extends ResolveFaultsOptions {
  /**
   * 解決済みの故障リスト。渡すと `resolveFaults()` を呼び直さない（作業ファイルからの再開。I-4）。
   */
  resolvedFaults?: readonly FaultSpecData[];
}

/**
 * C2の初期盤を作る。§9.2
 * 1. 模範回路を青で組む（＝正しく配線された盤）
 * 2. `faults` を解決する（明示リストならそのまま、ランダムなら seed から引く。§7.5）
 * 3. 故障を適用する（電線はセッションへ、部品はリストへ）
 * 4. パレットを白のみに差し替える（修復は白線だけ。§8.1）
 */
export function buildInspectRepairCircuit(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  options: RepairCircuitOptions = {},
): RepairCircuitResult {
  const built = buildReferenceSession(problem, board);
  if (!built.ok) return built;
  // 作業ファイルからの再開用（I-4）。解決済みの故障配列を渡されたら `resolveFaults()` を
  // 呼び直さない。seed を指定しない課題は `resolveFaults()` が内部で `Date.now()` を使うため、
  // 再解決すると初回と別の故障になってしまう（2Bはresolve結果を作業ファイルへ保存し、
  // 再開時はここへそのまま渡すこと）。
  const faults: ResolveFaultsResult =
    options.resolvedFaults === undefined
      ? resolveFaults(problem, board, options)
      : { ok: true, value: [...options.resolvedFaults], fellBack: false, seed: options.seed };
  if (!faults.ok) return faults;
  const session = built.value.session;
  const applied = applyFaults(session, faults.value, board);
  if (!applied.ok) return applied;
  session.allowedColors = [REPAIR_WIRE_COLOR];
  return {
    ok: true,
    value: {
      session,
      applied: applied.value,
      initialWireIds: session.wires.map((w) => w.id),
      initialWires: session.wires.map((w) => ({ ...w })),
      cells: built.value.cells,
    },
  };
}

/**
 * いまの盤からネットリストを作り、残っている部品の故障を注入する。§5.4
 * 部品を交換した（`replacePart()` を通した）あとは、その部品の故障はもう注入されない。
 */
export function repairNetlist(
  circuit: RepairCircuit,
  board: BoardDefinition,
): { netlist: Netlist; errors: ProblemIssue[] } {
  const netlist = toNetlist(circuit.session, board);
  return { netlist, errors: injectPartFaults(netlist, circuit.applied.partFaults) };
}

/** 部品を良品に交換した回路を返す（元の回路は変えない）。§9.2 部品交換 */
export function replacePart(circuit: RepairCircuit, partId: string): RepairCircuit {
  return { ...circuit, applied: withoutPartFaults(circuit.applied, partId) };
}

/** 故障箇所として認められている電線のID（`wire-open` / `wire-misrouted`）。 */
function faultedWireIds(circuit: RepairCircuit): Set<string> {
  const out = new Set<string>();
  for (const site of circuit.applied.sites) {
    if (site.wireId !== undefined) out.add(site.wireId);
  }
  return out;
}

/**
 * 訓練者が新しく引いた電線のID（初期状態に無かった電線）。§9.2
 * 並びは提出されたセッションの電線順（決定論）。
 */
export function addedWireIds(circuit: RepairCircuit, session: BoardSession): string[] {
  const initial = new Set(circuit.initialWireIds);
  return session.wires.filter((w) => !initial.has(w.id)).map((w) => w.id);
}

/**
 * 改造として計上する電線のID。§9.2
 * 「故障箇所でない青線を削除した」もの、すなわち初期状態にあって提出時に消えていて、
 * 故障箇所（断線・誤配線が入っていた電線）でないものを数える。
 * 故障箇所の電線を外して白線で引き直すのは正規の修復なので数えない。
 */
export function modificationWireIds(circuit: RepairCircuit, session: BoardSession): string[] {
  const present = new Set<string>(session.wires.map((w) => w.id));
  const faulted = faultedWireIds(circuit);
  return circuit.initialWireIds.filter((id) => !present.has(id) && !faulted.has(id));
}
