import { TICK_MS } from '@ojt/circuit-sim';
import { z } from 'zod';

/**
 * 操作列。設計仕様 §7.3。
 * `t` は判定開始からのミリ秒で、tick（10ms）の倍数・非減少であることを要求する。
 * 電源投入（ブレーカ→スイッチ）は操作列に書かない。`t=0` で通電済みとする。
 */

/** 操作対象の押ボタン。§5.3.3 */
export const OperationTargetSchema = z.enum(['PB1', 'PB2', 'PB3', 'PB4']);

/** 操作対象。 */
export type OperationTarget = z.infer<typeof OperationTargetSchema>;

/** 操作の種類。§7.3 */
export const OperationActionSchema = z.enum(['press', 'release']);

/** 操作の種類。 */
export type OperationAction = z.infer<typeof OperationActionSchema>;

/** 操作1件。§7.3 */
export const OperationSchema = z.object({
  t: z
    .int()
    .min(0)
    .refine((v) => v % TICK_MS === 0, { message: `操作時刻は ${TICK_MS}ms の倍数にします` }),
  target: OperationTargetSchema,
  action: OperationActionSchema,
});

/** 操作1件。 */
export type Operation = z.infer<typeof OperationSchema>;

/** 操作列（`t` は非減少）。§7.3 */
export const OperationListSchema = z.array(OperationSchema).superRefine((ops, ctx) => {
  for (let i = 1; i < ops.length; i += 1) {
    const previous = ops[i - 1];
    const current = ops[i];
    if (previous === undefined || current === undefined) continue;
    if (current.t < previous.t) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 't'],
        message: `操作列の時刻は非減少にします（${previous.t}ms の次が ${current.t}ms）`,
      });
    }
  }
});

/** 判定区間の長さ[ms]。タイムチャートの横軸長でもある。§7.3 */
export const DurationMsSchema = z
  .int()
  .min(TICK_MS)
  .max(600_000)
  .refine((v) => v % TICK_MS === 0, { message: `判定区間長は ${TICK_MS}ms の倍数にします` });

/** その押ボタンが `tMs` 時点で押されているか(操作列を畳んで求める)。 */
export function pressedAt(
  operations: readonly Operation[],
  target: OperationTarget,
  tMs: number,
): boolean {
  let pressed = false;
  for (const op of operations) {
    if (op.t > tMs) break;
    if (op.target === target) pressed = op.action === 'press';
  }
  return pressed;
}

/** 操作列の最後の時刻[ms]。空なら 0。 */
export function lastOperationMs(operations: readonly Operation[]): number {
  const last = operations[operations.length - 1];
  return last === undefined ? 0 : last.t;
}
