import {
  MOUNTABLE_KINDS,
  SOCKET_IDS,
  SOCKET_ROLES,
  validateSocketRoles,
  type SocketId,
  type SocketRole,
  type SocketRoles,
} from '@ojt/board-model';
import { z } from 'zod';

/**
 * 課題データの共通ヘッダ。設計仕様 §7.1。
 * 定義の唯一の源は zod（§4.5）。TypeScript 型はすべて `z.infer` で導出する。
 *
 * 役割名・部品種別・ソケット数といった**盤の語彙**は board-model が唯一の源なので、
 * 文字列リテラルを書き写さず、公開されているタプル（`SOCKET_ROLES` / `MOUNTABLE_KINDS` /
 * `SOCKET_IDS`）から zod の列挙を組み立てる。盤の語彙が増えたらスキーマが自動で追随する。
 */

/** 課題ファイルの形式バージョン。未知のバージョンは読込エラーにする。§13 #8 */
export const CONTENT_FORMAT_VERSION = 1;

/** 課題ID（`b-001` のような英数字とハイフン）。§7.1 */
export const ProblemIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, '課題IDは英小文字・数字・ハイフンで書きます');

/** 想定級。ヒント表示の制御に使う。§7.1 / §8.4 */
export const GradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** 想定級。 */
export type Grade = z.infer<typeof GradeSchema>;

/** 課題モード。Phase 1 が実装するのは `assemble` だけ（§16）。§7.1 */
export const ProblemModeSchema = z.enum(['assemble', 'inspect-parts', 'inspect-repair', 'plc']);

/** 課題モード。 */
export type ProblemMode = z.infer<typeof ProblemModeSchema>;

/** Phase 1 では未対応のモード。読込時に `unsupported-mode` として一覧に出す。§13 #1 */
export const UNSUPPORTED_MODES = [
  'inspect-parts',
  'inspect-repair',
  'plc',
] as const satisfies readonly ProblemMode[];

/** 標準時間／打切り時間（分）。§7.1 */
export const TimeLimitSchema = z
  .strictObject({
    standardMin: z.int().min(1).max(600),
    cutoffMin: z.int().min(1).max(600),
  })
  .refine((v) => v.cutoffMin >= v.standardMin, {
    message: '打切り時間は標準時間以上にします',
    path: ['cutoffMin'],
  });

/** 標準時間／打切り時間。 */
export type TimeLimit = z.infer<typeof TimeLimitSchema>;

/** ソケットの役割。board-model の `SOCKET_ROLES`（`CR1`〜`CR4` / `T1` / `T2` / `CHK`）そのもの。§6.1 */
export const SocketRoleSchema = z.enum(SOCKET_ROLES);

/** 役割割当の生データ。値が `undefined` のキーは「役割なしの予備ソケット」を表す。 */
type SocketRolesInput = Readonly<Partial<Record<SocketId, SocketRole | undefined>>>;

/**
 * 8ソケットの役割割当。board-model の `SocketRoles`（`Readonly<Partial<Record<SocketId, SocketRole>>>`）
 * に一致させる。**役割を書かなかったソケットは役割なしの予備**であり、端子だけが存在して配線できる（§6.1）。
 * キーの集合は board-model の `SOCKET_IDS`（S1〜S8）と同じで、盤に無いソケットIDは
 * その場で弾く（`z.strictObject`。パスが出るよう明示的に並べる）。
 *
 * 割当そのものの妥当性（役割の重複・`CHK` の有無・`CHK` は `S7` 固定）は board-model の
 * `validateSocketRoles()` が唯一の源であり、**同じ判定を二重に書かず**それを refinement から呼ぶ
 * （`schematic.ts` が `validateDocument()` を呼ぶのと同じ形）。チェック用回路の既設配線（§6.3）は
 * `S7` に固定で結線されているため、`CHK` を別のソケットに置いた課題はここで落ちる。
 */
export const SocketRolesSchema = z
  .strictObject({
    S1: SocketRoleSchema.optional(),
    S2: SocketRoleSchema.optional(),
    S3: SocketRoleSchema.optional(),
    S4: SocketRoleSchema.optional(),
    S5: SocketRoleSchema.optional(),
    S6: SocketRoleSchema.optional(),
    S7: SocketRoleSchema.optional(),
    S8: SocketRoleSchema.optional(),
  })
  .superRefine((v, ctx) => {
    for (const message of validateSocketRoles(toSocketRoles(v))) {
      ctx.addIssue({ code: 'custom', message });
    }
  });

/** 8ソケットの役割割当。 */
export type SocketRolesData = z.infer<typeof SocketRolesSchema>;

/**
 * 課題の役割割当を board-model の `SocketRoles` に直す。
 * zod は省略可能なキーを `S1?: SocketRole | undefined` と推論するが、`exactOptionalPropertyTypes`
 * のもとでの `Partial<Record<SocketId, SocketRole>>` は `S1?: SocketRole`（`undefined` を含まない）
 * なのでそのままでは渡せない。値が `undefined` のキーは予備ソケットなので単に落とす。
 */
export function toSocketRoles(data: SocketRolesInput): SocketRoles {
  const out: Partial<Record<SocketId, SocketRole>> = {};
  for (const socket of SOCKET_IDS) {
    const role = data[socket];
    if (role !== undefined) out[socket] = role;
  }
  return out;
}

/** 盤に追加できる任意部品。標準盤に BZ は無い。§5.3.4 */
export const ExtraPartSchema = z.enum(['BZ']);

/** 課題が使う盤の指定。§7.1 */
export const BoardRefSchema = z.strictObject({
  boardId: z.string().min(1),
  socketRoles: SocketRolesSchema,
  extraParts: z.array(ExtraPartSchema).optional(),
});

/** 課題が使う盤の指定。 */
export type BoardRef = z.infer<typeof BoardRefSchema>;

/** 装着できる部品種別。board-model の `MOUNTABLE_KINDS`（`relay-my4n` / `timer-h3y4`）そのもの。§6.6 */
export const MountableKindSchema = z.enum(MOUNTABLE_KINDS);

/** 在庫1件。上限は盤のソケット数（`SOCKET_IDS.length` = 8）。§7.1 / §6.1 */
export const InventoryItemSchema = z.strictObject({
  kind: MountableKindSchema,
  count: z.int().min(0).max(SOCKET_IDS.length),
});

/** 在庫1件。 */
export type InventoryItemData = z.infer<typeof InventoryItemSchema>;

/** すべてのモードに共通するヘッダ項目。§7.1 */
export const ProblemHeaderShape = {
  formatVersion: z.literal(CONTENT_FORMAT_VERSION),
  id: ProblemIdSchema.describe('課題ID。課題フォルダの中で一意にします。'),
  title: z.string().min(1).describe('課題一覧に出す課題名。'),
  grade: GradeSchema.describe('想定級（3級・2級・1級）。ヒントの出し方を決めます。'),
  description: z.string().describe('訓練者に示す課題文。'),
  timeLimit: TimeLimitSchema.describe('標準時間と打切り時間（分）。'),
  board: BoardRefSchema.describe('使う盤とソケットの役割割当。'),
  inventory: z.array(InventoryItemSchema).describe('訓練者が使える部品の在庫（種別ごとの個数）。'),
};

/** 共通ヘッダだけを取り出したスキーマ（モードの判別前に使う）。 */
export const ProblemHeaderSchema = z.strictObject({
  ...ProblemHeaderShape,
  mode: ProblemModeSchema,
});

/** 共通ヘッダ。 */
export type ProblemHeader = z.infer<typeof ProblemHeaderSchema>;

/** 端子ID（`<部品ID>.<端子名>`）の文字列形式。§6.4 */
export const TerminalIdSchema = z
  .string()
  .regex(/^[^.:]+\.[^:]+$/u, '端子IDは `<部品ID>.<端子名>` の形式です');
