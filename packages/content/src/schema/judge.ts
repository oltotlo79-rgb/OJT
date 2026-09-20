import { DEFAULT_TOLERANCE } from '@ojt/circuit-sim';
import { z } from 'zod';

/**
 * 判定設定。設計仕様 §7.4。
 * `compareSignals` を省略したときの既定は「盤に実在する出力部品すべて」であり、
 * 標準盤では `PL1`〜`PL4`、課題が `BZ` を追加した場合は `BZ` を含める。
 */

/** 標準盤に常設された出力部品。§6.1 */
export const BOARD_OUTPUT_SIGNALS: readonly string[] = ['PL1', 'PL2', 'PL3', 'PL4'];

/** 盤に実在する出力部品すべて（＝ `compareSignals` の既定）。§7.4 */
export function defaultCompareSignals(extraParts: readonly string[] = []): string[] {
  return extraParts.includes('BZ') ? [...BOARD_OUTPUT_SIGNALS, 'BZ'] : [...BOARD_OUTPUT_SIGNALS];
}

/** 許容差。§7.4 */
export const ToleranceSchema = z.strictObject({
  edgeMs: z.int().min(0).max(10_000).default(DEFAULT_TOLERANCE.edgeMs),
  ratio: z.number().min(0).max(1).default(DEFAULT_TOLERANCE.ratio),
});

/** 許容差。 */
export type ToleranceData = z.infer<typeof ToleranceSchema>;

/** 静的チェックのID。§7.4（PLC用の3件は Phase 3 で追加） */
export const STATIC_CHECK_IDS = [
  'wireColorRule',
  'terminalLimit',
  'unusedParts',
  'forbiddenCircuit',
  'coilPolarity',
  'powerSequence',
  'twoStage',
  'plcPowerIndependent',
  'ioAssignment',
] as const;

/** 静的チェックのID。 */
export type StaticCheckId = (typeof STATIC_CHECK_IDS)[number];

/** 静的チェックの有効/無効。モードB（`assemble`）では Phase 1 の6件が既定で有効。§7.4 */
export const StaticChecksSchema = z.strictObject({
  wireColorRule: z.boolean().default(true),
  terminalLimit: z.boolean().default(true),
  unusedParts: z.boolean().default(true),
  forbiddenCircuit: z.boolean().default(true),
  coilPolarity: z.boolean().default(true),
  powerSequence: z.boolean().default(true),
  twoStage: z.boolean().default(false),
  plcPowerIndependent: z.boolean().default(false),
  ioAssignment: z.boolean().default(false),
});

/** 静的チェックの有効/無効。 */
export type StaticChecksData = z.infer<typeof StaticChecksSchema>;

/** モードB・C の既定（PLC用の3件は無効）。§7.4 */
export const DEFAULT_STATIC_CHECKS: StaticChecksData = {
  wireColorRule: true,
  terminalLimit: true,
  unusedParts: true,
  forbiddenCircuit: true,
  coilPolarity: true,
  powerSequence: true,
  twoStage: false,
  plcPowerIndependent: false,
  ioAssignment: false,
};

/** モードD の既定（9件すべて有効）。§7.4 の D 列 */
export const PLC_DEFAULT_STATIC_CHECKS: StaticChecksData = {
  ...DEFAULT_STATIC_CHECKS,
  twoStage: true,
  plcPowerIndependent: true,
  ioAssignment: true,
};

/**
 * `staticChecks` の入力用スキーマ。`StaticChecksSchema` と違い個別の `.default()` を
 * 持たない（全項目が省略可）。`.default(staticDefaults)`（`StaticChecksSchema` 側の既定）は
 * `staticChecks` キー自体が無いときにしか効かず、キーがあれば内側の個別既定（＝モードBの既定）が
 * 使われてしまう。1件だけ書いた課題（例: `{"wireColorRule": false}`）でも省略した項目には
 * **そのモードの既定**（PLC なら `PLC_DEFAULT_STATIC_CHECKS`）が入るよう、既定の持ち主を
 * `judgeSettings()` 側 1箇所に寄せる（CT-01）。
 */
const StaticChecksInputSchema = z.strictObject({
  wireColorRule: z.boolean().optional(),
  terminalLimit: z.boolean().optional(),
  unusedParts: z.boolean().optional(),
  forbiddenCircuit: z.boolean().optional(),
  coilPolarity: z.boolean().optional(),
  powerSequence: z.boolean().optional(),
  twoStage: z.boolean().optional(),
  plcPowerIndependent: z.boolean().optional(),
  ioAssignment: z.boolean().optional(),
});

/** 判定設定のスキーマを、静的チェックの既定を差し替えて作る。§7.4 */
function judgeSettings(staticDefaults: StaticChecksData) {
  return z.strictObject({
    compareSignals: z.array(z.string().min(1)).min(1).optional(),
    tolerance: ToleranceSchema.default({
      edgeMs: DEFAULT_TOLERANCE.edgeMs,
      ratio: DEFAULT_TOLERANCE.ratio,
    }),
    staticChecks: StaticChecksInputSchema.default({}).transform((v): StaticChecksData => {
      // `{ ...staticDefaults, ...v }` は使わない。`v` の各項目は「省略可」であって
      // `undefined` を明示的に持つ値ではないが、TSの spread はそれを区別できず
      // `boolean | undefined` に広がってしまう（exactOptionalPropertyTypes）。
      // 実際に指定された項目だけ既定を上書きする。
      const merged = { ...staticDefaults };
      for (const id of STATIC_CHECK_IDS) {
        const value = v[id];
        if (value !== undefined) merged[id] = value;
      }
      return merged;
    }),
  });
}

/** 判定設定（モードB・C）。§7.4 */
export const JudgeSettingsSchema = judgeSettings(DEFAULT_STATIC_CHECKS);

/** 判定設定（モードD）。§7.4 の D 列 */
export const PlcJudgeSettingsSchema = judgeSettings(PLC_DEFAULT_STATIC_CHECKS);

/** 判定設定。 */
export type JudgeSettings = z.infer<typeof JudgeSettingsSchema>;

/** 実際に比較する信号名を決める（`compareSignals` 省略時は盤の出力部品すべて）。§7.4 */
export function resolveCompareSignals(
  judge: JudgeSettings,
  extraParts: readonly string[],
): string[] {
  return judge.compareSignals ?? defaultCompareSignals(extraParts);
}
