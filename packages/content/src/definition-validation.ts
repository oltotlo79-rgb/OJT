import { buildInspectRepairCircuit } from './inspect-repair.js';
import { JIPM_BOARD } from '@ojt/board-model';
import { continuity, measureResistance, Simulation } from '@ojt/circuit-sim';
import { getDialect } from '@ojt/plc-dialects';
import { rangeLabel, timerRangeFor } from '@ojt/schematic-core';
import {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  CHECK_PART_ID,
  checkContactTerminals,
  checkSettleMs,
  expectedCheckReading,
} from './inspect-parts.js';
import { judgePlcReference } from './judge-plc.js';
import { judgeReference } from './judge.js';
import type { InspectPartData, InspectPartsProblem } from './schema/inspect-parts.js';
import type { PlcProblem } from './schema/plc.js';
import {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
  parseProblem,
  type SupportedProblem,
} from './schema/index.js';
import type { SchematicProblem } from './reference.js';
import { startsAndEndsLow } from './timechart.js';

function headline(problem: SupportedProblem): string {
  const tags = problem.tags.length === 0 ? 'テーマなし' : problem.tags.join('・');
  return `${problem.grade}級・難しさ${problem.difficulty}・${tags}`;
}

/**
 * 模範回路（モードB／モードC2）のタイマ設定が、実機のタイマレンジに収まるか。§5.3.2
 * レンジの選び方も表示名も `@ojt/schematic-core` の `timerRangeFor()` / `rangeLabel()` が
 * 唯一の源なので、ここでは呼ぶだけで刻みや上限を書き写さない。
 */
function timerNotes(problem: SchematicProblem, reasons: string[]): string {
  const notes: string[] = [];
  for (const rung of problem.schematic.rungs) {
    for (const cell of rung.cells) {
      if (cell.kind !== 'coil' || !cell.device.startsWith('T')) continue;
      const presetMs = cell.presetMs;
      if (presetMs === undefined) {
        reasons.push(`タイマ ${cell.device} に設定時間がありません`);
        continue;
      }
      const range = timerRangeFor(presetMs);
      if (range === undefined) {
        reasons.push(`タイマ ${cell.device} の設定 ${presetMs}ms はどのレンジにも収まりません`);
        continue;
      }
      notes.push(`${cell.device}=${presetMs}ms(${rangeLabel(range)})`);
    }
  }
  return notes.join(' ');
}

/**
 * 模範回路（モードB／モードC2／モードD）の判定結果を理由の言葉に直す。
 * モードBとモードDの判定結果は別の型だが、ここで使う3つの欄は同じ形なので構造で受ける。
 */
function judgeReasons(
  outcome: ReturnType<typeof judgeReference> | ReturnType<typeof judgePlcReference>,
  reasons: string[],
): void {
  if (!outcome.ok) {
    for (const issue of outcome.errors) reasons.push(`${issue.path}: ${issue.message}`);
    return;
  }
  for (const mismatch of outcome.value.mismatches) {
    reasons.push(`模範回路が自分の操作列で合いません（${mismatch.signal} ${mismatch.tMs}ms）`);
  }
  for (const check of outcome.value.staticChecks) {
    if (!check.ok) reasons.push(`自動チェック「${check.id}」に引っかかります: ${check.message}`);
  }
  if (!startsAndEndsLow(outcome.value.charts.expected)) {
    reasons.push('タイムチャートの始まりか終わりが論理0になっていません（§7.3）');
  }
}

/** §9.1 の手順どおりに部品1個を点検したときの実測値。 */
function measure(problem: InspectPartsProblem, part: InspectPartData) {
  const built = buildCheckCircuit(problem, JIPM_BOARD, part.id);
  if (!built.ok) return undefined;
  const pins = checkContactTerminals(built.value.group);
  const sim = new Simulation(built.value.netlist);
  sim.setBreaker(true);
  sim.setSwitch(true);
  sim.run(100);
  const coil = measureResistance(sim, CHECK_COIL_MINUS, CHECK_COIL_PLUS);
  const aClosedOff = continuity(sim, pins.com, pins.no).conductive;
  const bClosedOff = continuity(sim, pins.com, pins.nc).conductive;
  sim.press('PB4');
  sim.run(sim.tMs + checkSettleMs(part.kind));
  const state = sim.state();
  return {
    picksUp:
      part.kind === 'timer-h3y4'
        ? (state.timers[CHECK_PART_ID]?.timedOut ?? false)
        : (state.relays[CHECK_PART_ID]?.contactsOn ?? false),
    coilOhms: coil.overRange ? null : coil.ohms,
    aClosedOff,
    bClosedOff,
    aClosedOn: continuity(sim, pins.com, pins.no).conductive,
    bClosedOn: continuity(sim, pins.com, pins.nc).conductive,
  };
}

/**
 * モードC1の自己整合: トレイの各部品を §9.1 の手順で点検した実測値が、
 * 判定表（`expectedCheckReading()`）の読値と一致するか。
 * ここがずれる課題は「正解が測れない」課題であり、訓練者は永久に当てられない。
 */
function checkInspectParts(problem: InspectPartsProblem, reasons: string[]): string {
  for (const part of problem.parts) {
    const actual = measure(problem, part);
    if (actual === undefined) {
      reasons.push(`部品 ${part.id} のチェック用回路を組めません`);
      continue;
    }
    const expected = expectedCheckReading(part);
    for (const key of ['picksUp', 'aClosedOff', 'aClosedOn', 'bClosedOff', 'bClosedOn'] as const) {
      if (actual[key] !== expected[key]) {
        reasons.push(`部品 ${part.id}（${part.truth}）の ${key} が判定表と違います`);
      }
    }
    const wantsOhms = expected.coilOhms === null;
    if (wantsOhms !== (actual.coilOhms === null)) {
      reasons.push(`部品 ${part.id}（${part.truth}）のコイル抵抗が判定表と違います`);
    }
  }
  return `部品${problem.parts.length}個`;
}

/**
 * モードDの自己整合: 模範ラダーが**その機種の方言で書ける値**だけを使っているか。§10.5 / §10.8
 * タイマ設定値の刻みと上限・デバイス番号の範囲は方言プロファイル（`@ojt/plc-dialects`）だけが
 * 知っているので、この道具は `validate()` を呼ぶだけで範囲を書き写さない。
 */
function checkPlcDialect(problem: PlcProblem): string[] {
  const profile = getDialect(problem.plc.vendor);
  return profile.validate(problem.referenceLadder).map((error) => `模範ラダー: ${error.message}`);
}

/** 課題ファイル1件を検査する。 */

export interface DefinitionValidation {
  id: string | undefined;
  note: string;
  reasons: string[];
}
/** CLIと配布アプリで共通のスキーマ・機種能力・模範自己判定。 */
export function validateDefinition(json: unknown): DefinitionValidation {
  const result: DefinitionValidation = { id: undefined, note: '', reasons: [] };
  const parsed = parseProblem(json);
  if (!parsed.ok) {
    result.id = parsed.id;
    result.reasons.push(parsed.message);
    for (const issue of parsed.issues) result.reasons.push(`${issue.path}: ${issue.message}`);
    return result;
  }
  const problem = parsed.problem;
  result.id = problem.id;
  result.note = headline(problem);

  if (isAssembleProblem(problem) || isInspectRepairProblem(problem)) {
    const timers = timerNotes(problem, result.reasons);
    if (timers !== '') result.note += ` / ${timers}`;
    judgeReasons(judgeReference(problem, JIPM_BOARD), result.reasons);
    if (isInspectRepairProblem(problem)) {
      const broken = buildInspectRepairCircuit(problem, JIPM_BOARD, { seed: 1 });
      if (!broken.ok)
        result.reasons.push(...broken.errors.map((error) => `${error.path}: ${error.message}`));
    }
  } else if (isPlcProblem(problem)) {
    result.reasons.push(...checkPlcDialect(problem));
    judgeReasons(judgePlcReference(problem, JIPM_BOARD), result.reasons);
  } else if (isInspectPartsProblem(problem)) {
    result.note += ` / ${checkInspectParts(problem, result.reasons)}`;
  }
  return result;
}
