import type { BoardDefinition } from '@ojt/board-model';
import type { SignalLog } from '@ojt/circuit-sim';
import { expectedFromChart, labChartSignals, type LabTemplate } from './lab-chart.js';
import { runPlcOperations } from './plc-io.js';
import { buildPlcReferenceSession } from './plc-reference.js';
import { buildReferenceSession } from './reference.js';
import { runOperations } from './runner.js';
import type { AssembleProblem } from './schema/assemble.js';
import { isAssembleProblem, isPlcProblem, type SupportedProblem } from './schema/index.js';
import {
  AssembleLabProblemSchema,
  createAssembleLabProblem,
  LAB_DRAW_STEP_MS,
  LAB_MAX_DURATION_MS,
  LAB_MIN_DURATION_MS,
} from './schema/lab.js';
import type { LabMode } from './schema/common.js';
import type { PlcProblem } from './schema/plc.js';
import { buildTimeChart } from './timechart.js';

/**
 * 実験の例題を内蔵課題の模範から作る（2026-10-08）。設計 §4.3
 *
 * 例題は「元の課題の操作で模範回路（PLCは模範配線＋模範ラダー）を動かしたときのランプの動き」を
 * 正解として持つ。生成物 `lab-templates.ts` は `scripts/build-lab-templates.mjs` が書き、
 * テスト（`test/lab-templates.test.ts`）がこの関数の結果と一致することを確かめる。
 */

/** 例題1つの元。 */
export interface LabTemplateSource {
  id: string;
  title: string;
  /** 回路実験の元にする組立課題と、その説明。 */
  assemble: { problem: string; description: string };
  /** PLC実験の元にするPLC課題と、その説明。 */
  plc: { problem: string; description: string };
}

/** 例題の元（並びが例題の並び）。 */
export const LAB_TEMPLATE_SOURCES: readonly LabTemplateSource[] = [
  {
    id: 'self-hold',
    title: '自己保持（運転・停止）',
    assemble: {
      problem: 'b-001',
      description: 'PB1を押すとPL1が点灯し、離しても点灯が続きます。PB2を押すと消えます。',
    },
    plc: {
      problem: 'd-001',
      description:
        'PB1で運転を始め（PL1が点灯したまま）、PB2で止めます。PB2を押している間、運転していなければPL2が点灯し、PB3を押している間だけPL3が点灯します。',
    },
  },
  {
    id: 'interlock',
    title: 'インターロック（先行優先）',
    assemble: {
      problem: 'b-002',
      description:
        'PB1でPL1、PB2でPL2が点灯したままになります。先に点灯した側が優先し、もう一方は点灯しません。PB3で両方消えます。',
    },
    plc: {
      problem: 'd-002',
      description:
        'PB1で正転（PL1）、PB2で逆転（PL2）し、PB3で止めます。動いている間はもう一方を入れられません。PB3を押している間、どちらも動いていなければPL3が点灯します。',
    },
  },
  {
    id: 'on-delay',
    title: 'オンディレー（遅れて点灯）',
    assemble: {
      problem: 'b-003',
      description:
        'PB1を押してから3秒後にPL1が点灯します。PB2で消えます（タイマ T1 を3秒に設定します）。',
    },
    plc: {
      problem: 'd-003',
      description:
        'PB1で起動し、3秒後にPL1が点灯します。計時中はPL2が点灯し、PB2で止めます。PB3を押している間だけPL3が点灯します。',
    },
  },
  {
    id: 'one-shot',
    title: 'ワンショット（一定時間点灯）',
    assemble: {
      problem: 'b-005',
      description:
        'PB1を押すとPL1が1.5秒だけ点灯して自動的に消えます。消えた後にもう一度押すと、同じように点灯します。',
    },
    plc: {
      problem: 'd-004',
      description:
        'PB1を押した瞬間から1秒間だけPL1が点灯します。長押ししても1秒で消え、PB2を押している間は起動しません。PB3を押している間はPL2が点灯し、PL3は1秒ごとに点滅します。',
    },
  },
];

/** 実験の長さに丸める（0.1秒単位へ切り上げ、2〜60秒に収める）。 */
export function labDurationOf(durationMs: number): number {
  const rounded = Math.ceil(durationMs / LAB_DRAW_STEP_MS) * LAB_DRAW_STEP_MS;
  return Math.min(LAB_MAX_DURATION_MS, Math.max(LAB_MIN_DURATION_MS, rounded));
}

/** 模範を元の操作で動かしたログ。 */
function referenceLog(
  problem: AssembleProblem | PlcProblem,
  board: BoardDefinition,
  durationMs: number,
): SignalLog {
  if (isAssembleProblem(problem)) {
    const reference = buildReferenceSession(problem, board);
    if (!reference.ok) throw new Error(`${problem.id}: ${JSON.stringify(reference.errors)}`);
    return runOperations(reference.value.netlist, problem.operations, { durationMs }).log;
  }
  const reference = buildPlcReferenceSession(problem, board);
  if (!reference.ok) throw new Error(`${problem.id}: ${JSON.stringify(reference.errors)}`);
  return runPlcOperations(reference.value.netlist, reference.value.program, problem.operations, {
    durationMs,
    outputCount: reference.value.unit.spec.outputs.length,
  }).log;
}

/** 例題1つを作る。元の課題が見つからない・実験の形にならないときは投げる（生成時に止める）。 */
function buildLabTemplate(
  source: LabTemplateSource,
  mode: LabMode,
  findProblem: (id: string) => SupportedProblem | undefined,
  board: BoardDefinition,
): LabTemplate {
  const origin = mode === 'assemble-lab' ? source.assemble : source.plc;
  const problem = findProblem(origin.problem);
  if (problem === undefined) throw new Error(`例題の元 ${origin.problem} が見つかりません`);
  if (!isAssembleProblem(problem) && !isPlcProblem(problem)) {
    throw new Error(`${problem.id}: 例題の元は組立課題かPLC課題にしてください`);
  }
  const durationMs = labDurationOf(problem.durationMs);
  const log = referenceLog(problem, board, durationMs);
  const expected = expectedFromChart(buildTimeChart(log, labChartSignals(), durationMs));
  const template: LabTemplate = {
    id: source.id,
    mode,
    title: source.title,
    description: origin.description,
    source: origin.problem,
    operations: problem.operations.map((operation) => ({ ...operation })),
    durationMs,
    expected,
  };
  const parsed = AssembleLabProblemSchema.safeParse(createAssembleLabProblem(template));
  if (!parsed.success) {
    throw new Error(`例題 ${mode}/${source.id}: ${JSON.stringify(parsed.error.issues)}`);
  }
  return template;
}

/** 例題をすべて作る（回路実験の4題 → PLC実験の4題）。 */
export function buildLabTemplates(
  findProblem: (id: string) => SupportedProblem | undefined,
  board: BoardDefinition,
): LabTemplate[] {
  return (['assemble-lab', 'plc-lab'] as const).flatMap((mode) =>
    LAB_TEMPLATE_SOURCES.map((source) => buildLabTemplate(source, mode, findProblem, board)),
  );
}
