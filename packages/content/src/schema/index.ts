import { z } from 'zod';
import { AssembleProblemSchema, type AssembleProblem } from './assemble.js';
import { ProblemHeaderShape, ProblemModeSchema, type ProblemMode } from './common.js';

/**
 * 課題スキーマの入口。設計仕様 §7 / §13 #1。
 * Phase 1 が本体まで定義するのは `assemble` だけで、他の3モードは**ヘッダだけを読み**、
 * `unsupported-mode` として課題一覧に理由付きで出す(プレースホルダのスキーマは置かない)。
 */

/** Phase 1 では本体を定義しないモードのヘッダ。本体フィールドはそのまま保持する。 */
export const UnsupportedProblemSchema = z.looseObject({
  ...ProblemHeaderShape,
  mode: z.enum(['inspect-parts', 'inspect-repair', 'plc']),
});

/** 未対応モードの課題(ヘッダのみ)。 */
export type UnsupportedProblem = z.infer<typeof UnsupportedProblemSchema>;

/** 課題(モードで判別する)。§7.1 */
export const ProblemSchema = z.discriminatedUnion('mode', [
  AssembleProblemSchema,
  UnsupportedProblemSchema,
]);

/** 課題。 */
export type Problem = z.infer<typeof ProblemSchema>;

/** スキーマ違反1件(zodのパスとメッセージ)。§13 #1 */
export interface ProblemIssue {
  path: string;
  message: string;
}

/** 読込に失敗した理由。§13 #1 / §13 #2 */
export type ProblemFailureReason = 'invalid-json' | 'schema' | 'unsupported-mode' | 'reference';

/** `parseProblem()` の結果。 */
export type ParseProblemResult =
  | { ok: true; problem: AssembleProblem }
  | {
      ok: false;
      reason: ProblemFailureReason;
      message: string;
      issues: ProblemIssue[];
      /** 読めた範囲のID(ヘッダが壊れている場合は undefined)。 */
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

/** zod のエラーを表示用の一覧に直す。§13 #1 */
export function toProblemIssues(error: z.ZodError): ProblemIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/** 値から `mode` だけを取り出す(判別に失敗したら undefined)。 */
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
 * 課題JSON(パース済みの値)を検証する。§7.8 / §13 #1
 * Phase 1 が開始できるのは `assemble` だけなので、他モードは `unsupported-mode` で返す。
 */
export function parseProblem(json: unknown): ParseProblemResult {
  const mode = peekMode(json);
  const id = peekId(json);
  if (mode !== undefined && mode !== 'assemble') {
    const header = UnsupportedProblemSchema.safeParse(json);
    return {
      ok: false,
      reason: 'unsupported-mode',
      message: `このモードは Phase 1 では開始できません: ${mode}`,
      issues: header.success ? [] : toProblemIssues(header.error),
      ...(header.success ? { id: header.data.id } : id === undefined ? {} : { id }),
      mode,
    };
  }
  const parsed = AssembleProblemSchema.safeParse(json);
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
 * 課題スキーマの JSON Schema を生成する。§4.5(`resources/schema/task.schema.json` に同梱する)。
 *
 * zod 4 は `z.toJSONSchema()` を標準で持つため `zod-to-json-schema` のような追加依存を入れない
 * (実機の zod は 4.6.0)。`z.refine()` / `z.superRefine()` の検査は JSON Schema で表せないので
 * 落ちるが、構造(キー・型・列挙・数値範囲)はそのまま出力される。
 */
export function problemJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ProblemSchema, { io: 'input', target: 'draft-2020-12' });
}
