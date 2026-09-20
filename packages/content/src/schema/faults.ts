import { MAX_LAYER_SHORT_RATIO, MIN_LAYER_SHORT_RATIO, type FaultKind } from '@ojt/circuit-sim';
import { z } from 'zod';
import { TerminalIdSchema } from './common.js';

/**
 * 故障定義のスキーマ。設計仕様 §7.5 / §5.4。
 * 種別の集合は circuit-sim の `FaultKind` を唯一の源とし、`satisfies` で結んでおく
 * （エンジン側に種別が増えたらこのファイルがコンパイルエラーになる）。
 */

/** 故障の種別（§5.4 の9種）。 */
export const FAULT_KINDS = [
  'wire-open',
  'wire-missing',
  'wire-misrouted',
  'contact-open',
  'contact-welded',
  'contact-resistive',
  'coil-open',
  'coil-layer-short',
  'lamp-open',
] as const satisfies readonly FaultKind[];

/** 故障の種別。 */
export const FaultKindSchema = z.enum(FAULT_KINDS);

/** 電線を対象にする種別（断線・未配線・誤配線）。§5.4 */
export const WIRE_FAULT_KINDS = [
  'wire-open',
  'wire-missing',
  'wire-misrouted',
] as const satisfies readonly FaultKind[];

/** 部品の要素を対象にする種別。§5.4 */
export const PART_FAULT_KINDS = [
  'contact-open',
  'contact-welded',
  'contact-resistive',
  'coil-open',
  'coil-layer-short',
  'lamp-open',
] as const satisfies readonly FaultKind[];

/** その種別が電線を対象にするか。 */
export function isWireFaultKind(kind: FaultKind): boolean {
  return (WIRE_FAULT_KINDS as readonly FaultKind[]).includes(kind);
}

/** その種別が部品の要素を対象にするか。 */
export function isPartFaultKind(kind: FaultKind): boolean {
  return (PART_FAULT_KINDS as readonly FaultKind[]).includes(kind);
}

/**
 * ソケット部品（リレー／タイマ）のコイル要素の番号。§5.4 の `elementIndex`
 * （`createRelay4c()` / `createTimer4c()` は要素を `[coil, b1, a1, b2, a2, b3, a3, b4, a4]` の順に作る）
 */
export const SOCKET_COIL_ELEMENT_INDEX = 0;

/** ランプ／ブザーの負荷要素の番号（要素は1つだけ）。 */
export const LOAD_ELEMENT_INDEX = 0;

/**
 * ソケット部品の接点要素の番号。組は1〜4、`contact` は a（メーク）／b（ブレーク）。
 * 並びが `[coil, b1, a1, b2, a2, …]` なので b が `2k−1`、a が `2k` になる。§6.2
 */
export function socketContactElementIndex(group: number, contact: 'a' | 'b'): number {
  if (!Number.isInteger(group) || group < 1 || group > 4) {
    throw new RangeError(`接点の組は1〜4です: ${group}`);
  }
  return contact === 'a' ? group * 2 : group * 2 - 1;
}

/** 電線を指す故障の対象。§5.4 */
export const WireFaultTargetSchema = z.strictObject({
  wireId: z.string().min(1).describe('故障を入れる電線のID（課題の模範回路が生成する `sw-NNN`）。'),
});

/** 部品の要素を指す故障の対象。§5.4 */
export const PartFaultTargetSchema = z.strictObject({
  partId: z.string().min(1).describe('故障を入れる部品のID（`CR1` / `T1` / `PL1` など）。'),
  elementIndex: z
    .int()
    .min(0)
    .max(63)
    .describe('部品の要素番号。ソケットは 0=コイル、組kのb接点=2k−1、a接点=2k。'),
});

/** 故障の対象。§5.4 */
export const FaultTargetSchema = z.union([WireFaultTargetSchema, PartFaultTargetSchema]);

/** 故障の対象。 */
export type FaultTargetData = z.infer<typeof FaultTargetSchema>;

/**
 * 故障1件。§7.5
 * §5.4 の `param`（kind で意味が変わる `number | TerminalId`）は JSON では扱いにくいので、
 * `ohms` / `ratio` / `to` の名前付きフィールドに分け、kind との対応を refinement で縛る。
 */
export const FaultSpecSchema = z
  .strictObject({
    target: FaultTargetSchema.describe('故障を入れる場所（電線か、部品の要素）。'),
    kind: FaultKindSchema.describe('故障の種別。'),
    ohms: z
      .number()
      .positive()
      .max(1_000_000)
      .optional()
      .describe('`contact-resistive` の直列抵抗[Ω]。省略すると 500Ω。'),
    ratio: z
      .number()
      .min(MIN_LAYER_SHORT_RATIO)
      .max(MAX_LAYER_SHORT_RATIO)
      .optional()
      .describe(
        `\`coil-layer-short\` のコイル抵抗の低下率。省略すると 0.65。上限（${String(MAX_LAYER_SHORT_RATIO)}）` +
          'に近い値は調整前のアナログテスタではほぼ正常に見えるため、課題作成者は余裕を持った値を選ぶこと。',
      ),
    to: TerminalIdSchema.optional().describe('`wire-misrouted` で片端を付け替える先の端子ID。'),
  })
  .superRefine((spec, ctx) => {
    const wireTarget = 'wireId' in spec.target;
    if (isWireFaultKind(spec.kind) && !wireTarget) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: `${spec.kind} は電線の故障なので target は { wireId } にします`,
      });
    }
    if (isPartFaultKind(spec.kind) && wireTarget) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: `${spec.kind} は部品の故障なので target は { partId, elementIndex } にします`,
      });
    }
    if (spec.ohms !== undefined && spec.kind !== 'contact-resistive') {
      ctx.addIssue({
        code: 'custom',
        path: ['ohms'],
        message: 'ohms は contact-resistive にだけ指定できます',
      });
    }
    if (spec.ratio !== undefined && spec.kind !== 'coil-layer-short') {
      ctx.addIssue({
        code: 'custom',
        path: ['ratio'],
        message: 'ratio は coil-layer-short にだけ指定できます',
      });
    }
    if (spec.kind === 'wire-misrouted' && spec.to === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'wire-misrouted には付け替え先の端子ID（to）が必要です',
      });
    }
    if (spec.kind !== 'wire-misrouted' && spec.to !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to は wire-misrouted にだけ指定できます',
      });
    }
  });

/** 故障1件。 */
export type FaultSpecData = z.infer<typeof FaultSpecSchema>;

/**
 * ランダム故障の指定。§7.5
 * `seed` を省略すると課題開始ごとに新しい乱数を使う。`fallback` は「100回引き直しても条件を
 * 満たす組合せが作れなかったときに使う明示リスト」で、§7.5 が要求するフォールバックを
 * データとして必ず持たせるため**必須**にしてある（長さは `count` と同じ）。
 */
export const RandomFaultsSchema = z
  .strictObject({
    count: z.int().min(1).max(8).describe('注入する故障の数。'),
    types: z.array(FaultKindSchema).min(1).describe('選んでよい故障の種別。'),
    seed: z.int().min(0).optional().describe('省略すると課題開始ごとに新しい乱数を使います。'),
    fallback: z
      .array(FaultSpecSchema)
      .min(1)
      .describe('引き直しの上限に達したときに使う明示リスト（要素数は count と同じ）。'),
  })
  .superRefine((random, ctx) => {
    if (random.fallback.length !== random.count) {
      ctx.addIssue({
        code: 'custom',
        path: ['fallback'],
        message: `フォールバックの件数（${random.fallback.length}）は count（${random.count}）と同じにします`,
      });
    }
  });

/** ランダム故障の指定。 */
export type RandomFaultsData = z.infer<typeof RandomFaultsSchema>;

/**
 * 課題の `faults`（明示リストまたはランダム）。§7.5
 *
 * CT-13: 判別子の無い共用体なので、どちらの枝にも合わない値（`{}` や `{ random: 'x' }`）を渡すと
 * zod は枝ごとの違反を両方とも並べ、課題一覧には「配列にしてください」と「random がありません」が
 * 同時に出て、どちらが本当の理由なのか分からなくなる。共用体そのものに**1つの親メッセージ**を
 * 与え、上位の違反1件が日本語で書き方を示すようにする（枝の中身は入れ子として残るので、
 * 枝の内側の誤り＝配列の要素やランダム指定の項目の誤りは今までどおり場所つきで出る）。
 */
export const FaultsSchema = z.union(
  [z.array(FaultSpecSchema).min(1), z.strictObject({ random: RandomFaultsSchema })],
  { error: '故障は、故障の一覧（1件以上の配列）か `{ "random": … }` のどちらかで書きます' },
);

/** 課題の `faults`。 */
export type FaultsData = z.infer<typeof FaultsSchema>;

/** `faults` がランダム指定か。 */
export function isRandomFaults(faults: FaultsData): faults is { random: RandomFaultsData } {
  return !Array.isArray(faults);
}
