import { z } from 'zod';
import { AssembleProblemSchema, type AssembleProblem } from './assemble.js';
import {
  ProblemHeaderShape,
  ProblemModeSchema,
  UNSUPPORTED_MODES,
  type ProblemMode,
} from './common.js';
import { InspectPartsProblemSchema, type InspectPartsProblem } from './inspect-parts.js';
import { InspectRepairProblemSchema, type InspectRepairProblem } from './inspect-repair.js';

/**
 * 課題スキーマの入口。設計仕様 §7 / §13 #1。
 * Phase 1 が本体まで定義するのは `assemble` だけで、他の3モードは**ヘッダだけを読み**、
 * `unsupported-mode` として課題一覧に理由付きで出す（プレースホルダのスキーマは置かない）。
 */

/**
 * zod の既定メッセージを日本語にする。**これはモジュール読込時の意図的な副作用**である。
 * zod の locale は 1 プロセスに 1 つの大域設定なので、ここで一度だけ設定する（§13 #1 の
 * 「利用者に見える文言は日本語」）。アプリは課題を検証する前に `@ojt/content` を import すること。
 * メッセージは検証時に解決されるので、他モジュールで先に定義したスキーマにもこの設定が効く。
 *
 * **このファイルは `package.json` の `"sideEffects": ["./src/schema/index.ts"]` に載せてある。**
 * バンドラは副作用なしと宣言されたモジュールを未使用として丸ごと落とすため、この1行が消えると
 * エラーメッセージだけ英語に戻る（テストでは再現しない種類の事故になる）。この呼び出しを
 * 別ファイルへ移すときは `sideEffects` の一覧も一緒に直すこと。
 */
z.config(z.locales.ja());

/** まだ本体を定義していないモードのヘッダ。本体フィールドはそのまま保持する。 */
export const UnsupportedProblemSchema = z.looseObject({
  ...ProblemHeaderShape,
  mode: z.enum(UNSUPPORTED_MODES).describe('課題モード。まだ開始できないモード（PLCは Phase 3）。'),
});

/** 未対応モードの課題（ヘッダのみ）。 */
export type UnsupportedProblem = z.infer<typeof UnsupportedProblemSchema>;

/** 課題（モードで判別する）。§7.1 */
export const ProblemSchema = z.discriminatedUnion('mode', [
  AssembleProblemSchema,
  InspectPartsProblemSchema,
  InspectRepairProblemSchema,
  UnsupportedProblemSchema,
]);

/** 課題。 */
export type Problem = z.infer<typeof ProblemSchema>;

/** いま開始できる課題（モードB／モードC1／モードC2）。§16 */
export type SupportedProblem = AssembleProblem | InspectPartsProblem | InspectRepairProblem;

/** モードB課題か。 */
export function isAssembleProblem(problem: SupportedProblem): problem is AssembleProblem {
  return problem.mode === 'assemble';
}

/** モードC1課題か。 */
export function isInspectPartsProblem(problem: SupportedProblem): problem is InspectPartsProblem {
  return problem.mode === 'inspect-parts';
}

/** モードC2課題か。 */
export function isInspectRepairProblem(problem: SupportedProblem): problem is InspectRepairProblem {
  return problem.mode === 'inspect-repair';
}

/** スキーマ違反1件（zodのパスとメッセージ）。§13 #1 */
export interface ProblemIssue {
  path: string;
  message: string;
}

/** 読込に失敗した理由。§13 #1 / §13 #2 */
export type ProblemFailureReason = 'invalid-json' | 'schema' | 'unsupported-mode' | 'reference';

/** `parseProblem()` の結果。 */
export type ParseProblemResult =
  | { ok: true; problem: SupportedProblem }
  | {
      ok: false;
      reason: ProblemFailureReason;
      message: string;
      issues: ProblemIssue[];
      /** 読めた範囲のID（ヘッダが壊れている場合は undefined）。 */
      id?: string;
      /** 読めた範囲のモード。 */
      mode?: ProblemMode;
    };

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else if (out === '') out = String(key);
    else out += `.${String(key)}`;
  }
  return out === '' ? '(root)' : out;
}

/**
 * zod のエラーを表示用の一覧に直す。§13 #1
 *
 * zod 4 は「未知のキー」を親オブジェクトの1件（`unrecognized_keys`）に、共用体の不一致を
 * 親の1件（`invalid_union`。候補ごとの違反は `errors` に入れ子）にまとめる。そのまま並べると
 * 「(root): 認識されていないキー」「schematic.rungs[0].from: 無効な入力」のように**どこが悪いのか
 * 分からない**ので、キー名まで伸ばし、共用体は親を残したまま各候補の違反をその位置まで展開する。
 * 同じ（パス・文言）の組は1回だけ出す。
 */
export function toProblemIssues(error: z.ZodError): ProblemIssue[] {
  const out: ProblemIssue[] = [];
  const seen = new Set<string>();
  const push = (path: readonly PropertyKey[], message: string): void => {
    const formatted = formatPath(path);
    const key = `${formatted}\u0000${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: formatted, message });
  };
  const walk = (issues: readonly z.core.$ZodIssue[], prefix: readonly PropertyKey[]): void => {
    for (const issue of issues) {
      const path = [...prefix, ...issue.path];
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) push([...path, key], issue.message);
        continue;
      }
      push(path, issue.message);
      if (issue.code === 'invalid_union') {
        for (const alternative of issue.errors) walk(alternative, path);
      }
    }
  };
  walk(error.issues, []);
  return out;
}

/** 値から `mode` だけを取り出す（判別に失敗したら undefined）。 */
function peekMode(value: unknown): ProblemMode | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const parsed = ProblemModeSchema.safeParse((value as Record<string, unknown>).mode);
  return parsed.success ? parsed.data : undefined;
}

/** 値から `id` だけを取り出す。 */
function peekId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = (value as Record<string, unknown>).id;
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * `mode` フィールドが存在するかだけを見る（`peekMode()` と違い、値の妥当性は問わない）。
 * 誤字の `mode`（例: `'inspect-part'`）と、`mode` を丸ごと書き忘れた場合を区別するために使う。
 */
function peekRawMode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = (value as Record<string, unknown>).mode;
  return typeof raw === 'string' ? raw : undefined;
}

/** そのモードがまだ開始できないか。 */
function isUnsupportedMode(mode: ProblemMode): boolean {
  return (UNSUPPORTED_MODES as readonly ProblemMode[]).includes(mode);
}

/**
 * 課題JSON（パース済みの値）を検証する。§7.8 / §13 #1
 * Phase 2 で開始できるのは `assemble` / `inspect-parts` / `inspect-repair` の3モードで、
 * `plc` はヘッダだけを読んで `unsupported-mode` として課題一覧に出す（§16）。
 * `mode` を読めなかった場合はモードB課題として検証し、スキーマ違反として理由を返す。
 */
export function parseProblem(json: unknown): ParseProblemResult {
  const mode = peekMode(json);
  const id = peekId(json);
  if (mode !== undefined && isUnsupportedMode(mode)) {
    const header = UnsupportedProblemSchema.safeParse(json);
    return {
      ok: false,
      reason: 'unsupported-mode',
      message: `このモードはまだ開始できません: ${mode}`,
      issues: header.success ? [] : toProblemIssues(header.error),
      ...(header.success ? { id: header.data.id } : id === undefined ? {} : { id }),
      mode,
    };
  }
  if (mode === undefined) {
    const raw = peekRawMode(json);
    // `mode` はあるが値が不正（誤字など）。何も分からずに assemble スキーマへ落とすと、
    // 無関係な8件のスキーマ違反（他モードの課題に assemble の必須項目が無い等）が出て
    // 「モード名が違う」という本当の理由が埋もれるので、ここで1件だけ返す。
    if (raw !== undefined) {
      return {
        ok: false,
        reason: 'schema',
        message: `課題モードが不正です: ${raw}`,
        issues: [
          {
            path: 'mode',
            message: `次のいずれかにしてください: ${ProblemModeSchema.options.join(', ')}`,
          },
        ],
        ...(id === undefined ? {} : { id }),
      };
    }
  }
  const parsed =
    mode === 'inspect-parts'
      ? InspectPartsProblemSchema.safeParse(json)
      : mode === 'inspect-repair'
        ? InspectRepairProblemSchema.safeParse(json)
        : AssembleProblemSchema.safeParse(json);
  if (parsed.success) return { ok: true, problem: parsed.data };
  return {
    ok: false,
    reason: 'schema',
    message: '課題の形式が正しくありません',
    issues: toProblemIssues(parsed.error),
    ...(id === undefined ? {} : { id }),
    ...(mode === undefined ? {} : { mode }),
  };
}

/**
 * 課題スキーマの JSON Schema を生成する。§4.5（`resources/schema/task.schema.json` に同梱する）。
 *
 * zod 4 は `z.toJSONSchema()` を標準で持つため `zod-to-json-schema` のような追加依存を入れない
 * （実機の zod は 4.6.0）。`z.refine()` / `z.superRefine()` の検査は JSON Schema で表せないので
 * 落ちるが、構造（キー・型・列挙・数値範囲）はそのまま出力される。
 */
export function problemJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ProblemSchema, { io: 'input', target: 'draft-2020-12' });
}
