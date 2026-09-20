import type { BoardSession, SocketId } from '@ojt/board-model';
import type { FaultReport, FaultReportKind, RepairCircuit } from '@ojt/content';
import {
  LOCKED_WIRE_MESSAGE,
  type PickAction,
  type PickHit,
  type ReportTarget,
} from './interaction.js';

/**
 * モードC2（回路点検・修復）の純粋な下ごしらえ。設計仕様 §9.2。
 * React も three も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 */

/**
 * その対象で選べる指摘の種別。§9.2 / Plan 2A 意図的な差分 #6
 * - **電線**: 見えているので断線・誤配線を指せる
 * - **端子**: 未配線（電線そのものが無い）はここでしか指せない
 * - **部品**: 部品不良（どの要素かは問わない）
 */
export function reportKindsFor(target: ReportTarget): FaultReportKind[] {
  if ('wireId' in target) return ['wire-open', 'wire-misrouted'];
  if ('terminalId' in target) return ['wire-missing'];
  return ['part-defect'];
}

/** 2つの対象が同じ場所を指しているか。 */
function sameTarget(a: ReportTarget, b: ReportTarget): boolean {
  if ('wireId' in a) return 'wireId' in b && a.wireId === b.wireId;
  if ('terminalId' in a) return 'terminalId' in b && a.terminalId === b.terminalId;
  return 'partId' in b && a.partId === b.partId;
}

/**
 * 同じ対象・同じ種別の指摘が既にあるか。§9.2
 * `scoreReports()`（Plan 2A）は1つの指摘を1つの故障にしか使わないので、同じ指摘を2回出すと
 * 2件目がそのまま「過剰指摘」になって不合格になる。**操作の取りこぼしで落とさない**ために、
 * 登録の時点で断る。
 */
export function hasReportFor(
  reports: readonly FaultReport[],
  target: ReportTarget,
  kind: FaultReportKind,
): boolean {
  return reports.some((report) => report.kind === kind && sameTarget(report.target, target));
}

/**
 * 指摘モードのピック結果を操作に変換する。§9.2
 * - 電線: 種別ポップオーバーを開く（既設配線＝チェック用回路の3本は指摘できない）
 * - 端子: 未配線の指摘を開く
 * - ソケット: 装着済みなら部品不良の指摘を開く（**役割ID**で指す。§6.4）
 * - 押ボタン: 押す（動作を見ながら故障を探すため）
 */
export function reportPickToAction(
  hit: PickHit,
  partIdOf: (socketId: SocketId) => string,
): PickAction {
  switch (hit.kind) {
    case 'wire':
      return hit.locked
        ? { type: 'reject', message: LOCKED_WIRE_MESSAGE }
        : { type: 'openReport', target: { wireId: hit.id } };
    case 'terminal':
      return { type: 'openReport', target: { terminalId: hit.id } };
    case 'socket':
      return hit.occupied
        ? { type: 'openReport', target: { partId: partIdOf(hit.id) } }
        : { type: 'none' };
    case 'pushbutton':
      return { type: 'pressButton', pbId: hit.id };
    // 電源の操作部は2Dの `PowerControls` が受け持つ（`session/tester.ts` の注記と同じ理由）
    case 'empty':
    case 'fixture':
      return { type: 'none' };
  }
}

/**
 * 判定に渡す回路を作る。§9.2
 * `judgeInspectRepair()`（Plan 2A）は `circuit.session` を**訓練者が提出した盤**として読むので、
 * 開始時の盤ではなく「いまの盤」を差し替えて渡す。`applied` / `initialWireIds` / `initialWires` /
 * `cells` は開始時のまま（故障の在処と改造の基準が変わってはいけない）。
 *
 * 部品交換をした回路は `replacePart()`（Plan 2A）を通したものを渡すこと。`applied.partFaults`
 * から交換した部品が落ちるので、判定側の模範との突き合わせでも良品として扱われる。
 */
export function circuitForJudge(circuit: RepairCircuit, session: BoardSession): RepairCircuit {
  return {
    session,
    applied: circuit.applied,
    initialWireIds: circuit.initialWireIds,
    initialWires: circuit.initialWires,
    cells: circuit.cells,
  };
}
