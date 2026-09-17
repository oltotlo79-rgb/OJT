import {
  COIL_COL,
  IR_COLS,
  MAX_COUNTER_PRESET,
  MAX_ROWS,
  MAX_TIMER_PRESET_MS,
  SPECIAL_INDEXES,
  TIMER_STEP_MS,
  type Cell,
  type LadderProgram,
  type Network,
} from '@ojt/ladder-core';
import { z } from 'zod';

/**
 * ラダーIRの zod スキーマ。設計仕様 §7.6 / §10.3。
 *
 * 型の源は `@ojt/ladder-core`（`Cell` / `Network` / `LadderProgram`）で、ここはその**入力形式**
 * （課題JSONの書き方）だけを決める。JSONを短く書けるように、1行は使う列までを並べれば足りない
 * ぶんを空セルで詰める（`network()` と同じ規則）。
 *
 * 構造の検査（END の有無・コイル列・MC/MCR の対応）は `compile()` が唯一の源なので**ここでは
 * 繰り返さない**。課題読込時に `compile()` を通すのは `schema/plc.ts` の refinement である。
 */

/** デバイス種別。§10.3 */
export const DeviceKindSchema = z.enum([
  'input',
  'output',
  'internal',
  'timer',
  'counter',
  'special',
]);

/** デバイス（種別＋0起点の通し番号）。8進表記は方言の担当なのでここは常に10進の整数。§10.3 */
export const DeviceSchema = z
  .strictObject({
    kind: DeviceKindSchema,
    index: z.int().min(0).max(65_535),
  })
  .refine((d) => d.kind !== 'special' || SPECIAL_INDEXES.includes(d.index), {
    message: `特殊デバイスは ${SPECIAL_INDEXES.join('／')} のみです（常時ON／初期パルス／1秒クロック）`,
    path: ['index'],
  });

/** デバイス。 */
export type DeviceData = z.infer<typeof DeviceSchema>;

/** セル。§10.3 */
export const CellSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('contact'),
    type: z.enum(['NO', 'NC', 'P', 'F']),
    device: DeviceSchema,
  }),
  z.strictObject({
    kind: z.literal('coil'),
    type: z.enum(['OUT', 'SET', 'RST']),
    device: DeviceSchema,
  }),
  z.strictObject({
    kind: z.literal('timer'),
    type: z.literal('TON'),
    device: DeviceSchema,
    presetMs: z
      .int()
      .min(TIMER_STEP_MS)
      .max(MAX_TIMER_PRESET_MS)
      .refine((ms) => ms % TIMER_STEP_MS === 0, {
        message: `タイマ設定値は ${TIMER_STEP_MS}ms の倍数にします`,
      }),
  }),
  z.strictObject({
    kind: z.literal('counter'),
    type: z.literal('CTU'),
    device: DeviceSchema,
    preset: z.int().min(1).max(MAX_COUNTER_PRESET),
    resetDevice: DeviceSchema,
  }),
  z.strictObject({ kind: z.literal('mc'), device: DeviceSchema }),
  z.strictObject({ kind: z.literal('mcr'), device: DeviceSchema }),
  z.strictObject({ kind: z.literal('end') }),
  z.strictObject({ kind: z.literal('hline') }),
  z.strictObject({ kind: z.literal('vline') }),
  z.strictObject({ kind: z.literal('empty') }),
]);

/** セル。 */
export type CellData = z.infer<typeof CellSchema>;

/** 出力位置に置くセル（コイル列に置くもの）。 */
function isOutputCellData(cell: CellData): boolean {
  return ['coil', 'timer', 'counter', 'mc', 'mcr'].includes(cell.kind);
}

/**
 * 1行を16列に詰める。
 * **行の最後が出力セル（コイル・タイマ・カウンタ・MC/MCR）なら、それをコイル列（15列目）へ送り、
 * 手前を横線で埋める。** 実機のラダーでもコイルは必ず右母線に付くので、課題JSONに横線を12個も
 * 並べずに済む。出力セルで終わらない行は、足りないぶんを空セルで詰める。
 */
function padRow(cells: readonly CellData[]): Cell[] {
  const row: Cell[] = [...cells];
  const last = row[row.length - 1];
  if (last !== undefined && isOutputCellData(last) && row.length < IR_COLS) {
    row.pop();
    while (row.length < COIL_COL) row.push({ kind: 'hline' });
    row.push(last);
    return row;
  }
  while (row.length < IR_COLS) row.push({ kind: 'empty' });
  return row;
}

/** ネットワーク。行は1〜`MAX_ROWS`、1行は1〜`IR_COLS` セル。§10.3 */
export const LadderNetworkSchema = z
  .strictObject({
    id: z.string().min(1),
    comment: z.string().optional(),
    cells: z.array(z.array(CellSchema).min(1).max(IR_COLS)).min(1).max(MAX_ROWS),
  })
  .transform((net): Network => ({
    id: net.id,
    ...(net.comment === undefined ? {} : { comment: net.comment }),
    rows: net.cells.length,
    cols: IR_COLS,
    cells: net.cells.map(padRow),
  }));

/** デバイスコメント1件の長さの上限（GX Works3 のデバイスコメントに合わせる）。§10.7 */
export const MAX_DEVICE_COMMENT_LENGTH = 32;
/** デバイスコメントの件数の上限。 */
export const MAX_DEVICE_COMMENTS = 200;

/**
 * デバイスコメント（`X0` → `運転押ボタン` のような対応表）。§10.7
 *
 * キーはベンダー中立の表示名（`deviceLabel()` が返す `X0` / `M1` / `T0` / `SP2` の形）で、
 * 方言の8進表記ではない。Plan 3B のデバイスコメント欄と作業ファイルがそのまま読む。
 * 実行には一切影響しない（`compile()` も `createPlcRuntime()` も見ない）。
 */
export const DeviceCommentsSchema = z
  .record(
    z
      .string()
      .regex(/^(X|Y|M|T|C|SP)\d+$/u, 'デバイス表示名は `X0` / `M1` / `T0` / `SP2` の形です'),
    z.string().min(1).max(MAX_DEVICE_COMMENT_LENGTH),
  )
  .refine((comments) => Object.keys(comments).length <= MAX_DEVICE_COMMENTS, {
    message: `デバイスコメントは ${MAX_DEVICE_COMMENTS} 件までです`,
  });

/** デバイスコメント。 */
export type DeviceCommentsData = z.infer<typeof DeviceCommentsSchema>;

/** ラダープログラム。§10.3 */
export const LadderProgramSchema = z
  .strictObject({
    networks: z.array(LadderNetworkSchema).min(1).max(64),
    comments: DeviceCommentsSchema.optional(),
  })
  .superRefine((program, ctx) => {
    const seen = new Set<string>();
    program.networks.forEach((net, index) => {
      if (seen.has(net.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['networks', index, 'id'],
          message: `ネットワークIDが重複しています: ${net.id}`,
        });
      }
      seen.add(net.id);
    });
  })
  .transform((program): LadderProgramData => ({
    networks: [...program.networks],
    ...(program.comments === undefined ? {} : { comments: { ...program.comments } }),
  }));

/**
 * 課題JSONのラダー。`@ojt/ladder-core` の `LadderProgram` に**実行に関わらない**
 * デバイスコメントを足しただけなので、`compile()` にもそのまま渡せる。
 */
export interface LadderProgramData extends LadderProgram {
  comments?: DeviceCommentsData;
}

/** コイル列の列番号（課題データの読み手向けに再公開する）。§10.3 */
export const LADDER_COIL_COL = COIL_COL;
