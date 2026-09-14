import { MAX_LAYER_SHORT_RATIO, MIN_LAYER_SHORT_RATIO } from '@ojt/circuit-sim';
import { z } from 'zod';
import { MountableKindSchema, ProblemHeaderShape } from './common.js';

/**
 * モードC1（部品点検）の課題。設計仕様 §7.5 の「モードC1は別形式」/ §9.1。
 * トレイに並ぶ部品それぞれに「本当の状態」（`truth`）を持たせ、訓練者はチェック用ソケットに
 * 挿して点検し、マークシート風パネルで原因を答える。
 */

/** 部品の本当の状態。正常＋不良6種（調査資料 §6.2 の解答様式と同じ集合）。§7.5 */
export const PART_TRUTHS = [
  'normal',
  'coil-open',
  'coil-layer-short',
  'a-open',
  'a-weld',
  'b-open',
  'b-weld',
] as const;

/** 部品の本当の状態。 */
export const PartTruthSchema = z.enum(PART_TRUTHS);

/** 部品の本当の状態。 */
export type PartTruth = z.infer<typeof PartTruthSchema>;

/** 接点に入れる不良（どの接点組に入れるかを `group` で選べる）。§7.5 */
export const CONTACT_TRUTHS = [
  'a-open',
  'a-weld',
  'b-open',
  'b-weld',
] as const satisfies readonly PartTruth[];

/** その `truth` が接点の不良か。 */
export function isContactTruth(truth: PartTruth): boolean {
  return (CONTACT_TRUTHS as readonly PartTruth[]).includes(truth);
}

/** トレイに並ぶ部品1個。§7.5 */
export const InspectPartSchema = z
  .strictObject({
    id: z.string().min(1).describe('部品の識別子（課題の中で一意）。マークシートの行になります。'),
    kind: MountableKindSchema.describe('部品種別（リレーかタイマ）。'),
    truth: PartTruthSchema.describe('その部品の本当の状態。訓練者の解答と突き合わせます。'),
    ratio: z
      .number()
      .min(MIN_LAYER_SHORT_RATIO)
      .max(MAX_LAYER_SHORT_RATIO)
      .optional()
      .describe('レアショートのコイル抵抗の低下率（省略すると 0.65）。'),
    group: z
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe('接点の不良を入れる組（1〜4）。省略すると課題の seed と部品IDから決めます。'),
  })
  .superRefine((part, ctx) => {
    if (part.ratio !== undefined && part.truth !== 'coil-layer-short') {
      ctx.addIssue({
        code: 'custom',
        path: ['ratio'],
        message: 'ratio は truth が coil-layer-short のときだけ指定できます',
      });
    }
    if (part.truth === 'coil-layer-short' && part.kind === 'timer-h3y4') {
      ctx.addIssue({
        code: 'custom',
        path: ['truth'],
        message: 'タイマにレアショートは出題できません（リレーにだけ出題します）',
      });
    }
    if (part.group !== undefined && !isContactTruth(part.truth)) {
      ctx.addIssue({
        code: 'custom',
        path: ['group'],
        message: 'group は接点の不良（a-open / a-weld / b-open / b-weld）のときだけ指定できます',
      });
    }
  });

/** トレイに並ぶ部品1個。 */
export type InspectPartData = z.infer<typeof InspectPartSchema>;

/**
 * モードC1課題。§7.5 / §9.1
 * `inventory` は空配列でよい（トレイの中身は `parts` が決める）。盤は
 * チェック用ソケット（`S7` = `CHK`）さえ割り当ててあれば足りる。
 */
export const InspectPartsProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('inspect-parts').describe('課題モード。部品点検は `inspect-parts`。'),
    parts: z
      .array(InspectPartSchema)
      .min(2)
      .max(8)
      .describe('トレイに並ぶ部品（2〜8個）。正常と不良を混ぜます。'),
    seed: z
      .int()
      .min(0)
      .default(0)
      .describe('接点の不良をどの組に入れるかを決める種。同じ種からは必ず同じ組になります。'),
  })
  .superRefine((problem, ctx) => {
    const seen = new Set<string>();
    problem.parts.forEach((part, index) => {
      if (seen.has(part.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', index, 'id'],
          message: `部品IDが重複しています: ${part.id}`,
        });
      }
      seen.add(part.id);
    });
  });

/** モードC1課題。 */
export type InspectPartsProblem = z.infer<typeof InspectPartsProblemSchema>;
