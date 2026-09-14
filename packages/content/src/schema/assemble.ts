import { z } from 'zod';
import { ProblemHeaderShape, TerminalIdSchema } from './common.js';
import { JudgeSettingsSchema } from './judge.js';
import { DurationMsSchema, lastOperationMs, OperationListSchema } from './operations.js';
import { SchematicDocumentSchema } from './schematic.js';

/**
 * モードB(回路組立)の課題本体。設計仕様 §7.1〜§7.4 / §8。
 * Phase 1 が実装するのはこのモードだけである(§16)。他モードの本体スキーマは
 * `inspect-parts` / `inspect-repair` を Phase 2、`plc` を Phase 3 で定義する(範囲決定)。
 */

/** ヒント表示。回路図の初期表示状態。§8.4 */
export const HintsSchema = z.object({
  schematicVisible: z.boolean(),
});

/** ヒント表示。 */
export type Hints = z.infer<typeof HintsSchema>;

/** モードB課題。§7.1〜§7.4 */
export const AssembleProblemSchema = z
  .object({
    ...ProblemHeaderShape,
    mode: z.literal('assemble'),
    schematic: SchematicDocumentSchema,
    physicalOverride: z
      .record(z.string().min(1), z.tuple([TerminalIdSchema, TerminalIdSchema]))
      .optional(),
    operations: OperationListSchema,
    durationMs: DurationMsSchema,
    judge: JudgeSettingsSchema,
    hints: HintsSchema,
  })
  .superRefine((problem, ctx) => {
    const last = lastOperationMs(problem.operations);
    if (problem.durationMs < last) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: `判定区間長(${problem.durationMs}ms)が最後の操作(${last}ms)より短いです`,
      });
    }
    if (problem.grade === 1 && problem.hints.schematicVisible) {
      ctx.addIssue({
        code: 'custom',
        path: ['hints', 'schematicVisible'],
        message: '1級の課題では回路図を表示しません(§8.4)',
      });
    }
  });

/** モードB課題。 */
export type AssembleProblem = z.infer<typeof AssembleProblemSchema>;
