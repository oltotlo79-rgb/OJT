import { snapPresetToStep, TIMER_RANGE_60S, TIMER_RANGES } from '@ojt/board-model';
import { TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';
import { SCHEMATIC_FORMAT_VERSION, validateDocument } from '@ojt/schematic-core';
import { z } from 'zod';

/**
 * 模範回路(展開接続図)のスキーマ。設計仕様 §7.2 / §11.1。
 * 形は `@ojt/schematic-core` の `SchematicDocument` に一致させ、構造の妥当性は
 * 同パッケージの `validateDocument()` をそのまま refinement として呼んで判定する。
 */

/** 要素の種別。`CellKind` と同じ集合。§11.1 */
export const CellKindSchema = z.enum([
  'pb-a',
  'pb-b',
  'cr-a',
  'cr-b',
  't-a',
  't-b',
  'coil',
  'lamp',
  'buzzer',
]);

/**
 * その設定値をそのまま保持できるタイマレンジ(丸めが起きないもの)があるか。§5.3.2
 *
 * board-model の `snapPresetToStep()` は設定値をレンジの分解能に丸め、下限を
 * `max(TIMER_MIN_PRESET_MS, range.stepMs)` に切り上げる。つまり 0〜10秒レンジは0.1秒刻み・
 * 下限100ms、0〜60秒レンジは0.5秒刻み・**下限500ms**であり、レンジごとに取れる値が違う。
 * 課題JSONに書いた秒数と実際に装着されるタイマの秒数が黙って食い違わないよう、
 * どれかのレンジに丸めなしで載る値だけを受け付ける(判定はレンジ定義を唯一の源にする)。
 */
export function hasExactTimerRange(presetMs: number): boolean {
  return TIMER_RANGES.some((range) => snapPresetToStep(presetMs, range) === presetMs);
}

/** 段の中の1要素。§11.1 */
export const SchematicCellSchema = z.object({
  kind: CellKindSchema,
  id: z.string().min(1),
  device: z.string().min(1),
  presetMs: z
    .int()
    .min(TIMER_MIN_PRESET_MS)
    .max(TIMER_RANGE_60S.maxMs)
    .refine(hasExactTimerRange, {
      message: 'タイマ設定値はレンジの刻みに載る値にします(0〜10秒は0.1秒刻み／0〜60秒は0.5秒刻み)',
    })
    .optional(),
});

/** 段の端点(母線か他の段の節点)。§11.1 */
export const RungEndSchema = z.union([
  z.object({ bus: z.enum(['P', 'N']) }),
  z.object({ rung: z.string().min(1), node: z.int().min(0) }),
]);

/** 1段(ラング)。§11.1 */
export const RungSchema = z.object({
  id: z.string().min(1),
  from: RungEndSchema,
  to: RungEndSchema,
  cells: z.array(SchematicCellSchema).min(1),
});

/** `validateDocument()` のパス文字列(`rungs[0].cells[2]`)を zod のパス配列に直す。 */
export function toZodPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const token of path.split('.')) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/u.exec(token);
    if (match === null) {
      out.push(token);
      continue;
    }
    out.push(match[1] ?? token);
    for (const index of (match[2] ?? '').matchAll(/\[(\d+)\]/gu)) {
      out.push(Number(index[1]));
    }
  }
  return out;
}

/** 展開接続図の文書。§11.1 */
export const SchematicDocumentSchema = z
  .object({
    formatVersion: z.literal(SCHEMATIC_FORMAT_VERSION),
    id: z.string().min(1),
    title: z.string().min(1),
    orientation: z.literal('horizontal'),
    rungs: z.array(RungSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    for (const error of validateDocument(doc)) {
      ctx.addIssue({ code: 'custom', path: toZodPath(error.path), message: error.message });
    }
  });

/** 展開接続図の文書(zod 出力型)。 */
export type SchematicDocumentData = z.infer<typeof SchematicDocumentSchema>;
