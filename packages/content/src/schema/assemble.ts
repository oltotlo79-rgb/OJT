import { TICK_MS } from '@ojt/circuit-sim';
import { z } from 'zod';
import { ProblemHeaderShape, TerminalIdSchema } from './common.js';
import { JudgeSettingsSchema } from './judge.js';
import { DurationMsSchema, lastOperationMs, OperationListSchema } from './operations.js';
import { SchematicDocumentSchema } from './schematic.js';

/**
 * モードB（回路組立）の課題本体。設計仕様 §7.1〜§7.4 / §8。
 * Phase 1 が実装するのはこのモードだけである（§16）。他モードの本体スキーマは
 * `inspect-parts` / `inspect-repair` を Phase 2、`plc` を Phase 3 で定義する（範囲決定）。
 */

/** ヒント表示。回路図の初期表示状態。§8.4 */
export const HintsSchema = z.strictObject({
  schematicVisible: z.boolean(),
});

/** ヒント表示。 */
export type Hints = z.infer<typeof HintsSchema>;

/** モードB課題。§7.1〜§7.4 */
export const AssembleProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('assemble').describe('課題モード。回路組立は `assemble`。'),
    schematic: SchematicDocumentSchema.describe('模範回路の展開接続図。判定の正解の源です。'),
    physicalOverride: z
      .record(z.string().min(1), z.tuple([TerminalIdSchema, TerminalIdSchema]))
      .optional()
      .describe('回路図の要素IDごとに、割り当てる物理端子2つを指定して既定の割当を上書きします。'),
    operations: OperationListSchema.describe(
      '判定で再生する押ボタン操作列（`t` は判定開始からのミリ秒で非減少）。',
    ),
    durationMs: DurationMsSchema.describe(
      '判定区間の長さ[ms]。タイムチャートの横軸長でもあります。',
    ),
    judge: JudgeSettingsSchema.describe('比較する信号・許容差・静的チェックの設定。'),
    hints: HintsSchema.describe('ヒント表示の設定（回路図の初期表示）。'),
  })
  .superRefine((problem, ctx) => {
    const last = lastOperationMs(problem.operations);
    // 再生ループは `t < durationMs` なので、判定区間が最後の操作と同じ長さだと
    // その操作が1度も適用されないまま終わる。必ず1tick以上の余裕を要求する。§7.3
    if (problem.durationMs < last + TICK_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: `判定区間長（${problem.durationMs}ms）は最後の操作（${last}ms）より少なくとも1tick（${TICK_MS}ms）長くする必要があります`,
      });
    }
    if (problem.hints.schematicVisible !== (problem.grade === 3)) {
      ctx.addIssue({
        code: 'custom',
        path: ['hints', 'schematicVisible'],
        message: '回路図の初期表示は 3級のみ true（2級・1級は false）です（§8.4）',
      });
    }
  });

/** モードB課題。 */
export type AssembleProblem = z.infer<typeof AssembleProblemSchema>;
