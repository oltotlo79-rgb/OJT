import { TICK_MS } from '@ojt/circuit-sim';
import { z } from 'zod';
import { HintsSchema } from './assemble.js';
import { ProblemHeaderShape, TerminalIdSchema } from './common.js';
import { FaultsSchema } from './faults.js';
import { JudgeSettingsSchema } from './judge.js';
import { DurationMsSchema, lastOperationMs, OperationListSchema } from './operations.js';
import { SchematicDocumentSchema } from './schematic.js';

/**
 * モードC2（回路点検・修復）の課題。設計仕様 §7.5 / §9.2。
 * 形はモードBと同じ（回路図＋操作列＋判定設定）で、`faults` が加わる。回路図は
 * **模範回路**であり、2級形式では訓練者に提示する回路図でもある（1級形式はタイムチャートのみ）。
 */
export const InspectRepairProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('inspect-repair').describe('課題モード。回路点検・修復は `inspect-repair`。'),
    schematic: SchematicDocumentSchema.describe(
      '基準になる回路（正解）。ここから初期配線を作り、faults を注入します。',
    ),
    physicalOverride: z
      .record(z.string().min(1), z.tuple([TerminalIdSchema, TerminalIdSchema]))
      .optional()
      .describe('回路図の要素IDごとに、割り当てる物理端子2つを指定して既定の割当を上書きします。'),
    faults: FaultsSchema.describe('注入する故障（明示リストまたはランダム指定）。'),
    operations: OperationListSchema.describe(
      '判定で再生する押ボタン操作列（`t` は判定開始からのミリ秒で非減少）。',
    ),
    durationMs: DurationMsSchema.describe(
      '判定区間の長さ[ms]。タイムチャートの横軸長でもあります。',
    ),
    judge: JudgeSettingsSchema.describe('比較する信号・許容差・静的チェックの設定。'),
    hints: HintsSchema.describe('回路図を提示するか（2級形式は true、1級形式は false）。'),
  })
  .superRefine((problem, ctx) => {
    const last = lastOperationMs(problem.operations);
    if (problem.durationMs < last + TICK_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: `判定区間長（${problem.durationMs}ms）は最後の操作（${last}ms）より少なくとも1tick（${TICK_MS}ms）長くする必要があります`,
      });
    }
    if (problem.grade === 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['grade'],
        message: '回路点検・修復は1級・2級の課題です（3級形式はありません）',
      });
    } else if (problem.hints.schematicVisible !== (problem.grade === 2)) {
      ctx.addIssue({
        code: 'custom',
        path: ['hints', 'schematicVisible'],
        message: '回路図の提示は 2級形式のみ true（1級形式はタイムチャートのみ）です（§9.2）',
      });
    }
  });

/** モードC2課題。 */
export type InspectRepairProblem = z.infer<typeof InspectRepairProblemSchema>;
