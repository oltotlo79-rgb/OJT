import { plcUnitFor } from '@ojt/board-model';
import { TICK_MS } from '@ojt/circuit-sim';
import { compile, deviceLabel } from '@ojt/ladder-core';
import { z } from 'zod';
import { ProblemHeaderShape } from './common.js';
import { PlcJudgeSettingsSchema, resolveCompareSignals } from './judge.js';
import { LadderProgramSchema } from './ladder.js';
import { DurationMsSchema, lastOperationMs, OperationListSchema } from './operations.js';

/**
 * モードD（PLC）の課題本体。設計仕様 §7.6 / §10.2 / §10.8。
 *
 * 模範回路は展開接続図ではなく**I/O割付**で表す（PLC端子は §11.1 の回路図の語彙に無い）。
 * 模範配線は `plc-reference.ts` が割付から生成する（決定表#10）。
 */

/**
 * モードD の静的チェックの既定（9件すべて有効）。§7.4 の D 列
 * 定義の源は `schema/judge.ts`（`judgeSettings()` がそこで使う）で、ここはモードDの読み手向けに
 * 再公開するだけである。
 */
export { PLC_DEFAULT_STATIC_CHECKS } from './judge.js';

/** PLCメーカー。決定事項#14 */
export const PLC_VENDORS = ['mitsubishi', 'jtekt', 'omron', 'sharp'] as const;
/** PLC機種。§7.6 */
export const PLC_MODELS = ['FX5U', 'PC10G-1SP', 'CP1E', 'JW-300'] as const;
/** Phase 4 で4機種すべてを開始できるようにした。§16 */
export const SUPPORTED_PLC_MODELS = PLC_MODELS;

/**
 * メーカー → 機種（§7.6 の対応）。
 * バレル（`index.ts`）から公開し、テストや呼び出し側が機種一覧を書き写さずに済むようにする
 * （レビュー M9。`apps/desktop/src/renderer/session/plc-skin.ts` も同種のマップを持っているが、
 * それは別チームの担当ファイルなのでここでは触らない）。
 */
export const MODEL_OF_VENDOR: Readonly<
  Record<(typeof PLC_VENDORS)[number], (typeof PLC_MODELS)[number]>
> = {
  mitsubishi: 'FX5U',
  jtekt: 'PC10G-1SP',
  omron: 'CP1E',
  sharp: 'JW-300',
};

/** 使用するPLC。§7.6 */
export const PlcRefSchema = z
  .strictObject({
    vendor: z.enum(PLC_VENDORS).describe('PLCメーカー。'),
    model: z.enum(PLC_MODELS).describe('PLC機種。メーカーと組になる機種を指定します（§7.6）。'),
  })
  .superRefine((plc, ctx) => {
    if (MODEL_OF_VENDOR[plc.vendor] !== plc.model) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: `${plc.vendor} の機種は ${MODEL_OF_VENDOR[plc.vendor]} です`,
      });
    }
    // `PLC_MODELS`（このファイル）と `PLC_UNITS`（board-model）は別ファイルの別リストなので、
    // 機種を1つ追加してどちらかへの登録を忘れると符牒がずれる。今日の4機種はどちらにも
    // 揃って登録されているためこの枝には到達しない — 将来の機種追加で登録漏れが起きたときに
    // 課題JSONの読込段階で拾うための防御である。
    /* c8 ignore next 7 -- 今日の4機種はすべて PLC_UNITS にもあるため到達しない（防御的チェック） */
    if (plcUnitFor(plc.model) === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['model'],
        message: `この機種の本体定義がありません（board-model の PLC_UNITS）: ${plc.model}`,
      });
    }
  });

/** I/O割付の指定方法。§7.6 */
export const PlcIoModeSchema = z.enum(['fixed', 'free']);
/** 入力コモンの結線。§10.2 */
export const PlcWiringSchema = z.enum(['sink', 'source']);

/** 入力1点の割付。PLC盤は未配線から始まるのでPB4も使用できる。 */
export const PlcInputMapSchema = z.strictObject({
  x: z.int().min(0).max(15),
  pb: z.enum(['PB1', 'PB2', 'PB3', 'PB4']),
});

/** 出力1点の割付（`y` は出力番号、`cr` は中継リレー、`pl` は表示灯）。§7.6 / §10.2 */
export const PlcOutputMapSchema = z.strictObject({
  y: z
    .int()
    .min(0)
    .max(15)
    .describe(
      '出力番号（10進の装置番号）。上限は機種で違う（CP1E は12点までなので `y` は0〜11。' +
        'それより機種の出力点数が多い場合は機種の出力点数までが上限。§10.1 / 決定表#13）。' +
        'ここでは全機種共通の緩い上限だけを課し、機種ごとの実際の点数チェックは ' +
        '`PlcProblemSchema` の superRefine が機種仕様（`unit.spec.outputs.length`）から行う。',
    ),
  cr: z.enum(['CR1', 'CR2', 'CR3', 'CR4']),
  pl: z.enum(['PL1', 'PL2', 'PL3', 'PL4']),
});

/** 入力割付。 */
export type PlcInputMapData = z.infer<typeof PlcInputMapSchema>;
/** 出力割付。 */
export type PlcOutputMapData = z.infer<typeof PlcOutputMapSchema>;

/** 既定のI/O割付（§7.6 の表。本アプリの既定）。 */
export const DEFAULT_PLC_IO: {
  inputs: readonly PlcInputMapData[];
  outputs: readonly PlcOutputMapData[];
} = {
  // 既定教材はPB1〜PB3を使う。利用者課題ではPB4も割り付けられる。
  inputs: [
    { x: 0, pb: 'PB1' },
    { x: 1, pb: 'PB2' },
    { x: 2, pb: 'PB3' },
  ],
  outputs: [
    { y: 0, cr: 'CR1', pl: 'PL1' },
    { y: 1, cr: 'CR2', pl: 'PL2' },
    { y: 2, cr: 'CR3', pl: 'PL3' },
    { y: 3, cr: 'CR4', pl: 'PL4' },
  ],
};

/** 重複した割当を指摘する。 */
function checkDuplicates(
  values: readonly (string | number)[],
  path: string,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string | number>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: 'custom',
        path: [path, index],
        message: `割当が重複しています: ${value}`,
      });
    }
    seen.add(value);
  });
}

/** I/O割付。§7.6 */
export const PlcIoSchema = z
  .strictObject({
    mode: PlcIoModeSchema.describe('`fixed` は割付を課題が固定し静的チェックで検証します。'),
    wiring: PlcWiringSchema.default('sink').describe('入力コモンの結線（シンク／ソース）。'),
    inputs: z.array(PlcInputMapSchema).min(1).max(3).optional(),
    outputs: z.array(PlcOutputMapSchema).min(1).max(4).optional(),
  })
  .superRefine((io, ctx) => {
    if (io.mode === 'fixed' && (io.inputs === undefined) !== (io.outputs === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [io.inputs === undefined ? 'inputs' : 'outputs'],
        message:
          '固定割付（mode: "fixed"）は inputs と outputs を両方指定するか、両方とも省略（既定割付）にします',
      });
    }
    const inputs = io.inputs ?? [];
    const outputs = io.outputs ?? [];
    checkDuplicates(
      inputs.map((i) => i.x),
      'inputs',
      ctx,
    );
    checkDuplicates(
      inputs.map((i) => i.pb),
      'inputs',
      ctx,
    );
    checkDuplicates(
      outputs.map((o) => o.y),
      'outputs',
      ctx,
    );
    checkDuplicates(
      outputs.map((o) => o.cr),
      'outputs',
      ctx,
    );
    checkDuplicates(
      outputs.map((o) => o.pl),
      'outputs',
      ctx,
    );
  });

/** I/O割付。 */
export type PlcIoData = z.infer<typeof PlcIoSchema>;

/** 解決済みのI/O割付（省略されたら §7.6 の既定割付を使う）。 */
export interface ResolvedPlcIo {
  mode: z.infer<typeof PlcIoModeSchema>;
  wiring: z.infer<typeof PlcWiringSchema>;
  inputs: readonly PlcInputMapData[];
  outputs: readonly PlcOutputMapData[];
}

/** 課題のI/O割付を解決する。§7.6 */
export function resolvePlcIo(io: PlcIoData): ResolvedPlcIo {
  return {
    mode: io.mode,
    wiring: io.wiring,
    inputs: io.inputs ?? DEFAULT_PLC_IO.inputs,
    outputs: io.outputs ?? DEFAULT_PLC_IO.outputs,
  };
}

/** モードD課題。§7.6 */
export const PlcProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('plc').describe('課題モード。PLCは `plc`。'),
    plc: PlcRefSchema.describe('使用するPLCのメーカーと機種。'),
    io: PlcIoSchema.describe('I/O割付（`fixed` なら静的チェックで検証します）。'),
    referenceLadder: LadderProgramSchema.describe('模範ラダー（IR）。'),
    wiringRequired: z
      .literal(true)
      .describe('盤とPLCの実配線を必須にします（決定事項#16。常に true）。'),
    operations: OperationListSchema.describe('判定で再生する押ボタン操作列。'),
    durationMs: DurationMsSchema.describe('判定区間の長さ[ms]。'),
    judge: PlcJudgeSettingsSchema.describe('比較する信号・許容差・静的チェックの設定。'),
  })
  .superRefine((problem, ctx) => {
    if (problem.grade === 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['grade'],
        message: 'PLC課題は1級・2級のみです（3級の課題1はPLCを使いません）',
      });
    }
    const last = lastOperationMs(problem.operations);
    if (problem.durationMs < last + TICK_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: `判定区間長（${problem.durationMs}ms）は最後の操作（${last}ms）より少なくとも1tick（${TICK_MS}ms）長くする必要があります`,
      });
    }
    const compiled = compile(problem.referenceLadder);
    if (!compiled.ok) {
      for (const error of compiled.errors) {
        ctx.addIssue({
          code: 'custom',
          path: ['referenceLadder'],
          message: `模範ラダーを変換できません（${error.code}）: ${error.message}`,
        });
      }
    }
    // 模範ラダー・操作列・判定設定は、いずれもI/O割付にある点だけを扱えるようにする。
    // 割付にない点を参照すると読込時には気づかず、判定や配線の段階で初めて崩れるため
    // ここで前もって拾う（レビュー #2）。
    const io = resolvePlcIo(problem.io);
    // 機種にない入出力点を割り付けると、模範配線を張る段になって初めて崩れる。
    // 端子は機種仕様（`unit.spec`）だけが知っているのでここで前もって拾う（決定表#13）
    const unit = plcUnitFor(problem.plc.model);
    if (unit !== undefined) {
      // `PlcInputMapSchema.x` の上限は0〜15（§10.1 の8進表記に合わせた全機種共通の緩い上限）だが、
      // 今日の4機種はどれも入力16点以上（FX5U 16 / CP1E 18 / PC10G-1SP 16 / JW-300 16）なので、
      // `x` がこの上限内である限り `x < unit.spec.inputs.length` は必ず真になり、このチェックは
      // 今日は発火しない。将来、入力が16点未満の機種を足したときに効く保険として残す（決定表#13）。
      io.inputs.forEach((input, index) => {
        if (input.x < unit.spec.inputs.length) return;
        ctx.addIssue({
          code: 'custom',
          path: ['io', 'inputs', index, 'x'],
          message: `${problem.plc.model} の入力は ${unit.spec.inputs.length} 点です（割付 x: ${input.x} はありません）`,
        });
      });
      io.outputs.forEach((output, index) => {
        if (output.y < unit.spec.outputs.length) return;
        ctx.addIssue({
          code: 'custom',
          path: ['io', 'outputs', index, 'y'],
          message: `${problem.plc.model} の出力は ${unit.spec.outputs.length} 点です（割付 y: ${output.y} はありません）`,
        });
      });
    }
    const mappedX = new Set(io.inputs.map((i) => i.x));
    const mappedY = new Set(io.outputs.map((o) => o.y));
    const mappedPb: ReadonlySet<string> = new Set(io.inputs.map((i) => i.pb));
    const mappedPl: ReadonlySet<string> = new Set(io.outputs.map((o) => o.pl));
    if (compiled.ok) {
      for (const d of compiled.program.usage.reads) {
        if (d.kind === 'input' && !mappedX.has(d.index)) {
          ctx.addIssue({
            code: 'custom',
            path: ['referenceLadder'],
            message: `模範ラダーが読む ${deviceLabel(d)} はI/O割付にありません`,
          });
        }
      }
      for (const d of compiled.program.usage.writes) {
        if (d.kind === 'output' && !mappedY.has(d.index)) {
          ctx.addIssue({
            code: 'custom',
            path: ['referenceLadder'],
            message: `模範ラダーが書く ${deviceLabel(d)} はI/O割付にありません`,
          });
        }
      }
    }
    problem.operations.forEach((op, index) => {
      if (!mappedPb.has(op.target)) {
        ctx.addIssue({
          code: 'custom',
          path: ['operations', index, 'target'],
          message: `操作対象 ${op.target} はI/O割付にありません`,
        });
      }
    });
    /**
     * `problem.judge.compareSignals` ではなく `resolveCompareSignals()` の**結果**を見る（CT-05）。
     * `compareSignals` を省略した課題は判定時に盤の出力部品すべて（既定 `PL1`〜`PL4`）が対象になる
     * （`schema/judge.ts` の `resolveCompareSignals()`）。生の `problem.judge.compareSignals` だけを
     * 見ていると、省略した課題では既定の `PL4` などがI/O割付に無くても検査をすり抜け、判定や
     * 配線の段になって初めて崩れる。省略時（明示の配列が無い）は `judge.compareSignals` 全体を
     * 指す（配列の要素が実在しないため）。
     */
    const compareSignals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);
    compareSignals.forEach((signal, index) => {
      // PL 以外の信号（`BZ` などボードの追加部品）はI/O割付の対象外なのでここでは見ない。
      if (/^PL\d+$/u.test(signal) && !mappedPl.has(signal)) {
        ctx.addIssue({
          code: 'custom',
          path:
            problem.judge.compareSignals === undefined
              ? ['judge', 'compareSignals']
              : ['judge', 'compareSignals', index],
          message: `比較信号 ${signal} はI/O割付にありません`,
        });
      }
    });
  });

/** モードD課題。 */
export type PlcProblem = z.infer<typeof PlcProblemSchema>;
