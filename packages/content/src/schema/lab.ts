import { JIPM_BOARD, plcUnitFor } from '@ojt/board-model';
import { TICK_MS } from '@ojt/circuit-sim';
import { z } from 'zod';
import { ProblemHeaderShape } from './common.js';
import {
  DEFAULT_STATIC_CHECKS,
  judgeSettingsWithDefaults,
  PLC_DEFAULT_STATIC_CHECKS,
  type StaticChecksData,
} from './judge.js';
import { OperationListSchema, type Operation } from './operations.js';
import {
  MODEL_OF_VENDOR,
  PlcIoSchema,
  PlcRefSchema,
  resolvePlcIo,
  type PLC_VENDORS,
} from './plc.js';

/**
 * 「回路実験」「PLC実験」の課題（2026-10-08 利用者指示）。
 * 設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md
 *
 * 押ボタンの押し方（操作列）を訓練者が描き、組んだ回路（PLC実験はラダーも）で動かして
 * ランプの動きを見る。正解のランプの動き（`expected`）を描くか取り込めば判定もできる。
 * 他のモードと違い、判定の正解の源は模範回路ではなく**描いたタイムチャート**である。
 * 課題はその場で作って使い、課題ファイルとしては保存しない（利用者の決定 D1）。
 */

/** 実験で描ける入力（盤の押ボタン）。 */
export const LAB_INPUTS = ['PB1', 'PB2', 'PB3', 'PB4'] as const;
/** 実験で見る出力（盤のランプ）。 */
export const LAB_OUTPUTS = ['PL1', 'PL2', 'PL3', 'PL4'] as const;
export type LabInput = (typeof LAB_INPUTS)[number];
export type LabOutput = (typeof LAB_OUTPUTS)[number];

/** タイムチャートの長さの下限・上限・既定[ms]。 */
export const LAB_MIN_DURATION_MS = 2_000;
export const LAB_MAX_DURATION_MS = 60_000;
export const LAB_DEFAULT_DURATION_MS = 10_000;
/** 描くときに吸着する刻み[ms]（0.1秒）。取り込んだ正解は 10ms のまま持つ。 */
export const LAB_DRAW_STEP_MS = 100;

/** 実験の課題ID（その場で作る課題なので種類ごとに1つ）。 */
export const LAB_ASSEMBLE_ID = 'lab-assemble';
export const LAB_PLC_ID = 'lab-plc';

/** 回路実験の静的チェック（線色・未使用部品は見ない。自由に試せるようにする）。 */
export const ASSEMBLE_LAB_STATIC_CHECKS: StaticChecksData = {
  ...DEFAULT_STATIC_CHECKS,
  wireColorRule: false,
  unusedParts: false,
};

/** PLC実験の静的チェック（加えてI/O割付は見ない。自由に割り付けてよい）。 */
export const PLC_LAB_STATIC_CHECKS: StaticChecksData = {
  ...PLC_DEFAULT_STATIC_CHECKS,
  wireColorRule: false,
  unusedParts: false,
  ioAssignment: false,
};

const LabTimeSchema = z
  .int()
  .min(0)
  .refine((v) => v % TICK_MS === 0, { message: `時刻は ${TICK_MS}ms の倍数にします` });

/** 区間 `[from, to)`。 */
export const LabIntervalSchema = z
  .tuple([LabTimeSchema, LabTimeSchema])
  .refine(([from, to]) => from < to, { message: '区間は開始より終了を後にします' });

/** 正解のランプの動き（ランプごとの点灯区間。書かないランプは消灯のまま）。 */
export const LabExpectedSchema = z.array(
  z.strictObject({
    signal: z.enum(LAB_OUTPUTS),
    on: z.array(LabIntervalSchema),
  }),
);
export type LabExpected = z.infer<typeof LabExpectedSchema>;

/** タイムチャートの長さ（2〜60秒、0.1秒単位）。 */
export const LabDurationSchema = z
  .int()
  .min(LAB_MIN_DURATION_MS)
  .max(LAB_MAX_DURATION_MS)
  .refine((v) => v % LAB_DRAW_STEP_MS === 0, { message: '長さは0.1秒単位にします' });

/** 実験のチャート部分（2種類の課題に共通）。 */
interface LabChartFields {
  operations: Operation[];
  durationMs: number;
  expected?: LabExpected | undefined;
  judge: { compareSignals?: string[] | undefined };
}

const INPUT_SET: ReadonlySet<string> = new Set(LAB_INPUTS);
const OUTPUT_SET: ReadonlySet<string> = new Set(LAB_OUTPUTS);

/**
 * 実験のチャートの検査。操作は PB1〜PB4・判定区間内・押ボタンごとに「押す」から交互、
 * 正解はランプの重複なし・区間は昇順で重ならず判定区間内、判定に使うランプは PL1〜PL4。
 */
function checkLabChart(problem: LabChartFields, ctx: z.RefinementCtx): void {
  const pressed = new Map<string, { pressed: boolean; atMs: number }>();
  problem.operations.forEach((operation, index) => {
    if (!INPUT_SET.has(operation.target)) {
      ctx.addIssue({
        code: 'custom',
        path: ['operations', index, 'target'],
        message: `実験で描ける押ボタンは ${LAB_INPUTS.join('・')} です`,
      });
      return;
    }
    if (operation.t + TICK_MS > problem.durationMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['operations', index, 't'],
        message: `操作（${operation.t}ms）は長さ（${problem.durationMs}ms）より前にします`,
      });
    }
    const state = pressed.get(operation.target) ?? { pressed: false, atMs: -1 };
    const pressing = operation.action === 'press';
    if (pressing === state.pressed) {
      ctx.addIssue({
        code: 'custom',
        path: ['operations', index, 'action'],
        message: `${operation.target} は「押す」と「離す」を交互にします`,
      });
    } else if (!pressing && operation.t <= state.atMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['operations', index, 't'],
        message: `${operation.target} は押してから少なくとも ${TICK_MS}ms 後に離します`,
      });
    }
    pressed.set(operation.target, { pressed: pressing, atMs: operation.t });
  });

  const signals = new Set<string>();
  (problem.expected ?? []).forEach((row, rowIndex) => {
    if (signals.has(row.signal)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', rowIndex, 'signal'],
        message: `${row.signal} の正解が2つあります`,
      });
    }
    signals.add(row.signal);
    row.on.forEach(([from, to], index) => {
      if (to > problem.durationMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['expected', rowIndex, 'on', index],
          message: `区間の終わり（${to}ms）が長さ（${problem.durationMs}ms）を超えています`,
        });
      }
      const previous = row.on[index - 1];
      if (previous !== undefined && previous[1] >= from) {
        ctx.addIssue({
          code: 'custom',
          path: ['expected', rowIndex, 'on', index],
          message: '区間は時刻の順に、重ならず間を空けて並べます',
        });
      }
    });
  });

  (problem.judge.compareSignals ?? []).forEach((signal, index) => {
    if (OUTPUT_SET.has(signal)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['judge', 'compareSignals', index],
      message: `判定に使えるランプは ${LAB_OUTPUTS.join('・')} です`,
    });
  });
}

/** 回路実験の課題。 */
export const AssembleLabProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('assemble-lab').describe('課題モード。回路実験は `assemble-lab`。'),
    operations: OperationListSchema.describe('押ボタンの押し方（描いた入力）。'),
    durationMs: LabDurationSchema.describe('タイムチャートの長さ[ms]。'),
    expected: LabExpectedSchema.optional().describe('正解のランプの動き（無ければ実験だけ）。'),
    judge: judgeSettingsWithDefaults(ASSEMBLE_LAB_STATIC_CHECKS).describe('判定の設定。'),
  })
  .superRefine((problem, ctx) => {
    checkLabChart(problem, ctx);
  });
export type AssembleLabProblem = z.infer<typeof AssembleLabProblemSchema>;

/** PLC実験の課題。 */
export const PlcLabProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('plc-lab').describe('課題モード。PLC実験は `plc-lab`。'),
    plc: PlcRefSchema.describe('使うPLCのメーカーと機種。'),
    io: PlcIoSchema.describe('I/O割付（実験では自由に割り付けてよい）。'),
    prewired: z.boolean().describe('盤とPLCの配線を済ませた（固定電線の）状態で始めるか。'),
    operations: OperationListSchema.describe('押ボタンの押し方（描いた入力）。'),
    durationMs: LabDurationSchema.describe('タイムチャートの長さ[ms]。'),
    expected: LabExpectedSchema.optional().describe('正解のランプの動き（無ければ実験だけ）。'),
    judge: judgeSettingsWithDefaults(PLC_LAB_STATIC_CHECKS).describe('判定の設定。'),
  })
  .superRefine((problem, ctx) => {
    checkLabChart(problem, ctx);
    const unit = plcUnitFor(problem.plc.model);
    if (unit === undefined) return;
    const io = resolvePlcIo(problem.io);
    io.inputs.forEach((input, index) => {
      if (input.x < unit.spec.inputs.length) return;
      ctx.addIssue({
        code: 'custom',
        path: ['io', 'inputs', index, 'x'],
        message: `${problem.plc.model} の入力は ${unit.spec.inputs.length} 点です`,
      });
    });
    io.outputs.forEach((output, index) => {
      if (output.y < unit.spec.outputs.length) return;
      ctx.addIssue({
        code: 'custom',
        path: ['io', 'outputs', index, 'y'],
        message: `${problem.plc.model} の出力は ${unit.spec.outputs.length} 点です`,
      });
    });
  });
export type PlcLabProblem = z.infer<typeof PlcLabProblemSchema>;

/** 実験の課題（2種類）。 */
export type LabProblem = AssembleLabProblem | PlcLabProblem;

/** 実験のチャートで差し替えてよい項目。 */
export interface LabChartInit {
  operations?: Operation[];
  durationMs?: number;
  expected?: LabExpected | undefined;
}

const LAB_TIME_LIMIT = { standardMin: 60, cutoffMin: 120 } as const;

function chartFields(init: LabChartInit): Pick<LabChartFields, 'operations' | 'durationMs'> & {
  expected?: LabExpected;
} {
  return {
    operations: [...(init.operations ?? [])],
    durationMs: init.durationMs ?? LAB_DEFAULT_DURATION_MS,
    ...(init.expected === undefined ? {} : { expected: structuredClone(init.expected) }),
  };
}

/** 回路実験の課題を作る（標準盤・リレー4個・タイマ2個）。 */
export function createAssembleLabProblem(init: LabChartInit = {}): AssembleLabProblem {
  return {
    formatVersion: 1,
    id: LAB_ASSEMBLE_ID,
    title: '回路実験',
    grade: 3,
    difficulty: 3,
    tags: [],
    description:
      '押ボタンの押し方をタイムチャートに描いて「動かす」と、組んだ回路でランプがどう動くかを見られます。正解のランプの動きを描くか、動かした結果を取り込むと「判定」できます。',
    timeLimit: { ...LAB_TIME_LIMIT },
    board: {
      boardId: JIPM_BOARD.id,
      socketRoles: { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S5: 'T1', S6: 'T2', S7: 'CHK' },
    },
    inventory: [
      { kind: 'relay-my4n', count: 4 },
      { kind: 'timer-h3y4', count: 2 },
    ],
    mode: 'assemble-lab',
    ...chartFields(init),
    judge: {
      tolerance: { edgeMs: 200, ratio: 0.1 },
      staticChecks: { ...ASSEMBLE_LAB_STATIC_CHECKS },
    },
  };
}

/** PLC実験の課題を作る（PB1〜PB4→入力0〜3、出力0〜3→CR1〜CR4→PL1〜PL4）。 */
export function createPlcLabProblem(
  options: { vendor: (typeof PLC_VENDORS)[number]; prewired: boolean } & LabChartInit,
): PlcLabProblem {
  return {
    formatVersion: 1,
    id: LAB_PLC_ID,
    title: 'PLC実験',
    grade: 2,
    difficulty: 3,
    tags: [],
    description:
      'ラダーを組み、押ボタンの押し方をタイムチャートに描いて「動かす」と、ランプがどう動くかを見られます。正解のランプの動きを描くか、動かした結果を取り込むと「判定」できます。',
    timeLimit: { ...LAB_TIME_LIMIT },
    board: {
      boardId: JIPM_BOARD.id,
      socketRoles: { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S7: 'CHK' },
    },
    inventory: [{ kind: 'relay-my4n', count: 4 }],
    mode: 'plc-lab',
    plc: { vendor: options.vendor, model: MODEL_OF_VENDOR[options.vendor] },
    io: {
      mode: 'free',
      wiring: 'sink',
      inputs: [
        { x: 0, pb: 'PB1' },
        { x: 1, pb: 'PB2' },
        { x: 2, pb: 'PB3' },
        { x: 3, pb: 'PB4' },
      ],
      outputs: [
        { y: 0, cr: 'CR1', pl: 'PL1' },
        { y: 1, cr: 'CR2', pl: 'PL2' },
        { y: 2, cr: 'CR3', pl: 'PL3' },
        { y: 3, cr: 'CR4', pl: 'PL4' },
      ],
    },
    prewired: options.prewired,
    ...chartFields(options),
    judge: {
      tolerance: { edgeMs: 200, ratio: 0.1 },
      staticChecks: { ...PLC_LAB_STATIC_CHECKS },
    },
  };
}
