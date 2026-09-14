import { DEFAULT_TOLERANCE } from '@ojt/circuit-sim';
import { z } from 'zod';

/**
 * 判定設定。設計仕様 §7.4。
 * `compareSignals` を省略したときの既定は「盤に実在する出力部品すべて」であり、
 * 標準盤では `PL1`〜`PL4`、課題が `BZ` を追加した場合は `BZ` を含める。
 */

/** 標準盤に常設された出力部品。§6.1 */
export const BOARD_OUTPUT_SIGNALS: readonly string[] = ['PL1', 'PL2', 'PL3', 'PL4'];

/** 盤に実在する出力部品すべて(＝ `compareSignals` の既定)。§7.4 */
export function defaultCompareSignals(extraParts: readonly string[] = []): string[] {
  return extraParts.includes('BZ') ? [...BOARD_OUTPUT_SIGNALS, 'BZ'] : [...BOARD_OUTPUT_SIGNALS];
}

/** 許容差。§7.4 */
export const ToleranceSchema = z.object({
  edgeMs: z.int().min(0).max(10_000).default(DEFAULT_TOLERANCE.edgeMs),
  ratio: z.number().min(0).max(1).default(DEFAULT_TOLERANCE.ratio),
});

/** 許容差。 */
export type ToleranceData = z.infer<typeof ToleranceSchema>;

/** Phase 1 で実装する静的チェックのID。§7.4 */
export const STATIC_CHECK_IDS = [
  'wireColorRule',
  'terminalLimit',
  'unusedParts',
  'forbiddenCircuit',
  'coilPolarity',
  'powerSequence',
] as const;

/** 静的チェックのID。 */
export type StaticCheckId = (typeof STATIC_CHECK_IDS)[number];

/** 静的チェックの有効/無効。モードB(`assemble`)では全項目が既定で有効。§7.4 */
export const StaticChecksSchema = z.object({
  wireColorRule: z.boolean().default(true),
  terminalLimit: z.boolean().default(true),
  unusedParts: z.boolean().default(true),
  forbiddenCircuit: z.boolean().default(true),
  coilPolarity: z.boolean().default(true),
  powerSequence: z.boolean().default(true),
});

/** 静的チェックの有効/無効。 */
export type StaticChecksData = z.infer<typeof StaticChecksSchema>;

/** 全項目を有効にした既定値。§7.4 */
export const DEFAULT_STATIC_CHECKS: StaticChecksData = {
  wireColorRule: true,
  terminalLimit: true,
  unusedParts: true,
  forbiddenCircuit: true,
  coilPolarity: true,
  powerSequence: true,
};

/** 判定設定。§7.4 */
export const JudgeSettingsSchema = z.object({
  compareSignals: z.array(z.string().min(1)).min(1).optional(),
  tolerance: ToleranceSchema.default({
    edgeMs: DEFAULT_TOLERANCE.edgeMs,
    ratio: DEFAULT_TOLERANCE.ratio,
  }),
  staticChecks: StaticChecksSchema.default(DEFAULT_STATIC_CHECKS),
});

/** 判定設定。 */
export type JudgeSettings = z.infer<typeof JudgeSettingsSchema>;

/** 実際に比較する信号名を決める(`compareSignals` 省略時は盤の出力部品すべて)。§7.4 */
export function resolveCompareSignals(
  judge: JudgeSettings,
  extraParts: readonly string[] = [],
): string[] {
  return judge.compareSignals ?? defaultCompareSignals(extraParts);
}
