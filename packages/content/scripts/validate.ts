import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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
} from '../src/inspect-parts.js';
import { judgePlcReference } from '../src/judge-plc.js';
import { judgeReference } from '../src/judge.js';
import type { InspectPartData, InspectPartsProblem } from '../src/schema/inspect-parts.js';
import type { PlcProblem } from '../src/schema/plc.js';
import {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
  parseProblem,
  type SupportedProblem,
} from '../src/schema/index.js';
import type { SchematicProblem } from '../src/reference.js';
import { startsAndEndsLow } from '../src/timechart.js';

/**
 * 作った課題ファイルを確かめる道具。設計仕様 §16 Phase 7 §4.3（PR-15 の代替）。
 *
 *   pnpm --filter @ojt/content validate <ファイルまたはフォルダ> [...]
 *
 * やることは3段:
 *   1. 形式の検査（`parseProblem()`。項目の過不足・型・値の範囲）
 *   2. モード別の自己整合検査（模範回路を課題自身の操作列にかけて合格するか）
 *   3. タイムチャートの始まりと終わりが論理0か（`startsAndEndsLow()`。§7.3）
 *
 * 出力は課題1件につき1行の日本語。終了コードは**落ちた課題の件数**なので、
 * そのまま他の道具の合否に繋げられる。
 *
 * 判定の規則はどれもアプリ本体と同じ関数（`judgeReference()` / `judgePlcReference()` /
 * `expectedCheckReading()` / `timerRangeFor()`）を呼ぶ。この道具の中に規則を書き写さないので、
 * 本体の規則が変わればこの道具の答えも自動で追随する。
 */

/** 課題1件の検査結果。 */
interface Checked {
  /** 表示に使うファイル名（起動したフォルダからの相対）。 */
  file: string;
  /** 読めたときの課題ID。 */
  id: string | undefined;
  /** 見出しに添える一言（級・難しさ・テーマ、タイマのレンジなど）。 */
  note: string;
  /** 落ちた理由（空なら合格）。 */
  reasons: string[];
}

/** 1行に並べる理由の上限（多すぎると読めないので残りは件数だけ出す）。 */
const MAX_REASONS_PER_LINE = 5;

/** 引数のパスから課題ファイル（`.json`）を集める。フォルダは下の階層まで見る。 */
function collectFiles(target: string): string[] {
  const stat = statSync(target);
  if (!stat.isDirectory()) return [target];
  const out: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(target, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(path));
    else if (entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}

/** 級・難しさ・学習テーマの一言。 */
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
function checkFile(file: string, root: string): Checked {
  const shown = relative(root, file) || file;
  const result: Checked = { file: shown, id: undefined, note: '', reasons: [] };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    result.reasons.push(
      `ファイルを読めません（かっこや点の打ち間違いがあります）: ${(error as Error).message}`,
    );
    return result;
  }
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
  } else if (isPlcProblem(problem)) {
    result.reasons.push(...checkPlcDialect(problem));
    judgeReasons(judgePlcReference(problem, JIPM_BOARD), result.reasons);
  } else if (isInspectPartsProblem(problem)) {
    result.note += ` / ${checkInspectParts(problem, result.reasons)}`;
  }
  return result;
}

/** 1件ぶんの出力行を組み立てる。 */
function lineOf(checked: Checked): string {
  const name = `${checked.file}${checked.id === undefined ? '' : `（${checked.id}）`}`;
  if (checked.reasons.length === 0) {
    return `合格  ${name}  ${checked.note}`.trimEnd();
  }
  const shown = checked.reasons.slice(0, MAX_REASONS_PER_LINE).join(' / ');
  const rest = checked.reasons.length - MAX_REASONS_PER_LINE;
  return `問題  ${name}  ${shown}${rest > 0 ? ` / ほか${rest}件` : ''}`;
}

/** 引数を受け取って検査し、出力行と落ちた件数を返す。 */
function run(targets: readonly string[], root: string): { lines: string[]; failed: number } {
  if (targets.length === 0) {
    return {
      lines: ['使い方: pnpm --filter @ojt/content validate <課題ファイルまたはフォルダ>'],
      failed: 1,
    };
  }
  const lines: string[] = [];
  let failed = 0;
  for (const target of targets) {
    let files: string[];
    try {
      files = collectFiles(target);
    } catch {
      lines.push(`問題  ${target}  そのファイルやフォルダはありません`);
      failed += 1;
      continue;
    }
    if (files.length === 0) lines.push(`（${target} に課題ファイルはありません）`);
    for (const file of files) {
      const checked = checkFile(file, root);
      if (checked.reasons.length > 0) failed += 1;
      lines.push(lineOf(checked));
    }
  }
  lines.push(failed === 0 ? '0 件の問題' : `${failed} 件の問題`);
  return { lines, failed };
}

const outcome = run(process.argv.slice(2), process.cwd());
process.stdout.write(`${outcome.lines.join('\n')}\n`);
process.exitCode = outcome.failed === 0 ? 0 : Math.min(outcome.failed, 125);
